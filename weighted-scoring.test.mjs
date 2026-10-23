import test from 'node:test';
import assert from 'node:assert/strict';
import { createBattle, order, formatEngineError } from './dist/engine.js';

const mission = (overrides = {}) => ({
  initial: { x: 0, y: 0 },
  guardSource: 'false',
  step: ({ x, y }) => ({ x, y }),
  size: 9,
  commands: 6,
  enemies: [
    { x: 2, y: 0, branch: 'infantry' },
    { x: 3, y: 0, branch: 'armor' },
    { x: 4, y: 0, branch: 'artillery' },
  ],
  allies: [
    { x: 1, y: 0, branch: 'artillery' },
    { x: 1, y: 1, branch: 'infantry' },
    { x: 1, y: 2, branch: 'armor' },
  ],
  ...overrides,
});

test('mixed-branch salvo sums catalog points while retaining kill counts and one-order cost', () => {
  const before = createBattle(mission());
  assert.equal(before.enemyPoints, 0);
  assert.equal(before.friendlyPoints, 0);
  assert.equal(before.score, 6);
  const result = order(before, 'y == 0 && x >= 0 && x <= 4', 'true', 'salvo');
  assert.equal(result.reason, 'fired');
  assert.equal(result.cost, 1);
  assert.deepEqual(result.shots, [
    { x: 0, y: 0, type: 'neutral', points: 0 },
    { x: 1, y: 0, branch: 'artillery', type: 'friendly', points: 6 },
    { x: 2, y: 0, branch: 'infantry', type: 'enemy', points: 2 },
    { x: 3, y: 0, branch: 'armor', type: 'enemy', points: 4 },
    { x: 4, y: 0, branch: 'artillery', type: 'enemy', points: 6 },
  ]);
  assert.equal(result.enemyPoints, 12);
  assert.equal(result.friendlyPoints, 6);
  assert.equal(result.battle.enemyPoints, 12);
  assert.equal(result.battle.friendlyPoints, 6);
  assert.equal(result.battle.enemyKills, 3);
  assert.equal(result.battle.friendlyKills, 1);
  assert.equal(result.battle.remaining, 5);
  assert.equal(result.battle.score, 11);
  assert.equal(result.battle.cleared, true);
  assert.deepEqual(result.battle.hit, result.shots);
  assert.notEqual(result.battle.hit[0], result.shots[0]);
  assert.equal(before.enemyPoints, 0);
  assert.equal(before.friendlyPoints, 0);
  assert.equal(before.hit.length, 0);
});

test('friendly damage subtracts the full branch value and can make the score negative', () => {
  const result = order(createBattle(mission()), 'y == 0 && x >= 0 && x <= 1', 'true', 'salvo');
  assert.equal(result.battle.enemyKills, 0);
  assert.equal(result.battle.friendlyKills, 1);
  assert.equal(result.enemyPoints, 0);
  assert.equal(result.friendlyPoints, 6);
  assert.equal(result.battle.score, -1);
  assert.equal(result.battle.cleared, false);
  assert.deepEqual(result.battle.enemies.map(unit => unit.branch), ['infantry', 'armor', 'artillery']);
});

test('single fire keeps neutral-friendly-enemy and coordinate priority regardless of point value', () => {
  const source = mission({
    enemies: [{ x: 2, y: 0, branch: 'artillery' }, { x: 3, y: 0, branch: 'infantry' }],
    allies: [{ x: 1, y: 0, branch: 'armor' }],
  });
  const invariant = 'y == 0 && x >= 0 && x <= 3';
  let battle = createBattle(source);
  const hits = [];
  for (let index = 0; index < 4; index++) {
    const result = order(battle, invariant, 'true', 'single');
    assert.equal(result.cost, 1);
    hits.push(result.shots[0]);
    battle = result.battle;
  }
  assert.deepEqual(hits.map(({ x, type, points }) => ({ x, type, points })), [
    { x: 0, type: 'neutral', points: 0 },
    { x: 1, type: 'friendly', points: 4 },
    { x: 2, type: 'enemy', points: 6 },
    { x: 3, type: 'enemy', points: 2 },
  ]);
  assert.equal(battle.enemyPoints, 8);
  assert.equal(battle.friendlyPoints, 4);
  assert.equal(battle.score, 6);
});

test('normalization and subsequent orders retain branches without aliasing authored or live units', () => {
  const source = mission();
  const battle = createBattle(source);
  for (const team of ['enemies', 'allies']) {
    assert.deepEqual(battle[team], source[team]);
    assert.deepEqual(battle.level[team], source[team]);
    assert.notEqual(battle[team], source[team]);
    assert.notEqual(battle[team][0], source[team][0]);
    assert.notEqual(battle.level[team][0], source[team][0]);
    assert.notEqual(battle.level[team][0], battle[team][0]);
  }
  source.enemies[0].branch = 'artillery';
  source.enemies[0].x = 8;
  source.allies[0].branch = 'infantry';
  const next = order(battle, 'x == 0 && y == 0', 'true', 'single').battle;
  assert.equal(next.enemies[0].branch, 'infantry');
  assert.equal(next.enemies[0].x, 2);
  assert.equal(next.allies[0].branch, 'artillery');
  assert.notEqual(next.enemies[0], battle.enemies[0]);
  assert.notEqual(next.allies[0], battle.allies[0]);
  assert.equal(next.level.enemies[0].branch, 'infantry');
  assert.equal(next.level.allies[0].branch, 'artillery');
  next.enemies[0].branch = 'armor';
  assert.equal(battle.enemies[0].branch, 'infantry');
  assert.equal(next.level.enemies[0].branch, 'infantry');
});

test('historical typed hits retain their values and cannot award or deduct points again', () => {
  const first = order(createBattle(mission()), 'y == 0 && x >= 0 && x <= 2', 'true', 'salvo');
  assert.equal(first.enemyPoints, 2);
  assert.equal(first.friendlyPoints, 6);
  const again = order(first.battle, 'y == 0 && x >= 0 && x <= 2', 'true', 'salvo');
  assert.equal(again.reason, 'no-candidates');
  assert.equal(again.cost, 0);
  assert.equal(again.enemyPoints, 0);
  assert.equal(again.friendlyPoints, 0);
  assert.equal(again.battle, first.battle);
  const next = order(again.battle, 'y == 0 && x >= 0 && x <= 3', 'true', 'salvo');
  assert.deepEqual(next.shots, [{ x: 3, y: 0, branch: 'armor', type: 'enemy', points: 4 }]);
  assert.equal(next.enemyPoints, 4);
  assert.equal(next.friendlyPoints, 0);
  assert.equal(next.battle.enemyPoints, 6);
  assert.equal(next.battle.friendlyPoints, 6);
  assert.equal(next.battle.score, 4);
  assert.deepEqual(next.battle.hit.slice(0, 3), first.battle.hit);
  assert.notEqual(next.battle.hit[1], first.battle.hit[1]);
  next.shots[0].branch = 'artillery';
  next.shots[0].points = 999;
  assert.equal(next.battle.hit.at(-1).branch, 'armor');
  assert.equal(next.battle.hit.at(-1).points, 4);
});

test('duds and rejected expressions never change point totals', () => {
  const before = createBattle(mission());
  const dud = order(before, 'false', 'true', 'salvo');
  assert.equal(dud.dud, true);
  assert.equal(dud.cost, 1);
  assert.equal(dud.enemyPoints, 0);
  assert.equal(dud.friendlyPoints, 0);
  assert.equal(dud.battle.enemyPoints, 0);
  assert.equal(dud.battle.friendlyPoints, 0);
  assert.equal(dud.battle.score, 5);
  assert.deepEqual(dud.battle.enemies, before.enemies);
  assert.deepEqual(dud.battle.allies, before.allies);
  const rejected = order(dud.battle, 'x.constructor', 'true', 'salvo');
  assert.equal(rejected.cost, 0);
  assert.equal(rejected.enemyPoints, 0);
  assert.equal(rejected.friendlyPoints, 0);
  assert.equal(rejected.battle, dud.battle);
  const preservation = order(createBattle(mission({
    guardSource: 'x < 1', step: ({ x, y }) => ({ x: x + 1, y }),
  })), 'x == 0 && y == 0', 'true', 'single');
  assert.equal(preservation.analysis.preservation.pass, false);
  assert.equal(preservation.dud, true);
  assert.equal(preservation.enemyPoints, 0);
  assert.equal(preservation.friendlyPoints, 0);
  assert.equal(preservation.battle.score, 5);
});

test('unknown branches are rejected with a localized structured error on either side', () => {
  for (const branch of ['cavalry', 'constructor', '__proto__', '', null, 17, {}]) {
    for (const team of ['enemies', 'allies']) {
      let error;
      try {
        createBattle(mission({ [team]: [{ x: 5, y: 5, branch }] }));
      } catch (caught) { error = caught; }
      assert.ok(error instanceof TypeError);
      assert.equal(error.errorCode, 'invalid-unit-branch');
      assert.deepEqual(error.errorParams, { branch: String(branch) });
      assert.match(formatEngineError(error, 'ko'), /미지원 병과/);
      assert.match(formatEngineError(error, 'en'), /Unsupported unit branch/);
      assert.doesNotMatch(formatEngineError(error, 'en'), /[가-힣]/);
    }
  }
});

test('authored points cannot override branch values or the untyped compatibility value', () => {
  const source = mission({
    initial: { x: 2, y: 0 },
    enemies: [{ x: 2, y: 0, branch: 'armor', points: 999 }, { x: 3, y: 0, points: 500 }],
    allies: [{ x: 4, y: 0, branch: 'infantry', points: -99 }],
  });
  const battle = createBattle(source);
  assert.deepEqual(battle.enemies, [{ x: 2, y: 0, branch: 'armor' }, { x: 3, y: 0 }]);
  assert.deepEqual(battle.level.allies, [{ x: 4, y: 0, branch: 'infantry' }]);
  const result = order(battle, 'y == 0 && x >= 2 && x <= 4', 'true', 'salvo');
  assert.deepEqual(result.shots.map(shot => shot.points), [2, 4, 1]);
  assert.equal(result.enemyPoints, 5);
  assert.equal(result.friendlyPoints, 2);
  assert.equal(result.battle.score, 8);
});

test('coordinate-only battles retain one-point gains and losses with zero-point neutral cells', () => {
  const battle = createBattle(mission({
    enemies: [{ x: 2, y: 0 }, { x: 3, y: 0 }],
    allies: [{ x: 1, y: 0 }],
  }));
  const result = order(battle, 'y == 0 && x >= 0 && x <= 3', 'true', 'salvo');
  assert.equal(result.enemyPoints, 2);
  assert.equal(result.friendlyPoints, 1);
  assert.equal(result.battle.enemyKills, 2);
  assert.equal(result.battle.friendlyKills, 1);
  assert.equal(result.battle.score, 6);
  assert.deepEqual(result.shots.map(shot => shot.points), [0, 1, 1, 1]);
  assert.ok(result.shots.every(shot => !Object.hasOwn(shot, 'branch')));
});
