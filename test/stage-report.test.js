import test from 'node:test';
import assert from 'node:assert/strict';
import { computeStageReport } from '../packages/shared/dist/stageReport.js';

const asOf = '2026-08-05';
const timeZone = 'UTC';

function record(submittedAt, correct) {
  return {
    submittedAt,
    correct,
    knowledgePointId: 'co-cache',
    timeSpentSec: 60,
    expectedTimeSec: 100,
  };
}

function baseInput(overrides = {}) {
  return {
    records: [],
    assessments: [],
    masteryPoints: [],
    wrongSummary: { pendingCount: 0, reviewedCount: 0, resolvedCount: 0, totalWrongCount: 0 },
    streakDays: 0,
    windowDays: 7,
    timeZone,
    asOf,
    ...overrides,
  };
}

test('empty inputs produce an insufficient verdict without crashing', () => {
  const report = computeStageReport(baseInput());
  assert.equal(report.verdict, 'insufficient');
  assert.equal(report.current.answeredCount, 0);
  assert.equal(report.current.accuracyRate, null);
  assert.equal(report.accuracyDelta, null);
  assert.equal(report.assessmentTrend.latestScore, null);
  assert.match(report.summary, /本阶段暂无答题记录/);
  assert.match(report.nextAction, /今日推荐练习/);
});

test('records only in the current window establish a baseline', () => {
  const report = computeStageReport(baseInput({
    records: [
      record('2026-08-03T10:00:00.000Z', true),
      record('2026-08-02T10:00:00.000Z', false),
    ],
  }));
  assert.equal(report.current.answeredCount, 2);
  assert.equal(report.current.correctCount, 1);
  assert.equal(report.current.accuracyRate, 50);
  assert.equal(report.current.activeDays, 2);
  assert.equal(report.previous.answeredCount, 0);
  assert.equal(report.accuracyDelta, null);
  assert.equal(report.verdict, 'insufficient');
  assert.match(report.summary, /已建立学习基线/);
});

test('records in both windows compute an improved accuracy delta', () => {
  const report = computeStageReport(baseInput({
    records: [
      record('2026-07-25T10:00:00.000Z', false),
      record('2026-07-25T11:00:00.000Z', true),
      record('2026-08-03T10:00:00.000Z', true),
      record('2026-08-02T10:00:00.000Z', true),
      record('2026-07-20T10:00:00.000Z', true),
    ],
  }));
  assert.equal(report.previous.answeredCount, 2);
  assert.equal(report.previous.accuracyRate, 50);
  assert.equal(report.current.accuracyRate, 100);
  assert.equal(report.accuracyDelta, 50);
  assert.equal(report.answeredDelta, 0);
  assert.equal(report.activeDayDelta, 1);
  assert.equal(report.verdict, 'improved');
  assert.match(report.summary, /\+50 个百分点/);
});

test('a negative accuracy delta is reported as declined', () => {
  const report = computeStageReport(baseInput({
    records: [
      record('2026-07-25T10:00:00.000Z', true),
      record('2026-07-25T11:00:00.000Z', true),
      record('2026-08-03T10:00:00.000Z', false),
      record('2026-08-02T10:00:00.000Z', false),
    ],
  }));
  assert.equal(report.accuracyDelta, -100);
  assert.equal(report.verdict, 'declined');
});

test('a small accuracy delta is steady', () => {
  const report = computeStageReport(baseInput({
    records: [
      record('2026-07-25T10:00:00.000Z', false),
      record('2026-07-25T11:00:00.000Z', true),
      record('2026-08-03T10:00:00.000Z', false),
      record('2026-08-02T10:00:00.000Z', true),
    ],
  }));
  assert.equal(report.accuracyDelta, 0);
  assert.equal(report.verdict, 'steady');
});

test('assessments drive the trend when there are no practice records', () => {
  const report = computeStageReport(baseInput({
    assessments: [
      { submittedAt: '2026-07-20T00:00:00.000Z', score: 55, accuracyRate: 55 },
      { submittedAt: '2026-08-01T00:00:00.000Z', score: 72, accuracyRate: 72 },
    ],
  }));
  assert.equal(report.assessmentTrend.latestScore, 72);
  assert.equal(report.assessmentTrend.previousScore, 55);
  assert.equal(report.assessmentTrend.delta, 17);
  assert.equal(report.verdict, 'improved');
});

test('mastery aggregation ranks the weakest points first', () => {
  const report = computeStageReport(baseInput({
    masteryPoints: [
      { knowledgePointId: 'a', title: 'A 点', subject: '数据结构', masteryRate: 80, status: 'review' },
      { knowledgePointId: 'b', title: 'B 点', subject: '操作系统', masteryRate: 40, status: 'weak' },
      { knowledgePointId: 'c', title: 'C 点', subject: '计算机网络', masteryRate: 90, status: 'mastered' },
      { knowledgePointId: 'd', title: 'D 点', subject: '计算机组成原理', masteryRate: 50, status: 'weak' },
    ],
  }));
  assert.equal(report.mastery.masteredCount, 1);
  assert.equal(report.mastery.reviewCount, 1);
  assert.equal(report.mastery.weakCount, 2);
  assert.deepEqual(report.mastery.weakestPoints.map((point) => point.knowledgePointId), ['b', 'd', 'a']);
  assert.match(report.nextAction, /优先补强 B 点/);
});

test('wrong-question summary resolves the review rate', () => {
  const report = computeStageReport(baseInput({
    wrongSummary: { pendingCount: 3, reviewedCount: 2, resolvedCount: 7, totalWrongCount: 10 },
  }));
  assert.equal(report.wrong.pendingCount, 3);
  assert.equal(report.wrong.resolvedCount, 7);
  assert.equal(report.wrong.resolvedRate, 70);
  assert.match(report.nextAction, /先复盘 3 道待处理错题/);
});

test('window boundaries include the start date and exclude older records', () => {
  const report = computeStageReport(baseInput({
    records: [
      record('2026-07-30T23:59:00.000Z', true),
      record('2026-07-29T23:59:00.000Z', true),
      record('2026-07-23T00:00:00.000Z', true),
      record('2026-07-22T23:59:00.000Z', true),
    ],
  }));
  assert.equal(report.current.answeredCount, 1);
  assert.equal(report.previous.answeredCount, 2);
});

test('window days are clamped to a supported range', () => {
  const clampedLow = computeStageReport(baseInput({ windowDays: 0 }));
  const clampedHigh = computeStageReport(baseInput({ windowDays: 500 }));
  assert.equal(clampedLow.windowDays, 1);
  assert.equal(clampedHigh.windowDays, 90);
});
