import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateSnapshot } from '../core/snapshot.js';
import {
  exportSnapshot,
  readSnapshotFile,
  writeSnapshotFile,
} from '../scripts/export-snapshot.mjs';

const WRITE_METHODS = [
  'create', 'createMany', 'update', 'updateMany', 'upsert', 'delete', 'deleteMany',
  '$executeRaw', '$executeRawUnsafe',
];

function readModel(rows) {
  const model = { __reads: [] };
  for (const method of ['findMany', 'findFirst', 'findUnique']) {
    model[method] = async () => {
      model.__reads.push(method);
      return method === 'findMany' ? rows : rows[0] ?? null;
    };
  }
  for (const method of WRITE_METHODS) {
    model[method] = async () => {
      throw new Error(`write method ${method} must never be called`);
    };
  }
  return model;
}

function fakePrisma({ questions, knowledgePoints, questionKnowledgePoints, nodes, families = [] }) {
  return {
    question: readModel(questions),
    knowledgePoint: readModel(knowledgePoints),
    questionKnowledgePoint: readModel(questionKnowledgePoints),
    knowledgeNode: readModel(nodes),
    questionFamily: readModel(families),
    $disconnect: async () => {},
  };
}

function q(overrides = {}) {
  return {
    id: 'q1', stem: '折半查找要求线性表满足?', options: ['有序且支持随机访问', '链式存储'],
    answer: 'A', analysis: '折半查找依赖有序和随机访问。', difficulty: 'MEDIUM', type: 'SINGLE_CHOICE',
    source: 'fixture', year: 2026, expectedTimeSec: 100, contentFingerprint: 'fp-1',
    familyId: 'f1', versionNumber: 1, isCurrent: true,
    ...overrides,
  };
}

function kp(overrides = {}) {
  return { id: 'kp-1', subject: 'DATA_STRUCTURE', chapter: '查找', title: '折半查找', ...overrides };
}

function node(overrides = {}) {
  return {
    id: 'n-1', parentId: 's-1', subject: 'DS', nodeType: 'atomicPoint', name: '折半查找', isActive: true,
    ...overrides,
  };
}

function baseSource() {
  const questions = [
    q(),
    q({ id: 'q2', contentFingerprint: 'fp-1' }),
    q({ id: 'q3', contentFingerprint: 'fp-2', isCurrent: false }),
    q({ id: 'q4', contentFingerprint: 'fp-3' }),
  ];
  const knowledgePoints = [kp()];
  const questionKnowledgePoints = [
    { questionId: 'q1', knowledgePointId: 'kp-1' },
    { questionId: 'q2', knowledgePointId: 'kp-1' },
    { questionId: 'q3', knowledgePointId: 'kp-1' },
    { questionId: 'q4', knowledgePointId: 'kp-1' },
  ];
  const nodes = [
    { id: 'c-1', parentId: null, subject: 'DS', nodeType: 'chapter', name: '查找', isActive: true },
    { id: 's-1', parentId: 'c-1', subject: 'DS', nodeType: 'section', name: '查找的基本概念', isActive: true },
    node(),
  ];
  return { questions, knowledgePoints, questionKnowledgePoints, nodes };
}

test('exportSnapshot emits a valid snapshot with roles and counts', async () => {
  const prisma = fakePrisma(baseSource());
  const snapshot = await exportSnapshot(prisma, 'deadbeef', { generatedAt: '2026-08-08T00:00:00.000Z' });
  const validation = validateSnapshot(snapshot);
  assert.equal(validation.ok, true, JSON.stringify(validation.errors));
  assert.equal(snapshot.counts.totalRows, 4);
  assert.equal(snapshot.counts.currentRows, 3);
  assert.equal(snapshot.counts.nonCurrentRows, 1);
  assert.equal(snapshot.roles.q1, 'INDEPENDENT_UNIT');
  assert.equal(snapshot.roles.q2, 'EXACT_DUPLICATE_COPY');
  assert.equal(snapshot.roles.q3, 'HISTORICAL_ONLY');
  assert.equal(snapshot.duplicateRepresentative.q2, 'q1');
  assert.equal(snapshot.sourceCommit, 'deadbeef');
});

test('exporter only invokes read methods', async () => {
  const prisma = fakePrisma(baseSource());
  await exportSnapshot(prisma, 'abc', { generatedAt: '2026-08-08T00:00:00.000Z' });
  for (const [name, model] of Object.entries(prisma)) {
    if (name === '$disconnect' || typeof model !== 'object' || !model.__reads) continue;
    assert.ok(model.__reads.length > 0, `${name} should be read`);
    assert.ok(model.__reads.every((method) => method === 'findMany'), `${name} should only use findMany`);
  }
});

test('all input question rows are preserved regardless of role', async () => {
  const questions = [
    q(),
    q({ id: 'q2', contentFingerprint: 'fp-1' }),
    q({ id: 'q3', contentFingerprint: 'fp-2', isCurrent: false }),
    q({ id: 'q4', contentFingerprint: 'fp-2', isCurrent: false }),
    q({ id: 'q5', contentFingerprint: 'fp-3' }),
  ];
  const source = baseSource();
  source.questions = questions;
  source.questionKnowledgePoints = [
    { questionId: 'q1', knowledgePointId: 'kp-1' },
    { questionId: 'q2', knowledgePointId: 'kp-1' },
    { questionId: 'q3', knowledgePointId: 'kp-1' },
    { questionId: 'q4', knowledgePointId: 'kp-1' },
    { questionId: 'q5', knowledgePointId: 'kp-1' },
  ];
  const prisma = fakePrisma(source);
  const snapshot = await exportSnapshot(prisma, 'abc', { generatedAt: '2026-08-08T00:00:00.000Z' });
  assert.equal(snapshot.questions.length, 5);
  assert.equal(snapshot.counts.totalRows, 5);
});

test('question subject is derived from KnowledgePoint relation', async () => {
  const source = baseSource();
  const prisma = fakePrisma(source);
  const snapshot = await exportSnapshot(prisma, 'abc', { generatedAt: '2026-08-08T00:00:00.000Z' });
  for (const question of snapshot.questions) assert.equal(question.subject, 'DS');
});

test('question without a knowledge point relation fails closed', async () => {
  const source = baseSource();
  source.questionKnowledgePoints = source.questionKnowledgePoints.filter((link) => link.questionId !== 'q4');
  const prisma = fakePrisma(source);
  await assert.rejects(() => exportSnapshot(prisma, 'abc', { generatedAt: '2026-08-08T00:00:00.000Z' }), /q4|subject/);
});

test('question with cross-subject knowledge points fails closed', async () => {
  const source = baseSource();
  source.knowledgePoints = [kp(), kp({ id: 'kp-2', subject: 'COMPUTER_ORGANIZATION', chapter: '存储系统', title: 'Cache 映射与替换' })];
  source.questionKnowledgePoints.push({ questionId: 'q4', knowledgePointId: 'kp-2' });
  const prisma = fakePrisma(source);
  await assert.rejects(() => exportSnapshot(prisma, 'abc', { generatedAt: '2026-08-08T00:00:00.000Z' }), /cross-subject|subject/);
});

test('exporter reuses Task 1 role semantics for duplicates', async () => {
  const prisma = fakePrisma(baseSource());
  const snapshot = await exportSnapshot(prisma, 'abc', { generatedAt: '2026-08-08T00:00:00.000Z' });
  assert.equal(snapshot.roles.q1, 'INDEPENDENT_UNIT');
  assert.equal(snapshot.roles.q2, 'EXACT_DUPLICATE_COPY');
  assert.equal(snapshot.duplicateRepresentative.q2, 'q1');
  assert.equal(snapshot.counts.independentUnits, 2);
  assert.equal(snapshot.counts.exactDuplicateCopies, 1);
  assert.equal(snapshot.counts.historicalOnly, 1);
});

test('canonical output is deterministic regardless of DB row order', async () => {
  const source = baseSource();
  const sourceA = {
    questions: [...source.questions],
    knowledgePoints: [...source.knowledgePoints],
    questionKnowledgePoints: [...source.questionKnowledgePoints],
    nodes: [...source.nodes],
  };
  const sourceB = {
    questions: [...source.questions].reverse(),
    knowledgePoints: [...source.knowledgePoints].reverse(),
    questionKnowledgePoints: [...source.questionKnowledgePoints].reverse(),
    nodes: [...source.nodes].reverse(),
  };
  const a = await exportSnapshot(fakePrisma(sourceA), 'abc', { generatedAt: '2026-08-08T00:00:00.000Z' });
  const b = await exportSnapshot(fakePrisma(sourceB), 'abc', { generatedAt: '2026-08-08T00:00:00.000Z' });
  assert.equal(a.contentSha256, b.contentSha256);
  assert.deepEqual(a.roles, b.roles);
  assert.deepEqual(a.questionKnowledgePoints, b.questionKnowledgePoints);
  assert.deepEqual(a, b);
});

test('write/read round-trips the snapshot and refuses overwrite without flag', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'snap-'));
  const prisma = fakePrisma(baseSource());
  const snapshot = await exportSnapshot(prisma, 'abc', { generatedAt: '2026-08-08T00:00:00.000Z' });
  const { snapshotPath, manifestPath } = writeSnapshotFile(snapshot, dir);
  assert.ok(existsSync(snapshotPath));
  assert.ok(existsSync(manifestPath));
  const roundTrip = readSnapshotFile(snapshotPath);
  assert.deepEqual(roundTrip, snapshot);
  assert.throws(() => writeSnapshotFile(snapshot, dir), /overwrite|exists/i);
  const overwritten = writeSnapshotFile(snapshot, dir, { overwrite: true });
  assert.ok(existsSync(overwritten.snapshotPath));
});

test('validation-before-write: invalid snapshot is never written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'snap-invalid-'));
  const prisma = fakePrisma(baseSource());
  const snapshot = { ...baseSource(), generatedAt: '2026-08-08T00:00:00.000Z', sourceCommit: 'abc', snapshotId: 'x' };
  const invalid = { ...snapshot, contentSha256: 'not-a-hash', schemaVersion: 'annotation-snapshot-v9', roles: {}, duplicateRepresentative: {} };
  assert.throws(() => writeSnapshotFile(invalid, dir), /validation/i);
  assert.equal(readdirSync(dir).length, 0);
});

test('exporter source contains no Prisma write methods', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL('../scripts/export-snapshot.mjs', import.meta.url), 'utf8'));
  assert.doesNotMatch(source, /\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
  assert.doesNotMatch(source, /\$(executeRaw|executeRawUnsafe|queryRaw)/);
});
