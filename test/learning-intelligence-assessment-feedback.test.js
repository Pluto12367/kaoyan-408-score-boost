import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');
const { StudyService } = require('../apps/api/src/study/study.service.ts');

function harness() {
  const service = Object.create(StudyService.prototype);
  const calls = [];
  service.student = { id: 'u-1' };
  service.createPracticeRecord = async (input) => { calls.push('practice'); return { ...input, id: 'record-1' }; };
  service.createStageAssessmentResult = async () => { calls.push('result'); return { id: 'stage-result-1', score: 100 }; };
  service.learningLoopTrigger = { maybeGenerateLearningLoopPlan: async (userId, input) => { calls.push({ userId, ...input }); } };
  service.logger = { warn() {} };
  return { service, calls };
}
const input = { userId: 'u-1', answers: [{ questionId: 'q-1', selectedAnswer: 'A', timeSpentSec: 20 }] };

test('direct stage assessment triggers the next recommendation only after its result exists', async () => {
  const { service, calls } = harness();
  const result = await service.submitStageAssessment(input);
  assert.deepEqual(result, { id: 'stage-result-1', score: 100 });
  assert.deepEqual(calls, ['practice', 'result', { userId: 'u-1', triggerType: 'stage_assessment', sourceId: 'stage-result-1' }]);
});

test('failed stage result never triggers a recommendation', async () => {
  const { service, calls } = harness();
  service.createStageAssessmentResult = async () => { throw new Error('result failed'); };
  await assert.rejects(service.submitStageAssessment(input), /result failed/);
  assert.deepEqual(calls, ['practice']);
});

test('failed recommendation does not erase a successful direct assessment result', async () => {
  const { service } = harness();
  service.learningLoopTrigger.maybeGenerateLearningLoopPlan = async () => { throw new Error('recommendation failed'); };
  assert.equal((await service.submitStageAssessment(input)).score, 100);
});
