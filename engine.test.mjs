import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Import as an ES module independently of a package.json or build tool.
const engineSource = await readFile(new URL('./dist/engine.js', import.meta.url), 'utf8');
const { DOMAIN, parseExpression, evaluate, analyze, createBattle, order } = await import(
  `data:text/javascript;base64,${Buffer.from(engineSource).toString('base64')}`
);

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

test('initial failure still computes other checks and consumes a command despite no candidates', () => {
  const before = createBattle(level());
  const result = order(before, 'false', 'true', 'single');
  assert.equal(result.analysis.initial.pass, false);
  assert.equal(result.analysis.preservation.pass, true);
  assert.equal(result.analysis.goal.pass, true);
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

test('goal failure allows firing, with neutral then friendly then enemy priority', () => {
  let battle = createBattle(level());
  const invariant = 'x >= 0 && x <= 2 && y >= 0 && y <= 2';
  const a = order(battle, invariant, 'x == 2 && y == 0', 'single');
  assert.equal(a.analysis.goal.pass, false);
  assert.deepEqual(a.shots, [{ x: 2, y: 2, type: 'neutral' }]);
  const b = order(a.battle, invariant, 'x == 2 && y == 0', 'single');
  assert.deepEqual(b.shots, [{ x: 2, y: 1, type: 'friendly' }]);
  const c = order(b.battle, invariant, 'x == 2 && y == 0', 'single');
  assert.deepEqual(c.shots, [{ x: 2, y: 0, type: 'enemy' }]);
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
    { x: 0, y: 0, type: 'neutral' }, { x: 0, y: 1, type: 'neutral' }, { x: 0, y: 2, type: 'neutral' },
  ]);
  assert.deepEqual(result.shots.at(-2), { x: 2, y: 1, type: 'friendly' });
  assert.deepEqual(result.shots.at(-1), { x: 2, y: 0, type: 'enemy' });
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
  assert.equal(result.battle.score, 6);
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

const levelsSource = await readFile(new URL('./dist/levels.js', import.meta.url), 'utf8');
const { LEVELS } = await import(`data:text/javascript;base64,${Buffer.from(levelsSource).toString('base64')}`);

test('all authored starters are valid and every solution proves exactly its three enemy coordinates', () => {
  assert.equal(LEVELS.length, 4);
  for (const mission of LEVELS) {
    const starter = analyze(mission.starter, mission.goalSolution, mission);
    assert.equal(starter.error, undefined, mission.id);
    assert.equal(starter.valid, true, mission.id);
    const solution = analyze(mission.solution, mission.goalSolution, mission);
    assert.equal(solution.valid, true, mission.id);
    assert.equal(solution.goal.pass, true, mission.id);
    assert.equal(solution.exitStateCount, 3, mission.id);
    assert.equal(solution.traceStatus, 'terminated', mission.id);
    assert.deepEqual(solution.candidates, mission.enemies, mission.id);
    assert.equal(mission.enemies.some((unit) =>
      unit.x === solution.trace.at(-1).x && unit.y === solution.trace.at(-1).y), true, mission.id);
    const clear = order(createBattle(mission), mission.solution, mission.goalSolution, 'salvo');
    assert.equal(clear.battle.cleared, true, mission.id);
    assert.equal(clear.battle.friendlyKills, 0, mission.id);
    assert.equal(clear.shots.length, 3, mission.id);
    assert.equal(clear.battle.remaining, 5, mission.id);
    assert.equal(clear.battle.score, 8, mission.id);
  }
});

test('three singles score six while one salvo scores eight with the same fixed proof region', () => {
  for (const mission of LEVELS) {
    let battle = createBattle(mission);
    for (let shot = 0; shot < 3; shot++) {
      const result = order(battle, mission.solution, mission.goalSolution, 'single');
      assert.equal(result.analysis.goal.pass, true, mission.id);
      assert.equal(result.analysis.candidates.length, 3, mission.id);
      assert.equal(result.shots.length, 1, mission.id);
      assert.equal(result.shots[0].type, 'enemy', mission.id);
      battle = result.battle;
    }
    assert.equal(battle.cleared, true, mission.id);
    assert.equal(battle.score, 6, mission.id);
    const salvo = order(createBattle(mission), mission.solution, mission.goalSolution, 'salvo');
    assert.equal(salvo.battle.score - battle.score, 2, mission.id);
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
  const result = order(battle, mission.solution, 'x * 9007199254740991 == 0', 'salvo');
  assert.equal(typeof result.error, 'string');
  assert.equal(result.cost, 0);
  assert.equal(result.battle, battle);
  assert.deepEqual(result.shots, []);
});

test('interrupted arithmetic evaluation reports every proof check as incomplete', () => {
  const mission = LEVELS[0];
  const result = analyze(mission.solution, 'x * 9007199254740991 == 0', mission);
  assert.equal(typeof result.error, 'string');
  assert.equal(result.valid, false);
  assert.ok(result.checkedStateCount > 0 && result.checkedStateCount < DOMAIN.stateCount);
  assert.deepEqual(result.initial, { pass: null });
  assert.deepEqual(result.preservation, { pass: null });
  assert.deepEqual(result.goal, { pass: null });
});
