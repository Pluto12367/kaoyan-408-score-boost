import assert from 'node:assert/strict';
import test from 'node:test';
import { ImportBatchService } from '../apps/api/dist/questions/import/import-batch.service.js';

const upload = { originalFileName: 'safe.pdf', storageKey: 'temporary/00000000-0000-4000-8000-000000000000', fileSha256: 'a'.repeat(64), fileType: 'pdf', byteSize: 10 };
const input = { source: 'licensed source', rightsConfirmed: true };

test('rolls back batch creation when its in-transaction audit write fails', async () => {
  const committed = [];
  const tx = {
    questionImportBatch: { create: async () => ({ id: 'batch-1', status: 'queued' }) },
    auditEvent: { create: async () => { throw new Error('audit unavailable'); } },
  };
  const prisma = {
    $transaction: async (fn) => {
      try {
        const value = await fn(tx);
        committed.push(value);
        return value;
      } catch (error) {
        throw error;
      }
    },
  };

  const audits = { record: async (_input, passedTx) => passedTx.auditEvent.create({}) };
  await assert.rejects(new ImportBatchService(prisma, audits).create('admin-1', input, upload), /audit unavailable/);
  assert.deepEqual(committed, []);
});

test('rejects a mixed retry set before claiming any job', async () => {
  let claimed = false;
  const tx = {
    questionImportBatch: { findUnique: async () => ({ status: 'failed' }) },
    questionImportJob: {
      findMany: async () => [
        { id: 'failed-job', batchId: 'batch-1', state: 'failed' },
        { id: 'other-batch', batchId: 'batch-2', state: 'failed' },
      ],
      updateMany: async () => { claimed = true; return { count: 2 }; },
      groupBy: async () => [],
    },
    auditEvent: { create: async () => undefined },
  };
  const prisma = { $transaction: async (fn) => fn(tx) };

  await assert.rejects(new ImportBatchService(prisma, { record: async () => undefined }).retry('admin-1', 'batch-1', ['failed-job', 'other-batch']), /Every retry job/);
  assert.equal(claimed, false);
});
