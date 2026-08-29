import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('wrong-questions controller route delegates through WrongQuestionQueryService', async () => {
  const { StudyController } = require('../apps/api/src/study/study.controller.ts');
  const { WrongQuestionQueryService } = require('../apps/api/src/study/wrong-question-query.service.ts');
  const { buildWrongQuestionSnapshot } = require('../apps/api/src/study/wrong-question.snapshot.ts');
  const legacyCalls = [];
  const projectionCalls = [];
  const snapshot = buildWrongQuestionSnapshot({
    userId: 'u-1',
    asOf: '2026-08-24T08:00:00.000Z',
    practiceRecords: [
      practiceRecord({ id: 'r-1', questionId: 'q-os', correct: false, submittedAt: '2026-08-20T08:00:00.000Z' }),
      practiceRecord({ id: 'r-2', questionId: 'q-os', correct: false, submittedAt: '2026-08-22T08:00:00.000Z' }),
      practiceRecord({ id: 'r-3', questionId: 'q-ds', correct: false, submittedAt: '2026-08-22T09:00:00.000Z', knowledgePointId: 'ds-list' }),
    ],
    wrongQuestionReviews: [],
    reviewSchedules: [
      reviewSchedule({ questionId: 'q-os', stability: 'learning', consecutiveCorrect: 0 }),
      reviewSchedule({ questionId: 'q-ds', stability: 'review', consecutiveCorrect: 1 }),
    ],
    reviewAttempts: [],
    questions: [
      { id: 'q-os', stem: 'OS 同步题', answer: 'B', analysis: 'OS analysis', knowledgePointIds: ['os-sync'] },
      { id: 'q-ds', stem: '链表题', answer: 'A', analysis: 'DS analysis', knowledgePointIds: ['ds-list'] },
    ],
    knowledgePoints: [
      { id: 'os-sync', title: '进程同步与互斥', subject: '操作系统', chapter: '进程管理', importance: 5 },
      { id: 'ds-list', title: '链表', subject: '数据结构', chapter: '线性表', importance: 4 },
    ],
  });
  const wrongQuestionQuery = new WrongQuestionQueryService({
    getSnapshot(userId, filters) {
      projectionCalls.push({ userId, filters });
      return snapshot;
    },
  });
  const controller = new StudyController(
    {
      listWrongQuestions(userId, filters) {
        legacyCalls.push({ userId, filters });
        return [{ source: 'legacy' }];
      },
      assertTeacherAuthorizedForStudent() {},
    },
    {},
    {},
    {},
    {},
    {},
    {},
    wrongQuestionQuery,
  );

  const result = await controller.listWrongQuestions(
    { id: 'u-1', role: 'student' },
    undefined,
    '操作系统',
    '进程管理',
    'os-sync',
    '概念不清',
    '2',
    '未掌握',
    undefined,
    '5',
  );

  assert.deepEqual(result.map((item) => ({
    questionId: item.questionId,
    wrongCount: item.wrongCount,
    reviewStatus: item.reviewStatus,
    masteryStatus: item.masteryStatus,
  })), [
    {
      questionId: 'q-os',
      wrongCount: 2,
      reviewStatus: 'pending',
      masteryStatus: '未掌握',
    },
  ]);
  assert.deepEqual(projectionCalls, [{ userId: 'u-1', filters: undefined }]);
  assert.deepEqual(legacyCalls, []);
});

test('wrong-questions route keeps URL and uses getWrongQuestionsCompat in source', () => {
  const controllerSource = readFileSync('apps/api/src/study/study.controller.ts', 'utf8');
  const start = controllerSource.indexOf("@Get('wrong-questions')");
  const end = controllerSource.indexOf("@Get('wrong-questions/summary')");
  const routeBlock = controllerSource.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(routeBlock, /@Get\('wrong-questions'\)/);
  assert.match(routeBlock, /listWrongQuestions\(/);
  assert.match(routeBlock, /wrongQuestionQuery\.getWrongQuestionsCompat\(this\.resolveUserId\(user, viewUserId\), this\.parseWrongQuestionFilters\(/);
  assert.doesNotMatch(routeBlock, /studyService\.listWrongQuestions/);
});

test('StudyModule keeps a single WrongQuestion query provider registration', () => {
  const moduleSource = readFileSync('apps/api/src/study/study.module.ts', 'utf8');

  assert.equal(countOccurrences(moduleSource, 'WrongQuestionQueryService'), 2);
  assert.equal(countOccurrences(moduleSource, 'WrongQuestionProjectionService'), 2);
});

function practiceRecord(overrides) {
  return {
    id: overrides.id,
    questionId: overrides.questionId,
    knowledgePointId: overrides.knowledgePointId ?? 'os-sync',
    selectedAnswer: 'A',
    correct: overrides.correct,
    timeSpentSec: 60,
    mistakeReason: '概念不清',
    submittedAt: overrides.submittedAt,
    variantQuestionId: null,
  };
}

function reviewSchedule(overrides) {
  return {
    questionId: overrides.questionId,
    stability: overrides.stability,
    consecutiveCorrect: overrides.consecutiveCorrect,
    nextReviewAt: '2026-08-24T08:00:00.000Z',
    reviewCount: 1,
  };
}

function countOccurrences(value, pattern) {
  return (value.match(new RegExp(pattern, 'g')) ?? []).length;
}
