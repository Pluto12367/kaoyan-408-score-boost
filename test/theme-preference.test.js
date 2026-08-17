import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  THEME_OPTIONS,
  applyTheme,
  isThemeVariant,
  persistTheme,
  readStoredTheme,
  resolveInitialTheme,
} from '../apps/web/src/theme/themePreference.ts';

function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => void data.set(key, String(value)),
  };
}

test('theme: default theme is the standard paper-ink variant', () => {
  assert.equal(DEFAULT_THEME, 'c');
  assert.ok(isThemeVariant(DEFAULT_THEME));
});

test('theme: options cover exactly A/B/C with stable labels', () => {
  assert.deepEqual(
    THEME_OPTIONS.map((option) => option.value),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    THEME_OPTIONS.map((option) => option.label),
    ['深色', '极简', '标准'],
  );
  for (const option of THEME_OPTIONS) {
    assert.ok(isThemeVariant(option.value), `${option.value} should be a valid variant`);
  }
});

test('theme: readStoredTheme validates stored values', () => {
  assert.equal(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'a' })), 'a');
  assert.equal(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'b' })), 'b');
  assert.equal(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'c' })), 'c');
  assert.equal(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'd' })), null);
  assert.equal(readStoredTheme(fakeStorage({ [THEME_STORAGE_KEY]: '' })), null);
  assert.equal(readStoredTheme(fakeStorage({})), null);
  assert.equal(readStoredTheme(null), null);
});

test('theme: resolveInitialTheme falls back to the standard theme', () => {
  assert.equal(resolveInitialTheme(null), 'c');
  assert.equal(resolveInitialTheme(fakeStorage({})), 'c');
  assert.equal(resolveInitialTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'garbage' })), 'c');
  assert.equal(resolveInitialTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'a' })), 'a');
  assert.equal(resolveInitialTheme(fakeStorage({ [THEME_STORAGE_KEY]: 'b' })), 'b');
});

test('theme: persistTheme writes the chosen variant', () => {
  const storage = fakeStorage();
  persistTheme(storage, 'a');
  assert.equal(storage.getItem(THEME_STORAGE_KEY), 'a');
  persistTheme(storage, 'b');
  assert.equal(storage.getItem(THEME_STORAGE_KEY), 'b');
});

test('theme: applyTheme stamps the html element for CSS cascade', () => {
  const doc = { documentElement: { dataset: {} } };
  applyTheme(doc, 'a');
  assert.equal(doc.documentElement.dataset.theme, 'a');
  applyTheme(doc, 'c');
  assert.equal(doc.documentElement.dataset.theme, 'c');
});

test('theme: dark dashboard cards pair dark surfaces with readable text', () => {
  const styles = readFileSync('apps/web/src/styles.css', 'utf8');
  const selectors = [
    '.student-insight-card',
    '.student-schedule-card',
    '.focus-point-list button',
    '.recent-mistake-list button',
    '.week-focus-list article',
    '.next-learning-step-card',
    '.goal-progress-insight',
    '.goal-progress-grid article',
    '.goal-progress-pill',
  ];

  for (const selector of selectors) {
    const escaped = selector.replaceAll('.', '\\.').replaceAll(' ', '\\s+');
    assert.match(
      styles,
      new RegExp(`html\\[data-theme="a"\\][\\s\\S]*${escaped}[\\s\\S]*background:\\s*var\\(--surface`),
      `${selector} should use a dark theme surface`,
    );
  }

  assert.match(
    styles,
    /html\[data-theme="a"\][\s\S]*\.next-learning-step-copy h4[\s\S]*\.goal-progress-grid strong[\s\S]*color:\s*var\(--text-strong\)/,
  );
});
