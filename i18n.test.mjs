import test from 'node:test';
import assert from 'node:assert/strict';
import { COPY, resolveLanguage, translate } from './dist/i18n.js';
import { LEVELS } from './dist/levels.js';
import { UI_COPY, renderHintContent } from './dist/ui-copy.js';
import { readFileSync } from 'node:fs';

test('saved language wins, browser preferences negotiate supported locales, and invalid settings fall back safely', () => {
  assert.equal(resolveLanguage('ko', ['en-US']), 'ko');
  assert.equal(resolveLanguage('en', ['ko-KR']), 'en');
  assert.equal(resolveLanguage(null, ['fr-FR', 'en-GB', 'ko']), 'en');
  assert.equal(resolveLanguage('invalid', ['ko-KR', 'en']), 'ko');
  assert.equal(resolveLanguage(null, ['de-DE']), 'ko');
  assert.equal(resolveLanguage(null, []), 'ko');
});

test('every dynamic report has complete English copy with matching interpolation fields', () => {
  const keys = Object.keys(COPY.ko).sort();
  assert.deepEqual(Object.keys(COPY.en).sort(), keys);
  for (const key of keys) {
    const slots = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
    assert.deepEqual(slots(COPY.en[key]), slots(COPY.ko[key]), key);
    assert.doesNotMatch(COPY.en[key], /[가-힣]/, key);
    assert.ok(COPY.en[key].length > 0, key);
  }
  assert.equal(translate('en', 'initialWitness', {before:'(0, 0)'}), 'Allowed initial input (0, 0) · Invariant does not hold.');
  assert.equal(translate('ko', 'sound', {state:'ON'}), '사운드 ON');
  // Replacement values are data; dollar patterns and braces are not interpreted again.
  assert.equal(translate('en', 'cellLabel', {x:1,y:2,unit:'$& {x}',objective:''}), 'Coordinate 1, 2: $& {x}');
});

test('every operation includes English briefing and the same number of intelligence reports', () => {
  for (const level of LEVELS) {
    assert.ok(level.en.name && level.en.brief, level.id);
    assert.equal(level.en.hints.length, level.hints.length, level.id);
    assert.doesNotMatch([level.en.name, level.en.brief, ...level.en.hints].join('\n'), /[가-힣]/);
    assert.ok(level.en.hints.at(-1).includes(level.solution), level.id);
    if (level.explanation) {
      for (const field of ['initial', 'preservation', 'postcondition']) {
        assert.ok(level.explanation[field]?.trim(), `${level.id}: Korean ${field}`);
        assert.ok(level.en.explanation?.[field]?.trim(), `${level.id}: English ${field}`);
      }
      assert.deepEqual(Object.keys(level.en.explanation).sort(), Object.keys(level.explanation).sort(), level.id);
      assert.doesNotMatch(Object.values(level.en.explanation).join('\n'), /[가-힣]/, level.id);
    }
  }
});

const hintFixture = () => ({
  hints: ['첫 단서', '두 번째 단서', '마지막 단서'], solution: 'x + y == n',
  explanation: {
    initial: '초기 비밀: x=n, y=0.', preservation: '유지 비밀: 감소와 증가가 상쇄된다.',
    postcondition: '종료 비밀: x=0이므로 y=n.', note: '보충 비밀: 검사 범위를 확인하라.',
  },
  en: {
    hints: ['First clue', 'Second clue', 'Final clue'],
    explanation: {
      initial: 'Initial secret: x=n, y=0.', preservation: 'Preservation secret: the changes cancel.',
      postcondition: 'Exit secret: x=0 implies y=n.', note: 'Note secret: inspect the test windows.',
    },
  },
});

test('the solution and explanation remain absent until every hint has been revealed', () => {
  const level = hintFixture();
  for (const locale of ['ko', 'en']) {
    for (const count of [0, 1, 2]) {
      const html = renderHintContent(level, locale, count);
      assert.equal((html.match(/data-hint-index=/g) ?? []).length, count);
      assert.doesNotMatch(html, /solution-explanation|hint-solution|data-explanation=/);
      assert.ok(!html.includes(level.solution));
      assert.doesNotMatch(html, /비밀|secret/);
    }
    const complete = renderHintContent(level, locale, 3);
    assert.equal((complete.match(/data-hint-index=/g) ?? []).length, 3);
    assert.ok(complete.includes(level.solution));
    assert.ok(complete.indexOf('hint-solution') < complete.indexOf('solution-explanation'));
    for (const field of ['initial', 'preservation', 'postcondition', 'note']) {
      assert.ok(complete.includes(`data-explanation="${field}"`));
      assert.ok(complete.includes((locale === 'en' ? level.en : level).explanation[field]));
    }
    assert.equal(renderHintContent(level, locale, 4), complete, 'extra reveal events cannot alter completion');
  }
  assert.doesNotMatch(renderHintContent(level, 'en', 3), /[가-힣]/);
});

test('optional notes and legacy levels without explanations preserve normal hint rendering', () => {
  const level = hintFixture();
  delete level.explanation.note;
  delete level.en.explanation.note;
  const withoutNote = renderHintContent(level, 'ko', 3);
  assert.match(withoutNote, /data-explanation="initial"/);
  assert.doesNotMatch(withoutNote, /data-explanation="note"/);
  delete level.explanation;
  delete level.en.explanation;
  for (const locale of ['ko', 'en']) {
    const legacy = renderHintContent(level, locale, 3);
    assert.match(legacy, /hint-solution/);
    assert.ok(legacy.includes(level.solution));
    assert.doesNotMatch(legacy, /solution-explanation/);
    assert.equal((legacy.match(/data-hint-index=/g) ?? []).length, 3);
  }
});

test('hint explanations are rendered as text even when formulas or notes contain HTML-like content', () => {
  const level = hintFixture();
  level.hints[0] = '<img src=x onerror=alert(1)>';
  level.solution = 'x < n && y > 0';
  level.explanation.initial = '<script>alert(1)</script>';
  level.explanation.note = 'Use x < n && y > 0.\nKeep "n" unchanged.';
  const rendered = renderHintContent(level, 'ko', 3);
  assert.doesNotMatch(rendered, /<script|<img/);
  assert.match(rendered, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(rendered.includes('x &lt; n &amp;&amp; y &gt; 0'));
  assert.ok(rendered.includes('Keep &quot;n&quot; unchanged.'));
});

test('static UI and accessibility bindings have matching Korean and English translations', () => {
  assert.deepEqual(Object.keys(UI_COPY.en).sort(), Object.keys(UI_COPY.ko).sort());
  const html = readFileSync(new URL('./dist/index.html', import.meta.url), 'utf8');
  const keys = [...html.matchAll(/data-i18n(?:-html|-aria-label|-title|-placeholder|-content)?="([^"]+)"/g)].map(match => match[1]);
  for (const key of keys) {
    assert.ok(UI_COPY.ko[key], `Missing Korean: ${key}`);
    assert.ok(UI_COPY.en[key], `Missing English: ${key}`);
    assert.doesNotMatch(UI_COPY.en[key], /[가-힣]/, key);
  }
});

test('initialized-program instructions distinguish universal inputs, test windows, and representative battlefields', () => {
  for (const locale of ['ko', 'en']) {
    const scope = translate(locale, 'externalScope', { count: 81 });
    assert.match(scope, /81/);
    assert.match(scope, /342,225/);
    assert.match(COPY[locale].externalInputs, /a, b/);
    assert.match(COPY[locale].externalInputs, /ℤ²/);
    assert.match(UI_COPY[locale]['manual.scopeBody'], /81/);
    assert.match(UI_COPY[locale]['manual.scopeBody'], /4,225/);
    assert.match(UI_COPY[locale]['manual.syntax'], /a, b, n, m/);
    for (const key of ['battlefieldInputs', 'battlefieldInputsHelp', 'initializedState', 'inputContext', 'proofRequiredTitle', 'proofRequiredBody', 'provedTitle', 'provedBody']) {
      assert.ok(COPY[locale][key]?.trim(), `${locale}: ${key}`);
    }
  }
  assert.match(COPY.ko.goalPassed, /무한 정수 전체의 증명은 아니다/);
  assert.match(COPY.en.goalPassed, /not a proof over unbounded integers/);
  assert.match(COPY.ko.proofRequiredBody, /0이어도/);
  assert.match(COPY.en.proofRequiredBody, /zero orders/);
});

test('the HTML exposes initialization and a read-only mathematical goal before JavaScript loads', () => {
  const html = readFileSync(new URL('./dist/index.html', import.meta.url), 'utf8');
  assert.ok(html.indexOf('id="initialization-code"') < html.indexOf('id="program-code"'));
  const goal = html.match(/<textarea\b[^>]*id="goal-input"[^>]*>/)?.[0];
  assert.ok(goal);
  assert.match(goal, /\breadonly\b/);
  assert.match(goal, /aria-readonly="true"/);
  assert.match(html.match(/<button\b[^>]*id="target-enemies"[^>]*>/)?.[0] ?? '', /\bhidden\b/);
  for (const key of ['manual.step1Body', 'manual.scopeBody', 'manual.reachability']) {
    assert.ok(html.includes(UI_COPY.ko[key]), `${key}: Korean fallback matches translated copy`);
  }
  assert.doesNotMatch(html, /적군 좌표를 클릭해|지도에서 표적을 지정하거나/);
});
