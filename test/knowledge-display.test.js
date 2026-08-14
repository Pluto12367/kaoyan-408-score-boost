import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadDisplay() {
  const source = await readFile(new URL('../packages/shared/src/knowledgeDisplay.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('resolves a coarse knowledge point to its catalog title and chapter', async () => {
  const { resolveKnowledgePointDisplay } = await loadDisplay();
  const display = resolveKnowledgePointDisplay(
    { id: 'co-cache', title: 'Cache 映射与替换', chapter: '存储系统' },
    new Map([['co-cache', { title: 'Cache基本原理', chapter: '存储系统' }]]),
  );
  assert.deepEqual(display, { title: 'Cache基本原理', chapter: '存储系统' });
});

test('falls back to the knowledge point values when no mapping exists', async () => {
  const { resolveKnowledgePointDisplay } = await loadDisplay();
  const display = resolveKnowledgePointDisplay(
    { id: 'ds-tree', title: '树的遍历应用', chapter: '树与二叉树' },
    new Map([['co-cache', { title: 'Cache基本原理', chapter: '存储系统' }]]),
  );
  assert.deepEqual(display, { title: '树的遍历应用', chapter: '树与二叉树' });
});

test('accepts a plain record lookup for the same contract', async () => {
  const { resolveKnowledgePointDisplay } = await loadDisplay();
  const display = resolveKnowledgePointDisplay(
    { id: 'os-sync', title: '进程同步与互斥', chapter: '进程管理' },
    { 'os-sync': { title: '信号量', chapter: '同步与互斥' } },
  );
  assert.deepEqual(display, { title: '信号量', chapter: '同步与互斥' });
});
