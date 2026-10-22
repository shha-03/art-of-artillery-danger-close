import { parseExpression, evaluate, createBattle, order, formatEngineError } from './engine.js';
import { LEVELS } from './levels.js';
import { LANGUAGE_STORAGE_KEY, resolveLanguage, translate } from './i18n.js';
import { applyStaticTranslations } from './ui-copy.js';

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
try {
  const savedBest = JSON.parse(localStorage.getItem('danger-close-best-v1') || '{}');
  if (savedBest && typeof savedBest === 'object' && !Array.isArray(savedBest)) {
    best = Object.fromEntries(LEVELS.filter(l=>Number.isSafeInteger(savedBest[l.id])).map(l=>[l.id,savedBest[l.id]]));
  }
} catch {}
let savedLanguage;
try { savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY); } catch {}
let language = resolveLanguage(savedLanguage, navigator.languages || [navigator.language]);
let feedbackState = { type: 'ready' }, toastKey = null;
const t = (key, parameters) => translate(language, key, parameters);
const levelCopy = (l = level()) => language === 'en' ? l.en : l;

function level() { return LEVELS[levelIndex]; }
function flash(messageKey) {
  toastKey = messageKey; $('toast').textContent = t(messageKey); $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; toastKey = null; }, 3200);
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
  $('mission-tabs').innerHTML = LEVELS.map((l,i)=>`<button class="mission-tab ${i===levelIndex?'active':''}" data-level="${i}" ${busy?'disabled':''} aria-current="${i===levelIndex?'step':'false'}"><span class="mission-index">${esc(l.id)}</span><span class="mission-name">${esc(levelCopy(l).name)}<small>${esc(l.subtitle)}</small></span><span class="mission-check">${best[l.id]!==undefined?`${best[l.id]} PT`:'↗'}</span></button>`).join('');
}
function renderMap() {
  const l=level(), candidates=previewCandidates(), candidateSet=new Set(candidates.map(key));
  const goal=expression($('goal-input').value), guard=expression(l.guardSource);
  const enemies=new Set(battle.enemies.map(key)), allies=new Set(battle.allies.map(key));
  const hitMap=new Map(battle.hit.map(p=>[key(p),p])), impactSet=new Set(impacts.map(key));
  const cells=['<span class="axis-label axis-corner">Y / X</span>'];
  for(let x=0;x<l.size;x++)cells.push(`<span class="axis-label">${x}</span>`);
  for(let y=l.size-1;y>=0;y--) {
    cells.push(`<span class="axis-label">${y}</span>`);
    for(let x=0;x<l.size;x++) {
      const p={x,y}, k=key(p), hit=hitMap.get(k), type=enemies.has(k)?'enemy':allies.has(k)?'friendly':'neutral';
      const terminal=!matches(guard,p), objective=matches(goal,p);
      const classes=['cell',type,terminal?'terminal':'',preview&&candidateSet.has(k)?'candidate':'',preview&&key(candidates[0]||{})===k?'next-target':'',objective?'objective':'',hit?'hit':'',impactSet.has(k)?'impact':'',witness&&key(witness)===k?'witness':''].filter(Boolean).join(' ');
      const content=hit?`<span class="crater ${esc(hit.type||'neutral')}">×</span>`:(unitIcons[type]||'<span class="neutral-dot"></span>');
      const labelParams={x,y,unit:t(hit?'hit':type),objective:objective?t('objectiveSuffix'):''};
      cells.push(`<button class="${classes}" data-cell="${x},${y}" aria-label="${esc(t('cellLabel',labelParams))}" aria-pressed="${objective?'true':'false'}" title="${esc(t('cellTitle',labelParams))}" ${busy?'disabled':''}>${content}<span class="cell-coordinate">${x},${y}</span>${objective?'<span class="target-reticle"></span>':''}</button>`);
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
  $('map-status').textContent = battle.finished ? t(battle.cleared?'mapCleared':'mapEnded') : candidates.length?t('mapCandidates',{count:candidates.length,point:point(candidates[0]),status:t(lastAnalysis?.valid?'verified':'pending')}):t('noCandidates');
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
  $('command-note').textContent=t(battle.finished?'commandEnded':!$('goal-input').value.trim()?'commandNoGoal':'commandKeys');
}
function renderChecks() {
  $('verification-strip').innerHTML=['initial','preservation','goal'].map(k=>{
    const check=lastAnalysis?.[k], pending=Boolean(lastAnalysis?.error)||!check||typeof check.pass!=='boolean';
    return `<div class="check-item ${pending?'pending':check.pass?'pass':'fail'}"><span class="check-icon">${pending?'○':check.pass?'✓':'×'}</span><span class="check-title">${esc(t(k))}</span><span class="check-detail">${esc(t(pending?(lastAnalysis?.error?'incomplete':'afterOrder'):check.pass?'passed':k==='goal'?'unproven':'dud'))}</span></div>`;
  }).join('');
}
function feedback(kind,title,body,detail='') {
  $('feedback-panel').dataset.kind=kind;
  $('feedback-panel').innerHTML=`<div class="feedback-title">${esc(title)}</div><div class="feedback-body">${esc(body)}</div>${detail?`<div class="feedback-witness">${esc(detail)}</div>`:''}`;
}
function witnessReport(analysis) {
  const initial=analysis.initial.pass===false;
  const check=initial?analysis.initial:analysis.preservation;
  return t(initial?'initialWitness':'preservationWitness',{before:point(check.before),after:point(check.after),outside:check.outsideDomain?t('outsideDomain'):''});
}
function shotReport(event) {
  return {mode:t(event.mode),count:event.shots.length,enemy:event.shots.filter(s=>s.type==='enemy').length,friendly:event.shots.filter(s=>s.type==='friendly').length,neutral:event.shots.filter(s=>s.type==='neutral').length};
}
function renderFeedback() {
  const f=feedbackState;
  if(f.type==='ready'||f.type==='modified') return feedback('ready',t(`${f.type}Title`),t(`${f.type}Body`));
  if(f.type==='error') return feedback('error',t('rejectedTitle'),formatEngineError(f.error,language),t('noCharge'));
  if(f.type==='empty') return feedback('ready',t('emptyTitle'),t('emptyBody'),t('noCharge'));
  if(f.type==='exception') return feedback('error',t('exceptionTitle'),formatEngineError(f.error,language));
  if(f.type==='dud') return feedback('error',t('dudTitle',{mode:t(f.mode)}),t(f.analysis.initial.pass===false?'initialFailure':'preservationFailure'),witnessReport(f.analysis));
  if(f.type==='fired') {
    const report=shotReport(f), goalPassed=f.analysis.goal.pass===true;
    feedback(report.friendly?'error':goalPassed?'success':'warning',t('firedTitle',report),t('damageReport',report),goalPassed?t('goalPassed'):t('goalFailed',{point:point(f.analysis.goal.before)}));
  }
}
function renderLogs() {
  $('log-count').textContent=`${pad(records.length)} ENTRIES`;
  $('log-list').innerHTML=records.length?records.map((r,i)=>{
    const report=r.type==='fired'?shotReport(r):{mode:t(r.mode)};
    const title=t(r.type==='dud'?'logDud':'logFired',report);
    const body=r.type==='dud'?witnessReport(r.analysis):t('logShots',{...report,proof:r.analysis.goal.pass?t('proofSuffix'):''});
    return `<li class="log-entry"><span class="log-marker ${r.kind}"></span><div><strong>${esc(title)}</strong><p>${esc(body)}</p><code>${esc(r.expression)}</code></div><span class="log-time">#${pad(records.length-i)}</span></li>`;
  }).join(''):`<li class="empty-log">${esc(t('emptyLog'))}</li>`;
}
function render() {renderTabs();renderStats();renderMap();renderChecks();renderLogs();renderFeedback();}
function invalidateAnalysis() {
  lastAnalysis=null; witness=null; renderChecks();renderMap();renderStats();
  feedbackState={type:'modified'};renderFeedback();
}
function loadLevel(index) {
  levelIndex=index; battle=createBattle(level()); lastAnalysis=null;records=[];selectedTargets=new Set();witness=null;impacts=[];hintCount=1;busy=false;turnToken++;
  $('invariant-input').value=level().starter; $('goal-input').value='';
  $('operation-label').textContent=`OPERATION ${level().id} / ${pad(LEVELS.length)}`;
  $('mission-brief').textContent=levelCopy().brief;
  $('program-code').innerHTML=level().code.split('\n').map((line,i)=>`<span class="code-line"><span class="line-number">${pad(i+1)}</span><span>${esc(line).replace(/\b(while|if|else)\b/g,'<span class="code-keyword">$1</span>')}</span></span>`).join('');
  feedbackState={type:'ready'};
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
  if(!$('goal-input').value.trim()) { flash('missingGoal');$('goal-input').focus();return; }
  busy=true;renderStats();
  const currentToken=turnToken;
  try {
    const result=order(battle,$('invariant-input').value,$('goal-input').value,mode);
    lastAnalysis=result.analysis || null;
    if(result.error) {
      busy=false;feedbackState={type:'error',error:result};render();return;
    }
    if(result.reason==='no-candidates' || result.cost===0) {
      busy=false;feedbackState={type:'empty'};render();return;
    }
    battle=result.battle;
    const shots=result.shots||[], friendly=shots.filter(s=>s.type==='friendly').length;
    if(result.dud) {
      const initial=lastAnalysis?.initial?.pass===false;
      const check=initial?lastAnalysis.initial:lastAnalysis.preservation;
      witness=check?.before || (initial?level().initial:null);
      feedbackState={type:'dud',mode,analysis:lastAnalysis};
      records.unshift({...feedbackState,kind:'dud',expression:$('invariant-input').value});
      playSound(true);
    } else {
      impacts=shots;witness=lastAnalysis?.goal?.pass===false?lastAnalysis.goal.before:null;
      feedbackState={type:'fired',mode,analysis:lastAnalysis,shots};
      records.unshift({...feedbackState,kind:friendly?'dud':'success',expression:$('invariant-input').value});
      playSound();
    }
    render();
    await new Promise(resolve=>setTimeout(resolve,shots.length?850:400));
    if(currentToken!==turnToken)return;
    busy=false;impacts=[];render();
    if(battle.finished)showResult();
  } catch(error) {
    busy=false;feedbackState={type:'exception',error};renderFeedback();renderStats();
  }
}
function showResult() {
  const clear=battle.cleared;
  if(clear) {
    best[level().id]=Math.max(best[level().id]??-Infinity,battle.score);
    try{localStorage.setItem('danger-close-best-v1',JSON.stringify(best));}catch{}
  }
  renderResult();renderTabs();openDialog('result-dialog');
}
function renderResult() {
  const clear=battle.cleared;
  $('result-kicker').textContent=clear?'MISSION COMPLETE':'MISSION ENDED';
  $('result-title').textContent=t(clear?(battle.friendlyKills?'resultFriendly':'resultClean'):'resultFailed');
  $('result-copy').textContent=clear?t('resultClear',{name:levelCopy().name,instruction:t(battle.friendlyKills?'resultImprove':'resultBonus')}):t('resultRetry');
  $('result-score').textContent=battle.score;
  $('result-stats').innerHTML=`<div><strong>${battle.enemyKills}</strong><span>${esc(t('enemyKills'))}</span></div><div><strong>${battle.friendlyKills}</strong><span>${esc(t('friendlyLosses'))}</span></div><div><strong>${battle.remaining}</strong><span>${esc(t('remaining'))}</span></div>`;
  $('result-next').textContent=t(levelIndex<LEVELS.length-1?'nextMission':'firstMission');
}
function renderHints() {
  $('hint-list').innerHTML=levelCopy().hints.slice(0,hintCount).map((h,i)=>`<div class="hint-item"><span>INTEL ${pad(i+1)}</span><p>${esc(h)}</p></div>`).join('')+(hintCount===level().hints.length?`<div class="hint-item"><span>${esc(t('solutionTitle'))}</span><code>${esc(level().solution)}</code><p>${esc(t('solutionBody'))}</p></div>`:'');
  $('next-hint').disabled=hintCount>=level().hints.length;
}
function renderSound() {
  $('sound-button').textContent=t('sound',{state:sound?'ON':'OFF'});
  $('sound-button').setAttribute('aria-pressed',String(sound));
}
function changeLanguage(nextLanguage) {
  language=resolveLanguage(nextLanguage);
  try {localStorage.setItem(LANGUAGE_STORAGE_KEY,language);} catch {}
  // Re-render presentation only. Inputs, battle state and report data remain intact.
  applyStaticTranslations(language);
  $('mission-brief').textContent=levelCopy().brief;
  $('hover-coordinate').textContent=t('coordinatePrompt');
  render();renderHints();renderSound();
  if(battle.finished)renderResult();
  if(toastKey)$('toast').textContent=t(toastKey);
}

$('language-select').addEventListener('change',e=>changeLanguage(e.target.value));
$('mission-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-level]');if(b&&!busy)loadLevel(Number(b.dataset.level));});
$('grid').addEventListener('click',e=>{const b=e.target.closest('[data-cell]');if(!b||busy||battle.finished)return;const k=b.dataset.cell;selectedTargets.has(k)?selectedTargets.delete(k):selectedTargets.add(k);setSelectedGoal();});
$('grid').addEventListener('pointerover',e=>{const b=e.target.closest('[data-cell]');if(b)$('hover-coordinate').textContent=`COORDINATE (${b.dataset.cell.replace(',',', ')})`;});
$('grid').addEventListener('pointerleave',()=>{$('hover-coordinate').textContent=t('coordinatePrompt');});
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
$('sound-button').addEventListener('click',()=>{sound=!sound;renderSound();if(sound)playSound(true);});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeDialog(b.dataset.close)));
document.querySelectorAll('dialog').forEach(d=>d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}}));
document.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter'&&!document.querySelector('dialog[open]')){e.preventDefault();fire(e.shiftKey?'salvo':'single');}});
applyStaticTranslations(language);
loadLevel(0);
renderSound();

// Retire the previously shipped isolation worker without touching other apps.
if ('serviceWorker' in navigator) {
  const retiredWorker = new URL('./isolation-worker.js', import.meta.url).href;
  const appScope = new URL('./', import.meta.url).href;
  navigator.serviceWorker.getRegistrations().then(registrations => Promise.all(
    registrations.filter(registration => {
      const workers = [registration.active, registration.waiting, registration.installing].filter(Boolean);
      return registration.scope === appScope && workers.length > 0 && workers.every(worker => worker.scriptURL === retiredWorker);
    }).map(registration => registration.unregister())
  )).catch(() => {});
}
