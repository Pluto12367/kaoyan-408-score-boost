import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const COARSE_IDS = [
  'ds-list', 'ds-tree', 'ds-graph', 'ds-sort',
  'co-data', 'co-cache', 'co-instruction', 'co-cpu',
  'os-process', 'os-sync', 'os-memory', 'os-file',
  'net-link', 'net-ip', 'net-tcp', 'net-app',
];

test('knowledge point node map covers every coarse knowledge point once', () => {
  const map = JSON.parse(readFileSync('data/408/knowledge-point-node-map.json', 'utf8'));
  const ids = map.mappings.map((item) => item.knowledgePointId);
  assert.deepEqual([...ids].sort(), [...COARSE_IDS].sort());
  assert.equal(new Set(ids).size, ids.length, 'duplicate knowledgePointId in map');
});

test('every PRIMARY mapping target exists as an atomic node in the catalog tree', () => {
  const map = JSON.parse(readFileSync('data/408/knowledge-point-node-map.json', 'utf8'));
  const tree = JSON.parse(readFileSync('data/408/knowledge-tree-408-v2.json', 'utf8'));
  const atomicById = new Map(
    tree.nodes.filter((node) => node.nodeType === 'atomicPoint').map((node) => [node.id, node]),
  );
  for (const item of map.mappings) {
    assert.equal(item.mappingType, 'PRIMARY');
    assert.ok(item.confidence > 0 && item.confidence <= 1, `confidence out of range: ${item.knowledgePointId}`);
    const target = atomicById.get(item.knowledgeNodeId);
    assert.ok(target, `mapping target missing in tree: ${item.knowledgeNodeId}`);
    assert.ok(item.note, `mapping note required for ${item.knowledgePointId}`);
  }
});

test('seed script validates tree targets and supports dry-run without a database', () => {
  const source = readFileSync('scripts/seed-knowledge-point-map.mjs', 'utf8');
  assert.match(source, /knowledge-point-node-map\.json/);
  assert.match(source, /knowledge-tree-408-v2\.json/);
  assert.match(source, /--dry-run/);
  assert.match(source, /knowledgePointNodeMap\.upsert/);
  assert.match(source, /atomicPoint/);
  const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
  assert.equal(pkg.scripts['seed:knowledge-map'], 'node scripts/seed-knowledge-point-map.mjs');
});
