import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';

const packageJsonPath = 'package.json';
const scriptPath = 'scripts/verify-p0-student-loop.mjs';

test('P0 student loop verification script is exposed as a named command', () => {
  const source = readFileSync(packageJsonPath, 'utf8');
  assert.match(source, /"verify:p0-student"\s*:\s*"node scripts\/verify-p0-student-loop\.mjs"/);
});

test('P0 student loop script covers the core 408 learning loop', () => {
  assert.equal(existsSync(scriptPath), true, 'P0 student loop script must exist');
  const source = readFileSync(scriptPath, 'utf8');
  assert.match(source, /LOGIN_EMAIL/);
  assert.match(source, /LOGIN_PASSWORD/);
  assert.match(source, /login-dashboard/);
  assert.match(source, /today-plan/);
  assert.match(source, /practice-session/);
  assert.match(source, /practice-session-ready/);
  assert.match(source, /submitReasonPromptIfPresent/);
  assert.match(source, /错因自评/);
  assert.match(source, /wrong-book/);
  assert.match(source, /正在加载错题复盘/);
  assert.match(source, /wrong-detail/);
  assert.match(source, /wrong-redo/);
  assert.match(source, /408知识图谱/);
  assert.match(source, /正在加载408知识图谱/);
  assert.match(source, /knowledge-catalog/);
  assert.match(source, /report\.json/);
});
