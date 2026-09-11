/**
 * V12-M3 Shadow Decision Chain — pure contract.
 *
 * The chain must propagate the unified-mastery shadow all the way downstream:
 *
 *   observed/unified mastery → priority → opportunity → recommendation ranking
 *
 * Two properties matter more than the numbers:
 *   1. both paths must run the SAME production primitives on the SAME candidate
 *      universe, so any difference is attributable to the mastery input alone;
 *   2. every difference must be explainable back to the review that caused it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildShadowDecisionChain,
  SHADOW_PRIORITY_EXPLOSION_THRESHOLD,
} from '../packages/shared/dist/index.js';

const NOW = '2026-09-11T00:00:00.000Z';

function observedState(overrides = {}) {
  return {
    mastery: 0.5,
    accuracy: 0.5,
    recentAccuracy: 0.5,
    attempts: 4,
    correctCount: 2,
    wrongCount: 2,
    confidence: 0.3,
    retention: 0.6,
    stabilityDays: 1.7,
    lastReviewedAt: '2026-09-09T00:00:00.000Z',
    pinned: false,
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    subject: '数据结构',
    importance: 4,
    difficulty: 3,
    recent3Y: { frequency: 4, primaryScore: 12 },
    recent5Y: { frequency: 5, primaryScore: 18 },
    allTimeEvidence: { frequency: 8 },
    trend: { direction: 'STABLE', delta: 0 },
    evidenceConfidence: 'HIGH',
    ...overrides,
  };
}

function node(overrides = {}) {
  return {
    knowledgeNodeId: 'node-1',
    title: '线性表',
    observed: observedState(),
    unified: null,
    evidence: evidence(),
    prerequisites: [],
    trainingCostMinutes: 30,
    primaryScore5y: 12,
    evidenceConfidence: 'HIGH',
    everSucceeded: true,
    prerequisiteReadiness: 0.8,
    trigger: null,
    ...overrides,
  };
}

function chain(nodes, overrides = {}) {
  return buildShadowDecisionChain({
    userId: 'u1',
    now: NOW,
    daysToExam: 60,
    availableMinutes: 120,
    goal: { stage: '强化', targetScore: 120, currentScore: 95, remainingDays: 60, dailyHours: 4 },
    reviewSummary: { dueCount: 0, overdueCount: 0 },
    maxItems: 8,
    nodes,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Case F — no review observed: nothing may move
// ---------------------------------------------------------------------------

test('Case F: a node with no unified divergence produces zero delta everywhere', () => {
  const result = chain([node({ unified: null, trigger: null })]);

  const row = result.rows[0];
  assert.equal(row.masteryDelta, null, 'no unified replay means no mastery delta to claim');
  assert.equal(row.masteryDirection, 'insufficient_data');
  assert.equal(row.priorityDelta, 0, 'priority must be identical when the input state is identical');
  assert.equal(row.opportunityDelta, 0);
  assert.equal(row.rankDelta, 0);
  assert.equal(result.summary.changedMastery, 0);
  assert.equal(result.summary.rankChanged, 0);
  assert.equal(result.summary.noImpactRatio, 1);
  assert.equal(result.authoritative, false);
});

// ---------------------------------------------------------------------------
// Case A / B — low mastery, correct vs wrong review
// ---------------------------------------------------------------------------

test('Case A: a correct review lifts shadow mastery, which lowers weakness-driven priority', () => {
  const result = chain([
    node({
      observed: observedState({ mastery: 0.3, recentAccuracy: 0.3 }),
      unified: { ...observedState({ mastery: 0.3, recentAccuracy: 0.3 }), mastery: 0.42, recentAccuracy: 0.44, attempts: 5, correctCount: 3 },
      trigger: { eventId: 'ev-1', eventType: 'review.recalled', at: '2026-09-10T00:00:00.000Z' },
    }),
  ]);

  const row = result.rows[0];
  assert.equal(row.masteryDirection, 'unified_higher');
  assert.ok((row.masteryDelta ?? 0) > 0);
  assert.equal(row.priorityDirection, 'lower', 'better mastery means less weakness urgency');
  assert.ok(row.shadowPriority < row.observedPriority);
  assert.equal(row.triggerEventType, 'review.recalled', 'the change is attributed to the review');
  assert.equal(result.summary.changedMastery, 1);
});

test('Case B: a wrong review lowers shadow mastery, which raises priority', () => {
  const result = chain([
    node({
      observed: observedState({ mastery: 0.3, recentAccuracy: 0.3 }),
      unified: { ...observedState({ mastery: 0.3, recentAccuracy: 0.3 }), mastery: 0.22, recentAccuracy: 0.2, attempts: 5, wrongCount: 3 },
      trigger: { eventId: 'ev-2', eventType: 'review.recalled', at: '2026-09-10T00:00:00.000Z' },
    }),
  ]);

  const row = result.rows[0];
  assert.equal(row.masteryDirection, 'unified_lower');
  assert.equal(row.priorityDirection, 'higher');
  assert.ok(row.shadowPriority > row.observedPriority);
});

test('Case C: a mid-mastery node moves less than a low-mastery one for the same review', () => {
  const low = chain([
    node({ observed: observedState({ mastery: 0.3 }), unified: { ...observedState({ mastery: 0.3 }), mastery: 0.4 } }),
  ]).rows[0];
  const mid = chain([
    node({ observed: observedState({ mastery: 0.6 }), unified: { ...observedState({ mastery: 0.6 }), mastery: 0.68 } }),
  ]).rows[0];

  assert.ok(
    Math.abs(low.priorityDelta) > Math.abs(mid.priorityDelta),
    'the same mastery gain reduces weakness pressure more when mastery is low',
  );
});

test('Case D: a high-mastery node that fails a review becomes clearly more urgent', () => {
  const result = chain([
    node({
      observed: observedState({ mastery: 0.85, recentAccuracy: 0.85, wrongCount: 0 }),
      unified: { ...observedState({ mastery: 0.85 }), mastery: 0.66, recentAccuracy: 0.6, attempts: 5, wrongCount: 1 },
      trigger: { eventId: 'ev-4', eventType: 'review.recalled', at: '2026-09-10T00:00:00.000Z' },
    }),
  ]);

  const row = result.rows[0];
  assert.equal(row.masteryDirection, 'unified_lower');
  assert.equal(row.priorityDirection, 'higher');
  assert.ok(row.shadowPriority - row.observedPriority > 5, 'a failed recall on a strong node is material');
});

test('Case E: repeated reviews accumulate, so the delta grows with the count', () => {
  const one = chain([
    node({ observed: observedState({ mastery: 0.4 }), unified: { ...observedState({ mastery: 0.4 }), mastery: 0.45 } }),
  ]).rows[0];
  const three = chain([
    node({ observed: observedState({ mastery: 0.4 }), unified: { ...observedState({ mastery: 0.4 }), mastery: 0.58 } }),
  ]).rows[0];

  assert.ok(Math.abs(three.masteryDelta ?? 0) > Math.abs(one.masteryDelta ?? 0));
  assert.ok(Math.abs(three.priorityDelta) > Math.abs(one.priorityDelta));
});

// ---------------------------------------------------------------------------
// Risk A / C — no explosion, one universe
// ---------------------------------------------------------------------------

test('Risk A: a large priority swing is flagged rather than silently reported', () => {
  const result = chain([
    node({
      observed: observedState({ mastery: 0.95, recentAccuracy: 0.95, wrongCount: 0, retention: 0.95 }),
      unified: { ...observedState({ mastery: 0.95 }), mastery: 0.05, recentAccuracy: 0.05, attempts: 20, wrongCount: 15 },
      trigger: { eventId: 'ev-x', eventType: 'review.recalled', at: NOW },
    }),
  ]);

  const finding = result.risks.find((risk) => risk.code === 'PRIORITY_SWING');
  assert.ok(finding, 'a swing this large must be surfaced as a risk');
  assert.ok(Math.abs(result.rows[0].priorityDelta) >= SHADOW_PRIORITY_EXPLOSION_THRESHOLD);
  assert.ok(finding.nodeIds.includes('node-1'));
  assert.ok(finding.basis.length > 0);
});

test('Risk C: both paths report the same candidate universe', () => {
  const result = chain([
    node({ knowledgeNodeId: 'node-1' }),
    node({ knowledgeNodeId: 'node-2', title: '树' }),
    node({ knowledgeNodeId: 'node-3', title: '图' }),
  ]);

  assert.equal(result.summary.candidateUniverse.observed, 3);
  assert.equal(result.summary.candidateUniverse.shadow, 3);
  assert.equal(result.summary.candidateUniverse.consistent, true);
  assert.deepEqual(result.summary.candidateUniverse.nodeIds, ['node-1', 'node-2', 'node-3']);
  assert.equal(result.risks.some((risk) => risk.code === 'UNIVERSE_MISMATCH'), false);
});

// ---------------------------------------------------------------------------
// Risk D / E — attribution
// ---------------------------------------------------------------------------

test('Risk D: a mastery change with no trigger is reported as unattributed', () => {
  const result = chain([
    node({
      observed: observedState({ mastery: 0.5 }),
      unified: { ...observedState({ mastery: 0.5 }), mastery: 0.7 },
      trigger: null,
    }),
  ]);

  const finding = result.risks.find((risk) => risk.code === 'UNATTRIBUTED_MASTERY');
  assert.ok(finding, 'a divergence nobody can explain must be surfaced');
  assert.deepEqual(finding.nodeIds, ['node-1']);
});

test('a node with a trigger carries a full chain explanation', () => {
  const result = chain([
    node({
      observed: observedState({ mastery: 0.4 }),
      unified: { ...observedState({ mastery: 0.4 }), mastery: 0.55 },
      trigger: { eventId: 'ev-9', eventType: 'review.recalled', at: '2026-09-10T00:00:00.000Z' },
    }),
  ]);

  const row = result.rows[0];
  assert.equal(row.triggerEventId, 'ev-9');
  assert.match(row.attribution, /review\.recalled/);
  assert.match(row.attribution, /掌握度/);
  assert.match(row.attribution, /优先级/);
});

// ---------------------------------------------------------------------------
// Ranking behaviour
// ---------------------------------------------------------------------------

test('ranking is reported for both paths with entered and exited nodes', () => {
  const result = chain(
    [
      node({ knowledgeNodeId: 'node-1', title: 'A', observed: observedState({ mastery: 0.2 }), unified: { ...observedState({ mastery: 0.2 }), mastery: 0.9 } }),
      node({ knowledgeNodeId: 'node-2', title: 'B', observed: observedState({ mastery: 0.9 }), unified: { ...observedState({ mastery: 0.9 }), mastery: 0.15 } }),
    ],
    { maxItems: 1 },
  );

  assert.equal(result.summary.topN.n, 1);
  assert.equal(result.summary.topN.observed.length, 1);
  assert.equal(result.summary.topN.shadow.length, 1);
  assert.equal(result.summary.topN.top1Changed, true, 'the two paths disagree about the top item');
  assert.equal(result.summary.topN.entered.length + result.summary.topN.exited.length > 0, true);
  for (const row of result.rows) {
    assert.ok(row.observedRank != null || row.shadowRank != null, 'each row reports at least one rank');
  }
});

test('rank delta is signed so direction is readable', () => {
  const result = chain([
    node({ knowledgeNodeId: 'node-1', observed: observedState({ mastery: 0.3 }), unified: { ...observedState({ mastery: 0.3 }), mastery: 0.8 } }),
    node({ knowledgeNodeId: 'node-2', observed: observedState({ mastery: 0.7 }), unified: { ...observedState({ mastery: 0.7 }), mastery: 0.25 } }),
  ]);

  const rising = result.rows.find((row) => row.knowledgeNodeId === 'node-2');
  const falling = result.rows.find((row) => row.knowledgeNodeId === 'node-1');
  // node-2 becomes weaker → more urgent → better (smaller) rank number
  assert.ok((rising?.rankDelta ?? 0) <= 0);
  assert.ok((falling?.rankDelta ?? 0) >= 0);
});

// ---------------------------------------------------------------------------
// Impact distribution and safety
// ---------------------------------------------------------------------------

test('the summary carries the distribution the owner needs for a decision', () => {
  const result = chain([
    node({ knowledgeNodeId: 'node-1', observed: observedState({ mastery: 0.3 }), unified: { ...observedState({ mastery: 0.3 }), mastery: 0.5 } }),
    node({ knowledgeNodeId: 'node-2', observed: observedState({ mastery: 0.6 }), unified: { ...observedState({ mastery: 0.6 }), mastery: 0.4 } }),
    node({ knowledgeNodeId: 'node-3', observed: observedState({ mastery: 0.8 }), unified: { ...observedState({ mastery: 0.8 }), mastery: 0.8 } }),
  ]);

  const summary = result.summary;
  assert.equal(summary.candidates, 3);
  assert.equal(summary.changedMastery, 2);
  assert.equal(summary.noImpact, 1);
  assert.ok(Math.abs(summary.affectedRatio - 2 / 3) < 1e-3, 'affected ratio is the share of nodes whose mastery moved');
  assert.ok(Math.abs(summary.noImpactRatio - 1 / 3) < 1e-3);
  assert.equal(typeof summary.medianMasteryDelta, 'number');
  assert.equal(typeof summary.p90MasteryDelta, 'number');
  assert.ok(summary.p90MasteryDelta >= summary.medianMasteryDelta, 'p90 must not be below the median');
  assert.equal(summary.authoritative, false);
  assert.match(summary.basis, /非权威|影子/);
});

test('an empty candidate set is reported as empty, not as a clean bill of health', () => {
  const result = chain([]);
  assert.equal(result.rows.length, 0);
  assert.equal(result.summary.candidates, 0);
  assert.equal(result.summary.noImpactRatio, 1);
  assert.match(result.summary.basis, /没有|无/);
});

test('the chain is deterministic and always non-authoritative', () => {
  const nodes = [
    node({ knowledgeNodeId: 'node-1', observed: observedState({ mastery: 0.4 }), unified: { ...observedState({ mastery: 0.4 }), mastery: 0.5 } }),
    node({ knowledgeNodeId: 'node-2', observed: observedState({ mastery: 0.6 }), unified: { ...observedState({ mastery: 0.6 }), mastery: 0.5 } }),
  ];
  const a = chain(nodes);
  const b = chain(nodes);

  assert.equal(a.authoritative, false);
  assert.equal(a.summary.authoritative, false);
  assert.ok(a.rows.every((row) => row.authoritative === false));
  assert.deepEqual(a.rows.map((row) => row.rankDelta), b.rows.map((row) => row.rankDelta));
  assert.deepEqual(a.rows.map((row) => row.priorityDelta), b.rows.map((row) => row.priorityDelta));
  assert.equal(a.summary.medianMasteryDelta, b.summary.medianMasteryDelta);
});

test('the module reuses the production primitives instead of reimplementing them', () => {
  const source = readFileSync(
    new URL('../packages/shared/src/score-center/shadow-decision-chain.ts', import.meta.url),
    'utf8',
  );
  assert.match(source, /from '\.\/priority'/, 'priority must come from the production module');
  assert.match(source, /from '\.\/recommendation'/, 'ranking must come from the production engine');
  assert.match(source, /from '\.\/score-opportunity'/, 'opportunity must reuse the M4 model');
  for (const forbidden of ['COMPONENT_WEIGHTS =', 'function calculatePriority', 'export function runRecommendation']) {
    assert.ok(!source.includes(forbidden), `the chain must not fork the engine: ${forbidden}`);
  }
});
