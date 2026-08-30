import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('ContextualCoach displays the backend-provided source without provider inference', async () => {
  const file = await source('apps/web/src/components/ContextualCoach.tsx');
  assert.match(file, /来源：\{response\.source\}/);
  assert.doesNotMatch(file, /isRealModelSource|DeepSeek|deepseek/);
});

test('ContextualCoach explicitly displays template fallback state and reason', async () => {
  const file = await source('apps/web/src/components/ContextualCoach.tsx');
  assert.match(file, /response\.fallbackReason/);
  assert.match(file, /备用方案/);
  assert.match(file, /原因：\{response\.fallbackReason\}/);
});

test('ContextualCoach uses a friendly request error without exposing internal details', async () => {
  const file = await source('apps/web/src/components/ContextualCoach.tsx');
  assert.match(file, /AI 教练暂时无法响应，请稍后重试/);
  assert.doesNotMatch(file, /requestError\.message|stack/);
  assert.match(file, /role="alert"/);
});

test('ContextualCoach keeps loading and response states, while legacy tutor remains untouched', async () => {
  const component = await source('apps/web/src/components/ContextualCoach.tsx');
  const endpoint = await source('apps/web/src/api/endpoints/tutor.ts');
  const tutorPanel = await source('apps/web/src/features/tutor/TutorPanel.tsx');
  assert.match(component, /loading/);
  assert.match(component, /response/);
  assert.match(endpoint, /requestTutorReply/);
  assert.match(endpoint, /ai\/tutor-reply/);
  assert.ok(tutorPanel.length > 0);
});
