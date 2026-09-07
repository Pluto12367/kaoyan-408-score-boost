import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// V9 Phase 1 — DailyBrief: the coach's single grounded daily briefing.
// Every line must trace to a fact from StudentContext or the today plan.
// insufficient_data propagates: no practice volume → no accuracy claim.

async function loadModule() {
  const source = await readFile(new URL('../apps/api/src/study/daily-brief.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', output)(() => {
    throw new Error('daily-brief must stay dependency-free');
  }, module, module.exports);
  return module.exports;
}

const input = (overrides = {}) => ({
  dateKey: '2026-09-07',
  remainingDays: 109,
  streak: 3,
  recentAccuracy: { status: 'sufficient', value: 0.62 },
  review: { dueCount: 11, overdueCount: 13 },
  tasks: [
    { title: 'Cache 映射与替换', minutes: 45, reason: '重错点', completed: false },
    { title: '进程同步与互斥', minutes: 45, reason: '今日计划', completed: false },
    { title: '线性表结构与操作', minutes: 45, reason: '今日计划', completed: true },
  ],
  completedTasks: 1,
  totalTasks: 3,
  ...overrides,
});

test('open task headlines the brief and leads priorities', async () => {
  const { buildDailyBrief } = await loadModule();
  const brief = buildDailyBrief(input());
  assert.match(brief.headline, /先完成「Cache 映射与替换」/);
  assert.equal(brief.priorities[0].kind, 'task');
  assert.equal(brief.priorities[0].title, 'Cache 映射与替换');
  assert.equal(brief.priorities.length, 3);
  assert.equal(brief.priorities[2].completed ?? false, false, 'completed tasks never headline priorities');
});

test('state lines state the review debt honestly in three tiers', async () => {
  const { buildDailyBrief } = await loadModule();
  const brief = buildDailyBrief(input());
  assert.ok(brief.stateLines.some((line) => line.includes('逾期复习 13 道')), 'overdue debt must be named');
  assert.ok(brief.stateLines.some((line) => line.includes('距离考试 109 天')));

  const clean = buildDailyBrief(input({ review: { dueCount: 0, overdueCount: 0 } }));
  assert.ok(clean.stateLines.some((line) => line.includes('复习计划已清零')));
});

test('accuracy line requires sufficient sample; insufficient volume states so', async () => {
  const { buildDailyBrief } = await loadModule();
  const brief = buildDailyBrief(input());
  assert.ok(brief.stateLines.some((line) => line.includes('正确率 62%')));

  const thin = buildDailyBrief(input({ recentAccuracy: { status: 'insufficient_data', value: null } }));
  assert.ok(thin.stateLines.some((line) => line.includes('还不足以评估正确率')), 'no accuracy claim without evidence');
  assert.doesNotMatch(JSON.stringify(thin.stateLines), /正确率 \d+%/);
});

test('follow-up note reflects completion state', async () => {
  const { buildDailyBrief } = await loadModule();
  const partial = buildDailyBrief(input());
  assert.match(partial.followUpNote ?? '', /已完成 1\/3/);

  const allDone = buildDailyBrief(input({
    tasks: [{ title: 'A', minutes: 30, reason: 'r', completed: true }],
    completedTasks: 1,
    totalTasks: 1,
    review: { dueCount: 0, overdueCount: 0 },
  }));
  assert.match(allDone.followUpNote ?? '', /努力与效果/);

  const fresh = buildDailyBrief(input({ completedTasks: 0, totalTasks: 0, tasks: [], review: { dueCount: 0, overdueCount: 0 } }));
  assert.equal(fresh.followUpNote, null);
});

test('all-done day with review debt points at the reviews first', async () => {
  const { buildDailyBrief } = await loadModule();
  const brief = buildDailyBrief(input({
    tasks: [{ title: 'A', minutes: 30, reason: 'r', completed: true }],
    completedTasks: 1,
    totalTasks: 1,
    review: { dueCount: 5, overdueCount: 3 },
  }));
  assert.match(brief.headline, /逾期复习/);
  const reviewPriority = brief.priorities.find((item) => item.kind === 'review');
  assert.ok(reviewPriority, 'review debt becomes a priority when tasks are done');
  assert.equal(reviewPriority.minutes, null, 'review time is not fabricated');
});

test('V9 #P1: the brief is exposed via GET /coach/daily-brief with access isolation', async () => {
  const controller = await readFile(new URL('../apps/api/src/study/daily-brief.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /Get\('coach\/daily-brief'\)/);
  assert.match(controller, /assertTeacherAuthorizedForStudent/, 'teacher access requires authorization');
  assert.match(controller, /ForbiddenException\('You can only access your own data'\)/);
  assert.match(controller, /buildDailyBrief\(/);

  const moduleSource = await readFile(new URL('../apps/api/src/study/study.module.ts', import.meta.url), 'utf8');
  assert.match(moduleSource, /DailyBriefController/);
});

test('V9 #P1: the home brief card is honest about demo mode and failure', async () => {
  const card = await readFile(new URL('../apps/web/src/features/student/home/components/DailyBriefCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /coach\/daily-brief/);
  assert.match(card, /isStaticDemoMode\(\)\) return null/, 'demo mode hides the card instead of faking a briefing');
  assert.match(card, /let cancelled = false;/);
  const home = await readFile(new URL('../apps/web/src/features/student/home/StudentHome.tsx', import.meta.url), 'utf8');
  assert.match(home, /<DailyBriefCard \/>/);
});

test('V9 slice 2: the brief recalculates when the student returns from practice', async () => {
  const card = await readFile(new URL('../apps/web/src/features/student/home/components/DailyBriefCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /addEventListener\('focus'/, 'window focus triggers a recompute');
  assert.match(card, /visibilitychange/, 'returning to the tab triggers a recompute');
  assert.match(card, /daily-brief:refresh/, 'explicit completion signals can force an immediate recompute');
  assert.match(card, /removeEventListener/, 'listeners are cleaned up on unmount');
});

test('V9 Phase 5: proactive coach endpoint is grounded, capped, and quiet by default', async () => {
  const controller = await readFile(new URL('../apps/api/src/study/daily-brief.controller.ts', import.meta.url), 'utf8');
  assert.match(controller, /Get\('coach\/proactive'\)/);
  assert.match(controller, /detectLearningRisks\(signals\)/);
  assert.match(controller, /deriveProactiveInterventions\(/);
  assert.match(controller, /\.slice\(0, 2\)/, 'at most 2 interventions per pull');

  const card = await readFile(new URL('../apps/web/src/features/student/home/components/ProactiveCoachCard.tsx', import.meta.url), 'utf8');
  assert.match(card, /coach\/proactive/);
  assert.match(card, /data\.count === 0\) return null/, 'no risks → the card stays silent');
  assert.match(card, /if \(isStaticDemoMode\(\)\) return null;/, 'demo mode renders nothing');

  const home = await readFile(new URL('../apps/web/src/features/student/home/StudentHome.tsx', import.meta.url), 'utf8');
  assert.match(home, /<ProactiveCoachCard \/>/);
});
