import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('fixture parity: canonical mastery preserves the legacy mastery fact value', () => {
  const report = projection(fixture());
  assert.equal(report.mastery.averageMastery, 64);
  assert.equal(report.mastery.nodes[0].knowledgeNodeId, 'node-os');
  assert.equal(report.mastery.nodes[0].knowledgeNodeId, fixture().legacy.masteryNodeId);
});

test('fixture parity: node and point weaknesses remain separate', () => {
  const report = projection(fixture());
  assert.equal(report.weaknesses.nodeWeaknesses[0].knowledgeNodeId, 'node-os');
  assert.equal(report.weaknesses.practiceWeaknesses[0].knowledgePointId, 'point-process');
  assert.notEqual(report.weaknesses.nodeWeaknesses[0].knowledgeNodeId, report.weaknesses.practiceWeaknesses[0].knowledgePointId);
});

test('fixture parity: shared last7d facts produce the same accuracy conclusion', () => {
  const report = projection(fixture());
  assert.equal(report.progress.last7d.current, 50);
  assert.equal(report.progress.last7d.sampleSize, 2);
  assert.equal(report.progress.last7d.status, 'insufficient_data');
  assert.equal(report.practicePerformance.last7d.accuracyRate, 50);
});

test('fixture parity: empty data stays insufficient instead of legacy zero', () => {
  const report = projection({ ...fixture(), practiceRecords: [], masteryRows: [], actions: [] });
  assert.equal(report.mastery.averageMastery, null);
  assert.equal(report.progress.last7d.current, null);
  assert.equal(report.progress.last7d.status, 'insufficient_data');
  assert.equal(report.recommendedActions.length, 0);
});

test('fixture parity: actions and evidence are preserved without recomputation', () => {
  const report = projection(fixture());
  assert.equal(report.recommendedActions[0].actionId, 'task-1');
  assert.equal(report.recommendedActions[0].target.knowledgeNodeId, 'node-os');
  assert.equal(report.recommendedActions[0].target.knowledgePointId, 'point-process');
  assert.ok(report.evidence.refs.some((ref) => ref.kind === 'practice_record' && ref.id === 'record-1'));
});

function projection(input) {
  return require('../apps/api/src/study/overview-report-projection.service.ts').buildOverviewReportProjection(input);
}

function fixture() {
  return {
    userId: 'u-1',
    asOf: '2026-09-02T12:00:00.000Z',
    legacy: { masteryNodeId: 'node-os' },
    goalFacts: { targetScore: 120, currentScore: 80, remainingDays: 90, studyStage: '强化', weakestSubject: '操作系统' },
    practiceRecords: [
      { id: 'record-1', questionId: 'q-1', knowledgePointId: 'point-process', submittedAt: '2026-09-02T08:00:00.000Z', correct: false, timeSpentSec: 120, expectedTimeSec: 60, mistakeReason: '概念混淆' },
      { id: 'record-2', questionId: 'q-2', knowledgePointId: 'point-process', submittedAt: '2026-09-01T08:00:00.000Z', correct: true, timeSpentSec: 50, expectedTimeSec: 60, mistakeReason: null },
    ],
    knowledgePoints: [{ id: 'point-process', subject: '操作系统', chapter: '进程管理', title: '进程同步', importance: 5, frequency: 5, prerequisites: [] }],
    masteryRows: [{ id: 'mastery-1', knowledgeNodeId: 'node-os', title: '进程同步', subject: '操作系统', chapter: '进程管理', masteryRate: 64, attempts: 4, correctCount: 3, wrongCount: 1, status: 'weak', updatedAt: '2026-09-02T08:00:00.000Z' }],
    assessments: [],
    review: { todayDueCount: 1, overdueCount: 0, pendingWrongQuestionCount: 1, reviewedWrongQuestionCount: 0, resolvedWrongQuestionCount: 0, reviewAttemptCount: 0, nextReviewAt: null, evidence: [] },
    actions: [{ id: 'task-1', actionType: 'practice', title: '巩固进程同步', reasonCodes: ['weak_mastery'], knowledgeNodeId: 'node-os', knowledgePointId: 'point-process', source: 'study_task', status: 'available' }],
  };
}
