import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('wrong-questions/summary controller route delegates through WrongQuestionQueryService', async () => {
  const { StudyController } = require('../apps/api/src/study/study.controller.ts');
  const { WrongQuestionQueryService } = require('../apps/api/src/study/wrong-question-query.service.ts');
  const { buildWrongQuestionSnapshot } = require('../apps/api/src/study/wrong-question.snapshot.ts');
  const legacyCalls = [];
  const projectionCalls = [];
  const snapshot = buildWrongQuestionSnapshot({
    userId: 'u-1',
    asOf: '2026-08-24T08:00:00.000Z',
    practiceRecords: [
      practiceRecord({ id: 'r-1', userId: 'u-1', questionId: 'q-wrong', correct: false, mistakeReason: '概念不清' }),
    ],
    wrongQuestionReviews: [],
    reviewSchedules: [
      {
        questionId: 'q-wrong',
        stability: 'learning',
        consecutiveCorrect: 0,
        nextReviewAt: '2026-08-24T08:00:00.000Z',
        reviewCount: 1,
      },
    ],
    reviewAttempts: [],
    questions: [
      { id: 'q-wrong', stem: 'Cache 映射题', answer: 'B', analysis: 'Cache analysis', knowledgePointIds: ['co-cache'] },
    ],
    knowledgePoints: [
      { id: 'co-cache', title: 'Cache 映射与替换', subject: '计算机组成原理', chapter: '存储系统', importance: 5 },
    ],
  });
  const wrongQuestionQuery = new WrongQuestionQueryService({
    getSnapshot(userId) {
      projectionCalls.push(userId);
      return snapshot;
    },
  });
  const controller = new StudyController(
    {
      getWrongQuestionSummary(userId) {
        legacyCalls.push(userId);
        return { source: 'legacy' };
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

  const result = await controller.getWrongQuestionSummary({ id: 'u-1', role: 'student' });

  assert.equal(result.userId, 'u-1');
  assert.equal(result.pendingCount, 1);
  assert.equal(result.reviewedCount, 0);
  assert.equal(result.resolvedCount, 0);
  assert.equal(result.totalWrongCount, 1);
  assert.deepEqual(result.mistakeReasonStats, [{ reason: '概念不清', count: 1 }]);
  assert.equal(result.priorityRedoItems[0].nextAction, '先标记复盘，写出错误原因后再重做。');
  assert.deepEqual(projectionCalls, ['u-1']);
  assert.deepEqual(legacyCalls, []);
});

test('wrong-questions/summary route keeps URL and uses getWrongQuestionSummaryCompat in source', () => {
  const controllerSource = readFileSync('apps/api/src/study/study.controller.ts', 'utf8');
  const start = controllerSource.indexOf("@Get('wrong-questions/summary')");
  const end = controllerSource.indexOf("@Post('wrong-questions/:questionId/review')");
  const routeBlock = controllerSource.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(routeBlock, /@Get\('wrong-questions\/summary'\)/);
  assert.match(routeBlock, /getWrongQuestionSummary\(/);
  assert.match(routeBlock, /wrongQuestionQuery\.getWrongQuestionSummaryCompat\(this\.resolveUserId\(user, viewUserId\)\)/);
  assert.doesNotMatch(routeBlock, /studyService\.getWrongQuestionSummary/);
});

test('StudyModule registers WrongQuestion query providers once', () => {
  const moduleSource = readFileSync('apps/api/src/study/study.module.ts', 'utf8');

  assert.equal(countOccurrences(moduleSource, 'WrongQuestionQueryService'), 2);
  assert.equal(countOccurrences(moduleSource, 'WrongQuestionProjectionService'), 2);
  assert.match(moduleSource, /providers:\s*\[[\s\S]*WrongQuestionQueryService/);
  assert.match(moduleSource, /providers:\s*\[[\s\S]*WrongQuestionProjectionService/);
});

function practiceRecord(overrides) {
  return {
    id: overrides.id,
    userId: overrides.userId,
    questionId: overrides.questionId,
    knowledgePointId: 'co-cache',
    selectedAnswer: 'A',
    correct: overrides.correct,
    timeSpentSec: 60,
    mistakeReason: overrides.mistakeReason,
    submittedAt: '2026-08-22T08:00:00.000Z',
    variantQuestionId: null,
  };
}

function countOccurrences(value, pattern) {
  return (value.match(new RegExp(pattern, 'g')) ?? []).length;
}
