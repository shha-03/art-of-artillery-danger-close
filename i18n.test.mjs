import test from 'node:test';
import assert from 'node:assert/strict';
import { COPY, resolveLanguage, translate } from './dist/i18n.js';
import { LEVELS } from './dist/levels.js';
import { UI_COPY } from './dist/ui-copy.js';
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
  assert.equal(translate('en', 'initialWitness', {before:'(0, 0)'}), 'Initial state (0, 0) · Invariant does not hold.');
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
  }
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
