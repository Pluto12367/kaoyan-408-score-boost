import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('review/due controller route delegates to WrongQuestionQueryService', async () => {
  const { StudyController } = require('../apps/api/src/study/study.controller.ts');
  const legacyCalls = [];
  const dueQueryCalls = [];
  const dto = {
    dueCount: 1,
    items: [
      {
        questionId: 'q-due',
        nextReviewAt: '2026-08-24T08:00:00.000Z',
        stability: 'learning',
      },
    ],
    nextAction: '立即复习 1 道到期错题，优先处理稳定度较低的题目。',
  };
  const controller = new StudyController(
    {
      getDueReviews(userId) {
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
    {
      getDueReviewsCompat(userId) {
        dueQueryCalls.push(userId);
        return dto;
      },
    },
  );

  const result = await controller.getDueReviews({ id: 'u-1', role: 'student' });

  assert.deepEqual(result, dto);
  assert.deepEqual(dueQueryCalls, ['u-1']);
  assert.deepEqual(legacyCalls, []);
});

test('review/due route keeps URL and uses getDueReviewsCompat in source', () => {
  const controllerSource = readFileSync('apps/api/src/study/study.controller.ts', 'utf8');
  const start = controllerSource.indexOf("@Get('review/due')");
  const end = controllerSource.indexOf("@Get('wrong-questions/:questionId/detail')");
  const routeBlock = controllerSource.slice(start, end);

  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  assert.match(routeBlock, /@Get\('review\/due'\)/);
  assert.match(routeBlock, /getDueReviews\(@CurrentUser\(\) user: UserProfile\)/);
  assert.match(routeBlock, /wrongQuestionQuery\.getDueReviewsCompat\(user\.id\)/);
  assert.doesNotMatch(routeBlock, /studyService\.getDueReviews/);
});

test('StudyModule registers WrongQuestion query providers', () => {
  const moduleSource = readFileSync('apps/api/src/study/study.module.ts', 'utf8');

  assert.match(moduleSource, /WrongQuestionQueryService/);
  assert.match(moduleSource, /WrongQuestionProjectionService/);
  assert.match(moduleSource, /providers:\s*\[[\s\S]*WrongQuestionQueryService/);
  assert.match(moduleSource, /providers:\s*\[[\s\S]*WrongQuestionProjectionService/);
});
