import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadSnapshotModule() {
  const source = await readFile(new URL('../apps/api/src/study/wrong-question.snapshot.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    fileName: 'wrong-question.snapshot.ts',
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const asOf = '2026-08-24T08:00:00.000Z';

const baseInput = {
  userId: 'u-1',
  asOf,
  practiceRecords: [
    {
      id: 'r-1',
      questionId: 'q-current',
      knowledgePointId: 'kp-os',
      selectedAnswer: 'A',
      correct: false,
      timeSpentSec: 90,
      mistakeReason: '概念不清',
      submittedAt: '2026-08-21T08:00:00.000Z',
      variantQuestionId: null,
    },
    {
      id: 'r-2',
      questionId: 'q-resolved',
      knowledgePointId: 'kp-ds',
      selectedAnswer: 'B',
      correct: false,
      timeSpentSec: 80,
      mistakeReason: null,
      submittedAt: '2026-08-21T09:00:00.000Z',
      variantQuestionId: null,
    },
    {
      id: 'r-3',
      questionId: 'q-resolved',
      knowledgePointId: 'kp-ds',
      selectedAnswer: 'C',
      correct: true,
      timeSpentSec: 45,
      mistakeReason: null,
      submittedAt: '2026-08-22T09:00:00.000Z',
      variantQuestionId: null,
    },
    {
      id: 'r-4',
      questionId: 'q-current',
      knowledgePointId: 'kp-os',
      selectedAnswer: 'D',
      correct: false,
      timeSpentSec: 70,
      mistakeReason: '概念不清',
      submittedAt: '2026-08-23T08:00:00.000Z',
      variantQuestionId: null,
    },
    {
      id: 'r-5',
      questionId: 'q-variant',
      knowledgePointId: 'kp-os',
      selectedAnswer: 'A',
      correct: true,
      timeSpentSec: 40,
      mistakeReason: null,
      submittedAt: '2026-08-23T09:00:00.000Z',
      variantQuestionId: 'q-current',
    },
  ],
  wrongQuestionReviews: [
    {
      questionId: 'q-current',
      reviewedAt: '2026-08-22T10:00:00.000Z',
      resolved: true,
      resolvedAt: '2026-08-22T11:00:00.000Z',
    },
  ],
  reviewSchedules: [
    {
      questionId: 'q-current',
      stability: 'learning',
      consecutiveCorrect: 0,
      nextReviewAt: '2026-08-24T07:30:00.000Z',
      reviewCount: 1,
      lastReviewedAt: null,
      selfReportedReason: '定义没记牢',
      inferredReason: '概念不清',
      note: '复习页表',
      redoCorrect: false,
      timeSpentSec: 70,
    },
    {
      questionId: 'q-future',
      stability: 'learning',
      consecutiveCorrect: 0,
      nextReviewAt: '2026-08-25T07:30:00.000Z',
      reviewCount: 1,
      lastReviewedAt: null,
      selfReportedReason: null,
      inferredReason: null,
      note: null,
      redoCorrect: false,
      timeSpentSec: 0,
    },
    {
      questionId: 'q-mastered',
      stability: 'mastered',
      consecutiveCorrect: 3,
      nextReviewAt: '2026-08-23T07:30:00.000Z',
      reviewCount: 3,
      lastReviewedAt: '2026-08-23T07:00:00.000Z',
      selfReportedReason: null,
      inferredReason: null,
      note: null,
      redoCorrect: true,
      timeSpentSec: 30,
    },
  ],
  reviewAttempts: [
    {
      questionId: 'q-current',
      redoCorrect: false,
      timeSpentSec: 70,
      reportedReason: '定义没记牢',
      inferredReason: '概念不清',
      nextIntervalDays: 1,
      reviewedAt: '2026-08-22T10:00:00.000Z',
    },
  ],
  questions: [
    {
      id: 'q-current',
      stem: '页表项包含哪些字段？',
      answer: 'A',
      analysis: '页号到块号映射。',
      knowledgePointIds: ['kp-os'],
    },
    {
      id: 'q-resolved',
      stem: '链表删除结点需要维护什么？',
      answer: 'B',
      analysis: '维护前驱指针。',
      knowledgePointIds: ['kp-ds'],
    },
  ],
  knowledgePoints: [
    { id: 'kp-os', title: '页式存储管理', subject: '操作系统', chapter: '内存管理', importance: 5 },
    { id: 'kp-ds', title: '链表', subject: '数据结构', chapter: '线性表', importance: 4 },
  ],
};

test('wrong question snapshot separates current, resolved, due, and mistake reason facts', async () => {
  const { buildWrongQuestionSnapshot } = await loadSnapshotModule();

  const snapshot = buildWrongQuestionSnapshot(baseInput);

  assert.equal(snapshot.userId, 'u-1');
  assert.equal(snapshot.asOf, asOf);
  assert.deepEqual(snapshot.currentWrongItems.map((item) => item.questionId), ['q-current']);
  assert.deepEqual(snapshot.resolvedItems.map((item) => item.questionId), ['q-resolved']);
  assert.deepEqual(snapshot.dueItems.map((item) => item.questionId), ['q-current']);
  assert.deepEqual(snapshot.mistakeReasonStats, [
    { reason: '概念不清', count: 2 },
    { reason: '待归因', count: 1 },
  ]);
});

test('current wrong is driven by latest practice result even when review row is resolved', async () => {
  const { buildWrongQuestionSnapshot } = await loadSnapshotModule();

  const snapshot = buildWrongQuestionSnapshot(baseInput);
  const current = snapshot.currentWrongItems[0];

  assert.equal(current.questionId, 'q-current');
  assert.equal(current.review.resolved, true);
  assert.equal(current.latestCorrect, false);
  assert.equal(current.wrongCount, 2);
});

test('due items exclude future and mastered schedules', async () => {
  const { buildWrongQuestionSnapshot } = await loadSnapshotModule();

  const snapshot = buildWrongQuestionSnapshot(baseInput);

  assert.deepEqual(snapshot.dueItems.map((item) => item.questionId), ['q-current']);
  assert.equal(snapshot.dueItems[0].stability, 'learning');
  assert.equal(snapshot.dueItems[0].stem, '页表项包含哪些字段？');
});

test('mastery criteria keeps schedule facts and variant correct count', async () => {
  const { buildWrongQuestionSnapshot } = await loadSnapshotModule();

  const snapshot = buildWrongQuestionSnapshot(baseInput);

  assert.deepEqual(snapshot.currentWrongItems[0].masteryCriteria, {
    stability: 'learning',
    consecutiveCorrect: 0,
    variantCorrectCount: 1,
  });
});

test('wrong question snapshot contract excludes business presentation fields', async () => {
  const { buildWrongQuestionSnapshot } = await loadSnapshotModule();

  const snapshotJson = JSON.stringify(buildWrongQuestionSnapshot(baseInput));

  for (const forbidden of ['nextAction', 'recommendation', 'priorityRedoItems', 'similarQuestions', 'filters']) {
    assert.equal(snapshotJson.includes(forbidden), false, `${forbidden} must stay out of WrongQuestionSnapshot`);
  }
});
