import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOMAIN, analyze, battlefieldCasesForLevel, createBattle, domainsForLevel, evaluate,
  formatEngineError, initialStatesForLevel, order, orderStages, parseExpression,
  previewCandidatesForLevel, projectPredicate, stateKey, statePoint,
  traceInputsForLevel, variablesForLevel, verificationCasesForLevel,
} from './dist/engine.js';

const invariant = 'x >= 0 && x + y == n && z == m';
const goal = 'x == 0 && y == n && z == m';
const xyz = (overrides = {}) => ({
  variables: ['x', 'y', 'z'],
  domains: { x: { min: 0, max: 4 }, y: { min: 0, max: 4 }, z: { min: 0, max: 4 } },
  initialize: ({ a, b }) => ({ x: Math.abs(a), y: 0, z: Math.abs(b), n: Math.abs(a), m: Math.abs(b) }),
  battleInputs: [{ a: 1, b: 0 }, { a: 1, b: 1 }, { a: 1, b: 2 }],
  guardSource: 'x > 0',
  step: ({ x, y, z }) => ({ x: x - 1, y: y + 1, z }),
  size: 9, commands: 6,
  enemies: [{ x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 1 }, { x: 0, y: 1, z: 2 }],
  allies: [{ x: 0, y: 1, z: 3 }],
  goalSolution: goal,
  ...overrides,
});
const legacy = (overrides = {}) => ({
  initial: { x: 0, y: 0 }, guardSource: 'x < 1',
  step: ({ x, y }) => ({ x: x + 1, y }),
  size: 9, commands: 6, enemies: [{ x: 1, y: 0 }], allies: [], ...overrides,
});

test('coordinate and domain helpers preserve 2D identity while separating layers', () => {
  assert.deepEqual(variablesForLevel({}), ['x', 'y']);
  assert.deepEqual(domainsForLevel({}), { x: { min: -32, max: 32 }, y: { min: -32, max: 32 } });
  assert.deepEqual(variablesForLevel(xyz()), ['x', 'y', 'z']);
  assert.equal(stateKey({ x: 1, y: 2 }), '1,2');
  assert.equal(stateKey({ x: 1, y: 2, z: 0 }), '1,2,0');
  assert.equal(stateKey({ x: 1, y: 2, z: 1 }), '1,2,1');
  assert.deepEqual(statePoint({ x: 1, y: 2, z: -1, a: 99, branch: 'armor' }), { x: 1, y: 2, z: -1 });
  const level = xyz();
  const domains = domainsForLevel(level);
  domains.z.max = 99;
  assert.equal(level.domains.z.max, 4);
});

test('z expressions remain typed and do not silently supply z to a 2D state', () => {
  assert.equal(evaluate(parseExpression('x + y + z == 6 && z % 2 == 1'), { x: 1, y: 2, z: 3 }), true);
  assert.throws(() => parseExpression('z && true'), error => error.errorCode === 'operand-type');
  const result = order(createBattle(legacy()), 'z == 0', 'true');
  assert.equal(result.errorCode, 'integer-range');
  assert.equal(result.errorParams.label, 'z');
  assert.equal(result.errorStage, 'initial');
  assert.equal(result.cost, 0);
  assert.deepEqual(result.shots, []);
});

test('all 81 input contexts and every xyz state are checked; traces preserve z and constants', () => {
  const level = xyz();
  const inputs = verificationCasesForLevel(level);
  assert.equal(inputs.length, 81);
  assert.deepEqual(inputs[0], { x: 4, y: 0, z: 4, a: -4, b: -4, n: 4, m: 4 });
  assert.deepEqual(battlefieldCasesForLevel(level).map(statePoint), [
    { x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }, { x: 1, y: 0, z: 2 },
  ]);
  const report = analyze(invariant, goal, level);
  assert.equal(report.error, undefined);
  assert.equal(report.objectiveVerified, true);
  assert.equal(report.initial.checkedCount, 81);
  assert.equal(report.checkedStateCount, 81 * 125);
  assert.equal(report.exitStateCount, 81);
  assert.deepEqual(report.stateWindow, { variables: ['x', 'y', 'z'], domains: level.domains, stateCount: 125 });
  assert.deepEqual(report.candidates, level.enemies);
  assert.deepEqual(previewCandidatesForLevel(invariant, level), level.enemies);
  assert.deepEqual(projectPredicate(goal, level), level.enemies);
  assert.equal(report.traces.length, 3);
  for (const run of report.traces) {
    assert.equal(run.traceStatus, 'terminated');
    assert.equal(run.trace.length, 2);
    for (const state of run.trace) {
      assert.equal(state.z, run.initial.m);
      for (const name of ['a', 'b', 'n', 'm']) assert.equal(state[name], run.initial[name]);
    }
  }
});

test('a non-battlefield z input can disprove initialization', () => {
  const result = order(createBattle(xyz()), `(${invariant}) && z < 4`, goal, 'salvo');
  assert.equal(result.analysis.initial.pass, false);
  assert.equal(result.analysis.initial.before.z, 4);
  assert.equal(result.analysis.initial.before.b, -4);
  assert.equal(result.analysis.preservation.skipped, true);
  assert.equal(result.cost, 1);
  assert.equal(result.dud, true);
});

test('off-layer unreachable preservation witnesses include z and never truncate successors', () => {
  const level = legacy({
    variables: ['x', 'y', 'z'],
    domains: { x: { min: 0, max: 1 }, y: { min: 0, max: 0 }, z: { min: 0, max: 2 } },
    initial: { x: 0, y: 0, z: 0 }, enemies: [{ x: 1, y: 0, z: 0 }],
    step: ({ x, y, z }) => ({ x: x + 1, y, z: z === 2 ? z + 1 : z }),
  });
  const report = analyze('true', 'true', level);
  assert.equal(report.initial.pass, true);
  assert.equal(report.traceStatus, 'terminated');
  assert.equal(report.preservation.pass, false);
  assert.deepEqual(report.preservation.before, { x: 0, y: 0, z: 2 });
  assert.deepEqual(report.preservation.after, { x: 1, y: 0, z: 3 });
  assert.equal(report.preservation.outsideDomain, true);
  const result = order(createBattle(level), 'true', 'true', 'salvo');
  assert.equal(result.dud, true);
  assert.deepEqual(result.shots, []);
});

test('exit failures on other layers retain complete candidates and allow friendly damage', () => {
  const level = xyz();
  const coarse = 'x >= 0 && x + y == n && z >= 0 && z <= m + 1';
  const battle = createBattle(level);
  const single = order(battle, coarse, goal, 'single');
  assert.equal(single.analysis.valid, true);
  assert.equal(single.analysis.goal.pass, false);
  assert.equal(single.analysis.specification.pass, false);
  assert.ok(Number.isInteger(single.analysis.goal.before.z));
  assert.equal(single.cost, 1);
  assert.equal(single.shots[0].type, 'friendly');
  assert.equal(single.shots[0].z, 3);
  assert.equal(single.battle.enemyKills, 0);
  const salvo = order(battle, coarse, goal, 'salvo');
  assert.equal(salvo.cost, 1);
  assert.equal(salvo.shots.length, 4);
  assert.equal(salvo.battle.friendlyKills, 1);
  assert.equal(salvo.battle.enemyKills, 3);
  assert.equal(salvo.battle.scoreMultiplier, 1);
  assert.equal(salvo.battle.finished, true);
});

test('all-layer salvo costs one order and equal xy targets remain distinct', () => {
  const level = xyz();
  const battle = createBattle(level);
  const stages = orderStages(battle, invariant, goal, 'salvo');
  for (const stage of ['initial', 'preservation', 'goal']) {
    const next = stages.next();
    assert.equal(next.done, false);
    assert.equal(next.value.stage, stage);
    assert.equal(next.value.analysis[stage].pass, true);
    assert.equal(battle.remaining, 6);
    assert.equal(battle.enemies.length, 3);
  }
  const result = stages.next().value;
  assert.equal(result.cost, 1);
  assert.equal(result.battle.remaining, 5);
  assert.deepEqual(result.shots.map(statePoint), level.enemies);
  assert.deepEqual(result.battle.hit.map(stateKey), ['0,1,0', '0,1,1', '0,1,2']);
  assert.equal(result.battle.enemyKills, 3);
  assert.equal(result.battle.scoreMultiplier, 2);
  assert.equal(result.battle.score, 16);
  assert.equal(order(result.battle, invariant, goal).reason, 'finished');
});

test('single shots exclude only the previously hit xyz coordinate', () => {
  let battle = createBattle(xyz());
  for (const z of [0, 1, 2]) {
    const result = order(battle, invariant, goal);
    assert.equal(result.cost, 1);
    assert.equal(result.shots.length, 1);
    assert.equal(result.shots[0].z, z);
    assert.equal(result.battle.enemyKills, z + 1);
    battle = result.battle;
  }
  assert.equal(battle.cleared, true);
  assert.equal(battle.remaining, 3);
});

test('z-only progress is not mistaken for a repeated state', () => {
  const level = legacy({
    variables: ['x', 'y', 'z'],
    domains: { x: { min: 0, max: 0 }, y: { min: 0, max: 0 }, z: { min: 0, max: 2 } },
    initial: { x: 0, y: 0, z: 0 }, guardSource: 'z < 2',
    step: ({ x, y, z }) => ({ x, y, z: z + 1 }), enemies: [{ x: 0, y: 0, z: 2 }],
  });
  const report = analyze('true', 'z == 2', level);
  assert.equal(report.objectiveVerified, true);
  assert.equal(report.traceStatus, 'terminated');
  assert.deepEqual(report.trace.map(state => state.z), [0, 1, 2]);
});

test('3D preconditions enumerate the full window but only representative traces', () => {
  const level = legacy({
    variables: ['x', 'y', 'z'],
    domains: { x: { min: -1, max: 0 }, y: { min: 0, max: 1 }, z: { min: -1, max: 1 } },
    initialCondition: 'true', traceInputs: [{ x: 0, y: 0, z: -1 }], guardSource: 'false',
    enemies: [{ x: 0, y: 0, z: 0 }],
  });
  assert.equal(initialStatesForLevel(level).length, 12);
  assert.deepEqual(traceInputsForLevel(level), level.traceInputs);
  const report = analyze('true', 'true', level);
  assert.equal(report.initial.checkedCount, 12);
  assert.equal(report.checkedStateCount, 12);
  assert.equal(report.traces.length, 1);
  assert.equal(report.candidates.length, 6);
  assert.deepEqual(previewCandidatesForLevel('true', level), report.candidates);
  assert.ok(report.candidates.every(state => state.x === 0));
  assert.deepEqual([...new Set(report.candidates.map(state => state.z))], [-1, 0, 1]);
});

test('configuration, initial states, deployment and dimensions are validated', () => {
  for (const variables of [[], ['x'], ['y', 'x'], ['x', 'y', 'y'], ['x', 'y', 'z', 'w']]) {
    assert.throws(() => variablesForLevel({ variables }), error => error.errorCode === 'invalid-variables');
  }
  for (const domains of [{ z: { min: 0, max: 1 } }, { x: null }, { x: { min: 2, max: 1 } }, { x: { min: 0, max: Infinity } }]) {
    assert.throws(() => domainsForLevel({ domains }), error => error.errorCode === 'invalid-domains');
  }
  assert.throws(() => createBattle(xyz({ initialize: () => ({ x: 0, y: 0, n: 0, m: 0 }) })), error => error.errorCode === 'invalid-initialization');
  assert.throws(() => createBattle(xyz({ enemies: [{ x: 0, y: 0 }] })), error => error.errorCode === 'offboard-unit');
  assert.throws(() => createBattle(xyz({ enemies: [{ x: 0, y: 0, z: 5 }] })), error => error.errorCode === 'offboard-unit');
  assert.throws(() => createBattle(xyz({ enemies: [{ x: 0, y: 1, z: 3 }] })), error => error.errorCode === 'duplicate-unit');
  const level = xyz();
  const battle = createBattle(level);
  level.variables.pop();
  level.domains.z.max = 0;
  assert.deepEqual(battle.level.variables, ['x', 'y', 'z']);
  assert.equal(battle.level.domains.z.max, 4);
  assert.equal(order(battle, invariant, goal, 'salvo').shots.length, 3);
});

test('legacy finite initial inputs preserve layers and localize duplicate xyz diagnostics', () => {
  const level = legacy({
    variables: ['x', 'y', 'z'],
    domains: { x: { min: 0, max: 1 }, y: { min: 0, max: 0 }, z: { min: 0, max: 1 } },
    initialStates: [{ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }],
    step: ({ x, y, z }) => ({ x: x + 1, y, z }),
    enemies: [{ x: 1, y: 0, z: 0 }, { x: 1, y: 0, z: 1 }],
  });
  const result = order(createBattle(level), 'true', 'x == 1', 'salvo');
  assert.equal(result.analysis.initial.checkedCount, 2);
  assert.equal(result.shots.length, 2);
  assert.deepEqual(result.battle.level.initialStates, level.initialStates);
  assert.throws(() => initialStatesForLevel({ ...level, initialStates: [level.initialStates[1], level.initialStates[1]] }), error => {
    assert.equal(error.errorCode, 'duplicate-initial-state');
    assert.match(formatEngineError(error, 'en'), /\(0, 0, 1\)/);
    assert.match(formatEngineError(error, 'ko'), /\(0, 0, 1\)/);
    return true;
  });
});

test('2D results and score remain compatible with the default 4225-state window', () => {
  const level = legacy();
  const report = analyze('x >= 0 && x <= 1 && y == 0', 'x == 1 && y == 0', level);
  assert.equal(report.checkedStateCount, DOMAIN.stateCount);
  assert.deepEqual(report.candidates, [{ x: 1, y: 0 }]);
  assert.deepEqual(report.trace, [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  const result = order(createBattle(level), 'x >= 0 && x <= 1 && y == 0', 'x == 1 && y == 0', 'salvo');
  assert.equal(result.battle.score, 12);
  assert.ok(!Object.hasOwn(result.shots[0], 'z'));
});
