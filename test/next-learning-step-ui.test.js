import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import ts from 'typescript';

const cardPath = 'apps/web/src/features/student/NextLearningStepCard.tsx';

// The card component is presentational; resolver tests only call pure helpers,
// so a no-op jsx runtime is enough to evaluate the module in node:test.
const JSX_RUNTIME_STUB = 'export const jsx=()=>null;export const jsxs=()=>null;export const Fragment=null;';

async function loadResolvers() {
  const source = readFileSync(cardPath, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const withJsxStub = output.replace(
    /from "react\/jsx-runtime"/g,
    `from "data:text/javascript,${encodeURIComponent(JSX_RUNTIME_STUB)}"`,
  );
  return import(`data:text/javascript;base64,${Buffer.from(withJsxStub).toString('base64')}`);
}

const taskFixture = (overrides = {}) => ({
  id: 'task-1', knowledgePointId: 'kp-1', subject: '数据结构', chapter: '树',
  title: '二叉树专项', minutes: 20, questionCount: 10, mode: '专项训练',
  priority: '中', reason: '近期错误较多', nextAction: '完成专项训练',
  scheduledDate: '2026-08-14', status: 'pending', postponeCount: 0,
  ...overrides,
});

const planFixture = (tasks, overrides = {}) => ({
  userId: 'u-1', phase: '基础阶段', generatedAt: '2026-08-14T00:00:00+08:00',
  summary: {
    completedTasks: tasks.filter((item) => item.completed || item.status === 'completed').length,
    totalTasks: tasks.length,
    completionRate: 0,
    todayAccuracyRate: 0,
    streakDays: 1,
  },
  priorityTasks: tasks,
  weekProgress: [],
  reviewDue: 0,
  checkpoint: '完成今日任务',
  ...overrides,
});

test('next learning step card exposes the approved lightweight contract', () => {
  assert.equal(existsSync(cardPath), true);
  const source = readFileSync(cardPath, 'utf8');
  assert.match(source, /export interface NextLearningStepAction/);
  assert.match(source, /label: string/);
  assert.match(source, /targetSection: RoleSection/);
  assert.match(source, /export interface NextLearningStep/);
  assert.match(source, /contextLabel: string/);
  assert.match(source, /title: string/);
  assert.match(source, /reason: string/);
  assert.match(source, /primaryAction: NextLearningStepAction/);
  assert.match(source, /secondaryAction: NextLearningStepAction/);
  assert.match(source, /export function NextLearningStepCard/);
  assert.match(source, /下一步/);
  assert.match(source, /为什么推荐/);
  assert.match(source, /onNavigate\(step\.primaryAction\.targetSection\)/);
  assert.match(source, /onNavigate\(step\.secondaryAction\.targetSection\)/);
});

test('next learning step card styling is visually distinct and responsive', () => {
  const styles = readFileSync('apps/web/src/styles.css', 'utf8');
  assert.match(styles, /\.next-learning-step-card/);
  assert.match(styles, /\.next-learning-step-actions/);
  assert.match(styles, /\.next-learning-step-card\.compact/);
  assert.match(styles, /@media \(max-width: 720px\)[\s\S]*next-learning-step-actions/);
});

test('next learning step card aria label uses the context label without duplicating the suffix', () => {
  const source = readFileSync(cardPath, 'utf8');
  assert.match(source, /aria-label=\{step\.contextLabel\}/);
  assert.doesNotMatch(source, /aria-label=\{`\$\{step\.contextLabel\}下一步`\}/);
});

test('next learning step resolvers cover dashboard plan practice wrong-book and report contexts', () => {
  const source = readFileSync(cardPath, 'utf8');
  assert.match(source, /export function buildDashboardNextLearningStep/);
  assert.match(source, /export function buildPlanNextLearningStep/);
  assert.match(source, /export function buildPracticeNextLearningStep/);
  assert.match(source, /export function buildWrongBookNextLearningStep/);
  assert.match(source, /export function buildReportNextLearningStep/);
  assert.match(source, /targetSection: 'plan'/);
  assert.match(source, /targetSection: 'question'/);
  assert.match(source, /targetSection: 'wrong-book'/);
  assert.match(source, /targetSection: 'report'/);
  assert.doesNotMatch(source, /mock|fabricated|fake/i);
});

test('dashboard resolver keeps the approved priority order readable in source', () => {
  const source = readFileSync(cardPath, 'utf8');
  assert.match(source, /unfinishedTask/);
  assert.match(source, /pendingWrongCount/);
  assert.match(source, /weakPoint/);
  assert.match(source, /今日任务/);
  assert.match(source, /错题复盘/);
  assert.match(source, /薄弱点训练/);
  assert.match(source, /学习报告/);
});

test('dashboard resolver prioritizes an unfinished today task', async () => {
  const { buildDashboardNextLearningStep } = await loadResolvers();
  const step = buildDashboardNextLearningStep({
    todayPlan: planFixture([taskFixture({ title: '待完成任务' })]),
    wrongQuestionSummary: { pendingCount: 2 },
    report: { weakPoints: [{ title: '哈希表' }] },
  });
  assert.equal(step.contextLabel, '首页下一步');
  assert.equal(step.title, '下一步：完成今日任务');
  assert.match(step.reason, /待完成任务/);
  assert.deepEqual(step.primaryAction, { label: '去今日任务', targetSection: 'plan' });
  assert.deepEqual(step.secondaryAction, { label: '直接练题', targetSection: 'question' });
});

test('dashboard resolver prioritizes pending wrong questions after today tasks are done', async () => {
  const { buildDashboardNextLearningStep } = await loadResolvers();
  const step = buildDashboardNextLearningStep({
    todayPlan: null,
    wrongQuestionSummary: { pendingCount: 3 },
    report: { weakPoints: [{ title: '哈希表' }] },
  });
  assert.equal(step.title, '下一步：错题复盘');
  assert.match(step.reason, /3 道错题待复盘/);
  assert.deepEqual(step.primaryAction, { label: '去错题本', targetSection: 'wrong-book' });
  assert.deepEqual(step.secondaryAction, { label: '查看报告', targetSection: 'report' });
});

test('dashboard resolver suggests weak-point training when nothing else is pending', async () => {
  const { buildDashboardNextLearningStep } = await loadResolvers();
  const step = buildDashboardNextLearningStep({
    todayPlan: null,
    wrongQuestionSummary: { pendingCount: 0 },
    report: { weakPoints: [{ title: '哈希表' }] },
  });
  assert.equal(step.title, '下一步：薄弱点训练');
  assert.match(step.reason, /哈希表/);
  assert.deepEqual(step.primaryAction, { label: '去练习', targetSection: 'question' });
  assert.deepEqual(step.secondaryAction, { label: '查看报告', targetSection: 'report' });
});

test('dashboard resolver falls back to report review without pending pressure', async () => {
  const { buildDashboardNextLearningStep } = await loadResolvers();
  const step = buildDashboardNextLearningStep({
    todayPlan: null,
    wrongQuestionSummary: { pendingCount: 0 },
    report: { weakPoints: [] },
  });
  assert.equal(step.title, '下一步：学习报告');
  assert.deepEqual(step.primaryAction, { label: '查看报告', targetSection: 'report' });
  assert.deepEqual(step.secondaryAction, { label: '继续训练', targetSection: 'question' });
});

test('plan resolver starts or continues the first unfinished task', async () => {
  const { buildPlanNextLearningStep } = await loadResolvers();
  const pending = buildPlanNextLearningStep(planFixture([taskFixture({ status: 'pending' })]));
  assert.equal(pending.title, '下一步：开始最高优先级任务');
  assert.match(pending.reason, /数据结构 · 树 · 10 题/);
  assert.deepEqual(pending.primaryAction, { label: '去练题', targetSection: 'question' });
  assert.deepEqual(pending.secondaryAction, { label: '回首页', targetSection: 'dashboard' });

  const inProgress = buildPlanNextLearningStep(planFixture([taskFixture({ status: 'in_progress' })]));
  assert.equal(inProgress.title, '下一步：继续当前任务');
});

test('plan resolver routes completed tasks to review or report', async () => {
  const { buildPlanNextLearningStep } = await loadResolvers();
  const reviewDue = buildPlanNextLearningStep(planFixture(
    [taskFixture({ status: 'completed', completed: true })],
    { reviewDue: 4 },
  ));
  assert.equal(reviewDue.title, '下一步：处理到期复盘');
  assert.match(reviewDue.reason, /4 道到期复习/);
  assert.deepEqual(reviewDue.primaryAction, { label: '去错题本', targetSection: 'wrong-book' });

  const done = buildPlanNextLearningStep(planFixture([taskFixture({ status: 'completed', completed: true })]));
  assert.equal(done.title, '下一步：确认学习变化');
  assert.deepEqual(done.primaryAction, { label: '查看报告', targetSection: 'report' });
});

test('practice resolver sends wrong answers to review and right answers forward', async () => {
  const { buildPracticeNextLearningStep } = await loadResolvers();
  const wrong = buildPracticeNextLearningStep({ correct: false, hasNextQuestion: true, knowledgePointTitle: '红黑树' });
  assert.equal(wrong.title, '下一步：复盘本题错因');
  assert.match(wrong.reason, /红黑树/);
  assert.deepEqual(wrong.primaryAction, { label: '去错题本', targetSection: 'wrong-book' });
  assert.deepEqual(wrong.secondaryAction, { label: '继续下一题', targetSection: 'question' });

  const right = buildPracticeNextLearningStep({ correct: true, hasNextQuestion: true });
  assert.equal(right.title, '下一步：继续下一题');
  assert.deepEqual(right.primaryAction, { label: '继续训练', targetSection: 'question' });
  assert.deepEqual(right.secondaryAction, { label: '查看报告', targetSection: 'report' });
});

test('practice resolver keeps training after a finished practice set', async () => {
  const { buildPracticeNextLearningStep } = await loadResolvers();
  const step = buildPracticeNextLearningStep({ correct: null, hasNextQuestion: false, knowledgePointTitle: 'B+ 树' });
  assert.equal(step.title, '下一步：继续专项训练');
  assert.deepEqual(step.primaryAction, { label: '继续训练', targetSection: 'question' });
});

test('wrong-book resolver keeps reviewing pending items and then verifies gains', async () => {
  const { buildWrongBookNextLearningStep } = await loadResolvers();
  const pending = buildWrongBookNextLearningStep({ pendingCount: 6, filteredKnowledgePointTitle: 'Cache' });
  assert.equal(pending.title, '下一步：继续复盘');
  assert.match(pending.reason, /6 道错题待处理/);
  assert.match(pending.reason, /Cache/);
  assert.deepEqual(pending.primaryAction, { label: '继续复盘', targetSection: 'wrong-book' });

  const cleared = buildWrongBookNextLearningStep({ pendingCount: 0 });
  assert.equal(cleared.title, '下一步：验证复盘效果');
  assert.deepEqual(cleared.primaryAction, { label: '再练同考点', targetSection: 'question' });
  assert.deepEqual(cleared.secondaryAction, { label: '查看报告', targetSection: 'report' });
});

test('report resolver turns weak points into practice and otherwise returns to today tasks', async () => {
  const { buildReportNextLearningStep } = await loadResolvers();
  const weak = buildReportNextLearningStep({ weakPoints: [{ title: '进程调度' }] });
  assert.equal(weak.title, '下一步：把报告结论落到训练');
  assert.match(weak.reason, /进程调度/);
  assert.deepEqual(weak.primaryAction, { label: '去练薄弱点', targetSection: 'question' });
  assert.deepEqual(weak.secondaryAction, { label: '去错题本', targetSection: 'wrong-book' });

  const clear = buildReportNextLearningStep({ weakPoints: [] });
  assert.equal(clear.title, '下一步：回到今日任务');
  assert.deepEqual(clear.primaryAction, { label: '回首页', targetSection: 'dashboard' });
  assert.deepEqual(clear.secondaryAction, { label: '继续训练', targetSection: 'question' });
});

test('next learning step card is wired into all approved student loop surfaces', () => {
  const dashboard = readFileSync('apps/web/src/features/student/StudentLearningConsole.tsx', 'utf8');
  const plan = readFileSync('apps/web/src/components/TodayPlan.tsx', 'utf8');
  const practice = readFileSync('apps/web/src/features/practice/PracticePanel.tsx', 'utf8');
  const wrongBook = readFileSync('apps/web/src/features/mistakes/MistakeWorkspace.tsx', 'utf8');
  const report = readFileSync('apps/web/src/features/report/ReportSummaryPanel.tsx', 'utf8');

  assert.match(dashboard, /NextLearningStepCard/);
  assert.match(dashboard, /buildDashboardNextLearningStep/);
  assert.match(dashboard, /onNavigate=\{onNavigate\}/);

  assert.match(plan, /NextLearningStepCard/);
  assert.match(plan, /buildPlanNextLearningStep/);
  assert.match(plan, /onNavigate=\{onNavigate\}/);

  assert.match(practice, /NextLearningStepCard/);
  assert.match(practice, /buildPracticeNextLearningStep/);
  assert.match(practice, /onNavigate=\{onNavigate\}/);

  assert.match(wrongBook, /NextLearningStepCard/);
  assert.match(wrongBook, /buildWrongBookNextLearningStep/);
  assert.match(wrongBook, /onNavigate=\{onNavigate\}/);

  assert.match(report, /NextLearningStepCard/);
  assert.match(report, /buildReportNextLearningStep/);
  assert.match(report, /onNavigate=\{onNavigate\}/);
});

test('today plan accepts navigation so the next-step card can route to existing sections', () => {
  const app = readFileSync('apps/web/src/App.tsx', 'utf8');
  const plan = readFileSync('apps/web/src/components/TodayPlan.tsx', 'utf8');
  assert.match(plan, /onNavigate: \(section: RoleSection\) => void/);
  assert.match(app, /<TodayPlan[\s\S]*onNavigate=\{setActiveSection\}/);
});
