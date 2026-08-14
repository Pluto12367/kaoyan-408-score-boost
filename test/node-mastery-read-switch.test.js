import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('study service exposes a node-mastery read switch and read caches', () => {
  const service = readFileSync('apps/api/src/study/study.service.ts', 'utf8');
  assert.match(service, /USE_KNODE_MASTERY/);
  assert.match(service, /useNodeMastery/);
  assert.match(service, /nodeMasteryByUser/);
  assert.match(service, /nodeQuestionIdsByNode/);
});

test('mastery map and weak report switch to node-mastery derivation', () => {
  const service = readFileSync('apps/api/src/study/study.service.ts', 'utf8');
  assert.match(service, /buildNodeMasteryMap/);
  assert.match(service, /deriveNodeWeakPoints/);
});

test('recommended practice set filters by node attribution', () => {
  const service = readFileSync('apps/api/src/study/study.service.ts', 'utf8');
  assert.match(service, /nodeQuestionIdsByNode/);
});

test('score-center repository exposes the atomic node catalog loader', () => {
  const repository = readFileSync('apps/api/src/score-center/repository.ts', 'utf8');
  assert.match(repository, /loadActiveAtomicNodeCatalog/);
});

test('shared exports the node mastery map helpers', () => {
  const index = readFileSync('packages/shared/src/index.ts', 'utf8');
  assert.match(index, /nodeMastery/);
});
