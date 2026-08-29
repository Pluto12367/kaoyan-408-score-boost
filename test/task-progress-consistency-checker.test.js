import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

const {
  TaskProgressAuditToolService,
} = require('../apps/api/src/study/task-progress-consistency-checker.service.ts');

const AS_OF = new Date('2026-08-23T04:00:00.000+08:00');
const THREE_DAYS_BEFORE = '2026-08-20T10:00:00.000+08:00';

test('flags HIGH missing progress for a succeeded receipt with one active task candidate', async () => {
  const audit = createAuditHarness({
    receipts: [receipt({ practiceRecordIds: ['pr-1'] })],
    records: [practiceRecord({ id: 'pr-1', correct: true, timeSpentSec: 90 })],
    tasks: [task({ id: 'task-1', questionCount: 5 })],
    progress: [progress({ taskId: 'task-1', completedQuestionCount: 0 })],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  const finding = find(result.findings, 'MISSING_PROGRESS');
  assert.equal(finding.confidence, 'HIGH');
  assert.equal(finding.receiptId, 'receipt-1');
  assert.equal(finding.practiceRecordId, 'pr-1');
  assert.equal(finding.candidateTaskId, 'task-1');
  assert.deepEqual(finding.expectedDelta, { completedQuestionCount: 1, correctCount: 1, minutesSpent: 2 });
  assert.equal(finding.currentProgress.completedQuestionCount, 0);
});

test('does not flag a succeeded receipt whose progress has already been applied', async () => {
  const audit = createAuditHarness({
    receipts: [receipt({ practiceRecordIds: ['pr-1'] })],
    records: [practiceRecord({ id: 'pr-1', correct: false, timeSpentSec: 30 })],
    tasks: [task({ id: 'task-1', questionCount: 5 })],
    progress: [progress({ taskId: 'task-1', completedQuestionCount: 1, correctCount: 0, minutesSpent: 1 })],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  assert.equal(result.findings.some((finding) => finding.findingType === 'MISSING_PROGRESS'), false);
  assert.equal(result.findings.some((finding) => finding.findingType === 'AGGREGATE_MISMATCH'), false);
});

test('classifies multiple active task candidates as MEDIUM confidence', async () => {
  const audit = createAuditHarness({
    receipts: [receipt({ practiceRecordIds: ['pr-1'] })],
    records: [practiceRecord({ id: 'pr-1' })],
    tasks: [
      task({ id: 'task-1' }),
      task({ id: 'task-2' }),
    ],
    progress: [],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  const finding = find(result.findings, 'MISSING_PROGRESS');
  assert.equal(finding.confidence, 'MEDIUM');
  assert.equal(finding.candidateTaskId, 'task-1');
  assert.match(finding.reason, /multiple candidate tasks/i);
});

test('reports EMPTY_RECEIPT when a succeeded receipt has no practiceRecordIds', async () => {
  const audit = createAuditHarness({
    receipts: [receipt({ id: 'receipt-empty', practiceRecordIds: [] })],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  const finding = find(result.findings, 'EMPTY_RECEIPT');
  assert.equal(finding.confidence, 'UNKNOWN');
  assert.equal(finding.receiptId, 'receipt-empty');
  assert.match(finding.reason, /no practiceRecordIds/i);
});

test('does not turn completed tasks into missing-progress repair candidates', async () => {
  const audit = createAuditHarness({
    receipts: [receipt({ practiceRecordIds: ['pr-1'] })],
    records: [practiceRecord({ id: 'pr-1' })],
    tasks: [task({ id: 'task-1', status: 'completed', completed: true })],
    completions: [completion({ taskId: 'task-1' })],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  assert.equal(result.findings.some((finding) => finding.findingType === 'MISSING_PROGRESS'), false);
});

test('ignores stale or pending receipts because the audit only reasons from SUCCEEDED receipts', async () => {
  const audit = createAuditHarness({
    receipts: [receipt({ id: 'receipt-pending', status: 'PENDING', practiceRecordIds: ['pr-1'] })],
    records: [practiceRecord({ id: 'pr-1' })],
    tasks: [task({ id: 'task-1' })],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  assert.equal(result.findings.length, 0);
});

test('does not report aggregate mismatch when expected and actual totals balance', async () => {
  const audit = createAuditHarness({
    receipts: [
      receipt({ id: 'receipt-1', practiceRecordIds: ['pr-1'] }),
      receipt({ id: 'receipt-2', practiceRecordIds: ['pr-2'] }),
    ],
    records: [
      practiceRecord({ id: 'pr-1', correct: true }),
      practiceRecord({ id: 'pr-2', correct: false }),
    ],
    tasks: [task({ id: 'task-1', questionCount: 5 })],
    progress: [progress({ taskId: 'task-1', completedQuestionCount: 2, correctCount: 1, minutesSpent: 2 })],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  assert.equal(result.findings.some((finding) => finding.findingType === 'AGGREGATE_MISMATCH'), false);
});

test('reports aggregate mismatch when expected contribution exceeds actual progress', async () => {
  const audit = createAuditHarness({
    receipts: [
      receipt({ id: 'receipt-1', practiceRecordIds: ['pr-1'] }),
      receipt({ id: 'receipt-2', practiceRecordIds: ['pr-2'] }),
      receipt({ id: 'receipt-3', practiceRecordIds: ['pr-3'] }),
    ],
    records: [
      practiceRecord({ id: 'pr-1' }),
      practiceRecord({ id: 'pr-2' }),
      practiceRecord({ id: 'pr-3' }),
    ],
    tasks: [task({ id: 'task-1', questionCount: 6 })],
    progress: [progress({ taskId: 'task-1', completedQuestionCount: 1 })],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  const finding = find(result.findings, 'AGGREGATE_MISMATCH');
  assert.equal(finding.expectedDelta.completedQuestionCount, 3);
  assert.equal(finding.currentProgress.completedQuestionCount, 1);
  assert.match(finding.reason, /possible missed apply/i);
});

test('downgrades postponed task attribution to LOW confidence', async () => {
  const audit = createAuditHarness({
    receipts: [receipt({ practiceRecordIds: ['pr-1'] })],
    records: [practiceRecord({ id: 'pr-1' })],
    tasks: [task({ id: 'task-1', status: 'postponed', nextAvailableAt: '2026-08-24T00:00:00.000Z' })],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  assert.equal(find(result.findings, 'MISSING_PROGRESS').confidence, 'LOW');
});

test('treats cross-day attribution without a same-day task as unresolved', async () => {
  const audit = createAuditHarness({
    receipts: [receipt({ practiceRecordIds: ['pr-1'] })],
    records: [practiceRecord({ id: 'pr-1', submittedAt: '2026-08-22T12:00:00.000+08:00' })],
    tasks: [task({ id: 'task-1', scheduledDate: '2026-08-23' })],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  const finding = find(result.findings, 'UNRESOLVED_ATTRIBUTION');
  assert.equal(finding.confidence, 'UNKNOWN');
  assert.equal(finding.practiceRecordId, 'pr-1');
});

test('does not force old PracticeRecord rows onto current unfinished tasks through fallback', async () => {
  const audit = createAuditHarness({
    receipts: [receipt({ practiceRecordIds: ['pr-old'] })],
    records: [practiceRecord({ id: 'pr-old', submittedAt: THREE_DAYS_BEFORE })],
    tasks: [
      task({ id: 'task-current-1', scheduledDate: '2026-08-23' }),
      task({ id: 'task-current-2', scheduledDate: '2026-08-23' }),
    ],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  assert.equal(result.findings.some((finding) =>
    finding.findingType === 'MISSING_PROGRESS'
    && ['HIGH', 'MEDIUM'].includes(finding.confidence)), false);
  const unresolved = find(result.findings, 'UNRESOLVED_ATTRIBUTION');
  assert.equal(unresolved.confidence, 'UNKNOWN');
  assert.equal(unresolved.practiceRecordId, 'pr-old');
});

test('models the post-commit gap as missing progress instead of duplicate application', async () => {
  const audit = createAuditHarness({
    receipts: [receipt({ practiceRecordIds: ['pr-gap'] })],
    records: [practiceRecord({ id: 'pr-gap', correct: true, timeSpentSec: 61 })],
    tasks: [task({ id: 'task-1', questionCount: 3 })],
    progress: [],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  const finding = find(result.findings, 'MISSING_PROGRESS');
  assert.equal(finding.practiceRecordId, 'pr-gap');
  assert.equal(finding.expectedDelta.minutesSpent, 1);
  assert.doesNotMatch(finding.reason, /double/i);
});

test('uses only read methods on the audit reader', async () => {
  const audit = createAuditHarness({
    receipts: [receipt({ practiceRecordIds: ['pr-1'] })],
    records: [practiceRecord({ id: 'pr-1' })],
    tasks: [task({ id: 'task-1' })],
  });

  await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  assert.deepEqual(audit.writeCalls, []);
});

test('routes session records into aggregate analysis with UNKNOWN confidence', async () => {
  const audit = createAuditHarness({
    records: [practiceRecord({ id: 'pr-session', sessionId: 'session-1' })],
    sessions: [session({ id: 'session-1', type: 'paper' })],
    tasks: [task({ id: 'task-1', questionCount: 5 })],
    progress: [],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  const finding = find(result.findings, 'AGGREGATE_MISMATCH');
  assert.equal(finding.confidence, 'UNKNOWN');
  assert.match(finding.reason, /session|paper|stage/i);
});

test('reports stalled tasks when records exceed partial progress and no completion exists', async () => {
  const audit = createAuditHarness({
    records: [
      practiceRecord({ id: 'pr-1' }),
      practiceRecord({ id: 'pr-2' }),
      practiceRecord({ id: 'pr-3' }),
    ],
    tasks: [task({ id: 'task-1', questionCount: 5 })],
    progress: [progress({ taskId: 'task-1', completedQuestionCount: 1 })],
    completions: [],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  const finding = find(result.findings, 'STALLED_TASK');
  assert.equal(finding.candidateTaskId, 'task-1');
  assert.equal(finding.currentProgress.completedQuestionCount, 1);
  assert.equal(finding.expectedDelta.completedQuestionCount, 3);
});

test('does not report a HIGH stalled deficit for a sibling task when same-day completed siblings consumed records', async () => {
  const audit = createAuditHarness({
    records: [
      practiceRecord({ id: 'pr-1' }),
      practiceRecord({ id: 'pr-2' }),
      practiceRecord({ id: 'pr-3' }),
      practiceRecord({ id: 'pr-4' }),
      practiceRecord({ id: 'pr-5' }),
    ],
    tasks: [
      task({ id: 'task-a', questionCount: 3, status: 'completed', completed: true }),
      task({ id: 'task-b', questionCount: 5, status: 'in_progress' }),
    ],
    progress: [progress({ taskId: 'task-b', completedQuestionCount: 2 })],
    completions: [completion({ taskId: 'task-a', completedQuestionCount: 3, correctCount: 2, minutesSpent: 3 })],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  const stalled = result.findings.find((finding) =>
    finding.findingType === 'STALLED_TASK' && finding.candidateTaskId === 'task-b');
  assert.notEqual(stalled?.confidence, 'HIGH');
  assert.notEqual(stalled?.expectedDelta.completedQuestionCount, 5);
});

test('returns an empty result for empty input', async () => {
  const audit = createAuditHarness();

  const result = await audit.service.audit({ asOf: AS_OF });

  assert.deepEqual(result.findings, []);
});

test('reports disabled mode instead of a clean zero-finding audit when DATABASE_URL is unavailable', async () => {
  const audit = createAuditHarness({ available: false });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  assert.equal(result.mode, 'disabled');
  assert.match(result.unavailableReason, /DATABASE_URL/i);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(audit.readCalls, []);
});

test('reports broken receipts when a succeeded receipt points to a missing PracticeRecord', async () => {
  const audit = createAuditHarness({
    receipts: [receipt({ id: 'receipt-broken', practiceRecordIds: ['missing-pr'] })],
  });

  const result = await audit.service.audit({ userId: 'u-1', asOf: AS_OF });

  const finding = find(result.findings, 'BROKEN_RECEIPT');
  assert.equal(finding.confidence, 'UNKNOWN');
  assert.equal(finding.receiptId, 'receipt-broken');
  assert.equal(finding.practiceRecordId, 'missing-pr');
});

function find(findings, findingType) {
  const finding = findings.find((item) => item.findingType === findingType);
  assert.ok(finding, `expected ${findingType} finding`);
  return finding;
}

function createAuditHarness(seed = {}) {
  const rows = {
    receipts: seed.receipts ?? [],
    records: seed.records ?? [],
    tasks: seed.tasks ?? [],
    progress: seed.progress ?? [],
    completions: seed.completions ?? [],
    sessions: seed.sessions ?? [],
  };
  const writeCalls = [];
  const readCalls = [];
  const service = new TaskProgressAuditToolService({
    isAvailable() {
      return seed.available !== false;
    },
    async listAnswerReceipts(input = {}) {
      readCalls.push('listAnswerReceipts');
      return rows.receipts.filter((item) => !input.userId || item.userId === input.userId);
    },
    async listPracticeRecords(input = {}) {
      readCalls.push('listPracticeRecords');
      return rows.records.filter((item) => !input.userId || item.userId === input.userId);
    },
    async listStudyTasks(input = {}) {
      readCalls.push('listStudyTasks');
      return rows.tasks.filter((item) => !input.userId || item.userId === input.userId);
    },
    async listStudyTaskProgress(input = {}) {
      readCalls.push('listStudyTaskProgress');
      return rows.progress.filter((item) => !input.userId || item.userId === input.userId);
    },
    async listStudyTaskCompletions(input = {}) {
      readCalls.push('listStudyTaskCompletions');
      return rows.completions.filter((item) => !input.userId || item.userId === input.userId);
    },
    async listLearningSessions(input = {}) {
      readCalls.push('listLearningSessions');
      return rows.sessions.filter((item) => !input.userId || item.userId === input.userId);
    },
    create(...args) {
      writeCalls.push(['create', args]);
      throw new Error('write method must not be called');
    },
    update(...args) {
      writeCalls.push(['update', args]);
      throw new Error('write method must not be called');
    },
    upsert(...args) {
      writeCalls.push(['upsert', args]);
      throw new Error('write method must not be called');
    },
    delete(...args) {
      writeCalls.push(['delete', args]);
      throw new Error('write method must not be called');
    },
    $transaction(...args) {
      writeCalls.push(['$transaction', args]);
      throw new Error('transaction must not be called');
    },
  });
  return { service, writeCalls, readCalls };
}

function receipt(overrides = {}) {
  return {
    id: 'receipt-1',
    userId: 'u-1',
    status: 'SUCCEEDED',
    practiceRecordIds: [],
    createdAt: new Date('2026-08-23T00:00:00.000+08:00'),
    updatedAt: new Date('2026-08-23T00:00:01.000+08:00'),
    ...overrides,
  };
}

function practiceRecord(overrides = {}) {
  return {
    id: 'pr-1',
    userId: 'u-1',
    questionId: 'q-1',
    knowledgePointId: 'kp-a',
    correct: true,
    timeSpentSec: 60,
    submittedAt: '2026-08-23T01:00:00.000+08:00',
    sessionId: undefined,
    ...overrides,
  };
}

function task(overrides = {}) {
  return {
    id: 'task-1',
    userId: 'u-1',
    knowledgePointId: 'kp-a',
    questionCount: 5,
    scheduledDate: '2026-08-23',
    status: 'pending',
    completed: false,
    mode: '专项训练',
    nextAvailableAt: null,
    ...overrides,
  };
}

function progress(overrides = {}) {
  return {
    userId: 'u-1',
    taskId: 'task-1',
    completedQuestionCount: 0,
    correctCount: 0,
    minutesSpent: 0,
    ...overrides,
  };
}

function completion(overrides = {}) {
  return {
    userId: 'u-1',
    taskId: 'task-1',
    completedDate: '2026-08-23',
    ...overrides,
  };
}

function session(overrides = {}) {
  return {
    id: 'session-1',
    userId: 'u-1',
    type: 'practice_set',
    resourceId: 'resource-1',
    ...overrides,
  };
}
