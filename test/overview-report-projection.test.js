import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('projection keeps node mastery and point practice weakness in separate id spaces', () => {
  const { buildOverviewReportProjection } = require('../apps/api/src/study/overview-report-projection.service.ts');
  const report = buildOverviewReportProjection(facts());

  assert.equal(report.contractVersion, 'overview-report-v1');
  assert.equal(report.mastery.nodes[0].knowledgeNodeId, 'node-memory');
  assert.equal(report.weaknesses.nodeWeaknesses[0].knowledgeNodeId, 'node-memory');
  assert.equal(report.weaknesses.practiceWeaknesses[0].knowledgePointId, 'point-cache');
  assert.ok(!JSON.stringify(report.mastery).includes('knowledgePointId'));
  assert.ok(!JSON.stringify(report.weaknesses.nodeWeaknesses).includes('knowledgePointId'));
  assert.ok(!JSON.stringify(report.weaknesses.practiceWeaknesses).includes('knowledgeNodeId'));
});

test('projection exposes explicit windows, baseline, sample size and insufficient data', () => {
  const { buildOverviewReportProjection } = require('../apps/api/src/study/overview-report-projection.service.ts');
  const report = buildOverviewReportProjection(facts());

  const progress = report.practicePerformance;
  assert.equal(progress.last7d.window.key, 'last7d');
  assert.equal(typeof progress.last7d.window.fromInclusive, 'string');
  assert.equal(typeof progress.last7d.window.toExclusive, 'string');
  assert.equal(progress.last7d.attemptCount, 1);
  assert.equal(progress.last7d.dataStatus, 'ready');
  assert.equal(report.progress.last7d.sampleSize, 1);
  assert.equal(report.progress.last7d.status, 'insufficient_data');
  assert.equal(report.progress.last7d.baseline, null);
  assert.equal(report.progress.assessmentScore.status, 'insufficient_data');
  assert.equal(report.assessmentPerformance.trend, 'insufficient_data');
});

test('projection assembles typed evidence and preserves recommendation output without recalculation', () => {
  const { buildOverviewReportProjection } = require('../apps/api/src/study/overview-report-projection.service.ts');
  const report = buildOverviewReportProjection(facts());

  assert.deepEqual(report.weaknesses.practiceWeaknesses[0].evidence, [
    { kind: 'practice_record', id: 'record-1', idType: 'knowledgePointId', knowledgePointId: 'point-cache' },
  ]);
  assert.deepEqual(report.recommendedActions[0], {
    actionId: 'task-1',
    actionType: 'practice',
    title: '练习 Cache',
    reasonCodes: ['weak_mastery'],
    target: { knowledgeNodeId: 'node-memory', knowledgePointId: 'point-cache', studyTaskId: 'task-1' },
    source: 'study_task',
    evidence: [{ kind: 'study_task', id: 'task-1', idType: 'studyTaskId' }],
    status: 'available',
  });
});

test('projection is deterministic for the same input and does not manufacture empty mastery', () => {
  const { buildOverviewReportProjection } = require('../apps/api/src/study/overview-report-projection.service.ts');
  const input = facts({ masteryRows: [], assessments: [], practiceRecords: [] });
  const first = buildOverviewReportProjection(input);
  const second = buildOverviewReportProjection(input);

  assert.deepEqual(first, second);
  assert.equal(first.mastery.source, 'empty');
  assert.equal(first.mastery.averageMastery, null);
  assert.equal(first.practicePerformance.last30d.accuracyRate, null);
  assert.equal(first.practicePerformance.last30d.dataStatus, 'insufficient_data');
  assert.equal(first.progress.last30d.current, null);
  assert.equal(first.progress.last30d.status, 'insufficient_data');
});

test('projection keeps speed risks and review status read-only and typed', () => {
  const { buildOverviewReportProjection } = require('../apps/api/src/study/overview-report-projection.service.ts');
  const report = buildOverviewReportProjection(facts({
    practiceRecords: [{ id: 'fast-1', questionId: 'q-1', knowledgePointId: 'point-cache', submittedAt: '2026-09-01T09:00:00.000Z', correct: true, timeSpentSec: 200, expectedTimeSec: 100, mistakeReason: null }],
    review: { dueCount: 2, todayDueCount: 1, overdueCount: 1, pendingWrongQuestionCount: 2, reviewedWrongQuestionCount: 1, resolvedWrongQuestionCount: 1, reviewAttemptCount: 3, nextReviewAt: '2026-09-02T10:00:00.000Z', evidence: [{ kind: 'review_schedule', id: 'schedule-1' }] },
  }));

  assert.equal(report.weaknesses.speedRisks[0].knowledgePointId, 'point-cache');
  assert.equal(report.weaknesses.speedRisks[0].slowCount, 1);
  assert.equal(report.reviewStatus.todayDueCount, 1);
  assert.equal(report.reviewStatus.overdueCount, 1);
  assert.equal(report.reviewStatus.evidence[0].kind, 'review_schedule');
});

test('assessment trend is independent from practice accuracy and requires two samples', () => {
  const { buildOverviewReportProjection } = require('../apps/api/src/study/overview-report-projection.service.ts');
  const report = buildOverviewReportProjection(facts({
    assessments: [
      { id: 'assessment-2', sessionId: 'session-2', score: 82, accuracyRate: 82, submittedAt: '2026-08-31T10:00:00.000Z' },
      { id: 'assessment-1', sessionId: 'session-1', score: 70, accuracyRate: 70, submittedAt: '2026-08-20T10:00:00.000Z' },
    ],
  }));
  assert.equal(report.assessmentPerformance.latest.score, 82);
  assert.equal(report.assessmentPerformance.previous.score, 70);
  assert.equal(report.assessmentPerformance.trend, 'up');
  assert.equal(report.assessmentPerformance.sampleSize, 2);
  assert.equal(report.assessmentPerformance.evidence[0].idType, 'assessmentId');
});

function facts(overrides = {}) {
  return {
    userId: 'user-1',
    asOf: '2026-09-01T12:00:00.000Z',
    goalFacts: {
      targetScore: 120,
      currentScore: 90,
      remainingDays: 60,
      studyStage: '强化',
      weakestSubject: '操作系统',
    },
    practiceRecords: [{
      id: 'record-1',
      questionId: 'question-1',
      knowledgePointId: 'point-cache',
      submittedAt: '2026-09-01T08:00:00.000Z',
      correct: false,
      timeSpentSec: 220,
      expectedTimeSec: 100,
      mistakeReason: '概念混淆',
    }],
    knowledgePoints: [{
      id: 'point-cache',
      subject: '计算机组成原理',
      chapter: '存储系统',
      title: 'Cache',
      importance: 5,
      frequency: 4,
      prerequisites: [],
    }],
    masteryRows: [{
      id: 'mastery-1',
      knowledgeNodeId: 'node-memory',
      title: 'Cache 基本原理',
      subject: '计算机组成原理',
      chapter: '存储系统',
      masteryRate: 35,
      accuracyRate: 0,
      attempts: 1,
      wrongCount: 1,
      status: 'weak',
      updatedAt: '2026-09-01T08:01:00.000Z',
    }],
    assessments: [],
    review: {
      dueCount: 1,
      overdueCount: 0,
      pendingWrongQuestionCount: 1,
      reviewedWrongQuestionCount: 0,
      resolvedWrongQuestionCount: 0,
      reviewAttemptCount: 0,
      nextReviewAt: '2026-09-01T10:00:00.000Z',
      evidence: [],
    },
    actions: [{
      id: 'task-1',
      actionType: 'practice',
      title: '练习 Cache',
      reasonCodes: ['weak_mastery'],
      knowledgeNodeId: 'node-memory',
      knowledgePointId: 'point-cache',
      status: 'available',
    }],
    ...overrides,
  };
}
