import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readFileSync as readFileSyncSync } from 'node:fs';
import ts from 'typescript';

async function loadLearning() {
  const source = await readFile(new URL('../packages/shared/src/learning.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

test('dedupeQuestionsByStem removes duplicate stems and keeps the first occurrence', async () => {
  const { dedupeQuestionsByStem } = await loadLearning();
  const questions = [
    { id: 'q-a', stem: 'Cache 命中率提高后，平均访存时间通常会如何变化？' },
    { id: 'q-b', stem: '进程与程序的主要区别是？' },
    { id: 'q-c', stem: '  Cache 命中率提高后，平均访存时间通常会如何变化？  ' },
  ];
  const result = dedupeQuestionsByStem(questions);
  assert.deepEqual(result.map((item) => item.id), ['q-a', 'q-b']);
});

test('dedupeQuestionsByStem handles an empty list', async () => {
  const { dedupeQuestionsByStem } = await loadLearning();
  assert.deepEqual(dedupeQuestionsByStem([]), []);
});

test('recommended practice set dedupes questions by stem before slicing', () => {
  const source = readFileSyncSync('apps/api/src/study/study.service.ts', 'utf8');
  const block = source.slice(source.indexOf('getRecommendedPracticeSet'), source.indexOf('getRecommendedPracticeSet') + 1400);
  assert.match(block, /dedupeQuestionsByStem/);
});
