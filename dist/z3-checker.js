import { getZ3, shutdownZ3 } from './z3-runtime.js';

export { shutdownZ3 };
export const DEFAULT_TIMEOUT_MS = 5000;
const WATCHDOG_GRACE_MS = 1000;
let queue = Promise.resolve();
let sequence = 0;

const unknown = reason => ({ status: 'unknown', values: {}, reason });

/**
 * Check an internally generated SMT-LIB query over mathematical integers.
 * User expressions must pass through the game's typed compiler first.
 * Bindings map result keys to integer SMT terms, including successor terms.
 * The whole transaction is serialized: Z3's async check mutex alone does not
 * protect synchronous context creation, parsing, model reads, or cleanup.
 */
export function checkSmt(script, bindings = {}, options = {}) {
  const task = queue.then(() => run(script, bindings, options));
  queue = task.then(() => undefined, () => undefined);
  return task;
}

async function run(script, bindings, { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (signal?.aborted) return unknown('cancelled');
  if (typeof script !== 'string' || !script.trim()
      || !bindings || typeof bindings !== 'object' || Array.isArray(bindings)
      || Object.values(bindings).some(term => typeof term !== 'string' || !term.trim())
      || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) {
    return unknown('invalid-solver-query');
  }
  let solver, model, timer, interrupted = false, stopping = null;
  let interrupt;
  const interruptedResult = new Promise(resolve => {
    interrupt = reason => {
      if (interrupted) return;
      interrupted = true;
      // Terminate the official pthread worker instead of abandoning a pending
      // check. A new query receives a fresh module after this transaction ends.
      stopping = shutdownZ3().catch(() => undefined);
      resolve(unknown(reason));
    };
  });
  const onAbort = () => interrupt('cancelled');
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal?.aborted) return unknown('cancelled');
    const api = await Promise.race([getZ3(), interruptedResult]);
    if (interrupted) return api;
    const ctx = new api.Context(`danger_close_query_${++sequence}`);
    solver = new ctx.Solver();
    const entries = Object.entries(bindings);
    const prefix = `__danger_close_witness_${sequence}_`;
    // Aliases permit evaluating terms such as (+ x 1) without feeding strings
    // to eval or treating application expressions as constant symbol names.
    const aliases = entries.map(([, term], index) => {
      const name = `${prefix}${index}`;
      return { name, source: `(declare-const ${name} Int)\n(assert (= ${name} ${term}))` };
    });
    solver.fromString(`${script}\n${aliases.map(alias => alias.source).join('\n')}`);
    solver.set('timeout', timeoutMs);
    // Z3 normally observes its own deadline. This watchdog also recovers from
    // stalled workers; it is a time bound, never a bound on integer values.
    timer = setTimeout(() => interrupt('timeout'), Math.min(2147483647, timeoutMs + WATCHDOG_GRACE_MS));
    const status = await Promise.race([solver.check(), interruptedResult]);
    if (interrupted) return status;
    if (signal?.aborted) return unknown('cancelled');
    if (status === 'unsat') return { status, values: {}, reason: '' };
    if (status === 'unknown') return unknown(solver.reasonUnknown() || 'solver-unknown');
    if (status !== 'sat') return unknown('invalid-solver-status');
    model = solver.model();
    const values = {};
    entries.forEach(([key], index) => {
      const value = model.eval(ctx.Int.const(aliases[index].name), true).value();
      const decimal = value.toString();
      if (!/^-?\d+$/.test(decimal)) throw new Error('Non-integer witness returned by Z3');
      Object.defineProperty(values, key, { value: decimal, enumerable: true });
    });
    return { status, values, reason: '' };
  } catch (error) {
    return unknown(interrupted ? (signal?.aborted ? 'cancelled' : 'timeout') : (error?.code || error?.message || 'solver-error'));
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    if (stopping) await stopping;
    if (!interrupted) {
      try { model?.release?.(); } catch {}
      try { solver?.release?.(); } catch {}
    }
  }
}
