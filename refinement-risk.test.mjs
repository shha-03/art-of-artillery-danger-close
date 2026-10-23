import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { LEVELS } from './dist/levels.js';
import { DOMAIN, analyze, createBattle, evaluate, initialStatesForLevel, order, parseExpression } from './dist/engine.js';
import { computeRefinementRisks } from './dist/refinement-risk.js';
import { unitPoints, withUnitBranches } from './dist/unit-types.js';

const key = ({ x, y }) => `${x},${y}`;
const keys = states => states.map(key).sort();
const point = ({ x, y }) => ({ x, y });
const levelById = id => LEVELS.find(level => level.id === id);
const riskByTarget = risks => Object.fromEntries(risks.map(risk => [key(risk), risk]));
const union = risks => risks.map(risk => `(${risk.coarseInvariant})`).join(' || ');
const risksById = new Map(LEVELS.map(level => [level.id, computeRefinementRisks(level)]));

// Reviewed exposure fixtures, in authored enemy order. These are consequences
// of a particular abstraction, not a strict ranking of proof difficulty.
const EXPECTED_EXPOSURE = {
  '06': [0, 0, 0], '01': [3, 3, 3], '07': [2, 3, 3], '09': [3, 3, 3],
  '11': [0, 0, 0], '08': [3, 3, 3], '12': [3, 3, 3], '05': [0, 0, 0],
  '10': [1, 1, 1], '02': [3, 3, 3], '03': [3, 3, 3], '14': [0, 2, 2],
  '04': [2, 3, 3], '16': [3, 3, 3], '13': [3, 3, 3], '15': [0, 0, 0],
  '17': [0, 0, 0], '18': [1, 1, 1], '19': [2, 1, 2], '20': [3, 3, 3],
};

function allDomainStates() {
  const states = [];
  for (let x = DOMAIN.min; x <= DOMAIN.max; x++) {
    for (let y = DOMAIN.min; y <= DOMAIN.max; y++) states.push({ x, y });
  }
  return states;
}

function groupedInputsFromDisplayedCode(level) {
  // A different executable representation supplies the basin oracle. The risk
  // calculator uses level.step; this runs the literal program shown to players.
  const program = new Script(level.code);
  const context = createContext({ x: 0, y: 0 });
  const groups = new Map(level.enemies.map(enemy => [key(enemy), []]));
  const inputs = level.initialCondition === 'true' ? allDomainStates() : initialStatesForLevel(level);
  for (const initial of inputs) {
    context.x = initial.x;
    context.y = initial.y;
    program.runInContext(context, { timeout: 100 });
    const target = key(context);
    assert.ok(groups.has(target), `${level.id}: input ${key(initial)} ends at undeployed ${target}`);
    groups.get(target).push(initial);
  }
  return { groups, inputCount: inputs.length };
}

for (const level of LEVELS) {
  test(`${level.id}: every basin is covered by an inductive coarse region and the union covers all permitted inputs`, () => {
    const risks = risksById.get(level.id);
    assert.deepEqual(keys(risks), keys(level.enemies));
    assert.deepEqual(risks.map(risk => risk.friendlyCount), EXPECTED_EXPOSURE[level.id]);
    const { groups, inputCount } = groupedInputsFromDisplayedCode(level);
    assert.equal(risks.reduce((count, risk) => count + risk.initialCount, 0), inputCount);
    const { initialCondition, traceInputs, ...finiteMission } = level;
    const guard = parseExpression(level.guardSource);
    const solution = parseExpression(level.solution);

    for (const risk of risks) {
      assert.equal(risk.model, 'interval-refinement-v1');
      const inputs = groups.get(key(risk));
      assert.ok(inputs.length > 0, 'every deployed enemy is reached by an allowed input');
      assert.equal(risk.initialCount, inputs.length);
      const basin = { ...finiteMission, initialStates: inputs };
      const checked = analyze(risk.coarseInvariant, 'true', basin);
      assert.equal(checked.error, undefined);
      assert.equal(checked.initial.pass, true);
      assert.equal(checked.initial.checkedCount, inputs.length);
      assert.equal(checked.preservation.pass, true, 'all domain states must preserve the region, not just sampled traces');
      assert.equal(checked.checkedStateCount, DOMAIN.stateCount);

      const predicate = parseExpression(risk.coarseInvariant);
      const exposed = level.allies.filter(ally => evaluate(predicate, ally) && !evaluate(guard, ally));
      assert.deepEqual(keys(risk.friendlies), keys(exposed));
      assert.equal(risk.friendlyCount, exposed.length);
      assert.equal(new Set(keys(risk.friendlies)).size, exposed.length);
      for (const witness of risk.friendlies) {
        assert.ok(keys(level.allies).includes(key(witness)));
        assert.equal(evaluate(guard, witness), false, 'a loop-intermediate ally is not a firing candidate');
        assert.equal(evaluate(predicate, witness), true);
        assert.equal(evaluate(solution, witness), false, 'the exact invariant removes the false target');
      }
      const deployed = level.enemies.find(enemy => key(enemy) === key(risk));
      const { x, y, ...expectedEvidence } = risk;
      assert.deepEqual(deployed.targetingRisk, expectedEvidence);
      const expectedBranch = exposed.length === 0 ? 'infantry' : exposed.length === 1 ? 'armor' : 'artillery';
      assert.equal(deployed.branch, expectedBranch);
      assert.equal(unitPoints(deployed), exposed.length === 0 ? 2 : exposed.length === 1 ? 4 : 6);
      assert.equal(Object.hasOwn(deployed.targetingRisk, 'shotRank'), false);
    }

    const coarseSource = union(risks);
    const coarse = analyze(coarseSource, level.goalSolution, level);
    assert.equal(coarse.error, undefined);
    assert.equal(coarse.valid, true, 'the disjunction, rather than an isolated basin, is a legal global invariant');
    assert.equal(coarse.initial.checkedCount, inputCount);
    const coarseFire = order(createBattle(level), coarseSource, level.goalSolution, 'salvo');
    assert.equal(coarseFire.reason, 'fired');
    const witnesses = [...new Set(risks.flatMap(risk => keys(risk.friendlies)))].sort();
    assert.deepEqual(keys(coarseFire.shots.filter(shot => shot.type === 'friendly')), witnesses);
    assert.equal(coarseFire.battle.friendlyKills, witnesses.length);
    if (witnesses.length) assert.equal(coarse.goal.pass, false);

    const exactFire = order(createBattle(level), level.solution, level.goalSolution, 'salvo');
    assert.equal(exactFire.analysis.valid, true);
    assert.equal(exactFire.analysis.goal.pass, true);
    assert.deepEqual(keys(exactFire.shots), keys(level.enemies));
    assert.equal(exactFire.battle.friendlyKills, 0);
    assert.equal(exactFire.battle.friendlyPoints, 0);
  });
}

test('closure must include unreachable combinations inside a box, not just the actual execution trace', () => {
  const level = levelById('14');
  const basin = { ...level, initialStates: [{ x: 1, y: 0 }] };
  const rawTraceHull = `(${level.starter}) && x >= 0 && x <= 1 && y >= 0 && y <= 1`;
  const beforeClosure = analyze(rawTraceHull, 'true', basin);
  assert.equal(beforeClosure.initial.pass, true);
  assert.equal(beforeClosure.preservation.pass, false);
  assert.deepEqual(beforeClosure.preservation.before, { x: 1, y: 1 });
  assert.deepEqual(beforeClosure.preservation.after, { x: 0, y: 2 });
  assert.ok(!beforeClosure.trace.some(state => key(state) === '1,1'));
  const risk = risksById.get('14').find(candidate => key(candidate) === '0,1');
  assert.ok(risk.iterations > 0);
  assert.equal(risk.bounds.maxY, 4);
  assert.equal(analyze(risk.coarseInvariant, 'true', basin).valid, true);
  assert.deepEqual(keys(risk.friendlies), ['0,2', '0,3']);
});

test('ties and falling values are intentional: square boundary and Fibonacci targets are not shot-order ranks', () => {
  const square = levelById('14');
  assert.deepEqual(square.enemies.map(unitPoints), [2, 6, 6]);
  assert.deepEqual(levelById('19').enemies.map(unitPoints), [6, 4, 6]);
  assert.deepEqual(levelById('06').enemies.map(unitPoints), [2, 2, 2]);
  assert.deepEqual(levelById('01').enemies.map(unitPoints), [6, 6, 6]);
  assert.deepEqual(risksById.get('19').map(risk => keys(risk.friendlies)), [
    ['2,5', '4,5'], ['4,5'], ['2,5', '4,5'],
  ]);
});

test('moving an exposed ally changes risk while allies behind a true guard are excluded', () => {
  const level = levelById('14');
  const original = risksById.get('14');
  const coarse = parseExpression(original[1].coarseInvariant);
  const intermediateAlly = { x: 1, y: 3 };
  assert.equal(evaluate(coarse, intermediateAlly), true);
  assert.equal(evaluate(parseExpression(level.guardSource), intermediateAlly), true);
  assert.ok(!keys(original[1].friendlies).includes(key(intermediateAlly)));

  const moved = { ...level, allies: [{ x: 8, y: 8 }, { x: 0, y: 3 }, intermediateAlly] };
  const changed = computeRefinementRisks(moved);
  assert.deepEqual(changed.map(risk => risk.friendlyCount), [0, 1, 1]);
  assert.deepEqual(withUnitBranches(moved, changed).enemies.map(unitPoints), [2, 4, 4]);
  assert.deepEqual(changed.map(risk => risk.coarseInvariant), original.map(risk => risk.coarseInvariant));
  assert.deepEqual(keys(level.allies), ['0,2', '0,3', '1,3']);
});

test('enemy, ally, risk, and finite-input array ordering cannot change coordinate-associated values', () => {
  for (const level of LEVELS) {
    const reordered = {
      ...level,
      enemies: [...level.enemies].reverse(),
      allies: [...level.allies].reverse(),
      ...(level.initialStates ? { initialStates: [...level.initialStates].reverse() } : {}),
    };
    const original = riskByTarget(risksById.get(level.id));
    const risks = computeRefinementRisks(reordered);
    assert.deepEqual(keys(risks), keys(level.enemies));
    for (const risk of risks) {
      const expected = original[key(risk)];
      assert.equal(risk.friendlyCount, expected.friendlyCount);
      assert.equal(risk.initialCount, expected.initialCount);
      assert.deepEqual(risk.bounds, expected.bounds);
      assert.equal(risk.coarseInvariant, expected.coarseInvariant);
      assert.deepEqual(keys(risk.friendlies), keys(expected.friendlies));
    }
    const assigned = withUnitBranches(reordered, [...risks].reverse());
    const expectedPoints = Object.fromEntries(level.enemies.map(enemy => [key(enemy), unitPoints(enemy)]));
    assert.deepEqual(Object.fromEntries(assigned.enemies.map(enemy => [key(enemy), unitPoints(enemy)])), expectedPoints);
  }
});

test('branch attachment preserves source objects and deep-copies risk evidence', () => {
  const level = levelById('19');
  const risks = computeRefinementRisks(level);
  const sourceUnits = structuredClone({ enemies: level.enemies, allies: level.allies });
  const evidence = structuredClone(risks);
  const assigned = withUnitBranches(level, risks);
  assert.deepEqual({ enemies: level.enemies, allies: level.allies }, sourceUnits);
  assert.deepEqual(risks, evidence);
  assert.deepEqual(assigned.enemies.map(point), level.enemies.map(point));
  assert.deepEqual(assigned.allies.map(point), level.allies.map(point));
  assert.notEqual(assigned.enemies, level.enemies);
  assert.notEqual(assigned.enemies[0], level.enemies[0]);
  assert.notEqual(assigned.allies[0], level.allies[0]);
  assert.notEqual(assigned.enemies[0].targetingRisk.friendlies, risks[0].friendlies);
  assert.notEqual(assigned.enemies[0].targetingRisk.friendlies[0], risks[0].friendlies[0]);
  assert.notEqual(assigned.enemies[0].targetingRisk.bounds, risks[0].bounds);
  risks[0].friendlies[0].x = 32;
  risks[0].bounds.minX = -32;
  assert.deepEqual(assigned.enemies[0].targetingRisk.friendlies, evidence[0].friendlies);
  assert.deepEqual(assigned.enemies[0].targetingRisk.bounds, evidence[0].bounds);
});

test('the unrestricted mission partitions all 4225 inputs and never infers risk from its display samples', () => {
  const level = levelById('05');
  const risks = risksById.get('05');
  assert.equal(level.initialCondition, 'true');
  assert.deepEqual(risks.map(risk => risk.initialCount), [21 * 65, 22 * 65, 22 * 65]);
  assert.equal(risks.reduce((sum, risk) => sum + risk.initialCount, 0), 4225);
  assert.ok(risks.every(risk => risk.baselineSource === 'true' && risk.friendlyCount === 0));
  assert.deepEqual(level.enemies.map(unitPoints), [2, 2, 2]);
  const fewerSamples = { ...level, traceInputs: [{ x: 0, y: 0 }] };
  assert.deepEqual(computeRefinementRisks(fewerSamples), risks);
  const otherSamples = { ...level, traceInputs: [{ x: -32, y: -32 }, { x: 32, y: 32 }] };
  assert.deepEqual(computeRefinementRisks(otherSamples), risks);
  const guard = parseExpression(level.guardSource);
  assert.ok(level.allies.every(ally => evaluate(guard, ally)));
});
