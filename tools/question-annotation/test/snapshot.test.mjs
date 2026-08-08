import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyRoles,
  fingerprintPayloadHash,
  snapshotContentHash,
  validateSnapshot,
} from '../core/snapshot.js';

function question(overrides = {}) {
  return {
    id: 'q1',
    subject: 'DS',
    stem: '折半查找要求线性表满足?',
    options: ['有序且支持随机访问', '链式存储'],
    answer: 'A',
    analysis: '折半查找依赖有序和随机访问。',
    contentFingerprint: 'fp-1',
    isCurrent: true,
    familyId: 'f1',
    versionNumber: 1,
    ...overrides,
  };
}

function knowledgePoint(overrides = {}) {
  return { id: 'kp-1', subject: 'DS', chapter: '查找', title: '折半查找', ...overrides };
}

function node(overrides = {}) {
  return {
    id: 'n-1',
    parentId: 's-1',
    subject: 'DS',
    nodeType: 'atomicPoint',
    name: '折半查找',
    isActive: true,
    chapterName: '查找',
    sectionName: '查找的基本概念',
    ...overrides,
  };
}

function validSnapshot(overrides = {}) {
  const questions = [question(), question({ id: 'q2', contentFingerprint: 'fp-2' })];
  const knowledgePoints = [knowledgePoint()];
  const questionKnowledgePoints = [{ questionId: 'q1', knowledgePointId: 'kp-1' }];
  const nodes = [
    { id: 'c-1', parentId: null, subject: 'DS', nodeType: 'chapter', name: '查找', isActive: true, chapterName: null, sectionName: null },
    { id: 's-1', parentId: 'c-1', subject: 'DS', nodeType: 'section', name: '查找的基本概念', isActive: true, chapterName: '查找', sectionName: null },
    node(),
  ];
  const base = {
    snapshotId: 'snap-1',
    schemaVersion: 'annotation-snapshot-v1',
    generatedAt: '2026-08-08T00:00:00.000Z',
    sourceCommit: 'deadbeef',
    counts: { totalRows: questions.length, currentRows: 2, nonCurrentRows: 0 },
    contentSha256: '',
    questions,
    knowledgePoints,
    questionKnowledgePoints,
    nodes,
    roles: { q1: 'INDEPENDENT_UNIT', q2: 'INDEPENDENT_UNIT' },
    duplicateRepresentative: { q1: null, q2: null },
  };
  const snapshot = { ...base, ...overrides };
  if (overrides.contentSha256 === undefined) {
    snapshot.contentSha256 = snapshotContentHash(snapshot);
  }
  return snapshot;
}

test('classifyRoles splits current unique / exact duplicate copy / historical only', () => {
  const rows = [
    { id: 'q1', isCurrent: true, contentFingerprint: 'fp-A', familyId: 'f1', versionNumber: 1 },
    { id: 'q2', isCurrent: true, contentFingerprint: 'fp-A', familyId: 'f2', versionNumber: 1 },
    { id: 'q3', isCurrent: false, contentFingerprint: 'fp-B', familyId: 'f3', versionNumber: 1 },
    { id: 'q4', isCurrent: true, contentFingerprint: 'fp-C', familyId: 'f4', versionNumber: 1 },
  ];
  const { roles, duplicateRepresentative } = classifyRoles(rows);
  assert.equal(roles.q1, 'INDEPENDENT_UNIT');
  assert.equal(roles.q2, 'EXACT_DUPLICATE_COPY');
  assert.equal(roles.q3, 'HISTORICAL_ONLY');
  assert.equal(roles.q4, 'INDEPENDENT_UNIT');
  assert.equal(duplicateRepresentative.q2, 'q1');
  assert.equal(duplicateRepresentative.q1, null);
  assert.equal(duplicateRepresentative.q3, null);
});

test('classifyRoles is input-order independent and picks lexicographically smallest representative', () => {
  const rows = [
    { id: 'q10', isCurrent: true, contentFingerprint: 'fp-X', familyId: 'f1', versionNumber: 1 },
    { id: 'q2', isCurrent: true, contentFingerprint: 'fp-X', familyId: 'f2', versionNumber: 1 },
    { id: 'q1', isCurrent: true, contentFingerprint: 'fp-X', familyId: 'f3', versionNumber: 1 },
  ];
  const first = classifyRoles(rows);
  const shuffled = classifyRoles([rows[2], rows[0], rows[1]]);
  assert.deepEqual(first, shuffled);
  assert.equal(first.roles.q1, 'INDEPENDENT_UNIT');
  assert.equal(first.roles.q2, 'EXACT_DUPLICATE_COPY');
  assert.equal(first.roles.q10, 'EXACT_DUPLICATE_COPY');
  assert.equal(first.duplicateRepresentative.q2, 'q1');
  assert.equal(first.duplicateRepresentative.q10, 'q1');
});

test('classifyRoles marks non-current rows HISTORICAL_ONLY even when fingerprint matches a current row', () => {
  const rows = [
    { id: 'q-new', isCurrent: true, contentFingerprint: 'fp-SAME', familyId: 'f1', versionNumber: 2 },
    { id: 'q-old', isCurrent: false, contentFingerprint: 'fp-SAME', familyId: 'f1', versionNumber: 1 },
  ];
  const { roles } = classifyRoles(rows);
  assert.equal(roles['q-new'], 'INDEPENDENT_UNIT');
  assert.equal(roles['q-old'], 'HISTORICAL_ONLY');
});

test('classifyRoles never merges by familyId and never merges normalized-only duplicates', () => {
  const rows = [
    { id: 'q-new', isCurrent: true, contentFingerprint: 'fp-A', familyId: 'f1', versionNumber: 2 },
    { id: 'q-old', isCurrent: false, contentFingerprint: 'fp-B', familyId: 'f1', versionNumber: 1 },
    { id: 'q-other', isCurrent: true, contentFingerprint: 'fp-C', familyId: 'f2', versionNumber: 1 },
  ];
  const { roles, duplicateRepresentative } = classifyRoles(rows);
  assert.equal(roles['q-new'], 'INDEPENDENT_UNIT');
  assert.equal(roles['q-old'], 'HISTORICAL_ONLY');
  assert.equal(roles['q-other'], 'INDEPENDENT_UNIT');
  assert.equal(duplicateRepresentative['q-other'], null);
});

test('fingerprintPayloadHash is deterministic, field-sensitive, order-sensitive for options, and non-mutating', () => {
  const input = { stem: ' 折半查找（BST） ', options: ['有序', '链式'], answer: 'A', analysis: '解析' };
  const snapshot = JSON.stringify(input);
  const one = fingerprintPayloadHash(input);
  const two = fingerprintPayloadHash({ ...input, stem: '折半查找(BST)' });
  const changedAnswer = fingerprintPayloadHash({ ...input, answer: 'B' });
  const reordered = fingerprintPayloadHash({ ...input, options: ['链式', '有序'] });
  assert.equal(one, fingerprintPayloadHash(input));
  assert.equal(one, two);
  assert.notEqual(one, changedAnswer);
  assert.notEqual(one, reordered);
  assert.equal(JSON.stringify(input), snapshot);
});

test('validateSnapshot accepts a fully valid synthetic snapshot', () => {
  const result = validateSnapshot(validSnapshot());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.errors, []);
});

test('validateSnapshot fails closed on identity, counts, hash and schema violations', () => {
  const cases = [
    validSnapshot({ schemaVersion: 'annotation-snapshot-v9' }),
    validSnapshot({ snapshotId: '' }),
    validSnapshot({ sourceCommit: '' }),
    validSnapshot({ generatedAt: 'not-a-date' }),
    validSnapshot({ counts: { totalRows: 999 } }),
    validSnapshot({ contentSha256: 'not-a-hash' }),
  ];
  for (const snapshot of cases) {
    assert.equal(validateSnapshot(snapshot).ok, false, `should reject ${JSON.stringify({ schemaVersion: snapshot.schemaVersion, snapshotId: snapshot.snapshotId, counts: snapshot.counts })}`);
  }
});

test('validateSnapshot fails closed on uniqueness, references and node semantics', () => {
  const duplicateQuestion = validSnapshot({ questions: [question(), question({ id: 'q1' })] });
  const brokenRelation = validSnapshot({ questionKnowledgePoints: [{ questionId: 'missing-q', knowledgePointId: 'kp-1' }] });
  const missingParent = validSnapshot({ nodes: [node({ parentId: 'missing-s' })] });
  const atomicWithoutParent = validSnapshot({ nodes: [node({ parentId: null })] });
  const invalidSubject = validSnapshot({ questions: [question({ subject: 'XX' })] });
  for (const snapshot of [duplicateQuestion, brokenRelation, missingParent, atomicWithoutParent, invalidSubject]) {
    assert.equal(validateSnapshot(snapshot).ok, false);
  }
});

test('validateSnapshot fails closed on role and representative invariants', () => {
  const rep = question({ id: 'q2', contentFingerprint: 'fp-1' });
  const snapshot = validSnapshot({
    questions: [question(), rep],
    roles: { q1: 'INDEPENDENT_UNIT', q2: 'EXACT_DUPLICATE_COPY' },
    duplicateRepresentative: { q1: null, q2: 'q1' },
  });
  assert.equal(validateSnapshot(snapshot).ok, true, JSON.stringify(validateSnapshot(snapshot).errors));

  const missingRole = validSnapshot({ roles: { q1: 'INDEPENDENT_UNIT' } });
  const invalidRole = validSnapshot({ roles: { q1: 'BOGUS', q2: 'INDEPENDENT_UNIT' } });
  const historicalCurrent = validSnapshot({ roles: { q1: 'HISTORICAL_ONLY', q2: 'INDEPENDENT_UNIT' } });
  const independentNonCurrent = validSnapshot({ questions: [question({ isCurrent: false }), question({ id: 'q2' })] });
  const copyMissingRep = validSnapshot({
    questions: [question(), question({ id: 'q2', contentFingerprint: 'fp-1' })],
    roles: { q1: 'INDEPENDENT_UNIT', q2: 'EXACT_DUPLICATE_COPY' },
    duplicateRepresentative: { q1: null, q2: null },
  });
  const selfRep = validSnapshot({
    questions: [question(), question({ id: 'q2', contentFingerprint: 'fp-1' })],
    roles: { q1: 'INDEPENDENT_UNIT', q2: 'EXACT_DUPLICATE_COPY' },
    duplicateRepresentative: { q1: null, q2: 'q2' },
  });
  const repNotIndependent = validSnapshot({
    questions: [question(), question({ id: 'q2', contentFingerprint: 'fp-1' })],
    roles: { q1: 'EXACT_DUPLICATE_COPY', q2: 'EXACT_DUPLICATE_COPY' },
    duplicateRepresentative: { q1: 'q2', q2: null },
  });
  const repFingerprintDiffers = validSnapshot({
    questions: [question(), question({ id: 'q2', contentFingerprint: 'fp-DIFFERENT' })],
    roles: { q1: 'INDEPENDENT_UNIT', q2: 'EXACT_DUPLICATE_COPY' },
    duplicateRepresentative: { q1: null, q2: 'q1' },
  });
  const cycle = validSnapshot({
    questions: [question(), question({ id: 'q2', contentFingerprint: 'fp-1' })],
    roles: { q1: 'EXACT_DUPLICATE_COPY', q2: 'EXACT_DUPLICATE_COPY' },
    duplicateRepresentative: { q1: 'q2', q2: 'q1' },
  });
  const nonCopyWithRep = validSnapshot({ duplicateRepresentative: { q1: 'q2', q2: null } });
  for (const snapshot of [missingRole, invalidRole, historicalCurrent, independentNonCurrent, copyMissingRep, selfRep, repNotIndependent, repFingerprintDiffers, cycle, nonCopyWithRep]) {
    assert.equal(validateSnapshot(snapshot).ok, false, JSON.stringify(validateSnapshot(snapshot).errors));
  }
});

test('validateSnapshot errors are stable and validation never mutates its input', () => {
  const snapshot = validSnapshot({ roles: { q1: 'INDEPENDENT_UNIT', q2: 'BOGUS' }, counts: { totalRows: 999 } });
  const before = JSON.stringify(snapshot);
  const first = validateSnapshot(snapshot);
  const second = validateSnapshot(snapshot);
  assert.deepEqual(first.errors, second.errors);
  assert.ok(first.errors.length > 0);
  assert.equal(JSON.stringify(snapshot), before);
});

test('classification and validation are generic, not hardcoded to production counts', () => {
  const rows = [
    { id: 'a', isCurrent: true, contentFingerprint: 'fp-1', familyId: 'fa', versionNumber: 1 },
    { id: 'b', isCurrent: true, contentFingerprint: 'fp-1', familyId: 'fb', versionNumber: 1 },
    { id: 'c', isCurrent: true, contentFingerprint: 'fp-2', familyId: 'fc', versionNumber: 1 },
    { id: 'd', isCurrent: false, contentFingerprint: 'fp-3', familyId: 'fd', versionNumber: 1 },
    { id: 'e', isCurrent: true, contentFingerprint: 'fp-4', familyId: 'fe', versionNumber: 1 },
  ];
  const { roles } = classifyRoles(rows);
  assert.equal(Object.keys(roles).length, 5);
  assert.equal(roles.b, 'EXACT_DUPLICATE_COPY');
  assert.equal(roles.d, 'HISTORICAL_ONLY');
});
