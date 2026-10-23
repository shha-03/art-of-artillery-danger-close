import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createBattle } from './dist/engine.js';
import { GENERAL_LEVELS } from './dist/levels-general.js';
import { orderStagesSmt } from './dist/smt-engine.js';
import { checkSmt, shutdownZ3 } from './dist/z3-checker.js';

after(async () => shutdownZ3());
const level = GENERAL_LEVELS[0];
async function order(invariant = level.solution, goal = level.goalSolution) {
  const battle = createBattle(level);
  const iterator = orderStagesSmt(battle, invariant, goal, 'salvo', { check: checkSmt });
  const stages = [];
  while (true) {
    const next = await iterator.next();
    if (next.done) return { result: next.value, stages, battle };
    stages.push(next.value.stage);
  }
}

test('actual Z3 proves initialization, preservation and exit, then awards verified salvo completion', async () => {
  const { result, stages } = await order();
  assert.deepEqual(stages, ['initial', 'preservation', 'goal']);
  assert.equal(result.error, undefined);
  assert.equal(result.analysis.objectiveVerified, true);
  assert.equal(result.battle.cleared, true);
  assert.equal(result.battle.scoreMultiplier, 2);
  assert.equal(result.cost, 1);
});

test('actual Z3 finds a false initialization outside the retired input window', async () => {
  const { result, stages } = await order(`${level.solution} && n <= 4`);
  assert.deepEqual(stages, ['initial']);
  assert.equal(result.analysis.initial.pass, false);
  assert.ok(BigInt(result.analysis.initial.before.n) > 4n);
  assert.equal(result.dud, true);
  assert.equal(result.cost, 1);
});

test('actual Z3 finds a preservation violation outside the retired state window', async () => {
  const { result, stages } = await order(`${level.solution} && y != 100`);
  assert.deepEqual(stages, ['initial', 'preservation']);
  assert.equal(result.analysis.initial.pass, true);
  assert.equal(result.analysis.preservation.pass, false);
  assert.equal(result.analysis.preservation.before.y, '99');
  assert.equal(result.analysis.preservation.after.y, '100');
  assert.equal(result.dud, true);
  assert.equal(result.cost, 1);
});

test('actual Z3 rejects a bounded exit guarantee but still permits an unverified final salvo', async () => {
  const { result, stages } = await order(level.solution, `${level.goalSolution} && n <= 32`);
  assert.deepEqual(stages, ['initial', 'preservation', 'goal']);
  assert.equal(result.analysis.goal.pass, false);
  assert.ok(BigInt(result.analysis.goal.before.n) > 32n);
  assert.equal(result.analysis.specification.pass, true);
  assert.equal(result.battle.cleared, true);
  assert.equal(result.battle.scoreMultiplier, 1);
  assert.equal(result.cost, 1);
});

test('actual Z3 reports an unbounded exact counterexample without Number rounding', async () => {
  const exact = '900719925474099312345678901234567890';
  const { result } = await order(`n != ${exact}`);
  assert.equal(result.analysis.initial.pass, false);
  assert.equal(result.analysis.initial.before.n, exact);
  assert.equal(result.dud, true);
});

test('actual Z3 and the map projection both accept integer literals beyond Number precision', async () => {
  const exact = '900719925474099312345678901234567890';
  const { result } = await order(`${level.solution} && ${exact} + 1 > ${exact}`);
  assert.equal(result.error, undefined);
  assert.equal(result.analysis.objectiveVerified, true);
  assert.equal(result.battle.cleared, true);
  assert.equal(result.battle.scoreMultiplier, 2);
});

test('actual Z3 detects undefined exit arithmetic for distant inputs and leaves the battle untouched', async () => {
  const { result, battle } = await order(level.solution, '1 / (n - 100) == 0');
  assert.equal(result.analysis.initial.pass, true);
  assert.equal(result.analysis.preservation.pass, true);
  assert.equal(result.analysis.goal.pass, null);
  assert.equal(result.errorCode, 'smt-undefined-expression');
  assert.equal(result.analysis.goal.before.n, '100');
  assert.equal(result.cost, 0);
  assert.equal(result.battle, battle);
  assert.deepEqual(result.shots, []);
});
