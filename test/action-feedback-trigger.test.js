import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { ActionFeedbackTriggerService } = require('../apps/api/src/study/action-feedback-trigger.service.ts');
const { StudyService } = require('../apps/api/src/study/study.service.ts');

function createTrigger(consumeAction = async () => undefined) {
  const calls = [];
  const consumer = {
    async consumeAction(userId, actionId) {
      calls.push([userId, actionId]);
      return consumeAction(userId, actionId);
    },
  };
  return { service: new ActionFeedbackTriggerService(consumer), calls };
}

test('action id triggers signal consumer after a committed outcome', async () => {
  const { service, calls } = createTrigger();

  await service.trigger('user-1', 'action-1');

  assert.deepEqual(calls, [['user-1', 'action-1']]);
});

test('null action id skips feedback trigger', async () => {
  const { service, calls } = createTrigger();

  await service.trigger('user-1', null);

  assert.deepEqual(calls, []);
});

test('consumer failure is swallowed by the best-effort trigger', async () => {
  const { service } = createTrigger(async () => {
    throw new Error('feedback unavailable');
  });

  await assert.doesNotReject(() => service.trigger('user-1', 'action-1'));
});

test('successful practice persistence triggers feedback after the action is resolved from its session', async () => {
  const calls = [];
  const service = createStudyService({
    actionFeedbackTrigger: { trigger: async (...args) => calls.push(args) },
  });
  service.practiceSessions.set('session-1', { id: 'session-1', userId: 'user-1', actionId: 'action-1' });

  await service.createPracticeRecord({
    userId: 'user-1',
    questionId: 'question-1',
    knowledgePointId: 'point-1',
    selectedAnswer: 'A',
    timeSpentSec: 30,
    sessionId: 'session-1',
  });

  assert.deepEqual(calls, [['user-1', 'action-1']]);
});

test('practice persistence failure does not trigger feedback', async () => {
  const calls = [];
  const service = createStudyService({
    actionFeedbackTrigger: { trigger: async (...args) => calls.push(args) },
    savePractice: async () => { throw new Error('practice write failed'); },
  });
  service.practiceSessions.set('session-1', { id: 'session-1', userId: 'user-1', actionId: 'action-1' });

  await assert.rejects(() => service.createPracticeRecord({
    userId: 'user-1',
    questionId: 'question-1',
    knowledgePointId: 'point-1',
    selectedAnswer: 'A',
    timeSpentSec: 30,
    sessionId: 'session-1',
  }), /practice write failed/);
  assert.deepEqual(calls, []);
});

test('review reason recording without a ReviewAttempt does not trigger feedback', async () => {
  const calls = [];
  const service = createStudyService({
    actionFeedbackTrigger: { trigger: async (...args) => calls.push(args) },
    action: { id: 'action-1', userId: 'user-1', status: 'STARTED' },
  });
  service.records.push({
    id: 'wrong-1', userId: 'user-1', questionId: 'question-1', knowledgePointId: 'point-1',
    selectedAnswer: 'B', correct: false, timeSpentSec: 30, expectedTimeSec: 60,
    mistakeReason: '概念不清', submittedAt: '2026-09-02T00:00:00.000Z',
  });

  await service.reportWrongReason('question-1', 'user-1', {
    selfReportedReason: '概念不清',
    redoCorrect: false,
    timeSpentSec: 30,
    isReview: false,
    actionId: 'action-1',
  });

  assert.deepEqual(calls, []);
});

test('successful ReviewAttempt persistence triggers feedback after saveReview returns', async () => {
  const calls = [];
  const service = createStudyService({
    actionFeedbackTrigger: { trigger: async (...args) => calls.push(args) },
    action: { id: 'action-1', userId: 'user-1', status: 'STARTED' },
  });
  service.records.push({
    id: 'wrong-1', userId: 'user-1', questionId: 'question-1', knowledgePointId: 'point-1',
    selectedAnswer: 'B', correct: false, timeSpentSec: 30, expectedTimeSec: 60,
    mistakeReason: '概念不清', submittedAt: '2026-09-02T00:00:00.000Z',
  });

  await service.reportWrongReason('question-1', 'user-1', {
    selfReportedReason: '概念不清',
    redoCorrect: true,
    timeSpentSec: 30,
    isReview: true,
    actionId: 'action-1',
  });

  assert.deepEqual(calls, [['user-1', 'action-1']]);
});

test('practice persistence failure cannot reach the post-commit trigger', async () => {
  const source = await readFile('apps/api/src/study/study.service.ts', 'utf8');
  const start = source.indexOf('private async createPracticeRecordLegacy(');
  const end = source.indexOf('private async createPracticeRecordWithReceipt(', start);
  const segment = source.slice(start, end);

  assert.ok(start >= 0, 'legacy practice path must exist');
  assert.ok(end > start, 'legacy practice path boundary must exist');
  assert.match(segment, /const savedRecord = this\.prisma[\s\S]*?await this\.practiceRecordRepository\.save\(record/);
  assert.match(segment, /const savedRecord = this\.prisma[\s\S]*?\n    if \(this\.prisma\) await this\.refreshNodeMasteryCache/);
  assert.match(segment, /this\.triggerActionFeedback\(input\.userId, savedRecord\.actionId\);/);
  assert.ok(segment.indexOf('this.triggerActionFeedback') > segment.indexOf('const savedRecord = this.prisma'));
});

test('review without a ReviewAttempt cannot reach the post-commit trigger', async () => {
  const source = await readFile('apps/api/src/study/study.service.ts', 'utf8');
  const start = source.indexOf('async reportWrongReason(');
  const end = source.indexOf('async updateWrongQuestionNote(', start);
  const segment = source.slice(start, end);

  assert.ok(start >= 0, 'review path must exist');
  assert.ok(end > start, 'review path boundary must exist');
  assert.match(segment, /if \(input\.isReview === false\) \{[\s\S]*?return \{/);
  assert.match(segment, /await this\.reviewScheduleRepository\.saveReview\(schedule, attempt\);[\s\S]*?this\.triggerActionFeedback\(userId, actionId\);/);
  assert.ok(segment.indexOf('this.triggerActionFeedback(userId, actionId);') > segment.indexOf('await this.reviewScheduleRepository.saveReview(schedule, attempt);'));
});

test('study module wires the feedback trigger after the signal consumer', async () => {
  const source = await readFile('apps/api/src/study/study.module.ts', 'utf8');
  assert.match(source, /import \{ ActionFeedbackTriggerService \} from '\.\/action-feedback-trigger\.service';/);
  assert.match(source, /ActionLearningSignalConsumerService, ActionFeedbackTriggerService/);
});

function createStudyService({ actionFeedbackTrigger, savePractice, action } = {}) {
  const question = {
    id: 'question-1',
    type: '单选题',
    stem: 'A question',
    answer: 'A',
    expectedTimeSec: 60,
    knowledgePointIds: ['point-1'],
  };
  const questions = {
    listQuestions: () => [question],
    findQuestionById: async (id) => (id === question.id ? question : null),
  };
  const practiceRecords = {
    enabled: false,
    save: savePractice ?? (async (record) => record),
  };
  const learningProgress = {
    enabled: false,
    saveWrongQuestionReview: async () => undefined,
  };
  const reviewSchedules = {
    enabled: false,
    saveSchedule: async () => undefined,
    saveReview: async () => undefined,
    findAttemptByIdempotencyKey: async () => null,
  };
  const actionService = {
    getAction: async (userId, actionId) => ({
      ...(action ?? { id: actionId, userId, status: 'STARTED' }),
      id: actionId,
      userId,
    }),
  };
  const service = new StudyService(
    questions,
    {},
    practiceRecords,
    learningProgress,
    {},
    {},
    {},
    {},
    {},
    {},
    reviewSchedules,
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    { record: async () => undefined },
    { applyAttempts: async () => undefined, applyReview: async () => undefined },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    actionService,
    actionFeedbackTrigger,
  );
  service.applyPracticeProgressToTasks = async () => undefined;
  service.trackUserEvent = async () => undefined;
  return service;
}
