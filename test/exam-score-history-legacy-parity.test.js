import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const asOf = new Date('2026-08-24T08:00:00.000Z');

async function loadCommonJs(path, dependencies = {}) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
  const output = ts.transpileModule(source, { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    const key = Object.keys(dependencies).find((candidate) => specifier.includes(candidate));
    if (key) return dependencies[key];
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

function fixture() {
  return {
    sessions: [
      { id: 's-late', userId: 'u-1', type: 'paper', completed: true, questionIds: ['q-1', 'q-2', 'q-3'], lastActiveAt: '2026-08-23T08:00:00.000Z', totalActiveMs: 2100000 },
      { id: 's-early', userId: 'u-1', type: 'paper', completed: true, questionIds: ['q-4', 'q-5'], lastActiveAt: '2026-08-22T08:00:00.000Z', totalActiveMs: 1800000 },
      { id: 's-other-user', userId: 'u-2', type: 'paper', completed: true, questionIds: ['q-6'], lastActiveAt: '2026-08-23T08:00:00.000Z', totalActiveMs: 1200000 },
      { id: 's-practice', userId: 'u-1', type: 'practice_set', completed: true, questionIds: ['q-7'], lastActiveAt: '2026-08-23T08:00:00.000Z', totalActiveMs: 600000 },
      { id: 's-open', userId: 'u-1', type: 'paper', completed: false, questionIds: ['q-8'], lastActiveAt: '2026-08-23T08:00:00.000Z', totalActiveMs: 600000 },
      { id: 's-future', userId: 'u-1', type: 'paper', completed: true, questionIds: ['q-9'], lastActiveAt: '2026-08-25T08:00:00.000Z', totalActiveMs: 600000 },
    ],
    records: [
      { sessionId: 's-early', userId: 'u-1', correct: true },
      { sessionId: 's-early', userId: 'u-1', correct: false },
      { sessionId: 's-late', userId: 'u-1', correct: true },
      { sessionId: 's-late', userId: 'u-1', correct: true },
      { sessionId: 's-late', userId: 'u-1', correct: false },
      { sessionId: 's-other-user', userId: 'u-2', correct: true },
      { sessionId: 's-practice', userId: 'u-1', correct: true },
    ],
    assessmentHistoryItems: [
      { id: 'a-1', userId: 'u-1', score: 99, accuracyRate: 99 },
    ],
  };
}

function legacyGetExamScoreHistory(data, userId, now = asOf) {
  const sessions = data.sessions.filter((session) => session.userId === userId && session.type === 'paper' && session.completed && new Date(session.lastActiveAt) <= now);
  const history = sessions.map((session) => {
    const records = data.records.filter((record) => record.userId === userId && record.sessionId === session.id);
    const correctCount = records.filter((record) => record.correct).length;
    return {
      sessionId: session.id,
      date: session.lastActiveAt.slice(0, 10),
      totalQuestions: session.questionIds.length,
      correctCount,
      accuracyRate: session.questionIds.length ? Math.round((correctCount / session.questionIds.length) * 100) : 0,
      totalTimeMin: Math.round(session.totalActiveMs / 60000),
    };
  }).sort((left, right) => left.date.localeCompare(right.date));
  const trend = history.length >= 2 ? history.at(-1).accuracyRate - history.at(-2).accuracyRate : 0;
  return {
    userId,
    totalExams: history.length,
    latestAccuracyRate: history.at(-1)?.accuracyRate ?? 0,
    trend,
    trendLabel: trend > 0 ? `较上次提升 ${trend} 分` : trend < 0 ? `较上次下降 ${Math.abs(trend)} 分` : '与上次持平',
    history,
  };
}

async function createNew(data) {
  const projectionModule = await loadCommonJs('apps/api/src/study/exam-score-history.projection.service.ts', {
    // Mirror the real builder's normalization (exams defaults to []); a pure identity
    // stub breaks the empty-branch snapshot shape and crashes the adapter.
    'exam-score-history.snapshot': { buildExamScoreHistorySnapshot: (input) => ({ exams: [], ...input }) },
  });
  const adapterModule = await loadCommonJs('apps/api/src/study/exam-score-history.adapter.ts', {
    'study-date': { studyDateKey: (value) => String(value).slice(0, 10) },
  });
  const service = new projectionModule.ExamScoreHistoryProjectionService({
    sessions: { loadAll: async () => data.sessions },
    practiceRecords: { listByUser: async (userId) => data.records.filter((record) => record.userId === userId) },
  });
  const previous = process.env.DATABASE_URL;
  process.env.DATABASE_URL = 'postgres://test';
  try {
    const snapshot = await service.getSnapshot('u-1', asOf);
    return adapterModule.toLegacyExamScoreHistory(snapshot);
  } finally {
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  }
}

test('parity: empty data', async () => {
  const data = { sessions: [], records: [], assessmentHistoryItems: [] };
  assert.deepEqual(await createNew(data), legacyGetExamScoreHistory(data, 'u-1'));
});

test('parity: single completed paper session', async () => {
  const data = fixture();
  data.sessions = [data.sessions[0]];
  data.records = data.records.filter((record) => record.sessionId === 's-late');
  assert.deepEqual(await createNew(data), legacyGetExamScoreHistory(data, 'u-1'));
});

test('parity: multiple completed paper sessions and ordering', async () => {
  const data = fixture();
  const actual = await createNew(data);
  const expected = legacyGetExamScoreHistory(data, 'u-1');
  assert.deepEqual(actual, expected);
  assert.deepEqual(actual.history.map((item) => item.sessionId), ['s-early', 's-late']);
});

test('parity: non-paper, incomplete, future, and other-user sessions are excluded', async () => {
  const data = fixture();
  const actual = await createNew(data);
  assert.equal(actual.totalExams, 2);
  assert.equal(actual.history.some((item) => ['s-practice', 's-open', 's-future', 's-other-user'].includes(item.sessionId)), false);
  assert.deepEqual(actual, legacyGetExamScoreHistory(data, 'u-1'));
});

test('parity: practice records associate by sessionId and correctCount matches', async () => {
  const data = fixture();
  const actual = await createNew(data);
  assert.equal(actual.history.find((item) => item.sessionId === 's-early').correctCount, 1);
  assert.equal(actual.history.find((item) => item.sessionId === 's-late').correctCount, 2);
  assert.deepEqual(actual, legacyGetExamScoreHistory(data, 'u-1'));
});

test('parity: accuracyRate, totalTimeMin, and date match', async () => {
  const data = fixture();
  const actual = await createNew(data);
  assert.deepEqual(actual.history, [
    { sessionId: 's-early', date: '2026-08-22', totalQuestions: 2, correctCount: 1, accuracyRate: 50, totalTimeMin: 30 },
    { sessionId: 's-late', date: '2026-08-23', totalQuestions: 3, correctCount: 2, accuracyRate: 67, totalTimeMin: 35 },
  ]);
});

test('parity: trend, trendLabel, latestAccuracyRate match', async () => {
  const data = fixture();
  const actual = await createNew(data);
  const expected = legacyGetExamScoreHistory(data, 'u-1');
  assert.equal(actual.trend, expected.trend);
  assert.equal(actual.trendLabel, expected.trendLabel);
  assert.equal(actual.latestAccuracyRate, expected.latestAccuracyRate);
});

test('parity: assessmentHistoryItems do not enter exam score history', async () => {
  const data = fixture();
  const actual = await createNew(data);
  assert.equal(actual.totalExams, 2);
  assert.equal(actual.history.some((item) => item.sessionId === 'a-1'), false);
  assert.deepEqual(actual, legacyGetExamScoreHistory(data, 'u-1'));
});

test('parity: fixed asOf produces identical output', async () => {
  const data = fixture();
  const first = await createNew(data);
  const second = await createNew(data);
  assert.deepEqual(first, second);
  assert.deepEqual(first, legacyGetExamScoreHistory(data, 'u-1', asOf));
});
