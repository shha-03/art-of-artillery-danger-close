import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DOMAIN, parseExpression, evaluate, analyze, createBattle, order, formatEngineError,
  initialStatesForLevel, traceInputsForLevel, isInitializedLevel, INPUT_DOMAIN,
} from './dist/engine.js';
import { unitPoints } from './dist/unit-types.js';

// Retain a source check against dynamic execution while importing real modules.
const engineSource = await readFile(new URL('./dist/engine.js', import.meta.url), 'utf8');
const getInitialStates = initialStatesForLevel;
const getTraceInputs = traceInputsForLevel;
const coordinates = (units) => units.map(({ x, y }) => ({ x, y })).sort((a, b) => a.x - b.x || a.y - b.y);

const evalAt = (source, state = { x: 2, y: 3 }) => evaluate(parseExpression(source), state);
const level = (overrides = {}) => ({
  initial: { x: 0, y: 0 },
  guardSource: 'x < 2',
  step: ({ x, y }) => ({ x: x + 1, y }),
  size: 9,
  commands: 6,
  enemies: [{ x: 2, y: 0 }, { x: 3, y: 0 }],
  allies: [{ x: 2, y: 1 }],
  ...overrides,
});

test('parser implements integer arithmetic, precedence, unary operations and Boolean expressions', () => {
  assert.equal(evalAt('x*y + 2 * (y - x)'), 8);
  assert.equal(evalAt('x*y == 6 && !(x >= y) || false'), true);
  assert.equal(evalAt('-x * +y % 4'), -2);
  assert.equal(evalAt('x != y && x <= 2 && y > 1'), true);
  assert.equal(evalAt('(true == !false) && true'), true);
  assert.equal(evalAt('y == 0 || x % y == 0', { x: 3, y: 0 }), true);
});

test('parser rejects execution, assignments, coercion, invalid syntax and excessive nesting', () => {
  for (const source of [
    '', 'globalThis.alert(1)', 'x = 3', 'x.constructor', 'Function("return 1")()',
    'x & y', 'x / y', 'x +', '(x == 0', 'x < y < 3', 'x == true', 'x && true', '!x',
    '1.5 == x', 'true + false', `${'('.repeat(150)}true${')'.repeat(150)}`,
  ]) assert.throws(() => parseExpression(source), undefined, source);
  assert.doesNotMatch(engineSource, /\b(?:eval|Function)\s*\(/);
});

test('unsafe literals, intermediate overflow, noninteger inputs and zero remainder are rejected', () => {
  assert.throws(() => parseExpression('9007199254740992'));
  assert.throws(() => evalAt('9007199254740991 + 1'));
  assert.throws(() => evalAt('x * 9007199254740991'));
  assert.throws(() => evalAt('x', { x: 0.5, y: 0 }));
  assert.throws(() => evalAt('x % 0'));
});

test('all 4225 states are checked and a sufficient invariant proves the exit', () => {
  const result = analyze('x >= 0 && x <= 2 && y == 0', 'x == 2 && y == 0', level());
  assert.equal(result.valid, true);
  assert.equal(result.initial.pass, true);
  assert.equal(result.preservation.pass, true);
  assert.equal(result.goal.pass, true);
  assert.equal(result.checkedStateCount, DOMAIN.stateCount);
  assert.deepEqual(result.candidates, [{ x: 2, y: 0 }]);
  assert.deepEqual(result.trace, [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }]);
  assert.equal(result.traceStatus, 'terminated');
});

test('preservation finds an unreachable counterexample rather than accepting actual trace samples', () => {
  const result = analyze('x >= 0 && x <= 2 && y >= 0', 'true', level({
    step: ({ x, y }) => ({ x: x + 1, y: y * 2 }),
  }));
  assert.equal(result.initial.pass, true);
  assert.equal(result.preservation.pass, false);
  assert.equal(result.preservation.outsideDomain, true);
  assert.equal(result.trace.some((s) => s.y !== 0), false);
  assert.equal(result.preservation.before.y, 17);
  assert.equal(result.preservation.after.y, 34);
});

test('preservation detects an in-domain logical failure and does not depend on goal success', () => {
  const result = analyze('x >= 0 && x <= 1 && y == 0', 'true', level());
  assert.equal(result.valid, false);
  assert.deepEqual(result.preservation.before, { x: 1, y: 0 });
  assert.deepEqual(result.preservation.after, { x: 2, y: 0 });
  assert.equal(result.preservation.outsideDomain, false);
  assert.equal(result.goal.pass, true);
});

test('goal failures outside the visible board are retained', () => {
  const result = analyze('x >= 0 && x <= 2', 'y >= 0 && y < 9', level());
  assert.equal(result.valid, true);
  assert.equal(result.goal.pass, false);
  assert.deepEqual(result.goal.before, { x: 2, y: -32 });
  assert.equal(result.candidates.length, 9);
  assert.equal(result.exitStateCount, 65);
});

test('domain boundary successors are failed, never truncated or wrapped', () => {
  const result = analyze('y == 0', 'true', level({ guardSource: 'true' }));
  assert.equal(result.valid, false);
  assert.deepEqual(result.preservation.before, { x: 32, y: 0 });
  assert.deepEqual(result.preservation.after, { x: 33, y: 0 });
  assert.equal(result.preservation.outsideDomain, true);
  assert.equal(result.traceStatus, 'outside-domain');
});

test('goal is partial correctness and a cycle does not pretend to terminate', () => {
  const result = analyze('x == 0 && y == 0', 'false', level({
    guardSource: 'true', step: (s) => s,
  }));
  assert.equal(result.valid, true);
  assert.equal(result.goal.pass, true);
  assert.equal(result.exitStateCount, 0);
  assert.equal(result.traceStatus, 'cycle');
});

test('syntax and numeric predicates return a structured analysis error', () => {
  for (const source of ['x +', 'x + y', 'x % 0 == 0']) {
    const result = analyze(source, 'true', level());
    assert.equal(result.valid, false);
    assert.equal(typeof result.error, 'string');
  }
});

test('initial failure skips later checks and consumes a command despite no candidates', () => {
  const before = createBattle(level());
  const result = order(before, 'false', 'true', 'single');
  assert.equal(result.analysis.initial.pass, false);
  assert.deepEqual(result.analysis.preservation, { pass: null, skipped: true });
  assert.deepEqual(result.analysis.goal, { pass: null, skipped: true });
  assert.equal(result.dud, true);
  assert.equal(result.cost, 1);
  assert.equal(result.battle.remaining, 5);
  assert.equal(result.shots.length, 0);
  assert.equal(before.remaining, 6);
});

test('a preservation dud consumes one command and can finish the round', () => {
  const result = order(createBattle(level({ commands: 1 })), 'x == 0 && y == 0', 'true', 'salvo');
  assert.equal(result.dud, true);
  assert.equal(result.cost, 1);
  assert.equal(result.battle.finished, true);
  assert.equal(result.battle.cleared, false);
});

test('syntax errors, invalid modes and an empty valid candidate set cost nothing', () => {
  const battle = createBattle(level());
  const bad = order(battle, 'x.constructor', 'true', 'single');
  assert.equal(bad.reason, 'syntax-error');
  assert.equal(bad.cost, 0);
  assert.equal(bad.battle, battle);
  assert.equal(order(battle, 'true', 'true', 'other').cost, 0);
  const empty = order(createBattle(level({ initial: { x: -1, y: 0 }, guardSource: 'false' })),
    'x == -1 && y == 0', 'true', 'single');
  assert.equal(empty.reason, 'no-candidates');
  assert.equal(empty.cost, 0);
});

test('goal failure permits firing with neutral then friendly then enemy priority', () => {
  let battle = createBattle(level());
  const invariant = 'x >= 0 && x <= 2 && y >= 0 && y <= 2';
  const a = order(battle, invariant, 'x == 2 && y == 0', 'single');
  assert.equal(a.analysis.goal.pass, false);
  assert.equal(a.reason, 'fired');
  assert.equal(a.dud, false);
  assert.deepEqual(a.shots, [{ x: 2, y: 2, type: 'neutral', points: 0 }]);
  const b = order(a.battle, invariant, 'x == 2 && y == 0', 'single');
  assert.deepEqual(b.shots, [{ x: 2, y: 1, type: 'friendly', points: 1 }]);
  const c = order(b.battle, invariant, 'x == 2 && y == 0', 'single');
  assert.deepEqual(c.shots, [{ x: 2, y: 0, type: 'enemy', points: 1 }]);
  assert.equal(c.battle.friendlyKills, 1);
  assert.equal(c.battle.enemyKills, 1);
  assert.equal(c.battle.score, 3);
  assert.equal(battle.hit.length, 0);
  assert.equal(battle.allies.length, 1);
});

test('tie breaks use x then y and salvo hits every unhit cell for one command', () => {
  const battle = createBattle(level({ guardSource: 'false' }));
  const result = order(battle, 'x >= 0 && x <= 2 && y >= 0 && y <= 2', 'false', 'salvo');
  assert.equal(result.cost, 1);
  assert.equal(result.shots.length, 9);
  assert.equal(result.battle.remaining, 5);
  assert.deepEqual(result.shots.slice(0, 3), [
    { x: 0, y: 0, type: 'neutral', points: 0 }, { x: 0, y: 1, type: 'neutral', points: 0 }, { x: 0, y: 2, type: 'neutral', points: 0 },
  ]);
  assert.deepEqual(result.shots.at(-2), { x: 2, y: 1, type: 'friendly', points: 1 });
  assert.deepEqual(result.shots.at(-1), { x: 2, y: 0, type: 'enemy', points: 1 });
});

test('destroyed cells remain in proof region but never become repeat neutral targets', () => {
  const first = order(createBattle(level()), 'x >= 0 && x <= 2 && y == 0', 'x == 2', 'single');
  assert.equal(first.battle.finished, false);
  const second = order(first.battle, 'x >= 0 && x <= 2 && y == 0', 'x == 2', 'single');
  assert.equal(second.analysis.candidates.length, 1);
  assert.equal(second.analysis.goal.pass, true);
  assert.equal(second.reason, 'no-candidates');
  assert.equal(second.cost, 0);
  assert.equal(second.battle.hit.length, 1);
});

test('clearing all enemies finishes, preserves initial layout and blocks subsequent orders', () => {
  const original = level({ enemies: [{ x: 2, y: 0 }] });
  const battle = createBattle(original);
  const result = order(battle, 'x >= 0 && x <= 2 && y == 0', 'x == 2', 'single');
  assert.equal(result.battle.cleared, true);
  assert.equal(result.battle.finished, true);
  assert.equal(result.battle.enemies.length, 0);
  assert.equal(result.battle.level.enemies.length, 1);
  assert.equal(original.enemies.length, 1);
  assert.equal(result.battle.baseScore, 6);
  assert.equal(result.battle.scoreMultiplier, 2);
  assert.equal(result.battle.score, 12);
  assert.equal(order(result.battle, 'true', 'true').reason, 'finished');
});

test('command budget defaults and invalid level data are handled', () => {
  assert.equal(createBattle(level({ commands: undefined, budget: 3 })).remaining, 3);
  assert.equal(createBattle(level({ commands: undefined, budget: undefined })).remaining, 6);
  assert.equal(createBattle(level({ commands: 0 })).finished, true);
  assert.throws(() => createBattle(level({ enemies: [{ x: 9, y: 0 }] })));
  assert.throws(() => createBattle(level({ allies: [{ x: 2, y: 0 }] })));
  assert.throws(() => createBattle(level({ initial: { x: 33, y: 0 } })));
});

const { LEVELS } = await import('./dist/levels.js');

test('authored starters expose their intended failure and each solution proves the displayed enemy coordinates', () => {
  assert.equal(LEVELS.length, 20);
  for (const mission of LEVELS) {
    const starter = analyze(mission.starter, mission.goalSolution, mission);
    assert.equal(starter.error, undefined, mission.id);
    assert.equal(starter.valid && starter.goal.pass, false, mission.id);
    const solution = analyze(mission.solution, mission.goalSolution, mission);
    assert.equal(solution.valid, true, mission.id);
    assert.equal(solution.goal.pass, true, mission.id);
    if (isInitializedLevel(mission)) {
      assert.equal(solution.contextCount, INPUT_DOMAIN.stateCount, mission.id);
      assert.equal(solution.checkedStateCount, INPUT_DOMAIN.stateCount * DOMAIN.stateCount, mission.id);
      assert.equal(solution.specification.pass, true, mission.id);
      assert.equal(solution.objectiveVerified, true, mission.id);
    } else assert.equal(solution.exitStateCount, 3, mission.id);
    assert.equal(solution.traceStatus, 'terminated', mission.id);
    assert.equal(solution.initial.checkedCount, initialStatesForLevel(mission).length, mission.id);
    assert.deepEqual(solution.candidates, coordinates(mission.enemies), mission.id);
    assert.equal(solution.traces.length, 3, mission.id);
    assert.equal(solution.traces.every(run => run.traceStatus === 'terminated'), true, mission.id);
    const endpoints = [...new Map(solution.traces.map(run => {
      const { x, y } = run.trace.at(-1);
      return [`${x},${y}`, { x: x + 0, y: y + 0 }]; // Signed zero is the same integer coordinate.
    })).values()].sort((a,b)=>a.x-b.x||a.y-b.y);
    assert.deepEqual(endpoints, coordinates(mission.enemies), mission.id);
    const clear = order(createBattle(mission), mission.solution, mission.goalSolution, 'salvo');
    assert.equal(clear.battle.cleared, true, mission.id);
    assert.equal(clear.battle.friendlyKills, 0, mission.id);
    assert.equal(clear.shots.length, mission.enemies.length, mission.id);
    assert.equal(clear.battle.remaining, mission.commands - 1, mission.id);
    const targetPoints = mission.enemies.reduce((sum, unit) => sum + unitPoints(unit), 0);
    assert.equal(clear.battle.enemyPoints, targetPoints, mission.id);
    assert.equal(clear.battle.friendlyPoints, 0, mission.id);
    assert.equal(clear.battle.baseScore, targetPoints + mission.commands - 1, mission.id);
    assert.equal(clear.battle.scoreMultiplier, 2, mission.id);
    assert.equal(clear.battle.score, (targetPoints + mission.commands - 1) * 2, mission.id);
  }
});

test('singles and a salvo earn the same target points with one command charged per order', () => {
  for (const mission of LEVELS) {
    let battle = createBattle(mission);
    for (let shot = 0; shot < mission.enemies.length; shot++) {
      const result = order(battle, mission.solution, mission.goalSolution, 'single');
      assert.equal(result.analysis.goal.pass, true, mission.id);
      assert.equal(result.analysis.candidates.length, mission.enemies.length, mission.id);
      assert.equal(result.shots.length, 1, mission.id);
      assert.equal(result.shots[0].type, 'enemy', mission.id);
      assert.equal(result.battle.scoreMultiplier, result.battle.cleared ? 2 : 1, mission.id);
      battle = result.battle;
    }
    assert.equal(battle.cleared, true, mission.id);
    const targetPoints = mission.enemies.reduce((sum, unit) => sum + unitPoints(unit), 0);
    assert.equal(battle.enemyPoints, targetPoints, mission.id);
    assert.equal(battle.baseScore, targetPoints + mission.commands - mission.enemies.length, mission.id);
    assert.equal(battle.score, (targetPoints + mission.commands - mission.enemies.length) * 2, mission.id);
    const salvo = order(createBattle(mission), mission.solution, mission.goalSolution, 'salvo');
    assert.equal(salvo.battle.score - battle.score, (mission.enemies.length - 1) * 2, mission.id);
  }
});

test('six failed initial checks exhaust a mission and further commands cannot change its score', () => {
  const mission = LEVELS[0];
  let battle = createBattle(mission);
  for (let command = 0; command < mission.commands; command++) {
    const result = order(battle, 'false', mission.goalSolution, 'salvo');
    assert.equal(result.dud, true);
    assert.equal(result.cost, 1);
    battle = result.battle;
    assert.equal(battle.score, mission.commands - command - 1);
  }
  assert.equal(battle.finished, true);
  assert.equal(battle.cleared, false);
  assert.equal(battle.hit.length, 0);
  const exhausted = order(battle, mission.solution, mission.goalSolution, 'salvo');
  assert.equal(exhausted.reason, 'finished');
  assert.equal(exhausted.cost, 0);
  assert.equal(exhausted.battle, battle);
});

test('a goal arithmetic error cancels the entire command without consuming shots or budget', () => {
  const mission = LEVELS[0];
  const battle = createBattle(mission);
  const result = order(battle, mission.solution, 'y * 9007199254740991 == 0', 'salvo');
  assert.equal(typeof result.error, 'string');
  assert.equal(result.cost, 0);
  assert.equal(result.battle, battle);
  assert.deepEqual(result.shots, []);
});

test('interrupted arithmetic evaluation reports every proof check as incomplete', () => {
  const mission = LEVELS[0];
  const result = analyze(mission.solution, 'y * 9007199254740991 == 0', mission);
  assert.equal(typeof result.error, 'string');
  assert.equal(result.valid, false);
  assert.ok(result.checkedStateCount > 0 && result.checkedStateCount < DOMAIN.stateCount);
  assert.deepEqual(result.initial, { pass: null });
  assert.deepEqual(result.preservation, { pass: null });
  assert.deepEqual(result.goal, { pass: null });
});

function captureError(action) {
  try { action(); } catch (error) { return error; }
  assert.fail('Expected an engine error.');
}

test('structured parser errors retain Korean compatibility and localize tokens and positions', () => {
  const error = captureError(() => parseExpression('x = 1'));
  assert.ok(error instanceof SyntaxError);
  assert.equal(error.errorCode, 'unsupported-character');
  assert.deepEqual(error.errorParams, { character: '=', position: 2 });
  assert.equal(error.message, "미지원 문자 '=' 확인. 지원 문법을 대조하라. (위치 3)");
  assert.equal(formatEngineError(error), error.message);
  assert.equal(formatEngineError(error, 'en'), "Unsupported character '='. Check the permitted syntax. (position 3)");
  error.message = 'This diagnostic was replaced.';
  assert.equal(formatEngineError(error, 'en'), "Unsupported character '='. Check the permitted syntax. (position 3)");
  const typed = captureError(() => parseExpression('true + 1'));
  assert.equal(formatEngineError(typed, 'en'), "Input type mismatch at '+'. Use an integer expression. (position 6)");
  const boolean = captureError(() => parseExpression('x && true'));
  assert.equal(formatEngineError(boolean, 'en'), "Input type mismatch at '&&'. Use a Boolean expression. (position 3)");
});

test('analyze localizes semantic labels and preserves metadata through an unconsumed order', () => {
  const invariant = analyze('x + y', 'true', level());
  assert.equal(invariant.errorCode, 'predicate-type');
  assert.deepEqual(invariant.errorParams, { label: 'invariant' });
  assert.equal(invariant.error, '불변식: 참/거짓을 나타내는 식을 입력하라.');
  assert.equal(formatEngineError(invariant, 'en'), 'Invariant: enter a Boolean expression.');
  const goal = analyze('true', 'x', level());
  assert.equal(formatEngineError(goal, 'en'), 'Goal: enter a Boolean expression.');
  const guard = analyze('true', 'true', level({ guardSource: 'x' }));
  assert.equal(formatEngineError(guard, 'en'), 'Loop guard: enter a Boolean expression.');
  const battle = createBattle(level());
  const command = order(battle, 'x + y', 'true', 'salvo');
  assert.equal(command.reason, 'syntax-error');
  assert.equal(command.battle, battle);
  assert.equal(command.cost, 0);
  assert.equal(command.error, invariant.error);
  assert.equal(command.errorCode, invariant.errorCode);
  assert.deepEqual(command.errorParams, invariant.errorParams);
  assert.equal(formatEngineError(command, 'en'), 'Invariant: enter a Boolean expression.');
});

test('runtime errors, numeric bounds and mode rejection provide English reports', () => {
  const literal = captureError(() => parseExpression('9007199254740992'));
  assert.ok(literal instanceof RangeError);
  assert.equal(formatEngineError(literal, 'en'), 'Number literal: exact integer range exceeded.');
  const overflow = captureError(() => evalAt('9007199254740991 + 1'));
  assert.equal(formatEngineError(overflow, 'en'), 'Arithmetic result: exact integer range exceeded.');
  const variable = captureError(() => evalAt('x', { x: 0.5, y: 0 }));
  assert.equal(formatEngineError(variable, 'en'), 'x: exact integer range exceeded.');
  const initial = captureError(() => createBattle(level({ initial: { x: 33, y: 0 } })));
  assert.ok(initial instanceof TypeError);
  assert.deepEqual(initial.errorParams, { min: -32, max: 32 });
  assert.equal(formatEngineError(initial, 'en'), 'Initial coordinates invalid. Use integers from -32 to 32.');
  const size = captureError(() => createBattle(level({ size: 34 })));
  assert.equal(formatEngineError(size, 'en'), 'Board size invalid. Use an integer from 1 to 33.');
  const mode = order(createBattle(level()), 'true', 'true', 'rapid');
  assert.equal(mode.errorCode, 'invalid-mode');
  assert.deepEqual(mode.errorParams, { mode: 'rapid' });
  assert.equal(mode.cost, 0);
  assert.equal(formatEngineError(mode, 'en'), 'Fire mode invalid. Select single or salvo.');
});

test('all remaining engine-controlled diagnostics carry codes and an English translation', () => {
  const cases = [
    ['missing-expression', () => parseExpression('')],
    ['expression-too-long', () => parseExpression('x'.repeat(4097))],
    ['too-many-tokens', () => parseExpression(Array(514).fill('x').join('+'))],
    ['comparison-type', () => parseExpression('x == true')],
    ['nesting-too-deep', () => parseExpression(`${'('.repeat(150)}true${')'.repeat(150)}`)],
    ['missing-close-parenthesis', () => parseExpression('(true')],
    ['expected-operand', () => parseExpression('x +')],
    ['unexpected-token', () => parseExpression('x y')],
    ['invalid-ast', () => evaluate(null, { x: 0, y: 0 })],
    ['zero-remainder-divisor', () => evalAt('x % 0')],
    ['unsupported-ast', () => evaluate({ kind: 'unsupported' }, { x: 0, y: 0 })],
    ['missing-step', () => createBattle(level({ step: undefined }))],
    ['invalid-layout', () => createBattle(level({ enemies: {} }))],
    ['offboard-unit', () => createBattle(level({ enemies: [{ x: 9, y: 0 }] }))],
    ['duplicate-unit', () => createBattle(level({ allies: [{ x: 2, y: 0 }] }))],
    ['invalid-command-budget', () => createBattle(level({ commands: -1 }))],
  ];
  for (const [code, action] of cases) {
    const error = captureError(action);
    assert.equal(error.errorCode, code);
    assert.equal(typeof error.errorParams, 'object');
    assert.equal(formatEngineError(error), error.message);
    const english = formatEngineError(error, 'en');
    assert.ok(english.length > 0, code);
    assert.doesNotMatch(english, /[가-힣]/, code);
    assert.notEqual(english, error.message, code);
  }
  const missing = analyze('true', 'true', level({ step: () => null }));
  assert.equal(missing.errorCode, 'missing-coordinate');
  assert.equal(formatEngineError(missing, 'en'), 'Program transition returned no coordinates.');
});

test('unknown external diagnostics are preserved without string-matching translation', () => {
  const external = new Error('External transition failed.');
  const report = analyze('true', 'true', level({ step: () => { throw external; } }));
  assert.equal(report.errorCode, 'unexpected-error');
  assert.deepEqual(report.errorParams, { detail: external.message });
  assert.equal(report.error, external.message);
  assert.equal(formatEngineError(external, 'en'), external.message);
  assert.equal(formatEngineError(report, 'en'), external.message);
  assert.equal(formatEngineError(null, 'en'), 'Unknown execution error. Inspect the error report.');
});

test('all allowed inputs must establish the invariant and each input has its own execution trace', () => {
  const inputs = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }];
  const mission = level({ initial: undefined, initialStates: inputs });
  const report = analyze('x >= 0 && x <= 2 && y >= 0 && y <= 2', 'x == 2 && y >= 0 && y <= 2', mission);
  assert.equal(report.error, undefined);
  assert.equal(report.valid, true);
  assert.deepEqual(report.initial, { pass: true, checkedCount: 3 });
  assert.equal(report.preservation.pass, true);
  assert.equal(report.goal.pass, true);
  assert.equal(report.checkedStateCount, DOMAIN.stateCount);
  assert.deepEqual(report.traces.map((run) => run.initial), inputs);
  assert.deepEqual(report.traces.map((run) => run.trace.at(-1)), [{ x: 2, y: 0 }, { x: 2, y: 1 }, { x: 2, y: 2 }]);
  assert.ok(report.traces.every((run) => run.traceStatus === 'terminated' && run.trace.length === 3));
  assert.deepEqual(report.candidates, report.traces.map((run) => run.trace.at(-1)));
  assert.deepEqual(report.trace, report.traces[0].trace);
  assert.equal(report.traceStatus, 'terminated');

  const rejected = analyze('x >= 0 && x <= 2 && y == 0', 'true', mission);
  assert.equal(rejected.valid, false);
  assert.deepEqual(rejected.initial, { pass: false, checkedCount: 3, before: inputs[1] });
  assert.equal(rejected.preservation.pass, true);
  const battle = createBattle(mission);
  const command = order(battle, 'x >= 0 && x <= 2 && y == 0', 'true', 'salvo');
  assert.equal(command.dud, true);
  assert.equal(command.cost, 1);
  assert.equal(command.battle.remaining, battle.remaining - 1);
  assert.deepEqual(command.shots, []);
});

test('initial input sets reject malformed or duplicate states and battle normalization owns its copies', () => {
  for (const initialStates of [[], null, {}, [undefined], [{ x: 0, y: 0 }, { x: 33, y: 0 }], [{ x: 0, y: 0.5 }]]) {
    const mission = level({ initialStates });
    assert.throws(() => getInitialStates(mission), TypeError);
    assert.throws(() => createBattle(mission), TypeError);
    const report = analyze('true', 'true', mission);
    assert.equal(report.valid, false);
    assert.deepEqual(report.initial, { pass: null });
    assert.deepEqual(report.traces, []);
  }
  const duplicate = captureError(() => getInitialStates(level({ initialStates: [{ x: 1, y: 2 }, { x: 1, y: 2 }] })));
  assert.equal(duplicate.errorCode, 'duplicate-initial-state');
  assert.equal(formatEngineError(duplicate, 'en'), 'Duplicate initial input. Assign coordinates (1, 2) only once.');
  const empty = captureError(() => getInitialStates(level({ initialStates: [] })));
  assert.equal(formatEngineError(empty, 'en'), 'Initial input format invalid. Supply a nonempty array of coordinates.');

  const legacy = level();
  const legacyInputs = getInitialStates(legacy);
  assert.deepEqual(legacyInputs, [legacy.initial]);
  assert.notEqual(legacyInputs[0], legacy.initial);
  assert.deepEqual(createBattle(legacy).level.initialStates, [legacy.initial]);
  const mission = level({ initial: { x: 33, y: 0 }, initialStates: [{ x: 0, y: 1 }, { x: 0, y: 2 }] });
  const normalized = getInitialStates(mission);
  const battle = createBattle(mission);
  assert.deepEqual(battle.level.initial, { x: 0, y: 1 });
  assert.notEqual(battle.level.initialStates, mission.initialStates);
  assert.notEqual(battle.level.initialStates[0], mission.initialStates[0]);
  assert.notEqual(battle.level.initial, battle.level.initialStates[0]);
  normalized[0].y = 8;
  mission.initialStates[0].y = 7;
  mission.initialStates.push({ x: 0, y: 3 });
  assert.deepEqual(battle.level.initialStates, [{ x: 0, y: 1 }, { x: 0, y: 2 }]);
  assert.deepEqual(battle.level.initial, { x: 0, y: 1 });
});

test('per-input termination statuses stay distinct while legacy trace fields select the first input', () => {
  const mission = level({
    initialStates: [{ x: 2, y: 0 }, { x: 0, y: 0 }],
    step: ({ x, y }) => ({ x, y }),
  });
  const report = analyze('(x == 0 || x == 2) && y == 0', 'x == 2 && y == 0', mission);
  assert.equal(report.valid, true);
  assert.equal(report.initial.checkedCount, 2);
  assert.deepEqual(report.traces.map((run) => run.traceStatus), ['terminated', 'cycle']);
  assert.deepEqual(report.traces[0].trace, [{ x: 2, y: 0 }]);
  assert.deepEqual(report.traces[1].trace, [{ x: 0, y: 0 }, { x: 0, y: 0 }]);
  assert.deepEqual(report.trace, report.traces[0].trace);
  assert.equal(report.traceStatus, 'terminated');
  const legacyReport = analyze('x >= 0 && x <= 2 && y == 0', 'true', level());
  assert.deepEqual(legacyReport.initial, { pass: true, checkedCount: 1 });
  assert.equal(legacyReport.traces.length, 1);
  assert.deepEqual(legacyReport.traces[0], { initial: { x: 0, y: 0 }, trace: legacyReport.trace, traceStatus: legacyReport.traceStatus });
});

test('a true precondition checks all 4225 initial states while running only representative traces', () => {
  let transitions = 0;
  const traceInputs = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }];
  const mission = level({
    initialCondition: 'true',
    traceInputs,
    guardSource: 'x == 0',
    step: ({ x, y }) => { transitions++; return { x: x + 1, y }; },
  });
  const allInputs = getInitialStates(mission);
  assert.equal(allInputs.length, DOMAIN.stateCount);
  assert.deepEqual(allInputs[0], { x: -32, y: -32 });
  assert.deepEqual(allInputs.at(-1), { x: 32, y: 32 });
  const report = analyze('true', 'true', mission);
  assert.equal(report.error, undefined);
  assert.equal(report.valid, true);
  assert.deepEqual(report.initial, { pass: true, checkedCount: DOMAIN.stateCount });
  assert.equal(report.checkedStateCount, DOMAIN.stateCount);
  assert.equal(report.traces.length, 3);
  assert.deepEqual(report.traces.map((run) => run.initial), traceInputs);
  assert.ok(report.traces.every((run) => run.traceStatus === 'terminated' && run.trace.length === 2));
  assert.equal(transitions, 65 + 3, 'one preservation step for each x=0 state, plus only three displayed traces');
  assert.deepEqual(getTraceInputs(level({ initialCondition: 'true' })), allInputs.slice(0, 3));
});

test('preconditions include negative coordinates and initial failures outside trace samples still cause duds', () => {
  const mission = level({
    initialCondition: 'x >= 0 && y == -1',
    traceInputs: [{ x: 0, y: -1 }, { x: 1, y: -1 }],
    guardSource: 'false',
  });
  assert.deepEqual(getInitialStates(mission), Array.from({ length: 33 }, (_, x) => ({ x, y: -1 })));
  const report = analyze('x >= 0 && x <= 2 && y == -1', 'true', mission);
  assert.equal(report.error, undefined);
  assert.deepEqual(report.initial, { pass: false, checkedCount: 33, before: { x: 3, y: -1 } });
  assert.equal(report.preservation.pass, true);
  assert.equal(report.goal.pass, true);
  assert.equal(report.valid, false);
  assert.ok(report.traces.every((run) => evaluate(parseExpression('x <= 2'), run.initial)));
  const battle = createBattle(mission);
  const command = order(battle, 'x >= 0 && x <= 2 && y == -1', 'true', 'salvo');
  assert.equal(command.reason, 'invalid-invariant');
  assert.equal(command.dud, true);
  assert.equal(command.cost, 1);
  assert.equal(command.battle.remaining, battle.remaining - 1);
  assert.deepEqual(command.shots, []);
  const accepted = analyze('x >= 0 && y == -1', 'true', mission);
  assert.equal(accepted.valid, true);
  assert.equal(accepted.initial.checkedCount, 33);
  assert.deepEqual(getTraceInputs(level({ initialCondition: 'x == -2 && y == -3' })), [{ x: -2, y: -3 }]);
});

test('invalid preconditions and representative inputs return structured localized errors', () => {
  const cases = [
    ['ambiguous-initial-inputs', { initialCondition: 'true', initialStates: [{ x: 0, y: 0 }] }],
    ['empty-initial-condition', { initialCondition: 'false' }],
    ['empty-initial-condition', { initialCondition: 'x > 32' }],
    ['predicate-type', { initialCondition: 'x + 1' }],
    ['unsupported-character', { initialCondition: 'x = 0' }],
    ['missing-expression', { initialCondition: true }],
    ['zero-remainder-divisor', { initialCondition: 'x % y == 0' }],
    ['invalid-trace-inputs', { initialCondition: 'true', traceInputs: [] }],
    ['invalid-trace-inputs', { initialCondition: 'true', traceInputs: null }],
    ['invalid-trace-inputs', { initialCondition: 'true', traceInputs: {} }],
    ['invalid-trace-input', { initialCondition: 'true', traceInputs: [{ x: 33, y: 0 }] }],
    ['invalid-trace-input', { initialCondition: 'true', traceInputs: [{ x: 0.5, y: 0 }] }],
    ['invalid-trace-input', { initialCondition: 'true', traceInputs: [undefined] }],
    ['duplicate-trace-input', { initialCondition: 'true', traceInputs: [{ x: 1, y: 2 }, { x: 1, y: 2 }] }],
    ['trace-input-excluded', { initialCondition: 'x >= 0', traceInputs: [{ x: -1, y: 0 }] }],
  ];
  for (const [errorCode, overrides] of cases) {
    const mission = level(overrides);
    const error = captureError(() => getTraceInputs(mission));
    assert.equal(error.errorCode, errorCode);
    assert.equal(captureError(() => createBattle(mission)).errorCode, errorCode);
    const report = analyze('true', 'true', mission);
    assert.equal(report.errorCode, errorCode);
    assert.equal(report.valid, false);
    assert.deepEqual(report.initial, { pass: null });
    assert.deepEqual(report.traces, []);
    assert.equal(formatEngineError(error), error.message);
    assert.doesNotMatch(formatEngineError(report, 'en'), /[가-힣]/);
    assert.notEqual(formatEngineError(report, 'en'), report.error);
  }
  const typed = analyze('true', 'true', level({ initialCondition: 'x + 1' }));
  assert.equal(formatEngineError(typed, 'en'), 'Initial precondition: enter a Boolean expression.');
  assert.ok(getInitialStates(level({ initialCondition: 'y != 0 && x % y == 0' })).every(({ y }) => y !== 0));
});

test('battle normalization preserves preconditions and copied trace inputs without changing legacy finite sets', () => {
  const mission = level({ initialCondition: 'x >= 0 && y >= 0', traceInputs: [{ x: 0, y: 0 }, { x: 2, y: 1 }] });
  const battle = createBattle(mission);
  assert.equal(battle.level.initialCondition, mission.initialCondition);
  assert.equal(Object.hasOwn(battle.level, 'initialStates'), false);
  assert.notEqual(battle.level.traceInputs, mission.traceInputs);
  assert.notEqual(battle.level.traceInputs[0], mission.traceInputs[0]);
  assert.notEqual(battle.level.initial, battle.level.traceInputs[0]);
  mission.traceInputs[0].x = 9;
  mission.traceInputs.push({ x: 3, y: 3 });
  const exposed = getTraceInputs(battle.level);
  exposed[0].y = 7;
  battle.level.initial.x = -32;
  assert.deepEqual(battle.level.traceInputs, [{ x: 0, y: 0 }, { x: 2, y: 1 }]);
  const report = analyze('true', 'true', battle.level);
  assert.equal(report.valid, true);
  assert.equal(report.initial.checkedCount, 33 * 33);
  assert.deepEqual(report.traces.map((run) => run.initial), battle.level.traceInputs);
  const command = order(battle, 'true', 'true', 'single');
  assert.equal(command.reason, 'fired');
  assert.equal(command.analysis.initial.checkedCount, 33 * 33);

  const finite = level({ initialStates: [{ x: 0, y: 0 }, { x: 0, y: 1 }], traceInputs: [{ x: 0, y: 0 }] });
  assert.deepEqual(getTraceInputs(finite), finite.initialStates);
  assert.deepEqual(getTraceInputs(createBattle(finite).level), finite.initialStates);
  assert.deepEqual(getTraceInputs(level()), [{ x: 0, y: 0 }]);
});
