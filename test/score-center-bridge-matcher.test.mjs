import test from 'node:test';
import assert from 'node:assert/strict';
import {
  matchAllKnowledgePoints,
  matchKnowledgePointToNodes,
  normalizeKnowledgeName,
} from '../packages/shared/dist/index.js';

function kp(overrides = {}) {
  return { id: 'kp-1', subject: 'DS', chapter: '查找', title: '折半查找', ...overrides };
}

function node(overrides = {}) {
  return {
    id: 'n-1',
    subject: 'DS',
    nodeType: 'atomicPoint',
    name: '折半查找',
    chapterName: '查找',
    sectionName: '查找的基本概念',
    ...overrides,
  };
}

test('EXACT_NAME: unique exact name with matching context resolves HIGH/ACTIVE', () => {
  const kpInput = kp();
  const target = node({ id: 'n-exact' });
  const crossSubject = node({ id: 'n-cross', subject: 'CO', name: '折半查找', chapterName: '查找' });
  const decision = matchKnowledgePointToNodes(kpInput, [crossSubject, target], []);
  assert.equal(decision.confidence, 'HIGH');
  assert.equal(decision.matchMethod, 'EXACT_NAME');
  assert.equal(decision.status, 'ACTIVE');
  assert.deepEqual(decision.selectedNodeIds, ['n-exact']);
  assert.ok(decision.reasons.includes('EXACT_NAME_MATCH'));
  assert.ok(decision.reasons.includes('SAME_SUBJECT'));
});

test('normalizeKnowledgeName collapses deterministic formatting variations', () => {
  const a = normalizeKnowledgeName('二叉排序树（BST）');
  const b = normalizeKnowledgeName('二叉排序树(bst)');
  const c = normalizeKnowledgeName(' 二叉排序树(BST) ');
  assert.equal(a, b);
  assert.equal(b, c);
  assert.equal(normalizeKnowledgeName('TCP  连接管理'), normalizeKnowledgeName('tcp 连接管理'));
  assert.equal(normalizeKnowledgeName('折半查找　'), normalizeKnowledgeName('折半查找'));
  assert.notEqual(normalizeKnowledgeName('进程通信'), normalizeKnowledgeName('进程同步'));
});

test('NORMALIZED_NAME: normalized equality with unique candidate resolves HIGH/ACTIVE', () => {
  const kpInput = kp({ title: '二叉排序树（BST）' });
  const target = node({ id: 'n-norm', name: '二叉排序树(BST)' });
  const decision = matchKnowledgePointToNodes(kpInput, [target], []);
  assert.equal(decision.confidence, 'HIGH');
  assert.equal(decision.matchMethod, 'NORMALIZED_NAME');
  assert.equal(decision.status, 'ACTIVE');
  assert.deepEqual(decision.selectedNodeIds, ['n-norm']);
  assert.ok(decision.reasons.includes('NORMALIZED_NAME_MATCH'));
});

test('cross-subject: identical names across subjects never produce HIGH or candidates', () => {
  const kpInput = kp({ subject: 'DS', title: '排序' });
  const otherSubject = node({ id: 'n-co', subject: 'CO', name: '排序', chapterName: '排序' });
  const decision = matchKnowledgePointToNodes(kpInput, [otherSubject], []);
  assert.equal(decision.confidence, null);
  assert.equal(decision.status, null);
  assert.deepEqual(decision.selectedNodeIds, []);
  assert.deepEqual(decision.candidateNodes, []);
  assert.ok(decision.reasons.includes('NO_DETERMINISTIC_EVIDENCE'));
});

test('context conflict: name match with conflicting chapter is never HIGH', () => {
  const kpInput = kp({ chapter: '树与二叉树' });
  const conflicting = node({ id: 'n-conflict', chapterName: '查找' });
  const decision = matchKnowledgePointToNodes(kpInput, [conflicting], []);
  assert.notEqual(decision.confidence, 'HIGH');
  assert.notEqual(decision.status, 'ACTIVE');
  assert.equal(decision.confidence, 'MEDIUM');
  assert.equal(decision.status, 'PENDING_REVIEW');
  assert.ok(decision.reasons.includes('CONTEXT_CONFLICT'));
  assert.deepEqual(decision.selectedNodeIds, []);
});

test('multiple plausible candidates resolve MEDIUM/PENDING_REVIEW without picking one', () => {
  const kpInput = kp();
  const first = node({ id: 'n-a' });
  const second = node({ id: 'n-b' });
  const decision = matchKnowledgePointToNodes(kpInput, [first, second], []);
  assert.equal(decision.confidence, 'MEDIUM');
  assert.equal(decision.status, 'PENDING_REVIEW');
  assert.deepEqual(decision.selectedNodeIds, []);
  assert.ok(decision.reasons.includes('MULTIPLE_CANDIDATES'));
});

test('LOW: no deterministic evidence yields null confidence/status and empty selection', () => {
  const kpInput = kp({ title: '不存在的知识点XYZ' });
  const unrelated = node({ id: 'n-x', name: '折半查找' });
  const decision = matchKnowledgePointToNodes(kpInput, [unrelated], []);
  assert.equal(decision.confidence, null);
  assert.equal(decision.status, null);
  assert.equal(decision.matchMethod, null);
  assert.deepEqual(decision.selectedNodeIds, []);
  assert.ok(decision.reasons.includes('NO_DETERMINISTIC_EVIDENCE'));
});

test('explicit alias with consistent context resolves HIGH/CONTEXT_MATCH/ACTIVE', () => {
  const kpInput = kp({ title: '二分查找' });
  const target = node({ id: 'n-alias', name: '折半查找' });
  const aliases = [{ subject: 'DS', from: '二分查找', to: '折半查找' }];
  const decision = matchKnowledgePointToNodes(kpInput, [target], aliases);
  assert.equal(decision.confidence, 'HIGH');
  assert.equal(decision.matchMethod, 'CONTEXT_MATCH');
  assert.equal(decision.status, 'ACTIVE');
  assert.deepEqual(decision.selectedNodeIds, ['n-alias']);
  assert.ok(decision.reasons.includes('EXPLICIT_ALIAS_MATCH'));
});

test('alias cannot bypass context conflict', () => {
  const kpInput = kp({ title: '二分查找', chapter: '树与二叉树' });
  const target = node({ id: 'n-alias-conflict', name: '折半查找', chapterName: '查找' });
  const aliases = [{ subject: 'DS', from: '二分查找', to: '折半查找' }];
  const decision = matchKnowledgePointToNodes(kpInput, [target], aliases);
  assert.equal(decision.confidence, 'MEDIUM');
  assert.equal(decision.status, 'PENDING_REVIEW');
  assert.ok(decision.reasons.includes('CONTEXT_CONFLICT'));
  assert.deepEqual(decision.selectedNodeIds, []);
});

test('alias cannot bypass subject isolation (cross-subject target is missing)', () => {
  const kpInput = kp({ title: '二分查找' });
  const target = node({ id: 'n-co', subject: 'CO', name: '折半查找', chapterName: '查找' });
  const aliases = [{ subject: 'DS', from: '二分查找', to: '折半查找' }];
  const decision = matchKnowledgePointToNodes(kpInput, [target], aliases);
  assert.equal(decision.confidence, 'MEDIUM');
  assert.equal(decision.status, 'PENDING_REVIEW');
  assert.ok(decision.reasons.includes('ALIAS_TARGET_MISSING'));
  assert.deepEqual(decision.selectedNodeIds, []);
});

test('deterministic 1:N via explicit alias set selects both nodes', () => {
  const kpInput = kp({ title: '排序综合', chapter: '排序' });
  const first = node({ id: 'n-a', name: '排序基本概念', chapterName: '排序' });
  const second = node({ id: 'n-b', name: '排序算法分析与应用', chapterName: '排序' });
  const aliases = [
    { subject: 'DS', from: '排序综合', to: '排序基本概念' },
    { subject: 'DS', from: '排序综合', to: '排序算法分析与应用' },
  ];
  const decision = matchKnowledgePointToNodes(kpInput, [first, second], aliases);
  assert.equal(decision.confidence, 'HIGH');
  assert.equal(decision.matchMethod, 'CONTEXT_MATCH');
  assert.equal(decision.status, 'ACTIVE');
  assert.deepEqual(decision.selectedNodeIds, ['n-a', 'n-b']);
  assert.ok(decision.reasons.includes('EXPLICIT_ALIAS_MATCH'));
});

test('ambiguous 1:N without deterministic set evidence is MEDIUM, never all-ACTIVE', () => {
  const kpInput = kp({ title: '排序', chapter: '排序' });
  const first = node({ id: 'n-a', name: '排序基本概念', chapterName: '排序' });
  const second = node({ id: 'n-b', name: '插入类排序', chapterName: '排序' });
  const decision = matchKnowledgePointToNodes(kpInput, [first, second], []);
  assert.equal(decision.confidence, 'MEDIUM');
  assert.equal(decision.status, 'PENDING_REVIEW');
  assert.deepEqual(decision.selectedNodeIds, []);
});

test('similarity cannot promote: name-equal ambiguous candidates stay MEDIUM', () => {
  const kpInput = kp();
  const first = node({ id: 'n-a' });
  const second = node({ id: 'n-b' });
  const decision = matchKnowledgePointToNodes(kpInput, [first, second], []);
  assert.notEqual(decision.confidence, 'HIGH');
  assert.notEqual(decision.status, 'ACTIVE');
  assert.equal(decision.confidence, 'MEDIUM');
});

test('determinism: identical inputs produce deep-equal decisions', () => {
  const kpInput = kp({ title: '排序综合', chapter: '排序' });
  const first = node({ id: 'n-a', name: '排序基本概念', chapterName: '排序' });
  const second = node({ id: 'n-b', name: '排序算法分析与应用', chapterName: '排序' });
  const aliases = [
    { subject: 'DS', from: '排序综合', to: '排序基本概念' },
    { subject: 'DS', from: '排序综合', to: '排序算法分析与应用' },
  ];
  const one = matchKnowledgePointToNodes(kpInput, [first, second], aliases);
  const two = matchKnowledgePointToNodes(kpInput, [first, second], aliases);
  assert.deepEqual(one, two);

  const inputs = [
    kp({ id: 'kp-a', title: '折半查找' }),
    kp({ id: 'kp-b', title: '排序', chapter: '排序' }),
  ];
  const nodes = [node({ id: 'n-a' }), node({ id: 'n-b', name: '排序基本概念', chapterName: '排序' })];
  const allOne = matchAllKnowledgePoints(inputs, nodes, []);
  const allTwo = matchAllKnowledgePoints(inputs, nodes, []);
  assert.deepEqual(allOne, allTwo);
  assert.deepEqual(allOne.map((item) => item.knowledgePointId), ['kp-a', 'kp-b']);
});

test('input immutability: matcher never mutates kp, nodes, or aliases', () => {
  const kpInput = kp({ title: '二分查找' });
  const nodes = [node({ id: 'n-alias', name: '折半查找' })];
  const aliases = [{ subject: 'DS', from: '二分查找', to: '折半查找' }];
  const kpSnapshot = JSON.stringify(kpInput);
  const nodesSnapshot = JSON.stringify(nodes);
  const aliasesSnapshot = JSON.stringify(aliases);
  matchKnowledgePointToNodes(kpInput, nodes, aliases);
  matchAllKnowledgePoints([kpInput], nodes, aliases);
  assert.equal(JSON.stringify(kpInput), kpSnapshot);
  assert.equal(JSON.stringify(nodes), nodesSnapshot);
  assert.equal(JSON.stringify(aliases), aliasesSnapshot);
});

test('MEDIUM invariant: every MEDIUM decision is PENDING_REVIEW with no selected nodes', () => {
  const fixtures = [
    { kpInput: kp({ chapter: '树与二叉树' }), nodes: [node({ id: 'n-conflict', chapterName: '查找' })], aliases: [] },
    { kpInput: kp(), nodes: [node({ id: 'n-a' }), node({ id: 'n-b' })], aliases: [] },
    { kpInput: kp({ title: '排序', chapter: '排序' }), nodes: [node({ id: 'n-a', name: '排序基本概念', chapterName: '排序' }), node({ id: 'n-b', name: '插入类排序', chapterName: '排序' })], aliases: [] },
    { kpInput: kp({ title: '二分查找' }), nodes: [node({ id: 'n-co', subject: 'CO', name: '折半查找', chapterName: '查找' })], aliases: [{ subject: 'DS', from: '二分查找', to: '折半查找' }] },
  ];
  for (const fixture of fixtures) {
    const decision = matchKnowledgePointToNodes(fixture.kpInput, fixture.nodes, fixture.aliases);
    if (decision.confidence === 'MEDIUM') {
      assert.equal(decision.status, 'PENDING_REVIEW', 'MEDIUM must be PENDING_REVIEW');
      assert.deepEqual(decision.selectedNodeIds, [], 'MEDIUM must not select nodes');
    }
  }
});
