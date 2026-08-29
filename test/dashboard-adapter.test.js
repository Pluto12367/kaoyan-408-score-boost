import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadAdapter() {
  const source = await readFile(new URL('../apps/api/src/study/dashboard.adapter.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: 'dashboard.adapter.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => { throw new Error(`Unexpected dependency: ${specifier}`); }, module, module.exports);
  return module.exports;
}

function snapshot(overrides = {}) {
  return {
    source: 'dashboard_facts', userId: 'u-1', asOf: '2026-08-24T08:00:00.000Z',
    stateFacts: { source: 'student_state', goal: { stage: '强化', targetScore: 120 }, mastery: { averageMastery: 62 }, weakPoints: [{ knowledgeNodeId: 'kp-1', title: '页表', accuracyRate: 40 }], activity: null },
    wrongQuestionFacts: { source: 'wrong_question_projection', total: 3, unresolved: 2, reviewed: 1, resolved: 1, latestWrongAt: '2026-08-23T00:00:00.000Z', dueCount: 2 },
    todayPlanFacts: { source: 'today_plan_projection', planId: 'plan-1', phase: '强化', status: 'ACTIVE', todayTaskCount: 2, completedTaskCount: 1, completionRate: 50, reviewDueCount: 2, asOf: '2026-08-24T08:00:00.000Z' },
    practiceFacts: { source: 'practice_record', totalCount: 4, latestSubmittedAt: '2026-08-24T07:00:00.000Z', records: [] },
    sessionFacts: { source: 'learning_session', activeCount: 1, latestActiveAt: '2026-08-24T07:30:00.000Z', sessions: [] },
    assessmentFacts: { source: 'assessment', attemptCount: 2, bestScore: 85, latestScore: 80, latestAccuracyRate: 75, latestSubmittedAt: '2026-08-20T00:00:00.000Z' },
    ...overrides,
  };
}

test('empty snapshot converts to legacy-safe dashboard DTO', async () => {
  const { toLegacyDashboardOverview } = await loadAdapter();
  const result = toLegacyDashboardOverview({ source: 'dashboard_facts', userId: 'u-empty', asOf: '2026-08-24T08:00:00.000Z', stateFacts: { source: 'empty', goal: null, mastery: null, weakPoints: [], activity: null }, wrongQuestionFacts: { source: 'empty', total: 0, unresolved: 0, reviewed: 0, resolved: 0, latestWrongAt: null, dueCount: 0 }, todayPlanFacts: { source: 'empty', planId: null, phase: null, status: null, todayTaskCount: 0, completedTaskCount: 0, completionRate: 0, reviewDueCount: 0, asOf: '2026-08-24T08:00:00.000Z' }, practiceFacts: { source: 'empty', totalCount: 0, latestSubmittedAt: null, records: [] }, sessionFacts: { source: 'empty', activeCount: 0, latestActiveAt: null, sessions: [] }, assessmentFacts: { source: 'empty', attemptCount: 0, bestScore: null, latestScore: null, latestAccuracyRate: null, latestSubmittedAt: null } });
  assert.equal(result.student.id, 'u-empty');
  assert.deepEqual(result.wrongQuestions, []);
  assert.deepEqual(result.practiceRecords, []);
  assert.equal(result.plan.todayTaskCount, 0);
});

test('complete snapshot maps mastery, wrong questions, today plan, and score facts', async () => {
  const { toLegacyDashboardOverview } = await loadAdapter();
  const result = toLegacyDashboardOverview(snapshot(), '2026-08-24T09:00:00.000Z');
  assert.equal(result.student.targetScore, 120);
  assert.equal(result.report.mastery.averageMastery, 62);
  assert.deepEqual(result.report.weakPoints, [{ knowledgeNodeId: 'kp-1', title: '页表', accuracyRate: 40 }]);
  assert.equal(result.wrongQuestions.length, 3);
  assert.equal(result.plan.planId, 'plan-1');
  assert.equal(result.plan.todayTaskCount, 2);
  assert.equal(result.plan.reviewDue, 2);
  assert.equal(result.generatedAt, '2026-08-24T09:00:00.000Z');
});

test('score data is null when unavailable', async () => {
  const { toLegacyDashboardOverview } = await loadAdapter();
  const result = toLegacyDashboardOverview(snapshot({ stateFacts: { source: 'empty', goal: null, mastery: null, weakPoints: [], activity: null }, todayPlanFacts: { source: 'empty', planId: null, phase: null, status: null, todayTaskCount: 0, completedTaskCount: 0, completionRate: 0, reviewDueCount: 0, asOf: snapshot().asOf } }));
  assert.equal(result.scoreCenter, null);
});

test('adapter does not mutate snapshot or introduce forbidden strategy fields into it', async () => {
  const { toLegacyDashboardOverview } = await loadAdapter();
  const source = snapshot();
  const before = JSON.stringify(source);
  const result = toLegacyDashboardOverview(source);
  assert.equal(JSON.stringify(source), before);
  assert.ok(result.report && result.plan);
  for (const forbidden of ['nextAction', 'recommendation', 'priorityCard', 'checkpointMessage']) assert.equal(JSON.stringify(source).includes(forbidden), false);
});

test('adapter has no data-access dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/dashboard.adapter.ts', import.meta.url), 'utf8');
  for (const forbidden of ['Prisma', '@nestjs', 'StudyService', 'Controller', 'Repository', 'fetch(', 'prisma.']) assert.equal(source.includes(forbidden), false, `${forbidden} must not be used`);
});
