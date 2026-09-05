import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

const require = createRequire(import.meta.url);
process.env.TS_NODE_PROJECT = fileURLToPath(new URL('../apps/api/tsconfig.json', import.meta.url));
require('ts-node/register');

test('wrong-question snapshot preserves explicit Point to many Nodes mapping', () => {
  const { buildWrongQuestionSnapshot } = require('../apps/api/src/study/wrong-question.snapshot.ts');
  const snapshot = buildWrongQuestionSnapshot({
    userId: 'u-1',
    asOf: '2026-09-02T00:00:00.000Z',
    practiceRecords: [{ questionId: 'q-1', knowledgePointId: 'point-a', correct: false, timeSpentSec: 10, submittedAt: '2026-09-01T00:00:00.000Z' }],
    wrongQuestionReviews: [], reviewSchedules: [], reviewAttempts: [],
    questions: [{ id: 'q-1', stem: 'q', answer: 'A', knowledgePointIds: ['point-a'] }],
    knowledgePoints: [{ id: 'point-a', title: 'Point A', subject: 'DS', chapter: 'C1', importance: 5 }],
    knowledgePointNodeMaps: [
      { knowledgePointId: 'point-a', knowledgeNodeId: 'node-a' },
      { knowledgePointId: 'point-a', knowledgeNodeId: 'node-b' },
    ],
  });
  assert.deepEqual(snapshot.currentWrongItems[0].knowledgeNodeIds, ['node-a', 'node-b']);
});

test('review center mastery join requires explicit node mapping and averages many nodes', async () => {
  const source = await readFile(new URL('../apps/web/src/features/mistakes/reviewCenterViewModel.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  Function('require', 'module', 'exports', output)((specifier) => {
    if (specifier.includes('../../api')) return {};
    if (specifier.includes('../../api/endpoints/review')) return {};
    throw new Error(`Unexpected dependency: ${specifier}`);
  }, module, module.exports);
  const { resolveWrongQuestionMastery } = module.exports;
  const index = new Map([
    ['node-a', { masteryRate: 20, status: 'weak' }],
    ['node-b', { masteryRate: 80, status: 'mastered' }],
  ]);
  assert.deepEqual(resolveWrongQuestionMastery({ knowledgeNodeIds: ['node-a', 'node-b'] }, index), { masteryRate: 50, status: 'weak' });
  assert.equal(resolveWrongQuestionMastery({ knowledgeNodeIds: ['node-missing'] }, index), null);
});
