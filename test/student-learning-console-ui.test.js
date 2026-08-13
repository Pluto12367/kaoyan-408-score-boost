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
  assert.match(source, /自主学习推荐区|自主學習推薦區|Self-directed recommendations/);
  assert.match(source, /当前状态|目前状态|Current status/);
  assert.match(source, /下一步建议|下一步建議|Next step/);
  assert.match(source, /最高优先级|优先任务|priority/i);
  assert.match(source, /错题|wrong/i);
  assert.match(source, /薄弱|weak/i);
  assert.match(source, /学习报告|report/i);
});

test('student learning console turns autonomous study into four focused recommendation cards', () => {
  const source = readFileSync(consolePath, 'utf8');
  assert.match(source, /selfStudyRecommendations/);
  assert.match(source, /title: '薄弱知识点'/);
  assert.match(source, /title: '错题复盘'/);
  assert.match(source, /title: '专项训练'/);
  assert.match(source, /title: '报告查看'/);
  assert.match(source, /targetSection: 'question'/);
  assert.match(source, /targetSection: 'wrong-book'/);
  assert.match(source, /targetSection: 'report'/);
  assert.match(source, /className="self-study-recommendation-grid"/);
  assert.doesNotMatch(source, /title: '阶段测验'/);
  assert.doesNotMatch(source, /title: '知识图谱'/);
});

test('student learning console explains what students gain after finishing today', () => {
  const source = readFileSync(consolePath, 'utf8');
  assert.match(source, /todayOutcomeItems/);
  assert.match(source, /今天完成后，你会得到/);
  assert.match(source, /更新掌握度/);
  assert.match(source, /减少待复盘/);
  assert.match(source, /推进薄弱点/);
  assert.match(source, /明确下一步/);
  assert.match(source, /className="learning-outcome-card"/);
  assert.match(source, /className="learning-outcome-grid"/);
  assert.match(source, /dueWrongCount != null \? `复盘后待处理错题会减少，当前还有 \$\{dueWrongCount\} 道`/);
  assert.match(source, /weakPoint \? `当前重点推进：\$\{weakPoint\}`/);
});

test('student learning console surfaces a recent learning feedback card', () => {
  const source = readFileSync(consolePath, 'utf8');
  assert.match(source, /recentLearningFeedback/);
  assert.match(source, /最近一次学习反馈/);
  assert.match(source, /最近动作/);
  assert.match(source, /系统已记录/);
  assert.match(source, /建议下一步/);
  assert.match(source, /completedTitles\.length/);
  assert.match(source, /task \?/);
  assert.match(source, /dueWrongCount && dueWrongCount > 0/);
  assert.match(source, /className="recent-learning-feedback-card"/);
  assert.match(source, /className="recent-learning-feedback-grid"/);
});

test('student learning console summarizes today review outcomes and next actions', () => {
  const source = readFileSync(consolePath, 'utf8');
  assert.match(source, /dailyReviewSummary/);
  assert.match(source, /今日学习复盘/);
  assert.match(source, /今日完成/);
  assert.match(source, /今日变化/);
  assert.match(source, /明日建议/);
  assert.match(source, /completedTitles\.length/);
  assert.match(source, /todayPlan\.summary\.totalTasks/);
  assert.match(source, /dueWrongCount != null/);
  assert.match(source, /weakPoint/);
  assert.match(source, /className="daily-review-card"/);
  assert.match(source, /className="daily-review-grid"/);
  assert.match(source, /继续练习/);
  assert.match(source, /复盘错题/);
  assert.match(source, /查看报告/);
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
  assert.match(sections, /deriveTodayTaskNextStep/);
  assert.match(sections, /taskNextStep=\{todayTaskNextStep\}/);
  assert.match(sections, /onTaskNextStep=\{todayTaskNextStep \? \(\) => props\.onNavigate\(todayTaskNextStep\.targetSection\) : undefined\}/);
  assert.match(practice, /taskContext\?:/);
  assert.match(practice, /taskNextStep\?:/);
  assert.match(practice, /当前任务/);
  assert.match(practice, /完成后会更新今日进度/);
  assert.match(practice, /任务完成后的下一步/);
  assert.match(practice, /taskNextStep\.actionLabel/);
});

test('student learning console reuses today-task next-step recommendations after completed work', () => {
  const source = readFileSync(consolePath, 'utf8');
  assert.match(source, /deriveTodayTaskNextStep/);
  assert.match(source, /completedNextStep/);
  assert.match(source, /completedNextStep\.message/);
  assert.match(source, /completedNextStep\.actionLabel/);
  assert.match(source, /onNavigate\(completedNextStep\.targetSection\)/);
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
