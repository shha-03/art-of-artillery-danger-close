import { getZ3 } from './z3-runtime.js';

export const DEFAULT_TIMEOUT_MS = 2000;

// The WASM module is shared. Keep context construction, synchronous API calls,
// asynchronous checks, model reads, and cleanup in one serial transaction.
let verificationQueue = Promise.resolve();
let contextNumber = 0;

function unknown(reason, detail = '') {
  return { pass: null, status: 'unknown', reason, ...(detail ? { detail } : {}) };
}

function compile(ast, ctx, state) {
  const yes = ctx.Bool.val(true);
  if (ast.kind === 'literal') {
    return { value: ast.valueType === 'integer' ? ctx.Int.val(ast.value) : ctx.Bool.val(ast.value), defined: yes };
  }
  if (ast.kind === 'variable') return { value: state[ast.name], defined: yes };
  if (ast.kind === 'conditional') {
    const condition = compile(ast.condition, ctx, state);
    const onTrue = compile(ast.then, ctx, state);
    const onFalse = compile(ast.else, ctx, state);
    return {
      value: ctx.If(condition.value, onTrue.value, onFalse.value),
      defined: ctx.And(condition.defined, ctx.If(condition.value, onTrue.defined, onFalse.defined)),
    };
  }
  if (ast.kind === 'unary') {
    const argument = compile(ast.argument, ctx, state);
    return {
      value: ast.op === '!' ? argument.value.not() : ast.op === '-' ? argument.value.neg() : argument.value,
      defined: argument.defined,
    };
  }
  const left = compile(ast.left, ctx, state);
  const right = compile(ast.right, ctx, state);
  if (ast.op === '&&' || ast.op === '||') {
    return {
      value: ast.op === '&&' ? ctx.And(left.value, right.value) : ctx.Or(left.value, right.value),
      defined: ctx.And(left.defined, ctx.Implies(ast.op === '&&' ? left.value : left.value.not(), right.defined)),
    };
  }
  let value;
  let defined = ctx.And(left.defined, right.defined);
  switch (ast.op) {
    case '+': value = left.value.add(right.value); break;
    case '-': value = left.value.sub(right.value); break;
    case '*': value = left.value.mul(right.value); break;
    case '%': {
      // Z3 mod is Euclidean. The language uses truncating remainder instead:
      // sign(a) * (abs(a) mod abs(b)); b == 0 is explicitly undefined.
      const absLeft = ctx.If(left.value.ge(0), left.value, left.value.neg());
      const absRight = ctx.If(right.value.ge(0), right.value, right.value.neg());
      const magnitude = absLeft.mod(absRight);
      value = ctx.If(left.value.ge(0), magnitude, magnitude.neg());
      defined = ctx.And(defined, right.value.neq(0));
      break;
    }
    case '==': value = left.value.eq(right.value); break;
    case '!=': value = left.value.neq(right.value); break;
    case '<': value = left.value.lt(right.value); break;
    case '<=': value = left.value.le(right.value); break;
    case '>': value = left.value.gt(right.value); break;
    case '>=': value = left.value.ge(right.value); break;
    default: throw new Error(`Unsupported SMT operator: ${ast.op}`);
  }
  return { value, defined };
}

async function checkObligation(ctx, name, formula, undefinedFormula, before, after, transitionDefined, options) {
  let solver;
  let model;
  try {
    const started = Date.now();
    solver = options.solverFactory ? options.solverFactory(ctx, name) : new ctx.Solver();
    solver.set('timeout', options.timeoutMs);
    if (options.rlimit !== undefined) solver.set('rlimit', options.rlimit);
    // Definedness has priority over logical failure. Combining the queries
    // would let a SAT model for false hide a different undefined state.
    solver.add(undefinedFormula);
    let status = await solver.check();
    const undefinedWitness = status === 'sat';
    if (status === 'unsat') {
      const remainingMs = options.timeoutMs - (Date.now() - started);
      if (remainingMs <= 0) return unknown('timeout', 'phase time limit exceeded');
      solver.reset();
      solver.set('timeout', remainingMs);
      if (options.rlimit !== undefined) solver.set('rlimit', options.rlimit);
      solver.add(formula);
      status = await solver.check();
      if (status === 'unsat') return { pass: true, status: 'unsat' };
    }
    if (status === 'unknown') {
      const detail = solver.reasonUnknown?.() || 'unknown';
      return unknown(/timeout|canceled/i.test(detail) ? 'timeout' : 'solver-unknown', detail);
    }
    if (status !== 'sat') return unknown('solver-error', `Unexpected solver status: ${status}`);
    model = solver.model();
    const serialize = (state) => ({
      x: model.eval(state.x, true).value().toString(),
      y: model.eval(state.y, true).value().toString(),
    });
    const witness = { before: serialize(before) };
    if (after && ctx.isTrue(model.eval(transitionDefined, true))) witness.after = serialize(after);
    if (undefinedWitness || ctx.isTrue(model.eval(undefinedFormula, true))) {
      return { ...unknown('undefined-expression'), solverStatus: 'sat', ...witness };
    }
    return { pass: false, status: 'sat', ...witness };
  } catch (error) {
    return unknown('solver-error', error instanceof Error ? error.message : String(error));
  } finally {
    // Release models before their solvers. No API call overlaps another check.
    try { model?.release?.(); } catch {}
    try { solver?.release?.(); } catch {}
  }
}

async function verify(program, invariantAst, goalAst, options) {
  try {
    const { Context } = await getZ3();
    const ctx = new Context(`danger_close_${++contextNumber}`);
    const before = { x: ctx.Int.const('x'), y: ctx.Int.const('y') };
    const invariant = compile(invariantAst, ctx, before);
    const guard = compile(program.guard, ctx, before);
    const goal = compile(goalAst, ctx, before);
    const nextX = compile(program.transition.x, ctx, before);
    const nextY = compile(program.transition.y, ctx, before);
    const after = { x: nextX.value, y: nextY.value };
    const transitionDefined = ctx.And(nextX.defined, nextY.defined);
    const nextInvariant = compile(invariantAst, ctx, after);
    const atInitial = ctx.And(before.x.eq(program.initial.x), before.y.eq(program.initial.y));
    const initialUndefined = invariant.defined.not();
    const initialFailure = ctx.And(atInitial, ctx.Or(initialUndefined, invariant.value.not()));

    // I must be a total predicate over Int. G is required only where I is true,
    // T only where I && G, and I(T(s)) only after a defined transition.
    const preservationUndefined = ctx.Or(
      invariant.defined.not(),
      ctx.And(invariant.value, ctx.Or(
        guard.defined.not(),
        ctx.And(guard.value, ctx.Or(transitionDefined.not(), nextInvariant.defined.not())),
      )),
    );
    const preservationFailure = ctx.Or(
      preservationUndefined,
      ctx.And(invariant.value, guard.value, nextInvariant.value.not()),
    );
    const goalUndefined = ctx.Or(
      invariant.defined.not(),
      ctx.And(invariant.value, ctx.Or(guard.defined.not(), ctx.And(guard.value.not(), goal.defined.not()))),
    );
    const goalFailure = ctx.Or(goalUndefined, ctx.And(invariant.value, guard.value.not(), goal.value.not()));

    const initial = await checkObligation(ctx, 'initial', initialFailure, ctx.And(atInitial, initialUndefined), before, null, null, options);
    const preservation = await checkObligation(ctx, 'preservation', preservationFailure, preservationUndefined, before, after, transitionDefined, options);
    const goalCheck = await checkObligation(ctx, 'goal', goalFailure, goalUndefined, before, null, null, options);
    return { initial, preservation, goal: goalCheck };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    const runtimeReasons = {
      Z3_ISOLATION_REQUIRED: 'isolation-required',
      Z3_UNSUPPORTED: 'unsupported-browser',
      Z3_INIT_TIMEOUT: 'initialization-timeout',
      Z3_INIT_CANCELLED: 'initialization-cancelled',
      Z3_LOAD_FAILED: 'solver-unavailable',
    };
    const reason = runtimeReasons[error?.code] || 'solver-error';
    return {
      initial: unknown(reason, detail),
      preservation: unknown(reason, detail),
      goal: unknown(reason, detail),
    };
  }
}

/** Parsed ASTs only; user source is never passed to the SMT parser or eval. */
export function verifyWithSMT(program, invariantAst, goalAst, options) {
  const task = verificationQueue.then(() => verify(program, invariantAst, goalAst, options));
  verificationQueue = task.then(() => undefined, () => undefined);
  return task;
}
