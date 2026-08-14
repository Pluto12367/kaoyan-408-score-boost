import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

async function loadSearchHelpers() {
  const source = await readFile(new URL('../packages/shared/src/knowledgeCatalog.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('search hit summary groups cross-subject matches and counts them', async () => {
  const { summarizeSearchHits } = await loadSearchHelpers();
  const hits = summarizeSearchHits([
    { subjectCode: 'CO', subjectName: '计算机组成原理' },
    { subjectCode: 'CO', subjectName: '计算机组成原理' },
    { subjectCode: 'OS', subjectName: '操作系统' },
    { subjectCode: 'DS', subjectName: '数据结构' },
  ], 'DS');
  assert.equal(hits.total, 4);
  assert.equal(hits.activeCount, 1);
  assert.deepEqual(hits.otherSubjects, [
    { code: 'CO', name: '计算机组成原理', count: 2 },
    { code: 'OS', name: '操作系统', count: 1 },
  ]);
});

test('search hit summary returns no other subjects when everything matches the active subject', async () => {
  const { summarizeSearchHits } = await loadSearchHelpers();
  const hits = summarizeSearchHits([
    { subjectCode: 'DS', subjectName: '数据结构' },
    { subjectCode: 'DS', subjectName: '数据结构' },
  ], 'DS');
  assert.deepEqual(hits, { total: 2, activeCount: 2, otherSubjects: [] });
});

test('search hit summary handles an empty match list', async () => {
  const { summarizeSearchHits } = await loadSearchHelpers();
  assert.deepEqual(summarizeSearchHits([], 'DS'), { total: 0, activeCount: 0, otherSubjects: [] });
});

test('catalog page guides users to switch subject when matches exist elsewhere', () => {
  const source = readFileSync('apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx', 'utf8');
  assert.match(source, /summarizeSearchHits/);
  assert.match(source, /otherSubjects/);
  assert.match(source, /setActive\(subjectHit\.code/);
  assert.match(source, /个匹配/);
  assert.match(source, /没有符合条件的知识点/);
});
