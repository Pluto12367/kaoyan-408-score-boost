import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadAdapter() {
  const path = 'apps/web/src/features/student/report/reportWorkspaceContextAdapter.ts';
  const input = readFileSync(path, 'utf8');
  const output = ts.transpileModule(input, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('module', 'exports', output)(module, module.exports);
  return module.exports;
}

function trend(window, value, baseline, sampleSize, status = 'sufficient') {
  return { window, value, baseline, sampleSize, status };
}

function context(overrides = {}) {
  return {
    version: 'student-context-v1',
    userId: 'u-1',
    asOf: '2026-09-03T08:00:00.000Z',
    freshness: { asOf: '2026-09-03T08:00:00.000Z', status: 'sufficient', sources: [] },
    profile: { userId: 'u-1', name: '小明', role: 'STUDENT', targetSchool: 'BUPT', weakestSubject: '操作系统', diagnosis: null },
    exam: { examYear: 2027, targetScore: 120, currentScore: 80, remainingDays: 100, studyStage: '强化' },
    mastery: {
      source: 'user_knowledge_mastery',
      weakNodes: [
        { knowledgeNodeId: 'node-os', subject: '操作系统', chapter: '进程', title: '进程调度', mastery: 0.32, accuracy: 0.4, attempts: 5, wrongCount: 3, status: 'weak', updatedAt: '2026-09-02T08:00:00.000Z' },
        { knowledgeNodeId: 'node-co', subject: '计算机组成原理', chapter: '存储', title: 'Cache', mastery: 0.45, accuracy: 0.5, attempts: 3, wrongCount: 2, status: 'weak', updatedAt: '2026-09-02T08:00:00.000Z' },
      ],
      weakPoints: [{ knowledgePointId: 'point-os', subject: '操作系统', chapter: '进程', title: '进程基础', attempts: 5, wrongCount: 3, accuracy: 0.4, latestAt: '2026-09-02T08:00:00.000Z' }],
      improvingPoints: [{ knowledgeNodeId: 'node-ds', subject: '数据结构', chapter: '线性表', title: '链表', mastery: 0.72, accuracy: 0.8, attempts: 8, wrongCount: 1, status: 'improving', updatedAt: '2026-09-02T08:00:00.000Z' }],
      masteredPoints: [{ knowledgeNodeId: 'node-net', subject: '计算机网络', chapter: 'TCP', title: '可靠传输', mastery: 0.9, accuracy: 0.95, attempts: 10, wrongCount: 0, status: 'mastered', updatedAt: '2026-09-02T08:00:00.000Z' }],
      lastUpdatedAt: '2026-09-02T08:00:00.000Z',
    },
    practice: {
      source: 'practice_record',
      recentAccuracy: trend('last7d', 0.75, 0.6, 4),
      recentVolume: trend('last7d', 12, 8, 12),
      subjectDistribution: { status: 'sufficient', items: [] },
      totalCount: 12,
      latestSubmittedAt: '2026-09-03T07:00:00.000Z',
    },
    review: { source: 'review_schedule', dueCount: 3, overdueCount: 1, reviewedCount: 2, resolvedCount: 1, highRiskQuestions: [], nextReviewAt: null },
    plan: {
      source: 'study_plan',
      planId: 'plan-1',
      todayTasks: [
        { studyTaskId: 'task-1', actionId: 'action-1', title: '进程训练', status: 'pending', scheduledDate: '2026-09-03', completed: false, completedAt: null, knowledgePointId: 'point-os', knowledgeNodeId: 'node-os', minutes: 30, questionCount: 10 },
        { studyTaskId: 'task-2', actionId: null, title: '链表复习', status: 'completed', scheduledDate: '2026-09-03', completed: true, completedAt: '2026-09-03T06:00:00.000Z', knowledgePointId: null, knowledgeNodeId: 'node-ds', minutes: 20, questionCount: 6 },
      ],
      completion: { completedCount: 1, totalCount: 3, rate: trend('last7d', 1 / 3, 0.2, 3) },
    },
    momentum: { studyStreak: 4, recentSessions: [], activityTrend: trend('last7d', 5, 3, 4) },
    recommendationEvidence: [{ source: 'recommendation_action', timestamp: '2026-09-02T08:00:00.000Z', actionId: 'action-1', studyTaskId: 'task-1' }],
    ...overrides,
  };
}

function emptyContext(overrides = {}) {
  return context({
    freshness: { asOf: '2026-09-03T08:00:00.000Z', status: 'insufficient_data', sources: [] },
    mastery: { source: 'empty', weakNodes: [], weakPoints: [], improvingPoints: [], masteredPoints: [], lastUpdatedAt: null },
    practice: {
      source: 'empty', recentAccuracy: trend('last7d', null, null, 0, 'insufficient_data'), recentVolume: trend('last7d', null, null, 0, 'insufficient_data'),
      subjectDistribution: { status: 'insufficient_data', items: [] }, totalCount: 0, latestSubmittedAt: null,
    },
    review: { source: 'empty', dueCount: 0, overdueCount: 0, reviewedCount: 0, resolvedCount: 0, highRiskQuestions: [], nextReviewAt: null },
    plan: { source: 'empty', planId: null, todayTasks: [], completion: { completedCount: 0, totalCount: 0, rate: trend('last7d', null, null, 0, 'insufficient_data') } },
    momentum: { studyStreak: 0, recentSessions: [], activityTrend: trend('last7d', null, null, 0, 'insufficient_data') },
    ...overrides,
  });
}

test('adapter maps mastery summary preserving knowledgeNodeId and separating Point weakness', () => {
  const { toReportWorkspaceSummary } = loadAdapter();
  const summary = toReportWorkspaceSummary(context());

  assert.equal(summary.mastery.averageMastery, 60);
  assert.equal(summary.mastery.weakNodes.length, 2);
  assert.equal(summary.mastery.weakNodes[0].knowledgeNodeId, 'node-os');
  assert.equal(summary.mastery.counts.weak, 2);
  assert.equal('knowledgePointId' in summary.mastery.weakNodes[0], false);
  // Point-level weakness stays out of the mastery summary.
  assert.ok(!('weakPoints' in summary.mastery));
});

test('adapter maps practice summary with window and sample size', () => {
  const { toReportWorkspaceSummary } = loadAdapter();
  const summary = toReportWorkspaceSummary(context());

  assert.equal(summary.practice.recentAccuracy, 75);
  assert.equal(summary.practice.recentVolume, 12);
  assert.equal(summary.practice.window, 'last7d');
  assert.equal(summary.practice.sampleSize, 4);
  assert.equal(summary.practice.status, 'sufficient');
});

test('adapter maps review summary from existing fields only', () => {
  const { toReportWorkspaceSummary } = loadAdapter();
  const summary = toReportWorkspaceSummary(context());

  assert.equal(summary.review.dueCount, 3);
  assert.equal(summary.review.overdueCount, 1);
  assert.equal(summary.review.status, 'sufficient');
  // pendingWrongQuestionCount is NOT invented — StudentContext does not carry it.
  assert.ok(!('pendingWrongQuestionCount' in summary.review));
});

test('adapter maps today plan summary', () => {
  const { toReportWorkspaceSummary } = loadAdapter();
  const summary = toReportWorkspaceSummary(context());

  assert.equal(summary.plan.completedTaskCount, 1);
  assert.equal(summary.plan.totalTaskCount, 3);
  assert.equal(summary.plan.completionRate, 33);
  assert.equal(summary.plan.status, 'sufficient');
  assert.equal(summary.plan.todayTaskCount, 2);
});

test('adapter maps momentum/streak', () => {
  const { toReportWorkspaceSummary } = loadAdapter();
  const summary = toReportWorkspaceSummary(context());

  assert.equal(summary.momentum.studyStreak, 4);
  assert.equal(summary.momentum.activityTrend.value, 5);
  assert.equal(summary.momentum.status, 'sufficient');
});

test('adapter preserves insufficient_data instead of manufacturing zeroes', () => {
  const { toReportWorkspaceSummary } = loadAdapter();
  const summary = toReportWorkspaceSummary(emptyContext());

  assert.equal(summary.status, 'insufficient_data');
  assert.equal(summary.mastery.averageMastery, null);
  assert.equal(summary.practice.recentAccuracy, null);
  assert.equal(summary.review.dueCount, null);
  assert.equal(summary.plan.completionRate, null);
  assert.equal(summary.momentum.studyStreak, null);
});

test('adapter treats empty source as insufficient while preserving zero counts as facts', () => {
  const { toReportWorkspaceSummary } = loadAdapter();
  const summary = toReportWorkspaceSummary(emptyContext());

  // Zero counts are facts but the metric/status is insufficient.
  assert.equal(summary.mastery.counts.weak, 0);
  assert.equal(summary.plan.todayTaskCount, 0);
  assert.equal(summary.practice.recentAccuracy, null);
  assert.equal(summary.review.dueCount, null);
});

test('adapter preserves null semantics when trend value is absent', () => {
  const { toReportWorkspaceSummary } = loadAdapter();
  const summary = toReportWorkspaceSummary(context({
    practice: {
      source: 'practice_record', recentAccuracy: trend('last7d', null, null, 0, 'insufficient_data'), recentVolume: trend('last7d', null, null, 0, 'insufficient_data'),
      subjectDistribution: { status: 'insufficient_data', items: [] }, totalCount: 0, latestSubmittedAt: null,
    },
  }));

  assert.equal(summary.practice.recentAccuracy, null);
  assert.equal(summary.practice.status, 'insufficient_data');
});

test('adapter carries asOf and the canonical window untouched', () => {
  const { toReportWorkspaceSummary } = loadAdapter();
  const input = context();
  const summary = toReportWorkspaceSummary(input);

  assert.equal(summary.asOf, input.asOf);
  assert.equal(summary.practice.window, 'last7d');
});

test('adapter does not mix Action/Task identities', () => {
  const { toReportWorkspaceSummary } = loadAdapter();
  const summary = toReportWorkspaceSummary(context());

  // Summary carries task counts; it must not collapse actionId into studyTaskId.
  assert.equal(summary.plan.todayTaskCount, 2);
  assert.ok(!('actionId' in summary.plan));
  assert.ok(!('studyTaskId' in summary.plan));
});

test('adapter never contaminates Node mastery with legacy Node-as-Point identity', () => {
  const { toReportWorkspaceSummary } = loadAdapter();
  const summary = toReportWorkspaceSummary(context());

  for (const node of summary.mastery.weakNodes) {
    assert.ok(!('knowledgePointId' in node));
    assert.ok(node.knowledgeNodeId);
  }
});

test('adapter is deterministic and does not read clock or environment state', () => {
  const { toReportWorkspaceSummary } = loadAdapter();
  const input = context();
  assert.deepEqual(toReportWorkspaceSummary(input), toReportWorkspaceSummary(input));

  const source = readFileSync('apps/web/src/features/student/report/reportWorkspaceContextAdapter.ts', 'utf8');
  assert.doesNotMatch(source, /Date\.now\(\)|new Date\(/);
  assert.doesNotMatch(source, /process\.env|fetch\(|prisma|axios/i);
});

test('legacy-only report analysis fields remain unmapped by the adapter', () => {
  const { toReportWorkspaceSummary } = loadAdapter();
  const summary = toReportWorkspaceSummary(context());

  assert.ok(!('weaknessReport' in summary));
  assert.ok(!('stageReport' in summary));
  assert.ok(!('assessmentHistory' in summary));
  assert.ok(!('masteryTrend' in summary));
  assert.ok(!('learningProfile' in summary));
  assert.ok(!('reviewResources' in summary));
  assert.ok(!('sprintPlan' in summary));
  assert.ok(!('trialProgress' in summary));
});

test('adapter does not create or mutate domain entities', () => {
  const { toReportWorkspaceSummary } = loadAdapter();
  const input = context();
  const before = JSON.stringify(input);
  toReportWorkspaceSummary(input);
  assert.equal(JSON.stringify(input), before);
});
