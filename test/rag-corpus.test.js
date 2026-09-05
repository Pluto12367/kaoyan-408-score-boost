/**
 * RAG Knowledge Corpus Tests.
 *
 * Tests the corpus builder with fixture data mimicking 408 knowledge tree.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildKnowledgeCorpus,
} from '../apps/api/dist/rag/knowledge-corpus.js';

test('corpus builder handles empty inputs', () => {
  const { documents, chunks } = buildKnowledgeCorpus([], [], []);
  assert.equal(documents.length, 0);
  assert.equal(chunks.length, 0);
});

test('corpus builder creates node overview chunk', () => {
  const nodes = [{
    id: 'OS-C06-S06-P02',
    subject: 'OS',
    nodeType: 'atomicPoint',
    name: '死锁必要条件',
    importance: 5,
    difficulty: 3,
    chapterPath: ['进程管理', '死锁'],
  }];
  const { documents, chunks } = buildKnowledgeCorpus(nodes, [], []);
  assert.equal(documents.length, 1);
  assert.equal(chunks.length, 1);
  const doc = documents[0];
  assert.equal(doc.documentId, 'node:OS-C06-S06-P02');
  assert.equal(doc.knowledgeNodeId, 'OS-C06-S06-P02');
  assert.equal(doc.subject, 'OS');
  assert.equal(doc.title, '死锁必要条件');
  assert.deepStrictEqual(doc.chapterPath, ['进程管理', '死锁']);
  const chunk = chunks[0];
  assert.equal(chunk.chunkId, `${doc.documentId}#overview`);
  assert.equal(chunk.kind, 'node_overview');
  assert.ok(chunk.content.includes('死锁必要条件'));
  assert.ok(chunk.content.includes('重要度5'));
});

test('corpus builder creates node relations chunk', () => {
  const nodes = [
    {
      id: 'OS-C06-S06-P02',
      subject: 'OS',
      nodeType: 'atomicPoint',
      name: '死锁必要条件',
      importance: 5,
      difficulty: 3,
      chapterPath: ['进程管理', '死锁'],
    },
    {
      id: 'OS-C02-S04-P20',
      subject: 'OS',
      nodeType: 'atomicPoint',
      name: '信号量',
      importance: 5,
      difficulty: 4,
      chapterPath: ['进程同步', '信号量'],
    },
  ];
  const relations = [
    { fromId: 'OS-C06-S06-P02', toId: 'OS-C02-S04-P20', type: 'RELATED' },
  ];
  const { chunks } = buildKnowledgeCorpus(nodes, relations, []);
  const relationsChunk = chunks.find((c) => c.kind === 'node_relations');
  assert.ok(relationsChunk);
  assert.ok(relationsChunk.content.includes('信号量'));
});

test('corpus builder skips questions without analysis', () => {
  const nodes = [{
    id: 'DS-C01-S01-P01',
    subject: 'DS',
    nodeType: 'atomicPoint',
    name: '数组下标',
    importance: 3,
    difficulty: 1,
    chapterPath: [],
  }];
  const questions = [{
    id: 'q1',
    stem: 'Which index is valid?',
    analysis: '',
    knowledgeNodeIds: ['DS-C01-S01-P01'],
  }];
  const { chunks } = buildKnowledgeCorpus(nodes, [], questions);
  const questionChunks = chunks.filter((c) => c.kind === 'question_analysis');
  assert.equal(questionChunks.length, 0);
});

test('corpus builder creates question analysis chunk with truncation', () => {
  const nodes = [{
    id: 'DS-C01-S01-P01',
    subject: 'DS',
    nodeType: 'atomicPoint',
    name: '数组下标',
    importance: 3,
    difficulty: 1,
    chapterPath: [],
  }];
  const longAnalysis = 'A'.repeat(1000);
  const questions = [{
    id: 'q1',
    stem: 'Test question about array indexing?',
    analysis: longAnalysis,
    knowledgeNodeIds: ['DS-C01-S01-P01'],
  }];
  const { chunks } = buildKnowledgeCorpus(nodes, [], questions);
  const questionChunks = chunks.filter((c) => c.kind === 'question_analysis');
  assert.equal(questionChunks.length, 1);
  const chunk = questionChunks[0];
  assert.ok(chunk.content.length < longAnalysis.length);
  assert.ok(chunk.content.endsWith('...'));
});

test('corpus builder uses first knowledge node for question chunk', () => {
  const nodes = [
    {
      id: 'OS-C06-S06-P02',
      subject: 'OS',
      nodeType: 'atomicPoint',
      name: '死锁必要条件',
      importance: 5,
      difficulty: 3,
      chapterPath: ['进程管理', '死锁'],
    },
    {
      id: 'OS-C02-S04-P20',
      subject: 'OS',
      nodeType: 'atomicPoint',
      name: '信号量',
      importance: 5,
      difficulty: 4,
      chapterPath: ['进程同步', '信号量'],
    },
  ];
  const questions = [{
    id: 'q1',
    stem: 'Question with multiple nodes?',
    analysis: 'Analysis text',
    knowledgeNodeIds: ['OS-C06-S06-P02', 'OS-C02-S04-P20'],
  }];
  const { chunks } = buildKnowledgeCorpus(nodes, [], questions);
  const questionChunks = chunks.filter((c) => c.kind === 'question_analysis');
  assert.equal(questionChunks.length, 1);
  assert.equal(questionChunks[0].knowledgeNodeId, 'OS-C06-S06-P02');
});