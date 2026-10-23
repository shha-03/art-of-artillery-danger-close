import test from 'node:test';
import assert from 'node:assert/strict';
import {
  analyze, createBattle, evaluate, formatEngineError, order, parseExpression,
} from './dist/engine.js';

// Dafny Reference Manual §5.2.2 and §9.8 define Euclidean int / and %:
// https://dafny.org/dafny/DafnyRef/DafnyRef#sec-numeric-types
// The exact reconstruction identity plus the modulus interval uniquely identify
// the quotient. These tests do not use JavaScript's rounded division as an oracle.
const quotient = parseExpression('x / y');
const modulus = parseExpression('x % y');
const at = (source, state = { x: 0, y: 1 }) => evaluate(parseExpression(source), state);
const mission = (overrides = {}) => ({
  initial: { x: 1, y: 1 }, guardSource: 'x < 2',
  step: ({ x, y }) => ({ x: x + 1, y }),
  size: 9, commands: 6, enemies: [{ x: 2, y: 1 }], allies: [],
  ...overrides,
});

test('Dafny quotient and nonnegative modulus agree across both operand signs', () => {
  for (const [x, y, q, r] of [
    [5, 3, 1, 2], [-5, 3, -2, 1], [5, -3, -1, 2], [-5, -3, 2, 1],
    [6, 3, 2, 0], [-6, 3, -2, 0], [6, -3, -2, 0], [-6, -3, 2, 0],
    [1, 3, 0, 1], [-1, 3, -1, 2], [1, -3, 0, 1], [-1, -3, 1, 2],
    [0, 3, 0, 0], [0, -3, 0, 0], [-0, 3, 0, 0], [-0, -3, 0, 0],
  ]) {
    assert.equal(evaluate(quotient, { x, y }), q, `${x} / ${y}`);
    assert.equal(evaluate(modulus, { x, y }), r, `${x} % ${y}`);
    assert.equal(Object.is(evaluate(modulus, { x, y }), -0), false);
  }
});

test('all small signed operands satisfy the unique Euclidean reconstruction law', () => {
  for (let x = -32; x <= 32; x++) for (let y = -32; y <= 32; y++) {
    if (y === 0) continue;
    const q = evaluate(quotient, { x, y });
    const r = evaluate(modulus, { x, y });
    assert.ok(Number.isSafeInteger(q) && Number.isSafeInteger(r));
    assert.ok(r >= 0 && r < Math.abs(y), `${x}, ${y}: modulus interval`);
    assert.equal(BigInt(q) * BigInt(y) + BigInt(r), BigInt(x), `${x}, ${y}: reconstruction`);
  }
});

test('division shares multiplicative precedence and left associativity without accepting extra syntax', () => {
  assert.equal(at('20 / 3 * 2'), 12);
  assert.equal(at('20 / (3 * 2)'), 3);
  assert.equal(at('20 / 3 % 4'), 2);
  assert.equal(at('20 % 6 / 2'), 1);
  assert.equal(at('2 + 20 / 3 * 2'), 14);
  assert.equal(at('-5 / -3'), 2);
  assert.equal(at('-(5 / 3)'), -1);
  assert.equal(at('x / y == 1 && x % y == 2', { x: 5, y: 3 }), true);
  assert.equal(parseExpression('x / y').valueType, 'integer');
  for (const source of ['x / true', 'false / x', 'x /', 'x // y', 'x /= y', '/* x */', 'x ** y']) {
    assert.throws(() => parseExpression(source), undefined, source);
  }
});

test('short-circuit guards prevent evaluating undefined division and modulus', () => {
  for (const operator of ['/', '%']) {
    assert.equal(at(`y != 0 && x ${operator} y == 0`, { x: 7, y: 0 }), false);
    assert.equal(at(`y == 0 || x ${operator} y == 0`, { x: 7, y: 0 }), true);
    assert.equal(at(`false && (1 ${operator} 0 == 0)`), false);
    assert.equal(at(`true || (1 ${operator} 0 == 0)`), true);
    assert.throws(() => at(`x ${operator} y == 0 && y != 0`, { x: 7, y: 0 }));
    assert.throws(() => at(`false || x ${operator} y == 0`, { x: 7, y: 0 }));
  }
});

test('near-limit integer division is exact without widening accepted arithmetic', () => {
  const max = Number.MAX_SAFE_INTEGER;
  const dividends = [max, max - 1, max - 2, -max, -max + 1, -max + 2, -1, 0, 1];
  const divisors = [1, -1, 2, -2, 3, -3, max, -max, max - 1, 1 - max];
  for (const x of dividends) for (const y of divisors) {
    const q = evaluate(quotient, { x, y }), r = evaluate(modulus, { x, y });
    assert.ok(Number.isSafeInteger(q) && Number.isSafeInteger(r));
    assert.ok(r >= 0 && r < Math.abs(y));
    assert.equal(BigInt(q) * BigInt(y) + BigInt(r), BigInt(x), `${x}, ${y}`);
  }
  assert.equal(at('9007199254740991 / 2'), 4503599627370495);
  assert.equal(at('-9007199254740991 / 3'), -3002399751580331);
  assert.equal(at('-9007199254740991 % 3'), 2);
  for (const source of [
    '9007199254740992 / 1', '(9007199254740991 + 1) / 2',
    '(9007199254740991 * 2) / 2', '9007199254740991 / 1 + 1',
  ]) assert.throws(() => at(source), error => error.errorCode === 'integer-range', source);
  assert.throws(() => evaluate(quotient, { x: max + 1, y: 1 }), error => error.errorCode === 'integer-range');
});

test('zero-divisor diagnostics are structured, localized and never charge an order', () => {
  for (const [operator, code, english] of [
    ['/', 'zero-division-divisor', 'Integer division divisor is zero. Set a nonzero divisor.'],
    ['%', 'zero-remainder-divisor', 'Remainder divisor is zero. Set a nonzero divisor.'],
  ]) {
    const source = `x ${operator} 0 == 0`;
    assert.throws(() => at(source), error => {
      assert.equal(error.errorCode, code);
      assert.equal(formatEngineError(error, 'en'), english);
      assert.match(formatEngineError(error, 'ko'), /0.*제수/);
      return true;
    });
    const level = mission();
    const report = analyze(source, 'true', level);
    assert.equal(report.errorCode, code);
    assert.equal(formatEngineError(report, 'en'), english);
    for (const check of ['initial', 'preservation', 'goal']) assert.equal(report[check].pass, null);
    const battle = createBattle(level);
    const result = order(battle, source, 'true', 'salvo');
    assert.equal(result.errorCode, code);
    assert.equal(result.errorStage, 'initial');
    assert.equal(result.cost, 0);
    assert.equal(result.battle, battle);
    assert.deepEqual(result.shots, []);
  }
});

test('an off-trace zero division still aborts preservation without firing', () => {
  const level = mission();
  const invariant = 'x >= 0 && x <= 2 && y == 1 && 1 / x >= 0';
  const result = order(createBattle(level), invariant, 'true', 'salvo');
  assert.equal(result.analysis.initial.pass, true);
  assert.equal(result.errorStage, 'preservation');
  assert.equal(result.errorCode, 'zero-division-divisor');
  assert.equal(result.cost, 0);
  assert.deepEqual(result.shots, []);
});

test('Euclidean division predicates are checked over negative virtual states as well as actual execution', () => {
  const level = mission({
    initial: { x: -5, y: -3 }, guardSource: 'false',
    domains: { x: { min: -6, max: 6 }, y: { min: -3, max: 3 } },
    enemies: [{ x: 0, y: 1 }],
  });
  const report = analyze('y != 0', 'x == x / y * y + x % y && x % y >= 0', level);
  assert.equal(report.error, undefined);
  assert.equal(report.valid, true);
  assert.equal(report.goal.pass, true);
  assert.equal(report.checkedStateCount, 13 * 7);
  assert.equal(report.exitStateCount, 13 * 6);
  const negative = analyze('y != 0', 'x / y == 0', level);
  assert.equal(negative.goal.pass, false);
  assert.deepEqual(negative.goal.before, { x: -6, y: -3 });
});
