import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('deployed smoke script covers the five next-step surfaces with real login', () => {
  const source = readFileSync('scripts/verify-deployed.mjs', 'utf8');
  assert.match(source, /LOGIN_EMAIL/);
  assert.match(source, /LOGIN_PASSWORD/);
  assert.match(source, /APP_URL/);
  assert.match(source, /requestSubmit/);
  assert.match(source, /next-learning-step-card/);
  assert.match(source, /dashboard-next-step-card/);
  assert.match(source, /section\.key \+ '-next-step-card'/);
  assert.match(source, /nav: '今日计划'/);
  assert.match(source, /nav: '错题复盘'/);
  assert.match(source, /nav: '提分报告'/);
  assert.match(source, /navClick\('题库训练'\)/);
  assert.match(source, /practice-answer-next-step-card/);
  assert.match(source, /dashboard-primary-target/);
  assert.match(source, /mobile-card-stacks/);
  assert.doesNotMatch(source, /mock|fabricated|fake/i);
});

test('package.json exposes the deployed smoke check as a named script', () => {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts['verify:deployed'], 'node scripts/verify-deployed.mjs');
});
