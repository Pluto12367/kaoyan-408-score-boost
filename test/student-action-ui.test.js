import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('ActionCard renders the canonical action title and source', async () => {
  const card = await source('apps/web/src/features/student/actions/StudentActionCard.tsx');

  assert.match(card, /action\.title/);
  assert.match(card, /action\.source/);
  assert.match(card, /onClick=\{\(\) => onSelect\(action\)\}/);
});

test('ActionCard treats a missing reason as optional display data', async () => {
  const card = await source('apps/web/src/features/student/actions/StudentActionCard.tsx');

  assert.match(card, /action\.reason \? \(/);
  assert.match(card, /action\.reason/);
});

test('Student Home stylesheet defines the canonical action card presentation', async () => {
  const styles = await source('apps/web/src/features/student/home/components/dashboard-home.css');

  assert.match(styles, /\.dashboard-home \.student-action-card\s*\{/);
  assert.match(styles, /\.dashboard-home \.student-action-card__source\s*\{/);
  assert.match(styles, /\.dashboard-home \.student-action-card__reason\s*\{/);
  assert.match(styles, /\.dashboard-home \.student-action-card\s+button\s*\{/);
});

test('Home accepts one canonical action and its selection callback', async () => {
  const home = await source('apps/web/src/features/student/home/StudentHome.tsx');

  assert.match(home, /canonicalAction: StudentAction \| null;/);
  assert.match(home, /onSelectCanonicalAction: \(action: StudentAction\) => void;/);
  assert.match(home, /<StudentActionCard[\s\S]*?action=\{canonicalAction\}[\s\S]*?onSelect=\{onSelectCanonicalAction\}/);
});

test('Home renders no primary action when the canonical action is null', async () => {
  const home = await source('apps/web/src/features/student/home/StudentHome.tsx');

  assert.match(home, /canonicalAction \? \([\s\S]*?<StudentActionCard/);
  assert.doesNotMatch(home, /canonicalActions/);
});

test('ActionCard stays free of fetches, submission, recommendation, state writes, and providers', async () => {
  const card = await source('apps/web/src/features/student/actions/StudentActionCard.tsx');

  for (const forbidden of ['fetch(', 'submit', 'RecommendationService', 'StudentState', 'Provider', 'useState', 'useEffect', 'localStorage']) {
    assert.equal(card.includes(forbidden), false, `${forbidden} must not appear in StudentActionCard`);
  }
});
