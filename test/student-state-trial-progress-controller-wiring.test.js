import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('trial-progress controller route delegates to StudentStateTrialProgressQueryService', () => {
  const { StudyController } = require('../apps/api/src/study/study.controller.ts');
  const legacyCalls = [];
  const trialQueryCalls = [];
  const controller = new StudyController(
    {
      getTrialProgress(userId) {
        legacyCalls.push(userId);
        return { source: 'legacy' };
      },
      assertTeacherAuthorizedForStudent() {},
    },
    {},
    {},
    {},
    {},
    {
      getTrialProgressCompat(userId) {
        trialQueryCalls.push(userId);
        return { source: 'student-state-trial-progress', userId };
      },
    },
  );

  const result = controller.getTrialProgress({ id: 'u-1', role: 'student' });

  assert.deepEqual(result, { source: 'student-state-trial-progress', userId: 'u-1' });
  assert.deepEqual(trialQueryCalls, ['u-1']);
  assert.deepEqual(legacyCalls, []);
});

test('StudyModule registers StudentStateTrialProgressQueryService as a provider', () => {
  const moduleSource = readFileSync('apps/api/src/study/study.module.ts', 'utf8');

  assert.match(moduleSource, /StudentStateTrialProgressQueryService/);
  assert.match(moduleSource, /providers:\s*\[[\s\S]*StudentStateTrialProgressQueryService/);
});
