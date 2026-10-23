import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { LEVELS as CAMPAIGN_LEVELS } from './dist/levels.js';
import { BASIC_LEVELS } from './dist/levels-basic.js';
import { ADVANCED_LEVELS } from './dist/levels-advanced.js';
import { DOMAIN, analyze, battlefieldCasesForLevel, createBattle, evaluate, initialStatesForLevel, isInitializedLevel, order, parseExpression } from './dist/engine.js';
import { computeRefinementRisks } from './dist/refinement-risk.js';
import { unitPoints, withUnitBranches } from './dist/unit-types.js';

// Keep the previous finite-entry campaigns as regression fixtures. Their
// hard-coded examples are not exposed as the new initialized campaign.
const LEGACY_FIXTURES = [
  { id:'01', initialStates:[{x:2,y:2},{x:4,y:2},{x:6,y:2}], guardSource:'x > 0',
    step:({x,y})=>({x:x-1,y:y+1}), code:'while (x > 0) { x = x - 1; y = y + 1; }',
    enemies:[{x:0,y:4},{x:0,y:6},{x:0,y:8}], allies:[{x:0,y:3},{x:0,y:5},{x:0,y:7}],
    starter:'x >= 0 && y >= 0 && x + y <= 8',
    solution:'x >= 0 && y >= 0 && (x + y == 4 || x + y == 6 || x + y == 8)',
    goalSolution:'x == 0 && (y == 4 || y == 6 || y == 8)' },
  { id:'02', initialStates:[{x:5,y:0},{x:6,y:0},{x:8,y:0}], guardSource:'x >= 3',
    step:({x,y})=>({x:x-3,y:y+1}), code:'while (x >= 3) { x = x - 3; y = y + 1; }',
    enemies:[{x:0,y:2},{x:2,y:1},{x:2,y:2}], allies:[{x:0,y:1},{x:1,y:1},{x:1,y:2}],
    starter:'x >= 0 && y >= 0 && x + 3 * y <= 8',
    solution:'x >= 0 && y >= 0 && (x + 3 * y == 5 || x + 3 * y == 6 || x + 3 * y == 8)',
    goalSolution:'(x == 0 && y == 2) || (x == 2 && y == 1) || (x == 2 && y == 2)' },
  { id:'03', initialStates:[{x:1,y:0},{x:2,y:0},{x:3,y:0}], guardSource:'x > 0',
    step:({x,y})=>({x:x-1,y:y+x}), code:'while (x > 0) { y = y + x; x = x - 1; }',
    enemies:[{x:0,y:1},{x:0,y:3},{x:0,y:6}], allies:[{x:0,y:2},{x:0,y:4},{x:0,y:5}],
    starter:'x >= 0 && y >= 0 && x * (x + 1) + 2 * y <= 12',
    solution:'x >= 0 && y >= 0 && (x * (x + 1) + 2 * y == 2 || x * (x + 1) + 2 * y == 6 || x * (x + 1) + 2 * y == 12)',
    goalSolution:'x == 0 && (y == 1 || y == 3 || y == 6)' },
  { id:'04', initialStates:[{x:2,y:0},{x:5,y:0},{x:8,y:0}], guardSource:'x >= 2 * y + 1',
    step:({x,y})=>({x:x-(2*y+1),y:y+1}), code:'while (x >= 2 * y + 1) { x = x - (2 * y + 1); y = y + 1; }',
    enemies:[{x:1,y:1},{x:1,y:2},{x:4,y:2}], allies:[{x:0,y:1},{x:2,y:1},{x:2,y:2}],
    starter:'x >= 0 && y >= 0 && x + y * y <= 8',
    solution:'x >= 0 && y >= 0 && (x + y * y == 2 || x + y * y == 5 || x + y * y == 8)',
    goalSolution:'(x == 1 && y == 1) || (x == 1 && y == 2) || (x == 4 && y == 2)' },
  { id:'05', initialCondition:'true', traceInputs:[{x:6,y:3},{x:-5,y:2},{x:2,y:-3}],
    guardSource:'x < 0 || x >= 3 || y != 0',
    step:({x,y})=>({x:x<0?x+3:x>=3?x-3:x,y:y<0?y+1:y>0?y-1:y}),
    code:'while (x < 0 || x >= 3 || y != 0) { if (x < 0) x += 3; else if (x >= 3) x -= 3; if (y < 0) y++; else if (y > 0) y--; }',
    enemies:[{x:0,y:0},{x:1,y:0},{x:2,y:0}], allies:[{x:0,y:1},{x:1,y:2},{x:3,y:0}],
    starter:'x >= 0 && y >= 0', solution:'true', goalSolution:'x >= 0 && x < 3 && y == 0' },
];
const LEVELS = [...LEGACY_FIXTURES, ...BASIC_LEVELS, ...ADVANCED_LEVELS].map(source => {
  const level = { size:9, commands:6, ...source };
  return withUnitBranches(level, computeRefinementRisks(level));
});

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
    const witnesses = [...new Set(risks.flatMap(risk => keys(risk.friendlies)))].sort();
    const friendlyCells = new Set(keys(level.allies));
    assert.deepEqual(keys(coarse.candidates.filter(cell => friendlyCells.has(key(cell)))), witnesses);
    assert.equal(coarseFire.reason, 'fired');
    assert.equal(coarseFire.cost, 1);
    assert.equal(coarseFire.dud, false);
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

const initializedFixture = () => ({
  id:'context-regression', size:9, commands:6,
  initialize:({a,b})=>({x:Math.abs(a),y:Math.abs(b),n:Math.abs(a),m:Math.abs(b)}),
  battleInputs:[{a:1,b:1},{a:-1,b:1},{a:2,b:0}],
  guardSource:'x > 0', step:({x,y})=>({x:x-1,y:y+1}),
  starter:'x >= 0 && x <= n && y >= m && x + y <= n + m + 1',
  referenceInvariant:'x >= 0 && x <= n && y >= m && x + y <= n + m + 1',
  solution:'x >= 0 && x <= n && y >= m && x + y == n + m',
  goalSolution:'x == 0 && y == n + m',
  enemies:[{x:0,y:2}], allies:[{x:0,y:0},{x:0,y:1},{x:0,y:3}],
});

function assertContextRegion(level, context) {
  const predicate = parseExpression(context.coarseInvariant);
  const guard = parseExpression(level.guardSource);
  assert.equal(evaluate(predicate, { ...context.initial, ...context.parameters }), true);
  for (let x=DOMAIN.min;x<=DOMAIN.max;x++) for (let y=DOMAIN.min;y<=DOMAIN.max;y++) {
    const before={x,y,...context.parameters};
    if (!evaluate(predicate,before) || !evaluate(guard,before)) continue;
    const after={...level.step({...before}),...context.parameters};
    assert.ok(after.x>=DOMAIN.min&&after.x<=DOMAIN.max&&after.y>=DOMAIN.min&&after.y<=DOMAIN.max);
    assert.equal(evaluate(predicate,after),true,'every state in the contextual box must preserve it');
  }
  const exposed=level.allies.filter(ally=>evaluate(predicate,{...ally,...context.parameters})
    &&!evaluate(guard,{...ally,...context.parameters}));
  assert.deepEqual(keys(context.friendlies),keys(exposed));
}

test('initialized risk keeps input contexts separate and unions witnesses at a shared endpoint', () => {
  const level=initializedFixture();
  const risks=computeRefinementRisks(level);
  assert.equal(risks.length,1);
  const risk=risks[0];
  assert.equal(risk.scope,'battlefield-contexts');
  assert.equal(risk.initialCount,3);
  assert.equal(risk.contexts.length,3);
  assert.deepEqual(risk.contexts.map(context=>context.friendlies.length),[2,2,3]);
  assert.equal(risk.friendlyCount,3,'one friendly coordinate is never counted twice');
  assert.deepEqual(keys(risk.friendlies),['0,0','0,1','0,3']);
  for(const context of risk.contexts) assertContextRegion(level,context);
  const assigned=withUnitBranches(level,risks);
  assert.deepEqual(assigned.enemies.map(unitPoints),[6]);
  assert.equal(assigned.enemies.length,1,'three displayed inputs need not have three different results');
  risks[0].contexts[0].parameters.n=99;
  risks[0].contexts[0].friendlies[0].x=32;
  assert.equal(assigned.enemies[0].targetingRisk.contexts[0].parameters.n,1);
  assert.equal(assigned.enemies[0].targetingRisk.contexts[0].friendlies[0].x,0);
});

test('context risk is battlefield-scoped and does not falsely cover the complete verification input window', () => {
  const level=initializedFixture();
  const source=computeRefinementRisks(level)[0].coarseInvariant;
  const report=analyze(source,level.goalSolution,level);
  assert.equal(report.initial.checkedCount,81);
  assert.equal(report.initial.pass,false,'the diagnostic formula deliberately guards its three raw inputs');
  assert.equal(report.preservation.pass,true);
});

test('contextual reference validation rejects unreachable preservation failures and uninitialized predicates', () => {
  const level=initializedFixture();
  assert.throws(()=>computeRefinementRisks({...level,referenceInvariant:'x > 0'}),/preserved/);
  assert.throws(()=>computeRefinementRisks({...level,referenceInvariant:'x == 0'}),/after initialization/);
  assert.throws(()=>computeRefinementRisks({...level,referenceInvariant:'true'}),/verification window/);
  assert.throws(()=>computeRefinementRisks({...level,referenceInvariant:'x + y'}),/predicates/);
});

for(const level of CAMPAIGN_LEVELS.filter(isInitializedLevel)) {
  test(`${level.id}: risk uses all three visible contexts, their own parameters, and only terminal friendly witnesses`,()=>{
    const risks=computeRefinementRisks(level);
    assert.deepEqual(keys(risks),keys(level.enemies));
    assert.equal(risks.reduce((sum,risk)=>sum+risk.initialCount,0),3);
    const expectedInputs=battlefieldCasesForLevel(level).map(context=>`${context.a},${context.b}`).sort();
    const actualInputs=[];
    for(const risk of risks){
      assert.equal(risk.scope,'battlefield-contexts');
      assert.equal(risk.baselineSource,level.referenceInvariant??level.starter);
      const witnesses=new Set();
      for(const context of risk.contexts){
        actualInputs.push(`${context.input.a},${context.input.b}`);
        assertContextRegion(level,context);
        context.friendlies.forEach(friend=>witnesses.add(key(friend)));
        const guard=parseExpression(level.guardSource);
        let state={...context.initial,...context.parameters};
        const seen=new Set();
        while(evaluate(guard,state)){
          assert.ok(!seen.has(key(state)),'a displayed input must terminate');seen.add(key(state));
          state={...level.step({...state}),...context.parameters};
        }
        assert.equal(key(state),key(risk),'only contexts actually reaching this enemy contribute');
      }
      assert.deepEqual(keys(risk.friendlies),[...witnesses].sort());
      assert.equal(risk.friendlyCount,witnesses.size);
      const assigned=level.enemies.find(enemy=>key(enemy)===key(risk));
      assert.equal(unitPoints(assigned),risk.friendlyCount===0?2:risk.friendlyCount===1?4:6);
    }
    assert.deepEqual(actualInputs.sort(),expectedInputs);
  });
}
