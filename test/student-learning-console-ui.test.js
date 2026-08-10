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
  assert.match(source, /onContinueToday: \(\) => void/);
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
