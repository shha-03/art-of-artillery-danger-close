import { parseExpression, evaluate, createBattle, order } from './engine.js';
import { LEVELS } from './levels.js';

const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key = p => `${p.x},${p.y}`;
const pad = n => String(n).padStart(2, '0');
const point = p => p ? `(${p.x}, ${p.y})` : '—';
const unitIcons = {
  enemy: '<svg class="unit-icon" viewBox="0 0 40 40" aria-hidden="true"><path d="M8 15h24v15H8z" fill="currentColor" opacity=".18"/><rect x="7" y="15" width="26" height="17" rx="5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 18v10m16-10v10M15 15v-5h10v10H15zM20 3v10" stroke="currentColor" stroke-width="2.5" fill="none"/><path d="M13 29h14" stroke="currentColor" stroke-width="2"/></svg>',
  friendly: '<svg class="unit-icon" viewBox="0 0 40 40" aria-hidden="true"><path d="M20 5l12 5v10c0 7-7 12-12 15C15 32 8 27 8 20V10z" fill="currentColor" opacity=".14"/><path d="M20 5l12 5v10c0 7-7 12-12 15C15 32 8 27 8 20V10z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 13v13m-6-6h12" stroke="currentColor" stroke-width="2.5"/></svg>'
};
let levelIndex = 0, battle, lastAnalysis = null, records = [], selectedTargets = new Set();
let preview = true, traceVisible = false, busy = false, sound = false, audioContext = null;
let witness = null, impacts = [], hintCount = 1, turnToken = 0, toastTimer;
let best = {};
try { best = JSON.parse(localStorage.getItem('danger-close-best-v1') || '{}'); } catch {}

function level() { return LEVELS[levelIndex]; }
function flash(message) {
  $('toast').textContent = message; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3200);
}
function openDialog(id) { if (!$(id).open) $(id).showModal(); }
function closeDialog(id) { $(id).close(); }
function expression(source) { try { return source.trim() ? parseExpression(source) : null; } catch { return null; } }
function matches(ast, p) { try { return ast && evaluate(ast, p) === true; } catch { return false; } }
function traceForLevel() {
  const l = level(), guard = parseExpression(l.guardSource), trace = [{...l.initial}];
  for (let n=0; n<256 && evaluate(guard, trace.at(-1)); n++) trace.push(l.step(trace.at(-1)));
  return trace;
}
function previewCandidates() {
  const invariant = expression($('invariant-input').value), guard = expression(level().guardSource);
  const taken = new Set(battle.hit.map(key)), enemies = new Set(battle.enemies.map(key)), allies = new Set(battle.allies.map(key));
  const result = [];
  if (!invariant) return result;
  for (let x=0; x<level().size; x++) for (let y=0; y<level().size; y++) {
    const p={x,y}; if (!taken.has(key(p)) && matches(invariant,p) && !matches(guard,p)) {
      result.push({...p,type:enemies.has(key(p))?'enemy':allies.has(key(p))?'friendly':'neutral'});
    }
  }
  const priority={neutral:0,friendly:1,enemy:2};
  return result.sort((a,b)=>priority[a.type]-priority[b.type] || a.x-b.x || a.y-b.y);
}
function renderTabs() {
  $('mission-tabs').innerHTML = LEVELS.map((l,i)=>`<button class="mission-tab ${i===levelIndex?'active':''}" data-level="${i}" ${busy?'disabled':''} aria-current="${i===levelIndex?'step':'false'}"><span class="mission-index">${esc(l.id)}</span><span class="mission-name">${esc(l.name)}<small>${esc(l.subtitle)}</small></span><span class="mission-check">${best[l.id]!==undefined?`${best[l.id]} PT`:'↗'}</span></button>`).join('');
}
function renderMap() {
  const l=level(), candidates=previewCandidates(), candidateSet=new Set(candidates.map(key));
  const goal=expression($('goal-input').value), guard=expression(l.guardSource);
  const enemies=new Set(battle.enemies.map(key)), allies=new Set(battle.allies.map(key));
  const hitMap=new Map(battle.hit.map(p=>[key(p),p])), impactSet=new Set(impacts.map(key));
  const labels={enemy:'적군',friendly:'아군',neutral:'중립'};
  const cells=['<span class="axis-label axis-corner">Y / X</span>'];
  for(let x=0;x<l.size;x++)cells.push(`<span class="axis-label">${x}</span>`);
  for(let y=l.size-1;y>=0;y--) {
    cells.push(`<span class="axis-label">${y}</span>`);
    for(let x=0;x<l.size;x++) {
      const p={x,y}, k=key(p), hit=hitMap.get(k), type=enemies.has(k)?'enemy':allies.has(k)?'friendly':'neutral';
      const terminal=!matches(guard,p), objective=matches(goal,p);
      const classes=['cell',type,terminal?'terminal':'',preview&&candidateSet.has(k)?'candidate':'',preview&&key(candidates[0]||{})===k?'next-target':'',objective?'objective':'',hit?'hit':'',impactSet.has(k)?'impact':'',witness&&key(witness)===k?'witness':''].filter(Boolean).join(' ');
      const content=hit?`<span class="crater ${esc(hit.type||'neutral')}">×</span>`:(unitIcons[type]||'<span class="neutral-dot"></span>');
      cells.push(`<button class="${classes}" data-cell="${x},${y}" aria-label="좌표 ${x}, ${y}: ${hit?'포격 완료':labels[type]}${objective?', 목표 영역':''}" aria-pressed="${objective?'true':'false'}" title="(${x}, ${y}) ${hit?'포격 완료':labels[type]} · 클릭해서 목표 선택" ${busy?'disabled':''}>${content}<span class="cell-coordinate">${x},${y}</span>${objective?'<span class="target-reticle"></span>':''}</button>`);
    }
  }
  const xy = p => `${p.x*100+50},${(l.size-1-p.y)*100+50}`;
  let overlay='';
  if(traceVisible) {
    const t=traceForLevel(); overlay += `<polyline class="trace-path" points="${t.map(xy).join(' ')}"/><circle class="trace-start" cx="${l.initial.x*100+50}" cy="${(l.size-1-l.initial.y)*100+50}" r="11"/>`;
    const end=t.at(-1); overlay += `<circle class="trace-end" cx="${end.x*100+50}" cy="${(l.size-1-end.y)*100+50}" r="15"/>`;
  }
  for(const p of impacts) overlay+=`<path class="shell-trail" d="M -30 ${l.size*100+50} Q ${p.x*100-100} ${Math.max(-50,(l.size-1-p.y)*100-180)} ${xy(p).replace(',',' ')}"/>`;
  cells.push(`<svg class="trace-layer" viewBox="0 0 ${l.size*100} ${l.size*100}" aria-hidden="true">${overlay}</svg>`);
  $('grid').style.setProperty('--size',l.size); $('grid').innerHTML=cells.join('');
  $('map-sector').textContent=`SECTOR ${String.fromCharCode(65+levelIndex)} · ${pad(l.size)} × ${pad(l.size)}`;
  $('map-status').textContent = battle.finished ? (battle.cleared?'작전 완료 · 모든 적군 격파':'명령 소진 · 작전 종료') : candidates.length?`포격 후보 ${candidates.length}칸 · 다음 (${candidates[0].x}, ${candidates[0].y}) · ${lastAnalysis?.valid?'초기·유지 검증 완료':'검증 전'}`:'현재 수식의 미포격 후보가 없습니다';
  $('preview-button').classList.toggle('active',preview); $('preview-button').setAttribute('aria-pressed',String(preview));
  $('trace-button').classList.toggle('active',traceVisible); $('trace-button').setAttribute('aria-pressed',String(traceVisible));
}
function renderStats() {
  $('remaining-stat').textContent=pad(battle.remaining); $('budget-stat').textContent=`/ ${pad(battle.budget)}`;
  $('kills-stat').textContent=pad(battle.enemyKills); $('enemies-stat').textContent=`/ ${pad(level().enemies.length)}`;
  $('score-stat').textContent=battle.score;
  const disabled=busy||battle.finished||!$('goal-input').value.trim()||!$('invariant-input').value.trim();
  $('single-button').disabled=disabled; $('salvo-button').disabled=disabled;
  $('restart-button').disabled=busy; $('invariant-input').disabled=busy||battle.finished; $('goal-input').disabled=busy||battle.finished;
  $('target-enemies').disabled=busy||battle.finished;
  $('command-note').textContent=battle.finished?'작전이 종료되었습니다. 다시 도전하거나 다음 작전으로 이동하세요.':!$('goal-input').value.trim()?'목표 조건을 지정하면 명령을 하달할 수 있습니다.':'단발·일제사 모두 명령 1회 소모 · Ctrl+Enter 단발 / Ctrl+Shift+Enter 일제사';
}
function renderChecks() {
  const labels=[['initial','초기 성립'],['preservation','유지'],['goal','목표 보장']];
  $('verification-strip').innerHTML=labels.map(([k,label])=>{
    const check=lastAnalysis?.[k], pending=Boolean(lastAnalysis?.error)||!check||typeof check.pass!=='boolean';
    return `<div class="check-item ${pending?'pending':check.pass?'pass':'fail'}"><span class="check-icon">${pending?'○':check.pass?'✓':'×'}</span><span class="check-title">${label}</span><span class="check-detail">${pending?(lastAnalysis?.error?'검사 미완료':'명령 후 검사'):check.pass?'통과':k==='goal'?'미보장':'불발'}</span></div>`;
  }).join('');
}
function feedback(kind,title,body,detail='') {
  $('feedback-panel').dataset.kind=kind;
  $('feedback-panel').innerHTML=`<div class="feedback-title">${esc(title)}</div><div class="feedback-body">${esc(body)}</div>${detail?`<div class="feedback-witness">${esc(detail)}</div>`:''}`;
}
function renderLogs() {
  $('log-count').textContent=`${pad(records.length)} ENTRIES`;
  $('log-list').innerHTML=records.length?records.map((r,i)=>`<li class="log-entry"><span class="log-marker ${r.kind}"></span><div><strong>${esc(r.title)}</strong><p>${esc(r.body)}</p><code>${esc(r.expression)}</code></div><span class="log-time">#${pad(records.length-i)}</span></li>`).join(''):'<li class="empty-log">명령 대기 중. 전장을 분석하고 첫 포격을 준비하세요.</li>';
}
function render() {renderTabs();renderStats();renderMap();renderChecks();renderLogs();}
function invalidateAnalysis() {
  lastAnalysis=null; witness=null; renderChecks();renderMap();renderStats();
  feedback('ready','새로운 사격 해법입니다.','초기 성립과 유지는 명령 하달 시 검사합니다. 후보 미리보기는 검증 결과가 아닙니다.');
}
function loadLevel(index) {
  levelIndex=index; battle=createBattle(level()); lastAnalysis=null;records=[];selectedTargets=new Set();witness=null;impacts=[];hintCount=1;busy=false;turnToken++;
  $('invariant-input').value=level().starter; $('goal-input').value='';
  $('operation-label').textContent=`OPERATION ${level().id} / ${pad(LEVELS.length)}`;
  $('mission-brief').textContent=level().brief;
  $('program-code').innerHTML=level().code.split('\n').map((line,i)=>`<span class="code-line"><span class="line-number">${pad(i+1)}</span><span>${esc(line).replace(/\b(while|if|else)\b/g,'<span class="code-keyword">$1</span>')}</span></span>`).join('');
  feedback('ready','전장을 확인하세요.','목표 칸을 선택하거나 ‘적군 전체 선택’을 누른 뒤, 불변식을 보강해 포격하세요.');
  render();
}
function setSelectedGoal() {
  $('goal-input').value=[...selectedTargets].map(k=>{const [x,y]=k.split(',');return `(x == ${x} && y == ${y})`;}).join(' || ');
  invalidateAnalysis();
}
function playSound(dud=false) {
  if(!sound) return;
  try {
    audioContext ||= new (window.AudioContext||window.webkitAudioContext)();
    audioContext.resume(); const osc=audioContext.createOscillator(),gain=audioContext.createGain(),t=audioContext.currentTime;
    osc.type=dud?'sine':'triangle';osc.frequency.setValueAtTime(dud?150:95,t);osc.frequency.exponentialRampToValueAtTime(dud?80:28,t+.22);
    gain.gain.setValueAtTime(.0001,t);gain.gain.exponentialRampToValueAtTime(.13,t+.015);gain.gain.exponentialRampToValueAtTime(.0001,t+.28);
    osc.connect(gain);gain.connect(audioContext.destination);osc.start(t);osc.stop(t+.3);
  }catch{}
}
async function fire(mode) {
  if(busy||battle.finished) return;
  if(!$('goal-input').value.trim()) { flash('전장에서 목표를 선택하거나 ensures를 입력하세요.');$('goal-input').focus();return; }
  busy=true;renderStats();
  const currentToken=turnToken;
  try {
    const result=order(battle,$('invariant-input').value,$('goal-input').value,mode);
    lastAnalysis=result.analysis || null;
    if(result.error) {
      busy=false;feedback('error','명령을 확인하세요.',result.error,'명령 횟수는 소모되지 않았습니다.');render();return;
    }
    if(result.reason==='no-candidates' || result.cost===0) {
      busy=false;feedback('ready','남은 포격 후보가 없습니다.','불변식의 종료 영역에 아직 포격하지 않은 칸이 있는지 확인하세요.','명령 횟수는 소모되지 않았습니다.');render();return;
    }
    battle=result.battle;
    const name=mode==='salvo'?'일제사':'단발 포격';
    const shots=result.shots||[], enemy=shots.filter(s=>s.type==='enemy').length,friendly=shots.filter(s=>s.type==='friendly').length,neutral=shots.filter(s=>s.type==='neutral').length;
    if(result.dud) {
      const initial=lastAnalysis?.initial?.pass===false;
      const check=initial?lastAnalysis.initial:lastAnalysis.preservation;
      witness=check?.before || (initial?level().initial:null);
      const detail=initial?`초기 상태 ${point(witness)}에서 불변식이 거짓입니다.`:`가상 상태 ${point(check?.before)} → ${point(check?.after)}${check?.outsideDomain?' · 검증 세계 이탈':''}`;
      feedback('error',`${name} 불발 · 명령 −1`,initial?'시작 상태를 포함하도록 불변식을 수정하세요.':'현재 불변식이 허용한 상태에서 한 번 실행한 뒤 관계가 유지되지 않습니다.',detail);
      records.unshift({kind:'dud',title:`${name} · 불발`,body:detail,expression:$('invariant-input').value});
      playSound(true);
    } else {
      impacts=shots;witness=lastAnalysis?.goal?.pass===false?lastAnalysis.goal.before:null;
      const goalPassed=lastAnalysis?.goal?.pass===true;
      feedback(friendly?'error':goalPassed?'success':'warning',`${name} 완료 · ${shots.length}발 / 명령 −1`,`적군 ${enemy}기 격파 · 아군 ${friendly}기 피해 · 중립 ${neutral}칸`,goalPassed?'선택한 ensures가 검증 세계의 모든 종료 후보에서 보장됩니다.':`목표 미보장: 종료 후보 ${point(lastAnalysis?.goal?.before)}를 아직 배제하지 못했습니다.`);
      records.unshift({kind:friendly?'dud':'success',title:`${name} · 적군 ${enemy} / 아군 ${friendly}`,body:`${shots.length}발 발사 · 중립 ${neutral} · 명령 −1${goalPassed?' · 목표 증명 완료':''}`,expression:$('invariant-input').value});
      playSound();
    }
    render();
    await new Promise(resolve=>setTimeout(resolve,shots.length?850:400));
    if(currentToken!==turnToken)return;
    busy=false;impacts=[];render();
    if(battle.finished)showResult();
  } catch(error) {
    busy=false;feedback('error','명령을 처리하지 못했습니다.',error.message||String(error));renderStats();
  }
}
function showResult() {
  const clear=battle.cleared;
  if(clear) {
    best[level().id]=Math.max(best[level().id]??-Infinity,battle.score);
    try{localStorage.setItem('danger-close-best-v1',JSON.stringify(best));}catch{}
  }
  $('result-kicker').textContent=clear?'MISSION COMPLETE':'MISSION ENDED';
  $('result-title').textContent=clear?(battle.friendlyKills?'목표 제거. 아군 피해 발생.':'정밀한 지휘였습니다.'):'다음 해법을 준비하세요.';
  $('result-copy').textContent=clear?`${level().name} · 모든 적군을 격파했습니다.${battle.friendlyKills?' 아군을 제외하는 관계를 찾아 점수를 높여보세요.':' 아낀 명령이 점수가 됩니다.'}`:'명령을 모두 소모했습니다. 반례와 실행 경로에서 놓친 관계를 찾아보세요.';
  $('result-score').textContent=battle.score;
  $('result-stats').innerHTML=`<div><strong>${battle.enemyKills}</strong><span>적군 격파</span></div><div><strong>${battle.friendlyKills}</strong><span>아군 피해</span></div><div><strong>${battle.remaining}</strong><span>남은 명령</span></div>`;
  $('result-next').textContent=levelIndex<LEVELS.length-1?'다음 작전 →':'첫 작전으로 →';
  renderTabs();openDialog('result-dialog');
}
function renderHints() {
  $('hint-list').innerHTML=level().hints.slice(0,hintCount).map((h,i)=>`<div class="hint-item"><span>INTEL ${pad(i+1)}</span><p>${esc(h)}</p></div>`).join('')+(hintCount===level().hints.length?`<div class="hint-item"><span>검증 가능한 예시 해법</span><code>${esc(level().solution)}</code><p>초기·유지를 통과하면 발사할 수 있고, 세 조건을 모두 통과하면 목표도 증명됩니다. 다른 해법도 인정됩니다.</p></div>`:'');
  $('next-hint').disabled=hintCount>=level().hints.length;
}

$('mission-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-level]');if(b&&!busy)loadLevel(Number(b.dataset.level));});
$('grid').addEventListener('click',e=>{const b=e.target.closest('[data-cell]');if(!b||busy||battle.finished)return;const k=b.dataset.cell;selectedTargets.has(k)?selectedTargets.delete(k):selectedTargets.add(k);setSelectedGoal();});
$('grid').addEventListener('pointerover',e=>{const b=e.target.closest('[data-cell]');if(b)$('hover-coordinate').textContent=`COORDINATE (${b.dataset.cell.replace(',',', ')})`;});
$('grid').addEventListener('pointerleave',()=>{$('hover-coordinate').textContent='목표 칸을 클릭하세요';});
$('target-enemies').addEventListener('click',()=>{selectedTargets=new Set(level().enemies.map(key));setSelectedGoal();});
$('goal-input').addEventListener('input',()=>{selectedTargets.clear();invalidateAnalysis();});
$('invariant-input').addEventListener('input',invalidateAnalysis);
document.querySelectorAll('[data-insert]').forEach(b=>b.addEventListener('click',()=>{
  const t=$('invariant-input'); if(t.disabled)return;const start=t.selectionStart,end=t.selectionEnd;t.setRangeText(b.dataset.insert,start,end,'end');t.focus();invalidateAnalysis();
}));
$('preview-button').addEventListener('click',()=>{preview=!preview;renderMap();});
$('trace-button').addEventListener('click',()=>{traceVisible=!traceVisible;renderMap();});
$('single-button').addEventListener('click',()=>fire('single'));
$('salvo-button').addEventListener('click',()=>fire('salvo'));
$('restart-button').addEventListener('click',()=>loadLevel(levelIndex));
$('help-button').addEventListener('click',()=>openDialog('help-dialog'));
$('domain-button').addEventListener('click',()=>openDialog('help-dialog'));
$('hint-button').addEventListener('click',()=>{renderHints();openDialog('hint-dialog');});
$('next-hint').addEventListener('click',()=>{hintCount++;renderHints();});
$('result-retry').addEventListener('click',()=>{closeDialog('result-dialog');loadLevel(levelIndex);});
$('result-next').addEventListener('click',()=>{closeDialog('result-dialog');loadLevel((levelIndex+1)%LEVELS.length);});
$('sound-button').addEventListener('click',()=>{sound=!sound;$('sound-button').textContent=`사운드 ${sound?'ON':'OFF'}`;$('sound-button').setAttribute('aria-pressed',String(sound));if(sound)playSound(true);});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeDialog(b.dataset.close)));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter'&&!document.querySelector('dialog[open]')){e.preventDefault();fire(e.shiftKey?'salvo':'single');}});
loadLevel(0);
