import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, createBattle, order, orderStages } from './dist/engine.js';

const invariant = 'x >= 0 && x <= 2 && y == 0';
const goal = 'x == 2 && y == 0';
const fixture = (overrides = {}) => ({
  initial: { x: 0, y: 0 }, size: 9, commands: 6,
  guardSource: 'x < 2', step: ({ x, y }) => ({ x: x + 1, y }),
  enemies: [{ x: 2, y: 0 }], allies: [{ x: 2, y: 1 }],
  ...overrides,
});
const skipped = { pass: null, skipped: true };

function nextStage(iterator, expected) {
  const next = iterator.next();
  assert.equal(next.done, false);
  assert.equal(next.value.stage, expected);
  return next.value.analysis;
}

test('each next performs exactly one stage, with immutable snapshots and one final charge', () => {
  let transitions = 0;
  const battle = createBattle(fixture({ step: ({ x, y }) => { transitions++; return { x: x + 1, y }; } }));
  const before = structuredClone({ remaining: battle.remaining, enemies: battle.enemies, hit: battle.hit });
  const iterator = orderStages(battle, invariant, goal, 'salvo');
  assert.equal(transitions, 0, 'creating the iterator must not check anything');
  const initial = nextStage(iterator, 'initial');
  assert.equal(initial.initial.pass, true);
  assert.deepEqual(initial.preservation, skipped);
  assert.deepEqual(initial.goal, skipped);
  assert.equal(transitions, 0, 'initialization must not execute the transition or traces');
  const preservation = nextStage(iterator, 'preservation');
  assert.equal(preservation.initial.pass, true);
  assert.equal(preservation.preservation.pass, true);
  assert.deepEqual(preservation.goal, skipped);
  const afterPreservation = transitions;
  assert.ok(afterPreservation > 0);
  initial.initial.pass = false;
  preservation.preservation.pass = false;
  const terminal = nextStage(iterator, 'goal');
  assert.equal(terminal.initial.pass, true);
  assert.equal(terminal.preservation.pass, true);
  assert.equal(terminal.goal.pass, true);
  assert.equal(transitions, afterPreservation, 'goal checking must not run transitions again');
  assert.deepEqual({ remaining: battle.remaining, enemies: battle.enemies, hit: battle.hit }, before);
  const final = iterator.next();
  assert.equal(final.done, true);
  assert.equal(final.value.reason, 'fired');
  assert.equal(final.value.cost, 1);
  assert.equal(final.value.battle.remaining, 5);
  assert.equal(final.value.shots.length, 1);
  assert.equal(transitions, afterPreservation, 'resolving the order must not repeat verification');
  assert.deepEqual(iterator.next(), { done: true, value: undefined });
  assert.equal(final.value.battle.remaining, 5);
  assert.equal(battle.remaining, 6);
});

test('initial failure stops before a throwing future transition or malformed goal', () => {
  let transitions = 0;
  const battle = createBattle(fixture({ step: () => { transitions++; throw new Error('must not run'); } }));
  const iterator = orderStages(battle, 'false', 'x =', 'salvo');
  const initial = nextStage(iterator, 'initial');
  assert.equal(initial.initial.pass, false);
  assert.deepEqual(initial.preservation, skipped);
  assert.deepEqual(initial.goal, skipped);
  const final = iterator.next();
  assert.equal(final.done, true);
  assert.equal(final.value.reason, 'invalid-invariant');
  assert.equal(final.value.error, undefined);
  assert.equal(final.value.cost, 1);
  assert.equal(transitions, 0);
  assert.deepEqual(final.value.shots, []);
});

test('preservation stops at its first failure without later transitions or goal evaluation', () => {
  let transitions = 0;
  const battle = createBattle(fixture({ step: ({ x, y }) => {
    if (++transitions > 1) throw new Error('later transition must not run');
    return { x: x + 1, y };
  } }));
  const iterator = orderStages(battle, 'x == 0 && y == 0', 'x % 0 == 0');
  nextStage(iterator, 'initial');
  const preservation = nextStage(iterator, 'preservation');
  assert.equal(preservation.preservation.pass, false);
  assert.deepEqual(preservation.goal, skipped);
  assert.equal(transitions, 1);
  const final = iterator.next();
  assert.equal(final.done, true);
  assert.equal(final.value.cost, 1);
  assert.equal(final.value.error, undefined);
  assert.deepEqual(final.value.shots, []);
  assert.equal(transitions, 1);
});

test('false ensures remains a warning while shots and one command charge follow all three stages', () => {
  const battle = createBattle(fixture());
  const iterator = orderStages(battle, invariant, 'false', 'salvo');
  nextStage(iterator, 'initial');
  nextStage(iterator, 'preservation');
  const terminal = nextStage(iterator, 'goal');
  assert.equal(terminal.valid, true);
  assert.equal(terminal.goal.pass, false);
  const final = iterator.next();
  assert.equal(final.done, true);
  assert.equal(final.value.reason, 'fired');
  assert.equal(final.value.dud, false);
  assert.equal(final.value.cost, 1);
  assert.deepEqual(final.value.shots, [{ x: 2, y: 0, type: 'enemy', points: 1 }]);
  assert.equal(final.value.battle.enemies.length, 0);
  assert.deepEqual(final.value.battle.allies, battle.allies);
  assert.equal(final.value.battle.hit.length, 1);
  assert.equal(final.value.battle.cleared, true);
  assert.equal(final.value.battle.scoreMultiplier, 1);
  assert.equal(battle.hit.length, 0);
});

test('an unproved salvo has greater enemy return and friendly exposure than one shot for the same command cost', () => {
  const battle = createBattle(fixture({
    guardSource: 'false',
    enemies: [{ x: 2, y: 0, branch: 'infantry' }, { x: 3, y: 0, branch: 'armor' }, { x: 4, y: 0, branch: 'artillery' }],
    allies: [{ x: 0, y: 0, branch: 'infantry' }, { x: 1, y: 0, branch: 'armor' }],
  }));
  const source = 'x >= 0 && x <= 4 && y == 0';
  const single = order(battle, source, 'x >= 2', 'single');
  const salvo = order(battle, source, 'x >= 2', 'salvo');
  for (const result of [single, salvo]) {
    assert.equal(result.reason, 'fired');
    assert.equal(result.analysis.goal.pass, false);
    assert.equal(result.analysis.exitStateCount, 5);
    assert.equal(result.analysis.candidates.length, 5, 'goal witnesses do not truncate the firing region');
    assert.equal(result.dud, false);
    assert.equal(result.cost, 1);
    assert.equal(result.battle.remaining, 5);
  }
  assert.deepEqual(single.shots, [{ x: 0, y: 0, branch: 'infantry', type: 'friendly', points: 2 }]);
  assert.equal(single.enemyPoints, 0);
  assert.equal(single.friendlyPoints, 2);
  assert.equal(single.battle.score, 3);
  assert.equal(salvo.enemyPoints, 12);
  assert.equal(salvo.friendlyPoints, 6);
  assert.equal(salvo.battle.score, 11);
  assert.deepEqual(salvo.shots.map(shot => [shot.x, shot.type]), [[0, 'friendly'], [1, 'friendly'], [2, 'enemy'], [3, 'enemy'], [4, 'enemy']]);
  assert.equal(battle.remaining, 6);
  assert.deepEqual(battle.hit, []);
});

test('a false exit witness cannot hide a later arithmetic error or authorize partial shots', () => {
  const battle = createBattle(fixture({ guardSource: 'false' }));
  const result = order(battle, invariant, 'x != 0 && 1 % (x - 1) == 0', 'salvo');
  assert.equal(result.analysis.initial.pass, true);
  assert.equal(result.analysis.preservation.pass, true);
  assert.equal(result.errorCode, 'zero-remainder-divisor');
  assert.equal(result.errorStage, 'goal');
  assert.equal(result.errorCheck, 'goal');
  assert.equal(result.analysis.goal.pass, null);
  assert.equal(result.cost, 0);
  assert.equal(result.battle, battle);
  assert.deepEqual(result.shots, []);
});

test('goal errors preserve completed flags, identify their stage, and remain free', () => {
  for (const badGoal of ['x = 2', 'x % 0 == 0']) {
    const battle = createBattle(fixture());
    const iterator = orderStages(battle, invariant, badGoal);
    nextStage(iterator, 'initial');
    nextStage(iterator, 'preservation');
    const terminal = nextStage(iterator, 'goal');
    assert.equal(terminal.initial.pass, true);
    assert.equal(terminal.preservation.pass, true);
    assert.equal(terminal.goal.pass, null);
    assert.equal(terminal.errorStage, 'goal');
    const final = iterator.next();
    assert.equal(final.done, true);
    assert.equal(final.value.errorStage, 'goal');
    assert.equal(final.value.errorCheck, 'goal');
    assert.equal(final.value.cost, 0);
    assert.equal(final.value.battle, battle);
    assert.deepEqual(final.value.shots, []);
  }
});

test('initial and preservation errors yield only the reached stages and never charge', () => {
  const scenarios = [
    { source: 'x.constructor', level: fixture(), stages: ['initial'], check: 'initial' },
    { source: 'x % 0 == 0', level: fixture(), stages: ['initial'], check: 'initial' },
    { source: invariant, level: fixture({ step: () => { throw new Error('transition failed'); } }), stages: ['initial', 'preservation'], check: 'preservation' },
  ];
  for (const scenario of scenarios) {
    const battle = createBattle(scenario.level);
    const iterator = orderStages(battle, scenario.source, goal);
    let report;
    for (const stage of scenario.stages) report = nextStage(iterator, stage);
    assert.equal(report.errorStage, scenario.check);
    assert.deepEqual(report.goal, skipped);
    const final = iterator.next();
    assert.equal(final.done, true);
    assert.equal(final.value.cost, 0);
    assert.equal(final.value.battle, battle);
    assert.equal(final.value.errorStage, scenario.check);
  }
});

test('fixed-specification failure permits completion but withholds the score multiplier', () => {
  const battle = createBattle(fixture({
    initialize: ({ a, b }) => ({ x: 0, y: 0, n: Math.abs(a), m: Math.abs(b) }),
    battleInputs: [{ a: 0, b: 0 }, { a: 1, b: 0 }, { a: 2, b: 0 }],
    goalSolution: 'false',
  }));
  let specificationReads = 0;
  Object.defineProperty(battle.level, 'goalSolution', { get() { specificationReads++; return 'false'; } });
  const iterator = orderStages(battle, invariant, 'true', 'salvo');
  nextStage(iterator, 'initial');
  nextStage(iterator, 'preservation');
  assert.equal(specificationReads, 0);
  const terminal = nextStage(iterator, 'goal');
  assert.equal(terminal.goal.pass, true);
  assert.equal(terminal.specification.pass, false);
  assert.equal(terminal.objectiveVerified, false);
  assert.equal(specificationReads, 1);
  const final = iterator.next();
  assert.equal(final.value.reason, 'fired');
  assert.equal(final.value.cost, 1);
  assert.equal(final.value.shots.length, 1);
  assert.equal(final.value.battle.enemies.length, 0);
  assert.equal(final.value.battle.cleared, true);
  assert.equal(final.value.battle.finished, true);
  assert.equal(final.value.battle.scoreMultiplier, 1);

  const bothFalse = order(battle, invariant, 'false', 'salvo');
  assert.equal(bothFalse.reason, 'fired');
  assert.equal(bothFalse.analysis.goal.pass, false);
  assert.equal(bothFalse.analysis.specification.pass, false);
  assert.equal(bothFalse.analysis.objectiveVerified, false);
  assert.equal(specificationReads, 2, 'a false editable goal must not skip the fixed specification');

  Object.defineProperty(battle.level, 'goalSolution', { get() { throw new Error('specification unavailable'); } });
  const failedSpecification = order(battle, invariant, 'true', 'salvo');
  assert.equal(failedSpecification.cost, 0);
  assert.equal(failedSpecification.battle, battle);
  assert.equal(failedSpecification.errorStage, 'goal');
  assert.equal(failedSpecification.errorCheck, 'specification');
  assert.equal(failedSpecification.analysis.goal.pass, true);
  assert.equal(failedSpecification.analysis.specification.pass, null);
  assert.deepEqual(failedSpecification.shots, []);
});

test('fixed-specification enumeration continues after false goals and false specification witnesses', () => {
  const battle = createBattle(fixture({
    initialize: ({ a, b }) => ({ x: 0, y: 0, n: Math.abs(a), m: Math.abs(b) }),
    battleInputs: [{ a: 0, b: 0 }, { a: 1, b: 0 }, { a: 2, b: 0 }],
    guardSource: 'false',
    goalSolution: 'x != 0 && 1 % (x - 1) == 0',
  }));
  const result = order(battle, invariant, 'false', 'salvo');
  assert.equal(result.analysis.goal.pass, false);
  assert.equal(result.analysis.specification.pass, null);
  assert.equal(result.analysis.candidates.length, 3);
  assert.equal(result.errorCode, 'zero-remainder-divisor');
  assert.equal(result.errorStage, 'goal');
  assert.equal(result.errorCheck, 'specification');
  assert.equal(result.cost, 0);
  assert.equal(result.battle, battle);
  assert.deepEqual(result.shots, []);
});

test('order drains the same staged operation while analyze retains independent full checks', () => {
  const battle = createBattle(fixture());
  for (const source of [invariant, 'false', 'x == 0 && y == 0']) {
    const iterator = orderStages(battle, source, goal, 'salvo');
    let final = iterator.next();
    while (!final.done) final = iterator.next();
    assert.deepEqual(order(battle, source, goal, 'salvo'), final.value);
  }
  const report = analyze('false', 'false', battle.level);
  assert.equal(report.initial.pass, false);
  assert.equal(report.preservation.pass, true);
  assert.equal(report.goal.pass, true);
});

test('invalid modes and finished battles return before any stage or transition', () => {
  const battle = createBattle(fixture({ step: () => { throw new Error('must not run'); } }));
  for (const [input, mode, reason] of [[battle, 'invalid', 'invalid-mode'], [{ ...battle, finished: true }, 'single', 'finished']]) {
    const result = orderStages(input, invariant, goal, mode).next();
    assert.equal(result.done, true);
    assert.equal(result.value.reason, reason);
    assert.equal(result.value.cost, 0);
    assert.equal(result.value.analysis, null);
  }
});
