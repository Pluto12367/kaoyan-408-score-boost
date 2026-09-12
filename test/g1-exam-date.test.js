import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// G1.8 — examDate entry (owner decision A6 = APPROVED).
//
// Requirements being pinned (task §14):
//   • the meaning of the date is stated, not implied
//   • future dates only
//   • `remainingDays` is DERIVED from examDate, not hand-filled, and the two
//     can never disagree
//   • the student is never left thinking the system guessed the date
//
// The derivation is a shared pure function so the API and the web app cannot
// disagree about "how many days are left".

const stripComments = (source) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SHARED = new URL('../packages/shared/dist/index.js', import.meta.url);
const CONTROLLER = new URL('../apps/api/src/score-anchor/score-anchor.controller.ts', import.meta.url);
const SERVICE = new URL('../apps/api/src/score-anchor/score-anchor.service.ts', import.meta.url);

const { deriveExamDateState } = await import(SHARED.href);

test('G1.8: a future exam date derives remainingDays and says so honestly', () => {
  const state = deriveExamDateState({ examDate: '2026-12-20', todayIso: '2026-09-12T10:00:00.000Z' });
  assert.equal(state.error, null);
  assert.equal(state.source, 'exam_date');
  assert.equal(state.examDate, '2026-12-20');
  assert.equal(state.remainingDays, 99);
  assert.match(state.daysLabel, /距离考试 99 天/);
  assert.match(state.meaningNote, /考试日期/);
});

test('G1.8: a past date is rejected with an explicit reason', () => {
  const state = deriveExamDateState({ examDate: '2026-01-01', todayIso: '2026-09-12T10:00:00.000Z' });
  assert.ok(state.error && state.error.includes('未来'));
  assert.equal(state.source, 'unset');
  assert.equal(state.remainingDays, null);
});

test('G1.8: a malformed date is rejected, never silently coerced', () => {
  for (const bad of ['', 'not-a-date', '2026-13-45', '20261220']) {
    const state = deriveExamDateState({ examDate: bad, todayIso: '2026-09-12T10:00:00.000Z' });
    assert.ok(state.error, `"${bad}" must be rejected`);
    assert.equal(state.remainingDays, null);
  }
});

test('G1.8: without an exam date the UI is told it is unset, not given a guess', () => {
  const state = deriveExamDateState({ examDate: null, todayIso: '2026-09-12T10:00:00.000Z' });
  assert.equal(state.source, 'unset');
  assert.equal(state.remainingDays, null);
  assert.equal(state.daysLabel, null);
  assert.ok(state.meaningNote.includes('未设置'));
  assert.ok(!/猜|估计|大约/.test(state.meaningNote), 'the unset state must not imply a guess');
});

test('G1.8: the API exposes a self-only, validated exam-date writer', async () => {
  const source = stripComments(readFileSync(CONTROLLER, 'utf8'));
  assert.match(source, /@Post\('coach\/exam-date'\)/, 'the write route must be registered');
  const index = source.indexOf("@Post('coach/exam-date')");
  const handler = source.slice(index, index + 700);
  assert.match(handler, /@UseGuards\(RoleGuard\)/);
  assert.match(handler, /@Roles\('student'/);
  assert.match(handler, /user\.id/, 'self-only: the writer may only touch the caller');
  assert.doesNotMatch(handler, /body\.userId|dto\.userId/, 'a caller may not write another student’s date');
});

test('G1.8: the service validates through the shared derivation and keeps remainingDays in sync', async () => {
  const source = stripComments(readFileSync(SERVICE, 'utf8'));
  assert.match(source, /deriveExamDateState/, 'validation must come from the shared helper');
  assert.match(source, /remainingDays/, 'remainingDays is derived alongside examDate');
  assert.match(source, /examDate/, 'and examDate is written');
});
