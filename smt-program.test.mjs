import test from 'node:test';
import assert from 'node:assert/strict';
import { GENERAL_LEVELS } from './dist/levels-general.js';
import { SPATIAL_LEVELS } from './dist/levels-spatial.js';
import { evaluate, parseExpression } from './dist/engine.js';
import { compileVerificationProgram, parseSmtExpression } from './dist/smt-program.js';

const levels = [...GENERAL_LEVELS, ...SPATIAL_LEVELS];

// Independent, exact interpreter for the emitted SMT-LIB subset. These tests
// check translation against authored initialize/step functions, not whether a
// finite set of states constitutes a proof. Actual Z3 proof tests are separate.
function readScript(script) {
  const tokens = script.match(/\(|\)|[^\s()]+/g);
  let cursor = 0;
  function read() {
    const token = tokens[cursor++];
    if (token !== '(') return token;
    const list = [];
    while (tokens[cursor] !== ')') {
      assert.ok(cursor < tokens.length, 'balanced SMT-LIB');
      list.push(read());
    }
    cursor++;
    return list;
  }
  const forms = [];
  while (cursor < tokens.length) forms.push(read());
  return forms;
}

function evaluateTerm(term, values) {
  if (!Array.isArray(term)) {
    if (term === 'true' || term === 'false') return term === 'true';
    if (/^\d+$/.test(term)) return BigInt(term);
    assert.ok(Object.hasOwn(values, term), `bound SMT variable ${term}`);
    return BigInt(values[term]);
  }
  const [op, ...args] = term;
  const run = arg => evaluateTerm(arg, values);
  if (op === 'and') return args.every(run);
  if (op === 'or') return args.some(run);
  if (op === 'not') return !run(args[0]);
  if (op === 'ite') return run(run(args[0]) ? args[1] : args[2]);
  const [left, right] = args.map(run);
  switch (op) {
    case '+': return left + right;
    case '-': return args.length === 1 ? -left : left - right;
    case '*': return left * right;
    case '<': return left < right;
    case '<=': return left <= right;
    case '>': return left > right;
    case '>=': return left >= right;
    case '=': return left === right;
    case 'distinct': return left !== right;
    case 'div':
    case 'mod': {
      // Z3's div0 is total but unspecified. Choosing any value is sufficient
      // for these tests: definedness queries must catch every evaluated div0.
      if (right === 0n) return 0n;
      const modulus = right < 0n ? -right : right;
      const remainder = ((left % modulus) + modulus) % modulus;
      return op === 'mod' ? remainder : (left - remainder) / right;
    }
    default: assert.fail(`unexpected emitted operator ${op}`);
  }
}

const assertions = script => readScript(script).filter(form => form[0] === 'assert').map(form => form[1]);
const satisfies = (script, values) => assertions(script).every(term => evaluateTerm(term, values));
const satisfiesBindings = (script, values) => assertions(script).slice(0, -1).every(term => evaluateTerm(term, values));
const parameters = (a, b) => ({ a, b, n: Math.abs(a), m: Math.abs(b) });
const withAfter = (state, after, variables) => ({ ...state, ...Object.fromEntries(variables.map(name => [`${name}_after`, after[name]])) });

for (const level of levels) {
  test(`${level.id}: symbolic initialization and sequential/branching transition match authored program`, () => {
    const program = compileVerificationProgram(level, level.solution, level.goalSolution);
    const { initial, preservation, goal, specification } = program.stages;
    assert.deepEqual(Object.keys(initial.modelBindings), program.modelVariables);
    assert.deepEqual(Object.keys(preservation.afterBindings), program.variables);
    assert.equal(goal.violation, specification.violation);
    for (const [a, b] of [[0, 0], [-1, 2], [5, -3], [-40, 7]]) {
      const params = parameters(a, b);
      const state = { ...params, ...level.initialize({ a, b }) };
      assert.ok(satisfiesBindings(initial.violation, state));
      assert.equal(satisfies(initial.violation, state), false, 'reference invariant starts true');
      assert.equal(satisfies(initial.definednessViolation, state), false, 'initial expressions defined');
      for (const x of [-3, 0, 1, 3, 40]) for (const y of [-2, 0, 2, 9]) {
        for (const z of program.variables.length === 3 ? [-2, 0, 1, 7] : [0]) {
          const before = { ...params, x, y, ...(program.variables.length === 3 ? { z } : {}) };
          if (!evaluate(parseExpression(level.guardSource), before)) continue;
          const after = level.step(before);
          const model = withAfter(before, after, program.variables);
          assert.ok(satisfiesBindings(preservation.violation, model), JSON.stringify(model));
          // Sequential order is constrained, not merely a set of independent
          // simultaneous assignments: altering a successor invalidates it.
          assert.equal(satisfiesBindings(preservation.violation, { ...model, x_after: after.x + 1 }), false);
        }
      }
    }
  });
}

test('no map, input-sample, safe-number, or successor-window bounds enter proof obligations', () => {
  const level = levels[0];
  const base = compileVerificationProgram(level, 'x >= 0 && x + y == n && y <= 32', level.goalSolution);
  const changed = compileVerificationProgram({ ...level, domains: { x: { min: 0, max: 0 }, y: { min: 0, max: 0 } }, battleInputs: [{ a: 0, b: 0 }], size: 1 }, 'x >= 0 && x + y == n && y <= 32', level.goalSolution);
  assert.equal(base.stages.preservation.violation, changed.stages.preservation.violation);
  const witness = { a: -33, b: 0, n: 33, m: 0, x: 1, y: 32, x_after: 0, y_after: 33 };
  assert.ok(satisfies(base.stages.preservation.violation, witness), 'finds a step outside the retired window');
  const initial = compileVerificationProgram(level, 'n <= 4', 'true').stages.initial;
  assert.ok(satisfies(initial.violation, { a: -500, b: 0, n: 500, m: 0, x: 500, y: 0 }));
});

test('integer literals remain exact beyond JavaScript safe integers', () => {
  const huge = '900719925474099312345678901234567890';
  assert.equal(parseSmtExpression(huge).value, huge);
  assert.equal(parseSmtExpression('000123').value, '123');
  const stage = compileVerificationProgram(levels[0], `n != ${huge}`, 'true').stages.initial;
  assert.ok(satisfies(stage.violation, { a: huge, b: 0, n: huge, m: 0, x: huge, y: 0 }));
  assert.ok(stage.violation.includes(huge));
});

test('parameter relations come from the initializer, not arbitrary n/m or magnitudes guessed from samples', () => {
  const level = { ...levels[0], initializationCode: 'const n = Math.abs(a);\nconst m = n + b;\nlet x = n;\nlet y = 0;' };
  const stage = compileVerificationProgram(level, 'true', 'm == n + b').stages.goal;
  assert.ok(satisfiesBindings(stage.violation, { a: -9, b: -12, n: 9, m: -3, x: -50, y: 500 }));
  assert.equal(satisfiesBindings(stage.violation, { a: -9, b: -12, n: 9, m: 12, x: -50, y: 500 }), false);
});

test('a supplied true goal cannot suppress the independent fixed specification', () => {
  const program = compileVerificationProgram(levels[0], 'true', 'true');
  const witness = { a: 8, b: 0, n: 8, m: 0, x: 0, y: 0 };
  assert.equal(satisfies(program.stages.goal.violation, witness), false);
  assert.equal(satisfies(program.stages.specification.violation, witness), true);
});

test('goal and fixed-specification parsing are lazy and independent of earlier stages', () => {
  const program = compileVerificationProgram(levels[0], levels[0].solution, 'x ==');
  assert.ok(program.stages.initial.violation);
  assert.ok(program.stages.preservation.violation);
  assert.throws(() => program.stages.goal, /operand/);
  assert.ok(program.stages.specification.violation);
});

test('short-circuit definedness catches evaluated division and remainder by zero only', () => {
  const values = { a: 0, b: 0, n: 0, m: 0, x: 0, y: 0 };
  for (const source of ['x != 0 && y / x == 1', 'x == 0 || y % x == 0', 'false && 1 / 0 == 0', 'true || 1 % 0 == 0']) {
    const stage = compileVerificationProgram(levels[0], source, 'true').stages.initial;
    assert.equal(satisfies(stage.definednessViolation, values), false, source);
  }
  for (const source of ['y / x == 1', 'x == 0 && y / x == 0', 'x != 0 || y % x == 0']) {
    const stage = compileVerificationProgram(levels[0], source, 'true').stages.initial;
    assert.equal(satisfies(stage.definednessViolation, values), true, source);
  }
});

test('body definedness is conditional on the loop guard and the taken if branch', () => {
  const level = { ...levels[0], code: 'while (x > 0) {\n  if (y != 0) {\n    x = x / y;\n  } else {\n    x = x - 1;\n  }\n}' };
  const stage = compileVerificationProgram(level, 'true', 'true').stages.preservation;
  assert.equal(satisfies(stage.definednessViolation, { a: 5, b: 0, n: 5, m: 0, x: 1, y: 0, x_after: 0, y_after: 0 }), false);
  const unsafe = { ...level, code: 'while (x > 0) {\n  x = x / y;\n}' };
  const broken = compileVerificationProgram(unsafe, 'true', 'true').stages.preservation;
  assert.equal(satisfies(broken.definednessViolation, { a: 5, b: 0, n: 5, m: 0, x: 1, y: 0, x_after: 0, y_after: 0 }), true);
  assert.equal(satisfies(broken.definednessViolation, { a: 5, b: 0, n: 5, m: 0, x: 0, y: 0, x_after: 0, y_after: 0 }), false);
});

test('goal definedness is only required at invariant states that exit', () => {
  const stage = compileVerificationProgram(levels[0], 'true', '1 / x == 0').stages.goal;
  assert.equal(satisfies(stage.definednessViolation, { a: 1, b: 0, n: 1, m: 0, x: 0, y: 0 }), true);
  assert.equal(satisfies(stage.definednessViolation, { a: 1, b: 0, n: 1, m: 0, x: 1, y: 0 }), false);
});

test('Euclidean division and remainder work for both signs of operands', () => {
  const level = { ...levels[0], guardSource: 'false', code: 'while (false) {\n  x = x;\n}' };
  for (const [x, y, q, r] of [[-5, 3, -2, 1], [-5, -3, 2, 1], [5, -3, -1, 2], [5, 3, 1, 2]]) {
    const stage = compileVerificationProgram(level, 'true', `x / y == ${q} && x % y == ${r}`).stages.goal;
    assert.equal(satisfies(stage.violation, { a: 0, b: 0, n: 0, m: 0, x, y }), false);
  }
});

test('unsupported programs and expressions fail closed instead of using bounded callbacks', () => {
  for (const patch of [
    { initializationCode: undefined },
    { code: undefined },
    { code: 'while (x > 0) {\n  x++;\n}' },
    { code: 'while (x > 0) {\n  n = n - 1;\n}' },
    { code: 'while (x > 0) {\n  x = Math.random();\n}' },
    { code: 'while (x > 0) {\n  const mid = Math.floor(x / -2);\n  x = mid;\n}' },
    { code: 'while (x > 1) {\n  x = x - 1;\n}' },
  ]) assert.throws(() => compileVerificationProgram({ ...levels[0], ...patch }, 'true', 'true'));
  for (const expression of ['x && y', 'true == x', 'x +', 'unknown == 0', 'x = 1', 'x === 1', 'Math.abs(x) == 0', 'x + 1']) {
    assert.throws(() => compileVerificationProgram(levels[0], expression, 'true'), expression);
  }
  assert.throws(() => compileVerificationProgram(levels[0], 'z == 0', 'true'), 'undeclared third coordinate');
});
