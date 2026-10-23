import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, previewCandidatesForLevel } from './dist/engine.js';
import { GENERAL_LEVELS } from './dist/levels-general.js';
import { SPATIAL_LEVELS } from './dist/levels-spatial.js';
import { parseSmtExpression } from './dist/smt-program.js';
import { evaluateSmtExpression, orderStagesSmt, previewCandidatesSmt } from './dist/smt-engine.js';

const level = GENERAL_LEVELS[0];
const defaultValues = bindings => Object.fromEntries(Object.keys(bindings).map(name => [name, '0']));
function checker(overrides = {}) {
  const calls = [];
  return {
    calls,
    async check(script, bindings, options) {
      const index = calls.length;
      calls.push({ script, bindings, options });
      const result = overrides[index] ?? { status: 'unsat' };
      if (result instanceof Error) throw result;
      return { values: defaultValues(bindings), ...result };
    },
  };
}
async function consume(iterator) {
  const stages = [];
  while (true) {
    const next = await iterator.next();
    if (next.done) return { stages, result: next.value };
    stages.push(next.value);
  }
}
function makeOrder(mock = checker(), source = level.solution, goal = level.goalSolution, mission = level, extra = {}) {
  const battle = createBattle(mission);
  return { battle, iterator: orderStagesSmt(battle, source, goal, 'salvo', { check: mock.check, ...extra }), mock };
}

test('SMT orders advance lazily, emit independent stages, and only unsat establishes a proof', async () => {
  const { battle, iterator, mock } = makeOrder();
  assert.equal(mock.calls.length, 0);
  const initial = (await iterator.next()).value;
  assert.equal(initial.stage, 'initial');
  assert.equal(initial.analysis.initial.pass, true);
  assert.equal(mock.calls.length, 2);
  assert.deepEqual(initial.analysis.preservation, { pass: null, skipped: true });
  initial.analysis.initial.pass = false;
  const preservation = (await iterator.next()).value;
  assert.equal(preservation.stage, 'preservation');
  assert.equal(preservation.analysis.initial.pass, true);
  assert.equal(mock.calls.length, 4);
  const exit = (await iterator.next()).value;
  assert.equal(exit.stage, 'goal');
  assert.equal(mock.calls.length, 8);
  assert.equal(exit.analysis.objectiveVerified, true);
  assert.deepEqual(exit.analysis.verification, { backend: 'z3', domain: 'integers', bounded: false });
  for (const key of ['inputWindow', 'stateWindow', 'contextCount', 'checkedStateCount', 'exitStateCount']) {
    assert.ok(!Object.hasOwn(exit.analysis, key), `${key} must not describe an SMT proof`);
  }
  const final = await iterator.next();
  assert.equal(final.done, true);
  assert.equal(final.value.cost, 1);
  assert.equal(final.value.battle.cleared, true);
  assert.equal(final.value.battle.scoreMultiplier, 2);
  assert.equal(battle.remaining, 6);
  assert.equal(battle.hit.length, 0);
  assert.equal(mock.calls.length, 8);
});

test('an initial counterexample is a dud and does not inspect malformed future goal text', async () => {
  const mock = checker({ 1: { status: 'sat' } });
  const { iterator, battle } = makeOrder(mock, 'false', 'x =');
  const { stages, result } = await consume(iterator);
  assert.deepEqual(stages.map(stage => stage.stage), ['initial']);
  assert.equal(mock.calls.length, 2);
  assert.equal(result.dud, true);
  assert.equal(result.cost, 1);
  assert.equal(result.battle.remaining, battle.remaining - 1);
  assert.equal(result.error, undefined);
  assert.deepEqual(result.shots, []);
});

test('preservation counterexamples retain exact integers beyond finite windows and Number precision', async () => {
  const exact = '900719925474099312345678901234567890';
  const mock = checker({ 3: { status: 'sat', values: {
    a: exact, b: '0', n: exact, m: '0', x: exact, y: '-900719925474099312345678901234567889',
    after_x: '900719925474099312345678901234567889', after_y: '-900719925474099312345678901234567888',
  } } });
  const { result, stages } = await consume(makeOrder(mock).iterator);
  assert.deepEqual(stages.map(stage => stage.stage), ['initial', 'preservation']);
  assert.equal(mock.calls.length, 4);
  assert.equal(result.analysis.preservation.before.x, exact);
  assert.equal(result.analysis.preservation.after.x, '900719925474099312345678901234567889');
  assert.equal(result.analysis.preservation.after.n, exact);
  assert.equal(result.analysis.preservation.pass, false);
  assert.equal(result.cost, 1);
  assert.equal(result.dud, true);
});

for (const failedCheck of ['goal', 'specification']) {
  test(`a false ${failedCheck} permits damage and clearing without the verified bonus`, async () => {
    const mock = checker({ [failedCheck === 'goal' ? 5 : 7]: { status: 'sat' } });
    const { result, stages } = await consume(makeOrder(mock).iterator);
    assert.equal(stages.length, 3);
    assert.equal(mock.calls.length, 8);
    assert.equal(result.analysis.valid, true);
    assert.equal(result.analysis[failedCheck].pass, false);
    assert.equal(result.analysis.objectiveVerified, false);
    assert.equal(result.cost, 1);
    assert.equal(result.dud, false);
    assert.ok(result.shots.length > 0);
    assert.equal(result.battle.cleared, true);
    assert.equal(result.battle.scoreMultiplier, 1);
  });
}

test('unknown at any definedness or validity obligation never damages or consumes a command', async () => {
  for (let index = 0; index < 8; index++) {
    const mock = checker({ [index]: { status: 'unknown', reason: 'timeout' } });
    const { battle, iterator } = makeOrder(mock);
    const { result } = await consume(iterator);
    assert.equal(mock.calls.length, index + 1);
    assert.equal(result.battle, battle);
    assert.equal(result.cost, 0);
    assert.equal(result.dud, false);
    assert.equal(result.inconclusive, true);
    assert.equal(result.errorCode, 'smt-unknown');
    assert.equal(result.analysis.objectiveVerified, false);
    assert.deepEqual(result.shots, []);
  }
});

test('undefined expressions, solver errors, and incomplete models cannot become dud or warning shots', async () => {
  const cases = [
    { index: 4, response: { status: 'sat' }, code: 'smt-undefined-expression' },
    { index: 3, response: new Error('worker unavailable'), code: 'smt-unavailable' },
    { index: 5, response: { status: 'sat', values: {} }, code: 'smt-invalid-model' },
  ];
  for (const item of cases) {
    const { iterator, battle } = makeOrder(checker({ [item.index]: item.response }));
    const { result } = await consume(iterator);
    assert.equal(result.errorCode, item.code);
    assert.equal(result.cost, 0);
    assert.equal(result.dud, false);
    assert.equal(result.battle, battle);
    assert.equal(result.analysis.objectiveVerified, false);
    assert.deepEqual(result.shots, []);
  }
});

test('syntax errors remain local to the reached stage and do not consume a command', async () => {
  const mock = checker();
  const { result, stages } = await consume(makeOrder(mock, level.solution, 'x =').iterator);
  assert.deepEqual(stages.map(stage => stage.stage), ['initial', 'preservation', 'goal']);
  assert.equal(mock.calls.length, 4);
  assert.equal(result.analysis.initial.pass, true);
  assert.equal(result.analysis.preservation.pass, true);
  assert.equal(result.analysis.goal.pass, null);
  assert.equal(result.errorStage, 'goal');
  assert.equal(result.cost, 0);
});

test('abort while an SMT request is pending cannot yield a late stage or outcome', async () => {
  const controller = new AbortController();
  let finish;
  const check = () => new Promise(resolve => { finish = resolve; });
  const { iterator, battle } = makeOrder({ check }, level.solution, level.goalSolution, level, { signal: controller.signal });
  const pending = iterator.next();
  await Promise.resolve();
  controller.abort();
  finish({ status: 'unsat' });
  const next = await pending;
  assert.equal(next.done, true);
  assert.equal(next.value.cancelled, true);
  assert.equal(next.value.cost, 0);
  assert.equal(next.value.battle, battle);
});

test('an SMT salvo resolves candidates on every z layer for one command', async () => {
  const mission = SPATIAL_LEVELS[0];
  const { result } = await consume(makeOrder(checker(), mission.solution, mission.goalSolution, mission).iterator);
  assert.equal(result.cost, 1);
  assert.equal(result.battle.cleared, true);
  assert.ok(new Set(result.shots.map(shot => shot.z)).size > 1);
  assert.equal(result.battle.scoreMultiplier, 2);
});

test('exact projections retain the campaign candidate regions without using state windows as proof bounds', () => {
  for (const mission of [...GENERAL_LEVELS, ...SPATIAL_LEVELS]) {
    assert.deepEqual(previewCandidatesSmt(mission.solution, mission), previewCandidatesForLevel(mission.solution, mission), mission.id);
  }
  const large = '900719925474099312345678901234567890';
  const ordinary = previewCandidatesSmt(level.solution, level);
  assert.deepEqual(previewCandidatesSmt(`(${level.solution}) && ${large} + x >= ${large}`, level), ordinary);
});

test('map arithmetic is exact, Euclidean and short-circuiting', () => {
  const evalSource = (source, state = {}) => evaluateSmtExpression(parseSmtExpression(source), state);
  assert.equal(evalSource('90071992547409931234567890 + 1'), 90071992547409931234567891n);
  assert.equal(evalSource('-7 / 3'), -3n);
  assert.equal(evalSource('-7 % 3'), 2n);
  assert.equal(evalSource('-7 / -3'), 3n);
  assert.equal(evalSource('-7 % -3'), 2n);
  assert.equal(evalSource('false && 1 / 0 == 1'), false);
  assert.equal(evalSource('true || 1 % 0 == 0'), true);
  assert.throws(() => evalSource('1 / 0'), { errorCode: 'smt-undefined-expression' });
});
