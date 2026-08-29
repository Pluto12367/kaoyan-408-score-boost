import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('sprint-plan controller route delegates to StudentStateSprintPlanQueryService', () => {
  const { StudyController } = require('../apps/api/src/study/study.controller.ts');
  const legacyCalls = [];
  const sprintQueryCalls = [];
  const controller = new StudyController(
    {
      getSprintPlan(userId) {
        legacyCalls.push(userId);
        return { source: 'legacy' };
      },
      assertTeacherAuthorizedForStudent() {},
    },
    {},
    {},
    {},
    {
      getSprintPlanCompat(userId) {
        sprintQueryCalls.push(userId);
        return { source: 'student-state-sprint-plan', userId };
      },
    },
  );

  const result = controller.getSprintPlan({ id: 'u-1', role: 'student' });

  assert.deepEqual(result, { source: 'student-state-sprint-plan', userId: 'u-1' });
  assert.deepEqual(sprintQueryCalls, ['u-1']);
  assert.deepEqual(legacyCalls, []);
});

test('StudyModule registers StudentStateSprintPlanQueryService as a provider', () => {
  const moduleSource = readFileSync('apps/api/src/study/study.module.ts', 'utf8');

  assert.match(moduleSource, /StudentStateSprintPlanQueryService/);
  assert.match(moduleSource, /providers:\s*\[[\s\S]*StudentStateSprintPlanQueryService/);
});
