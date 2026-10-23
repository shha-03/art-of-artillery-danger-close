import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { LEVELS, CHAPTERS } from './dist/levels.js';
import {
  INPUT_DOMAIN, battlefieldCasesForLevel, createBattle, isInitializedLevel,
  order, previewCandidatesForLevel, projectPredicate, verificationCasesForLevel, stateKey,
} from './dist/engine.js';
import { UNIT_TYPES, unitPoints } from './dist/unit-types.js';

const keys=states=>states.map(stateKey).sort();

test('twenty existing programs and four spatial programs form six localized chapters',()=>{
  assert.equal(LEVELS.length,24);
  assert.deepEqual(LEVELS.map(level=>level.id),[
    ...Array.from({length:20},(_,i)=>'g'+String(i+1).padStart(2,'0')), 's01','s02','s03','s04',
  ]);
  assert.deepEqual(CHAPTERS.map(chapter=>chapter.id),[1,2,3,4,5,6]);
  for(const chapter of CHAPTERS){
    assert.equal(LEVELS.filter(level=>level.chapter===chapter.id).length,4);
    for(const copy of [chapter,chapter.en])for(const field of ['name','description'])assert.ok(copy[field]?.trim());
  }
  for(const level of LEVELS){
    assert.equal(isInitializedLevel(level),true);
    assert.equal(level.initialStates,undefined);
    assert.equal(level.initialCondition,undefined,'the program has no example-specific input precondition');
    assert.equal(level.battleInputs.length,3);
    assert.equal(new Set(level.battleInputs.map(({a,b})=>a+','+b)).size,3);
    assert.ok(level.enemies.length>=1&&level.enemies.length<=3);
    assert.equal(new Set(keys(level.enemies)).size,level.enemies.length);
    assert.ok(level.solution.trim()&&level.goalSolution.trim()&&level.referenceInvariant.trim());
    for(const copy of [level,level.en]){
      for(const field of ['name','brief','concept'])assert.ok(copy[field]?.trim(),level.id+': '+field);
      assert.equal(copy.hints.length,3);
      assert.ok(copy.hints.every(hint=>hint.trim()));
    }
  }
});

test('verification always covers the full raw-input window while the battlefield projects three contexts',()=>{
  for(const level of LEVELS){
    const inputs=verificationCasesForLevel(level),displayed=battlefieldCasesForLevel(level);
    assert.equal(inputs.length,INPUT_DOMAIN.stateCount);
    assert.equal(inputs.length,81);
    assert.equal(displayed.length,3);
    assert.equal(inputs[0].a,INPUT_DOMAIN.min);
    assert.equal(inputs.at(-1).b,INPUT_DOMAIN.max);
    assert.equal(new Set(inputs.map(({a,b})=>a+','+b)).size,81);
    const candidates=keys(previewCandidatesForLevel(level.solution,level));
    assert.deepEqual(candidates,keys(projectPredicate(level.goalSolution,level)));
    assert.ok(keys(level.enemies).every(location=>candidates.includes(location)));
    assert.ok(keys(level.allies).every(location=>!candidates.includes(location)));
    if(level.id!=='s04')assert.deepEqual(candidates,keys(level.enemies));
    assert.ok(level.allies.every(ally=>!keys(level.enemies).includes(keys([ally])[0])));
    // Inputs outside the checking window are initialized without wrapping,
    // clamping, or a fixed list. This is a regression, not an unbounded proof.
    const wide=level.initialize({a:-17,b:11});
    assert.equal(wide.n,17);
    assert.equal(wide.m,11);
  }
});

test('the spatial chapter preserves every existing algorithm, solution, deployment, risk, and branch value',()=>{
  const original=LEVELS.slice(0,20).map(({id,chapter,initializationCode,code,guardSource,solution,goalSolution,starter,referenceInvariant,battleInputs,enemies,allies})=>
    ({id,chapter,initializationCode,code,guardSource,solution,goalSolution,starter,referenceInvariant,battleInputs,enemies,allies}));
  // Captured before adding the spatial chapter, including full risk evidence.
  assert.equal(createHash('sha256').update(JSON.stringify(original)).digest('hex'),
    'b93fad86259ee0503200972b140d5e2414e6509cfb9188f9a1656142f0278823');
  const pairing=LEVELS.find(level=>level.id==='s02');
  assert.equal(pairing.enemies.filter(unit=>unit.x===0&&unit.y===0).length,2);
  assert.deepEqual(pairing.enemies.filter(unit=>unit.x===0&&unit.y===0).map(unit=>unit.z),[1,2]);
});

test('branch metadata measures contextual friendly leakage and allows ties and merged endpoints',()=>{
  for(const level of LEVELS){
    for(const units of [level.enemies,level.allies])assert.ok(units.every(unit=>Object.hasOwn(UNIT_TYPES,unit.branch)));
    assert.deepEqual(level.allies.map(unit=>unit.branch).sort(),Object.keys(UNIT_TYPES).sort());
    assert.equal(level.allies.reduce((sum,unit)=>sum+unitPoints(unit),0),12);
    assert.equal(level.enemies.reduce((sum,unit)=>sum+unit.targetingRisk.initialCount,0),3);
    for(const enemy of level.enemies){
      const risk=enemy.targetingRisk;
      assert.equal(risk.scope,'battlefield-contexts');
      assert.equal(risk.friendlyCount,risk.friendlies.length);
      assert.equal(unitPoints(enemy),risk.friendlyCount===0?2:risk.friendlyCount===1?4:6);
      assert.equal(Object.hasOwn(risk,'shotRank'),false);
    }
  }
});

test('the general addition solution earns target values and the correct saved-command bonus',()=>{
  const level=LEVELS.find(candidate=>candidate.id==='g02');
  const total=level.enemies.reduce((sum,unit)=>sum+unitPoints(unit),0);
  let battle=createBattle(level);
  for(const expected of [...level.enemies].sort((a,b)=>a.x-b.x||a.y-b.y)){
    const fired=order(battle,level.solution,level.goalSolution,'single');
    assert.equal(fired.reason,'fired');assert.equal(fired.cost,1);
    assert.deepEqual(keys(fired.shots),keys([expected]));
    assert.equal(fired.shots[0].points,unitPoints(expected));
    assert.equal(fired.analysis.objectiveVerified,true);
    assert.equal(fired.battle.scoreMultiplier,fired.battle.cleared?2:1);
    battle=fired.battle;
  }
  assert.equal(battle.cleared,true);
  assert.equal(battle.friendlyPoints,0);
  assert.equal(battle.baseScore,total+level.commands-level.enemies.length);
  assert.equal(battle.score,battle.baseScore*2);
  const salvo=order(createBattle(level),level.solution,level.goalSolution,'salvo');
  assert.equal(salvo.reason,'fired');assert.equal(salvo.cost,1);
  assert.deepEqual(keys(salvo.shots),keys(level.enemies));
  assert.equal(salvo.battle.cleared,true);
  assert.equal(salvo.battle.baseScore,total+level.commands-1);
  assert.equal(salvo.battle.scoreMultiplier,2);
  assert.equal(salvo.battle.score,salvo.battle.baseScore*2);
});
