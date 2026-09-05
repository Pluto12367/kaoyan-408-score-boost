import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

function loadSelector() {
  try {
    return require('../apps/api/src/study/student-context.selector.ts');
  } catch (_error) {
    return null;
  }
}

const asOf = '2026-08-24T08:00:00.000Z';
const windows = {
  last7d: {
    startAt: '2026-08-18T00:00:00.000Z',
    endAt: asOf,
    baselineStartAt: '2026-08-11T00:00:00.000Z',
    baselineEndAt: '2026-08-18T00:00:00.000Z',
  },
  last30d: {
    startAt: '2026-07-26T00:00:00.000Z',
    endAt: asOf,
    baselineStartAt: '2026-06-27T00:00:00.000Z',
    baselineEndAt: '2026-07-26T00:00:00.000Z',
  },
  activity: {
    startAt: '2026-08-18T00:00:00.000Z',
    endAt: asOf,
    baselineStartAt: '2026-08-11T00:00:00.000Z',
    baselineEndAt: '2026-08-18T00:00:00.000Z',
  },
};

function emptyFacts() {
  return {
    user: null,
    masteryNodes: [],
    practiceRecords: [],
    reviewItems: [],
    tasks: [],
    sessions: [],
    activityDays: [],
    recommendationEvidence: [],
  };
}

function build(facts = emptyFacts(), overrides = {}) {
  const selector = loadSelector();
  assert.ok(selector, 'StudentContext selector module must exist');
  return selector.buildStudentContext({
    userId: 'u-1',
    asOf,
    todayDate: '2026-08-24',
    windows,
    sourceFacts: facts,
    ...overrides,
  });
}

test('empty source facts produce the complete StudentContext shape without fake trends', () => {
  const context = build();

  assert.equal(context.version, 'student-context-v1');
  assert.deepEqual(Object.keys(context).sort(), [
    'asOf', 'exam', 'freshness', 'mastery', 'momentum', 'plan', 'practice',
    'profile', 'recommendationEvidence', 'review', 'userId', 'version',
  ].sort());
  assert.equal(context.mastery.source, 'empty');
  assert.equal(context.mastery.weakNodes.length, 0);
  assert.equal(context.practice.recentAccuracy.status, 'insufficient_data');
  assert.equal(context.practice.recentAccuracy.value, null);
  assert.equal(context.practice.recentVolume.sampleSize, 0);
  assert.equal(context.plan.completion.rate.value, null);
  assert.equal(context.momentum.activityTrend.value, null);
});

test('selector keeps node mastery and point practice weakness in separate identity spaces', () => {
  const context = build({
    ...emptyFacts(),
    masteryNodes: [
      { knowledgeNodeId: 'node-os-process', subject: '操作系统', chapter: '进程', title: '调度', mastery: 0.32, accuracy: 0.25, attempts: 4, wrongCount: 3, status: 'weak', updatedAt: '2026-08-23T01:00:00.000Z' },
      { knowledgeNodeId: 'node-ds-list', subject: '数据结构', chapter: '线性表', title: '链表', mastery: 0.86, accuracy: 0.9, attempts: 10, wrongCount: 1, status: 'mastered', updatedAt: '2026-08-22T01:00:00.000Z' },
    ],
    practiceRecords: [
      { id: 'p-1', knowledgePointId: 'point-process', subject: '操作系统', chapter: '进程', submittedAt: '2026-08-23T01:00:00.000Z', correct: false, timeSpentSec: 90, mistakeReason: '概念不清' },
      { id: 'p-2', knowledgePointId: 'point-process', subject: '操作系统', chapter: '进程', submittedAt: '2026-08-20T01:00:00.000Z', correct: true, timeSpentSec: 70, mistakeReason: null },
    ],
  });

  assert.equal(context.mastery.weakNodes[0].knowledgeNodeId, 'node-os-process');
  assert.equal(context.mastery.weakPoints[0].knowledgePointId, 'point-process');
  assert.equal(context.mastery.improvingPoints.length, 0);
  assert.equal(context.mastery.masteredPoints[0].knowledgeNodeId, 'node-ds-list');
  assert.equal('knowledgePointId' in context.mastery.weakNodes[0], false);
  assert.equal('knowledgeNodeId' in context.mastery.weakPoints[0], false);
});

test('selector exposes practice, review, plan, momentum, and evidence facts', () => {
  const context = build({
    user: { name: '小明', role: 'STUDENT', targetSchool: 'BUPT', weakestSubject: '操作系统', diagnosis: '进程薄弱', examYear: 2027, targetScore: 120, currentScore: 80, remainingDays: 100, studyStage: '强化' },
    masteryNodes: [
      { knowledgeNodeId: 'node-1', subject: '操作系统', chapter: '进程', title: '调度', mastery: 0.4, accuracy: 0.5, attempts: 2, wrongCount: 1, status: 'review', updatedAt: '2026-08-23T01:00:00.000Z' },
    ],
    practiceRecords: [
      { id: 'p-old', knowledgePointId: 'point-1', subject: '操作系统', chapter: '进程', submittedAt: '2026-08-17T01:00:00.000Z', correct: false, timeSpentSec: 100, mistakeReason: '概念不清' },
      { id: 'p-new', knowledgePointId: 'point-1', subject: '操作系统', chapter: '进程', submittedAt: '2026-08-23T01:00:00.000Z', correct: true, timeSpentSec: 80, mistakeReason: null },
    ],
    reviewItems: [
      { questionId: 'q-1', knowledgePointId: 'point-1', dueAt: '2026-08-23T00:00:00.000Z', overdue: true, wrongCount: 3, stability: 'learning' },
      { questionId: 'q-2', knowledgePointId: 'point-2', dueAt: '2026-08-24T12:00:00.000Z', overdue: false, wrongCount: 1, stability: 'review' },
    ],
    tasks: [
      { studyTaskId: 'task-1', actionId: 'action-1', title: '进程训练', status: 'completed', scheduledDate: '2026-08-24', completed: true, completedAt: '2026-08-24T02:00:00.000Z', knowledgePointId: 'point-1', knowledgeNodeId: 'node-1', minutes: 30, questionCount: 10 },
    ],
    sessions: [
      { learningSessionId: 'session-1', actionId: 'action-1', type: 'practice_set', startedAt: '2026-08-23T01:00:00.000Z', lastActiveAt: '2026-08-23T01:30:00.000Z', completed: true },
    ],
    activityDays: [
      { date: '2026-08-23', completedTaskCount: 0, practiceCount: 1, isActive: true },
      { date: '2026-08-24', completedTaskCount: 1, practiceCount: 0, isActive: true },
    ],
    recommendationEvidence: [
      { source: 'recommendation_action', timestamp: '2026-08-23T01:00:00.000Z', actionId: 'action-1', studyTaskId: 'task-1', knowledgeNodeId: 'node-1', referenceId: 'action-1' },
    ],
  });

  assert.equal(context.profile.userId, 'u-1');
  assert.equal(context.exam.targetScore, 120);
  assert.equal(context.practice.recentAccuracy.value, 1);
  assert.equal(context.practice.recentAccuracy.sampleSize, 1);
  assert.equal(context.review.dueCount, 1);
  assert.equal(context.review.overdueCount, 1);
  assert.equal(context.review.highRiskQuestions[0].questionId, 'q-1');
  assert.equal(context.plan.todayTasks[0].studyTaskId, 'task-1');
  assert.equal(context.plan.todayTasks[0].actionId, 'action-1');
  assert.equal(context.momentum.recentSessions[0].learningSessionId, 'session-1');
  assert.equal(context.momentum.studyStreak, 2);
  assert.equal(context.recommendationEvidence[0].actionId, 'action-1');
});

test('same source facts and asOf are deterministic, while changing asOf changes the selected window', () => {
  const facts = {
    ...emptyFacts(),
    practiceRecords: [
      { id: 'p-baseline', knowledgePointId: 'point-1', submittedAt: '2026-08-17T01:00:00.000Z', correct: false, timeSpentSec: 35, mistakeReason: '概念不清' },
      { id: 'p-1', knowledgePointId: 'point-1', submittedAt: '2026-08-23T01:00:00.000Z', correct: true, timeSpentSec: 30, mistakeReason: null },
    ],
  };
  const first = build(facts);
  const second = build(facts);
  assert.deepEqual(second, first);

  const later = build(facts, {
    asOf: '2026-08-30T08:00:00.000Z',
    todayDate: '2026-08-30',
    windows: {
      last7d: { startAt: '2026-08-24T00:00:00.000Z', endAt: '2026-08-30T08:00:00.000Z', baselineStartAt: '2026-08-17T00:00:00.000Z', baselineEndAt: '2026-08-24T00:00:00.000Z' },
      last30d: { startAt: '2026-08-01T00:00:00.000Z', endAt: '2026-08-30T08:00:00.000Z', baselineStartAt: '2026-07-02T00:00:00.000Z', baselineEndAt: '2026-08-01T00:00:00.000Z' },
      activity: { startAt: '2026-08-24T00:00:00.000Z', endAt: '2026-08-30T08:00:00.000Z', baselineStartAt: '2026-08-17T00:00:00.000Z', baselineEndAt: '2026-08-24T00:00:00.000Z' },
    },
  });
  assert.equal(first.practice.recentAccuracy.value, 1);
  assert.equal(later.practice.recentAccuracy.value, null);
  assert.equal(later.practice.recentAccuracy.status, 'insufficient_data');
});

test('selector does not read the system clock or create its own time boundary', async () => {
  const source = await readFile(new URL('../apps/api/src/study/student-context.selector.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /Date\.now|new Date\s*\(/);
});

// ---- P-1 contract hardening: review-stage nodes must not vanish from buckets ----

function p1Node(id, mastery, attempts, overrides = {}) {
  return {
    knowledgeNodeId: id,
    subject: '操作系统',
    chapter: '进程',
    title: `节点-${id}`,
    mastery,
    attempts,
    wrongCount: Math.min(1, attempts),
    correctCount: attempts - Math.min(1, attempts),
    updatedAt: '2026-08-23T01:00:00.000Z',
    ...overrides,
  };
}

test('P-1: review-stage mastery nodes are bucketed into improvingPoints', () => {
  const context = build({
    ...emptyFacts(),
    masteryNodes: [
      p1Node('n-weak', 0.32, 4),
      p1Node('n-review', 0.6, 6), // 0.45 <= mastery < 0.75 -> deriveMasteryStatus 'review'
      p1Node('n-mastered', 0.9, 10),
    ],
  });

  assert.deepEqual(context.mastery.weakNodes.map((node) => node.knowledgeNodeId), ['n-weak']);
  assert.equal(context.mastery.improvingPoints.length, 1);
  assert.equal(context.mastery.improvingPoints[0].knowledgeNodeId, 'n-review');
  assert.deepEqual(context.mastery.masteredPoints.map((node) => node.knowledgeNodeId), ['n-mastered']);
  // Node identity is preserved inside the bucket.
  assert.equal('knowledgePointId' in context.mastery.improvingPoints[0], false);
});

test('P-1: untouched nodes stay hidden from every mastery bucket', () => {
  const context = build({
    ...emptyFacts(),
    masteryNodes: [p1Node('n-untouched', 0, 0)],
  });

  const bucketed = [
    ...context.mastery.weakNodes,
    ...context.mastery.improvingPoints,
    ...context.mastery.masteredPoints,
  ];
  assert.equal(bucketed.length, 0);
});

test('P-1: an explicit improving status stays compatible with the improvingPoints bucket', () => {
  const context = build({
    ...emptyFacts(),
    masteryNodes: [p1Node('n-explicit', 0.6, 6, { status: 'improving' })],
  });

  assert.equal(context.mastery.improvingPoints.length, 1);
  assert.equal(context.mastery.improvingPoints[0].knowledgeNodeId, 'n-explicit');
});

test('P-1: review nodes join the bucket union that consumer averageMastery is computed over', () => {
  // StudentHome / ReportWorkspace / Coach compute averageMastery over the
  // union of weakNodes + improvingPoints + masteredPoints; the review node
  // must participate in that basis.
  const context = build({
    ...emptyFacts(),
    masteryNodes: [
      p1Node('n-weak', 0.32, 4),
      p1Node('n-review', 0.6, 6),
      p1Node('n-mastered', 0.9, 10),
      p1Node('n-untouched', 0, 0),
    ],
  });

  const basis = [
    ...context.mastery.weakNodes,
    ...context.mastery.improvingPoints,
    ...context.mastery.masteredPoints,
  ].map((node) => node.knowledgeNodeId).sort();
  assert.deepEqual(basis, ['n-mastered', 'n-review', 'n-weak']);
});

// ---- SC-5 TASK 2: bounded payload sections ----

test('recommendationEvidence is a bounded provenance window of the 60 most recent rows', () => {
  const evidence = Array.from({ length: 80 }, (_, index) => ({
    source: 'recommendation_action',
    timestamp: new Date(new Date(asOf).getTime() - index * 3600000).toISOString(),
    actionId: `action-${index}`,
    referenceId: `action-${index}`,
  }));
  const context = build({ ...emptyFacts(), recommendationEvidence: evidence });

  assert.equal(context.recommendationEvidence.length, 60);
  // The window keeps the most recent rows (sorted desc by timestamp).
  assert.equal(context.recommendationEvidence[0].actionId, 'action-0');
  assert.equal(context.recommendationEvidence.at(-1).actionId, 'action-59');
});

test('Point practice weakness list is bounded to the top 20 by wrong count', () => {
  const practiceRecords = Array.from({ length: 25 }, (_, index) => ({
    id: `p-${index}`,
    knowledgePointId: `point-${String(index).padStart(2, '0')}`,
    subject: '操作系统',
    chapter: '进程',
    submittedAt: '2026-08-23T01:00:00.000Z',
    correct: false,
    timeSpentSec: 60,
    mistakeReason: '概念不清',
  }));
  // Give point-00 the most wrongs so the cap must keep it.
  practiceRecords.push(...Array.from({ length: 5 }, (_, i) => ({
    id: `p-extra-${i}`, knowledgePointId: 'point-00', subject: '操作系统', chapter: '进程',
    submittedAt: '2026-08-24T01:00:00.000Z', correct: false, timeSpentSec: 60, mistakeReason: '概念不清',
  })));
  const context = build({ ...emptyFacts(), practiceRecords });

  assert.equal(context.mastery.weakPoints.length, 20);
  assert.equal(context.mastery.weakPoints[0].knowledgePointId, 'point-00');
  assert.ok(context.mastery.weakPoints[0].wrongCount >= context.mastery.weakPoints[1].wrongCount);
});

test('bounded sections keep small-context output unchanged', () => {
  const context = build({
    ...emptyFacts(),
    recommendationEvidence: [{ source: 'recommendation_action', timestamp: asOf, actionId: 'action-1' }],
    practiceRecords: [
      { id: 'p-1', knowledgePointId: 'point-1', subject: '操作系统', chapter: '进程', submittedAt: '2026-08-23T01:00:00.000Z', correct: false, timeSpentSec: 60, mistakeReason: '概念不清' },
    ],
  });

  assert.equal(context.recommendationEvidence.length, 1);
  assert.equal(context.mastery.weakPoints.length, 1);
});

// ---- SC-5 TASK 3: malformed evidence must never fail the request ----

test('malformed evidence rows are dropped and object rows normalized without throwing', () => {
  const context = build({
    ...emptyFacts(),
    recommendationEvidence: [
      null,
      42,
      'garbage',
      { source: 'recommendation_action', timestamp: asOf, actionId: 'action-1' },
      { timestamp: asOf }, // missing source
      { source: 123, knowledgeNodeId: 'node-1' }, // invalid source type
    ],
  });

  // Non-object rows are dropped; the three object rows survive.
  assert.equal(context.recommendationEvidence.length, 3);
  assert.ok(context.recommendationEvidence.every((row) => typeof row.source === 'string'));
  const validRow = context.recommendationEvidence.find((row) => row.actionId === 'action-1');
  assert.equal(validRow.source, 'recommendation_action', 'valid source semantics preserved');
  const nodeRow = context.recommendationEvidence.find((row) => row.knowledgeNodeId === 'node-1');
  assert.ok(nodeRow, 'identity fields on rows with invalid source survive');
  const missingSource = context.recommendationEvidence.find((row) => !row.actionId && !row.knowledgeNodeId);
  assert.equal(missingSource.source, 'unknown', 'missing source is normalized to explicit unknown');
});

test('evidence rows only carry contract fields (defensive field whitelist)', () => {
  const context = build({
    ...emptyFacts(),
    recommendationEvidence: [
      { source: 'recommendation_action', timestamp: asOf, actionId: 'action-1', hackedField: 'x', nested: { a: 1 } },
    ],
  });

  const row = context.recommendationEvidence[0];
  assert.deepEqual(Object.keys(row).sort(), ['actionId', 'source', 'timestamp']);
});

test('empty evidence list stays empty without error', () => {
  const context = build();
  assert.deepEqual(context.recommendationEvidence, []);
});
