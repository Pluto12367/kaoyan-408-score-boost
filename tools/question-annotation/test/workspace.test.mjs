import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { snapshotContentHash, validateSnapshot } from '../core/snapshot.js';
import {
  getWorkspaceSummary,
  importSnapshot,
  listNodes,
  listQuestions,
  openWorkspace,
  validateWorkspace,
} from '../workspace/workspace.mjs';

function question(overrides = {}) {
  return {
    id: 'q1', subject: 'DS', stem: '折半查找要求线性表满足?', options: ['有序且支持随机访问', '链式存储'],
    answer: 'A', analysis: '折半查找依赖有序和随机访问。', difficulty: 'MEDIUM', type: 'SINGLE_CHOICE',
    source: 'fixture', year: 2026, expectedTimeSec: 100, contentFingerprint: 'fp-1',
    familyId: 'f1', versionNumber: 1, isCurrent: true,
    ...overrides,
  };
}

function knowledgePoint(overrides = {}) {
  return { id: 'kp-1', subject: 'DS', chapter: '查找', title: '折半查找', ...overrides };
}

function node(overrides = {}) {
  return {
    id: 'n-1', parentId: 's-1', subject: 'DS', nodeType: 'atomicPoint', name: '折半查找', isActive: true,
    chapterName: '查找', sectionName: '查找的基本概念',
    ...overrides,
  };
}

function baseSnapshot(overrides = {}) {
  const questions = [question(), question({ id: 'q2', contentFingerprint: 'fp-2' })];
  const knowledgePoints = [knowledgePoint()];
  const questionKnowledgePoints = [
    { questionId: 'q1', knowledgePointId: 'kp-1' },
    { questionId: 'q2', knowledgePointId: 'kp-1' },
  ];
  const nodes = [
    { id: 'c-1', parentId: null, subject: 'DS', nodeType: 'chapter', name: '查找', isActive: true, chapterName: null, sectionName: null },
    { id: 's-1', parentId: 'c-1', subject: 'DS', nodeType: 'section', name: '查找的基本概念', isActive: true, chapterName: '查找', sectionName: null },
    node(),
  ];
  const base = {
    snapshotId: 'snap-test-1',
    schemaVersion: 'annotation-snapshot-v1',
    generatedAt: '2026-08-08T00:00:00.000Z',
    sourceCommit: 'deadbeef',
    counts: { totalRows: 2, currentRows: 2, nonCurrentRows: 0 },
    contentSha256: '',
    questions,
    knowledgePoints,
    questionKnowledgePoints,
    nodes,
    roles: { q1: 'INDEPENDENT_UNIT', q2: 'INDEPENDENT_UNIT' },
    duplicateRepresentative: { q1: null, q2: null },
  };
  const snapshot = { ...base, ...overrides };
  if (overrides.contentSha256 === undefined) snapshot.contentSha256 = snapshotContentHash(snapshot);
  return snapshot;
}

function snapshotWithDuplicateRelation() {
  const snapshot = baseSnapshot({
    questionKnowledgePoints: [
      { questionId: 'q1', knowledgePointId: 'kp-1' },
      { questionId: 'q1', knowledgePointId: 'kp-1' },
    ],
  });
  return snapshot;
}

function count(db, table) {
  return db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

test('openWorkspace creates schema with the workspace schema version and empty state', () => {
  const db = openWorkspace(':memory:');
  const version = db.prepare("SELECT value FROM workspace_meta WHERE key = 'workspace_schema_version'").get();
  assert.equal(version.value, 'annotation-workspace-v1');
  assert.equal(count(db, 'questions'), 0);
  assert.equal(count(db, 'snapshots'), 0);
  assert.equal(getWorkspaceSummary(db), null);
  db.close();
});

test('valid snapshot import populates identity, counts, roles and relations', () => {
  const db = openWorkspace(':memory:');
  const snapshot = baseSnapshot({
    questions: [question(), question({ id: 'q2', contentFingerprint: 'fp-1' })],
    roles: { q1: 'INDEPENDENT_UNIT', q2: 'EXACT_DUPLICATE_COPY' },
    duplicateRepresentative: { q1: null, q2: 'q1' },
  });
  const summary = importSnapshot(db, snapshot);
  assert.equal(summary.snapshotId, 'snap-test-1');
  assert.equal(summary.imported, true);
  assert.equal(summary.questionCount, 2);
  assert.equal(summary.knowledgePointCount, 1);
  assert.equal(summary.relationCount, 2);
  assert.equal(summary.nodeCount, 3);
  assert.deepEqual(summary.roleCounts, { INDEPENDENT_UNIT: 1, EXACT_DUPLICATE_COPY: 1, HISTORICAL_ONLY: 0 });
  assert.equal(validateWorkspace(db).ok, true);
  const summary2 = getWorkspaceSummary(db);
  assert.equal(summary2.snapshotId, 'snap-test-1');
  assert.equal(summary2.contentSha256, snapshot.contentSha256);
  db.close();
});

test('invalid snapshot is rejected before any rows are imported', () => {
  const db = openWorkspace(':memory:');
  const invalid = baseSnapshot({ roles: { q1: 'BOGUS', q2: 'INDEPENDENT_UNIT' } });
  assert.equal(validateSnapshot(invalid).ok, false);
  assert.throws(() => importSnapshot(db, invalid), /validation/i);
  assert.equal(count(db, 'questions'), 0);
  assert.equal(count(db, 'snapshots'), 0);
  db.close();
});

test('importing the same snapshot twice is a safe no-op', () => {
  const db = openWorkspace(':memory:');
  const snapshot = baseSnapshot();
  const first = importSnapshot(db, snapshot);
  const second = importSnapshot(db, snapshot);
  assert.equal(first.imported, true);
  assert.equal(second.imported, false);
  assert.equal(count(db, 'questions'), 2);
  assert.equal(count(db, 'question_knowledge_points'), 2);
  assert.equal(count(db, 'snapshots'), 1);
  assert.equal(validateWorkspace(db).ok, true);
  db.close();
});

test('same snapshotId with a different content hash fails closed', () => {
  const db = openWorkspace(':memory:');
  const snapshot = baseSnapshot();
  importSnapshot(db, snapshot);
  const conflicting = baseSnapshot({
    snapshotId: 'snap-test-1',
    questions: [question({ stem: '内容已变化' }), question({ id: 'q2', contentFingerprint: 'fp-2' })],
  });
  assert.equal(validateSnapshot(conflicting).ok, true, 'conflicting snapshot must be valid');
  assert.notEqual(conflicting.contentSha256, snapshot.contentSha256);
  assert.throws(() => importSnapshot(db, conflicting), /collision|conflict/i);
  assert.equal(count(db, 'snapshots'), 1);
  db.close();
});

test('importing a different snapshot into a non-empty workspace fails as stale', () => {
  const db = openWorkspace(':memory:');
  importSnapshot(db, baseSnapshot());
  const other = baseSnapshot({ snapshotId: 'snap-other' });
  assert.throws(() => importSnapshot(db, other), /stale/i);
  assert.equal(count(db, 'snapshots'), 1);
  assert.equal(getWorkspaceSummary(db).snapshotId, 'snap-test-1');
  db.close();
});

test('mid-import failure rolls back and leaves the workspace unchanged', () => {
  const db = openWorkspace(':memory:');
  const valid = baseSnapshot();
  importSnapshot(db, valid);
  const before = {
    snapshots: count(db, 'snapshots'),
    questions: count(db, 'questions'),
    relations: count(db, 'question_knowledge_points'),
    nodes: count(db, 'knowledge_nodes'),
  };
  const broken = snapshotWithDuplicateRelation();
  assert.equal(validateSnapshot(broken).ok, true, 'duplicate relation passes snapshot validation');
  assert.throws(() => importSnapshot(db, broken));
  assert.deepEqual({
    snapshots: count(db, 'snapshots'),
    questions: count(db, 'questions'),
    relations: count(db, 'question_knowledge_points'),
    nodes: count(db, 'knowledge_nodes'),
  }, before);
  assert.equal(getWorkspaceSummary(db).snapshotId, 'snap-test-1');
  db.close();
});

test('workspace state survives close and reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ws-'));
  const path = join(dir, 'annotation-workspace.db');
  let db = openWorkspace(path);
  importSnapshot(db, baseSnapshot());
  db.close();
  db = openWorkspace(path);
  assert.equal(count(db, 'questions'), 2);
  assert.equal(getWorkspaceSummary(db).snapshotId, 'snap-test-1');
  assert.equal(validateWorkspace(db).ok, true);
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

test('question content with SQL-like text is stored safely as a string', () => {
  const db = openWorkspace(':memory:');
  const nasty = "折半查找'); DROP TABLE questions; -- \"quoted\"";
  const snapshot = baseSnapshot({
    questions: [question({ stem: nasty }), question({ id: 'q2', contentFingerprint: 'fp-2' })],
  });
  importSnapshot(db, snapshot);
  const row = db.prepare("SELECT stem FROM questions WHERE question_id = 'q1'").get();
  assert.equal(row.stem, nasty);
  assert.equal(count(db, 'questions'), 2);
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'questions'").get();
  assert.ok(tableExists);
  db.close();
});

test('list APIs return deterministic order regardless of snapshot array order', () => {
  const dbA = openWorkspace(':memory:');
  const dbB = openWorkspace(':memory:');
  const snapshotForward = baseSnapshot();
  const snapshotReverse = baseSnapshot({
    questions: [question({ id: 'q2', contentFingerprint: 'fp-2' }), question()],
    questionKnowledgePoints: [
      { questionId: 'q2', knowledgePointId: 'kp-1' },
      { questionId: 'q1', knowledgePointId: 'kp-1' },
    ],
  });
  importSnapshot(dbA, snapshotForward);
  importSnapshot(dbB, snapshotReverse);
  assert.deepEqual(listQuestions(dbA).map((row) => row.questionId), ['q1', 'q2']);
  assert.deepEqual(listQuestions(dbB).map((row) => row.questionId), ['q1', 'q2']);
  assert.deepEqual(listNodes(dbA).map((row) => row.nodeId), listNodes(dbB).map((row) => row.nodeId));
  dbA.close();
  dbB.close();
});
