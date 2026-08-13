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

test('homepage route delegates plan editing to the dedicated plan section', async () => {
  const launchpad = await readFile(new URL('../apps/web/src/features/onboarding/StudentLaunchpad.tsx', import.meta.url), 'utf8');
  assert.match(launchpad, /<TodayLearningRoute/);
  assert.match(launchpad, /onOpenPlan=\{\(\) => onNavigate\('plan'\)\}/);
  assert.doesNotMatch(launchpad, /<TodayPlan\b/);
});

test('today task cards explain why, target, benefit, and fallback actions', async () => {
  const source = await readFile(new URL('../apps/web/src/components/TodayPlan.tsx', import.meta.url), 'utf8');

  assert.match(source, /task-action-guide/);
  assert.match(source, /为什么做/);
  assert.match(source, /完成标准/);
  assert.match(source, /完成收益/);
  assert.match(source, /做不完怎么办/);
  assert.match(source, /task\.reason/);
  assert.match(source, /完成 \{task\.questionCount\} 题/);
  assert.match(source, /计划 \{task\.minutes\} 分钟/);
  assert.match(source, /更新掌握度/);
  assert.match(source, /延后、重新安排，或降低本周任务量/);
});

test('study plan overview frames today position, weekly goal, and post-completion review action', async () => {
  const source = await readFile(new URL('../apps/web/src/features/plan/StudyPlanOverview.tsx', import.meta.url), 'utf8');

  assert.match(source, /plan-action-summary/);
  assert.match(source, /今日定位/);
  assert.match(source, /本周目标/);
  assert.match(source, /完成后/);
  assert.match(source, /优先处理高优先级薄弱点/);
  assert.match(source, /按计划完成任务并保持复盘节奏/);
  assert.match(source, /回到报告查看掌握度变化/);
});
