import test from 'node:test';
import assert from 'node:assert/strict';
import { Script, createContext } from 'node:vm';
import { LEVELS } from './dist/levels.js';
import {
  DOMAIN, INPUT_DOMAIN, analyze, battlefieldCasesForLevel, evaluate,
  parseExpression, verificationCasesForLevel,
} from './dist/engine.js';

const point=state=>({x:state.x+0,y:state.y+0});
const key=state=>state.x+','+state.y;
const keys=states=>states.map(key).sort();
const parameters=({a,b,n,m})=>({a,b,n,m});
const inWindow=({x,y})=>Number.isInteger(x)&&Number.isInteger(y)
  &&x>=DOMAIN.min&&x<=DOMAIN.max&&y>=DOMAIN.min&&y<=DOMAIN.max;

// Closed mathematical results, independent of the level's loop, initializer,
// guard, step, and invariant. No three-example result tables are used.
const ORACLES={
  g01:({n})=>({x:0,y:n}),
  g02:({n,m})=>({x:0,y:n+m}),
  g03:({n})=>({x:0,y:2*n}),
  g04:({n,m})=>({x:0,y:n*m}),
  g05:({n,m})=>({x:Math.max(n-m,0),y:Math.min(n,m)}),
  g06:({n,m})=>({x:Math.max(n-m,0),y:Math.max(m-n,0)}),
  g07:({n,m})=>({x:Math.max(n,m),y:Math.max(n,m)}),
  g08:({n,m})=>({x:0,y:n+m}),
  g09:({n,m})=>({x:n%(m+1),y:Math.floor(n/(m+1))}),
  g10:({n,m})=>({x:n-Math.ceil(n/(m+1))*(m+1),y:Math.ceil(n/(m+1))}),
  g11:({n,m})=>({x:n,y:n%(m+1)}),
  g12:({a,b})=>({x:Math.floor((a+b)/2),y:Math.ceil((a+b)/2)}),
  g13:({n})=>({x:0,y:n*(n+1)/2}),
  g14:({n,m})=>({x:n,y:n*(2*m+n-1)/2}),
  g15:({n})=>({x:n,y:n*n}),
  g16:({n})=>({x:n,y:n*(n+1)}),
  g17:({n})=>({x:0,y:n*(n+1)*(2*n+1)/6}),
  g18:({n})=>({x:n-Math.floor(Math.sqrt(n))**2,y:Math.floor(Math.sqrt(n))}),
  g19:({n})=>({x:Math.ceil(Math.sqrt(n)),y:Math.ceil(Math.sqrt(n))**2}),
  g20:({n})=>({x:Math.floor(Math.sqrt(n)),y:Math.floor(Math.sqrt(n))+1}),
};

function runSteps(level,initial,{requireWindow=true}={}){
  const guard=parseExpression(level.guardSource),invariant=parseExpression(level.solution);
  const context=parameters(initial),seen=new Set();
  let state={...initial};
  while(true){
    if(requireWindow)assert.ok(inWindow(state),level.id+': actual execution must remain in the checker window');
    assert.equal(evaluate(invariant,state),true,level.id+': general invariant along actual execution');
    if(!evaluate(guard,state))return state;
    assert.ok(!seen.has(key(state)),level.id+': nonterminating cycle');seen.add(key(state));
    assert.ok(seen.size<10000,'a regression fixture must terminate');
    state={...point(level.step({...state})),...context};
  }
}

test('all twenty algorithms have independent general mathematical specifications',()=>{
  assert.deepEqual(LEVELS.map(level=>level.id),Object.keys(ORACLES));
});

for(const level of LEVELS){
  test(level.id+': all 81 checker inputs agree with the displayed program and an independent mathematical oracle',()=>{
    const oracle=ORACLES[level.id];
    assert.ok(oracle,'the test must never silently skip a new algorithm');
    const cases=verificationCasesForLevel(level);
    assert.equal(cases.length,INPUT_DOMAIN.stateCount);
    const program=new Script('(() => {\n'+level.initializationCode+'\n'+level.code+'\nreturn {x,y,n,m};\n})()');
    const initializeProgram=new Script('(() => {\n'+level.initializationCode+'\nreturn {x,y,n,m};\n})()');
    const vm=createContext({a:0,b:0});
    const goal=parseExpression(level.goalSolution);
    for(const initial of cases){
      const context=parameters(initial),expected=point(oracle(context));
      vm.a=context.a;vm.b=context.b;
      const displayedInitial=initializeProgram.runInContext(vm,{timeout:100});
      assert.deepEqual({...point(displayedInitial),n:displayedInitial.n,m:displayedInitial.m},
        {...point(initial),n:initial.n,m:initial.m},'initialization shown to the player');
      const displayed=program.runInContext(vm,{timeout:100});
      assert.deepEqual(point(displayed),expected,'displayed complete program');
      assert.equal(displayed.n,context.n);assert.equal(displayed.m,context.m);
      const actual=runSteps(level,initial);
      assert.deepEqual(point(actual),expected,'independent general formula');
      assert.equal(evaluate(goal,actual),true);
      const goalStates=[];
      for(let x=DOMAIN.min;x<=DOMAIN.max;x++)for(let y=DOMAIN.min;y<=DOMAIN.max;y++){
        if(evaluate(goal,{x,y,...context}))goalStates.push({x,y});
      }
      assert.deepEqual(keys(goalStates),keys([expected]),'the postcondition describes exactly this input result');
    }
    const report=analyze(level.solution,level.goalSolution,level);
    assert.equal(report.error,undefined);
    assert.equal(report.initial.checkedCount,81);
    assert.equal(report.checkedStateCount,81*DOMAIN.stateCount);
    assert.equal(report.contextCount,81);
    assert.equal(report.initial.pass,true);
    assert.equal(report.preservation.pass,true,'check all invariant states, including unreachable states');
    assert.equal(report.goal.pass,true);
    assert.equal(report.specification.pass,true);
    assert.equal(report.objectiveVerified,true);
    const battlefield=battlefieldCasesForLevel(level);
    const endpoints=[...new Map(battlefield.map(context=>{
      const endpoint=point(oracle(context));return[key(endpoint),endpoint];
    })).values()];
    assert.deepEqual(keys(level.enemies),keys(endpoints));
    assert.deepEqual(keys(report.candidates),keys(endpoints));
    assert.deepEqual([...new Set(keys(report.traces.map(execution=>execution.trace.at(-1))))].sort(),keys(endpoints));
    assert.ok(report.traces.every(execution=>execution.traceStatus==='terminated'));
  });

  test(level.id+': displayed guard and one iteration match the verifier at every state of each visible context',()=>{
    assert.match(level.code,/^while\s*\(/);
    const oneStep=new Script(level.code.replace(/^while/,'if'));
    const guard=parseExpression(level.guardSource);
    const vm=createContext({x:0,y:0,a:0,b:0,n:0,m:0});
    for(const initial of battlefieldCasesForLevel(level)){
      const context=parameters(initial);
      for(let x=DOMAIN.min;x<=DOMAIN.max;x++)for(let y=DOMAIN.min;y<=DOMAIN.max;y++){
        Object.assign(vm,{x,y,...context});
        oneStep.runInContext(vm);
        const before={x,y,...context};
        const expected=evaluate(guard,before)?level.step({...before}):before;
        assert.deepEqual(point(vm),point(expected),'state '+x+','+y+' with input '+context.a+','+context.b);
        assert.deepEqual(parameters(vm),context,'loop parameters stay immutable');
      }
    }
  });

  test(level.id+': general formulas remain meaningful beyond the finite checking window',()=>{
    const program=new Script('(() => {\n'+level.initializationCode+'\n'+level.code+'\nreturn {x,y,n,m};\n})()');
    const vm=createContext({a:0,b:0});
    // These extra cases catch accidental example caps. They are not presented
    // as a proof over all integers; the exhaustive checker still has 81 inputs.
    for(const raw of [{a:7,b:-5},{a:-8,b:6},{a:0,b:-9},{a:-6,b:0}]){
      const initial={...level.initialize(raw),...raw};
      assert.equal(initial.n,Math.abs(raw.a));assert.equal(initial.m,Math.abs(raw.b));
      const expected=point(ORACLES[level.id](initial));
      Object.assign(vm,raw);
      assert.deepEqual(point(program.runInContext(vm,{timeout:100})),expected);
      const actual=runSteps(level,initial,{requireWindow:false});
      assert.deepEqual(point(actual),expected);
      assert.equal(evaluate(parseExpression(level.goalSolution),actual),true);
    }
  });
}
