import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOMAIN, INPUT_DOMAIN, analyze, battlefieldCasesForLevel, createBattle, evaluate,
  formatEngineError, initialStatesForLevel, isInitializedLevel, order, parseExpression,
  previewCandidatesForLevel, projectPredicate, traceInputsForLevel, verificationCasesForLevel,
} from './dist/engine.js';

const point = ({ x, y }) => ({ x, y });
const key = ({ x, y }) => `${x},${y}`;
const context = ({ a, b, n, m }) => ({ a, b, n, m });
const solution = 'x >= 0 && y >= 0 && x + y == n + m';
const goal = 'x == 0 && y == n + m';
const mission = (overrides = {}) => ({
  id: 'initialized-fixture',
  initialize: ({ a, b }) => ({ x: Math.abs(a), y: Math.abs(b), n: Math.abs(a), m: Math.abs(b) }),
  battleInputs: [{ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 3, b: 1 }],
  guardSource: 'x > 0',
  step: ({ x, y }) => ({ x: x - 1, y: y + 1 }),
  size: 9,
  commands: 6,
  enemies: [{ x: 0, y: 2 }, { x: 0, y: 3 }, { x: 0, y: 4 }],
  allies: [{ x: 0, y: 1 }, { x: 0, y: 5 }, { x: 1, y: 4 }],
  solution,
  goalSolution: goal,
  ...overrides,
});

test('immutable input names extend the parser allowlist without enabling property access or execution', () => {
  const state = { x: 2, y: 3, a: -2, b: 3, n: 2, m: 3 };
  assert.equal(evaluate(parseExpression('x+y == n+m && a*a == n*n && b == m'), state), true);
  for (const source of ['a = 3', 'a.constructor', 'Math.abs(a)', 'initialize(a)', 'n++', 'q == 0', '__proto__ == 0']) {
    assert.throws(() => parseExpression(source), undefined, source);
  }
  assert.throws(() => evaluate(parseExpression('a == 0'), { x: 0, y: 0 }), /a/);
});

test('all 81 raw inputs remain distinct proof contexts even when initialization yields duplicate coordinates', () => {
  const level = mission();
  const cases = verificationCasesForLevel(level);
  assert.equal(isInitializedLevel(level), true);
  assert.deepEqual(INPUT_DOMAIN, { min: -4, max: 4, stateCount: 81 });
  assert.equal(cases.length, 81);
  assert.equal(new Set(cases.map(state => `${state.a},${state.b}`)).size, 81);
  assert.equal(new Set(cases.map(key)).size, 25);
  assert.deepEqual(cases[0], { x: 4, y: 4, a: -4, b: -4, n: 4, m: 4 });
  assert.deepEqual(cases.at(-1), { x: 4, y: 4, a: 4, b: 4, n: 4, m: 4 });
  assert.deepEqual(initialStatesForLevel(level), cases);
  assert.equal(battlefieldCasesForLevel(level).length, 3);
  assert.deepEqual(battlefieldCasesForLevel(level), traceInputsForLevel(level));
  assert.deepEqual(battlefieldCasesForLevel(level).map(({ a, b }) => ({ a, b })), level.battleInputs);
  cases[0].n = 99;
  assert.equal(verificationCasesForLevel(level)[0].n, 4);
});

test('parametric invariants prove every context while only the three explicit scenarios determine the battlefield', () => {
  const level = mission();
  const result = analyze(solution, goal, level);
  assert.equal(result.error, undefined);
  assert.equal(result.valid, true);
  assert.equal(result.goal.pass, true);
  assert.equal(result.specification.pass, true);
  assert.equal(result.objectiveVerified, true);
  assert.equal(result.initial.checkedCount, 81);
  assert.equal(result.contextCount, 81);
  assert.equal(result.checkedStateCount, 81 * DOMAIN.stateCount);
  assert.equal(result.exitStateCount, 81);
  assert.deepEqual(result.inputWindow, INPUT_DOMAIN);
  assert.deepEqual(result.stateWindow, DOMAIN);
  assert.deepEqual(result.candidates, level.enemies);
  assert.deepEqual(previewCandidatesForLevel(solution, level), level.enemies);
  assert.deepEqual(projectPredicate(goal, level), level.enemies);
  assert.ok(!result.candidates.some(state => key(state) === '0,8'), 'an actual result of an unshown case is not automatically a map target');
  for (const execution of result.traces) {
    assert.equal(execution.traceStatus, 'terminated');
    const expectedContext = context(execution.initial);
    assert.ok(execution.trace.every(state => JSON.stringify(context(state)) === JSON.stringify(expectedContext)));
    assert.deepEqual(point(execution.trace.at(-1)), { x: 0, y: expectedContext.n + expectedContext.m });
  }
});

test('representative scenes cannot narrow initialization checks or conceal negative raw-input counterexamples', () => {
  const level = mission();
  const report = analyze(`(${solution}) && a >= 0`, goal, level);
  assert.equal(report.initial.pass, false);
  assert.equal(report.initial.checkedCount, 81);
  assert.deepEqual(report.initial.before, { x: 4, y: 4, a: -4, b: -4, n: 4, m: 4 });
  assert.equal(report.preservation.pass, true);
  assert.equal(report.goal.pass, true);
  assert.equal(report.objectiveVerified, false);
  assert.ok(report.traces.every(run => run.initial.a >= 0));
  const dud = order(createBattle(level), `(${solution}) && a >= 0`, goal, 'salvo');
  assert.equal(dud.dud, true);
  assert.equal(dud.cost, 1);
  assert.deepEqual(dud.shots, []);
});

test('preservation checks unreachable states in every context and retains complete counterexample parameters', () => {
  const level = mission();
  const source = 'x >= 0 && x <= n && y >= 0 && y <= n + m';
  const result = analyze(source, goal, level);
  assert.equal(result.initial.pass, true);
  assert.equal(result.preservation.pass, false);
  const { before, after, outsideDomain } = result.preservation;
  assert.equal(before.a, -4);
  assert.equal(before.b, -4);
  assert.equal(before.y, 8);
  assert.deepEqual(context(before), { a: -4, b: -4, n: 4, m: 4 });
  assert.deepEqual(context(after), context(before));
  assert.deepEqual(point(after), { x: before.x - 1, y: 9 });
  assert.equal(outsideDomain, false);
  assert.ok(!result.traces.some(run => run.trace.some(state => key(state) === key(before))));
});

test('window boundary successors still fail rather than being clipped, wrapped, or silently omitted', () => {
  const result = analyze('true', 'true', mission());
  assert.equal(result.preservation.pass, false);
  assert.equal(result.preservation.outsideDomain, true);
  assert.equal(result.preservation.before.y, 32);
  assert.equal(result.preservation.after.y, 33);
  assert.deepEqual(context(result.preservation.before), context(result.preservation.after));
});

test('raw inputs and constants cannot be overwritten by initialization or transition return objects', () => {
  const level = mission({
    initialize: ({ a, b }) => ({ x: Math.abs(a), y: Math.abs(b), n: Math.abs(a), m: Math.abs(b), a: 999, b: 999 }),
    step: ({ x, y }) => ({ x: x - 1, y: y + 1, a: 999, b: 999, n: 999, m: 999 }),
  });
  const result = analyze(solution, goal, level);
  assert.equal(result.objectiveVerified, true);
  assert.equal(result.traces[0].initial.a, 1);
  assert.ok(result.traces.every(run => run.trace.every(state => Object.values(context(state)).every(value => value !== 999))));
  const mutation = analyze(solution, goal, mission({
    step: state => { state.n = 999; return { x: state.x - 1, y: state.y + 1 }; },
  }));
  assert.equal(mutation.valid, false);
  assert.equal(mutation.objectiveVerified, false);
  assert.ok(mutation.error);
});

test('a coordinate-union proof and editable true goal cannot bypass the fixed mathematical specification', () => {
  const level = mission();
  const broad = 'x >= 0 && y >= 0 && x + y <= 8';
  const result = analyze(broad, 'true', level);
  assert.equal(result.valid, true);
  assert.equal(result.goal.pass, true);
  assert.equal(result.specification.pass, false);
  assert.equal(result.objectiveVerified, false);
  const witness = result.specification.before;
  assert.equal(witness.x, 0);
  assert.notEqual(witness.y, witness.n + witness.m);
  assert.equal(witness.a, -4);
  assert.equal(witness.b, -4);
  const rejected = order(createBattle(level), broad, 'true', 'salvo');
  assert.equal(rejected.reason, 'invalid-specification');
  assert.equal(rejected.cost, 1);
  assert.equal(rejected.dud, true);
  assert.deepEqual(rejected.shots, []);
  assert.deepEqual(rejected.battle.enemies, level.enemies);
  assert.equal(rejected.battle.cleared, false);
  assert.equal(rejected.battle.finished, false);
  // A persisted battlefield from the previous rule may already be empty.
  // Keep its final mathematical proof free without allowing new unsafe shots.
  const emptied = { ...rejected.battle, enemies: [] };
  const incomplete = order(emptied, broad, 'true', 'single');
  assert.equal(incomplete.reason, 'proof-required');
  assert.equal(incomplete.cost, 0);
  assert.equal(incomplete.battle.remaining, emptied.remaining);
  const completed = order(incomplete.battle, solution, goal, 'single');
  assert.equal(completed.reason, 'proved');
  assert.equal(completed.cost, 0);
  assert.equal(completed.battle.cleared, true);
  assert.equal(completed.battle.finished, true);
  assert.equal(completed.battle.remaining, emptied.remaining);
  assert.equal(completed.battle.score, emptied.score);
  assert.deepEqual(completed.shots, []);
  assert.deepEqual(completed.battle.hit, emptied.hit);
});

test('an existing empty board with no commands still permits its free final proof', () => {
  const level = mission({ commands: 0, enemies: [] });
  const before = createBattle(level);
  assert.equal(before.remaining, 0);
  assert.equal(before.finished, false);
  const failed = order(before, 'false', goal, 'single');
  assert.equal(failed.reason, 'proof-required');
  assert.equal(failed.cost, 0);
  assert.equal(failed.battle.remaining, 0);
  const completed = order(failed.battle, solution, goal, 'salvo');
  assert.equal(completed.reason, 'proved');
  assert.equal(completed.battle.cleared, true);
  assert.equal(completed.battle.remaining, 0);
});

test('an earlier correct proof cannot authorize shots under a later weak invariant', () => {
  const level = mission();
  const first = order(createBattle(level), solution, goal, 'single');
  assert.equal(first.battle.objectiveVerified, true);
  assert.equal(first.battle.cleared, false);
  const last = order(first.battle, 'x >= 0 && y >= 0 && x + y <= 8', 'true', 'salvo');
  assert.equal(last.reason, 'invalid-specification');
  assert.equal(last.dud, true);
  assert.deepEqual(last.shots, []);
  assert.equal(last.battle.objectiveVerified, false);
  assert.deepEqual(last.battle.enemies, first.battle.enemies);
  assert.equal(last.battle.cleared, false);
});

test('battle snapshots own their raw examples and initialized coordinates without exposing mutable aliases', () => {
  const level = mission();
  const battle = createBattle(level);
  assert.notEqual(battle.level.battleInputs, level.battleInputs);
  assert.notEqual(battle.level.battleInputs[0], level.battleInputs[0]);
  assert.equal(Object.hasOwn(battle.level, 'initialStates'), false);
  level.battleInputs[0].a = 4;
  battle.level.initial.n = 99;
  battle.level.traceInputs[0].n = 98;
  assert.equal(battlefieldCasesForLevel(battle.level)[0].a, 1);
  assert.equal(battlefieldCasesForLevel(battle.level)[0].n, 1);
  assert.equal(verificationCasesForLevel(battle.level).length, 81);
  const report = analyze(solution, goal, battle.level);
  assert.equal(report.objectiveVerified, true);
  assert.equal(report.traces[0].initial.n, 1);
});

test('sample, initialization, and mixed-schema errors are structured, localized, and consume no command', () => {
  const cases = [
    ['invalid-initializer', { initialize: null }],
    ['invalid-initialization', { initialize: () => ({ x: 33, y: 0, n: 1, m: 1 }) }],
    ['invalid-initialization', { initialize: () => ({ x: 0, y: 0, n: 0.5, m: 1 }) }],
    ['invalid-initialization', { initialize: () => ({ x: 0, y: 0, n: 1 }) }],
    ['ambiguous-initialization', { initialStates: [{ x: 0, y: 0 }] }],
    ['ambiguous-initialization', { initialCondition: 'true' }],
    ['invalid-battle-inputs', { battleInputs: [] }],
    ['invalid-battle-input', { battleInputs: [{ a: 5, b: 0 }, { a: 1, b: 0 }, { a: 2, b: 0 }] }],
    ['duplicate-battle-input', { battleInputs: [{ a: 1, b: 0 }, { a: 1, b: 0 }, { a: 2, b: 0 }] }],
  ];
  for (const [code, overrides] of cases) {
    const level = mission(overrides);
    const result = analyze(solution, goal, level);
    assert.equal(result.errorCode, code);
    assert.equal(result.valid, false);
    assert.equal(result.objectiveVerified, false);
    assert.deepEqual(result.initial, { pass: null });
    assert.deepEqual(result.specification, { pass: null });
    assert.match(formatEngineError(result, 'ko'), /[가-힣]/);
    assert.doesNotMatch(formatEngineError(result, 'en'), /[가-힣]/);
    assert.throws(() => createBattle(level), error => error.errorCode === code);
  }
  const before = createBattle(mission());
  const result = order(before, 'a.constructor', goal, 'single');
  assert.equal(result.cost, 0);
  assert.equal(result.battle, before);
});

test('projection validates every scenario and deduplicates shared coordinates without evaluating user JavaScript', () => {
  const level = mission({ battleInputs: [{ a: 1, b: 1 }, { a: -1, b: 1 }, { a: 0, b: 2 }] });
  assert.deepEqual(previewCandidatesForLevel(solution, level), [{ x: 0, y: 2 }]);
  assert.deepEqual(projectPredicate(goal, level), [{ x: 0, y: 2 }]);
  assert.throws(() => projectPredicate('x = a', level));
  assert.throws(() => previewCandidatesForLevel('1', level));
  assert.throws(() => projectPredicate('x % (a - 1) == 0', level));
});
