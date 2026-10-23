import test from 'node:test';
import assert from 'node:assert/strict';
import { Script } from 'node:vm';
import { LEVELS } from './dist/levels.js';
import { DOMAIN, analyze, createBattle, evaluate, order, parseExpression } from './dist/engine.js';

// These mathematical oracles are independent of both the displayed program
// and the level's step function. Only trusted, repository-owned code runs in VM.
const SPECIFICATIONS = {
  '01': {
    initialStates: [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 6, y: 2 }],
    endpoints: [{ x: 0, y: 4 }, { x: 0, y: 6 }, { x: 0, y: 8 }],
    calculate: ({ x, y }) => ({ x: 0, y: x + y }),
  },
  '02': {
    initialStates: [{ x: 5, y: 0 }, { x: 6, y: 0 }, { x: 8, y: 0 }],
    endpoints: [{ x: 2, y: 1 }, { x: 0, y: 2 }, { x: 2, y: 2 }],
    calculate: ({ x, y }) => ({ x: x % 3, y: y + Math.floor(x / 3) }),
  },
  '03': {
    initialStates: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }],
    endpoints: [{ x: 0, y: 1 }, { x: 0, y: 3 }, { x: 0, y: 6 }],
    calculate: ({ x, y }) => ({ x: 0, y: y + x * (x + 1) / 2 }),
  },
  '04': {
    initialStates: [{ x: 2, y: 0 }, { x: 5, y: 0 }, { x: 8, y: 0 }],
    endpoints: [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 4, y: 2 }],
    calculate: ({ x, y }) => {
      const input = x + y * y;
      const root = Math.floor(Math.sqrt(input));
      return { x: input - root * root, y: root };
    },
  },
};

const key = ({ x, y }) => `${x},${y}`;
const keys = (states) => states.map(key).sort();
const onBoard = ({ x, y }, size) => Number.isInteger(x) && Number.isInteger(y)
  && x >= 0 && y >= 0 && x < size && y < size;

function domainStatesWhere(predicate) {
  const result = [];
  for (let x = DOMAIN.min; x <= DOMAIN.max; x++) {
    for (let y = DOMAIN.min; y <= DOMAIN.max; y++) {
      const state = { x, y };
      if (predicate(state)) result.push(state);
    }
  }
  return result;
}

test('the expanded campaign preserves the four mathematical loops and coordinate normalization', () => {
  for (const id of [...Object.keys(SPECIFICATIONS), '05']) assert.ok(LEVELS.some(level => level.id === id));
});

for (const level of LEVELS.filter((level) => SPECIFICATIONS[level.id])) {
  test(`${level.id}: every input's displayed program and step trace match the mathematical result`, () => {
    const specification = SPECIFICATIONS[level.id];
    assert.ok(specification, 'unknown mission');
    assert.deepEqual(level.initialStates, specification.initialStates);
    assert.equal(new Set(keys(level.initialStates)).size, 3);
    const program = new Script(level.code, { filename: `mission-${level.id}.js` });
    const guard = parseExpression(level.guardSource);
    const invariant = parseExpression(level.solution);
    const result = analyze(level.solution, level.goalSolution, level);
    assert.equal(result.error, undefined);
    assert.equal(result.traces.length, level.initialStates.length);

    for (let index = 0; index < level.initialStates.length; index++) {
      const initial = level.initialStates[index];
      const expected = specification.calculate(initial);
      assert.deepEqual(expected, specification.endpoints[index]);
      assert.ok(onBoard(expected, level.size), `off-board final result for ${key(initial)}`);

      const context = { ...initial };
      program.runInNewContext(context, { timeout: 100 });
      assert.deepEqual({ x: context.x, y: context.y }, expected, 'displayed code result');

      const execution = result.traces[index];
      assert.deepEqual(execution.initial, initial);
      assert.equal(execution.traceStatus, 'terminated');
      assert.deepEqual(execution.trace[0], initial);
      assert.deepEqual(execution.trace.at(-1), expected, 'step trace result');
      assert.equal(new Set(keys(execution.trace)).size, execution.trace.length, 'no cyclic trace');
      for (let step = 0; step < execution.trace.length; step++) {
        const before = execution.trace[step];
        assert.equal(evaluate(invariant, before), true, 'solution holds along each real execution');
        const hasNext = step + 1 < execution.trace.length;
        assert.equal(evaluate(guard, before), hasNext, 'guard agrees with execution termination');
        if (hasNext) assert.deepEqual(level.step({ ...before }), execution.trace[step + 1]);
      }
    }
  });

  test(`${level.id}: enemies, actual results, ensures, and solution exits are exactly the same set`, () => {
    const specification = SPECIFICATIONS[level.id];
    const expected = keys(specification.endpoints);
    const invariant = parseExpression(level.solution);
    const goal = parseExpression(level.goalSolution);
    const guard = parseExpression(level.guardSource);
    const result = analyze(level.solution, level.goalSolution, level);

    assert.equal(result.valid, true);
    assert.equal(result.initial.pass, true);
    assert.equal(result.initial.checkedCount, 3);
    assert.equal(result.preservation.pass, true);
    assert.equal(result.goal.pass, true);
    assert.equal(result.checkedStateCount, DOMAIN.stateCount);
    assert.equal(result.exitStateCount, 3);
    assert.deepEqual(keys(level.enemies), expected);
    assert.deepEqual(keys(result.traces.map((execution) => execution.trace.at(-1))), expected);
    assert.deepEqual(keys(result.candidates), expected);
    assert.deepEqual(keys(domainStatesWhere((state) => evaluate(goal, state))), expected);
    assert.deepEqual(keys(domainStatesWhere((state) => evaluate(invariant, state) && !evaluate(guard, state))), expected);
    assert.ok(level.enemies.every((state) => onBoard(state, level.size)));
    const allies = new Set(keys(level.allies));
    assert.ok(expected.every((coordinate) => !allies.has(coordinate)));
  });

  test(`${level.id}: the starter preserves all inputs but exposes a friendly position`, () => {
    const result = analyze(level.starter, level.goalSolution, level);
    assert.equal(result.error, undefined);
    assert.equal(result.valid, true);
    assert.equal(result.initial.pass, true);
    assert.equal(result.initial.checkedCount, 3);
    assert.equal(result.preservation.pass, true);
    assert.equal(result.goal.pass, false);
    const candidates = new Set(keys(result.candidates));
    assert.ok(level.enemies.every((enemy) => candidates.has(key(enemy))));
    assert.ok(level.allies.some((ally) => candidates.has(key(ally))));
  });

  test(`${level.id}: weighted targets score fifteen for three singles or seventeen for one salvo`, () => {
    let singleBattle = createBattle(level);
    assert.equal(singleBattle.remaining, 6);
    for (let index = 0; index < 3; index++) {
      const result = order(singleBattle, level.solution, level.goalSolution, 'single');
      assert.equal(result.reason, 'fired');
      assert.equal(result.cost, 1);
      assert.equal(result.shots.length, 1);
      assert.equal(result.shots[0].type, 'enemy');
      singleBattle = result.battle;
    }
    assert.equal(singleBattle.cleared, true);
    assert.equal(singleBattle.enemyKills, 3);
    assert.equal(singleBattle.friendlyKills, 0);
    assert.equal(singleBattle.remaining, 3);
    assert.equal(singleBattle.score, 15);

    const salvo = order(createBattle(level), level.solution, level.goalSolution, 'salvo');
    assert.equal(salvo.reason, 'fired');
    assert.equal(salvo.cost, 1);
    assert.equal(salvo.shots.length, 3);
    assert.ok(salvo.shots.every((shot) => shot.type === 'enemy'));
    assert.equal(salvo.battle.cleared, true);
    assert.equal(salvo.battle.enemyKills, 3);
    assert.equal(salvo.battle.friendlyKills, 0);
    assert.equal(salvo.battle.remaining, 5);
    assert.equal(salvo.battle.score, 17);
  });
}

const normalizationLevel = () => {
  const level = LEVELS.find((candidate) => candidate.id === '05');
  assert.ok(level, 'coordinate normalization mission must exist');
  return level;
};

// JavaScript's % preserves the dividend's sign; this is the nonnegative
// Euclidean remainder required by the mathematical normalization problem.
const normalizedResult = ({ x }) => ({ x: ((x % 3) + 3) % 3, y: 0 });
const inDomain = ({ x, y }) => Number.isInteger(x) && Number.isInteger(y)
  && x >= DOMAIN.min && x <= DOMAIN.max && y >= DOMAIN.min && y <= DOMAIN.max;

function runNormalizationSteps(level, initial) {
  const guard = parseExpression(level.guardSource);
  let current = { ...initial };
  let steps = 0;
  while (evaluate(guard, current)) {
    assert.ok(inDomain(current), `execution left the domain from ${key(initial)}`);
    assert.ok(steps < DOMAIN.stateCount, `execution failed to terminate from ${key(initial)}`);
    current = level.step({ ...current });
    steps++;
  }
  assert.ok(inDomain(current));
  return current;
}

test('05: displayed code and step execution normalize negative values, boundaries, and representative inputs', () => {
  const level = normalizationLevel();
  const program = new Script(level.code, { filename: 'mission-05.js' });
  const cases = [
    ...level.traceInputs,
    { x: DOMAIN.min, y: DOMAIN.min }, { x: DOMAIN.min, y: DOMAIN.max },
    { x: DOMAIN.max, y: DOMAIN.min }, { x: DOMAIN.max, y: DOMAIN.max },
    { x: -31, y: 0 }, { x: -30, y: 0 }, { x: -3, y: -1 },
    { x: -2, y: 1 }, { x: -1, y: 0 }, { x: 0, y: 0 },
    { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 1 },
    { x: 4, y: -1 }, { x: 30, y: 0 }, { x: 31, y: 0 },
  ];
  for (const initial of cases) {
    const expected = normalizedResult(initial);
    const context = { ...initial };
    program.runInNewContext(context, { timeout: 100 });
    assert.deepEqual({ x: context.x, y: context.y }, expected, `displayed code for ${key(initial)}`);
    assert.deepEqual(runNormalizationSteps(level, initial), expected, `step execution for ${key(initial)}`);
  }
});

test('05: every one of the 4225 domain inputs terminates in-domain at its Euclidean remainder', () => {
  const level = normalizationLevel();
  const endpoints = new Set();
  const inputs = domainStatesWhere(() => true);
  assert.equal(inputs.length, 4225);
  for (const initial of inputs) {
    const endpoint = runNormalizationSteps(level, initial);
    assert.deepEqual(endpoint, normalizedResult(initial), `result for ${key(initial)}`);
    assert.ok(onBoard(endpoint, level.size));
    endpoints.add(key(endpoint));
  }
  assert.deepEqual([...endpoints].sort(), ['0,0', '1,0', '2,0']);
  assert.deepEqual(keys(level.enemies), [...endpoints].sort());
});

test('05: true proves exactly the three actual endpoints and the authored ensures over the full domain', () => {
  const level = normalizationLevel();
  assert.equal(level.initialCondition, 'true');
  assert.equal(level.initialStates, undefined);
  assert.equal(level.solution, 'true');
  const expected = ['0,0', '1,0', '2,0'];
  const result = analyze(level.solution, level.goalSolution, level);
  const invariant = parseExpression(level.solution);
  const goal = parseExpression(level.goalSolution);
  const guard = parseExpression(level.guardSource);
  assert.equal(result.error, undefined);
  assert.equal(result.valid, true);
  assert.equal(result.initial.pass, true);
  assert.equal(result.initial.checkedCount, 4225);
  assert.equal(result.preservation.pass, true);
  assert.equal(result.goal.pass, true);
  assert.equal(result.checkedStateCount, DOMAIN.stateCount);
  assert.equal(result.exitStateCount, 3);
  assert.deepEqual(keys(result.candidates), expected);
  assert.deepEqual(keys(level.enemies), expected);
  assert.deepEqual(keys(domainStatesWhere((state) => evaluate(goal, state))), expected);
  assert.deepEqual(keys(domainStatesWhere((state) => evaluate(invariant, state) && !evaluate(guard, state))), expected);
  assert.ok(level.allies.every((ally) => !expected.includes(key(ally))));
});

test('05: three representative traces never restrict the initial-state proof to those samples', () => {
  const level = normalizationLevel();
  const traceInputs = [{ x: 6, y: 3 }, { x: -5, y: 2 }, { x: 2, y: -3 }];
  assert.deepEqual(level.traceInputs, traceInputs);
  const result = analyze(level.solution, level.goalSolution, level);
  assert.equal(result.initial.checkedCount, 4225);
  assert.equal(result.traces.length, 3);
  assert.deepEqual(result.traces.map((execution) => execution.initial), traceInputs);
  for (const execution of result.traces) {
    assert.equal(execution.traceStatus, 'terminated');
    assert.deepEqual(execution.trace[0], execution.initial);
    assert.deepEqual(execution.trace.at(-1), normalizedResult(execution.initial));
  }

  const excludesUnshownCorner = analyze('x != -32 || y != -32', level.goalSolution, level);
  assert.equal(excludesUnshownCorner.initial.pass, false);
  assert.equal(excludesUnshownCorner.initial.checkedCount, 4225);
  assert.deepEqual(excludesUnshownCorner.initial.before, { x: -32, y: -32 });
  assert.ok(!keys(traceInputs).includes(key(excludesUnshownCorner.initial.before)));
});

test('05: the nonnegative starter fails initialization and cannot fire despite valid exit targets', () => {
  const level = normalizationLevel();
  assert.equal(level.starter, 'x >= 0 && y >= 0');
  const result = analyze(level.starter, level.goalSolution, level);
  assert.equal(result.error, undefined);
  assert.equal(result.valid, false);
  assert.equal(result.initial.pass, false);
  assert.equal(result.initial.checkedCount, 4225);
  assert.ok(result.initial.before.x < 0 || result.initial.before.y < 0);
  assert.equal(result.preservation.pass, true);
  assert.equal(result.goal.pass, true);
  assert.deepEqual(keys(result.candidates), keys(level.enemies));
  const shot = order(createBattle(level), level.starter, level.goalSolution, 'salvo');
  assert.equal(shot.reason, 'invalid-invariant');
  assert.equal(shot.dud, true);
  assert.equal(shot.cost, 1);
  assert.equal(shot.shots.length, 0);
  assert.equal(shot.battle.enemyKills, 0);
});
