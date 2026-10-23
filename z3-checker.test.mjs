import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { checkSmt, shutdownZ3 } from './dist/z3-checker.js';

after(async () => shutdownZ3());

test('Z3 preserves unbounded integer counterexamples and successor terms exactly', async () => {
  const result = await checkSmt(
    '(declare-const x Int) (assert (= x 100000000000000000000001))',
    { x: 'x', after_x: '(+ x 1)', negative: '(- x)' }
  );
  assert.equal(result.status, 'sat');
  assert.deepEqual(result.values, {
    x: '100000000000000000000001',
    after_x: '100000000000000000000002',
    negative: '-100000000000000000000001',
  });
});

test('only an unsatisfiable query yields the proof result', async () => {
  const result = await checkSmt('(declare-const x Int) (assert (> x 0)) (assert (< x 1))', { x: 'x' });
  assert.deepEqual(result, { status: 'unsat', values: {}, reason: '' });
});

test('integer division and remainder agree with Dafny for either divisor sign', async () => {
  const result = await checkSmt('(assert true)', {
    positiveQuotient: '(div (- 5) 3)', positiveRemainder: '(mod (- 5) 3)',
    negativeQuotient: '(div (- 5) (- 3))', negativeRemainder: '(mod (- 5) (- 3))',
  });
  assert.equal(result.status, 'sat');
  assert.deepEqual(result.values, {
    positiveQuotient: '-2', positiveRemainder: '1', negativeQuotient: '2', negativeRemainder: '1',
  });
});

test('parallel callers are serialized without mixing their model values', async () => {
  const results = await Promise.all(Array.from({ length: 8 }, (_, n) =>
    checkSmt(`(declare-const x Int) (assert (= x ${n}))`, { x: 'x' })
  ));
  assert.deepEqual(results.map(result => [result.status, result.values.x]),
    Array.from({ length: 8 }, (_, n) => ['sat', String(n)]));
});

test('pre-cancelled requests never yield a proof or counterexample', async () => {
  const controller = new AbortController();
  controller.abort();
  assert.deepEqual(await checkSmt('(assert false)', {}, { signal: controller.signal }),
    { status: 'unknown', values: {}, reason: 'cancelled' });
});

const hardQuery = '(declare-const x Int) (declare-const y Int) (declare-const z Int) '
  + '(assert (= (+ (* x x x) (* y y y) (* z z z)) 42))';

test('a solver timeout remains unknown and leaves the queue usable', async () => {
  const result = await checkSmt(hardQuery, { x: 'x' }, { timeoutMs: 5 });
  assert.equal(result.status, 'unknown');
  assert.match(result.reason, /timeout|canceled|incomplete/i);
  assert.deepEqual(result.values, {});
  assert.equal((await checkSmt('(assert false)')).status, 'unsat');
});

test('cancelling an active check stops its worker and the next check starts cleanly', async () => {
  const controller = new AbortController();
  const pending = checkSmt(hardQuery, { x: 'x' }, { signal: controller.signal, timeoutMs: 10000 });
  const timer = setTimeout(() => controller.abort(), 25);
  try {
    assert.deepEqual(await pending, { status: 'unknown', values: {}, reason: 'cancelled' });
  } finally { clearTimeout(timer); }
  const next = await checkSmt('(declare-const x Int) (assert (= x 7))', { x: 'x' });
  assert.deepEqual(next, { status: 'sat', values: { x: '7' }, reason: '' });
});

test('invalid deadlines are rejected without being treated as proofs', async () => {
  for (const timeoutMs of [0, -1, NaN, Infinity, 2147483648]) {
    const result = await checkSmt('(assert false)', {}, { timeoutMs });
    assert.deepEqual(result, { status: 'unknown', values: {}, reason: 'invalid-solver-query' });
  }
});

test('invalid internal SMT syntax cannot poison subsequent checks', async () => {
  const invalid = await checkSmt('(assert unknown_internal_symbol)');
  assert.equal(invalid.status, 'unknown');
  assert.deepEqual(invalid.values, {});
  assert.equal((await checkSmt('(assert false)')).status, 'unsat');
});
