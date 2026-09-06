/**
 * V6.3 Effectiveness Assembly tests — pure function coverage for the
 * production read-model that feeds the V6/V6.1/V6.2 derivation layer.
 *
 * Covers: point→node resolution (PRIMARY preference), practice fact
 * projection (unmapped records dropped), mastery before/after window
 * picking, node outcome derivation with evidence gates, profile input
 * mapping, and the ai-metrics effectiveness counters.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  resolvePointToNodeMap,
  toPracticeFacts,
  pickMasteryBounds,
  deriveNodeOutcomes,
  toProfileInput,
  EVIDENCE_GATE,
} from '../apps/api/dist/effectiveness/effectiveness.assembly.js';
import { classifyStudent } from '../apps/api/dist/effectiveness/learning-effectiveness.js';
import { AiMetricsService } from '../apps/api/dist/ai-metrics/ai-metrics.service.js';

const WINDOW_START = '2026-09-01T00:00:00.000Z';
const WINDOW_END = '2026-09-08T00:00:00.000Z';

test('resolvePointToNodeMap prefers PRIMARY mapping over secondary rows', () => {
  const map = resolvePointToNodeMap([
    { knowledgePointId: 'p-1', knowledgeNodeId: 'n-secondary', mappingType: 'SECONDARY' },
    { knowledgePointId: 'p-1', knowledgeNodeId: 'n-primary', mappingType: 'PRIMARY' },
    { knowledgePointId: 'p-2', knowledgeNodeId: 'n-only', mappingType: 'HYBRID' },
  ]);
  assert.equal(map.get('p-1'), 'n-primary');
  assert.equal(map.get('p-2'), 'n-only');
  assert.equal(map.size, 2);
});

test('toPracticeFacts drops records without a node mapping', () => {
  const facts = toPracticeFacts(
    [
      { questionId: 'q-1', knowledgePointId: 'p-1', correct: true, submittedAt: new Date('2026-09-02T10:00:00Z') },
      { questionId: 'q-2', knowledgePointId: 'p-unmapped', correct: false, submittedAt: '2026-09-03T10:00:00.000Z' },
    ],
    new Map([['p-1', 'n-1']]),
  );
  assert.equal(facts.length, 1);
  assert.equal(facts[0].knowledgeNodeId, 'n-1');
  assert.equal(facts[0].questionId, 'q-1');
});

test('pickMasteryBounds picks latest-before and latest-at-or-before-end', () => {
  const rows = [
    { knowledgeNodeId: 'n-1', mastery: 0.2, snapshotDate: '2026-08-20T00:00:00.000Z' },
    { knowledgeNodeId: 'n-1', mastery: 0.3, snapshotDate: '2026-08-31T00:00:00.000Z' },
    { knowledgeNodeId: 'n-1', mastery: 0.5, snapshotDate: '2026-09-03T00:00:00.000Z' },
    { knowledgeNodeId: 'n-1', mastery: 0.6, snapshotDate: '2026-09-07T00:00:00.000Z' },
  ];
  const bounds = pickMasteryBounds(rows, ['n-1'], new Date(WINDOW_START).getTime(), new Date(WINDOW_END).getTime());
  assert.equal(bounds.get('n-1').before, 0.3);
  assert.equal(bounds.get('n-1').after, 0.6);
});

test('pickMasteryBounds omits nodes without an after snapshot and leaves before null when no history', () => {
  const rows = [
    { knowledgeNodeId: 'n-2', mastery: 0.4, snapshotDate: '2026-09-10T00:00:00.000Z' },
  ];
  const bounds = pickMasteryBounds(rows, ['n-1', 'n-2'], new Date(WINDOW_START).getTime(), new Date(WINDOW_END).getTime());
  assert.equal(bounds.has('n-2'), false);
  assert.equal(bounds.has('n-1'), false);
});

test('deriveNodeOutcomes computes gains and passes the evidence gate for strong samples', () => {
  const facts = [
    { questionId: 'q-1', knowledgeNodeId: 'n-1', correct: true, submittedAt: '2026-09-02T10:00:00.000Z' },
    { questionId: 'q-2', knowledgeNodeId: 'n-1', correct: true, submittedAt: '2026-09-03T10:00:00.000Z' },
    { questionId: 'q-3', knowledgeNodeId: 'n-1', correct: false, submittedAt: '2026-09-04T10:00:00.000Z' },
    { questionId: 'q-4', knowledgeNodeId: 'n-1', correct: true, submittedAt: '2026-09-05T10:00:00.000Z' },
    { questionId: 'q-5', knowledgeNodeId: 'n-1', correct: true, submittedAt: '2026-09-06T10:00:00.000Z' },
  ];
  const bounds = new Map([['n-1', { before: 0.3, after: 0.55 }]]);
  const views = deriveNodeOutcomes({ facts, bounds, windowStart: WINDOW_START, windowEnd: WINDOW_END });
  assert.equal(views.length, 1);
  const view = views[0];
  assert.equal(view.attemptsInWindow, 5);
  assert.equal(view.correctInWindow, 4);
  assert.equal(view.accuracyInWindow, 0.8);
  assert.equal(view.masteryGain, 0.25);
  assert.equal(view.quality, 'ok');
  assert.equal(view.confidence, 'high');
  assert.equal(view.evidenceGate.passed, true);
  assert.equal(view.evidenceGate.checks.find((c) => c.name === 'min_sample_size').passed, true);
});

test('deriveNodeOutcomes reports honest insufficient_data for thin samples', () => {
  const facts = [
    { questionId: 'q-1', knowledgeNodeId: 'n-thin', correct: true, submittedAt: '2026-09-02T10:00:00.000Z' },
  ];
  const bounds = new Map([['n-thin', { before: null, after: 0.5 }]]);
  const views = deriveNodeOutcomes({ facts, bounds, windowStart: WINDOW_START, windowEnd: WINDOW_END });
  assert.equal(views.length, 1);
  const view = views[0];
  assert.equal(view.sampleSize, 1);
  assert.equal(view.quality, 'insufficient_data');
  assert.equal(view.confidence, 'low');
  assert.equal(view.masteryGain, null);
  assert.equal(view.evidenceGate.passed, false);
  assert.ok(view.evidenceGate.reason.startsWith('blocked:'));
});

test('deriveNodeOutcomes sorts by attempt volume', () => {
  const facts = [
    { questionId: 'q-1', knowledgeNodeId: 'n-low', correct: true, submittedAt: '2026-09-02T10:00:00.000Z' },
    { questionId: 'q-2', knowledgeNodeId: 'n-high', correct: true, submittedAt: '2026-09-02T10:00:00.000Z' },
    { questionId: 'q-3', knowledgeNodeId: 'n-high', correct: true, submittedAt: '2026-09-03T10:00:00.000Z' },
    { questionId: 'q-4', knowledgeNodeId: 'n-high', correct: true, submittedAt: '2026-09-04T10:00:00.000Z' },
  ];
  const bounds = new Map([
    ['n-low', { before: 0.1, after: 0.2 }],
    ['n-high', { before: 0.1, after: 0.2 }],
  ]);
  const views = deriveNodeOutcomes({ facts, bounds, windowStart: WINDOW_START, windowEnd: WINDOW_END });
  assert.equal(views[0].knowledgeNodeId, 'n-high');
  assert.equal(views[1].knowledgeNodeId, 'n-low');
});

test('toProfileInput applies honest defaults for missing exam date', () => {
  const input = toProfileInput(
    { overdueCount: 3, studyStreak: 8, openTaskCount: 2, examDaysRemaining: null },
    { avgMastery: 0.62, recentAccuracy: 0.7 },
  );
  assert.equal(input.examDaysRemaining, 999);
  assert.equal(input.avgMastery, 0.62);
  const profile = classifyStudent(input);
  assert.equal(profile.consistency, 'high');
  assert.equal(profile.reviewBehavior, 'debt');
});

test('toProfileInput keeps classifyStudent contract for weak students', () => {
  const input = toProfileInput(
    { overdueCount: 5, studyStreak: 1, openTaskCount: 0, examDaysRemaining: 10 },
    { avgMastery: 0.3, recentAccuracy: 0.35 },
  );
  const profile = classifyStudent(input);
  assert.equal(profile.masteryLevel, 'weak');
  assert.equal(profile.errorPattern, 'high');
  assert.equal(['failing', 'weak_overdue', 'regressing'].includes(profile.archetype), true);
});

test('EVIDENCE_GATE thresholds match the V6.3 contract', () => {
  assert.equal(EVIDENCE_GATE.minSampleSize, 5);
  assert.equal(EVIDENCE_GATE.minEffectSize, 0.05);
  assert.equal(EVIDENCE_GATE.requiredConfidence, 'medium');
});

test('ai-metrics effectiveness counters aggregate derivations and gate results', () => {
  const metrics = new AiMetricsService();
  metrics.recordEffectivenessDerivation({ surface: 'outcomes', nodesEvaluated: 4, gatePassed: 1, gateInsufficient: 3 });
  metrics.recordEffectivenessDerivation({ surface: 'outcomes', nodesEvaluated: 2, gatePassed: 0, gateInsufficient: 2 });
  metrics.recordEffectivenessDerivation({ surface: 'experiments', nodesEvaluated: 2, gatePassed: 0, gateInsufficient: 2 });
  const snapshot = metrics.snapshotLearningIntelligence();
  assert.equal(snapshot.effectiveness.derivations, 3);
  assert.equal(snapshot.effectiveness.nodesEvaluated, 8);
  assert.equal(snapshot.effectiveness.gatePassed, 1);
  assert.equal(snapshot.effectiveness.gateInsufficient, 7);
  assert.equal(snapshot.effectiveness.bySurface.outcomes, 2);
  assert.equal(snapshot.effectiveness.bySurface.experiments, 1);
  metrics.reset();
  assert.equal(metrics.snapshotLearningIntelligence().effectiveness.derivations, 0);
});
