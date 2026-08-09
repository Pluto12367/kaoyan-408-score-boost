import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLexicalIndex } from '../core/lexical.js';
import { FakeEmbeddingProvider } from '../core/embedding.js';
import { retrieveSemanticTop12, retrieveTop12 } from '../core/retriever.js';

function fakeSpec() {
  return {
    id: 'fake',
    revision: 'r1',
    queryPrefix: 'query: ',
    passagePrefix: 'passage: ',
    pooling: 'mean',
    normalize: true,
    dimension: 8,
    transformersVersion: 'test',
  };
}

function buildSnapshotFixture() {
  const questions = [];
  const knowledgePoints = [];
  const questionKnowledgePoints = [];
  const nodes = [];
  for (const subject of ['DS', 'CO', 'OS', 'CN']) {
    const chapterId = `${subject}-ch-1`;
    nodes.push({ id: chapterId, parentId: null, subject, nodeType: 'chapter', name: `${subject} chapter 1`, isActive: true, chapterName: null, sectionName: null });
    for (let section = 1; section <= 2; section += 1) {
      const sectionId = `${subject}-sec-${section}`;
      nodes.push({ id: sectionId, parentId: chapterId, subject, nodeType: 'section', name: `${subject} section ${section}`, isActive: true, chapterName: `${subject} chapter 1`, sectionName: null });
      for (let point = 1; point <= 10; point += 1) {
        nodes.push({
          id: `${subject}-point-${section}-${point}`,
          parentId: sectionId,
          subject,
          nodeType: 'atomicPoint',
          name: `${subject} atomic point ${section}.${point}`,
          isActive: true,
          chapterName: `${subject} chapter 1`,
          sectionName: `${subject} section ${section}`,
        });
      }
    }
    nodes.push({ id: `${subject}-point-inactive`, parentId: `${subject}-sec-1`, subject, nodeType: 'atomicPoint', name: `${subject} inactive point`, isActive: false, chapterName: `${subject} chapter 1`, sectionName: `${subject} section 1` });
  }
  const question = {
    id: 'q-ds-1',
    subject: 'DS',
    stem: 'DS atomic point 1.1 相关题目文本',
    analysis: '分析：DS atomic point 2.1',
    options: ['A', 'B'],
    answer: 'A',
    contentFingerprint: 'fp-q-ds-1',
  };
  questions.push(question);
  const kp = { id: 'kp-ds-1', subject: 'DS', chapter: 'DS chapter 1', title: 'DS atomic point 1.1' };
  knowledgePoints.push(kp);
  questionKnowledgePoints.push({ questionId: question.id, knowledgePointId: kp.id });
  return {
    snapshot: {
      snapshotId: 'snap-retriever-fixture',
      questions,
      knowledgePoints,
      questionKnowledgePoints,
      nodes,
    },
    question,
  };
}

test('retrieveTop12 always persists Top12 and exposes Top8 view, subject-filtered and deterministic', async () => {
  const { snapshot, question } = buildSnapshotFixture();
  const cacheDir = mkdtempSync(join(tmpdir(), 'retriever-'));
  const activeAtomic = snapshot.nodes.filter((node) => node.isActive && node.nodeType === 'atomicPoint');
  const lexical = buildLexicalIndex(activeAtomic);
  const stem = new FakeEmbeddingProvider(fakeSpec());
  const analysis = new FakeEmbeddingProvider(fakeSpec());
  const candidates = await retrieveTop12(question, snapshot, { lexical, stem, analysis }, cacheDir);
  assert.equal(candidates.length, 12);
  assert.ok(candidates.every((candidate) => candidate.nodeId.startsWith('DS-')));
  assert.ok(candidates.every((candidate) => !candidate.nodeId.includes('inactive')));
  assert.equal(new Set(candidates.map((candidate) => candidate.nodeId)).size, 12);
  candidates.forEach((candidate, index) => assert.equal(candidate.finalRank, index + 1));
  const again = await retrieveTop12(question, snapshot, { lexical, stem, analysis }, cacheDir);
  assert.deepEqual(again, candidates);
  assert.deepEqual(again.slice(0, 8), candidates.slice(0, 8));
});

test('retrieveTop12 kp/chapter soft signals never leak into candidates from outside the subject pool', async () => {
  const { snapshot, question } = buildSnapshotFixture();
  const cacheDir = mkdtempSync(join(tmpdir(), 'retriever-kp-'));
  const activeAtomic = snapshot.nodes.filter((node) => node.isActive && node.nodeType === 'atomicPoint');
  const lexical = buildLexicalIndex(activeAtomic);
  const stem = new FakeEmbeddingProvider(fakeSpec());
  const analysis = new FakeEmbeddingProvider(fakeSpec());
  const candidates = await retrieveTop12(question, snapshot, { lexical, stem, analysis }, cacheDir);
  const kpMatched = candidates.filter((candidate) => candidate.kpMatched);
  assert.ok(kpMatched.every((candidate) => candidate.nodeId.startsWith('DS-')));
  assert.ok(kpMatched.some((candidate) => candidate.nodeId === 'DS-point-1-1'));
});

test('retrieveSemanticTop12 reproduces the Task 7 semantic benchmark ranking contract', async () => {
  const { snapshot, question } = buildSnapshotFixture();
  const cacheDir = mkdtempSync(join(tmpdir(), 'semantic-parity-'));
  const provider = new FakeEmbeddingProvider(fakeSpec());
  // Task 7 benchmark replica: stem query view vs node passage view, dot product,
  // score desc + nodeId asc, Top12 — byte-level same contract.
  const pool = snapshot.nodes.filter((node) => node.subject === question.subject && node.isActive && node.nodeType === 'atomicPoint');
  const queryVector = await provider.embed('query', question.stem);
  const scored = [];
  for (const node of pool) {
    const text = [node.name, node.chapterName, node.sectionName].filter((value) => value != null && value !== '').join(' ');
    const passage = await provider.embed('passage', text);
    scored.push({ nodeId: node.id, score: queryVector.reduce((sum, value, index) => sum + value * passage[index], 0) });
  }
  scored.sort((a, b) => b.score - a.score || a.nodeId.localeCompare(b.nodeId));
  const task7 = scored.slice(0, 12).map((entry, index) => ({ nodeId: entry.nodeId, rank: index + 1 }));

  const final = await retrieveSemanticTop12(question, snapshot, provider, cacheDir);
  assert.deepEqual(
    final.map((candidate) => ({ nodeId: candidate.nodeId, rank: candidate.finalRank })),
    task7,
  );
  assert.ok(final.every((candidate) => candidate.retrievalReasons.includes('stemEmbedding')));
});
