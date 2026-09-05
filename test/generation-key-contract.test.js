import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const {
  createAiCoachGenerationKey,
  createLearningLoopGenerationKey,
  createManualGenerationKey,
} = require('../apps/api/src/study/generation-key.ts');

test('learning-loop generation keys are deterministic for the same inputs', () => {
  const input = ['user-1', '2026-09-03', 'v1'];
  assert.equal(
    createLearningLoopGenerationKey(...input),
    'LEARNING_LOOP:user-1:2026-09-03:v1',
  );
  assert.equal(
    createLearningLoopGenerationKey(...input),
    createLearningLoopGenerationKey(...input),
  );
});

test('generation namespaces remain isolated', () => {
  const learningLoop = createLearningLoopGenerationKey('user-1', '2026-09-03');
  const manual = createManualGenerationKey('user-1', '2026-09-03', 'request-1');
  const aiCoach = createAiCoachGenerationKey('user-1', '2026-09-03', 'context-1');

  assert.equal(learningLoop, 'LEARNING_LOOP:user-1:2026-09-03:v1');
  assert.equal(manual, 'MANUAL:user-1:2026-09-03:request-1');
  assert.equal(aiCoach, 'AI_COACH:user-1:2026-09-03:context-1:v1');
  assert.equal(new Set([learningLoop, manual, aiCoach]).size, 3);
});

test('learning-loop version changes create a distinct generation identity', () => {
  assert.notEqual(
    createLearningLoopGenerationKey('user-1', '2026-09-03', 'v1'),
    createLearningLoopGenerationKey('user-1', '2026-09-03', 'v2'),
  );
});

test('manual request keys distinguish retries from new generations', () => {
  assert.notEqual(
    createManualGenerationKey('user-1', '2026-09-03', 'request-a'),
    createManualGenerationKey('user-1', '2026-09-03', 'request-b'),
  );
});

test('generation identity rejects empty required inputs', () => {
  assert.throws(() => createLearningLoopGenerationKey('', '2026-09-03'), /userId/);
  assert.throws(() => createLearningLoopGenerationKey('user-1', ''), /scheduledDate/);
  assert.throws(() => createLearningLoopGenerationKey('user-1', '2026-09-03', ''), /version/);
  assert.throws(() => createManualGenerationKey('user-1', '2026-09-03', ''), /requestKey/);
  assert.throws(() => createAiCoachGenerationKey('user-1', '2026-09-03', ''), /contextHash/);
});
