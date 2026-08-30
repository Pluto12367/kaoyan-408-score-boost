import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = (path) => readFile(new URL(path, root), 'utf8');

test('ContextualCoach component calls the contextual coach endpoint and owns request state', async () => {
  const file = await source('apps/web/src/components/ContextualCoach.tsx');
  assert.match(file, /requestContextualCoach/);
  assert.match(file, /useState/);
  assert.match(file, /loading|submitting/);
  assert.match(file, /fallbackReason/);
  assert.match(file, /source/);
  assert.doesNotMatch(file, /requestTutorReply|requestAiFollowUp/);
});

test('frontend API exposes the four discriminated contextual coach requests without userId', async () => {
  const types = await source('apps/web/src/api/types.ts');
  const endpoint = await source('apps/web/src/api/endpoints/tutor.ts');
  assert.match(types, /ContextualCoachRequest/);
  assert.match(types, /contextType: 'question'/);
  assert.match(types, /contextType: 'wrong_question'/);
  assert.match(types, /contextType: 'knowledge_node'/);
  assert.match(types, /contextType: 'assessment'/);
  assert.match(types, /ContextualCoachResponse/);
  assert.match(endpoint, /requestContextualCoach/);
  assert.match(endpoint, /ai\/contextual-coach/);
  assert.match(endpoint, /fetchWithAuth/);
  assert.doesNotMatch(endpoint, /userId/);
});

test('legacy tutor API functions remain exported', async () => {
  const endpoint = await source('apps/web/src/api/endpoints/tutor.ts');
  const index = await source('apps/web/src/api/index.ts');
  assert.match(endpoint, /requestTutorReply/);
  assert.match(endpoint, /requestAiFollowUp/);
  assert.match(index, /endpoints\/tutor/);
});

test('ContextualCoach does not import frozen frontend worktree files', async () => {
  const file = await source('apps/web/src/components/ContextualCoach.tsx');
  for (const frozenName of ['PracticePanel', 'ExamSession', 'styles.css', 'theme-optimizations', 'themePreference']) {
    assert.doesNotMatch(file, new RegExp(frozenName));
  }
});
