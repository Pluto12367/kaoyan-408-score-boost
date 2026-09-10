/**
 * V12-M1 — Learning Evidence Foundation (pure module contract).
 *
 * The single most important property under test: the system must never let an
 * ACTIVITY marker masquerade as ABILITY evidence. "Task completed" and
 * "marked as reviewed" are things that happened; they are not observations of
 * performance. Only objective observations may claim to influence mastery.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLearningAction,
  buildLearningEvidence,
  learningEvidenceKey,
  summarizeLearningEvidence,
  LEARNING_ACTION_TAXONOMY,
} from '../packages/shared/dist/index.js';

// ---------------------------------------------------------------------------
// Taxonomy: activity vs evidence
// ---------------------------------------------------------------------------

test('practice with observed graded attempts is strong objective evidence', () => {
  const verdict = classifyLearningAction({
    action: 'practice.answered',
    observedAttempts: 5,
    observedCorrectCount: 4,
  });
  assert.equal(verdict.kind, 'objective_performance');
  assert.equal(verdict.strength, 'strong');
  assert.equal(verdict.canInfluenceMastery, true);
  assert.equal(verdict.isEvidence, true);
});

test('completing a task with no observation is activity only, never evidence', () => {
  const verdict = classifyLearningAction({ action: 'task.completed' });
  assert.equal(verdict.kind, 'none');
  assert.equal(verdict.strength, 'none');
  assert.equal(verdict.isEvidence, false, 'a completion marker alone is not evidence');
  assert.equal(verdict.canInfluenceMastery, false);
  assert.match(verdict.basis, /完成标记/);
});

test('self-reported task numbers are weak evidence and cannot move mastery', () => {
  const verdict = classifyLearningAction({
    action: 'task.completed',
    selfReportedQuestionCount: 10,
    selfReportedCorrectCount: 8,
  });
  assert.equal(verdict.kind, 'self_reported');
  assert.equal(verdict.strength, 'weak');
  assert.equal(verdict.isEvidence, true, 'self-report is evidence, just weak');
  assert.equal(
    verdict.canInfluenceMastery,
    false,
    'self-reported numbers must never move the mastery source of truth',
  );
});

test('marking a wrong question as reviewed is activity only (EB-2)', () => {
  const verdict = classifyLearningAction({ action: 'review.marked' });
  assert.equal(verdict.kind, 'none');
  assert.equal(verdict.strength, 'none');
  assert.equal(verdict.isEvidence, false);
  assert.equal(verdict.canInfluenceMastery, false);
});

test('a review that observed a redo outcome is strong recall evidence', () => {
  const verdict = classifyLearningAction({
    action: 'review.recalled',
    recallObserved: true,
    recallCorrect: false,
  });
  assert.equal(verdict.kind, 'recall_outcome');
  assert.equal(verdict.strength, 'strong');
  assert.equal(verdict.canInfluenceMastery, true);
});

test('a review claiming a recall outcome without an observation is rejected as activity', () => {
  const verdict = classifyLearningAction({ action: 'review.recalled', recallObserved: false });
  assert.equal(verdict.kind, 'none');
  assert.equal(verdict.canInfluenceMastery, false);
});

test('assessment submissions with observed attempts are strong evidence', () => {
  const verdict = classifyLearningAction({
    action: 'assessment.submitted',
    observedAttempts: 20,
    observedCorrectCount: 11,
  });
  assert.equal(verdict.strength, 'strong');
  assert.equal(verdict.canInfluenceMastery, true);
});

test('zero observed attempts never yields strong evidence even when asked for practice', () => {
  const verdict = classifyLearningAction({ action: 'practice.answered', observedAttempts: 0 });
  assert.equal(verdict.strength, 'none');
  assert.equal(verdict.canInfluenceMastery, false);
});

test('taxonomy table is exported and marks exactly the activity-only actions', () => {
  const activityOnly = LEARNING_ACTION_TAXONOMY.filter((row) => !row.canInfluenceMastery).map(
    (row) => row.action,
  );
  assert.ok(activityOnly.includes('task.completed'));
  assert.ok(activityOnly.includes('review.marked'));
  assert.ok(!activityOnly.includes('practice.answered'));
  assert.ok(!activityOnly.includes('review.recalled'));
  for (const row of LEARNING_ACTION_TAXONOMY) {
    assert.ok(row.basis.length > 0, `${row.action} must explain itself`);
  }
});

// ---------------------------------------------------------------------------
// Record building: honest numbers only
// ---------------------------------------------------------------------------

test('evidence record never fabricates a correct count when none was observed', () => {
  const record = buildLearningEvidence({
    userId: 'u1',
    action: 'task.completed',
    sourceId: 'task-1',
    recordedAt: '2026-09-10T00:00:00.000Z',
    selfReportedQuestionCount: null,
    selfReportedCorrectCount: null,
    minutesSpent: null,
    selfRating: null,
  });
  assert.equal(record.metrics.attempts, null);
  assert.equal(record.metrics.correctCount, null);
  assert.equal(record.metrics.accuracyRate, null);
  assert.equal(record.strength, 'none');
  assert.equal(record.canInfluenceMastery, false);
});

test('evidence record computes accuracy only from observed numbers', () => {
  const record = buildLearningEvidence({
    userId: 'u1',
    action: 'practice.answered',
    sourceId: 'q1',
    recordedAt: '2026-09-10T00:00:00.000Z',
    observedAttempts: 4,
    observedCorrectCount: 3,
  });
  assert.equal(record.metrics.attempts, 4);
  assert.equal(record.metrics.correctCount, 3);
  assert.equal(record.metrics.accuracyRate, 75);
  assert.equal(record.strength, 'strong');
});

test('self-reported accuracy is labelled weak and keeps the source distinguishable', () => {
  const record = buildLearningEvidence({
    userId: 'u1',
    action: 'task.completed',
    sourceId: 'task-2',
    recordedAt: '2026-09-10T00:00:00.000Z',
    selfReportedQuestionCount: 8,
    selfReportedCorrectCount: 6,
    minutesSpent: 30,
    selfRating: 4,
  });
  assert.equal(record.strength, 'weak');
  assert.equal(record.metrics.accuracyRate, 75);
  assert.equal(record.metrics.selfReported, true);
  assert.equal(record.canInfluenceMastery, false);
});

test('evidence keys are deterministic and scoped to user+action+source', () => {
  const a = learningEvidenceKey({ userId: 'u1', action: 'task.completed', sourceId: 'task-1' });
  const b = learningEvidenceKey({ userId: 'u1', action: 'task.completed', sourceId: 'task-1' });
  const c = learningEvidenceKey({ userId: 'u2', action: 'task.completed', sourceId: 'task-1' });
  const d = learningEvidenceKey({ userId: 'u1', action: 'review.marked', sourceId: 'task-1' });
  assert.equal(a, b, 'same facts must produce the same key (idempotency)');
  assert.notEqual(a, c);
  assert.notEqual(a, d);
});

test('a scoped evidence key can distinguish repeated reviews of the same question', () => {
  const first = learningEvidenceKey({
    userId: 'u1',
    action: 'review.recalled',
    sourceId: 'q1',
    scope: '2026-09-10',
  });
  const second = learningEvidenceKey({
    userId: 'u1',
    action: 'review.recalled',
    sourceId: 'q1',
    scope: '2026-09-11',
  });
  assert.notEqual(first, second, 'a later recall of the same question is new evidence');
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

test('summary counts strengths and refuses to claim ability evidence when none exists', () => {
  const none = buildLearningEvidence({
    userId: 'u1',
    action: 'task.completed',
    sourceId: 't1',
    recordedAt: '2026-09-10T00:00:00.000Z',
  });
  const weak = buildLearningEvidence({
    userId: 'u1',
    action: 'task.completed',
    sourceId: 't2',
    recordedAt: '2026-09-10T00:00:00.000Z',
    selfReportedQuestionCount: 5,
    selfReportedCorrectCount: 5,
  });
  const summary = summarizeLearningEvidence([none, weak]);
  assert.equal(summary.total, 2);
  assert.equal(summary.strong, 0);
  assert.equal(summary.weak, 1);
  assert.equal(summary.none, 1);
  assert.equal(summary.abilityEvidenceCount, 0);
  assert.equal(summary.hasAbilityEvidence, false);
  assert.match(summary.basis, /能力/);
});

test('summary reports ability evidence once a strong observation exists', () => {
  const strong = buildLearningEvidence({
    userId: 'u1',
    action: 'practice.answered',
    sourceId: 'q1',
    recordedAt: '2026-09-10T00:00:00.000Z',
    observedAttempts: 2,
    observedCorrectCount: 2,
  });
  const summary = summarizeLearningEvidence([strong]);
  assert.equal(summary.abilityEvidenceCount, 1);
  assert.equal(summary.hasAbilityEvidence, true);
});

test('empty evidence summarises as honestly absent, not as zero ability', () => {
  const summary = summarizeLearningEvidence([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.hasAbilityEvidence, false);
  assert.equal(summary.abilityEvidenceCount, 0);
});
