import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const { StudyService } = require('../apps/api/src/study/study.service.ts');
const { computePracticeRecordRequestHash } = require('../apps/api/src/study/answer-request-hash.ts');

test('schema defines AnswerReceipt as a per-user idempotency receipt without PracticeRecord foreign keys', async () => {
  const schema = await readFile('prisma/schema.prisma', 'utf8');
  assert.match(schema, /enum AnswerReceiptStatus\s*\{\s*PENDING\s+SUCCEEDED\s+FAILED\s*\}/);
  assert.match(schema, /model AnswerReceipt\s*\{/);
  assert.match(schema, /idempotencyKey\s+String/);
  assert.match(schema, /requestHash\s+String/);
  assert.match(schema, /hashVersion\s+String\s+@default\("v1"\)/);
  assert.match(schema, /responseSnapshot\s+Json\?/);
  assert.match(schema, /practiceRecordIds\s+String\[\]\s+@default\(\[\]\)/);
  assert.match(schema, /@@unique\(\[userId, idempotencyKey\]\)/);
  assert.doesNotMatch(schema, /answerReceiptId/);
});

test('request hash is stable for the same business payload and changes for a different answer', () => {
  const base = {
    userId: 'student-1',
    questionId: 'q-1',
    knowledgePointId: 'kp-1',
    selectedAnswer: 'A',
    timeSpentSec: 60,
    confidence: '确定',
    usedHint: false,
    answerModified: false,
  };

  const first = computePracticeRecordRequestHash(base);
  const samePayloadDifferentOrder = computePracticeRecordRequestHash({
    answerModified: false,
    usedHint: false,
    confidence: '确定',
    timeSpentSec: 60,
    selectedAnswer: 'A',
    knowledgePointId: 'kp-1',
    questionId: 'q-1',
    userId: 'student-1',
  });
  const changedAnswer = computePracticeRecordRequestHash({ ...base, selectedAnswer: 'B' });

  assert.equal(first, samePayloadDifferentOrder);
  assert.match(first, /^v1:[a-f0-9]{64}$/);
  assert.notEqual(first, changedAnswer);
});

test('single answer with a new idempotency key creates one PracticeRecord and a SUCCEEDED receipt', async () => {
  const harness = createStudyHarness();

  const response = await harness.service.createPracticeRecord(answerInput(), { idempotencyKey: 'key-1' });

  assert.equal(harness.sideEffects.savedRecords.length, 1);
  assert.equal(harness.receipts.get('student-1', 'key-1')?.status, 'SUCCEEDED');
  assert.deepEqual(harness.receipts.get('student-1', 'key-1')?.practiceRecordIds, [response.id]);
});

test('repeating the same idempotent single-answer request replays the exact first response', async () => {
  const harness = createStudyHarness();

  const first = await harness.service.createPracticeRecord(answerInput(), { idempotencyKey: 'key-2' });
  const second = await harness.service.createPracticeRecord(answerInput(), { idempotencyKey: 'key-2' });

  assert.equal(harness.sideEffects.savedRecords.length, 1);
  assert.deepEqual(second, first);
});

test('same idempotency key with a different body returns 409 and creates no second PracticeRecord', async () => {
  const harness = createStudyHarness();
  await harness.service.createPracticeRecord(answerInput(), { idempotencyKey: 'key-3' });

  await assert.rejects(
    () => harness.service.createPracticeRecord(answerInput({ selectedAnswer: 'A' }), { idempotencyKey: 'key-3' }),
    (error) => typeof error.getStatus === 'function' && error.getStatus() === 409,
  );
  assert.equal(harness.sideEffects.savedRecords.length, 1);
});

test('the same question answered again with a different idempotency key creates a second PracticeRecord', async () => {
  const harness = createStudyHarness();

  await harness.service.createPracticeRecord(answerInput(), { idempotencyKey: 'key-4a' });
  await harness.service.createPracticeRecord(answerInput(), { idempotencyKey: 'key-4b' });

  assert.equal(harness.sideEffects.savedRecords.length, 2);
});

test('concurrent duplicate idempotency keys do not execute the single-answer business path twice', async () => {
  const harness = createStudyHarness();
  const release = harness.pauseNextTransaction();

  const first = harness.service.createPracticeRecord(answerInput(), { idempotencyKey: 'key-5' });
  const second = harness.service.createPracticeRecord(answerInput(), { idempotencyKey: 'key-5' });
  await Promise.resolve();
  release();
  const results = await Promise.allSettled([first, second]);

  assert.equal(harness.sideEffects.savedRecords.length, 1);
  assert.ok(results.some((result) => result.status === 'fulfilled'));
  assert.ok(results.some((result) => result.status === 'rejected'
    && typeof result.reason.getStatus === 'function'
    && result.reason.getStatus() === 425));

  const replay = await harness.service.createPracticeRecord(answerInput(), { idempotencyKey: 'key-5' });
  assert.equal(replay.id, harness.sideEffects.savedRecords[0].id);
});

test('P2002 while creating PENDING is re-read and never runs the business path again', async () => {
  const harness = createStudyHarness();
  const replaySnapshot = {
    id: 'r-existing',
    userId: 'student-1',
    questionId: 'q-1',
    knowledgePointId: 'co-cache',
    selectedAnswer: 'B',
    correct: true,
    timeSpentSec: 60,
    expectedTimeSec: 100,
    mistakeReason: null,
    submittedAt: '2026-08-23T00:00:00.000Z',
    analysis: 'Cache analysis',
    correctAnswer: 'B',
    knowledgePointTitle: 'Cache 映射与替换',
  };
  harness.receipts.seedSucceeded({
    userId: 'student-1',
    idempotencyKey: 'key-p2002',
    requestHash: computePracticeRecordRequestHash(answerInput()),
    responseSnapshot: replaySnapshot,
    practiceRecordIds: ['r-existing'],
  });
  harness.receipts.hideNextFindByKey();

  const response = await harness.service.createPracticeRecord(answerInput(), { idempotencyKey: 'key-p2002' });

  assert.deepEqual(response, replaySnapshot);
  assert.equal(harness.sideEffects.savedRecords.length, 0);
});

test('receipt replay short-circuits in-memory and eventual side effects', async () => {
  const harness = createStudyHarness();
  const input = answerInput({ selectedAnswer: 'A', variantQuestionId: 'wrong-original' });

  await harness.service.createPracticeRecord(input, { idempotencyKey: 'key-6' });
  await harness.service.createPracticeRecord(input, { idempotencyKey: 'key-6' });

  assert.equal(harness.sideEffects.recordsPushed, 1);
  assert.equal(harness.sideEffects.reviewSchedules, 1);
  assert.equal(harness.sideEffects.taskProgress, 1);
  assert.equal(harness.sideEffects.variantRetests, 1);
});

test('batch practice submission without an idempotency key keeps the legacy createPracticeRecord path', async () => {
  const harness = createStudyHarness();

  await harness.service.submitPracticeSet('set-1', {
    userId: 'student-1',
    answers: [
      { questionId: 'q-1', selectedAnswer: 'B', timeSpentSec: 60 },
      { questionId: 'q-1', selectedAnswer: 'A', timeSpentSec: 70 },
    ],
  });

  assert.equal(harness.sideEffects.savedRecords.length, 2);
  assert.equal(harness.receipts.size, 0);
});

test('a failed first transaction does not leave a SUCCEEDED receipt or a partial PracticeRecord', async () => {
  const harness = createStudyHarness();
  harness.failNextTransaction(new Error('transaction failed'));

  await assert.rejects(
    () => harness.service.createPracticeRecord(answerInput(), { idempotencyKey: 'key-8' }),
    /transaction failed/,
  );

  assert.equal(harness.sideEffects.savedRecords.length, 0);
  assert.notEqual(harness.receipts.get('student-1', 'key-8')?.status, 'SUCCEEDED');
});

test('POST /practice-records controller requires Idempotency-Key', async () => {
  const controllerSource = await readFile('apps/api/src/study/study.controller.ts', 'utf8');
  assert.match(controllerSource, /@Headers\('idempotency-key'\)\s+idempotencyKey/);
  assert.match(controllerSource, /Idempotency-Key is required/);
});

test('submitPracticeAnswer retries HTTP 425 with the same generated Idempotency-Key', async () => {
  const calls = [];
  const fakeClient = `
    export const API_BASE_URL = 'http://api.test';
    export async function fetchWithAuth(url, init) {
      globalThis.__answerReceiptCalls.push({ url, init });
      if (globalThis.__answerReceiptCalls.length === 1) return new Response('', { status: 425 });
      return new Response(JSON.stringify({ id: 'r-1', correct: true, mistakeReason: null, timeSpentSec: 60, expectedTimeSec: 100, analysis: 'ok', correctAnswer: 'B', knowledgePointTitle: 'Cache' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
  `;
  globalThis.__answerReceiptCalls = calls;
  const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID: () => 'uuid-answer-1' },
  });
  try {
    const moduleSource = await readFile('apps/web/src/api/endpoints/practice.ts', 'utf8');
    const rewritten = moduleSource
      .replace("import { API_BASE_URL, fetchWithAuth } from '../client';", fakeClient)
      .replace(/import type [^\n]+;\n/g, '');
    const compiled = ts.transpileModule(rewritten, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const endpoint = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

    await endpoint.submitPracticeAnswer({
      questionId: 'q-1',
      knowledgePointId: 'kp-1',
      selectedAnswer: 'B',
      timeSpentSec: 60,
    });

    assert.equal(calls.length, 2);
    assert.equal(new Headers(calls[0].init.headers).get('Idempotency-Key'), 'uuid-answer-1');
    assert.equal(new Headers(calls[1].init.headers).get('Idempotency-Key'), 'uuid-answer-1');
  } finally {
    if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
    delete globalThis.__answerReceiptCalls;
  }
});

function answerInput(overrides = {}) {
  return {
    userId: 'student-1',
    questionId: 'q-1',
    knowledgePointId: 'co-cache',
    selectedAnswer: 'B',
    timeSpentSec: 60,
    ...overrides,
  };
}

function createStudyHarness() {
  const question = {
    id: 'q-1',
    stem: 'Cache hit question',
    options: ['A', 'B', 'C', 'D'],
    answer: 'B',
    analysis: 'Cache analysis',
    difficulty: '中等',
    type: '选择题',
    source: 'unit',
    expectedTimeSec: 100,
    knowledgePointIds: ['co-cache'],
  };
  const sideEffects = {
    savedRecords: [],
    masteryUpdates: 0,
    reviewSchedules: 0,
    taskProgress: 0,
    userEvents: 0,
    variantRetests: 0,
    recordsPushed: 0,
  };
  const receipts = new InMemoryReceipts();
  let failTransaction = null;
  let transactionPause = null;
  const prisma = {
    async $transaction(work) {
      if (failTransaction) {
        const error = failTransaction;
        failTransaction = null;
        throw error;
      }
      if (transactionPause) await transactionPause.promise;
      return work({});
    },
  };
  const questionsService = {
    listQuestions: () => [question],
    findQuestionById: async (id) => (id === question.id ? question : null),
  };
  const practiceRecordRepository = {
    enabled: true,
    save: async (record) => {
      sideEffects.savedRecords.push(record);
      return record;
    },
  };
  const reviewScheduleRepository = {
    enabled: true,
    saveSchedule: async () => {
      sideEffects.reviewSchedules += 1;
    },
  };
  const scoreCenterService = {
    applyAttempts: async () => {
      sideEffects.masteryUpdates += 1;
    },
  };
  const userEventRepository = {
    record: async () => {
      sideEffects.userEvents += 1;
    },
  };
  const unavailable = { enabled: false };
  const service = new StudyService(
    questionsService,
    unavailable,
    practiceRecordRepository,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    reviewScheduleRepository,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    unavailable,
    userEventRepository,
    scoreCenterService,
    prisma,
    receipts,
  );
  const records = service.records;
  const originalPush = records.push.bind(records);
  records.push = (...items) => {
    sideEffects.recordsPushed += items.length;
    return originalPush(...items);
  };
  service.applyPracticeProgressToTasks = async () => {
    sideEffects.taskProgress += 1;
  };
  service.applyVariantRetest = async () => {
    sideEffects.variantRetests += 1;
    return {
      originalQuestionId: 'wrong-original',
      consecutiveCorrect: 1,
      stability: 'review',
      nextReviewInDays: 3,
      message: 'variant ok',
    };
  };
  return {
    service,
    receipts,
    sideEffects,
    failNextTransaction(error) {
      failTransaction = error;
    },
    pauseNextTransaction() {
      let release;
      const promise = new Promise((resolve) => {
        release = resolve;
      });
      transactionPause = { promise };
      return () => {
        transactionPause = null;
        release();
      };
    },
  };
}

class InMemoryReceipts {
  constructor() {
    this.rows = new Map();
    this.size = 0;
    this.enabled = true;
    this.hideNextFind = false;
  }

  key(userId, idempotencyKey) {
    return `${userId}:${idempotencyKey}`;
  }

  get(userId, idempotencyKey) {
    return this.rows.get(this.key(userId, idempotencyKey));
  }

  async findByKey(userId, idempotencyKey) {
    if (this.hideNextFind) {
      this.hideNextFind = false;
      return null;
    }
    return this.get(userId, idempotencyKey) ?? null;
  }

  hideNextFindByKey() {
    this.hideNextFind = true;
  }

  seedSucceeded(input) {
    const row = {
      id: `receipt-${this.rows.size + 1}`,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      hashVersion: 'v1',
      status: 'SUCCEEDED',
      responseSnapshot: input.responseSnapshot,
      practiceRecordIds: input.practiceRecordIds,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(this.key(input.userId, input.idempotencyKey), row);
    this.size = this.rows.size;
  }

  async createPending(input) {
    const key = this.key(input.userId, input.idempotencyKey);
    if (this.rows.has(key)) {
      const error = new Error('unique');
      error.code = 'P2002';
      throw error;
    }
    const row = {
      id: `receipt-${this.rows.size + 1}`,
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      requestHash: input.requestHash,
      hashVersion: input.hashVersion,
      status: 'PENDING',
      responseSnapshot: null,
      practiceRecordIds: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.rows.set(key, row);
    this.size = this.rows.size;
    return row;
  }

  async takeOverPending(input) {
    const row = this.get(input.userId, input.idempotencyKey);
    if (!row || row.status !== 'PENDING') return false;
    row.updatedAt = input.updatedAt;
    return true;
  }

  async markSucceeded(_tx, input) {
    const row = [...this.rows.values()].find((candidate) => candidate.id === input.id);
    row.status = 'SUCCEEDED';
    row.responseSnapshot = input.responseSnapshot;
    row.practiceRecordIds = input.practiceRecordIds;
    row.updatedAt = new Date();
    return row;
  }

  async markFailed(input) {
    const row = [...this.rows.values()].find((candidate) => candidate.id === input.id);
    if (!row || row.status === 'SUCCEEDED') return null;
    row.status = 'FAILED';
    row.responseSnapshot = input.responseSnapshot;
    row.updatedAt = new Date();
    return row;
  }
}
