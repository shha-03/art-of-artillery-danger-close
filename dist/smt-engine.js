import {
  battlefieldCasesForLevel, domainsForLevel, isInitializedLevel,
  resolveOrder, stateKey, variablesForLevel,
} from './engine.js';
import { compileVerificationProgram, parseSmtExpression } from './smt-program.js';

const PARAMETERS = ['a', 'b', 'n', 'm'];
const skipped = () => ({ pass: null, skipped: true });

function verificationError(code, detail, extra = {}) {
  return Object.assign(new Error(detail), { errorCode: code, errorParams: { detail, ...extra } });
}

/** Exact arithmetic for the finite map projection; never used as a proof. */
export function evaluateSmtExpression(ast, state) {
  function visit(node) {
    if (node.kind === 'literal') return node.valueType === 'integer' ? BigInt(node.value) : node.value;
    if (node.kind === 'variable') {
      const value = state[node.name];
      if (value === undefined || (typeof value === 'number' && !Number.isSafeInteger(value))) {
        throw verificationError('smt-projection-error', `Cannot display an exact value for ${node.name}.`);
      }
      return BigInt(value);
    }
    if (node.kind === 'unary') {
      const value = visit(node.argument);
      if (node.op === '!') return !value;
      if (node.op === '-') return -value;
      if (node.op === '+') return value;
    }
    if (node.kind === 'binary') {
      const left = visit(node.left);
      if (node.op === '&&') return left && visit(node.right);
      if (node.op === '||') return left || visit(node.right);
      const right = visit(node.right);
      switch (node.op) {
        case '+': return left + right;
        case '-': return left - right;
        case '*': return left * right;
        case '/':
        case '%': {
          if (right === 0n) throw verificationError('smt-undefined-expression', 'An expression divides by zero.');
          let quotient = left / right, remainder = left % right;
          if (remainder < 0n) {
            if (right > 0n) { quotient--; remainder += right; }
            else { quotient++; remainder -= right; }
          }
          return node.op === '/' ? quotient : remainder;
        }
        case '==': return left === right;
        case '!=': return left !== right;
        case '<': return left < right;
        case '<=': return left <= right;
        case '>': return left > right;
        case '>=': return left >= right;
      }
    }
    throw verificationError('smt-projection-error', 'Unsupported expression in the map projection.');
  }
  return visit(ast);
}

/** Only the displayed board and representative contexts are enumerated here. */
export function previewCandidatesSmt(source, level) {
  const axes = variablesForLevel(level);
  const variables = [...axes, ...PARAMETERS];
  const invariant = parseSmtExpression(source, { variables });
  const guard = parseSmtExpression(level.guardSource, { variables });
  if (invariant.valueType !== 'boolean' || guard.valueType !== 'boolean') {
    throw verificationError('predicate-type', 'Enter a Boolean expression.', { label: 'invariant' });
  }
  const contexts = isInitializedLevel(level) ? battlefieldCasesForLevel(level) : [{}];
  const zRange = axes.includes('z') ? domainsForLevel(level).z : { min: 0, max: 0 };
  const points = new Map();
  for (const context of contexts) {
    const parameters = Object.fromEntries(PARAMETERS.filter(name => Object.hasOwn(context, name))
      .map(name => [name, context[name]]));
    for (let x = 0; x < level.size; x++) for (let y = 0; y < level.size; y++) {
      for (let z = zRange.min; z <= zRange.max; z++) {
        const point = { x, y, ...(axes.includes('z') ? { z } : {}) };
        const state = { ...point, ...parameters };
        if (evaluateSmtExpression(invariant, state) && !evaluateSmtExpression(guard, state)) {
          points.set(stateKey(point), point);
        }
      }
    }
  }
  return [...points.values()].sort((a, b) => a.x - b.x || a.y - b.y || (a.z ?? 0) - (b.z ?? 0));
}

const outcome = (battle, fields = {}) => ({
  battle, analysis: null, shots: [], enemyPoints: 0, friendlyPoints: 0, dud: false, cost: 0, ...fields,
});

function exactModelValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number' && Number.isSafeInteger(value)) return String(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return BigInt(value).toString();
  throw verificationError('smt-invalid-model', 'The solver did not return an exact integer counterexample.');
}

function witnessFromModel(result, stage) {
  const values = result.values ?? {};
  const before = Object.fromEntries(Object.keys(stage.modelBindings ?? {}).map(name => [name, exactModelValue(values[name])]));
  const afterNames = Object.keys(stage.afterBindings ?? {});
  return {
    before,
    ...(afterNames.length ? { after: {
      ...before,
      ...Object.fromEntries(afterNames.map(name => [name, exactModelValue(values[`after_${name}`])])),
    } } : {}),
  };
}

/**
 * Stage-by-stage, unbounded integer proof. A check returns unsat to establish an
 * obligation, sat to refute it, or unknown to stop without charging/firing.
 * No finite verifier supplies or replaces any of these proof results.
 */
export async function* orderStagesSmt(battle, invariantSource, goalSource, mode = 'single', options = {}) {
  const { check, signal, timeoutMs } = options;
  const cancelled = () => outcome(battle, { cancelled: true, reason: 'cancelled' });
  if (signal?.aborted) return cancelled();
  if (mode !== 'single' && mode !== 'salvo') {
    return outcome(battle, { error: 'Invalid fire mode.', errorCode: 'invalid-mode', errorParams: { mode }, reason: 'invalid-mode' });
  }
  if (battle.finished) return outcome(battle, { reason: 'finished' });
  const initialized = isInitializedLevel(battle.level);
  const analysis = {
    verification: { backend: 'z3', domain: 'integers', bounded: false },
    valid: false, objectiveVerified: false,
    initial: skipped(), preservation: skipped(), goal: skipped(),
    ...(initialized ? { specification: skipped() } : {}),
    candidates: [], trace: [], traces: [],
  };
  const snapshot = stage => ({ stage, analysis: structuredClone(analysis) });
  const fail = (error, stage, key = stage) => {
    const code = error.errorCode ?? 'smt-unavailable';
    analysis[key] = { pass: null, status: code === 'smt-unknown' ? 'unknown' : 'error', ...error.witness };
    analysis.valid = analysis.initial.pass === true && analysis.preservation.pass === true;
    analysis.objectiveVerified = false;
    Object.assign(analysis, {
      error: error.message ?? String(error), errorCode: code,
      errorParams: error.errorParams ?? { detail: error.message ?? String(error) },
      errorStage: stage, errorCheck: key,
      inconclusive: code === 'smt-unknown' || code === 'smt-unavailable',
    });
  };
  const finish = () => {
    const result = resolveOrder(battle, analysis, mode);
    return analysis.inconclusive ? { ...result, inconclusive: true, reason: 'verification-inconclusive' } : result;
  };
  const prove = async stage => {
    if (typeof check !== 'function') throw verificationError('smt-unavailable', 'Z3 is not available.');
    const bindings = {
      ...stage.modelBindings,
      ...Object.fromEntries(Object.entries(stage.afterBindings ?? {}).map(([name, term]) => [`after_${name}`, term])),
    };
    for (const [kind, script] of [['definedness', stage.definednessViolation], ['obligation', stage.violation]]) {
      if (!script) throw verificationError('smt-unavailable', 'A symbolic proof obligation is missing.');
      const result = await check(script, bindings, { signal, timeoutMs });
      if (signal?.aborted) return null;
      if (!result || !['sat', 'unsat'].includes(result.status)) {
        const reason = result?.reason ?? 'The solver could not decide this obligation.';
        throw verificationError('smt-unknown', 'Z3 could not complete the verification.', { reason });
      }
      if (result.status === 'sat') {
        const witness = witnessFromModel(result, stage);
        if (kind === 'definedness') {
          const error = verificationError('smt-undefined-expression', 'An expression may divide by zero.');
          error.witness = witness;
          throw error;
        }
        return { pass: false, status: 'sat', ...witness };
      }
    }
    return { pass: true, status: 'unsat' };
  };

  let program;
  try {
    program = compileVerificationProgram(battle.level, invariantSource, goalSource);
    analysis.initial = await prove(program.stages.initial);
  } catch (error) { fail(error, 'initial'); }
  if (signal?.aborted) return cancelled();
  yield snapshot('initial');
  if (signal?.aborted) return cancelled();
  if (analysis.initial.pass !== true) return finish();

  try {
    analysis.preservation = await prove(program.stages.preservation);
    if (analysis.preservation?.pass === true) analysis.valid = true;
  } catch (error) { fail(error, 'preservation'); }
  if (signal?.aborted) return cancelled();
  yield snapshot('preservation');
  if (signal?.aborted) return cancelled();
  if (analysis.preservation.pass !== true) return finish();

  let activeCheck = 'goal';
  try {
    analysis.goal = await prove(program.stages.goal);
    if (!signal?.aborted && initialized) {
      activeCheck = 'specification';
      analysis.specification = await prove(program.stages.specification);
    }
    if (!signal?.aborted) {
      activeCheck = 'goal';
      analysis.candidates = previewCandidatesSmt(invariantSource, battle.level);
      analysis.objectiveVerified = analysis.valid && analysis.goal.pass === true
        && (!initialized || analysis.specification.pass === true);
    }
  } catch (error) { fail(error, 'goal', activeCheck); }
  if (signal?.aborted) return cancelled();
  yield snapshot('goal');
  if (signal?.aborted) return cancelled();
  return finish();
}
