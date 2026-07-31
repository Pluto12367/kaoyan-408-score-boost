import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { computeContentFingerprint, questionFingerprintPayload } = require('../packages/shared/dist/questionImport.js');

test('question fingerprint uses one canonical payload and stable SHA-256 test vector', () => {
  const question = {
    id: 'question-id-is-not-content',
    stem: 'Cache 映射',
    options: ['A', 'B'],
    answer: 'B',
    analysis: '按行号取模',
    knowledgePointIds: ['ds-tree', 'co-cache'],
    difficulty: '中等',
    type: '选择题',
    source: '测试资料',
    expectedTimeSec: 90,
  };

  assert.deepEqual(questionFingerprintPayload(question), {
    stem: 'Cache 映射',
    options: ['A', 'B'],
    answer: 'B',
    analysis: '按行号取模',
    knowledgePointIds: ['co-cache', 'ds-tree'],
    difficulty: '中等',
    type: '选择题',
    source: '测试资料',
    year: null,
    expectedTimeSec: 90,
  });
  assert.equal(computeContentFingerprint(question), '3a25a61cf911b9f1d7d975d12ef900426ae3c8cc5efce85e0527374363b2b0ce');
  assert.equal(
    computeContentFingerprint({ ...question, id: 'another-id', knowledgePointIds: ['co-cache', 'ds-tree'] }),
    computeContentFingerprint(question),
  );
});
