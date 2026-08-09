import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BM25_B,
  BM25_K1,
  LEXICAL_VERSION,
  buildLexicalIndex,
  searchLexical,
  tokenize,
} from '../core/lexical.js';

const SUBJECTS = ['DS', 'CO', 'OS', 'CN'];

function node(overrides = {}) {
  return {
    id: 'cn-tcp-handshake',
    subject: 'CN',
    name: 'TCP三次握手',
    chapterName: '传输层',
    sectionName: 'TCP连接管理',
    nodeType: 'atomicPoint',
    isActive: true,
    ...overrides,
  };
}

function nodesFixture() {
  return [
    node(),
    node({ id: 'cn-tcp-wave', name: 'TCP四次挥手', chapterName: '传输层', sectionName: 'TCP连接管理' }),
    node({ id: 'cn-dns-resolution', name: 'DNS解析过程', chapterName: '应用层', sectionName: 'DNS' }),
    node({ id: 'cn-congestion-avoidance', name: '拥塞避免', chapterName: '传输层', sectionName: 'TCP拥塞控制' }),
    node({ id: 'cn-subnet-mask', name: '子网掩码', chapterName: '网络层', sectionName: 'IP编址' }),
    node({ id: 'co-complement', subject: 'CO', name: '补码', chapterName: '数据的表示和运算', sectionName: '数值的表示' }),
    node({ id: 'co-cache', subject: 'CO', name: 'Cache平均访问时间', chapterName: '存储系统', sectionName: 'Cache' }),
    node({ id: 'os-paging', subject: 'OS', name: '页号与页内偏移', chapterName: '内存管理', sectionName: '分页存储管理' }),
    node({ id: 'ds-sort-stability', subject: 'DS', name: '排序稳定性', chapterName: '排序', sectionName: '排序基本概念' }),
  ];
}

function buildFixtureIndex() {
  return buildLexicalIndex(nodesFixture());
}

test('tokenize handles ascii technical terms and CJK unigrams/bigrams deterministically', () => {
  const a = tokenize('TCP 三次握手');
  const b = tokenize('tcp 三次 握手');
  assert.deepEqual(a, b);
  assert.ok(a.includes('tcp'));
  assert.ok(a.includes('三次'));
  assert.ok(a.includes('次握'));
  assert.ok(a.includes('握手'));
});

test('searchLexical ranks relevant node above irrelevant within subject and never crosses subject', () => {
  const index = buildFixtureIndex();
  const result = searchLexical(index, '三次握手', 'CN');
  assert.ok(result.length > 0);
  assert.equal(result[0].nodeId, 'cn-tcp-handshake');
  assert.ok(result.every((candidate) => index.nodeSubject.get(candidate.nodeId) === 'CN'));
});

test('searchLexical is deterministic for identical input', () => {
  const index = buildFixtureIndex();
  assert.deepEqual(searchLexical(index, '三次握手', 'CN'), searchLexical(index, '三次握手', 'CN'));
});

test('TEST A — subject is a hard filter: cross-subject lookalikes are never returned', () => {
  const lookalikes = SUBJECTS.flatMap((subject) =>
    [1, 2, 3].map((n) =>
      node({
        id: `${subject}-lookalike-${n}`,
        subject,
        name: 'TCP三次握手拥塞避免子网掩码',
        chapterName: '传输层网络层',
        sectionName: 'TCP连接管理IP编址',
      }),
    ),
  );
  const index = buildLexicalIndex([...lookalikes, node()]);
  const result = searchLexical(index, 'TCP三次握手拥塞避免子网掩码', 'DS');
  assert.ok(result.length > 0, 'DS should still match its own lookalikes');
  assert.ok(result.every((candidate) => candidate.nodeId.startsWith('DS-')));
  assert.ok(result.every((candidate) => index.nodeSubject.get(candidate.nodeId) === 'DS'));
  assert.equal(result.filter((candidate) => !candidate.nodeId.startsWith('DS-')).length, 0);
});

test('TEST B — inactive and non-atomic nodes never enter the candidate pool', () => {
  const index = buildLexicalIndex([
    node({ id: 'cn-active-atomic', name: 'TCP三次握手', chapterName: '传输层', sectionName: 'TCP连接管理' }),
    node({ id: 'cn-inactive-atomic', name: 'TCP三次握手', chapterName: '传输层', sectionName: 'TCP连接管理', isActive: false }),
    node({ id: 'cn-active-section', name: 'TCP三次握手', chapterName: '传输层', sectionName: 'TCP连接管理', nodeType: 'section' }),
    node({ id: 'cn-active-chapter', name: 'TCP三次握手', chapterName: '传输层', sectionName: 'TCP连接管理', nodeType: 'chapter' }),
  ]);
  const result = searchLexical(index, 'TCP三次握手', 'CN');
  const nodeIds = result.map((candidate) => candidate.nodeId);
  assert.ok(nodeIds.includes('cn-active-atomic'));
  assert.ok(!nodeIds.includes('cn-inactive-atomic'));
  assert.ok(!nodeIds.includes('cn-active-section'));
  assert.ok(!nodeIds.includes('cn-active-chapter'));
  assert.ok(!index.nodeSubject.has('cn-inactive-atomic'));
  assert.ok(!index.nodeSubject.has('cn-active-section'));
});

test('TEST C — lexical concept overlap ranks the relevant node clearly above unrelated nodes', () => {
  const index = buildLexicalIndex([
    node({ id: 'cn-tcp-handshake', name: 'TCP三次握手', chapterName: '传输层', sectionName: 'TCP连接管理' }),
    node({ id: 'cn-tcp-wave', name: 'TCP四次挥手', chapterName: '传输层', sectionName: 'TCP连接管理' }),
    node({ id: 'cn-congestion', name: '拥塞控制', chapterName: '传输层', sectionName: 'TCP拥塞控制' }),
    node({ id: 'cn-dns', name: 'DNS解析过程', chapterName: '应用层', sectionName: 'DNS' }),
  ]);
  const result = searchLexical(index, 'TCP三次握手的过程是什么', 'CN');
  assert.ok(result.length >= 2);
  const handshakeRank = result.findIndex((candidate) => candidate.nodeId === 'cn-tcp-handshake');
  const waveRank = result.findIndex((candidate) => candidate.nodeId === 'cn-tcp-wave');
  assert.equal(handshakeRank, 0, `handshake should rank first, got ${JSON.stringify(result)}`);
  assert.ok(waveRank > handshakeRank, 'four-way wave should rank below the handshake node');
  assert.ok(result.every((candidate) => candidate.score > 0));
  for (const unrelated of ['cn-congestion', 'cn-dns']) {
    const rank = result.findIndex((candidate) => candidate.nodeId === unrelated);
    assert.ok(rank === -1 || rank > handshakeRank, `${unrelated} must rank below the handshake node`);
  }
});

test('TEST D — Chinese text retrieval works for real terms', () => {
  const index = buildFixtureIndex();
  const cases = [
    ['拥塞避免', 'CN', 'cn-congestion-avoidance'],
    ['子网掩码', 'CN', 'cn-subnet-mask'],
    ['页号与页内偏移', 'OS', 'os-paging'],
    ['补码', 'CO', 'co-complement'],
  ];
  for (const [query, subject, expected] of cases) {
    const result = searchLexical(index, query, subject);
    assert.ok(result.length > 0, `${query} should return candidates`);
    assert.equal(result[0].nodeId, expected, `${query} should rank ${expected} first`);
    assert.ok(result.every((candidate) => index.nodeSubject.get(candidate.nodeId) === subject));
  }
});

test('TEST E — English technical acronyms are preserved for tokenization and retrieval', () => {
  const tokens = tokenize('TCP DNS Cache PPP CSMA/CD');
  for (const expected of ['tcp', 'dns', 'cache', 'ppp', 'csma', 'cd']) {
    assert.ok(tokens.includes(expected), `missing token ${expected}`);
  }
  const index = buildLexicalIndex([
    node({ id: 'cn-tcp-handshake', name: 'TCP三次握手', chapterName: '传输层', sectionName: 'TCP连接管理' }),
    node({ id: 'cn-ppp', name: 'PPP协议', chapterName: '数据链路层', sectionName: '广域网' }),
  ]);
  const tcp = searchLexical(index, 'TCP连接', 'CN');
  assert.ok(tcp.some((candidate) => candidate.nodeId === 'cn-tcp-handshake'));
  const ppp = searchLexical(index, 'PPP', 'CN');
  assert.equal(ppp[0].nodeId, 'cn-ppp');
});

test('TEST F — repeated runs and shuffled corpus produce identical ordering', () => {
  const fixture = nodesFixture();
  const firstIndex = buildLexicalIndex(fixture);
  const shuffled = [...fixture].reverse();
  const secondIndex = buildLexicalIndex(shuffled);
  for (const [query, subject] of [['TCP三次握手', 'CN'], ['补码', 'CO'], ['排序稳定性', 'DS']]) {
    const a = searchLexical(firstIndex, query, subject);
    const b = searchLexical(firstIndex, query, subject);
    const c = searchLexical(secondIndex, query, subject);
    assert.deepEqual(a, b);
    assert.deepEqual(a, c);
  }
});

test('TEST G — topK=8 and topK=12 are supported without duplicates or rank gaps', () => {
  const manyNodes = [];
  for (let i = 1; i <= 20; i += 1) {
    manyNodes.push(
      node({ id: `cn-many-${String(i).padStart(2, '0')}`, name: `TCP三次握手变体${i}`, chapterName: '传输层', sectionName: 'TCP连接管理' }),
    );
  }
  const index = buildLexicalIndex(manyNodes);
  const query = 'TCP三次握手';
  const all = searchLexical(index, query, 'CN');
  assert.ok(all.length >= 12);
  const top8 = searchLexical(index, query, 'CN', 8);
  const top12 = searchLexical(index, query, 'CN', 12);
  assert.equal(top8.length, 8);
  assert.equal(top12.length, 12);
  for (const result of [top8, top12]) {
    assert.equal(new Set(result.map((candidate) => candidate.nodeId)).size, result.length, 'no duplicate nodeIds');
    for (let i = 1; i < result.length; i += 1) {
      assert.ok(result[i - 1].score >= result[i].score, 'scores must be non-increasing');
    }
  }
  assert.deepEqual(top8, all.slice(0, 8));
  assert.deepEqual(top12, all.slice(0, 12));
});

test('TEST H — empty or weak queries fail safe with an empty result', () => {
  const index = buildFixtureIndex();
  assert.deepEqual(searchLexical(index, '', 'CN'), []);
  assert.deepEqual(searchLexical(index, '   ', 'CN'), []);
  assert.deepEqual(searchLexical(index, '？？？！！！', 'CN'), []);
  assert.deepEqual(searchLexical(index, 'zzzz-nonsense-qqq', 'CN'), []);
});

test('lexical constants are centralized and versioned', () => {
  assert.equal(LEXICAL_VERSION, 'lexical-bm25-v1');
  assert.equal(BM25_K1, 1.2);
  assert.equal(BM25_B, 0.75);
});

test('node ids never leak into tokens as a semantic shortcut', () => {
  const index = buildLexicalIndex([node({ id: 'cn-tcp-handshake', name: '三次握手', chapterName: '传输层', sectionName: '连接管理' })]);
  const result = searchLexical(index, 'cn-tcp-handshake', 'CN');
  assert.deepEqual(result, []);
});
