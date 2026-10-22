import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseExpression, evaluate, executeTransition, analyze, createBattle, order,
  formatEngineError, TRACE_LIMIT,
} from './dist/engine.js';
import { shutdownZ3 } from './dist/z3-runtime.js';
import { LEVELS } from './dist/levels.js';

after(async () => { await shutdownZ3(); });

const level = (overrides = {}) => ({
  initial: { x: 0, y: 0 }, size: 9, commands: 6,
  guardSource: 'x < 2', transition: { x: 'x + 1', y: 'y' },
  enemies: [{ x: 2, y: 0 }, { x: 3, y: 0 }], allies: [{ x: 2, y: 1 }],
  ...overrides,
});
const evalAt = (source, state = { x: 2, y: 3 }) => evaluate(parseExpression(source), state);
const invariant = 'x >= 0 && x <= 2 && y == 0';
const captureError = (action) => {
  try { action(); } catch (error) { return error; }
  assert.fail('Expected an engine error.');
};
const serial = (state) => ({ x: String(state.x), y: String(state.y) });
const allChecks = (report) => [report.initial, report.preservation, report.goal];

// Run real Z3 for the unaffected phases; replace only one check result so
// timeout behavior is deterministic rather than dependent on machine speed.
function unknownPhase(target, reason = 'timeout') {
  return (ctx, phase) => {
    const solver = new ctx.Solver();
    if (phase === target) {
      solver.check = async () => 'unknown';
      solver.reasonUnknown = () => reason;
    }
    return solver;
  };
}

test('safe typed parser uses exact BigInt arithmetic and normal precedence', () => {
  assert.equal(evalAt('x*y + 2 * (y - x)'), 8n);
  assert.equal(evalAt('x*y == 6 && !(x >= y) || false'), true);
  assert.equal(evalAt('-x * +y % 4'), -2n);
  assert.equal(evalAt('x != y && x <= 2 && y > 1'), true);
  assert.equal(evalAt('(true == !false) && true'), true);
  assert.equal(evalAt('9007199254740993 * 9007199254740993'), 81129638414606699710187514626049n);
  assert.equal(evalAt('x + 1', { x: '9007199254740993', y: 0 }), 9007199254740994n);
});

test('parser rejects execution, assignments, coercion and invalid syntax', async () => {
  for (const source of [
    '', 'globalThis.alert(1)', 'x = 3', 'x.constructor', 'Function("return 1")()',
    'x & y', 'x / y', 'x +', '(x == 0', 'x < y < 3', 'x == true', 'x && true', '!x',
    '1.5 == x', 'true + false', `${'('.repeat(150)}true${')'.repeat(150)}`,
  ]) assert.throws(() => parseExpression(source), undefined, source);
  const source = await readFile(new URL('./dist/engine.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\b(?:eval|Function)\s*\(/);
  assert.throws(() => evalAt('x', { x: 9007199254740992, y: 0 }), /정수 입력/);
  assert.throws(() => evalAt('x', { x: 0.5, y: 0 }));
});

test('concrete remainder uses dividend sign and short-circuit guards', () => {
  assert.equal(evalAt('-5 % 3'), -2n);
  assert.equal(evalAt('5 % -3'), 2n);
  assert.equal(evalAt('-5 % -3'), -2n);
  assert.equal(evalAt('y != 0 && x % y == 0', { x: 3, y: 0 }), false);
  assert.equal(evalAt('y == 0 || x % y == 0', { x: 3, y: 0 }), true);
  assert.throws(() => evalAt('x % 0'), /제수/);
});

test('one declarative transition drives exact simultaneous execution and branch selection', () => {
  const mission = level({
    transition: { x: 'x + 1', y: { condition: 'x < 2', then: 'y + 1', else: 'y - 1' } },
    step: () => { throw new Error('Legacy function must never execute.'); },
  });
  assert.deepEqual(executeTransition(mission, { x: 1, y: 4 }), { x: 2n, y: 5n });
  assert.deepEqual(executeTransition(mission, { x: 2, y: 5 }), { x: 3n, y: 4n });
  const oldState = level({ transition: { x: 'x + 1', y: 'x' } });
  assert.deepEqual(executeTransition(oldState, { x: '9007199254740993', y: 0 }), { x: 9007199254740994n, y: 9007199254740993n });
});

test('UNSAT proves all three obligations while candidates are only board coordinates', async () => {
  const report = await analyze(invariant, 'x == 2 && y == 0', level());
  assert.equal(report.valid, true);
  assert.ok(allChecks(report).every((check) => check.pass === true && check.status === 'unsat'));
  assert.equal(report.verification, 'z3-int');
  assert.deepEqual(report.candidates, [{ x: 2, y: 0 }]);
  assert.deepEqual(report.trace, [{ x: '0', y: '0' }, { x: '1', y: '0' }, { x: '2', y: '0' }]);
  assert.equal(report.traceStatus, 'terminated');
});

test('preservation finds a counterexample beyond every former coordinate boundary', async () => {
  const mission = level({ guardSource: 'true' });
  const report = await analyze('x <= 1000000 && y == 0', 'true', mission);
  assert.equal(report.initial.pass, true);
  assert.equal(report.preservation.status, 'sat');
  assert.deepEqual(report.preservation.before, { x: '1000000', y: '0' });
  assert.deepEqual(report.preservation.after, { x: '1000001', y: '0' });
  assert.equal(report.traceStatus, 'limited');
  assert.equal(report.trace.length, TRACE_LIMIT + 1);
});

test('a transition leaving the board is legal when the unbounded invariant is preserved', async () => {
  const report = await analyze('y == 0', 'true', level({ guardSource: 'true' }));
  assert.equal(report.valid, true);
  assert.equal(report.preservation.status, 'unsat');
  assert.equal(report.traceStatus, 'limited');
  assert.deepEqual(report.trace.at(-1), { x: '256', y: '0' });
});

test('unreachable states can refute preservation even when the actual trace is safe', async () => {
  const mission = level({ transition: { x: 'x + 1', y: 'y * 2' } });
  const report = await analyze('x >= 0 && x <= 2 && y >= 0 && y <= 1000', 'true', mission);
  assert.equal(report.initial.pass, true);
  assert.equal(report.preservation.pass, false);
  assert.ok(BigInt(report.preservation.before.y) > 500n);
  assert.ok(BigInt(report.preservation.after.y) > 1000n);
  assert.equal(report.trace.some((s) => s.y !== '0'), false);
  assert.equal(evalAt('x >= 0 && x <= 2 && y >= 0 && y <= 1000', report.preservation.before), true);
  assert.equal(evalAt('x >= 0 && x <= 2 && y >= 0 && y <= 1000', report.preservation.after), false);
});

test('SAT witnesses above 2^53 preserve every decimal digit', async () => {
  const huge = '9007199254740993';
  const report = await analyze(`x <= ${huge} && y == 0`, 'true', level({ guardSource: 'true' }));
  assert.equal(report.preservation.pass, false);
  assert.deepEqual(report.preservation.before, { x: huge, y: '0' });
  assert.deepEqual(report.preservation.after, { x: '9007199254740994', y: '0' });
  assert.doesNotThrow(() => JSON.stringify(report));
  const initialized = await analyze(`x == ${huge} && y == 0`, `x == ${huge}`, level({
    initial: { x: huge, y: 0n }, guardSource: 'false',
  }));
  assert.equal(initialized.valid, true);
  assert.equal(initialized.goal.pass, true);
  assert.equal(initialized.trace[0].x, huge);
  assert.deepEqual(initialized.candidates, []);
});

test('goal counterexamples can exist only outside the board and beyond 2^53', async () => {
  const huge = '9007199254740993';
  const report = await analyze(`(x == 0 || x == ${huge}) && y == 0`, 'x == 0', level({ guardSource: 'false' }));
  assert.equal(report.valid, true);
  assert.equal(report.goal.status, 'sat');
  assert.deepEqual(report.goal.before, { x: huge, y: '0' });
  assert.deepEqual(report.candidates, [{ x: 0, y: 0 }]);
});

test('vacuous exit proofs do not claim termination or an available target', async () => {
  const mission = level({ guardSource: 'true', transition: { x: 'x', y: 'y' } });
  const report = await analyze('x == 0 && y == 0', 'false', mission);
  assert.equal(report.valid, true);
  assert.equal(report.goal.pass, true);
  assert.equal(report.traceStatus, 'cycle');
  assert.deepEqual(report.candidates, []);
  const result = await order(createBattle(mission), 'x == 0 && y == 0', 'false');
  assert.equal(result.reason, 'no-candidates');
  assert.equal(result.cost, 0);
});

test('SMT remainder matches BigInt signs for positive and negative divisors', async () => {
  const cases = [
    [-5, 3, '-2'], [5, -3, '2'], [-5, -3, '-2'], [5, 3, '2'],
  ];
  for (const [x, y, remainder] of cases) {
    const mission = level({ initial: { x, y }, guardSource: 'false' });
    const report = await analyze(`x == ${x} && y == ${y}`, `x % y == ${remainder}`, mission);
    assert.equal(report.goal.status, 'unsat', `${x} % ${y}`);
  }
});

test('SMT definedness honors short-circuit order and total invariant requirements', async () => {
  const mission = level({ initial: { x: 0, y: 1 }, guardSource: 'false' });
  const safe = await analyze('y != 0 && x % y == 0', 'true', mission);
  assert.equal(safe.valid, true);
  assert.equal(safe.goal.pass, true);
  const unsafe = await analyze('x % y == 0 && y != 0', 'true', mission);
  assert.equal(unsafe.preservation.pass, null);
  assert.equal(unsafe.preservation.reason, 'undefined-expression');
  assert.equal(unsafe.preservation.before.y, '0');
  const orSafe = await analyze('y == 0 || x % y == 0', 'true', mission);
  assert.equal(orSafe.valid, true);
});

test('guard, transition branch and goal need only be defined where they execute', async () => {
  const mission = level({
    initial: { x: 0, y: 1 }, guardSource: 'x < 1 && 1 % y == 0',
    transition: { x: 'x + 1', y: { condition: 'y != 0', then: 'y', else: 'x % 0' } },
  });
  const report = await analyze('x >= 0 && x <= 1 && y == 1', 'x % x == 0', mission);
  assert.equal(report.valid, true);
  assert.equal(report.goal.pass, true);
  assert.deepEqual(executeTransition(mission, { x: 0, y: 1 }), { x: 1n, y: 1n });
  const bad = await analyze('x >= 0 && y == 0', 'true', level({ transition: { x: 'x % y', y: 'y' } }));
  assert.equal(bad.preservation.reason, 'undefined-expression');
});

test('undefined goal paths cannot be hidden by a different false goal model', async () => {
  const mission = LEVELS[0];
  const battle = createBattle(mission);
  const result = await order(battle, mission.solution, 'x % (x - 4) == 1', 'salvo');
  assert.equal(result.analysis.goal.pass, null);
  assert.equal(result.analysis.goal.reason, 'undefined-expression');
  assert.deepEqual(result.analysis.goal.before, { x: '4', y: '4' });
  assert.equal(result.reason, 'inconclusive');
  assert.equal(result.cost, 0);
  assert.equal(result.battle, battle);
  assert.deepEqual(result.shots, []);
});

test('a directly undefined initial expression also blocks without a dud or cost', async () => {
  const battle = createBattle(level());
  const result = await order(battle, 'x % 0 == 0', 'true', 'single');
  assert.equal(result.analysis.initial.pass, null);
  assert.equal(result.analysis.initial.reason, 'undefined-expression');
  assert.equal(result.reason, 'inconclusive');
  assert.equal(result.cost, 0);
  assert.equal(result.dud, false);
});

test('conclusive initialization and preservation failures still consume one command', async () => {
  const battle = createBattle(level());
  const initial = await order(battle, 'false', 'true', 'salvo');
  assert.equal(initial.analysis.initial.pass, false);
  assert.equal(initial.analysis.preservation.pass, true);
  assert.equal(initial.analysis.goal.pass, true);
  assert.equal(initial.dud, true);
  assert.equal(initial.cost, 1);
  assert.equal(initial.battle.remaining, 5);
  assert.equal(battle.remaining, 6);
  const preservation = await order(createBattle(level({ commands: 1 })), 'x == 0 && y == 0', 'true');
  assert.equal(preservation.analysis.preservation.status, 'sat');
  assert.equal(preservation.battle.finished, true);
  assert.equal(preservation.battle.cleared, false);
});

test('syntax errors, invalid mode and no unhit candidates never consume commands', async () => {
  const battle = createBattle(level());
  const syntax = await order(battle, 'x.constructor', 'true');
  assert.equal(syntax.reason, 'syntax-error');
  assert.equal(syntax.cost, 0);
  assert.equal(syntax.battle, battle);
  assert.equal((await order(battle, 'true', 'true', 'other')).cost, 0);
  const noCells = await order(createBattle(level({ initial: { x: -1, y: 0 }, guardSource: 'false' })),
    'x == -1 && y == 0', 'true');
  assert.equal(noCells.reason, 'no-candidates');
  assert.equal(noCells.cost, 0);
});

test('SAT goal failure permits fire with neutral then friendly then enemy priority', async () => {
  let battle = createBattle(level());
  const wide = 'x >= 0 && x <= 2 && y >= 0 && y <= 2';
  const expected = [
    { x: 2, y: 2, type: 'neutral' }, { x: 2, y: 1, type: 'friendly' }, { x: 2, y: 0, type: 'enemy' },
  ];
  for (const shot of expected) {
    const result = await order(battle, wide, 'x == 2 && y == 0');
    assert.equal(result.analysis.goal.status, 'sat');
    assert.deepEqual(result.shots, [shot]);
    battle = result.battle;
  }
  assert.equal(battle.friendlyKills, 1);
  assert.equal(battle.enemyKills, 1);
  assert.equal(battle.score, 3);
});

test('salvo uses one command, sorted targets, and no repeat hits without changing the proof region', async () => {
  const battle = createBattle(level({ guardSource: 'false' }));
  const wide = 'x >= 0 && x <= 2 && y >= 0 && y <= 2';
  const first = await order(battle, wide, 'false', 'salvo');
  assert.equal(first.cost, 1);
  assert.equal(first.shots.length, 9);
  assert.equal(first.battle.remaining, 5);
  assert.deepEqual(first.shots.slice(0, 3), [
    { x: 0, y: 0, type: 'neutral' }, { x: 0, y: 1, type: 'neutral' }, { x: 0, y: 2, type: 'neutral' },
  ]);
  assert.deepEqual(first.shots.at(-2), { x: 2, y: 1, type: 'friendly' });
  assert.deepEqual(first.shots.at(-1), { x: 2, y: 0, type: 'enemy' });
  const second = await order(first.battle, wide, 'false', 'salvo');
  assert.equal(second.analysis.candidates.length, 9);
  assert.equal(second.reason, 'no-candidates');
  assert.equal(second.cost, 0);
  assert.equal(battle.hit.length, 0);
});

test('all four starters are valid and every solution proves the initial enemy region', async () => {
  assert.equal(LEVELS.length, 4);
  for (const mission of LEVELS) {
    const starter = await analyze(mission.starter, mission.goalSolution, mission);
    assert.equal(starter.valid, true, mission.id);
    const solution = await analyze(mission.solution, mission.goalSolution, mission);
    assert.equal(solution.valid, true, mission.id);
    assert.equal(solution.goal.pass, true, mission.id);
    assert.deepEqual(solution.candidates, mission.enemies, mission.id);
    assert.equal(solution.traceStatus, 'terminated');
    assert.ok(mission.enemies.some((unit) => JSON.stringify(serial(unit)) === JSON.stringify(solution.trace.at(-1))));
    const clear = await order(createBattle(mission), mission.solution, mission.goalSolution, 'salvo');
    assert.equal(clear.battle.cleared, true, mission.id);
    assert.equal(clear.battle.friendlyKills, 0, mission.id);
    assert.equal(clear.battle.remaining, 5, mission.id);
    assert.equal(clear.battle.score, 8, mission.id);
  }
});

test('three singles score six; a salvo scores eight; completion prevents further changes', async () => {
  const mission = LEVELS[0];
  let battle = createBattle(mission);
  for (let i = 0; i < 3; i++) {
    const result = await order(battle, mission.solution, mission.goalSolution);
    assert.equal(result.analysis.goal.pass, true);
    assert.equal(result.analysis.candidates.length, 3);
    assert.equal(result.shots[0].type, 'enemy');
    battle = result.battle;
  }
  assert.equal(battle.cleared, true);
  assert.equal(battle.score, 6);
  assert.equal(battle.enemies.length, 0);
  assert.equal(battle.level.enemies.length, 3);
  const done = await order(battle, mission.solution, mission.goalSolution, 'salvo');
  assert.equal(done.reason, 'finished');
  assert.equal(done.battle, battle);
  assert.equal(done.cost, 0);
});

test('six conclusive duds exhaust the budget without altering units', async () => {
  let battle = createBattle(LEVELS[0]);
  for (let n = 0; n < 6; n++) {
    const result = await order(battle, 'false', 'true');
    assert.equal(result.dud, true);
    battle = result.battle;
    assert.equal(battle.score, 5 - n);
  }
  assert.equal(battle.finished, true);
  assert.equal(battle.cleared, false);
  assert.equal(battle.hit.length, 0);
});

test('a controlled nonlinear goal timeout never turns into a success or a charged shot', async () => {
  const mission = level({ guardSource: 'false' });
  const battle = createBattle(mission);
  const result = await order(battle, 'x * x == 0 && y == 0', 'x == 0', 'salvo', {
    solverFactory: unknownPhase('goal'), timeoutMs: 2000,
  });
  assert.equal(result.analysis.initial.pass, true);
  assert.equal(result.analysis.preservation.pass, true);
  assert.equal(result.analysis.goal.pass, null);
  assert.equal(result.analysis.goal.status, 'unknown');
  assert.equal(result.analysis.goal.reason, 'timeout');
  assert.equal(result.reason, 'inconclusive');
  assert.equal(result.battle, battle);
  assert.equal(result.cost, 0);
  assert.deepEqual(result.shots, []);
});

test('UNKNOWN takes priority over a conclusive false check and is not a dud', async () => {
  const battle = createBattle(level());
  const result = await order(battle, 'false', 'true', 'single', { solverFactory: unknownPhase('goal', 'incomplete arithmetic') });
  assert.equal(result.analysis.initial.pass, false);
  assert.equal(result.analysis.goal.pass, null);
  assert.equal(result.analysis.goal.reason, 'solver-unknown');
  assert.equal(result.reason, 'inconclusive');
  assert.equal(result.cost, 0);
  assert.equal(result.dud, false);
  assert.equal(result.battle, battle);
});

test('solver exceptions remain inconclusive and the serialized queue recovers', async () => {
  const battle = createBattle(level());
  const failed = await order(battle, invariant, 'true', 'salvo', {
    solverFactory: (ctx, phase) => {
      const solver = new ctx.Solver();
      if (phase === 'preservation') solver.check = async () => { throw new Error('Injected solver failure.'); };
      return solver;
    },
  });
  assert.equal(failed.analysis.preservation.reason, 'solver-error');
  assert.equal(failed.reason, 'inconclusive');
  assert.equal(failed.cost, 0);
  const reports = await Promise.all([analyze(invariant, 'x == 2', level()), analyze(invariant, 'false', level())]);
  assert.equal(reports[0].goal.pass, true);
  assert.equal(reports[1].goal.pass, false);
});

test('verification time/resource options reject invalid or unlimited values', async () => {
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: 1.5 }, { timeoutMs: Infinity }, { rlimit: 0 }, { solverFactory: true }]) {
    const report = await analyze(invariant, 'true', level(), options);
    assert.equal(report.errorCode, 'invalid-solver-options');
    assert.ok(allChecks(report).every((check) => check.pass === null));
  }
});

test('createBattle accepts exact initial integers but validates board and transition data', () => {
  const battle = createBattle(level({ initial: { x: '9007199254740993', y: -100000n } }));
  assert.deepEqual(battle.level.initial, { x: '9007199254740993', y: '-100000' });
  assert.equal(createBattle(level({ commands: undefined, budget: 3 })).remaining, 3);
  assert.equal(createBattle(level({ commands: 0 })).finished, true);
  for (const overrides of [
    { initial: { x: 0.5, y: 0 } }, { enemies: [{ x: 9, y: 0 }] }, { allies: [{ x: 2, y: 0 }] },
    { transition: undefined }, { transition: { x: 'true', y: 'y' } }, { size: 65 },
  ]) assert.throws(() => createBattle(level(overrides)));
});

test('structured English and Korean diagnostics preserve tokens, positions and semantic labels', async () => {
  const error = captureError(() => parseExpression('x = 1'));
  assert.ok(error instanceof SyntaxError);
  assert.deepEqual(error.errorParams, { character: '=', position: 2 });
  assert.equal(error.message, "미지원 문자 '=' 확인. 지원 문법을 대조하라. (위치 3)");
  assert.equal(formatEngineError(error, 'en'), "Unsupported character '='. Check the permitted syntax. (position 3)");
  error.message = 'Replaced diagnostic.';
  assert.equal(formatEngineError(error, 'en'), "Unsupported character '='. Check the permitted syntax. (position 3)");
  const report = await analyze('x + y', 'true', level());
  assert.equal(formatEngineError(report, 'en'), 'Invariant: enter a Boolean expression.');
  const command = await order(createBattle(level()), 'true', 'x', 'salvo');
  assert.equal(formatEngineError(command, 'en'), 'Goal: enter a Boolean expression.');
  assert.equal(command.cost, 0);
  const input = captureError(() => evalAt('x', { x: 0.5, y: 0 }));
  assert.equal(input.errorCode, 'invalid-integer');
  assert.doesNotMatch(formatEngineError(input, 'en'), /[가-힣]/);
  const transition = captureError(() => createBattle(level({ transition: { x: 'true', y: 'y' } })));
  assert.equal(formatEngineError(transition, 'en'), 'x transition: an integer result is required.');
  assert.equal(formatEngineError(await order(createBattle(level()), 'true', 'true', 'rapid'), 'en'), 'Fire mode invalid. Select single or salvo.');
});

test('new transition and solver setting diagnostics have complete English reports', async () => {
  const errors = [
    captureError(() => createBattle(level({ transition: undefined }))),
    captureError(() => createBattle(level({ transition: { x: {}, y: 'y' } }))),
    captureError(() => createBattle(level({ transition: { x: { condition: 'x', then: '1', else: '2' }, y: 'y' } }))),
    captureError(() => createBattle(level({ initial: { x: 0.5, y: 0 } }))),
    await analyze(invariant, 'true', level(), { timeoutMs: 0 }),
  ];
  for (const error of errors) {
    assert.equal(typeof error.errorCode, 'string');
    assert.doesNotMatch(formatEngineError(error, 'en'), /[가-힣]/);
    assert.equal(formatEngineError(error), error.error ?? error.message);
  }
  assert.equal(formatEngineError(new Error('External failure.'), 'en'), 'External failure.');
});
