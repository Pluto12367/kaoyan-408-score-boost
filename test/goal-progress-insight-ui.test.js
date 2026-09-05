import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const goalInsightPath = 'apps/web/src/features/student/GoalProgressInsight.tsx';

test('goal progress insight component exposes a lightweight goal contract', () => {
  assert.equal(existsSync(goalInsightPath), true);
  const source = readFileSync(goalInsightPath, 'utf8');
  assert.match(source, /export interface GoalProgressInsightProps/);
  assert.match(source, /student\?:/);
  assert.match(source, /report\?:/);
  assert.match(source, /todayPlan\?:/);
  assert.match(source, /scoreGap/);
  assert.match(source, /currentScore/);
  assert.match(source, /targetScore/);
  assert.match(source, /目标进度/);
  assert.match(source, /当前估分/);
  assert.match(source, /目标分/);
  assert.match(source, /还差/);
  assert.match(source, /本周推进/);
  assert.match(source, /今天任务贡献/);
  assert.match(source, /这一步如何接近目标/);
});

test('student dashboard wires goal progress into the learning console', () => {
  const sections = readFileSync('apps/web/src/features/student/StudentSections.tsx', 'utf8');
  const consoleSource = readFileSync('apps/web/src/features/student/StudentLearningConsole.tsx', 'utf8');
  assert.match(sections, /student=\{props\.student\}/);
  assert.match(sections, /report=\{report\}/);
  assert.match(consoleSource, /GoalProgressInsight/);
  assert.match(consoleSource, /student: UserProfile/);
  assert.match(consoleSource, /report: WeaknessReport/);
  assert.match(consoleSource, /todayPlan=\{todayPlan\}/);
});

test('today plan, practice feedback, and report all surface goal progress context', () => {
  const app = readFileSync('apps/web/src/App.tsx', 'utf8');
  const home = readFileSync('apps/web/src/features/student/home/StudentHome.tsx', 'utf8');
  const todayPlan = readFileSync('apps/web/src/components/TodayPlan.tsx', 'utf8');
  const practice = readFileSync('apps/web/src/features/practice/PracticePanel.tsx', 'utf8');
  const report = readFileSync('apps/web/src/features/report/ReportSummaryPanel.tsx', 'utf8');
  const sections = readFileSync('apps/web/src/features/student/StudentSections.tsx', 'utf8');

  // V3 Sprint 1 收尾后 TodayPlan 由首页 StudentHome 承载（原 App plan 分支已并入首页）。
  assert.match(home, /<TodayPlan[\s\S]*student=\{student\}/);
  assert.match(sections, /StudentHome/);
  assert.match(todayPlan, /GoalProgressInsight/);
  assert.match(todayPlan, /student\?: UserProfile \| null/);
  assert.match(todayPlan, /todayPlan=\{plan\}/);

  assert.match(sections, /student=\{props\.student\}[\s\S]*targetWeakPointTitle=\{report\.weakPoints\[0\]\?\.title \?\? null\}/);
  assert.match(practice, /GoalProgressInsight/);
  assert.match(practice, /student\?: UserProfile \| null/);
  assert.match(practice, /targetWeakPointTitle\?: string \| null/);
  assert.match(practice, /actionLabel="本次训练推进目标"/);

  assert.match(report, /GoalProgressInsight/);
  assert.match(report, /student=\{student\}/);
  // Canonical overview 优先、无则回退 report（V3 数据源收敛后的传参契约）。
  assert.match(report, /report=\{canonicalOverview \? null : report\}/);
  assert.match(report, /actionLabel="报告目标进度"/);
});

test('goal progress insight styling is responsive and visually separated from evidence cards', () => {
  const styles = readFileSync('apps/web/src/styles.css', 'utf8');
  assert.match(styles, /\.goal-progress-insight/);
  assert.match(styles, /\.goal-progress-grid/);
  assert.match(styles, /\.goal-progress-main/);
  assert.match(styles, /\.goal-progress-pill/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*goal-progress-grid/);
});
