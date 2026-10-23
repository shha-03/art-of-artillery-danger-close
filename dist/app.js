import { parseExpression, evaluate, initialStatesForLevel, traceInputsForLevel, isInitializedLevel, projectPredicate, previewCandidatesForLevel, createBattle, orderStages, formatEngineError } from './engine.js';
import { LEVELS, CHAPTERS } from './levels.js';
import { LANGUAGE_STORAGE_KEY, resolveLanguage, translate } from './i18n.js';
import { applyStaticTranslations, renderHintContent, UI_COPY } from './ui-copy.js';
import { UNIT_TYPES, unitPoints, unitSymbol } from './unit-types.js';
import { createArtilleryAudio } from './artillery-audio.js';
import { createBattleEffects } from './battle-effects.js';
import { runFiringSequence, stagePassed } from './firing-sequence.js';

const $ = id => document.getElementById(id);
const esc = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key = p => `${p.x},${p.y}`;
const pad = n => String(n).padStart(2, '0');
const point = p => p ? `(${p.x}, ${p.y})` : '—';
let levelIndex = 0, selectedInitialIndex = 0, battle, lastAnalysis = null, records = [], selectedTargets = new Set();
let browsingChapter = CHAPTERS[0].id;
let traceInputs = [], allowedInputCount = 0;
let preview = true, traceVisible = false, busy = false, sound = true;
let witness = null, impacts = [], hintCount = 1, turnToken = 0, toastTimer;
let firingPhase = 'idle', currentStage = null, sequenceStarted = false, sequenceAbort = null;
let revealedStages = new Set();
const SOUND_STORAGE_KEY = 'danger-close-sound-v1';
try { sound = localStorage.getItem(SOUND_STORAGE_KEY) !== 'off'; } catch {}
const artilleryAudio = createArtilleryAudio();
artilleryAudio.setEnabled(sound);
const battleEffects = createBattleEffects({ grid: $('grid'), battlefield: document.querySelector('.battlefield'), commandPanel: document.querySelector('.command-panel') });
const BEST_STORAGE_KEY = 'danger-close-best-general-v1';
const PREVIOUS_BEST_STORAGE_KEY = 'danger-close-best-branches-v1';
const LEGACY_BEST_STORAGE_KEY = 'danger-close-best-math-v2';
function readBestScores(storageKey) {
  try {
    const saved=JSON.parse(localStorage.getItem(storageKey)||'{}');
    if(saved&&typeof saved==='object'&&!Array.isArray(saved))return Object.fromEntries(LEVELS.filter(l=>Number.isSafeInteger(saved[l.id])).map(l=>[l.id,saved[l.id]]));
  }catch{}
  return {};
}
let best=readBestScores(BEST_STORAGE_KEY);
const previousBest=readBestScores(PREVIOUS_BEST_STORAGE_KEY);
const legacyBest=readBestScores(LEGACY_BEST_STORAGE_KEY);
let savedLanguage;
try { savedLanguage = localStorage.getItem(LANGUAGE_STORAGE_KEY); } catch {}
let language = resolveLanguage(savedLanguage, navigator.languages || [navigator.language]);
let feedbackState = { type: 'ready' }, toastKey = null;
const t = (key, parameters) => translate(language, key, parameters);
const levelCopy = (l = level()) => language === 'en' ? l.en : l;
const chapterCopy = chapter => language === 'en' ? chapter.en : chapter;
const chapterLevels = id => LEVELS.map((mission, index) => ({ mission, index })).filter(({mission}) => mission.chapter === id);
const isComplete = mission => best[mission.id] !== undefined || previousBest[mission.id] !== undefined || legacyBest[mission.id] !== undefined;
const completedCount = missions => missions.filter(isComplete).length;
const missionStatus = mission => {
  const reports=[];
  if(best[mission.id]!==undefined)reports.push(t('missionBest',{score:best[mission.id]}));
  if(previousBest[mission.id]!==undefined)reports.push(t('previousBest',{score:previousBest[mission.id]}));
  if(legacyBest[mission.id]!==undefined)reports.push(t('legacyBest',{score:legacyBest[mission.id]}));
  return reports.join(' · ')||t('missionUnfinished');
};
const missionBadge = mission => best[mission.id]!==undefined?`✓ ${best[mission.id]} PT`:previousBest[mission.id]!==undefined?t('previousBadge',{score:previousBest[mission.id]}):legacyBest[mission.id]!==undefined?t('legacyBadge',{score:legacyBest[mission.id]}):'↗';
const branchName = unit => {const branch=UNIT_TYPES[unit?.branch];return branch?(language==='en'?branch.en.name:branch.name):t('untypedUnit');};
const signedUnitPoints = (unit,affiliation) => `${affiliation==='enemy'?'+':'−'}${unitPoints(unit)}`;
const scoreBreakdown = () => t('scoreBreakdown',{enemyPoints:battle.enemyPoints,friendlyPoints:battle.friendlyPoints,remaining:battle.remaining,score:battle.score});
const precisionSummary = unit => {
  const risk=unit.targetingRisk;
  if(!Number.isInteger(risk?.friendlyCount))return '';
  if(risk.friendlyCount===0)return t('rosterSimpleSeparation');
  const coordinates=(risk.friendlies||[]).map(point).join(', ');
  return t('rosterSeparation',{count:risk.friendlyCount})+(coordinates?` · ${t('rosterPrecisionCoordinates',{coordinates})}`:'');
};

function level() { return LEVELS[levelIndex]; }
function flash(messageKey) {
  toastKey = messageKey; $('toast').textContent = t(messageKey); $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; toastKey = null; }, 3200);
}
function openDialog(id) { if (!$(id).open) $(id).showModal(); }
function closeDialog(id) { $(id).close(); }
function traceForLevel() {
  const l = level(), guard = parseExpression(l.guardSource), trace = [{...traceInputs[selectedInitialIndex]}];
  for (let n=0; n<256 && evaluate(guard, trace.at(-1)); n++) {
    const current=trace.at(-1), next=l.step(current);
    trace.push({...current,x:next.x,y:next.y});
  }
  return trace;
}
function previewCandidates() {
  const taken = new Set(battle.hit.map(key)), enemies = new Set(battle.enemies.map(key)), allies = new Set(battle.allies.map(key));
  let projected=[];
  try { projected=previewCandidatesForLevel($('invariant-input').value,level()); } catch { return []; }
  const result=projected.filter(p=>!taken.has(key(p))).map(p=>({...p,type:enemies.has(key(p))?'enemy':allies.has(key(p))?'friendly':'neutral'}));
  const priority={neutral:0,friendly:1,enemy:2};
  return result.sort((a,b)=>priority[a.type]-priority[b.type] || a.x-b.x || a.y-b.y);
}
function renderTabs() {
  const chapter = CHAPTERS.find(item => item.id === browsingChapter);
  const missions = chapterLevels(browsingChapter);
  $('chapter-select').innerHTML = CHAPTERS.map(item=>`<option value="${item.id}">${esc(t('chapterOption',{number:pad(item.id),name:chapterCopy(item).name}))}</option>`).join('');
  $('chapter-select').value=String(browsingChapter);
  $('chapter-description').textContent=chapterCopy(chapter).description;
  $('chapter-difficulty').textContent=t('chapterDifficulty',{number:CHAPTERS.indexOf(chapter)+1,total:CHAPTERS.length});
  $('campaign-progress').textContent=t('campaignProgress',{completed:completedCount(LEVELS),total:LEVELS.length});
  $('chapter-progress').textContent=t('chapterProgress',{completed:completedCount(missions.map(item=>item.mission)),total:missions.length});
  $('mission-tabs').innerHTML = missions.map(({mission:l,index:i})=>`<button class="mission-tab ${i===levelIndex?'active':''}" data-level="${i}" ${busy?'disabled':''} aria-current="${i===levelIndex?'step':'false'}" aria-label="${esc(t('missionChoice',{number:i+1,name:levelCopy(l).name,status:missionStatus(l)}))}"><span class="mission-index">${pad(i+1)}</span><span class="mission-name">${esc(levelCopy(l).name)}<small>${esc(levelCopy(l).concept)}</small></span><span class="mission-check">${esc(missionBadge(l))}</span></button>`).join('');
  $('current-round').textContent=t('currentRound',{number:pad(levelIndex+1),total:LEVELS.length,name:levelCopy().name});
  $('previous-round').disabled=busy||levelIndex===0;
  $('next-round').disabled=busy;
  $('next-round').textContent=t(levelIndex<LEVELS.length-1?'nextMission':'campaignOverview');
  $('overview-button').disabled=busy;
  $('operation-label').textContent=t('operationNumber',{number:pad(levelIndex+1),total:LEVELS.length});
  $('mission-concept').textContent=t('learningFocus',{concept:levelCopy().concept});
  if($('campaign-dialog').open)renderOverview();
}
function renderOverview() {
  $('overview-progress').textContent=t('campaignProgress',{completed:completedCount(LEVELS),total:LEVELS.length});
  $('campaign-chapters').innerHTML=CHAPTERS.map(chapter=>{
    const missions=chapterLevels(chapter.id), copy=chapterCopy(chapter);
    return `<section class="overview-chapter" aria-labelledby="overview-chapter-${chapter.id}"><div class="overview-chapter-heading"><h3 id="overview-chapter-${chapter.id}"><span>${pad(chapter.id)}</span>${esc(copy.name)}</h3><span>${esc(t('chapterProgress',{completed:completedCount(missions.map(item=>item.mission)),total:missions.length}))}</span></div><p>${esc(copy.description)}</p><div class="overview-grid">${missions.map(({mission,index})=>`<button class="overview-mission ${index===levelIndex?'is-current':''} ${isComplete(mission)?'is-complete':''}" data-level="${index}" aria-current="${index===levelIndex?'step':'false'}" ${busy?'disabled':''}><span class="overview-number">${pad(index+1)}</span><span class="overview-name">${esc(levelCopy(mission).name)}</span><small>${esc(levelCopy(mission).concept)}</small><span class="overview-status">${index===levelIndex?`${esc(t('currentMission'))} · `:''}${esc(missionStatus(mission))}</span></button>`).join('')}</div></section>`;
  }).join('');
}
function showOverview() {
  if(busy)return;
  renderOverview();openDialog('campaign-dialog');
}
function selectRound(index) {
  if(busy||!Number.isInteger(index)||index<0||index>=LEVELS.length)return;
  if($('campaign-dialog').open)closeDialog('campaign-dialog');
  if(index===levelIndex){browsingChapter=level().chapter;renderTabs();return;}
  loadLevel(index);
}
function nextRound() {
  if(busy)return;
  if(levelIndex===LEVELS.length-1)showOverview();
  else selectRound(levelIndex+1);
}
function renderInitialInputs() {
  if(isInitializedLevel(level())) {
    $('initial-condition-panel').hidden=false;
    $('initial-condition-description').textContent=t('externalInputs');
    $('initial-condition-code').textContent='requires true;  (a, b) ∈ ℤ²';
    $('initial-scope').textContent=t('externalScope',{count:allowedInputCount});
    $('initial-input-label').textContent=t('battlefieldInputs');
    $('initial-input-help').textContent=t('battlefieldInputsHelp');
    $('initial-inputs').innerHTML=traceInputs.map((p,i)=>`<button class="initial-input ${i===selectedInitialIndex?'active':''}" data-initial-index="${i}" aria-pressed="${i===selectedInitialIndex}" aria-label="${esc(t('inputCase',{number:i+1,point:`(${p.a}, ${p.b})`}))}"><span>${pad(i+1)}</span><code>(a,b) = (${p.a}, ${p.b})</code><small>${esc(t('initializedState',{point:point(p),n:p.n,m:p.m}))}</small></button>`).join('');
    return;
  }
  const condition=level().initialCondition, predicate=condition!==undefined;
  $('initial-condition-panel').hidden=!predicate;
  $('initial-condition-description').textContent=predicate?t(condition.trim()==='true'?'unrestrictedInputs':'predicateInputs'):'';
  $('initial-condition-code').textContent=predicate?`P(x, y) = ${condition}`:'';
  $('initial-scope').textContent=predicate?t('initialScope',{count:allowedInputCount}):'';
  $('initial-input-label').textContent=t(predicate?'traceSamples':'allowedInputs');
  $('initial-input-help').textContent=t(predicate?'traceSamplesHelp':'allowedInputsHelp');
  $('initial-inputs').innerHTML = traceInputs.map((p,i)=>`<button class="initial-input ${i===selectedInitialIndex?'active':''}" data-initial-index="${i}" aria-pressed="${i===selectedInitialIndex}" aria-label="${esc(t('inputCase',{number:i+1,point:point(p)}))}"><span>${pad(i+1)}</span><code>${point(p)}</code></button>`).join('');
}
function renderMap() {
  const l=level(), candidates=previewCandidates(), candidateSet=new Set(candidates.map(key));
  let goals=[], terminals=[];
  try { goals=projectPredicate($('goal-input').value,l); } catch {}
  try { terminals=projectPredicate(`!(${l.guardSource})`,l); } catch {}
  const goalSet=new Set(goals.map(key)), terminalSet=new Set(terminals.map(key));
  const enemies=new Map(battle.enemies.map(unit=>[key(unit),unit])), allies=new Map(battle.allies.map(unit=>[key(unit),unit]));
  const hitMap=new Map(battle.hit.map(p=>[key(p),p])), impactSet=new Set(impacts.map(key));
  const cells=['<span class="axis-label axis-corner">Y / X</span>'];
  for(let x=0;x<l.size;x++)cells.push(`<span class="axis-label">${x}</span>`);
  for(let y=l.size-1;y>=0;y--) {
    cells.push(`<span class="axis-label">${y}</span>`);
    for(let x=0;x<l.size;x++) {
      const p={x,y}, k=key(p), hit=hitMap.get(k), type=enemies.has(k)?'enemy':allies.has(k)?'friendly':'neutral';
      const terminal=terminalSet.has(k), objective=goalSet.has(k);
      const classes=['cell',type,terminal?'terminal':'',preview&&candidateSet.has(k)?'candidate':'',preview&&key(candidates[0]||{})===k?'next-target':'',objective?'objective':'',hit?'hit':'',impactSet.has(k)?'impact':'',witness&&key(witness)===k?'witness':''].filter(Boolean).join(' ');
      const unit=hit||enemies.get(k)||allies.get(k), affiliation=hit?.type||type;
      const isUnit=affiliation==='enemy'||affiliation==='friendly';
      const content=hit?`<span class="crater ${esc(hit.type||'neutral')}">×</span>`:isUnit?`${unitSymbol(affiliation,unit.branch)}<span class="unit-points ${affiliation}" aria-hidden="true">${signedUnitPoints(unit,affiliation)}</span>`:'<span class="neutral-dot"></span>';
      const unitLabel=isUnit?t('unitDescription',{affiliation:t(affiliation),branch:branchName(unit),points:signedUnitPoints(unit,affiliation)}):t('neutral');
      const labelParams={x,y,unit:hit?t('struckUnit',{unit:unitLabel}):unitLabel,objective:objective?t('objectiveSuffix'):''};
      cells.push(`<button class="${classes}" data-cell="${x},${y}" aria-label="${esc(t('cellLabel',labelParams))}" aria-pressed="${objective?'true':'false'}" title="${esc(t('cellTitle',labelParams))}" ${busy?'disabled':''}>${content}<span class="cell-coordinate">${x},${y}</span>${objective?'<span class="target-reticle"></span>':''}</button>`);
    }
  }
  const xy = p => `${p.x*100+50},${(l.size-1-p.y)*100+50}`;
  let overlay='';
  $('trace-summary').hidden=!traceVisible;
  if(traceVisible) {
    const t=traceForLevel(), start=t[0]; overlay += `<defs><clipPath id="trace-bounds"><rect width="${l.size*100}" height="${l.size*100}"/></clipPath></defs><g clip-path="url(#trace-bounds)"><polyline class="trace-path" points="${t.map(xy).join(' ')}"/><circle class="trace-start" cx="${start.x*100+50}" cy="${(l.size-1-start.y)*100+50}" r="11"/>`;
    const end=t.at(-1); overlay += `<circle class="trace-end" cx="${end.x*100+50}" cy="${(l.size-1-end.y)*100+50}" r="15"/></g>`;
    $('trace-summary').textContent=translate(language,'traceSummary',{start:point(start),end:point(end),count:t.length-1})+(t.some(p=>p.x<0||p.y<0||p.x>=l.size||p.y>=l.size)?translate(language,'traceOffBoard'):'');
  }
  for(const p of impacts) overlay+=`<path class="shell-trail" d="M -30 ${l.size*100+50} Q ${p.x*100-100} ${Math.max(-50,(l.size-1-p.y)*100-180)} ${xy(p).replace(',',' ')}"/>`;
  cells.push(`<svg class="trace-layer" viewBox="0 0 ${l.size*100} ${l.size*100}" aria-hidden="true">${overlay}</svg>`);
  $('grid').style.setProperty('--size',l.size); $('grid').innerHTML=cells.join('');
  $('map-sector').textContent=`SECTOR ${pad(levelIndex+1)} · ${pad(l.size)} × ${pad(l.size)}`;
  $('map-status').textContent = battle.finished ? t(battle.cleared?'mapCleared':'mapEnded') : candidates.length?t('mapCandidates',{count:candidates.length,point:point(candidates[0]),status:t(lastAnalysis?.valid&&stagePassed(lastAnalysis,'goal')?'verified':'pending')}):t('noCandidates');
  $('preview-button').classList.toggle('active',preview); $('preview-button').setAttribute('aria-pressed',String(preview));
  $('trace-button').classList.toggle('active',traceVisible); $('trace-button').setAttribute('aria-pressed',String(traceVisible));
  renderUnitRoster();
}
function renderUnitRoster() {
  $('branch-legend').innerHTML=Object.entries(UNIT_TYPES).map(([branch,type])=>`<span class="branch-legend-item" role="listitem">${unitSymbol('enemy',branch,'branch-symbol')}<span>${esc(t('branchValue',{branch:branchName({branch}),points:type.points}))}</span></span>`).join('');
  $('roster-totals').textContent=t('rosterTotals',{enemyPoints:battle.enemies.reduce((sum,unit)=>sum+unitPoints(unit),0),friendlyPoints:battle.allies.reduce((sum,unit)=>sum+unitPoints(unit),0)});
  const hits=new Set(battle.hit.map(key));
  $('roster-content').innerHTML=[['enemy',level().enemies],['friendly',level().allies]].map(([affiliation,units])=>`<section class="roster-side ${affiliation}"><h3>${esc(t(affiliation))}</h3><ul>${units.map(unit=>{
    const struck=hits.has(key(unit));
    const criterion=affiliation==='enemy'?precisionSummary(unit):t('rosterFriendly');
    const status=(struck?`${t(affiliation==='enemy'?'rosterEliminated':'rosterLost')} · `:'')+criterion;
    return `<li class="roster-unit ${struck?'is-struck':''}">${unitSymbol(affiliation,unit.branch,'roster-symbol')}<span class="roster-identity"><strong>${esc(branchName(unit))}</strong><code>${point(unit)}</code></span><b class="roster-value">${signedUnitPoints(unit,affiliation)}</b><small>${esc(status)}</small></li>`;
  }).join('')}</ul></section>`).join('');
}
function renderStats() {
  $('remaining-stat').textContent=pad(battle.remaining); $('budget-stat').textContent=`/ ${pad(battle.budget)}`;
  $('kills-stat').textContent=pad(battle.enemyKills); $('enemies-stat').textContent=`/ ${pad(level().enemies.length)}`;
  $('score-stat').textContent=battle.score;
  $('score-breakdown').textContent=scoreBreakdown();
  $('friendly-loss-count').textContent=t('friendlyCount',{count:battle.friendlyKills});
  const disabled=busy||battle.finished||!$('goal-input').value.trim()||!$('invariant-input').value.trim();
  $('single-button').disabled=disabled; $('salvo-button').disabled=disabled;
  $('restart-button').disabled=busy; $('invariant-input').disabled=busy||battle.finished; $('goal-input').disabled=busy||battle.finished;
  $('language-select').disabled=busy; $('chapter-select').disabled=busy;
  for (const id of ['preview-button','trace-button','hint-button','help-button','domain-button']) $(id).disabled=busy;
  document.querySelectorAll('[data-initial-index], [data-insert]').forEach(button=>{button.disabled=busy;});
  $('target-enemies').disabled=busy||battle.finished;
  const proofOnly=isInitializedLevel(level())&&!battle.enemies.length&&!battle.finished;
  for(const mode of ['single','salvo']) {
    $(`${mode}-button`).querySelector('[data-i18n-html]').innerHTML=proofOnly
      ? `${esc(t('finalVerification'))}<small>${esc(t('freeVerification'))}</small>`
      : UI_COPY[language][`fire.${mode}`];
  }
  $('command-note').textContent=t(battle.finished?'commandEnded':!battle.enemies.length?'proofRequiredBody':!$('goal-input').value.trim()?'commandNoGoal':'commandKeys');
}
function renderChecks() {
  $('verification-strip').innerHTML=['initial','preservation','goal'].map(k=>{
    const running=currentStage===k;
    if(sequenceStarted&&!running&&!revealedStages.has(k))return '';
    const check=lastAnalysis?.[k], failedError=lastAnalysis?.errorStage===k;
    const pending=!failedError&&(!check||typeof check.pass!=='boolean');
    const passed=stagePassed(lastAnalysis,k);
    const state=running?'running':pending?'pending':passed?'pass':'fail';
    const detail=running?t('checking'):pending?t('afterOrder'):failedError?t('incomplete'):passed?t(k==='initial'?(level().initialCondition!==undefined?'initialDomainPassed':'initialPassed'):'passed',{count:check.checkedCount}):t(k==='goal'?'unproven':'dud');
    return `<div class="check-item ${state}" data-check="${k}" data-status="${state}"><span class="check-icon">${running?'◌':pending?'○':passed?'✓':'×'}</span><span class="check-title">${esc(t(k))}</span><span class="check-detail">${esc(detail)}</span></div>`;
  }).join('');
}
function renderSequence() {
  const banner=$('sequence-status');
  banner.dataset.phase=firingPhase;
  banner.querySelector('.sequence-status-title').textContent=t(`sequence.${firingPhase}.title`);
  banner.querySelector('.sequence-status-detail').textContent=t(`sequence.${firingPhase}.detail`);
  if(busy&&['fire','flight-delay','flight','impact','radio'].includes(firingPhase))$('map-status').textContent=t(`sequence.${firingPhase}.title`);
  $('verification-strip').setAttribute('aria-busy',String(Boolean(currentStage)));
}
function feedback(kind,title,body,detail='') {
  $('feedback-panel').dataset.kind=kind;
  $('feedback-panel').innerHTML=`<div class="feedback-title">${esc(title)}</div><div class="feedback-body">${esc(body)}</div>${detail?`<div class="feedback-witness">${esc(detail)}</div>`:''}`;
}
function witnessReport(analysis) {
  if(analysis.initial.pass!==false&&analysis.preservation.pass!==false) {
    const check=analysis.specification?.pass===false?analysis.specification:analysis.goal;
    return t('goalFailed',{point:point(check.before)})+witnessContext(check.before);
  }
  const initial=analysis.initial.pass===false;
  const check=initial?analysis.initial:analysis.preservation;
  return t(initial?'initialWitness':'preservationWitness',{before:point(check.before),after:point(check.after),outside:check.outsideDomain?t('outsideDomain'):''})+witnessContext(check.before);
}
function witnessContext(state) {
  return state && Number.isInteger(state.a)?` · ${t('inputContext',state)}`:'';
}
function shotReport(event) {
  const enemies=event.shots.filter(shot=>shot.type==='enemy'),friendlies=event.shots.filter(shot=>shot.type==='friendly');
  const points=shots=>shots.reduce((sum,shot)=>sum+(shot.points??unitPoints(shot)),0);
  return {mode:t(event.mode),count:event.shots.length,enemy:enemies.length,friendly:friendlies.length,neutral:event.shots.filter(s=>s.type==='neutral').length,enemyPoints:points(enemies),friendlyPoints:points(friendlies)};
}
function renderFeedback() {
  const f=feedbackState;
  if(f.type==='sequencing')return feedback('ready',t(`sequence.${firingPhase}.title`),t(`sequence.${firingPhase}.detail`));
  if(f.type==='ready'||f.type==='modified') return feedback('ready',t(`${f.type}Title`),t(`${f.type}Body`));
  if(f.type==='error') return feedback('error',t('rejectedTitle'),formatEngineError(f.error,language),t('noCharge'));
  if(f.type==='empty') return feedback('ready',t('emptyTitle'),t('emptyBody'),t('noCharge'));
  if(f.type==='proved') return feedback('success',t('provedTitle'),t('provedBody'),t('noCharge'));
  if(f.type==='proof-required') {
    const a=f.analysis, failing=a.initial.pass===false||a.preservation.pass===false;
    return feedback('warning',t('proofRequiredTitle'),t('proofRequiredBody'),failing?witnessReport(a):t('goalFailed',{point:point(a.specification?.before||a.goal.before)})+witnessContext(a.specification?.before||a.goal.before));
  }
  if(f.type==='exception') return feedback('error',t('exceptionTitle'),formatEngineError(f.error,language));
  if(f.type==='dud') return feedback('error',t('dudTitle',{mode:t(f.mode)}),t(f.analysis.initial.pass===false?'initialFailure':f.analysis.preservation.pass===false?'preservationFailure':'exitFailure'),witnessReport(f.analysis));
  if(f.type==='fired') {
    const report=shotReport(f), goalPassed=f.analysis.goal.pass===true;
    feedback(report.friendly?'error':goalPassed?'success':'warning',t('firedTitle',report),t('damageReport',report),goalPassed?t('goalPassed'):t(level().initialCondition?.trim()==='true'?'unrestrictedGoalFailed':'goalFailed',{point:point(f.analysis.goal.before)})+witnessContext(f.analysis.goal.before));
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
function render() {renderTabs();renderInitialInputs();renderStats();renderMap();renderChecks();renderSequence();renderLogs();renderFeedback();}
function invalidateAnalysis() {
  if(busy)return;
  sequenceStarted=false;revealedStages.clear();currentStage=null;firingPhase='idle';battleEffects.clear();
  lastAnalysis=null; witness=null; renderChecks();renderMap();renderStats();
  feedbackState={type:'modified'};renderFeedback();renderSequence();
}
function loadLevel(index) {
  sequenceAbort?.abort();sequenceAbort=null;artilleryAudio.stopAll();battleEffects.clear();
  firingPhase='idle';currentStage=null;sequenceStarted=false;revealedStages.clear();
  levelIndex=index; selectedInitialIndex=0; battle=createBattle(level()); lastAnalysis=null;records=[];selectedTargets=new Set();witness=null;impacts=[];hintCount=1;busy=false;turnToken++;
  browsingChapter=level().chapter;
  traceInputs=traceInputsForLevel(level()); allowedInputCount=initialStatesForLevel(level()).length;
  $('invariant-input').value=level().starter; $('goal-input').value=isInitializedLevel(level())?level().goalSolution:'';
  $('goal-input').readOnly=isInitializedLevel(level());
  $('target-enemies').hidden=isInitializedLevel(level());
  $('mission-brief').textContent=levelCopy().brief;
  $('initialization-code').textContent=level().initializationCode||'';
  $('program-code').innerHTML=level().code.split('\n').map((line,i)=>`<span class="code-line"><span class="line-number">${pad(i+1)}</span><span>${esc(line).replace(/\b(while|if|else)\b/g,'<span class="code-keyword">$1</span>')}</span></span>`).join('');
  feedbackState={type:'ready'};
  render();
}
function setSelectedGoal() {
  if(isInitializedLevel(level()))return;
  $('goal-input').value=[...selectedTargets].map(k=>{const [x,y]=k.split(',');return `(x == ${x} && y == ${y})`;}).join(' || ');
  invalidateAnalysis();
}
function setFiringPhase(phase) {
  firingPhase=phase;
  if(phase!=='flight-delay')battleEffects.setPhase(phase);
  renderSequence();renderFeedback();
}
function playCue(cue,options) {if(!document.hidden)artilleryAudio.play(cue,options);}
function applyOrderResult(result,mode,expression) {
  lastAnalysis=result.analysis||lastAnalysis;
  battle=result.battle;
  if(result.error) {feedbackState={type:'error',error:result};return;}
  if(result.reason==='proved'||result.reason==='proof-required') {feedbackState={type:result.reason,analysis:lastAnalysis};return;}
  if(result.dud) {
    const failed=lastAnalysis.initial.pass===false?lastAnalysis.initial:lastAnalysis.preservation.pass===false?lastAnalysis.preservation:lastAnalysis.specification?.pass===false?lastAnalysis.specification:lastAnalysis.goal;
    witness=failed?.before||null;
    feedbackState={type:'dud',mode,analysis:lastAnalysis};
    records.unshift({...feedbackState,kind:'dud',expression});
  } else if(result.shots?.length) {
    witness=null;
    feedbackState={type:'fired',mode,analysis:lastAnalysis,shots:result.shots};
    records.unshift({...feedbackState,kind:result.shots.some(s=>s.type==='friendly')?'dud':'success',expression});
  } else feedbackState={type:'empty'};
}
async function fire(mode) {
  if(busy||battle.finished) return;
  if(!$('goal-input').value.trim()) { flash('missingGoal');$('goal-input').focus();return; }
  // Unlock in the user gesture, before any timer or verifier work.
  if(sound)void artilleryAudio.unlock();
  sequenceAbort?.abort();sequenceAbort=new AbortController();
  const expression=$('invariant-input').value, goalSource=$('goal-input').value;
  busy=true;sequenceStarted=true;revealedStages.clear();currentStage='initial';firingPhase='initial';
  lastAnalysis=null;witness=null;impacts=[];battleEffects.clear();feedbackState={type:'sequencing'};
  render();
  const currentToken=turnToken;
  try {
    await runFiringSequence({iterator:orderStages(battle,expression,goalSource,mode),mode,signal:sequenceAbort.signal,onEvent:event=>{
      if(currentToken!==turnToken)return;
      if(event.type==='checking') {
        currentStage=event.stage;setFiringPhase(event.stage);renderChecks();
      } else if(event.type==='checked') {
        lastAnalysis=event.analysis;revealedStages.add(event.stage);currentStage=null;renderChecks();
      } else if(event.type==='phase') {
        currentStage=null;setFiringPhase(event.phase);
        const cues={'breech-open':'breechOpen',loaded:'loadClose',fire:'fire',radio:'radio',failed:'failure'};
        if(cues[event.phase])playCue(cues[event.phase]);
        // Cut to the battlefield before flight begins. A long smooth scroll
        // from the mobile command panel would hide the short shell animation.
        if(event.phase==='flight-delay')document.querySelector('.battlefield').scrollIntoView({behavior:'instant',block:'center'});
        if(event.phase==='flight') {
          battleEffects.launch(event.shots,{mode,size:level().size});
        }
        if(event.phase==='impact') {
          battleEffects.impact(event.shots,{mode,size:level().size});
          playCue(mode==='salvo'?'salvoImpact':'impact',{count:event.shots.length});
        }
        if(event.phase==='radio')battleEffects.radio();
      } else if(event.type==='commit') {
        applyOrderResult(event.result,mode,expression);render();
      } else if(event.type==='finished') {
        currentStage=null;busy=false;
        if(battle.finished){setFiringPhase('complete');playCue('bugle',{success:battle.cleared});}
        else if(firingPhase!=='failed')setFiringPhase('idle');
        render();
        if(battle.finished)showResult();
      }
    }});
  } catch(error) {
    artilleryAudio.stopAll();battleEffects.clear();currentStage=null;busy=false;
    firingPhase='failed';feedbackState={type:'exception',error};render();
  }
}
function showResult() {
  const clear=battle.cleared;
  if(clear) {
    best[level().id]=Math.max(best[level().id]??-Infinity,battle.score);
    try{localStorage.setItem(BEST_STORAGE_KEY,JSON.stringify(best));}catch{}
  }
  renderResult();renderTabs();openDialog('result-dialog');
}
function renderResult() {
  const clear=battle.cleared;
  $('result-kicker').textContent=clear?'MISSION COMPLETE':'MISSION ENDED';
  $('result-title').textContent=t(clear?(battle.friendlyKills?'resultFriendly':'resultClean'):'resultFailed');
  $('result-copy').textContent=clear?t('resultClear',{name:levelCopy().name,instruction:t(battle.friendlyKills?'resultImprove':'resultBonus')}):t('resultRetry');
  $('result-score').textContent=battle.score;
  $('result-breakdown').textContent=scoreBreakdown();
  $('result-stats').innerHTML=`<div><strong>${battle.enemyKills}</strong><span>${esc(t('enemyKills'))}</span></div><div><strong>${battle.friendlyKills}</strong><span>${esc(t('friendlyLosses'))}</span></div><div><strong>${battle.remaining}</strong><span>${esc(t('remaining'))}</span></div>`;
  $('result-next').textContent=t(levelIndex<LEVELS.length-1?'nextMission':'campaignOverview');
}
function renderHints() {
  $('hint-list').innerHTML=renderHintContent(level(),language,hintCount);
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
$('chapter-select').addEventListener('change',e=>{
  const chapter=Number(e.target.value);
  if(CHAPTERS.some(item=>item.id===chapter)){browsingChapter=chapter;renderTabs();}
});
$('mission-tabs').addEventListener('click',e=>{const b=e.target.closest('[data-level]');if(b)selectRound(Number(b.dataset.level));});
$('campaign-chapters').addEventListener('click',e=>{const b=e.target.closest('[data-level]');if(b)selectRound(Number(b.dataset.level));});
$('overview-button').addEventListener('click',showOverview);
$('previous-round').addEventListener('click',()=>selectRound(levelIndex-1));
$('next-round').addEventListener('click',nextRound);
$('initial-inputs').addEventListener('click',e=>{const b=e.target.closest('[data-initial-index]');if(!b||busy)return;selectedInitialIndex=Number(b.dataset.initialIndex);traceVisible=true;renderInitialInputs();renderMap();});
$('grid').addEventListener('click',e=>{const b=e.target.closest('[data-cell]');if(!b||busy||battle.finished||isInitializedLevel(level()))return;const k=b.dataset.cell;selectedTargets.has(k)?selectedTargets.delete(k):selectedTargets.add(k);setSelectedGoal();});
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
$('result-next').addEventListener('click',()=>{closeDialog('result-dialog');nextRound();});
$('sound-button').addEventListener('click',async()=>{
  sound=!sound;artilleryAudio.setEnabled(sound);renderSound();
  try{localStorage.setItem(SOUND_STORAGE_KEY,sound?'on':'off');}catch{}
  if(sound&&await artilleryAudio.unlock())playCue('radio');
});
document.addEventListener('visibilitychange',()=>{if(document.hidden)artilleryAudio.stopAll();});
window.addEventListener('pagehide',()=>{sequenceAbort?.abort();artilleryAudio.stopAll();battleEffects.clear();});
window.addEventListener('pageshow',event=>{
  if(event.persisted&&busy){
    busy=false;currentStage=null;firingPhase=battle.finished?'complete':'idle';
    sequenceStarted=false;revealedStages.clear();lastAnalysis=null;feedbackState={type:'modified'};render();
    if(battle.finished){playCue('bugle',{success:battle.cleared});showResult();}
  }
});
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
