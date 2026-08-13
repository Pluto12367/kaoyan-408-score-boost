import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('student learning loop guide makes the main study path visible and actionable', async () => {
  const app = await readFile('apps/web/src/App.tsx', 'utf8');
  const guide = await readFile('apps/web/src/features/student/StudentLoopGuide.tsx', 'utf8');

  assert.match(app, /<StudentLoopGuide[\s\S]*?activeSection=\{visibleSection\}[\s\S]*?onNavigate=\{setActiveSection\}/);
  assert.match(guide, /aria-label=\{TEXT\.ariaLabel\}/);
  assert.match(guide, /TEXT\.dashboard/);
  assert.match(guide, /TEXT\.practice/);
  assert.match(guide, /TEXT\.wrongBook/);
  assert.match(guide, /TEXT\.report/);
  assert.match(guide, /onNavigate\(item\.target\)/);
  assert.match(guide, /activeSection === item\.target/);
});
