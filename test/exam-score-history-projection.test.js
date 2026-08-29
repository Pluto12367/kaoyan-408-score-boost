import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadProjection() {
  const source = await readFile(new URL('../apps/api/src/study/exam-score-history.projection.service.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: 'exam-score-history.projection.service.ts', compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    if (specifier.includes('exam-score-history.snapshot')) return { buildExamScoreHistorySnapshot: (input) => input };
    if (specifier.includes('learning-session.repository')) return {};
    if (specifier.includes('practice-record.repository')) return {};
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

const asOf = new Date('2026-08-24T08:00:00.000Z');

function sessions() {
  return [
    { id: 's-1', userId: 'u-1', type: 'paper', completed: true, questionIds: ['q-1', 'q-2'], lastActiveAt: '2026-08-22T08:00:00.000Z', totalActiveMs: 1800000 },
    { id: 's-2', userId: 'u-1', type: 'paper', completed: true, questionIds: ['q-3'], lastActiveAt: '2026-08-23T08:00:00.000Z', totalActiveMs: 2100000 },
    { id: 's-3', userId: 'u-2', type: 'paper', completed: true, questionIds: ['q-4'], lastActiveAt: '2026-08-23T08:00:00.000Z', totalActiveMs: 1200000 },
    { id: 's-4', userId: 'u-1', type: 'practice_set', completed: true, questionIds: ['q-5'], lastActiveAt: '2026-08-23T08:00:00.000Z', totalActiveMs: 1200000 },
    { id: 's-5', userId: 'u-1', type: 'paper', completed: false, questionIds: ['q-6'], lastActiveAt: '2026-08-23T08:00:00.000Z', totalActiveMs: 1200000 },
  ];
}

function records() {
  return [
    { sessionId: 's-1', correct: true },
    { sessionId: 's-1', correct: false },
    { sessionId: 's-2', correct: true },
    { sessionId: 's-2', correct: true },
    { sessionId: 's-4', correct: true },
    { sessionId: 's-5', correct: true },
  ];
}

async function createService() {
  const projection = await loadProjection();
  const sessionRepo = { loadAll: async () => sessions() };
  const recordRepo = { listByUser: async (userId) => records().filter((record) => sessions().some((session) => session.id === record.sessionId && session.userId === userId)) };
  const service = new projection.ExamScoreHistoryProjectionService({
    sessions: sessionRepo,
    practiceRecords: recordRepo,
  });
  return { service, projection };
}

test('projection applies userId, type and completed filters', async () => {
  const { service } = await createService();
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const snapshot = await service.getSnapshot('u-1', asOf);
    assert.equal(snapshot.userId, 'u-1');
    assert.equal(snapshot.exams.length, 2);
    assert.equal(snapshot.exams[0].sessionId, 's-1');
    assert.equal(snapshot.exams[1].sessionId, 's-2');
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});

test('projection aggregates correctCount and session totals', async () => {
  const { service } = await createService();
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const snapshot = await service.getSnapshot('u-1', asOf);
    const s1 = snapshot.exams.find((item) => item.sessionId === 's-1');
    const s2 = snapshot.exams.find((item) => item.sessionId === 's-2');
    assert.equal(s1.correctCount, 1);
    assert.equal(s1.totalQuestions, 2);
    assert.equal(s1.totalActiveMs, 1800000);
    assert.equal(s2.correctCount, 2);
    assert.equal(s2.totalQuestions, 1);
    assert.equal(s2.totalActiveMs, 2100000);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});

test('projection filters by asOf and excludes DTO fields', async () => {
  const { service } = await createService();
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const snapshot = await service.getSnapshot('u-1', new Date('2026-08-22T23:59:59.000Z'));
    assert.equal(snapshot.exams.length, 1);
    const root = JSON.stringify(snapshot);
    for (const forbidden of ['accuracyRate', 'trend', 'trendLabel', 'latestAccuracyRate', 'recommendation', 'nextAction', 'reason']) {
      assert.equal(root.includes(`"${forbidden}"`), false, `${forbidden} must not be present`);
    }
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previous;
  }
});

test('projection source boundary excludes controller, service and Prisma direct query', async () => {
  const source = await readFile(new URL('../apps/api/src/study/exam-score-history.projection.service.ts', import.meta.url), 'utf8');
  for (const forbidden of ['StudyService', 'Controller', 'recommendation', 'accuracyRate', 'trendLabel']) {
    assert.equal(source.includes(forbidden), false, `${forbidden} must not be present`);
  }
});
