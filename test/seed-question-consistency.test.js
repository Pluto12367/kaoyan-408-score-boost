import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

function extractQ001(moduleSource) {
  const start = moduleSource.indexOf("id: 'q-001'");
  const end = moduleSource.indexOf('},', start) + 2;
  return moduleSource.slice(start, end);
}

test('q-001 seed question is self-consistent (8 cache lines, 29 mod 8 = 5, answer C)', async () => {
  const api = extractQ001(await source('apps/api/src/questions/questions.service.ts'));
  assert.match(api, /stem: '直接映射 Cache（共 8 行）中，主存块号 29 应映射到 Cache 的哪一行？'/, 'stem must state the cache line count');
  assert.match(api, /answer: 'C'/, '29 mod 8 = 5 must be the correct answer');
  assert.match(api, /29 mod 8 = 5/, 'analysis must show the modulo arithmetic');

  const mock = extractQ001(await source('apps/web/src/mockData.ts'));
  assert.match(mock, /stem: '直接映射 Cache（共 8 行）中，主存块号 29 应映射到 Cache 的哪一行？'/, 'mock stem must match the API seed');
  assert.match(mock, /answer: 'C'/, 'mock answer must match the API seed');
  assert.match(mock, /29 mod 8 = 5/, 'mock analysis must match the API seed');
});
