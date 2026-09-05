import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('StudyController exposes the authenticated read-only StudentContext endpoint', async () => {
  const controller = await readFile(new URL('../apps/api/src/study/study.controller.ts', import.meta.url), 'utf8');
  const moduleSource = await readFile(new URL('../apps/api/src/study/study.module.ts', import.meta.url), 'utf8');
  assert.match(controller, /StudentContextQueryService/);
  assert.match(controller, /@Get\('student-context'\)/);
  assert.match(controller, /studentContextQuery\.getContext\(user\.id/);
  const method = controller.match(/getStudentContext\([\s\S]*?\n  \}\n/)?.[0] ?? '';
  assert.doesNotMatch(method, /resolveUserId\(user, viewUserId\)/);
  assert.match(moduleSource, /StudentContextQueryService/);
});
