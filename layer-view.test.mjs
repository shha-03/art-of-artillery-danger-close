import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  variablesForLevel, domainsForLevel, stateKey, statePoint, parseExpression,
  evaluate, previewCandidatesForLevel, projectPredicate, createBattle,
} from './dist/engine.js';
import { translate } from './dist/i18n.js';
import { previewCandidatesSmt } from './dist/smt-engine.js';

// Exercise the application's real slice selection, rendering, and phase handler
// with a minimal DOM boundary. Verification remains the real engine's projection.
const source=fs.readFileSync(new URL('./dist/app.js',import.meta.url),'utf8');
function run(context,start,end) {
  const first=source.indexOf(start),last=source.indexOf(end,first);
  assert.ok(first>=0&&last>first,`Application test entry point moved: ${start}`);
  new vm.Script(source.slice(first,last),{filename:'dist/app.js'}).runInContext(context);
}
const sample={
  id:'layer-test',size:3,commands:6,variables:['x','y','z'],
  domains:{x:{min:0,max:2},y:{min:0,max:2},z:{min:0,max:2}},
  initialStates:[{x:1,y:0,z:0},{x:1,y:0,z:1},{x:1,y:0,z:2}],
  guardSource:'x > 0',step:p=>({...p,x:p.x-1}),
  enemies:[{x:0,y:0,z:0},{x:0,y:0,z:2}],allies:[{x:0,y:0,z:1}],
};
function harness(level=sample) {
  const elements=new Map(),calls={clear:0,renders:0,effects:[],sounds:[]};
  const $=id=>{
    if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,innerHTML:'',textContent:'',
      setAttribute(){},style:{setProperty(){}},classList:{toggle(){}}});
    return elements.get(id);
  };
  $('invariant-input').value='x >= 0 && x <= 1 && y == 0';
  $('goal-input').value='x == 0 && y == 0';
  const context={
    $,level:()=>level,variablesForLevel,domainsForLevel,statePoint,stateKey,
    parseExpression,evaluate,previewCandidatesForLevel,previewCandidatesSmt,projectPredicate,
    key:stateKey,point:p=>`(${Object.values(statePoint(p)).join(', ')})`,
    esc:value=>String(value).replaceAll('&','&amp;').replaceAll('"','&quot;'),
    pad:n=>String(n).padStart(2,'0'),language:'ko',translate,
    t:(key,p)=>translate('ko',key,p),
    selectedLayer:0,busy:false,battle:createBattle(level),levelIndex:0,
    traceInputs:level.initialStates,selectedInitialIndex:0,allowedInputCount:level.initialStates.length,
    preview:true,traceVisible:false,witness:null,impacts:[],lastAnalysis:null,
    firingPhase:'idle',exitAllowsFire:()=>false,stagePassed:()=>false,
    unitSymbol:affiliation=>`<i class="${affiliation}"></i>`,
    signedUnitPoints:()=>'+1',branchName:()=>'',renderUnitRoster(){},
    battleEffects:{clear(){calls.clear++;},launch(shots){calls.effects.push({phase:'flight',shots});},impact(shots){calls.effects.push({phase:'impact',shots});},radio(){}},
  };
  vm.createContext(context);
  run(context,'function is3d()', '\nfunction flash(');
  run(context,'function traceForLevel()', '\nfunction renderTabs(');
  run(context,'function renderMap()', '\nfunction renderUnitRoster(');
  return {context,elements,calls};
}
const json=value=>JSON.parse(JSON.stringify(value));

test('layer choice preserves all projected targets and separates equal xy coordinates',()=>{
  const h=harness(), c=h.context;
  const before=json(c.previewCandidates()),battle=c.battle;
  assert.equal(before.length,3);
  c.renderMap();
  assert.match(h.elements.get('grid').innerHTML,/class="cell enemy[^\"]*" data-cell="0,0,0"/);
  c.setLayer(1);
  assert.match(h.elements.get('grid').innerHTML,/class="cell friendly[^\"]*" data-cell="0,0,1"/);
  assert.doesNotMatch(h.elements.get('grid').innerHTML,/data-cell="0,0,0"/);
  assert.deepEqual(json(c.previewCandidates()),before);
  assert.equal(c.battle,battle);
  assert.equal(h.elements.get('invariant-input').value,'x >= 0 && x <= 1 && y == 0');
  assert.match(h.elements.get('layer-summary').textContent,/후보 1칸 \/ 전체 층 3칸/);
  assert.equal((h.elements.get('layer-select').innerHTML.match(/<option /g)||[]).length,3);
});

test('busy layer controls reject user changes while automatic shot selection remains possible',()=>{
  const h=harness(),c=h.context;
  c.busy=true;c.renderMap();
  for(const id of ['layer-select','layer-previous','layer-next'])assert.equal(h.elements.get(id).disabled,true);
  c.setLayer(1);
  assert.equal(c.selectedLayer,0);
  c.ensureShotLayer([{x:0,y:0,z:2}]);
  assert.equal(c.selectedLayer,2);
  c.ensureShotLayer([{x:0,y:0,z:0},{x:0,y:0,z:2}]);
  assert.equal(c.selectedLayer,2,'keep an already targeted layer visible');
  c.busy=false;c.renderMap();
  assert.equal(h.elements.get('layer-select').disabled,false);
  assert.equal(h.elements.get('layer-next').disabled,true,'respect the last layer boundary');
  c.setLayer(3);
  assert.equal(c.selectedLayer,2);
});

test('trace slices never connect points across a visit to a different z layer',()=>{
  const {context:c}=harness();
  const trace=[{x:0,y:0,z:0},{x:1,y:0,z:0},{x:1,y:1,z:1},{x:2,y:1,z:0},{x:2,y:2,z:0}];
  assert.deepEqual(json(c.traceSegmentsForLayer(trace)),[trace.slice(0,2),trace.slice(3)]);
  c.selectedLayer=1;
  assert.deepEqual(json(c.traceSegmentsForLayer(trace)),[[trace[2]]]);
  c.selectedLayer=2;
  assert.deepEqual(json(c.traceSegmentsForLayer(trace)),[]);
});

test('executing a trace preserves z transitions and immutable input context',()=>{
  const level={...sample,guardSource:'z < 2',step:p=>({x:p.x+1,y:p.y,z:p.z+1}),
    initialStates:[{x:0,y:0,z:0,a:-2,b:1,n:2,m:1}]};
  const h=harness(level),trace=json(h.context.traceForLevel());
  assert.deepEqual(trace.map(p=>[p.x,p.y,p.z]),[[0,0,0],[1,0,1],[2,0,2]]);
  assert.ok(trace.every(p=>p.a===-2&&p.b===1&&p.n===2&&p.m===1));
  assert.deepEqual(json(h.context.stateWindowSummary()),{count:1,states:27,total:27,ranges:'x ∈ [0, 2], y ∈ [0, 2], z ∈ [0, 2]'});
});

test('two-dimensional levels keep xy keys, full traces, and hide the layer picker',()=>{
  const level={...sample,variables:['x','y'],domains:{x:{min:0,max:2},y:{min:0,max:2}},
    initialStates:[{x:1,y:0}],enemies:[{x:0,y:0}],allies:[]};
  const h=harness(level),c=h.context;
  c.renderMap();
  assert.equal(h.elements.get('layer-controls').hidden,true);
  assert.match(h.elements.get('grid').innerHTML,/data-cell="0,0"/);
  assert.equal(c.previewCandidates().length,1);
  const trace=c.traceForLevel();
  assert.equal(c.traceSegmentsForLayer(trace)[0].length,2);
  assert.equal(c.stateWindowSummary().states,9);
});

test('the actual firing phase projects effects to a hit layer but preserves global salvo sound count',async()=>{
  const h=harness(),c=h.context;
  let emit;
  Object.assign(c,{
    AbortController,sound:false,sequenceAbort:null,turnToken:0,sequenceStarted:false,
    revealedStages:new Set(),currentStage:null,feedbackState:null,
    selectTacticalView(){},render(){},renderChecks(){},showResult(){},
    setFiringPhase(phase){c.firingPhase=phase;},
    playCue(cue,options){h.calls.sounds.push({cue,options});},
    artilleryAudio:{stopAll(){}},orderStages(){return {};},checkSmt(){},
    document:{querySelector:()=>({scrollIntoView(){}})},
    runFiringSequence:async options=>{emit=options.onEvent;},
  });
  run(c,'async function fire(mode)', '\nfunction showResult()');
  await c.fire('salvo');
  const shots=[{x:0,y:0,z:1,type:'friendly'},{x:0,y:0,z:2,type:'enemy'}];
  emit({type:'phase',phase:'fire',shots});
  assert.equal(c.selectedLayer,1,'switch away from a layer with no shots');
  emit({type:'phase',phase:'flight',shots});
  emit({type:'phase',phase:'impact',shots});
  assert.deepEqual(h.calls.effects,[{phase:'flight',shots:[shots[0]]},{phase:'impact',shots:[shots[0]]}]);
  assert.equal(h.calls.sounds.find(call=>call.cue==='salvoImpact').options.count,2);
  assert.deepEqual(shots.map(p=>p.z),[1,2],'the full salvo is not mutated by its visual projection');
});
