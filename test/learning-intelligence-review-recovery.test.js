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
  Object.assign(service, {
    reviewSchedules: new Map(), reviewAttemptsByKey: new Map(), wrongQuestionReviewDatesByUser: new Map(),
    records: [{ id: 'record-1', userId: 'u-1', questionId: 'q-1', correct: false, expectedTimeSec: 60,
      mistakeReason: '概念不清', timeSpentSec: 30, submittedAt: '2026-09-01T00:00:00.000Z' }],
    reviewScheduleRepository: {
      findAttemptByIdempotencyKey: async () => null,
      saveSchedule: async () => undefined,
      saveReview: async () => undefined,
    },
    learningProgressRepository: { saveWrongQuestionReview: async () => undefined },
    refreshNodeMasteryCache: async () => undefined,
    triggerActionFeedback: () => undefined,
  });
  return service;
}
const input = { selfReportedReason: '概念不清', redoCorrect: true, timeSpentSec: 30, isReview: true, idempotencyKey: 'retry-1' };

test('failed review persistence leaves no schedule or idempotency cache and the retry actually persists', async () => {
  const service = harness();
  let writes = 0;
  service.reviewScheduleRepository.saveReview = async () => {
    if (++writes === 1) throw new Error('review storage unavailable');
  };
  await assert.rejects(service.reportWrongReason('q-1', 'u-1', input), /review storage unavailable/);
  assert.equal(service.reviewSchedules.size, 0, 'failed transaction must not publish a schedule');
  assert.equal(service.reviewAttemptsByKey.size, 0, 'failed attempt must not become a successful replay');
  const result = await service.reportWrongReason('q-1', 'u-1', input);
  assert.equal(writes, 2);
  assert.equal(result.reviewCount, 1);
  assert.equal(result.consecutiveCorrect, 1);
  await service.reportWrongReason('q-1', 'u-1', input);
  assert.equal(writes, 2, 'successful attempt is deduplicated');
});

test('failed reason-only persistence preserves the prior schedule', async () => {
  const service = harness();
  const prior = { questionId: 'q-1', userId: 'u-1', note: 'retain me', reviewCount: 2,
    consecutiveCorrect: 1, stability: 'review', nextReviewAt: '2026-09-08T00:00:00.000Z' };
  service.reviewSchedules.set('u-1@q-1', prior);
  service.reviewScheduleRepository.saveSchedule = async () => { throw new Error('reason storage unavailable'); };
  await assert.rejects(service.reportWrongReason('q-1', 'u-1', { ...input, isReview: false }), /reason storage unavailable/);
  assert.deepEqual(service.reviewSchedules.get('u-1@q-1'), prior);
});

test('failed subsequent review preserves the committed attempt array and schedule', async () => {
  const service = harness();
  await service.reportWrongReason('q-1', 'u-1', input);
  const prior = structuredClone(service.reviewSchedules.get('u-1@q-1'));
  service.reviewScheduleRepository.saveReview = async () => { throw new Error('second write failed'); };
  await assert.rejects(service.reportWrongReason('q-1', 'u-1', { ...input, idempotencyKey: 'retry-2' }), /second write failed/);
  assert.deepEqual(service.reviewSchedules.get('u-1@q-1'), prior);
  assert.equal(service.reviewAttemptsByKey.get('u-1@q-1').length, 1);
});

test('mastery failure rolls back the review facts and permits retrying the same identity', async () => {
  const service = harness();
  const committed = [];
  let activeTx;
  let failMastery = true;
  service.prisma = { $transaction: async (work) => {
    const tx = { pending: [] };
    activeTx = tx;
    try { const result = await work(tx); committed.push(...tx.pending); return result; }
    finally { activeTx = undefined; }
  } };
  service.logger = { error() {} };
  service.reviewScheduleRepository.enabled = true;
  service.reviewScheduleRepository.saveReview = async (_schedule, _attempt, tx) => {
    (tx?.pending ?? committed).push('attempt');
  };
  service.learningProgressRepository.saveWrongQuestionReview = async (_user, _question, _date, tx) => {
    (tx?.pending ?? committed).push('reviewed');
  };
  service.scoreCenterService = { applyReview: async (_user, _question, _input, tx) => {
    if (failMastery) throw new Error('mastery write failed');
    assert.equal(tx, activeTx, 'mastery must use the review transaction');
    tx.pending.push('mastery');
  } };
  await assert.rejects(service.reportWrongReason('q-1', 'u-1', input), /mastery write failed/);
  assert.deepEqual(committed, []);
  assert.equal(service.reviewAttemptsByKey.size, 0);
  assert.equal(service.wrongQuestionReviewDatesByUser.size, 0);
  failMastery = false;
  await service.reportWrongReason('q-1', 'u-1', input);
  assert.deepEqual(committed, ['attempt', 'reviewed', 'mastery']);
});
