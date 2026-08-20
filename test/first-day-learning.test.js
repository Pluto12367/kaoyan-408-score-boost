import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function loadSource() {
  return readFile(new URL('../apps/web/src/features/student/firstDayLearning.ts', import.meta.url), 'utf8');
}

const task = (overrides = {}) => ({
  id: 'task-1',
  knowledgePointId: 'kp-1',
  subject: '数据结构',
  chapter: '树',
  title: '二叉树专项',
  minutes: 20,
  questionCount: 10,
  mode: '专项训练',
  priority: '高',
  reason: '近期错误较多',
  nextAction: '完成专项训练',
  scheduledDate: '2026-08-14',
  status: 'pending',
  postponeCount: 0,
  ...overrides,
});

test('first day learning returns a unique primary action before diagnosis', async () => {
  const source = await loadSource();
  assert.match(source, /export function firstDayLearning/);
  assert.match(source, /if \(!hasCompletedDiagnostic\)/);
  assert.match(source, /headline: '完成入学诊断'/);
  assert.match(source, /primaryAction: \{ label: '完成入学诊断', targetSection: 'plan' \}/);
  assert.match(source, /secondaryAction: \{ label: '稍后完成', targetSection: 'dashboard' \}/);
  assert.match(source, /status: 'diagnostic'/);
});

test('first day learning prioritizes today task over wrong-book and report', async () => {
  const source = await loadSource();
  assert.match(source, /const firstTask = todayPlan\?\.priorityTasks\.find/);
  assert.match(source, /headline: '开始今日优先任务'/);
  assert.match(source, /primaryAction: \{ label: '开始今日任务', targetSection: 'question' \}/);
  assert.match(source, /secondaryAction: \{ label: '直接练题', targetSection: 'question' \}/);
  assert.match(source, /status: 'ready'/);
});

test('first day learning returns wrong-book when today task is done but errors remain', async () => {
  const source = await loadSource();
  assert.match(source, /headline: '复盘错题'/);
  assert.match(source, /primaryAction: \{ label: '去错题本', targetSection: 'wrong-book' \}/);
  assert.match(source, /secondaryAction: \{ label: '查看报告', targetSection: 'report' \}/);
  assert.match(source, /status: 'wrong-book'/);
});

test('first day learning returns report review once today and wrong-book are clear', async () => {
  const source = await loadSource();
  assert.match(source, /headline: '查看学习变化'/);
  assert.match(source, /primaryAction: \{ label: '查看学习报告', targetSection: 'report' \}/);
  assert.match(source, /secondaryAction: \{ label: '继续薄弱点练习', targetSection: 'question' \}/);
  assert.match(source, /status: 'report'/);
});

test('student learning console exposes first-day primary action contract', async () => {
  const source = await readFile(new URL('../apps/web/src/features/student/StudentLearningConsole.tsx', import.meta.url), 'utf8');
  assert.match(source, /firstDayLearning/);
  assert.match(source, /todayPrimaryAction/);
  assert.match(source, /首日主行动/);
  assert.match(source, /今天先做什么/);
});
