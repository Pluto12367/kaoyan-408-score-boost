import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { embedWithCache } from '../core/embedding.js';
import {
  PASSAGE_FORMAT,
  PASSAGE_VERSION,
  buildPassageV1,
  buildPassageV2,
} from '../core/passage.js';

function syntheticNode(overrides = {}) {
  return {
    id: 'synthetic-node-id',
    subject: 'SYNTHETIC',
    name: 'Handshake',
    chapterName: 'Transport',
    sectionName: 'Connection setup',
    ...overrides,
  };
}

test('V2-5: versions are locked', () => {
  assert.equal(PASSAGE_VERSION, 'knowledge-node-passage-v2');
  assert.equal(PASSAGE_FORMAT, 'canonical-labeled-hierarchical-passage-v2');
});

test('V2-5: P1 is the V1 unlabeled join', () => {
  assert.equal(buildPassageV1(syntheticNode()), 'Handshake Transport Connection setup');
});

test('V2-5: P2 full format', () => {
  assert.equal(buildPassageV2(syntheticNode()), '考点：Handshake 章节：Transport 小节：Connection setup');
});

test('V2-5: P2 missing chapter', () => {
  assert.equal(buildPassageV2(syntheticNode({ chapterName: null })), '考点：Handshake 小节：Connection setup');
});

test('V2-5: P2 missing section', () => {
  assert.equal(buildPassageV2(syntheticNode({ sectionName: null })), '考点：Handshake 章节：Transport');
});

test('V2-5: P2 only name', () => {
  assert.equal(buildPassageV2(syntheticNode({ chapterName: null, sectionName: null })), '考点：Handshake');
});

test('V2-5: nodeId and subjectName are absent from passage', () => {
  const result = buildPassageV2(syntheticNode({ subjectName: 'Forbidden subject label' }));
  assert.equal(result.includes('synthetic-node-id'), false);
  assert.equal(result.includes('Forbidden subject label'), false);
});

test('V2-5: undefined, null, and empty fields are omitted', () => {
  assert.equal(
    buildPassageV1(syntheticNode({ chapterName: undefined, sectionName: '' })),
    'Handshake',
  );
  assert.equal(
    buildPassageV2(syntheticNode({ chapterName: undefined, sectionName: '' })),
    '考点：Handshake',
  );
});

test('V2-5: same node yields identical passage', () => {
  const node = syntheticNode();
  assert.equal(buildPassageV2(node), buildPassageV2({ ...node }));
});

test('V2-5: P1 vs P2 content differ and produce an embedding cache miss', async (t) => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'passage-v2-'));
  t.after(() => rmSync(cacheDir, { recursive: true, force: true }));
  const calls = [];
  const provider = {
    spec: {
      id: 'synthetic/provider',
      revision: 'synthetic-revision',
      queryPrefix: 'query: ',
      passagePrefix: 'passage: ',
      pooling: 'mean',
      normalize: true,
      dimension: 2,
      transformersVersion: 'synthetic-version',
    },
    providerId: 'synthetic-provider',
    modelVersion: 'synthetic-revision',
    async embed(view, text) {
      calls.push({ view, text });
      return [1, 0];
    },
  };
  const node = syntheticNode();
  const p1 = buildPassageV1(node);
  const p2 = buildPassageV2(node);

  assert.notEqual(p1, p2);
  await embedWithCache(provider, 'passage', p1, cacheDir);
  await embedWithCache(provider, 'passage', p2, cacheDir);

  assert.equal(calls.length, 2);
  assert.equal(readdirSync(cacheDir).length, 2);
});
