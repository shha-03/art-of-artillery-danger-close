import test from 'node:test';
import assert from 'node:assert/strict';
import { GENERAL_LEVELS } from './dist/levels-general.js';
import { DOMAIN, evaluate, parseExpression, verificationCasesForLevel } from './dist/engine.js';

const comparisons = new Set(['==', '!=', '<', '<=', '>', '>=']);
// Visit small coordinates first to favor readable witnesses. This remains an
// enumeration of the complete checker window, stopped at the first failure.
const coordinates = Array.from({ length: DOMAIN.max - DOMAIN.min + 1 }, (_, index) => DOMAIN.min + index)
  .sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);
const parameters = ({ a, b, n, m }) => ({ a, b, n, m });
const insideWindow = ({ x, y }) => x >= DOMAIN.min && x <= DOMAIN.max
  && y >= DOMAIN.min && y <= DOMAIN.max;

function comparisonAtoms(ast) {
  if (ast.kind === 'binary' && comparisons.has(ast.op)) return [ast];
  if (ast.kind === 'binary') return [...comparisonAtoms(ast.left), ...comparisonAtoms(ast.right)];
  if (ast.kind === 'unary') return comparisonAtoms(ast.argument);
  return [];
}

function replaceWithTrue(ast, atom) {
  if (ast === atom) return { kind: 'literal', value: true, valueType: 'boolean' };
  if (ast.kind === 'binary') return {
    ...ast, left: replaceWithTrue(ast.left, atom), right: replaceWithTrue(ast.right, atom),
  };
  if (ast.kind === 'unary') return { ...ast, argument: replaceWithTrue(ast.argument, atom) };
  return ast;
}

function print(ast) {
  if (ast.kind === 'literal') return String(ast.value);
  if (ast.kind === 'variable') return ast.name;
  if (ast.kind === 'unary') return `${ast.op}${print(ast.argument)}`;
  return `(${print(ast.left)} ${ast.op} ${print(ast.right)})`;
}

function transition(level, before) {
  const { x, y } = level.step(Object.freeze({ ...before }));
  assert.ok(Number.isSafeInteger(x) && Number.isSafeInteger(y));
  return { x, y, ...parameters(before) };
}

/**
 * This is a counterexample search, not another complete proof of the solutions.
 * Every returned witness falsifies a predicate. Leaving the checker window by
 * itself is deliberately ignored, including when evaluating the successor.
 * Single-atom necessity does not claim these are globally shortest formulas.
 */
function findCounterexample(level, mutant, guard, goal) {
  const cases = verificationCasesForLevel(level);
  for (const initial of cases) {
    if (!evaluate(mutant, initial)) return { phase: 'initial', before: initial };
  }
  for (const initial of cases) {
    const context = parameters(initial);
    for (const x of coordinates) {
      for (const y of coordinates) {
        const before = { x, y, ...context };
        if (!evaluate(mutant, before)) continue;
        if (evaluate(guard, before)) {
          const after = transition(level, before);
          if (!evaluate(mutant, after)) return { phase: 'preservation', before, after };
        } else if (!evaluate(goal, before)) {
          return { phase: 'ensures', before };
        }
      }
    }
  }
  return null;
}

for (const level of GENERAL_LEVELS) {
  const invariant = parseExpression(level.solution);
  const guard = parseExpression(level.guardSource);
  const goal = parseExpression(level.goalSolution);
  for (const atom of comparisonAtoms(invariant)) {
    test(`${level.id}: removing ${print(atom)} has a predicate counterexample`, t => {
      const mutant = replaceWithTrue(invariant, atom);
      const witness = findCounterexample(level, mutant, guard, goal);
      assert.ok(witness, `${level.id}: ${print(atom)} can be removed within the verification cases`);
      const description = JSON.stringify(witness);
      if (witness.phase === 'initial') {
        assert.equal(evaluate(mutant, witness.before), false, description);
      } else {
        assert.equal(evaluate(mutant, witness.before), true, description);
        // The removed condition admits this state; no original full-domain
        // verification is repeated here (the campaign suite already does it).
        assert.equal(evaluate(invariant, witness.before), false, description);
        if (witness.phase === 'preservation') {
          assert.equal(evaluate(guard, witness.before), true, description);
          assert.equal(evaluate(mutant, witness.after), false, description);
          if (!insideWindow(witness.after)) t.diagnostic(`Actual predicate failure beyond window: ${description}`);
        } else {
          assert.equal(evaluate(guard, witness.before), false, description);
          assert.equal(evaluate(goal, witness.before), false, description);
        }
      }
    });
  }
}

function virtualStep(id, input, point, expected) {
  const level = GENERAL_LEVELS.find(candidate => candidate.id === id);
  const initial = { ...level.initialize(input), ...input };
  const before = { ...initial, ...point };
  const invariant = parseExpression(level.solution);
  const guard = parseExpression(level.guardSource);
  assert.equal(evaluate(invariant, before), true, `${id}: virtual pre-state satisfies the solution`);
  assert.equal(evaluate(guard, before), true, `${id}: virtual pre-state executes the body`);
  const after = transition(level, before);
  assert.deepEqual({ x: after.x, y: after.y }, expected);
  assert.equal(evaluate(invariant, after), true, `${id}: solution survives the virtual step`);
  return { initial, before, after, level };
}

test('g08: the negative branch reaches zero without an extra sign conjunct', () => {
  const { after, level } = virtualStep('g08', { a: -1, b: 2 }, { x: -1, y: 2 }, { x: 0, y: 3 });
  assert.equal(evaluate(parseExpression(level.guardSource), after), false);
  assert.equal(evaluate(parseExpression(level.goalSolution), after), true);
  // This second state cannot occur from the same initialization (|x| starts at
  // one and decreases), but must still satisfy the inductive preservation VC.
  const { initial, before } = virtualStep('g08', { a: -1, b: 2 }, { x: -4, y: -1 }, { x: -3, y: 0 });
  assert.ok(Math.abs(before.x) > Math.abs(initial.x));
});

test('g11: Euclidean modulus preserves negative virtual counters without x >= 0', () => {
  const wrapped = virtualStep('g11', { a: 2, b: 2 }, { x: -1, y: 2 }, { x: 0, y: 0 });
  const incremented = virtualStep('g11', { a: 2, b: 2 }, { x: -3, y: 0 }, { x: -2, y: 1 });
  const unitDivisor = virtualStep('g11', { a: 0, b: 0 }, { x: -1, y: 0 }, { x: 0, y: 0 });
  for (const { initial, before } of [wrapped, incremented, unitDivisor]) {
    assert.equal(initial.x, 0);
    assert.ok(before.x < initial.x, 'negative states are admitted for induction, not initial execution');
  }
  assert.equal(evaluate(parseExpression(unitDivisor.level.guardSource), unitDivisor.after), false);
  assert.equal(evaluate(parseExpression(unitDivisor.level.goalSolution), unitDivisor.after), true);
});

test('g14: a negative virtual prefix preserves the polynomial identity', () => {
  const { initial, before } = virtualStep('g14', { a: 2, b: 2 }, { x: -1, y: -1 }, { x: 0, y: 0 });
  // Actual x starts at zero and only increases: this checks an unreachable
  // state admitted by the intentionally weaker invariant, not another trace.
  assert.equal(initial.x, 0);
  assert.ok(before.x < initial.x);
});

test('g19: negative virtual roots are preserved for inputs beyond the sampled window', () => {
  // n > 4 is intentional. These selected mathematical regression cases do not
  // turn the finite checker into a proof for all external integer inputs.
  const crossing = virtualStep('g19', { a: 5, b: 0 }, { x: -1, y: 1 }, { x: 0, y: 0 });
  const negative = virtualStep('g19', { a: 10, b: 0 }, { x: -2, y: 4 }, { x: -1, y: 1 });
  for (const { initial, before, after, level } of [crossing, negative]) {
    assert.equal(initial.x, 0);
    assert.ok(before.x < initial.x);
    assert.equal(evaluate(parseExpression(level.guardSource), after), true);
  }
});

test('g20: both midpoint branches preserve a negative virtual lower endpoint', () => {
  const lower = virtualStep('g20', { a: 4, b: 0 }, { x: -2, y: 3 }, { x: 0, y: 3 });
  const upper = virtualStep('g20', { a: 4, b: 0 }, { x: -2, y: 8 }, { x: -2, y: 3 });
  for (const { initial, before } of [lower, upper]) {
    // Actual lower endpoints start at zero and cannot decrease.
    assert.equal(initial.x, 0);
    assert.ok(before.x < initial.x);
  }
});
