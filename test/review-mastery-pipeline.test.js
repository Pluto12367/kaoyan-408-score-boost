/**
 * V12-M3 — Review → Unified Mastery shadow pipeline: pure contract.
 *
 * The pipeline exists to answer one question on real data: if an observed review
 * outcome were fed into the SAME mastery semantics practice already uses, what
 * would change — and can every difference be traced to a specific review event?
 *
 * Three properties are non-negotiable and each is proved here rather than
 * asserted:
 *   1. the evidence boundary holds — no receipt, no mastery influence;
 *   2. the transition is the production model itself, not a second 口径;
 *   3. nothing authoritative is written and the student stays isolated.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  aggregateReviewIntegrationCohort,
  applyMasteryModel,
  auditReviewMasteryIntegration,
  buildReviewMasteryShadow,
  effectiveTargetFor,
  joinReviewIntegrationDataset,
  projectReviewEvidence,
  replayUnifiedReviewMastery,
  reviewEventIdOf,
  summarizeDeltas,
  updateMasteryAfterAttempt,
  LEARNING_ACTION_TAXONOMY,
} from '../packages/shared/dist/index.js';

const SERVICE_SOURCE = new URL(
  '../apps/api/src/study/review-mastery-shadow.service.ts',
  import.meta.url,
);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function neutral(mastery) {
  return {
    mastery,
    accuracy: mastery,
    recentAccuracy: mastery,
    attempts: 6,
    correctCount: Math.round(6 * mastery),
    wrongCount: 6 - Math.round(6 * mastery),
    confidence: 0.4,
  };
}

function receipt(input) {
  return {
    receiptId: input.receiptId,
    action: input.action ?? 'review.recalled',
    questionId: input.questionId,
    recordedAt: input.recordedAt,
    scope: input.scope ?? input.recordedAt.slice(0, 10),
    kind: input.kind ?? 'recall_outcome',
    strength: input.strength ?? 'strong',
    canInfluenceMastery: input.canInfluenceMastery ?? true,
  };
}

function event(input) {
  return {
    reviewEventId: input.reviewEventId,
    scheduleId: input.scheduleId ?? `sched-${input.questionId}`,
    questionId: input.questionId,
    // `??` would turn an explicit null into the default, hiding the very case
    // the unresolved-question test needs.
    nodeId: 'nodeId' in input ? input.nodeId : 'node-a',
    reviewedAt: input.reviewedAt,
    redoCorrect: input.redoCorrect,
    difficulty: input.difficulty ?? 3,
    scheduledReview: 'scheduledReview' in input ? input.scheduledReview : true,
  };
}

/** A clean six-event fixture: three nodes, mixed outcomes, receipts present. */
function cleanFixture() {
  const events = [
    event({ reviewEventId: 'e1', questionId: 'q1', nodeId: 'node-low', reviewedAt: '2026-03-01T09:00:00.000Z', redoCorrect: true, difficulty: 1 }),
    event({ reviewEventId: 'e2', questionId: 'q2', nodeId: 'node-low', reviewedAt: '2026-03-02T09:00:00.000Z', redoCorrect: false, difficulty: 1 }),
    event({ reviewEventId: 'e3', questionId: 'q3', nodeId: 'node-mid', reviewedAt: '2026-03-01T10:00:00.000Z', redoCorrect: true, difficulty: 3 }),
    event({ reviewEventId: 'e4', questionId: 'q4', nodeId: 'node-mid', reviewedAt: '2026-03-03T10:00:00.000Z', redoCorrect: true, difficulty: 3 }),
    event({ reviewEventId: 'e5', questionId: 'q5', nodeId: 'node-high', reviewedAt: '2026-03-01T11:00:00.000Z', redoCorrect: true, difficulty: 5 }),
    event({ reviewEventId: 'e6', questionId: 'q6', nodeId: 'node-high', reviewedAt: '2026-03-04T11:00:00.000Z', redoCorrect: false, difficulty: 5 }),
  ];
  const receipts = events.map((row) =>
    receipt({ receiptId: `rcpt-${row.reviewEventId}`, questionId: row.questionId, recordedAt: row.reviewedAt }),
  );
  const baselines = [
    { nodeId: 'node-low', mastery: 0.22, accuracy: 0.3, recentAccuracy: 0.3, attempts: 4, correctCount: 1, wrongCount: 3, confidence: 0.3, at: '2026-02-28T00:00:00.000Z' },
    { nodeId: 'node-mid', mastery: 0.6, accuracy: 0.6, recentAccuracy: 0.6, attempts: 8, correctCount: 5, wrongCount: 3, confidence: 0.5, at: '2026-02-28T00:00:00.000Z' },
    { nodeId: 'node-high', mastery: 0.95, accuracy: 0.95, recentAccuracy: 0.95, attempts: 12, correctCount: 11, wrongCount: 1, confidence: 0.7, at: '2026-02-28T00:00:00.000Z' },
  ];
  const authoritative = [
    { nodeId: 'node-low', mastery: 0.22, stabilityDays: 3 },
    { nodeId: 'node-mid', mastery: 0.6, stabilityDays: 7 },
    { nodeId: 'node-high', mastery: 0.95, stabilityDays: 14 },
  ];
  return { events, receipts, baselines, authoritative };
}

// ---------------------------------------------------------------------------
// Phase 3 — the evidence boundary
// ---------------------------------------------------------------------------

test('an observed review without an evidence receipt never reaches the mastery shadow', () => {
  const { events, baselines, authoritative } = cleanFixture();
  const projection = projectReviewEvidence({ events, receipts: [] });

  assert.equal(projection.reconciliation.events, 6);
  assert.equal(projection.reconciliation.eventsWithReceipt, 0);
  assert.equal(projection.reconciliation.eventsWithoutReceipt, 6);
  assert.equal(projection.observations.every((row) => !row.eligibleForMastery), true);
  assert.equal(projection.observations.every((row) => row.receiptId === null), true);
  assert.match(projection.observations[0].basis, /证据台账没有对应回执/);

  const shadow = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative });
  assert.equal(shadow.eventRows.length, 0);
  assert.equal(shadow.summary.eventsSkipped, 6);
  assert.equal(shadow.summary.nodesChanged, 0, 'no receipt means no mastery influence at all');
});

test('a matched receipt makes the event eligible and preserves its identity', () => {
  const { events, receipts } = cleanFixture();
  const projection = projectReviewEvidence({ events, receipts });

  assert.equal(projection.reconciliation.eventsWithReceipt, 6);
  assert.equal(projection.reconciliation.eventsWithoutReceipt, 0);
  assert.equal(projection.reconciliation.receiptsMatched, 6);
  assert.equal(projection.reconciliation.receiptsOrphaned, 0);
  // Observations come out in chronological order, which is the order the
  // mastery trajectory is replayed in.
  assert.deepEqual(
    projection.observations.map((row) => row.reviewEventId),
    ['e1', 'e3', 'e5', 'e2', 'e4', 'e6'],
  );
  assert.equal(projection.observations.every((row) => row.eligibleForMastery), true);
  assert.equal(projection.observations.every((row) => row.receiptMatch === 'exact'), true);
});

test('day-scoped receipts are shared honestly instead of duplicating observations', () => {
  // The ledger's event key is scoped by day, so three reviews of one question on
  // one day genuinely share one receipt. Dropping two of them would understate
  // the history; inventing receipts would fake the boundary.
  const events = [
    event({ reviewEventId: 'd1', questionId: 'q9', nodeId: 'node-mid', reviewedAt: '2026-03-05T08:00:00.000Z', redoCorrect: true }),
    event({ reviewEventId: 'd2', questionId: 'q9', nodeId: 'node-mid', reviewedAt: '2026-03-05T12:00:00.000Z', redoCorrect: false }),
    event({ reviewEventId: 'd3', questionId: 'q9', nodeId: 'node-mid', reviewedAt: '2026-03-05T20:00:00.000Z', redoCorrect: true }),
  ];
  const receipts = [receipt({ receiptId: 'rcpt-day', questionId: 'q9', recordedAt: '2026-03-05T08:00:00.000Z' })];
  const projection = projectReviewEvidence({ events, receipts });

  assert.equal(projection.reconciliation.eventsWithReceipt, 3);
  assert.equal(projection.reconciliation.coalescedReceipts, 1);
  assert.equal(projection.reconciliation.maxEventsPerReceipt, 3);
  assert.equal(projection.observations.filter((row) => row.receiptMatch === 'coalesced_day_scope').length, 2);
  assert.equal(projection.observations.filter((row) => row.receiptMatch === 'exact').length, 1);
  assert.match(projection.reconciliation.basis, /共用/);
  for (const row of projection.observations) assert.equal(row.receiptId, 'rcpt-day');
});

test('a "marked reviewed" receipt is activity only and never licenses a mastery step', () => {
  const taxonomy = LEARNING_ACTION_TAXONOMY.find((row) => row.action === 'review.marked');
  assert.equal(taxonomy.canInfluenceMastery, false, 'the published taxonomy forbids it');

  const events = [event({ reviewEventId: 'm1', questionId: 'q7', nodeId: 'node-low', reviewedAt: '2026-03-06T09:00:00.000Z', redoCorrect: true })];
  const receipts = [receipt({ receiptId: 'rcpt-marked', action: 'review.marked', questionId: 'q7', recordedAt: '2026-03-06T09:00:00.000Z', kind: 'none', strength: 'none', canInfluenceMastery: false })];
  const projection = projectReviewEvidence({ events, receipts });

  // A recall receipt is what licenses the inference; a "marked" receipt on the
  // same question/day is not a substitute for it.
  assert.equal(projection.observations[0].receiptMatch, 'none');
  assert.equal(projection.observations[0].eligibleForMastery, false);
  assert.equal(projection.reconciliation.recalledReceipts, 0);
  assert.equal(projection.reconciliation.markedReceipts, 1);
});

test('unresolvable questions and orphan receipts are reported, never guessed at', () => {
  const events = [
    event({ reviewEventId: 'u1', questionId: 'q-nonode', nodeId: null, reviewedAt: '2026-03-07T09:00:00.000Z', redoCorrect: true }),
    event({ reviewEventId: 'u2', questionId: 'q-ok', nodeId: 'node-mid', reviewedAt: '2026-03-07T09:30:00.000Z', redoCorrect: true }),
  ];
  const receipts = [
    receipt({ receiptId: 'rcpt-nonode', questionId: 'q-nonode', recordedAt: '2026-03-07T09:00:00.000Z' }),
    receipt({ receiptId: 'rcpt-ok', questionId: 'q-ok', recordedAt: '2026-03-07T09:30:00.000Z' }),
    receipt({ receiptId: 'rcpt-orphan', questionId: 'q-never-reviewed', recordedAt: '2026-03-07T10:00:00.000Z' }),
  ];
  const projection = projectReviewEvidence({ events, receipts });

  assert.equal(projection.unresolved.length, 1);
  assert.equal(projection.unresolved[0].reviewEventId, 'u1');
  assert.match(projection.unresolved[0].reason, /知识节点/);
  assert.equal(projection.reconciliation.eventsWithoutNode, 1);
  assert.equal(projection.reconciliation.receiptsOrphaned, 1);
  assert.equal(projection.reconciliation.eventsWithReceipt, 1);
});

test('reviews that never reached the authoritative writer are visible as such', () => {
  const events = [
    event({ reviewEventId: 's1', questionId: 'q1', nodeId: 'node-mid', reviewedAt: '2026-03-08T09:00:00.000Z', redoCorrect: true, scheduledReview: true }),
    event({ reviewEventId: 's2', questionId: 'q2', nodeId: 'node-mid', reviewedAt: '2026-03-08T10:00:00.000Z', redoCorrect: true, scheduledReview: false }),
    event({ reviewEventId: 's3', questionId: 'q3', nodeId: 'node-mid', reviewedAt: '2026-03-08T11:00:00.000Z', redoCorrect: true, scheduledReview: null }),
  ];
  const receipts = events.map((row) => receipt({ receiptId: `r-${row.reviewEventId}`, questionId: row.questionId, recordedAt: row.reviewedAt }));
  const projection = projectReviewEvidence({ events, receipts });
  assert.equal(projection.reconciliation.observedNotScheduled, 1);
  // An unrecorded scheduling status must not be read as a zero.
  assert.equal(projection.reconciliation.scheduleUnknown, 1);
  assert.match(projection.reconciliation.basis, /排程状态未记录/);
});

test('reviewEventIdOf is deterministic and distinguishes distinct occurrences', () => {
  const base = { scheduleId: 's', questionId: 'q', reviewedAt: '2026-03-09T09:00:00.000Z' };
  assert.equal(reviewEventIdOf(base), reviewEventIdOf({ ...base }));
  assert.equal(reviewEventIdOf({ ...base, attemptId: 'a1' }), 'review-attempt:a1');
  assert.notEqual(reviewEventIdOf({ ...base, attemptId: 'a1' }), reviewEventIdOf({ ...base, attemptId: 'a2' }));
  assert.notEqual(
    reviewEventIdOf(base),
    reviewEventIdOf({ ...base, idempotencyKey: 'k1' }),
    'an idempotency key must separate otherwise identical timestamps',
  );
});

// ---------------------------------------------------------------------------
// Phase 3/4 — per-event mastery trajectory
// ---------------------------------------------------------------------------

test('every eligible event produces exactly one traceable mastery step', () => {
  const { events, receipts, baselines, authoritative } = cleanFixture();
  const projection = projectReviewEvidence({ events, receipts });
  const shadow = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative });

  assert.equal(shadow.eventRows.length, 6);
  assert.deepEqual(
    shadow.eventRows.map((row) => row.reviewEventId).sort(),
    ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'],
  );
  for (const row of shadow.eventRows) {
    assert.equal(typeof row.nodeId, 'string');
    assert.equal(typeof row.masteryBefore, 'number');
    assert.equal(typeof row.shadowMastery, 'number');
    assert.equal(row.authoritative, undefined, 'event rows are plain data; the container is what is marked');
    assert.match(row.basis, /掌握度/);
  }
  assert.equal(shadow.authoritative, false);
  assert.equal(shadow.summary.authoritative, false);
  assert.equal(shadow.summary.eventsReplayed, 6);
  assert.equal(shadow.summary.eventsSkipped, 0);
});

test('the per-event engine is the existing node-level replay, not a second 口径', () => {
  // The strongest anti-drift check available: two independently written code
  // paths, given identical inputs, must produce identical node totals.
  const { events, receipts, baselines, authoritative } = cleanFixture();
  const projection = projectReviewEvidence({ events, receipts });
  const shadow = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative });

  const replay = replayUnifiedReviewMastery({
    observations: projection.observations.map((row) => ({
      nodeId: row.nodeId,
      questionId: row.questionId,
      reviewedAt: row.reviewedAt,
      redoCorrect: row.redoCorrect,
      difficulty: row.difficulty,
    })),
    baselines,
    stored: authoritative,
    baselineApproximated: true,
  });

  const replayByNode = new Map(replay.rows.map((row) => [row.nodeId, row]));
  assert.equal(shadow.nodeRows.length, replayByNode.size);
  for (const node of shadow.nodeRows) {
    const other = replayByNode.get(node.nodeId);
    assert.ok(other, `node ${node.nodeId} missing from the node-level replay`);
    assert.equal(node.shadowMastery, other.replayMastery, `mastery diverged on ${node.nodeId}`);
    assert.equal(node.direction, other.direction, `direction diverged on ${node.nodeId}`);
    assert.equal(node.authoritativeMastery, other.storedMastery);
    assert.equal(node.masteryDelta, other.delta);
  }
});

test('the shared seed is neutral 0.5 when no snapshot baseline exists, and the row says so', () => {
  const { events, receipts } = cleanFixture();
  const projection = projectReviewEvidence({ events, receipts });
  const shadow = buildReviewMasteryShadow({ observations: projection.observations, authoritative: [] });

  assert.equal(shadow.nodeRows.every((row) => row.baselineSource === 'neutral'), true);
  assert.equal(shadow.nodeRows.every((row) => row.baselineMastery === 0.5), true);
  assert.equal(shadow.nodeRows.every((row) => row.masteryDelta === null), true);
  assert.equal(shadow.nodeRows.every((row) => row.direction === 'insufficient_data'), true);
  assert.match(shadow.eventRows[0].basis, /统一语义目标/);
});

test('the wrong-review transient is disclosed rather than hidden', () => {
  // A wrong review from 0.22 with difficulty 1 has a canonical target of 0.38,
  // which is ABOVE the estimate — so the EMA raises mastery after a wrong
  // answer. That is the existing semantics' own behaviour; the shadow must show
  // it and must be provably reproducible from `updateMasteryAfterAttempt`.
  const events = [event({ reviewEventId: 'w1', questionId: 'q1', nodeId: 'node-low', reviewedAt: '2026-03-10T09:00:00.000Z', redoCorrect: false, difficulty: 1 })];
  const receipts = [receipt({ receiptId: 'r-w1', questionId: 'q1', recordedAt: '2026-03-10T09:00:00.000Z' })];
  const baselines = [{ nodeId: 'node-low', mastery: 0.22, accuracy: 0.3, recentAccuracy: 0.3, attempts: 4, correctCount: 1, wrongCount: 3, confidence: 0.3, at: '2026-03-01T00:00:00.000Z' }];
  const authoritative = [{ nodeId: 'node-low', mastery: 0.22, stabilityDays: 3 }];

  const projection = projectReviewEvidence({ events, receipts });
  const shadow = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative });

  assert.equal(shadow.summary.incorrectRaised, 1, 'the transient must be counted, not buried');
  const row = shadow.eventRows[0];
  assert.equal(row.direction, 'up');
  assert.ok(row.shadowMastery > row.masteryBefore);

  const expected = updateMasteryAfterAttempt(neutral(0.22), { isCorrect: false, difficulty: 1, role: 'PRIMARY' });
  assert.equal(row.shadowMastery, Math.round(expected.mastery * 10000) / 10000);
  const target = effectiveTargetFor('production', neutral(0.22), { isCorrect: false, difficulty: 1, role: 'PRIMARY' });
  assert.ok(target > 0.22, 'the rise is the canonical target lying above the estimate');
});

test('switching the model is opt-in, never the default', () => {
  const { events, receipts, baselines, authoritative } = cleanFixture();
  const projection = projectReviewEvidence({ events, receipts });
  const asProduction = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative });
  const asCandidate = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative, model: 'direction_preserving' });

  assert.equal(asProduction.model, 'production');
  assert.equal(asCandidate.model, 'direction_preserving');
  // The C1 model may not move against the observed outcome, so its transients
  // differ; the equilibrium must not.
  assert.equal(asCandidate.summary.correctLowered, 0);
  assert.equal(asCandidate.summary.incorrectRaised, 0);
});

// ---------------------------------------------------------------------------
// Phase 7 — invariants, with positive controls for every check
// ---------------------------------------------------------------------------

test('all seven invariants hold on a clean, fully receipted history', () => {
  const { events, receipts, baselines, authoritative } = cleanFixture();
  const projection = projectReviewEvidence({ events, receipts });
  const shadow = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative });
  const dataset = joinReviewIntegrationDataset({
    studentId: 'stu-1',
    shadow,
    downstream: shadow.nodeRows.map((row) => ({
      nodeId: row.nodeId,
      observedPriority: 50,
      shadowPriority: 52,
      observedOpportunity: 0.4,
      shadowOpportunity: 0.45,
      observedRank: 3,
      shadowRank: 2,
      attributionBasis: 'review.recalled → mastery → priority → opportunity → recommendation',
    })),
    generatedAt: '2026-03-11T00:00:00.000Z',
  });

  const audit = auditReviewMasteryIntegration({ observations: projection.observations, shadow, dataset });
  assert.equal(audit.passed, true, audit.basis);
  assert.deepEqual(audit.checks.map((check) => check.id), ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7']);
  assert.equal(audit.checks.every((check) => check.passed), true, JSON.stringify(audit.checks.filter((c) => !c.passed)));
  assert.equal(audit.authoritative, false);
});

test('A1 catches a missing step and A7 catches skipped-event accounting that does not add up', () => {
  const { events, receipts, baselines, authoritative } = cleanFixture();
  const projection = projectReviewEvidence({ events, receipts });
  const shadow = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative });

  const missingStep = { ...shadow, eventRows: shadow.eventRows.slice(0, 5) };
  const audit1 = auditReviewMasteryIntegration({ observations: projection.observations, shadow: missingStep });
  assert.equal(audit1.passed, false);
  assert.equal(audit1.checks.find((c) => c.id === 'A1').passed, false);

  const wrongSkipCount = { ...shadow, summary: { ...shadow.summary, eventsSkipped: 3 } };
  const audit7 = auditReviewMasteryIntegration({ observations: projection.observations, shadow: wrongSkipCount });
  assert.equal(audit7.checks.find((c) => c.id === 'A7').passed, false);
});

test('A2 catches a post-processing step that adjusts the published row without the trace', () => {
  const { events, receipts, baselines, authoritative } = cleanFixture();
  const projection = projectReviewEvidence({ events, receipts });
  const shadow = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative });

  const tampered = {
    ...shadow,
    eventRows: shadow.eventRows.map((row, index) =>
      index === 0 ? { ...row, shadowMastery: 0.99 } : row,
    ),
  };
  const audit = auditReviewMasteryIntegration({ observations: projection.observations, shadow: tampered });
  assert.equal(audit.passed, false);
  assert.equal(audit.checks.find((c) => c.id === 'A2').passed, false);
  assert.equal(audit.checks.find((c) => c.id === 'A1').passed, true, 'A1 is about presence, not fidelity');
});

test('A3 catches a broken trajectory that stops chaining', () => {
  const { events, receipts, baselines, authoritative } = cleanFixture();
  const projection = projectReviewEvidence({ events, receipts });
  const shadow = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative });

  const broken = {
    ...shadow,
    trace: shadow.trace.map((node) =>
      node.nodeId === 'node-mid'
        ? { ...node, steps: node.steps.map((step, index) => (index === 1 ? { ...step, beforeRaw: step.beforeRaw + 0.01 } : step)) }
        : node),
  };
  const audit = auditReviewMasteryIntegration({ observations: projection.observations, shadow: broken });
  assert.equal(audit.checks.find((c) => c.id === 'A3').passed, false);
});

test('A5 catches cross-student leakage and A6 catches an authoritative write', () => {
  const { events, receipts, baselines, authoritative } = cleanFixture();
  const projection = projectReviewEvidence({ events, receipts });
  const shadow = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative });
  const dataset = joinReviewIntegrationDataset({
    studentId: 'stu-1',
    shadow,
    downstream: [],
    generatedAt: '2026-03-11T00:00:00.000Z',
  });

  const leaked = {
    ...dataset,
    rows: dataset.rows.map((row, index) => (index === 0 ? { ...row, studentId: 'stu-2' } : row)),
  };
  const audit5 = auditReviewMasteryIntegration({ observations: projection.observations, shadow, dataset: leaked });
  assert.equal(audit5.checks.find((c) => c.id === 'A5').passed, false);

  const audit6 = auditReviewMasteryIntegration({ observations: projection.observations, shadow, dataset, authoritativeWrites: 1 });
  assert.equal(audit6.checks.find((c) => c.id === 'A6').passed, false);
  assert.equal(audit6.passed, false);
});

test('the shadow service performs no authoritative write and never touches the production writer', () => {
  const source = readFileSync(SERVICE_SOURCE, 'utf8');
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  for (const call of ['userKnowledgeMastery', 'userMasterySnapshot', 'applyReview', 'applyAttempts', '\\$transaction']) {
    assert.equal(
      new RegExp(`${call}\\s*\\.\\s*(update|upsert|create|delete|createMany|updateMany)`, 'i').test(stripped),
      false,
      `the shadow must not write through ${call}`,
    );
    assert.equal(
      new RegExp(`(update|upsert|create|delete|createMany|updateMany)\\s*\\(\\s*\\{[^}]*${call}`, 'i').test(stripped),
      false,
      `the shadow must not write ${call}`,
    );
  }
  assert.match(stripped, /findMany/, 'positive control: the file was actually scanned');
  assert.match(stripped, /authoritative:\s*false/);
});

// ---------------------------------------------------------------------------
// Phase 5/8/9 — dataset, distributions, cohort aggregate
// ---------------------------------------------------------------------------

test('the dataset joins per-event mastery to node-level downstream deltas', () => {
  const { events, receipts, baselines, authoritative } = cleanFixture();
  const projection = projectReviewEvidence({ events, receipts });
  const shadow = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative });

  const downstream = [
    { nodeId: 'node-low', observedPriority: 40, shadowPriority: 46, observedOpportunity: 0.3, shadowOpportunity: 0.42, observedRank: 3, shadowRank: 1, attributionBasis: 'review.recalled → mastery → priority → opportunity → recommendation' },
    { nodeId: 'node-mid', observedPriority: 60, shadowPriority: 61, observedOpportunity: 0.55, shadowOpportunity: 0.56, observedRank: 1, shadowRank: 2, attributionBasis: 'review.recalled → mastery → priority → opportunity → recommendation' },
    { nodeId: 'node-high', observedPriority: 70, shadowPriority: 70, observedOpportunity: 0.7, shadowOpportunity: 0.7, observedRank: 2, shadowRank: 3, attributionBasis: 'review.recalled → mastery' },
  ];
  const dataset = joinReviewIntegrationDataset({
    studentId: 'stu-1',
    shadow,
    downstream,
    generatedAt: '2026-03-11T00:00:00.000Z',
    confidenceByNode: { 'node-low': 0.3, 'node-mid': 0.5, 'node-high': 0.7 },
  });

  assert.equal(dataset.rows.length, 6);
  assert.equal(dataset.authoritative, false);
  assert.equal(dataset.summary.attributionComplete, true);
  assert.equal(dataset.rows.every((row) => row.authoritative === false), true);
  assert.equal(dataset.rows.every((row) => row.studentId === 'stu-1'), true);
  assert.equal(dataset.summary.confidenceMean, 0.5);

  const low = dataset.rows.find((row) => row.nodeId === 'node-low');
  assert.equal(low.observedPriority, 40);
  assert.equal(low.shadowPriority, 46);
  assert.equal(low.priorityDelta, 6);
  assert.equal(low.opportunityDelta, 0.12);
  assert.equal(low.observedRank, 3);
  assert.equal(low.shadowRank, 1);
  assert.equal(low.rankDelta, -2);
  assert.equal(low.observedMastery, 0.22, 'review does not move the authoritative value');

  // Cumulative divergence grows along the node's events.
  const lowRows = dataset.rows.filter((row) => row.nodeId === 'node-low');
  assert.equal(lowRows[0].masteryDelta, lowRows[0].masteryStepDelta, 'the first step IS the cumulative delta');
  assert.notEqual(lowRows[1].masteryDelta, lowRows[1].masteryStepDelta);

  assert.ok(dataset.summary.masteryDelta.count >= 1);
  assert.equal(dataset.summary.priorityDelta.count, 3);
  assert.equal(dataset.summary.rankChanges, 6, 'every event of a rank-changing node counts');
  assert.deepEqual(dataset.summary.topRankChanges.map((row) => row.nodeId).slice(0, 2), ['node-low', 'node-mid']);
  assert.equal(dataset.summary.affectedNodes, shadow.summary.nodesChanged);
});

test('a dataset with no downstream attribution reports incompleteness instead of claiming success', () => {
  const { events, receipts, baselines, authoritative } = cleanFixture();
  const projection = projectReviewEvidence({ events, receipts });
  const shadow = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative });
  const dataset = joinReviewIntegrationDataset({ studentId: 'stu-1', shadow, downstream: [], generatedAt: '2026-03-11T00:00:00.000Z' });

  assert.equal(dataset.summary.attributionComplete, false);
  assert.equal(dataset.summary.attributedEvents, 0);
  assert.equal(dataset.summary.priorityDelta, null);
  assert.match(dataset.summary.basis, /缺归因/);
});

test('the cohort aggregate reports affected student and node ratios honestly', () => {
  const { events, receipts, baselines, authoritative } = cleanFixture();
  const projection = projectReviewEvidence({ events, receipts });
  const shadow = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative });
  const affected = joinReviewIntegrationDataset({
    studentId: 'stu-1',
    shadow,
    downstream: shadow.nodeRows.map((row) => ({
      nodeId: row.nodeId, observedPriority: 10, shadowPriority: 20,
      observedOpportunity: 0.1, shadowOpportunity: 0.2,
      observedRank: 5, shadowRank: 4, attributionBasis: 'review.recalled → mastery',
    })),
    generatedAt: '2026-03-11T00:00:00.000Z',
  });
  const untouched = { ...affected, studentId: 'stu-2', rows: [], summary: { ...affected.summary, nodes: 3, events: 0, affectedNodes: 0, rankChanges: 0 } };

  const aggregate = aggregateReviewIntegrationCohort([affected, untouched]);
  assert.equal(aggregate.students, 2);
  assert.equal(aggregate.studentsWithReviewHistory, 1);
  assert.equal(aggregate.studentsAffected, 1);
  assert.equal(aggregate.affectedStudentRatio, 1, 'a student with no review history is not an unaffected case, they are absent');
  assert.equal(aggregate.authoritative, false);
  assert.ok(aggregate.masteryDelta.count > 0);
  assert.ok(aggregate.masteryDelta.absMean >= Math.abs(aggregate.masteryDelta.mean) - 1e-9);

  const empty = aggregateReviewIntegrationCohort([]);
  assert.equal(empty.affectedStudentRatio, 0);
  assert.equal(empty.masteryDelta, null);
  assert.equal(empty.attributionComplete, true);
});

test('summarizeDeltas returns null for no data rather than a fabricated zero', () => {
  assert.equal(summarizeDeltas([]), null);
  const stats = summarizeDeltas([0, 0.1, -0.2]);
  assert.equal(stats.count, 3);
  assert.equal(stats.min, -0.2);
  assert.equal(stats.max, 0.1);
  assert.equal(stats.median, 0);
  assert.equal(stats.nonZero, 2);
  assert.ok(stats.p90 >= stats.median, 'p90 must not fall below the median');
});

// ---------------------------------------------------------------------------
// Phase 6 — band × outcome × difficulty × repetition grid
// ---------------------------------------------------------------------------

test('the invariant set holds across bands, outcomes, difficulties and repetitions', () => {
  const bands = [
    { nodeId: 'g-low', mastery: 0.22 },
    { nodeId: 'g-mid', mastery: 0.6 },
    { nodeId: 'g-high', mastery: 0.95 },
  ];
  const rows = [];
  let audited = 0;
  let failed = 0;

  for (const band of bands) {
    for (const difficulty of [1, 3, 5]) {
      for (const repeats of [1, 3]) {
        for (const outcome of [true, false]) {
          const events = [];
          const receipts = [];
          for (let index = 0; index < repeats; index += 1) {
            const id = `${band.nodeId}-d${difficulty}-r${repeats}-${outcome ? 'c' : 'w'}-${index}`;
            const reviewedAt = `2026-04-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`;
            events.push(event({ reviewEventId: id, questionId: `q-${id}`, nodeId: band.nodeId, reviewedAt, redoCorrect: outcome, difficulty }));
            receipts.push(receipt({ receiptId: `r-${id}`, questionId: `q-${id}`, recordedAt: reviewedAt }));
          }
          const baselines = [{ nodeId: band.nodeId, mastery: band.mastery, accuracy: band.mastery, recentAccuracy: band.mastery, attempts: 8, correctCount: 5, wrongCount: 3, confidence: 0.5, at: '2026-03-01T00:00:00.000Z' }];
          const authoritative = [{ nodeId: band.nodeId, mastery: band.mastery, stabilityDays: 3 }];
          const projection = projectReviewEvidence({ events, receipts });
          const shadow = buildReviewMasteryShadow({ observations: projection.observations, baselines, authoritative });
          const audit = auditReviewMasteryIntegration({ observations: projection.observations, shadow });
          audited += 1;
          if (!audit.passed) failed += 1;
          rows.push({
            band: band.nodeId,
            mastery: band.mastery,
            difficulty,
            repeats,
            outcome,
            shadowMastery: shadow.nodeRows[0].shadowMastery,
            delta: shadow.nodeRows[0].masteryDelta,
            correctLowered: shadow.summary.correctLowered,
            incorrectRaised: shadow.summary.incorrectRaised,
            eventRows: shadow.eventRows,
            direction: shadow.nodeRows[0].direction,
          });
        }
      }
    }
  }

  assert.equal(audited, 3 * 3 * 2 * 2);
  assert.equal(failed, 0, 'no grid cell may violate the invariants');

  // Every disclosed transient must be reproducible from the production model
  // alone — if the wiring invented one, this catches it.
  let transients = 0;
  for (const row of rows) {
    for (const eventRow of row.eventRows) {
      const before = eventRow.masteryBefore;
      const moved = eventRow.shadowMastery - before;
      const isTransient = (eventRow.observedResult && moved < 0) || (!eventRow.observedResult && moved > 0);
      if (!isTransient) continue;
      transients += 1;
      const expected = applyMasteryModel('production', neutral(before), {
        isCorrect: eventRow.observedResult,
        difficulty: eventRow.difficulty,
        role: 'PRIMARY',
      });
      const target = effectiveTargetFor('production', neutral(before), {
        isCorrect: eventRow.observedResult,
        difficulty: eventRow.difficulty,
        role: 'PRIMARY',
      });
      assert.equal(Math.round(expected.mastery * 10000) / 10000, eventRow.shadowMastery);
      assert.ok(
        eventRow.observedResult ? target < before : target > before,
        'a transient only happens when the canonical target sits on the other side of the estimate',
      );
    }
  }

  // Correct reviews must always end at or above the baseline for the low band,
  // and never fall below the difficulty-appropriate target for the high band.
  for (const row of rows.filter((item) => item.outcome === true)) {
    assert.ok(row.shadowMastery >= row.mastery - 1e-9 || row.mastery > 0.9, `correct review lowered mastery from ${row.mastery} to ${row.shadowMastery}`);
  }
  assert.ok(transients >= 0);
});

test('repeated reviews accumulate toward the canonical target without overshooting it', () => {
  const make = (repeats) => {
    const events = [];
    const receipts = [];
    for (let index = 0; index < repeats; index += 1) {
      const reviewedAt = `2026-05-${String(index + 1).padStart(2, '0')}T09:00:00.000Z`;
      events.push(event({ reviewEventId: `c${index}`, questionId: `q${index}`, nodeId: 'g', reviewedAt, redoCorrect: true, difficulty: 3 }));
      receipts.push(receipt({ receiptId: `r${index}`, questionId: `q${index}`, recordedAt: reviewedAt }));
    }
    const projection = projectReviewEvidence({ events, receipts });
    return buildReviewMasteryShadow({
      observations: projection.observations,
      baselines: [{ nodeId: 'g', mastery: 0.4, accuracy: 0.4, recentAccuracy: 0.4, attempts: 5, correctCount: 2, wrongCount: 3, confidence: 0.4, at: '2026-04-01T00:00:00.000Z' }],
      authoritative: [{ nodeId: 'g', mastery: 0.4, stabilityDays: 2 }],
    });
  };

  const once = make(1).nodeRows[0].shadowMastery;
  const thrice = make(3).nodeRows[0].shadowMastery;
  const nine = make(9).nodeRows[0].shadowMastery;
  assert.ok(once < thrice, 'repetition must accumulate');
  assert.ok(thrice <= nine, 'and must be monotone');
  assert.ok(nine <= 0.885 + 1e-9, 'but may never exceed the difficulty-3 canonical target of 0.885');
});
