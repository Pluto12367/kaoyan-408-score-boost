import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const consolePath = 'apps/web/src/features/student/StudentLearningConsole.tsx';

test('student learning console component exposes the approved v1 contract', () => {
  const source = readFileSync(consolePath, 'utf8');
  assert.match(source, /export interface StudentLearningConsoleProps/);
  assert.match(source, /todayPlan: TodayPlanType \| null/);
  assert.match(source, /wrongQuestionSummary: WrongQuestionSummary \| null/);
  assert.match(source, /masteryMap: MasteryMap \| null/);
  assert.match(source, /onNavigate: \(section: RoleSection\) => void/);
  assert.match(source, /onLaunchTodayTask: \(task: TodayPlanTask\) => void/);
  assert.match(source, /export function StudentLearningConsole/);
});

test('student learning console renders daily path, autonomous study, status, and next-step copy', () => {
  const source = readFileSync(consolePath, 'utf8');
  assert.match(source, /今日学习路径|今日學習路徑|Today/);
  assert.match(source, /自主学习|自主學習|Self-directed/);
  assert.match(source, /当前状态|目前状态|Current status/);
  assert.match(source, /下一步建议|下一步建議|Next step/);
  assert.match(source, /最高优先级|优先任务|priority/i);
  assert.match(source, /错题|wrong/i);
  assert.match(source, /薄弱|weak/i);
  assert.match(source, /阶段测验|测评|assessment/i);
  assert.match(source, /学习报告|report/i);
  assert.match(source, /知识|catalog/i);
});

test('student learning console surfaces completed-task feedback and the next visible action', () => {
  const source = readFileSync(consolePath, 'utf8');
  assert.match(source, /completedTaskTitles/);
  assert.match(source, /已完成：/);
  assert.match(source, /下一步/);
  assert.match(source, /继续复盘错题|继续薄弱点练习|查看学习报告/);
});

test('student dashboard wires the learning console above existing launchpad content', () => {
  const source = readFileSync('apps/web/src/features/student/StudentSections.tsx', 'utf8');
  assert.match(source, /StudentLearningConsole/);
  assert.match(source, /todayPlan=\{props\.todayPlan\}/);
  assert.match(source, /wrongQuestionSummary=\{props\.wrongQuestionSummary\.data\}/);
  assert.match(source, /masteryMap=\{props\.masteryMap\}/);
  assert.match(source, /learningCalendar=\{props\.learningCalendar\}/);
  assert.match(source, /onLaunchTodayTask=\{props\.onLaunchTodayTask\}/);
});

test('today-task question launches show task context inside practice training', () => {
  const sections = readFileSync('apps/web/src/features/student/StudentSections.tsx', 'utf8');
  const practice = readFileSync('apps/web/src/features/practice/PracticePanel.tsx', 'utf8');
  assert.match(sections, /taskContext=\{props\.todayTaskLaunchContext\?\.destination === 'question'/);
  assert.match(sections, /props\.todayPlan\?\.priorityTasks\.find/);
  assert.match(practice, /taskContext\?:/);
  assert.match(practice, /当前任务/);
  assert.match(practice, /完成后会更新今日进度/);
});

test('today plan task cards expose explicit status labels', () => {
  const source = readFileSync('apps/web/src/components/TodayPlan.tsx', 'utf8');
  assert.match(source, /getTaskStatusLabel/);
  assert.match(source, /待开始/);
  assert.match(source, /进行中/);
  assert.match(source, /已完成/);
});

test('student launchpad no longer owns the primary daily-learning-path copy', () => {
  const source = readFileSync('apps/web/src/features/onboarding/StudentLaunchpad.tsx', 'utf8');
  assert.equal(source.includes('今天先做什么，一眼看清'), false);
});
