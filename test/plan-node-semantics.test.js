import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

test('study service builds a node-driven plan and attaches question ids to tasks', () => {
  const service = readFileSync('apps/api/src/study/study.service.ts', 'utf8');
  assert.match(service, /buildNodeDrivenPlan/);
  assert.match(service, /buildNodeDrivenDailyTasks/);
  assert.match(service, /questionIds: this\.nodeQuestionIdsByNode\.get/);
});

test('today plan task type and launch preflight support node-attributed question ids', () => {
  const onboardingApi = readFileSync('apps/web/src/api/endpoints/onboarding.ts', 'utf8');
  const route = readFileSync('apps/web/src/features/onboarding/todayLearningRoute.ts', 'utf8');
  const app = readFileSync('apps/web/src/App.tsx', 'utf8');
  assert.match(onboardingApi, /questionIds\?: string\[\]/);
  assert.match(route, /task\.questionIds/);
  assert.match(app, /todayTaskLaunchContext\.questionIds/);
});

test('task launch preflight resolves node-attributed question ids', async () => {
  const source = await readFile(new URL('../apps/web/src/features/onboarding/todayLearningRoute.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const { preflightTodayTaskLaunch } = await import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);

  const nodeTask = preflightTodayTaskLaunch(
    { id: 't1', knowledgePointId: 'OS-C02-S04-P20', questionIds: ['q-node-1', 'q-node-2'], mode: '专项训练', priority: '高' },
    [{ id: 'q-node-1', knowledgePointIds: ['os-sync'] }],
    [],
  );
  assert.equal(nodeTask.kind, 'ready');
  if (nodeTask.kind === 'ready') {
    assert.deepEqual(nodeTask.context.questionIds, ['q-node-1', 'q-node-2']);
  }

  const legacyTask = preflightTodayTaskLaunch(
    { id: 't2', knowledgePointId: 'os-sync', mode: '专项训练', priority: '中' },
    [{ id: 'q-1', knowledgePointIds: ['os-sync'] }],
    [],
  );
  assert.equal(legacyTask.kind, 'ready');
});
