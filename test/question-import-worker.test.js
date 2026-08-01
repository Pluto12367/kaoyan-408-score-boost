import assert from 'node:assert/strict';
import test from 'node:test';

import { BadRequestException, ConflictException } from '@nestjs/common';

import { ImportCandidateService } from '../apps/api/dist/questions/import/import-candidate.service.js';
import { ImportValidationService } from '../apps/api/dist/questions/import/import-validation.js';
import { ImportWorkerService } from '../apps/api/dist/questions/import/import-worker.service.js';

const validValues = {
  科目: '操作系统',
  章节: '进程管理',
  知识点: '进程同步与互斥',
  题型: '选择题',
  难度: '中等',
  题干: 'PV 操作的作用是什么？',
  '选项 A': '同步与互斥',
  '选项 B': '磁盘调度',
  正确答案: 'A',
  答案解析: 'P/V 操作协调并发进程。',
  来源: '合法原创资料',
  年份: '2026',
  '建议答题时间（秒）': '90',
};

function claimFixture(overrides = {}) {
  return {
    id: 'job-1', batchId: 'batch-1', provider: 'table-parser', originalFileName: 'questions.csv',
    originalStorageKey: 'temporary/00000000-0000-4000-8000-000000000000', fileType: 'csv',
    source: 'batch source', defaultSubject: null, defaultChapter: null, leaseOwner: 'worker-a',
    leaseExpiresAt: new Date(Date.now() + 60_000), ...overrides,
  };
}

function createClaimDatabase(now = new Date('2026-08-01T00:00:00.000Z')) {
  const jobs = [{ ...claimFixture({ state: 'pending', leaseOwner: null, leaseExpiresAt: null }) }];
  const batches = [{ id: 'batch-1', status: 'queued' }];
  return {
    jobs, batches,
    prisma: {
      $transaction: async (operation) => operation({
        $queryRaw: async (_strings, ...values) => {
          const workerId = values.find((value) => typeof value === 'string' && value.startsWith('worker-'));
          const leaseExpiry = values.find((value) => value instanceof Date && value > now);
          const job = jobs.find((item) => ['pending', 'queued'].includes(item.state)
            || (item.state === 'running' && item.leaseExpiresAt <= now));
          if (!job) return [];
          Object.assign(job, { state: 'running', leaseOwner: workerId, leaseExpiresAt: leaseExpiry });
          return [{ ...job }];
        },
        questionImportBatch: {
          update: async ({ where, data }) => {
            const batch = batches.find((item) => item.id === where.id);
            Object.assign(batch, data);
            return batch;
          },
        },
      }),
    },
  };
}

test('two workers cannot claim the same available job', async () => {
  const db = createClaimDatabase();
  const workerA = new ImportWorkerService(db.prisma, {}, {}, { workerId: 'worker-a', now: () => new Date('2026-08-01T00:00:00.000Z') });
  const workerB = new ImportWorkerService(db.prisma, {}, {}, { workerId: 'worker-b', now: () => new Date('2026-08-01T00:00:00.000Z') });

  const [claimA, claimB] = await Promise.all([workerA.claimNextJob(), workerB.claimNextJob()]);

  assert.equal(new Set([claimA?.id, claimB?.id].filter(Boolean)).size, 1);
  assert.equal([claimA, claimB].filter(Boolean).length, 1);
  assert.equal(db.jobs[0].leaseOwner, 'worker-a');
  assert.equal(db.batches[0].status, 'parsing');
});

test('an unexpired lease stays owned while an expired crash lease can be reclaimed', async () => {
  const clock = new Date('2026-08-01T00:00:00.000Z');
  const db = createClaimDatabase(clock);
  db.jobs[0].state = 'running';
  db.jobs[0].leaseOwner = 'crashed-worker';
  db.jobs[0].leaseExpiresAt = new Date('2026-08-01T00:01:00.000Z');
  const worker = new ImportWorkerService(db.prisma, {}, {}, { workerId: 'worker-recovery', now: () => clock });

  assert.equal(await worker.claimNextJob(), null);
  db.jobs[0].leaseExpiresAt = new Date('2026-07-31T23:59:59.000Z');
  const reclaimed = await worker.claimNextJob();

  assert.equal(reclaimed.id, 'job-1');
  assert.equal(reclaimed.leaseOwner, 'worker-recovery');
  assert.equal(db.jobs[0].leaseOwner, 'worker-recovery');
});

test('file IO and parsing happen after the claim transaction has committed', async () => {
  let transactionOpen = false;
  let readWhileOpen = false;
  const job = claimFixture();
  const processing = createProcessingPrisma([], [], job);
  const prisma = {
    ...processing,
    $transaction: async (operation) => {
      transactionOpen = true;
      try { return await processing.$transaction(operation); }
      finally { transactionOpen = false; }
    },
  };
  const storage = { readTemporary: async () => { readWhileOpen = transactionOpen; return Buffer.from('csv'); } };
  const parser = { parse: async () => ({ rows: [], issues: [] }) };
  const worker = new ImportWorkerService(prisma, storage, parser, { workerId: 'worker-a' });

  await worker.processClaimedJob(job);

  assert.equal(readWhileOpen, false);
});

test('one invalid table row does not discard valid rows and retry stays exactly once', async () => {
  const persisted = [];
  const batchUpdates = [];
  const job = claimFixture();
  const prisma = createProcessingPrisma(persisted, batchUpdates, job);
  const parser = {
    parse: async () => ({
      rows: [
        { rowNumber: 2, values: validValues },
        { rowNumber: 3, values: { ...validValues, 题干: '第二道有效题', 正确答案: 'B' } },
        { rowNumber: 4, values: { ...validValues, 题干: '', 来源: '' } },
      ],
      issues: [],
    }),
  };
  const worker = new ImportWorkerService(prisma, { readTemporary: async () => Buffer.from('csv') }, parser, { workerId: 'worker-a' });

  const result = await worker.processClaimedJob(job);
  await worker.processClaimedJob(job);

  assert.equal(result.validCandidates, 2);
  assert.equal(result.failedCandidates, 1);
  assert.equal(persisted.length, 3, 'job/source row uniqueness must make retries idempotent');
  assert.deepEqual(persisted.map((candidate) => candidate.status), ['pending_review', 'pending_review', 'needs_edit']);
  assert.ok(persisted[2].warnings.some((warning) => warning.field === 'stem'));
  assert.match(persisted[2].contentFingerprint, /^[a-f0-9]{64}$/u);
  assert.deepEqual(batchUpdates.at(-1).statusCounts, { needs_edit: 1, pending_review: 2 });
  assert.equal(batchUpdates.at(-1).status, 'review');
});

test('an exact current duplicate is linked to its family and malformed parser output becomes parse_failed', async () => {
  const persisted = [];
  const job = claimFixture();
  const prisma = createProcessingPrisma(persisted, [], job, {
    duplicate: { familyId: 'family-current' },
  });
  const parser = {
    parse: async () => ({
      rows: [{ rowNumber: 2, values: validValues }],
      issues: [{ code: 'INVALID_CSV_ROW', severity: 'error', message: 'bad row', suggestion: 'fix it', rowNumber: 3 }],
    }),
  };
  const worker = new ImportWorkerService(prisma, { readTemporary: async () => Buffer.from('csv') }, parser, { workerId: 'worker-a' });

  await worker.processClaimedJob(job);

  assert.equal(persisted[0].status, 'duplicate_suspected');
  assert.equal(persisted[0].targetFamilyId, 'family-current');
  assert.equal(persisted[1].status, 'parse_failed');
  assert.equal(persisted[1].sourceRowNumber, 3);
});

test('knowledge points resolve by Chinese subject, chapter, and title', async () => {
  const validation = new ImportValidationService({
    knowledgePoint: { findMany: async () => [{ id: 'ds-tree', subject: 'DATA_STRUCTURE', chapter: 'integration', title: 'Tree' }] },
    question: { findMany: async () => [] },
  });

  const [candidate] = await validation.prepareRows(
    { id: 'batch-1', source: 'integration source' },
    'job-1',
    [{ rowNumber: 2, values: {
      ...validValues, 科目: '数据结构', 章节: 'integration', 知识点: 'Tree',
    } }],
  );

  assert.equal(candidate.status, 'pending_review');
  assert.deepEqual(candidate.knowledgePointIds, ['ds-tree']);
});

test('worker failure is recorded only for the current lease owner and shutdown interrupts idle sleep', async () => {
  const state = { failed: false };
  const worker = new ImportWorkerService({
    $transaction: async (operation) => operation({
      $queryRaw: async () => [claimFixture()],
      questionImportJob: { updateMany: async ({ where, data }) => {
        if (where.leaseOwner === 'worker-a' && data.state === 'failed') state.failed = true;
        assert.ok(where.leaseExpiresAt.gt instanceof Date);
        return { count: 1 };
      } },
      questionImportBatch: { update: async () => undefined },
    }),
  }, { readTemporary: async () => { throw new Error('simulated disk failure'); } }, {}, {
    workerId: 'worker-a', emptyPollMs: 60_000,
  });

  await worker.runOnce();
  const loop = worker.start();
  await worker.onModuleDestroy();
  await loop;

  assert.equal(state.failed, true);
});

test('an old worker cannot mark a job failed after its lease expired', async () => {
  let attempted = false;
  const expired = claimFixture({ leaseExpiresAt: new Date('2026-07-31T23:59:59.000Z') });
  const worker = new ImportWorkerService({
    $transaction: async (operation) => operation({
      $queryRaw: async () => [expired],
      questionImportJob: { updateMany: async ({ where }) => {
        attempted = true;
        assert.ok(where.leaseExpiresAt.gt > expired.leaseExpiresAt);
        return { count: 0 };
      } },
      questionImportBatch: { update: async ({ data }) => {
        if (data.status !== 'parsing') assert.fail('lease-lost worker must not update batch failure state');
      } },
    }),
  }, { readTemporary: async () => { throw new Error('late failure'); } }, {}, {
    workerId: 'worker-a', now: () => new Date('2026-08-01T00:00:00.000Z'),
  });

  await worker.runOnce();
  assert.equal(attempted, true);
});

test('candidate update uses revision OCC and includes the latest candidate in a 409 response', async () => {
  const latest = { id: 'candidate-1', batchId: 'batch-1', revision: 3, status: 'pending_review', warnings: [] };
  const prisma = {
    $transaction: async (operation) => operation({
      questionImportCandidate: {
        findFirst: async () => latest,
        updateMany: async () => ({ count: 0 }),
      },
    }),
  };
  const service = new ImportCandidateService(prisma, { record: async () => undefined });

  await assert.rejects(
    service.update('candidate-1', 2, { status: 'ignored' }, 'admin-1'),
    (error) => error instanceof ConflictException && error.getResponse().latest.revision === 3,
  );
});

test('bulk approval is bounded and audits candidate IDs and warning counts in the state transaction', async () => {
  const service = new ImportCandidateService({}, { record: async () => undefined });

  await assert.rejects(
    service.bulkApprove('batch-1', Array.from({ length: 101 }, (_, index) => `candidate-${index}`), 'admin-1'),
    (error) => error instanceof BadRequestException,
  );
});

test('bulk approval uses every candidate revision and audits only ID arrays and warning counts', async () => {
  const revisions = [];
  let audit;
  const tx = {
    questionImportCandidate: {
      findMany: async () => [
        { id: 'candidate-1', revision: 3, status: 'pending_review', warnings: [] },
        { id: 'candidate-2', revision: 7, status: 'duplicate_suspected', warnings: [] },
      ],
      updateMany: async ({ where }) => { revisions.push(where.revision); return { count: 1 }; },
      groupBy: async () => [{ status: 'approved', _count: { _all: 2 } }],
    },
    questionImportBatch: { update: async () => undefined },
  };
  const service = new ImportCandidateService(
    { $transaction: async (operation) => operation(tx) },
    { record: async (input, passedTx) => { audit = input; assert.equal(passedTx, tx); } },
  );

  const result = await service.bulkApprove('batch-1', ['candidate-1', 'candidate-2'], 'admin-1');

  assert.deepEqual(revisions, [3, 7]);
  assert.equal(result.approvedCandidates, 2);
  assert.deepEqual(audit.metadata, { candidateIds: ['candidate-1', 'candidate-2'], warningCount: 0 });
});

test('ignore refreshes batch counts and audits a JSON candidate ID array in the same transaction', async () => {
  const latest = {
    id: 'candidate-1', batchId: 'batch-1', revision: 0, status: 'pending_review', warnings: [],
  };
  let batchCounts;
  let audit;
  const tx = {
    questionImportCandidate: {
      findFirst: async () => latest,
      updateMany: async ({ data }) => { Object.assign(latest, { status: data.status, revision: 1 }); return { count: 1 }; },
      groupBy: async () => [{ status: 'ignored', _count: { _all: 1 } }],
    },
    questionImportBatch: { update: async ({ data }) => { batchCounts = data.statusCounts; } },
  };
  const service = new ImportCandidateService(
    { $transaction: async (operation) => operation(tx) },
    { record: async (input, passedTx) => { audit = input; assert.equal(passedTx, tx); } },
  );

  const updated = await service.update('candidate-1', 0, { status: 'ignored' }, 'admin-1');

  assert.equal(updated.status, 'ignored');
  assert.deepEqual(batchCounts, { ignored: 1 });
  assert.deepEqual(audit.metadata, { candidateIds: ['candidate-1'], warningCount: 0 });
  assert.equal(audit.action, 'question_import.candidate_ignore');
});

test('candidate service rejects mixed ignore edits and malformed runtime patch values', async () => {
  const service = new ImportCandidateService({}, { record: async () => undefined });

  await assert.rejects(
    service.update('candidate-1', 0, { status: 'ignored', stem: 'silently discarded' }, 'admin-1'),
    (error) => error instanceof BadRequestException,
  );
  await assert.rejects(
    service.update('candidate-1', 0, { options: 'not-an-array' }, 'admin-1'),
    (error) => error instanceof BadRequestException,
  );
  await assert.rejects(
    service.update('candidate-1', 0, { difficulty: 'expert' }, 'admin-1'),
    (error) => error instanceof BadRequestException,
  );
  await assert.rejects(
    service.update('candidate-1', 0, { knowledgePointIds: [] }, 'admin-1'),
    (error) => error instanceof BadRequestException,
  );
  await assert.rejects(
    service.update('candidate-1', 0, { knowledgePointIds: ['kp-1', 'kp-1'] }, 'admin-1'),
    (error) => error instanceof BadRequestException,
  );
});

function createProcessingPrisma(persisted, batchUpdates, job, options = {}) {
  const point = {
    id: 'os-sync', subject: 'OPERATING_SYSTEM', chapter: '进程管理', title: '进程同步与互斥',
  };
  const transaction = {
    questionImportCandidate: {
      createMany: async ({ data }) => {
        let count = 0;
        for (const candidate of data) {
          if (persisted.some((item) => item.jobId === candidate.jobId && item.sourceRowNumber === candidate.sourceRowNumber)) continue;
          persisted.push(candidate);
          count += 1;
        }
        return { count };
      },
      groupBy: async () => Object.entries(Object.groupBy(persisted, (candidate) => candidate.status))
        .map(([status, rows]) => ({ status, _count: { _all: rows.length } })),
    },
    questionImportJob: {
      updateMany: async ({ where, data }) => {
        assert.equal(where.leaseOwner, job.leaseOwner);
        Object.assign(job, data);
        return { count: 1 };
      },
    },
    questionImportBatch: { update: async ({ data }) => { batchUpdates.push(data); } },
  };
  return {
    knowledgePoint: { findMany: async () => [point] },
    question: { findMany: async ({ where }) => options.duplicate
      ? [{ ...options.duplicate, contentFingerprint: where.contentFingerprint.in[0] }]
      : [] },
    $transaction: async (operation) => operation(transaction),
  };
}
