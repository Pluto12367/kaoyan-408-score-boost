import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

function loadAdapter() {
  const path = 'apps/web/src/features/student/home/studentHomeContextAdapter.ts';
  const input = readFileSync(path, 'utf8');
  const output = ts.transpileModule(input, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('module', 'exports', output)(module, module.exports);
  return module.exports;
}

function loadViewModel(adapter) {
  const path = 'apps/web/src/features/student/home/useDashboardViewModel.ts';
  const input = readFileSync(path, 'utf8');
  const output = ts.transpileModule(input, {
    fileName: path,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    if (specifier === './studentHomeContextAdapter') return adapter;
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
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
      weakNodes: [{ knowledgeNodeId: 'node-os', subject: '操作系统', chapter: '进程', title: '进程调度', mastery: 0.32, accuracy: 0.4, attempts: 5, wrongCount: 3, status: 'weak', updatedAt: '2026-09-02T08:00:00.000Z' }],
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
      todayTasks: [{ studyTaskId: 'task-1', actionId: 'action-1', title: '进程训练', status: 'pending', scheduledDate: '2026-09-03', completed: false, completedAt: null, knowledgePointId: 'point-os', knowledgeNodeId: 'node-os', minutes: 30, questionCount: 10 }],
      completion: { completedCount: 1, totalCount: 3, rate: trend('last7d', 1 / 3, 0.2, 3) },
    },
    momentum: { studyStreak: 4, recentSessions: [], activityTrend: trend('last7d', 5, 3, 4) },
    recommendationEvidence: [{ source: 'recommendation_action', timestamp: '2026-09-02T08:00:00.000Z', actionId: 'action-1', studyTaskId: 'task-1' }],
    ...overrides,
  };
}

test('adapter maps StudentContext summaries without mixing Node and Point identities', () => {
  const { toStudentHomeSummary } = loadAdapter();
  const summary = toStudentHomeSummary(context());

  assert.equal(summary.asOf, '2026-09-03T08:00:00.000Z');
  assert.equal(summary.mastery.weakNode?.knowledgeNodeId, 'node-os');
  assert.equal('knowledgePointId' in summary.mastery.weakNode, false);
  assert.equal(summary.practice.recentAccuracy, 75);
  assert.equal(summary.review.dueCount, 3);
  assert.equal(summary.plan.completionRate, 33);
  assert.equal(summary.momentum.studyStreak, 4);
});

test('adapter preserves insufficient-data semantics instead of manufacturing zeroes', () => {
  const { toStudentHomeSummary } = loadAdapter();
  const empty = context({
    freshness: { asOf: '2026-09-03T08:00:00.000Z', status: 'insufficient_data', sources: [] },
    mastery: { source: 'empty', weakNodes: [], weakPoints: [], improvingPoints: [], masteredPoints: [], lastUpdatedAt: null },
    practice: {
      source: 'empty', recentAccuracy: trend('last7d', null, null, 0, 'insufficient_data'), recentVolume: trend('last7d', null, null, 0, 'insufficient_data'),
      subjectDistribution: { status: 'insufficient_data', items: [] }, totalCount: 0, latestSubmittedAt: null,
    },
    review: { source: 'empty', dueCount: 0, overdueCount: 0, reviewedCount: 0, resolvedCount: 0, highRiskQuestions: [], nextReviewAt: null },
    plan: { source: 'empty', planId: null, todayTasks: [], completion: { completedCount: 0, totalCount: 0, rate: trend('last7d', null, null, 0, 'insufficient_data') } },
    momentum: { studyStreak: 0, recentSessions: [], activityTrend: trend('last7d', null, null, 0, 'insufficient_data') },
  });
  const summary = toStudentHomeSummary(empty);

  assert.equal(summary.status, 'insufficient_data');
  assert.equal(summary.mastery.averageMastery, null);
  assert.equal(summary.practice.recentAccuracy, null);
  assert.equal(summary.review.dueCount, null);
  assert.equal(summary.plan.completionRate, null);
  assert.equal(summary.momentum.studyStreak, null);
});

test('adapter is deterministic and does not read clock or environment state', () => {
  const { toStudentHomeSummary } = loadAdapter();
  const input = context();
  assert.deepEqual(toStudentHomeSummary(input), toStudentHomeSummary(input));
  const source = readFileSync('apps/web/src/features/student/home/studentHomeContextAdapter.ts', 'utf8');
  assert.doesNotMatch(source, /Date\.now\(\)|new Date\(/);
  assert.doesNotMatch(source, /process\.env|fetch\(|prisma/i);
});

test('StudentHome consumes the adapter output while retaining legacy task launch data', () => {
  const home = readFileSync('apps/web/src/features/student/home/StudentHome.tsx', 'utf8');
  const viewModel = readFileSync('apps/web/src/features/student/home/useDashboardViewModel.ts', 'utf8');
  assert.match(viewModel, /toStudentHomeSummary/);
  assert.match(viewModel, /studentContext\?: StudentContext/);
  assert.match(home, /studentContext\?\.data/);
  assert.match(home, /todayPlan,/);
  assert.match(home, /onLaunchTodayTask,/);
});

test('StudentHome receives loading and error states without replacing the legacy view', () => {
  const home = readFileSync('apps/web/src/features/student/home/StudentHome.tsx', 'utf8');
  assert.match(home, /studentContext\?\.state === 'loading'/);
  assert.match(home, /学生状态摘要暂不可用/);
  assert.match(home, /当前保留兼容视图/);
  assert.match(home, /新版总览暂不可用/);
});

test('StudentContext is fetched through the read-only API endpoint and wired only to StudentHome', () => {
  const endpoint = readFileSync('apps/web/src/api/endpoints/dashboard.ts', 'utf8');
  const hook = readFileSync('apps/web/src/hooks/useStudentContextData.ts', 'utf8');
  const app = readFileSync('apps/web/src/App.tsx', 'utf8');
  const sections = readFileSync('apps/web/src/features/student/StudentSections.tsx', 'utf8');
  assert.match(endpoint, /fetchStudentContext/);
  assert.match(endpoint, /student-context/);
  assert.match(hook, /fetchStudentContext/);
  assert.match(hook, /setContext/);
  assert.match(app, /useStudentContextData/);
  assert.match(app, /studentContext=\{studentContext\.context\}/);
  assert.match(sections, /studentContext\?: ModuleResource<StudentContext>/);
  assert.match(sections, /studentContext=\{props\.studentContext\}/);
});

test('summary fields use null semantics for unavailable canonical context', () => {
  const viewModel = readFileSync('apps/web/src/features/student/home/useDashboardViewModel.ts', 'utf8');
  const stateCard = readFileSync('apps/web/src/features/student/home/components/StudentStateCard.tsx', 'utf8');
  const mission = readFileSync('apps/web/src/features/student/home/components/TodayMission.tsx', 'utf8');
  assert.match(viewModel, /value: number \| null/);
  assert.match(viewModel, /completionRate: number \| null/);
  assert.match(stateCard, /subject\.value == null \? '--'/);
  assert.match(mission, /model\.completionRate == null \? null/);
});

test('identity-sensitive summary model keeps Node and Point fields explicit', () => {
  const adapter = readFileSync('apps/web/src/features/student/home/studentHomeContextAdapter.ts', 'utf8');
  const types = readFileSync('apps/web/src/api/types.ts', 'utf8');
  assert.match(adapter, /knowledgeNodeId/);
  assert.match(adapter, /weakNode/);
  assert.doesNotMatch(adapter, /knowledgePointId.*knowledgeNodeId/);
  assert.match(types, /interface StudentContextNode/);
  assert.match(types, /knowledgePointId: string/);
});

test('context summary is wired only to summary consumers, not analysis-only screens', () => {
  const app = readFileSync('apps/web/src/App.tsx', 'utf8');
  const report = readFileSync('apps/web/src/features/report/ReportWorkspace.tsx', 'utf8');
  const reportSummary = readFileSync('apps/web/src/features/report/ReportSummaryPanel.tsx', 'utf8');
  const knowledge = readFileSync('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx', 'utf8');
  assert.match(app, /StudentSections/);
  // ReportWorkspace summaries now consume StudentContext through the summary adapter.
  assert.match(report, /studentContext/);
  assert.match(reportSummary, /toReportWorkspaceSummary/);
  // Report-specific analysis stays out of StudentContext consumption.
  assert.doesNotMatch(knowledge, /studentContext/);
});

test('adapter carries the canonical time window and does not reinterpret task identities', () => {
  const { toStudentHomeSummary } = loadAdapter();
  const summary = toStudentHomeSummary(context());
  assert.equal(summary.practice.window, 'last7d');
  assert.equal(summary.practice.sampleSize, 4);
  assert.equal(summary.asOf, context().asOf);
  assert.equal(summary.recommendationEvidenceCount, 1);
});

test('dashboard view model prioritizes StudentContext summaries over legacy mastery values', () => {
  const adapter = loadAdapter();
  const { useDashboardViewModel } = loadViewModel(adapter);
  const model = useDashboardViewModel({
    student: { name: '小明', targetSchool: 'BUPT', stage: '强化', remainingDays: 100, dailyHours: 3 },
    todayPlan: null,
    masteryMap: { subjects: [{ subject: '数据结构', averageMastery: 99 }], weakestPoints: [] },
    report: { weakPoints: [] },
    wrongQuestionSummary: null,
    learningCalendar: { days: [], today: { date: '2026-09-03', completedTaskCount: 0, practiceCount: 0, isActive: false }, streakDays: 99 },
    studentContext: context(),
  });

  assert.equal(model.averageMastery, 65);
  assert.equal(model.subjects.find((item) => item.id === 'ds')?.value, 72);
  assert.equal(model.subjects.find((item) => item.id === 'os')?.value, 32);
  assert.equal(model.subjects.find((item) => item.id === 'co')?.value, null);
  assert.equal(model.completionRate, 33);
  assert.equal(model.reviewDueCount, 3);
  assert.equal(model.reviewOverdueCount, 1);
  assert.equal(model.practiceAccuracy, 75);
  assert.equal(model.studyStreak, 4);
  assert.equal(model.tasks.length, 0);
});
