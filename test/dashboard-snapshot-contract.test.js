import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadModule() {
  const source = await readFile(new URL('../apps/api/src/study/dashboard.snapshot.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: 'dashboard.snapshot.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const localRequire = (specifier) => { throw new Error(`Unexpected dependency: ${specifier}`); };
  Function('require', 'module', 'exports', output)(localRequire, module, module.exports);
  return module.exports;
}

const asOf = '2026-08-24T08:00:00.000Z';

function facts() {
  return {
    userId: 'u-1',
    asOf,
    stateFacts: { source: 'student_state', goal: { stage: '强化' }, mastery: { averageMastery: 60 }, weakPoints: [], activity: { streakDays: 2 } },
    wrongQuestionFacts: { source: 'wrong_question_projection', total: 2, unresolved: 1, reviewed: 1, resolved: 1, latestWrongAt: asOf, dueCount: 1 },
    todayPlanFacts: { source: 'today_plan_projection', planId: 'plan-1', phase: '强化', status: 'ACTIVE', todayTaskCount: 2, completedTaskCount: 1, completionRate: 50, reviewDueCount: 1, asOf },
    practiceFacts: { source: 'practice_record', totalCount: 1, latestSubmittedAt: asOf, records: [{ id: 'r-1', userId: 'u-1', questionId: 'q-1', knowledgePointId: 'kp-1', correct: false, timeSpentSec: 60, mistakeReason: '概念混淆', submittedAt: asOf, variantQuestionId: null }] },
    sessionFacts: { source: 'learning_session', activeCount: 1, latestActiveAt: asOf, sessions: [{ id: 's-1', userId: 'u-1', type: 'practice_set', startedAt: asOf, lastActiveAt: asOf, completed: false }] },
    assessmentFacts: { source: 'assessment', attemptCount: 1, bestScore: 80, latestScore: 80, latestAccuracyRate: 75, latestSubmittedAt: asOf },
  };
}

test('dashboard snapshot has explicit fact domains and preserves input facts', async () => {
  const { buildDashboardSnapshot } = await loadModule();
  const snapshot = buildDashboardSnapshot(facts());
  assert.equal(snapshot.source, 'dashboard_facts');
  assert.equal(snapshot.userId, 'u-1');
  assert.equal(snapshot.asOf, asOf);
  for (const field of ['stateFacts', 'wrongQuestionFacts', 'todayPlanFacts', 'practiceFacts', 'sessionFacts', 'assessmentFacts']) {
    assert.ok(snapshot[field], `${field} is required`);
  }
  assert.equal(snapshot.todayPlanFacts.planId, 'plan-1');
  assert.equal(snapshot.practiceFacts.records[0].questionId, 'q-1');
});

test('empty dashboard snapshot has safe empty fact groups', async () => {
  const { buildDashboardSnapshot } = await loadModule();
  const snapshot = buildDashboardSnapshot({ userId: 'u-empty', asOf });
  assert.equal(snapshot.userId, 'u-empty');
  assert.equal(snapshot.stateFacts.source, 'empty');
  assert.equal(snapshot.wrongQuestionFacts.total, 0);
  assert.equal(snapshot.todayPlanFacts.planId, null);
  assert.equal(snapshot.practiceFacts.records.length, 0);
  assert.equal(snapshot.sessionFacts.activeCount, 0);
  assert.equal(snapshot.assessmentFacts.attemptCount, 0);
});

test('dashboard snapshot excludes presentation strategy and UI fields', async () => {
  const { buildDashboardSnapshot } = await loadModule();
  const snapshot = buildDashboardSnapshot(facts());
  for (const forbidden of ['nextAction', 'recommendation', 'priorityCard', 'checkpointMessage', 'actionText', 'actionAnchor', 'generatedRank']) {
    assert.equal(JSON.stringify(snapshot).includes(`"${forbidden}"`), false, `${forbidden} must not be in snapshot`);
  }
});

test('dashboard snapshot contract documents projection boundaries without service dependencies', async () => {
  const source = await readFile(new URL('../apps/api/src/study/dashboard.snapshot.ts', import.meta.url), 'utf8');
  assert.match(source, /StudentStateProjection/);
  assert.match(source, /WrongQuestionProjection/);
  assert.match(source, /TodayPlanProjection/);
  assert.match(source, /PracticeRecord/);
  assert.match(source, /LearningSession/);
  assert.match(source, /assessment/i);
  assert.doesNotMatch(source, /PrismaService|StudyService|Controller|Repository/);
});
