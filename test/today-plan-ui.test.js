import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadDraftPolicy() {
  const source = await readFile(new URL('../apps/web/src/features/plan/taskCompletionDraft.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
}

test('task completion requires real student-entered metrics', async () => {
  const { validateTaskCompletionDraft } = await loadDraftPolicy();

  assert.equal(validateTaskCompletionDraft({}).valid, false);
  assert.equal(validateTaskCompletionDraft({
    completedQuestionCount: 8,
    correctCount: 9,
    minutesSpent: 30,
    selfRating: 3,
  }).valid, false);
  assert.deepEqual(validateTaskCompletionDraft({
    completedQuestionCount: 8,
    correctCount: 6,
    minutesSpent: 30,
    selfRating: 4,
  }), {
    valid: true,
    value: { completedQuestionCount: 8, correctCount: 6, minutesSpent: 30, selfRating: 4 },
  });
});

test('App does not retain the legacy fabricated task completion handler', async () => {
  const source = await readFile(new URL('../apps/web/src/App.tsx', import.meta.url), 'utf8');

  assert.equal(source.includes('function handleCompleteTask'), false);
  assert.equal(source.includes('Math.round(completedQuestionCount * 0.58)'), false);
});

test('onboarding and today-task actions refresh every student progress resource', async () => {
  const source = await readFile(new URL('../apps/web/src/App.tsx', import.meta.url), 'utf8');
  const refreshCalls = source.match(/refreshStudentProgress\(\)/g) ?? [];

  assert.match(source, /refreshAll: refreshStudentProgress/);
  assert.ok(refreshCalls.length >= 2, 'onboarding and today-plan refresh should both update student progress');
});
