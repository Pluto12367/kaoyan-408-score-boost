import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadRepository() {
  const source = await readFile(new URL('../apps/api/src/score-center/repository.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    if (specifier.includes('@prisma/client') || specifier.includes('@kaoyan408/shared')) return {};
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  return module.exports;
}

test('resolver prefers trusted direct tags and preserves provenance', async () => {
  const { resolveKnowledgeNodesForQuestion } = await loadRepository();
  const db = {
    questionKnowledgeNodeTag: { findMany: async () => [
      { knowledgeNodeId: 'node-bridge', role: 'PRIMARY', confidence: 1, taggedBy: 'HYBRID', source: 'bridge:knowledge-point-map' },
      { knowledgeNodeId: 'node-direct', role: 'SECONDARY', confidence: 0.9, taggedBy: 'HUMAN', source: 'manual' },
    ] },
    questionKnowledgePoint: { findMany: async () => [] },
  };
  const result = await resolveKnowledgeNodesForQuestion(db, 'q-1');
  assert.deepEqual(result, [{
    knowledgeNodeId: 'node-direct', role: 'SECONDARY', confidence: 0.9, taggedBy: 'HUMAN', source: 'manual', origin: 'direct',
  }]);
});

test('resolver keeps bridge tags as fallback when no trusted direct tag exists', async () => {
  const { resolveKnowledgeNodesForQuestion } = await loadRepository();
  const db = {
    questionKnowledgeNodeTag: { findMany: async () => [
      { knowledgeNodeId: 'node-bridge', role: 'PRIMARY', confidence: 1, taggedBy: 'HYBRID', source: 'bridge:knowledge-point-map' },
    ] },
    questionKnowledgePoint: { findMany: async () => [] },
  };
  const result = await resolveKnowledgeNodesForQuestion(db, 'q-1');
  assert.equal(result[0].knowledgeNodeId, 'node-bridge');
  assert.equal(result[0].origin, 'bridge');
  assert.equal(result[0].source, 'bridge:knowledge-point-map');
});

test('resolver fallback mapping retains map metadata and is not mistaken for a direct tag', async () => {
  const { resolveKnowledgeNodesForQuestion } = await loadRepository();
  const db = {
    questionKnowledgeNodeTag: { findMany: async () => [] },
    questionKnowledgePoint: { findMany: async () => [{ knowledgePoint: { nodeMaps: [
      { knowledgeNodeId: 'node-map', confidence: 0.7, taggedBy: 'HUMAN' },
    ] } }] },
  };
  const result = await resolveKnowledgeNodesForQuestion(db, 'q-1');
  assert.deepEqual(result, [{
    knowledgeNodeId: 'node-map', role: 'PRIMARY', confidence: 0.7, taggedBy: 'HUMAN', source: null, origin: 'map-fallback',
  }]);
});
