import { translate } from './i18n.js';

// HTML translations below are trusted application text. The hint renderer at
// the end of this module escapes every mission-specific text field.
export const UI_COPY = {
  ko: {
    'meta.description': '불변식으로 포격을 지휘하라. Art of Artillery: Danger Close — 프로그램 검증 전술 퍼즐.',
    'brand.home': 'Art of Artillery: Danger Close 홈',
    'language.label': '표시 언어',
    'sound.off': '사운드 OFF',
    'nav.manual': '야전 교범 <span aria-hidden="true">↗</span>',
    'intro.copy': '불변식으로 아군을 엄호하고 적을 격파하라.',
    'nav.operations': '작전 선택',
    'campaign.navigation': '캠페인 탐색',
    'campaign.chapter': '챕터 선택',
    'campaign.overview': '전체 작전 ↗',
    'campaign.previous': '← 이전 작전',
    'campaign.next': '다음 작전 →',
    'campaign.close': '전체 작전 닫기',
    'campaign.title': '작전을 선택하라.',
    'campaign.note': '챕터 순서에 따라 훈련 난도가 상승한다. 모든 작전은 즉시 선택할 수 있다. 완료 기록과 최고 점수는 이 브라우저에 저장한다.',
    'campaign.return': '현재 전장 복귀',
    'map.title': '전술 지도',
    'map.preview': '후보 영역',
    'map.previewTitle': '검증 전 포격 후보 영역 표시',
    'map.trace': '실행 경로',
    'map.traceTitle': '선택한 초기 입력의 실제 실행 경로 표시',
    'map.selectCoordinate': '전장 좌표를 확인하라',
    'map.label': '전장 좌표 지도',
    'map.initialStatus': '고정 수학 명세와 포격 후보를 대조하라',
    'legend.enemy': '<img class="legend-symbol" src="./unit-hostile.svg" width="20" height="20" alt="" aria-hidden="true">적군',
    'legend.friendly': '<img class="legend-symbol" src="./unit-friendly.svg" width="20" height="20" alt="" aria-hidden="true">아군',
    'legend.candidate': '<i class="legend-dot candidate"></i>포격 후보',
    'legend.objective': '<i class="legend-dot objective"></i>수학 명세',
    'legend.hit': '<i class="legend-dot hit"></i>포격 완료',
    'units.branches': '병과·점수',
    'units.branchLabel': '병과별 점수',
    'units.pointSigns': '적군 + · 아군 −',
    'units.roster': '전력 명세',
    'units.precisionHelp': '대표 전장 입력의 실행 경로를 단순한 x·y 범위로 넓혔을 때 섞이는 아군 수로 배점한다. 0기는 보병 2점, 1기는 기갑 4점, 2기 이상은 포병 6점이다. 같은 노출 수에는 같은 점수를 부여한다.',
    'map.priorityLabel': '표적 선택 순서',
    'map.priority': '중립 <b>→</b> 아군 <b>→</b> 적군',
    'map.warning': '넓은 불변식은 오폭을 부른다.<br>주황색 영역은 검증 전 후보이다.',
    'log.title': '작전 기록',
    'log.empty': '명령 대기. 전장을 분석하고 초탄 사격을 준비하라.',
    'command.title': '포격 지휘소',
    'command.restart': '↻ 작전 재시작',
    'command.restartTitle': '현재 작전 처음부터 다시 시작',
    'stat.orders': '잔여 명령',
    'stat.kills': '적군 격파',
    'stat.score': '작전 점수',
    'command.environment': '<span>01</span> 외부 입력과 고정 프로그램 <small>READ ONLY</small>',
    'command.initialCondition': '외부 입력 계약 · 모든 정수 쌍',
    'command.initialization': '초기화 · 반복문 진입 전 한 번 실행',
    'command.loop': '반복문 · x, y만 변경',
    'command.goal': '<span>02</span> 고정 수학 명세 <code>ensures</code>',
    'command.allEnemies': '적군 전체 선택',
    'command.goalPlaceholder': '작전의 고정 수학 명세',
    'command.goalHelp': '입력과 결과의 관계를 나타내는 고정 명세이다. 불변식으로 보장하라. 지도에는 대표 입력 3개의 결과만 표시한다.',
    'command.invariant': '<span>03</span> 사격 해법 <code>invariant</code>',
    'command.intel': '정보 보고 <span aria-hidden="true">↗</span>',
    'syntax.label': '수식 기호 입력',
    'syntax.and': '그리고 &&',
    'syntax.or': '또는 ||',
    'command.region': '포격 영역 = 대표 입력별 (불변식 ∧ 종료 조건)의 합집합',
    'check.init': '초기 성립',
    'check.maintenance': '유지',
    'check.exit': '목표 보장',
    'check.pending': '명령 후 검사',
    'fire.single': '단발 포격<small>1개 좌표 · 명령 −1</small>',
    'fire.salvo': '일제사<small>후보 전체 · 명령 −1</small>',
    'command.initialNote': '고정 수학 명세를 보장할 불변식을 작성하고 사격하라.',
    'feedback.readyTitle': '사격 해법 입력 대기.',
    'feedback.readyBody': '검사창 내 초기 성립과 유지 통과 시 발사한다. 작전 완료에는 적 전멸과 고정 수학 명세 통과가 모두 필요하다.',
    'footer.motto': 'ART OF ARTILLERY: DANGER CLOSE <span class="footer-separator">/</span> 검증하라. 정밀 타격하라.',
    'footer.domain': '검사창: 입력 81개 × 상태 4,225개 · 범위 한정 ⓘ',
    'manual.close': '교범 닫기',
    'manual.title': '사격 전 검증.<br>오폭은 지휘 책임이다.',
    'manual.step1Title': '전장을 파악하라.',
    'manual.step1Body': '파란 직사각형은 아군, 빨간 마름모는 적군이다. 프로그램은 임의의 정수 입력 a, b를 받아 먼저 초기화한 뒤 반복문을 실행한다. a, b, n, m은 읽기 전용 상수이며 x, y만 변한다. 적군은 대표 입력 세 개의 실제 종료 좌표에 배치하며, 같은 종료 좌표는 한 기로 합친다. 대표 입력은 허용 입력을 제한하지 않는다. ensures는 입력과 결과의 관계를 나타내는 고정 수학 명세이다.',
    'manual.step2Title': '불변식의 초기 성립과 유지를 확보하라.',
    'manual.step2Body': '초기화 직후 참이고, 반복할 때마다 유지되는 관계를 작성하라. 예를 들어 합을 옮기는 반복문은 x+y == n+m을 보존한다. 초기 성립은 외부 입력 81개 모두의 초기화 결과에서 검사한다. 유지는 각 입력의 상수를 고정한 채 상태 검사창 전체에 적용한다. 포격 영역은 대표 입력 세 개 각각의 I ∧ ¬guard를 합친 영역이다.',
    'manual.step3Title': '사격 명령을 하달하라.',
    'manual.step3Body': '단발과 일제사는 모두 명령 1회를 소모한다. 초기 성립과 유지 통과 시 발사하며, 목표 보장 실패는 발사를 막지 않는다. 중립 → 아군 → 적군 순으로 타격하며, 일제사는 미포격 후보 전체를 공격한다. 초기 성립 또는 유지 실패 시 명령만 소모하고 불발 처리한다.',
    'manual.step4Title': '적을 격파하고 수학 명세를 보장하라.',
    'manual.step4Body': '작전 완료에는 적 전멸과 검사창 내 고정 수학 명세 통과가 모두 필요하다. 전멸 후에도 명세가 미보장이면 불변식을 수정해 무료로 재검증하라. 명령이 0이어도 최종 검증은 가능하다. 점수는 적 병과 점수 합 − 아군 피해 점수 합 + 남은 명령이다. 보병은 2점, 기갑은 4점, 포병은 6점이며 완료한 작전만 최고 점수를 기록한다.',
    'manual.precision': '배점은 대표 전장 입력의 경로를 x·y 범위로 묶고 넓은 기준 불변식과 결합한 뒤, 반복해도 유지되도록 범위를 확장해 계산한다. 종료 영역에 섞인 아군이 0기면 2점, 1기면 4점, 2기 이상이면 6점이다. 동점을 허용하며 최단 증명이나 절대적인 난도를 측정하지 않는다. 이 배점 계산이 전체 입력 검사를 대신하지 않는다. 일제사는 모든 후보를 명령 1회로 공격하며 포격 완료 칸은 재공격하지 않는다.',
    'manual.scopeTitle': '프로토타입 검증 범위',
    'manual.scopeBody': '프로그램의 입력 계약은 (a,b) ∈ ℤ²이다. 자동 검사는 별도로 정한 a,b ∈ [−4,4]의 81개 입력과 x,y ∈ [−32,32]의 4,225개 상태, 총 342,225개 조합만 다룬다. 무한 정수 전체에 대한 증명이 아니다. 지도 밖 상태와 실제로 도달하지 않는 상태도 검사한다. 불변식과 반복 조건을 만족하는 상태에서 전이 결과가 상태 검사창을 벗어나면 유지 실패로 처리한다.',
    'manual.reachability': '초기화는 임의의 외부 입력을 알고리즘의 초기 상태로 바꾼다. 외부 입력이 무제약이어도 초기화 직후 상태는 제한될 수 있으므로 비자명한 불변식을 세울 수 있다. 대표 입력 버튼은 경로 표시만 바꾸며 검사는 항상 81개 입력 모두에 적용한다. 지도 밖 경로는 잘라 표시한다. 불변식 검사 자체는 종료성을 증명하지 않는다.',
    'manual.syntax': '지원 문법: x, y, a, b, n, m, 정수, + − * %, == != < <= > >=, && || !, 괄호, true, false. a, b, n, m은 읽기 전용이다. 연속 비교 대신 x >= 0 && x <= n을 사용한다.',
    'manual.start': '작전 개시',
    'intel.close': '정보 보고 닫기',
    'intel.title': '정찰 보고.',
    'intel.note': '정보 열람은 명령 횟수를 소모하지 않는다.',
    'intel.content': '단계별 힌트와 검증 해설',
    'intel.more': '추가 정보',
    'intel.return': '전장 복귀',
    'result.close': '결과 닫기',
    'result.title': '임무 완수.',
    'result.retry': '재투입',
    'result.next': '다음 작전 →'
  },
  en: {
    'meta.description': 'Command artillery with loop invariants. Art of Artillery: Danger Close — a tactical program-verification puzzle.',
    'brand.home': 'Art of Artillery: Danger Close home',
    'language.label': 'Display language',
    'sound.off': 'Sound OFF',
    'nav.manual': 'Field manual <span aria-hidden="true">↗</span>',
    'intro.copy': 'Shield allied forces and eliminate the enemy with invariants.',
    'nav.operations': 'Select operation',
    'campaign.navigation': 'Campaign navigation',
    'campaign.chapter': 'Select chapter',
    'campaign.overview': 'All operations ↗',
    'campaign.previous': '← Previous',
    'campaign.next': 'Next operation →',
    'campaign.close': 'Close campaign overview',
    'campaign.title': 'Select an operation.',
    'campaign.note': 'Training difficulty rises through the chapters. All operations are available immediately. Completion records and best scores are saved in this browser.',
    'campaign.return': 'Return to current operation',
    'map.title': 'Tactical map',
    'map.preview': 'Candidates',
    'map.previewTitle': 'Show candidate strike area before verification',
    'map.trace': 'Execution trace',
    'map.traceTitle': 'Show the actual execution trace for the selected initial input',
    'map.selectCoordinate': 'Inspect battlefield coordinates',
    'map.label': 'Battlefield coordinate map',
    'map.initialStatus': 'Compare strike candidates with the fixed mathematical specification',
    'legend.enemy': '<img class="legend-symbol" src="./unit-hostile.svg" width="20" height="20" alt="" aria-hidden="true">Enemy',
    'legend.friendly': '<img class="legend-symbol" src="./unit-friendly.svg" width="20" height="20" alt="" aria-hidden="true">Friendly',
    'legend.candidate': '<i class="legend-dot candidate"></i>Candidate',
    'legend.objective': '<i class="legend-dot objective"></i>Specification',
    'legend.hit': '<i class="legend-dot hit"></i>Struck',
    'units.branches': 'Branch values',
    'units.branchLabel': 'Points by unit branch',
    'units.pointSigns': 'Enemy + · Friendly −',
    'units.roster': 'Unit roster',
    'units.precisionHelp': 'Values reflect friendly positions included when the battlefield samples’ paths are broadened to simple x/y bounds. Zero gives infantry 2 points, one armor 4, and two or more artillery 6. Equal exposure receives equal value.',
    'map.priorityLabel': 'Target priority',
    'map.priority': 'Neutral <b>→</b> Friendly <b>→</b> Enemy',
    'map.warning': 'Broad invariants risk friendly fire.<br>Highlighted candidates await verification.',
    'log.title': 'Operations log',
    'log.empty': 'Awaiting orders. Analyze the battlefield. Prepare the opening shot.',
    'command.title': 'Command post',
    'command.restart': '↻ Restart operation',
    'command.restartTitle': 'Restart the current operation from the beginning',
    'stat.orders': 'Orders left',
    'stat.kills': 'Enemy kills',
    'stat.score': 'Mission score',
    'command.environment': '<span>01</span> External inputs & fixed program <small>READ ONLY</small>',
    'command.initialCondition': 'Input contract · All integer pairs',
    'command.initialization': 'Initialization · Executed once before the loop',
    'command.loop': 'Loop · Only x and y change',
    'command.goal': '<span>02</span> Fixed specification <code>ensures</code>',
    'command.allEnemies': 'Select all enemies',
    'command.goalPlaceholder': 'Fixed mathematical specification for this operation',
    'command.goalHelp': 'This fixed specification relates inputs to results. Establish it with the invariant. The map shows results for three representative inputs only.',
    'command.invariant': '<span>03</span> Firing solution <code>invariant</code>',
    'command.intel': 'Intel report <span aria-hidden="true">↗</span>',
    'syntax.label': 'Insert expression operators',
    'syntax.and': 'AND &&',
    'syntax.or': 'OR ||',
    'command.region': 'Strike area = union of (invariant ∧ exit condition) for the battlefield samples',
    'check.init': 'Initiation',
    'check.maintenance': 'Preservation',
    'check.exit': 'Objective',
    'check.pending': 'Check on command',
    'fire.single': 'Single shot<small>1 coordinate · −1 order</small>',
    'fire.salvo': 'Salvo<small>All candidates · −1 order</small>',
    'command.initialNote': 'Establish the fixed specification with an invariant, then issue a fire order.',
    'feedback.readyTitle': 'Awaiting firing solution.',
    'feedback.readyBody': 'Firing requires initiation and preservation within the test windows. Completion requires all enemies eliminated and the fixed specification passed.',
    'footer.motto': 'ART OF ARTILLERY: DANGER CLOSE <span class="footer-separator">/</span> Verify. Strike with precision.',
    'footer.domain': 'Test windows: 81 inputs × 4,225 states · Bounded checks ⓘ',
    'manual.close': 'Close field manual',
    'manual.title': 'Verify before firing.<br>Take responsibility for every shot.',
    'manual.step1Title': 'Assess the battlefield.',
    'manual.step1Body': 'Blue rectangles identify friendly units; red diamonds identify enemies. The program accepts arbitrary integer inputs a and b, initializes its state, then runs the loop. a, b, n, and m are read-only; only x and y change. Enemies mark the actual exit states of the three displayed samples; shared endpoints produce one enemy. Samples do not restrict allowed inputs. The fixed ensures condition relates inputs to results.',
    'manual.step2Title': 'Establish initiation and preservation.',
    'manual.step2Body': 'State a relationship that holds after initialization and survives each loop iteration. An addition-transfer loop, for example, preserves x+y == n+m. Initiation checks the initialized state of all 81 external input pairs. Preservation checks the full state window with each input’s constants held fixed. The strike area combines I ∧ ¬guard for the three battlefield samples.',
    'manual.step3Title': 'Issue the fire order.',
    'manual.step3Body': 'Single shots and salvos each cost one order. Firing requires initiation and preservation to pass; an objective failure does not block fire. Target priority is neutral → friendly → enemy. A salvo strikes every unhit candidate. If initiation or preservation fails, the order is spent on a dud, causing no damage.',
    'manual.step4Title': 'Eliminate the enemy and establish the specification.',
    'manual.step4Body': 'Completion requires all enemies eliminated and the fixed mathematical specification passed within the test windows. If the board is empty but the specification is unproven, refine the invariant and recheck for free, even with zero orders left. Score equals enemy unit values gained minus friendly unit values lost plus orders remaining. Infantry is worth 2, armor 4, and artillery 6. Only completed operations save best scores.',
    'manual.precision': 'Values use x/y bounds around the battlefield samples’ paths, intersected with a broad reference invariant and expanded until preserved by the loop. Friendly positions in the exit region determine the value: zero gives 2 points, one 4, and two or more 6. Ties are allowed; this is not a measure of the shortest proof or absolute difficulty. This scoring calculation never replaces verification of all tested inputs. A salvo strikes all candidates for one order; struck cells are not attacked again.',
    'manual.scopeTitle': 'Prototype verification domain',
    'manual.scopeBody': 'The program’s input contract is (a,b) ∈ ℤ². Automatic checks use a separate window: 81 inputs with a,b ∈ [−4,4] and 4,225 states with x,y ∈ [−32,32], totaling 342,225 combinations. This is not a proof over unbounded integers. Off-board and unreachable states are checked too. Preservation fails when a state satisfying the invariant and guard produces a successor outside the state window.',
    'manual.reachability': 'Initialization converts arbitrary external inputs into the algorithm’s starting state. Even unrestricted external inputs can produce constrained initialized states, allowing useful invariants. Sample buttons change only the displayed trace; all 81 input pairs are always checked. Off-board trace sections are clipped. Invariant checks do not themselves prove termination.',
    'manual.syntax': 'Syntax: x, y, a, b, n, m, integers, + − * %, == != < <= > >=, && || !, parentheses, true, false. a, b, n, and m are read-only. Use x >= 0 && x <= n instead of chained comparisons.',
    'manual.start': 'Begin operation',
    'intel.close': 'Close intel report',
    'intel.title': 'Recon report.',
    'intel.note': 'Reviewing intel does not consume orders.',
    'intel.content': 'Progressive hints and verification explanation',
    'intel.more': 'Further intel',
    'intel.return': 'Return to field',
    'result.close': 'Close mission report',
    'result.title': 'Mission accomplished.',
    'result.retry': 'Redeploy',
    'result.next': 'Next operation →'
  }
};

const escapeHintText = value => String(value).replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

/** Reveal the explanation only alongside the final hint; legacy levels may omit it. */
export function renderHintContent(level, language, revealedCount) {
  const locale = language === 'en' ? 'en' : 'ko';
  const localized = locale === 'en' ? (level.en ?? level) : level;
  const hints = localized.hints ?? level.hints ?? [];
  const count = Math.max(0, Math.min(hints.length, Number.isFinite(revealedCount) ? Math.floor(revealedCount) : 0));
  const t = key => escapeHintText(translate(locale, key));
  const visibleHints = hints.slice(0, count).map((hint, index) =>
    `<div class="hint-item" data-hint-index="${index}"><span>INTEL ${String(index + 1).padStart(2, '0')}</span><p>${escapeHintText(hint)}</p></div>`).join('');
  if (count < hints.length || hints.length === 0) return visibleHints;

  const solution = `<div class="hint-item hint-solution"><span>${t('solutionTitle')}</span><code>${escapeHintText(level.solution)}</code><p>${t('solutionBody')}</p></div>`;
  const explanation = localized.explanation;
  const sections = [
    ['initial', 'explanationInitial'], ['preservation', 'explanationPreservation'],
    ['postcondition', 'explanationPostcondition'], ['note', 'explanationNote'],
  ].filter(([field]) => typeof explanation?.[field] === 'string' && explanation[field].trim());
  if (!sections.length) return visibleHints + solution;

  const details = sections.map(([field, title]) =>
    `<div class="explanation-step" data-explanation="${field}"><dt>${t(title)}</dt><dd>${escapeHintText(explanation[field])}</dd></div>`).join('');
  return visibleHints + solution
    + `<section class="solution-explanation" aria-label="${t('explanationTitle')}"><h3>${t('explanationTitle')}</h3><dl>${details}</dl></section>`;
}

/** Apply trusted static copy, then let app.js render state-dependent messages. */
export function applyStaticTranslations(language) {
  const locale = language === 'en' ? 'en' : 'ko';
  const copy = UI_COPY[locale];
  document.documentElement.lang = locale;

  document.querySelectorAll('[data-i18n]').forEach(element => {
    const value = copy[element.getAttribute('data-i18n')];
    if (typeof value === 'string') element.textContent = value;
  });
  document.querySelectorAll('[data-i18n-html]').forEach(element => {
    const value = copy[element.getAttribute('data-i18n-html')];
    if (typeof value === 'string') element.innerHTML = value;
  });
  for (const attribute of ['aria-label', 'title', 'placeholder', 'content']) {
    document.querySelectorAll(`[data-i18n-${attribute}]`).forEach(element => {
      const value = copy[element.getAttribute(`data-i18n-${attribute}`)];
      if (typeof value === 'string') element.setAttribute(attribute, value);
    });
  }

  const selector = document.getElementById('language-select');
  if (selector) selector.value = locale;
  return locale;
}
