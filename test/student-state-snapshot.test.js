import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

async function loadSnapshotModule() {
  const dateSource = await readFile(new URL('../apps/api/src/study/study-date.ts', import.meta.url), 'utf8');
  const dateOutput = ts.transpileModule(dateSource, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dateModuleUrl = `data:text/javascript;base64,${Buffer.from(dateOutput).toString('base64')}`;
  const source = await readFile(new URL('../apps/api/src/study/student-state.snapshot.ts', import.meta.url), 'utf8');
  const sourceWithDataUrlImports = source.replace(
    "import { studyDateKey } from './study-date';",
    `import { studyDateKey } from '${dateModuleUrl}';`,
  );
  const output = ts.transpileModule(sourceWithDataUrlImports, {
    fileName: 'student-state.snapshot.ts',
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('student state snapshot is stable for the same state inputs', async () => {
  const { buildStudentStateSnapshot } = await loadSnapshotModule();
  const input = {
    userId: 'u-1',
    asOf: '2026-08-23T08:00:00.000Z',
    user: {
      targetSchool: '北京邮电大学',
      targetScore: 115,
      currentScore: 82,
      dailyHours: 4,
      remainingDays: 120,
      studyStage: '强化',
      weakestSubject: '操作系统',
      diagnosis: '系统调用薄弱',
      examYear: 2027,
      onboardingCompletedAt: new Date('2026-08-20T00:00:00.000Z'),
    },
    masteryRows: [
      {
        knowledgeNodeId: 'node-os-process',
        subject: '操作系统',
        chapter: '进程管理',
        title: '进程调度',
        importance: 5,
        frequency: 5,
        mastery: 0.32,
        attempts: 4,
        correctCount: 1,
        wrongCount: 3,
        status: 'weak',
        updatedAt: new Date('2026-08-22T00:00:00.000Z'),
      },
      {
        knowledgeNodeId: 'node-ds-list',
        subject: '数据结构',
        chapter: '线性表',
        title: '链表',
        importance: 4,
        frequency: 4,
        mastery: 0.86,
        attempts: 5,
        correctCount: 5,
        wrongCount: 0,
        status: 'mastered',
        updatedAt: new Date('2026-08-21T00:00:00.000Z'),
      },
    ],
    wrongQuestionRows: [
      { questionId: 'q-1', latestCorrect: false, latestSubmittedAt: new Date('2026-08-22T10:00:00.000Z'), reviewedAt: new Date('2026-08-22T12:00:00.000Z'), resolved: false },
      { questionId: 'q-2', latestCorrect: true, latestSubmittedAt: new Date('2026-08-21T10:00:00.000Z'), reviewedAt: null, resolved: true },
    ],
    reviewSchedules: [
      { questionId: 'q-1', nextReviewAt: new Date('2026-08-22T00:00:00.000Z'), reviewCount: 2, stability: 'learning' },
      { questionId: 'q-3', nextReviewAt: new Date('2026-08-24T00:00:00.000Z'), reviewCount: 1, stability: 'reviewing' },
    ],
    studyTasks: [
      { id: 'task-1', title: '进程调度训练', status: 'in_progress', scheduledDate: '2026-08-23', completed: false, completedAt: null, priority: 'high', mode: 'practice', questionCount: 12, minutes: 30 },
      { id: 'task-2', title: '链表复盘', status: 'completed', scheduledDate: '2026-08-23', completed: true, completedAt: new Date('2026-08-23T07:30:00.000Z'), priority: 'medium', mode: 'review', questionCount: 8, minutes: 20 },
    ],
    assessmentSummary: {
      attemptCount: 2,
      bestScore: 96,
      latestAccuracyRate: 78,
      improvementText: '较上次提升 8 分，继续巩固本次薄弱点。',
    },
  };

  const first = buildStudentStateSnapshot(input);
  const second = buildStudentStateSnapshot(input);

  assert.deepEqual(second, first);
  assert.equal(first.goal.targetScore, 115);
  assert.equal(first.mastery.source, 'user_knowledge_mastery');
  assert.equal(first.mastery.averageMastery, 59);
  assert.equal(first.weakPoints[0].knowledgeNodeId, 'node-os-process');
  assert.equal(first.wrongQuestionSummary.total, 1);
  assert.equal(first.wrongQuestionSummary.reviewed, 1);
  assert.equal(first.reviewDue.dueCount, 1);
  assert.equal(first.reviewDue.overdueCount, 1);
  assert.equal(first.studyTasks.today.length, 2);
  assert.equal(first.studyTasks.counts.inProgress, 1);
  assert.equal(first.assessmentSummary.bestScore, 96);
});

test('student state snapshot returns empty state when optional rows are missing', async () => {
  const { buildStudentStateSnapshot } = await loadSnapshotModule();
  const snapshot = buildStudentStateSnapshot({
    userId: 'u-empty',
    asOf: '2026-08-23T08:00:00.000Z',
    user: null,
    masteryRows: [],
    wrongQuestionRows: [],
    reviewSchedules: [],
    studyTasks: [],
    assessmentSummary: {
      attemptCount: 0,
      bestScore: 0,
      latestAccuracyRate: 0,
      improvementText: '还没有测评记录，先完成一套模拟卷建立基线。',
    },
  });

  assert.equal(snapshot.mastery.source, 'empty');
  assert.equal(snapshot.mastery.nodeCount, 0);
  assert.deepEqual(snapshot.weakPoints, []);
  assert.equal(snapshot.wrongQuestionSummary.total, 0);
  assert.equal(snapshot.reviewDue.dueCount, 0);
  assert.deepEqual(snapshot.reviewDue.items, []);
  assert.equal(snapshot.studyTasks.today.length, 0);
  assert.equal(snapshot.assessmentSummary.attemptCount, 0);
});

test('student state snapshot uses the configured study timezone for today tasks and overdue reviews', async () => {
  const previousTimeZone = process.env.APP_TIME_ZONE;
  process.env.APP_TIME_ZONE = 'Asia/Shanghai';
  try {
    const { buildStudentStateSnapshot } = await loadSnapshotModule();
    const snapshot = buildStudentStateSnapshot({
      userId: 'u-timezone',
      asOf: '2026-08-22T16:30:00.000Z',
      user: null,
      masteryRows: [],
      wrongQuestionRows: [],
      reviewSchedules: [
        { questionId: 'q-overdue', nextReviewAt: '2026-08-22T15:59:00.000Z', reviewCount: 2, stability: 'learning' },
        { questionId: 'q-due-today', nextReviewAt: '2026-08-22T16:05:00.000Z', reviewCount: 1, stability: 'reviewing' },
      ],
      studyTasks: [
        { id: 'task-shanghai-today', title: '上海当天任务', status: 'pending', scheduledDate: '2026-08-23', completed: false, completedAt: null, priority: 'high', mode: 'practice', questionCount: 10, minutes: 25 },
        { id: 'task-utc-yesterday', title: 'UTC 前一天任务', status: 'pending', scheduledDate: '2026-08-22', completed: false, completedAt: null, priority: 'low', mode: 'review', questionCount: 6, minutes: 15 },
      ],
      assessmentSummary: {
        attemptCount: 0,
        bestScore: 0,
        latestAccuracyRate: 0,
        improvementText: '还没有测评记录，先完成一套模拟卷建立基线。',
      },
    });

    assert.deepEqual(snapshot.studyTasks.today.map((task) => task.id), ['task-shanghai-today']);
    assert.equal(snapshot.reviewDue.dueCount, 2);
    assert.equal(snapshot.reviewDue.overdueCount, 1);
    assert.deepEqual(
      snapshot.reviewDue.items.map((item) => [item.questionId, item.overdue]),
      [['q-overdue', true], ['q-due-today', false]],
    );
  } finally {
    if (previousTimeZone === undefined) {
      delete process.env.APP_TIME_ZONE;
    } else {
      process.env.APP_TIME_ZONE = previousTimeZone;
    }
  }
});

test('student state projection service is wired as a read-only provider', () => {
  const service = readFileSync('apps/api/src/study/student-state-projection.service.ts', 'utf8');
  const moduleSource = readFileSync('apps/api/src/study/study.module.ts', 'utf8');
  const controller = readFileSync('apps/api/src/study/study.controller.ts', 'utf8');

  assert.match(service, /export class StudentStateProjectionService/);
  assert.match(service, /buildStudentStateSnapshot/);
  assert.match(service, /\.findUnique\(/);
  assert.match(service, /\.findMany\(/);
  assert.doesNotMatch(service, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
  assert.doesNotMatch(service, /\.\$transaction\(/);
  assert.match(moduleSource, /StudentStateProjectionService/);
  assert.match(controller, /@Get\('student-state'\)/);
});
