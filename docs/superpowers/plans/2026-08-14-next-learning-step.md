# Next Learning Step Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified front-end “next learning step” card that appears across the student learning loop and directs students to the next useful existing section.

**Architecture:** Add one small reusable presentational component plus a pure resolver helper in the student feature area. Wire it into the dashboard, today plan, practice feedback, wrong-book review, and report panels using existing props/data only; navigation still uses the existing `RoleSection` and `onNavigate` callbacks.

**Tech Stack:** React 18 + TypeScript 5.5 + Vite; Node built-in `node:test`; existing CSS in `apps/web/src/styles.css`; existing `RoleSection` section-based navigation.

## Global Constraints

- Before implementation, read `docs/PROJECT_CONTEXT.md`, `docs/ARCHITECTURE.md`, and `docs/superpowers/specs/2026-08-14-next-learning-step-design.md`.
- Perform the project-required lightweight open-source reference check before code changes.
- Use TDD: write RED tests before production behavior changes.
- Use only existing front-end data: `todayPlan`, `wrongQuestionSummary`, `report`, `masteryMap`, `practiceAnswerResult`, `practiceSetResult`, and current task context.
- Do not add database tables, migrations, backend endpoints, recommendation algorithms, AI recommendations, new pages, or new navigation structure.
- Do not add mock, fabricated, or fake learning data.
- Buttons must navigate only to existing student `RoleSection` values: `dashboard`, `plan`, `question`, `wrong-book`, `report`.
- Keep changes small and front-end-only.
- Do not run `git add .` or `git add -A`.
- Do not commit or push until the user explicitly authorizes it.

---

## File Structure

- Create `apps/web/src/features/student/NextLearningStepCard.tsx`
  - Owns the card UI.
  - Exports `NextLearningStepCard`, `NextLearningStep`, `NextLearningStepAction`, and resolver helpers.
- Modify `apps/web/src/features/student/StudentLearningConsole.tsx`
  - Renders the card on the student dashboard.
- Modify `apps/web/src/components/TodayPlan.tsx`
  - Renders the card near today plan progress.
- Modify `apps/web/src/features/practice/PracticePanel.tsx`
  - Renders the card after single-answer feedback and after practice-set results.
- Modify `apps/web/src/features/mistakes/MistakeWorkspace.tsx`
  - Renders the card near wrong-book summary and optionally inside filtered context.
- Modify `apps/web/src/features/report/ReportSummaryPanel.tsx`
  - Renders the card near report action recommendations.
- Modify `apps/web/src/styles.css`
  - Adds visual styling for `.next-learning-step-card`.
- Create `test/next-learning-step-ui.test.js`
  - Source-level UI contract tests following current project test style.

---

## Task 1: Add the reusable NextLearningStep card contract

**Files:**
- Create: `apps/web/src/features/student/NextLearningStepCard.tsx`
- Create: `test/next-learning-step-ui.test.js`
- Modify: `apps/web/src/styles.css`

**Interfaces:**
- Produces:

```ts
export interface NextLearningStepAction {
  label: string;
  targetSection: RoleSection;
}

export interface NextLearningStep {
  contextLabel: string;
  title: string;
  reason: string;
  primaryAction: NextLearningStepAction;
  secondaryAction: NextLearningStepAction;
}

export interface NextLearningStepCardProps {
  step: NextLearningStep;
  onNavigate: (section: RoleSection) => void;
  compact?: boolean;
}

export function NextLearningStepCard(props: NextLearningStepCardProps): JSX.Element;
```

- Later tasks consume `NextLearningStepCard` and the `NextLearningStep` type.

- [ ] **Step 1: Write the failing component contract test**

Add this test block to `test/next-learning-step-ui.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const cardPath = 'apps/web/src/features/student/NextLearningStepCard.tsx';

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
  assert.match(source, /onNavigate\\(step\\.primaryAction\\.targetSection\\)/);
  assert.match(source, /onNavigate\\(step\\.secondaryAction\\.targetSection\\)/);
});

test('next learning step card styling is visually distinct and responsive', () => {
  const styles = readFileSync('apps/web/src/styles.css', 'utf8');
  assert.match(styles, /\\.next-learning-step-card/);
  assert.match(styles, /\\.next-learning-step-actions/);
  assert.match(styles, /\\.next-learning-step-card\\.compact/);
  assert.match(styles, /@media \\(max-width: 720px\\)[\\s\\S]*next-learning-step-actions/);
});
```

- [ ] **Step 2: Run RED**

Run:

```powershell
npm test -- test/next-learning-step-ui.test.js
```

Expected: FAIL because `NextLearningStepCard.tsx` does not exist and styles are absent.

- [ ] **Step 3: Implement the minimal component**

Create `apps/web/src/features/student/NextLearningStepCard.tsx`:

```tsx
import type { RoleSection } from '../../layouts/RoleNavigation';

export interface NextLearningStepAction {
  label: string;
  targetSection: RoleSection;
}

export interface NextLearningStep {
  contextLabel: string;
  title: string;
  reason: string;
  primaryAction: NextLearningStepAction;
  secondaryAction: NextLearningStepAction;
}

export interface NextLearningStepCardProps {
  step: NextLearningStep;
  onNavigate: (section: RoleSection) => void;
  compact?: boolean;
}

export function NextLearningStepCard({ step, onNavigate, compact = false }: NextLearningStepCardProps) {
  return (
    <section className={`next-learning-step-card ${compact ? 'compact' : ''}`} aria-label={`${step.contextLabel}下一步`}>
      <div className="next-learning-step-copy">
        <p className="eyebrow">{step.contextLabel}</p>
        <h4>{step.title}</h4>
        <p><span>为什么推荐</span>{step.reason}</p>
      </div>
      <div className="next-learning-step-actions">
        <button type="button" className="primary-action" onClick={() => onNavigate(step.primaryAction.targetSection)}>
          {step.primaryAction.label}
        </button>
        <button type="button" className="secondary-action" onClick={() => onNavigate(step.secondaryAction.targetSection)}>
          {step.secondaryAction.label}
        </button>
      </div>
    </section>
  );
}
```

Add styles to `apps/web/src/styles.css` near the student learning console styles:

```css
.next-learning-step-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  padding: 14px;
  border: 1px solid #bbf7d0;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, #f0fdf4 0%, #f8fafc 70%);
}

.next-learning-step-card.compact {
  margin: 12px 0;
  padding: 12px;
}

.next-learning-step-copy {
  display: grid;
  gap: 6px;
  min-width: 0;
}

.next-learning-step-copy h4,
.next-learning-step-copy p {
  margin: 0;
}

.next-learning-step-copy p {
  color: var(--text-muted);
  line-height: 1.55;
}

.next-learning-step-copy p span {
  color: var(--green-strong);
  font-weight: 700;
  margin-right: 6px;
}

.next-learning-step-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

@media (max-width: 720px) {
  .next-learning-step-card {
    align-items: stretch;
    flex-direction: column;
  }

  .next-learning-step-actions {
    justify-content: stretch;
  }

  .next-learning-step-actions button {
    justify-content: center;
    width: 100%;
  }
}
```

- [ ] **Step 4: Run GREEN**

Run:

```powershell
npm test -- test/next-learning-step-ui.test.js
```

Expected: PASS for Task 1 tests.

- [ ] **Step 5: Review Task 1**

Check:

```powershell
git diff -- apps/web/src/features/student/NextLearningStepCard.tsx apps/web/src/styles.css test/next-learning-step-ui.test.js
```

Expected: only component, styles, and test changes.

---

## Task 2: Add pure next-step resolver helpers

**Files:**
- Modify: `apps/web/src/features/student/NextLearningStepCard.tsx`
- Modify: `test/next-learning-step-ui.test.js`

**Interfaces:**
- Consumes `NextLearningStep`.
- Produces:

```ts
export function buildDashboardNextLearningStep(input: {
  todayPlan: TodayPlanType | null;
  wrongQuestionSummary: WrongQuestionSummary | null;
  report: WeaknessReport | null;
}): NextLearningStep;

export function buildPlanNextLearningStep(plan: TodayPlanType): NextLearningStep;

export function buildPracticeNextLearningStep(input: {
  correct?: boolean | null;
  hasNextQuestion?: boolean;
  knowledgePointTitle?: string | null;
}): NextLearningStep;

export function buildWrongBookNextLearningStep(input: {
  pendingCount: number;
  filteredKnowledgePointTitle?: string | null;
}): NextLearningStep;

export function buildReportNextLearningStep(report: WeaknessReport): NextLearningStep;
```

- [ ] **Step 1: Write failing resolver tests**

Append to `test/next-learning-step-ui.test.js`:

```js
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
```

- [ ] **Step 2: Run RED**

Run:

```powershell
npm test -- test/next-learning-step-ui.test.js
```

Expected: FAIL because resolver functions are missing.

- [ ] **Step 3: Implement minimal resolver helpers**

Add imports and helpers to `NextLearningStepCard.tsx`:

```tsx
import type { WeaknessReport } from '@kaoyan408/shared';
import type { WrongQuestionSummary } from '../../api';
import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';
```

Add helper functions:

```tsx
function firstUnfinishedTask(plan: TodayPlanType | null) {
  return plan?.priorityTasks.find((task) => task.status !== 'completed' && !task.completed) ?? null;
}

function firstWeakPoint(report: WeaknessReport | null) {
  return report?.weakPoints[0]?.title ?? null;
}
```

Add resolver implementations:

```tsx
export function buildDashboardNextLearningStep({
  todayPlan,
  wrongQuestionSummary,
  report,
}: {
  todayPlan: TodayPlanType | null;
  wrongQuestionSummary: WrongQuestionSummary | null;
  report: WeaknessReport | null;
}): NextLearningStep {
  const unfinishedTask = firstUnfinishedTask(todayPlan);
  const pendingWrongCount = wrongQuestionSummary?.pendingCount ?? 0;
  const weakPoint = firstWeakPoint(report);

  if (unfinishedTask) {
    return {
      contextLabel: '首页下一步',
      title: '下一步：完成今日任务',
      reason: `当前还有未完成任务：${unfinishedTask.title}`,
      primaryAction: { label: '去今日任务', targetSection: 'plan' },
      secondaryAction: { label: '直接练题', targetSection: 'question' },
    };
  }
  if (pendingWrongCount > 0) {
    return {
      contextLabel: '首页下一步',
      title: '下一步：错题复盘',
      reason: `今日任务已处理，仍有 ${pendingWrongCount} 道错题待复盘`,
      primaryAction: { label: '去错题本', targetSection: 'wrong-book' },
      secondaryAction: { label: '查看报告', targetSection: 'report' },
    };
  }
  if (weakPoint) {
    return {
      contextLabel: '首页下一步',
      title: '下一步：薄弱点训练',
      reason: `当前报告显示优先巩固：${weakPoint}`,
      primaryAction: { label: '去练习', targetSection: 'question' },
      secondaryAction: { label: '查看报告', targetSection: 'report' },
    };
  }
  return {
    contextLabel: '首页下一步',
    title: '下一步：学习报告',
    reason: '当前没有明显待处理压力，可以查看报告确认下一轮方向',
    primaryAction: { label: '查看报告', targetSection: 'report' },
    secondaryAction: { label: '继续训练', targetSection: 'question' },
  };
}

export function buildPlanNextLearningStep(plan: TodayPlanType): NextLearningStep {
  const unfinishedTask = firstUnfinishedTask(plan);
  if (unfinishedTask) {
    return {
      contextLabel: '今日任务下一步',
      title: unfinishedTask.status === 'in_progress' ? '下一步：继续当前任务' : '下一步：开始最高优先级任务',
      reason: `${unfinishedTask.subject} · ${unfinishedTask.chapter} · ${unfinishedTask.questionCount} 题`,
      primaryAction: { label: '去练题', targetSection: 'question' },
      secondaryAction: { label: '回首页', targetSection: 'dashboard' },
    };
  }
  if (plan.reviewDue > 0) {
    return {
      contextLabel: '今日任务下一步',
      title: '下一步：处理到期复盘',
      reason: `今日任务已完成，还有 ${plan.reviewDue} 道到期复习`,
      primaryAction: { label: '去错题本', targetSection: 'wrong-book' },
      secondaryAction: { label: '查看报告', targetSection: 'report' },
    };
  }
  return {
    contextLabel: '今日任务下一步',
    title: '下一步：确认学习变化',
    reason: '今日任务已完成，建议查看报告确认掌握度变化',
    primaryAction: { label: '查看报告', targetSection: 'report' },
    secondaryAction: { label: '继续训练', targetSection: 'question' },
  };
}

export function buildPracticeNextLearningStep({
  correct,
  hasNextQuestion = false,
  knowledgePointTitle = null,
}: {
  correct?: boolean | null;
  hasNextQuestion?: boolean;
  knowledgePointTitle?: string | null;
}): NextLearningStep {
  if (correct === false) {
    return {
      contextLabel: '训练结果下一步',
      title: '下一步：复盘本题错因',
      reason: `本题暴露了${knowledgePointTitle ? `「${knowledgePointTitle}」` : '当前考点'}的薄弱处`,
      primaryAction: { label: '去错题本', targetSection: 'wrong-book' },
      secondaryAction: { label: hasNextQuestion ? '继续下一题' : '继续训练', targetSection: 'question' },
    };
  }
  return {
    contextLabel: '训练结果下一步',
    title: hasNextQuestion ? '下一步：继续下一题' : '下一步：继续专项训练',
    reason: correct === true ? '本题已形成正向练习记录，继续同节奏巩固' : '完成本组训练后继续推进薄弱点',
    primaryAction: { label: '继续训练', targetSection: 'question' },
    secondaryAction: { label: '查看报告', targetSection: 'report' },
  };
}

export function buildWrongBookNextLearningStep({
  pendingCount,
  filteredKnowledgePointTitle = null,
}: {
  pendingCount: number;
  filteredKnowledgePointTitle?: string | null;
}): NextLearningStep {
  if (pendingCount > 0) {
    return {
      contextLabel: '错题本下一步',
      title: '下一步：继续复盘',
      reason: `仍有 ${pendingCount} 道错题待处理${filteredKnowledgePointTitle ? `，当前聚焦 ${filteredKnowledgePointTitle}` : ''}`,
      primaryAction: { label: '继续复盘', targetSection: 'wrong-book' },
      secondaryAction: { label: '再练同考点', targetSection: 'question' },
    };
  }
  return {
    contextLabel: '错题本下一步',
    title: '下一步：验证复盘效果',
    reason: '当前待复盘压力降低，可以通过训练或报告确认掌握变化',
    primaryAction: { label: '再练同考点', targetSection: 'question' },
    secondaryAction: { label: '查看报告', targetSection: 'report' },
  };
}

export function buildReportNextLearningStep(report: WeaknessReport): NextLearningStep {
  const weakPoint = firstWeakPoint(report);
  if (weakPoint) {
    return {
      contextLabel: '报告下一步',
      title: '下一步：把报告结论落到训练',
      reason: `当前最优先补强：${weakPoint}`,
      primaryAction: { label: '去练薄弱点', targetSection: 'question' },
      secondaryAction: { label: '去错题本', targetSection: 'wrong-book' },
    };
  }
  return {
    contextLabel: '报告下一步',
    title: '下一步：回到今日任务',
    reason: '暂未形成明确薄弱点，先继续积累今日任务和训练记录',
    primaryAction: { label: '回首页', targetSection: 'dashboard' },
    secondaryAction: { label: '继续训练', targetSection: 'question' },
  };
}
```

- [ ] **Step 4: Run GREEN**

Run:

```powershell
npm test -- test/next-learning-step-ui.test.js
```

Expected: PASS.

- [ ] **Step 5: Type-check by building web**

Run:

```powershell
npm run build:web
```

Expected: PASS. Existing Vite chunk warnings may remain.

---

## Task 3: Wire the card into dashboard, today plan, practice, wrong-book, and report

**Files:**
- Modify: `apps/web/src/features/student/StudentLearningConsole.tsx`
- Modify: `apps/web/src/components/TodayPlan.tsx`
- Modify: `apps/web/src/features/practice/PracticePanel.tsx`
- Modify: `apps/web/src/features/mistakes/MistakeWorkspace.tsx`
- Modify: `apps/web/src/features/report/ReportSummaryPanel.tsx`
- Modify: `test/next-learning-step-ui.test.js`

**Interfaces:**
- Consumes:
  - `NextLearningStepCard`
  - `buildDashboardNextLearningStep`
  - `buildPlanNextLearningStep`
  - `buildPracticeNextLearningStep`
  - `buildWrongBookNextLearningStep`
  - `buildReportNextLearningStep`
- Existing navigation callbacks:
  - `onNavigate: (section: RoleSection) => void`

- [ ] **Step 1: Write failing wiring tests**

Append to `test/next-learning-step-ui.test.js`:

```js
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
```

- [ ] **Step 2: Run RED**

Run:

```powershell
npm test -- test/next-learning-step-ui.test.js
```

Expected: FAIL because wiring is not present and `TodayPlan` does not yet accept `onNavigate`.

- [ ] **Step 3: Wire dashboard**

Modify `StudentLearningConsole.tsx` imports:

```tsx
import { buildDashboardNextLearningStep, NextLearningStepCard } from './NextLearningStepCard';
```

Inside `StudentLearningConsole`, after `completedSummary` or after `GoalProgressInsight`, compute:

```tsx
const nextLearningStep = buildDashboardNextLearningStep({
  todayPlan,
  wrongQuestionSummary,
  report,
});
```

Render:

```tsx
<NextLearningStepCard step={nextLearningStep} onNavigate={onNavigate} />
```

- [ ] **Step 4: Wire today plan**

Modify `TodayPlan.tsx` imports:

```tsx
import type { RoleSection } from '../layouts/RoleNavigation';
import { buildPlanNextLearningStep, NextLearningStepCard } from '../features/student/NextLearningStepCard';
```

Extend `Props`:

```ts
onNavigate: (section: RoleSection) => void;
```

Update function parameters:

```tsx
export function TodayPlan({ plan, student = null, focusTaskId, onRefresh, onNavigate, onOpenReview }: Props) {
```

Compute after `progressPercent`:

```tsx
const nextLearningStep = buildPlanNextLearningStep(plan);
```

Render near the existing `GoalProgressInsight`:

```tsx
<NextLearningStepCard step={nextLearningStep} onNavigate={onNavigate} compact />
```

Modify `App.tsx` where `<TodayPlan` is rendered:

```tsx
onNavigate={setActiveSection}
```

- [ ] **Step 5: Wire practice**

Modify `PracticePanel.tsx` imports:

```tsx
import { buildPracticeNextLearningStep, NextLearningStepCard } from '../student/NextLearningStepCard';
```

Inside the `answerResult` branch, compute inline:

```tsx
const answerNextLearningStep = buildPracticeNextLearningStep({
  correct: answerResult.correct,
  hasNextQuestion,
  knowledgePointTitle: answerResult.knowledgePointTitle ?? targetWeakPointTitle,
});
```

Because the component body cannot declare `const` inside JSX, place this above `return`:

```tsx
const answerNextLearningStep = answerResult
  ? buildPracticeNextLearningStep({
      correct: answerResult.correct,
      hasNextQuestion,
      knowledgePointTitle: answerResult.knowledgePointTitle ?? targetWeakPointTitle,
    })
  : null;
const setNextLearningStep = practiceSetResult
  ? buildPracticeNextLearningStep({
      correct: practiceSetResult.accuracyRate >= 70,
      hasNextQuestion: false,
      knowledgePointTitle: set?.focus ?? targetWeakPointTitle,
    })
  : null;
```

Render after existing `GoalProgressInsight` in the answer result:

```tsx
{answerNextLearningStep && onNavigate ? (
  <NextLearningStepCard step={answerNextLearningStep} onNavigate={onNavigate} compact />
) : null}
```

Render after existing `GoalProgressInsight` in the practice-set result:

```tsx
{setNextLearningStep && onNavigate ? (
  <NextLearningStepCard step={setNextLearningStep} onNavigate={onNavigate} compact />
) : null}
```

- [ ] **Step 6: Wire wrong-book**

Modify `MistakeWorkspace.tsx` imports:

```tsx
import { buildWrongBookNextLearningStep, NextLearningStepCard } from '../student/NextLearningStepCard';
```

After `displayQuestions` is computed, derive the selected knowledge point label:

```tsx
const selectedKnowledgePointTitle = knowledgePointId
  ? knowledgePointOptions.find(([value]) => value === knowledgePointId)?.[1] ?? knowledgePointId
  : null;
const wrongBookNextLearningStep = buildWrongBookNextLearningStep({
  pendingCount: summaryData?.pendingCount ?? wrongQuestions.length,
  filteredKnowledgePointTitle: selectedKnowledgePointTitle,
});
```

Render after `RecommendationEvidence` in the summary block:

```tsx
<NextLearningStepCard step={wrongBookNextLearningStep} onNavigate={onNavigate} />
```

- [ ] **Step 7: Wire report**

Modify `ReportSummaryPanel.tsx` imports:

```tsx
import { buildReportNextLearningStep, NextLearningStepCard } from '../student/NextLearningStepCard';
```

Inside `ReportSummaryPanel`, compute:

```tsx
const reportNextLearningStep = buildReportNextLearningStep(report);
```

Render near the existing `GoalProgressInsight`:

```tsx
<NextLearningStepCard step={reportNextLearningStep} onNavigate={onNavigate} />
```

- [ ] **Step 8: Run GREEN**

Run:

```powershell
npm test -- test/next-learning-step-ui.test.js
```

Expected: PASS.

- [ ] **Step 9: Run focused regressions**

Run:

```powershell
npm test -- test/next-learning-step-ui.test.js test/student-learning-console-ui.test.js test/today-plan-ui.test.js test/practice-set-action-ui.test.js test/wrong-question-filter.test.js test/wrong-review-metrics.test.js test/mastery-report.test.js
```

Expected: PASS.

---

## Task 4: Final verification and handoff

**Files:**
- No new production files beyond Tasks 1-3.
- Review all files touched by Tasks 1-3.

**Interfaces:**
- Consumes all completed implementation.
- Produces final evidence for user approval to commit/push.

- [ ] **Step 1: Run web build**

Run:

```powershell
npm run build:web
```

Expected: PASS. Existing Vite chunk warnings may remain.

- [ ] **Step 2: Run full repository test**

Run:

```powershell
npm test
```

Expected: PASS with 0 failures and the existing PDF skip allowed.

- [ ] **Step 3: Review diff scope**

Run:

```powershell
git diff --stat
git diff -- apps/web/src/features/student/NextLearningStepCard.tsx apps/web/src/features/student/StudentLearningConsole.tsx apps/web/src/components/TodayPlan.tsx apps/web/src/App.tsx apps/web/src/features/practice/PracticePanel.tsx apps/web/src/features/mistakes/MistakeWorkspace.tsx apps/web/src/features/report/ReportSummaryPanel.tsx apps/web/src/styles.css test/next-learning-step-ui.test.js
git status --short
```

Expected:

- Only next-step related files are modified or added.
- Existing untracked browser/log artifacts remain untracked and unstaged.
- No backend, Prisma, migration, API route, or mock files changed.

- [ ] **Step 4: Final report**

Report:

```text
IMPLEMENTATION
- Added NextLearningStepCard
- Added pure resolver helpers
- Wired dashboard / today plan / practice / wrong-book / report

VALIDATION
- focused:
- regressions:
- build:web:
- npm test:

GIT
- branch:
- status:
- commit: not created unless approved
- push: not performed unless approved
```

- [ ] **Step 5: Commit only after explicit approval**

If the user says `提交并推送 学习路径下一步入口统一强化`, run only explicit staging:

```powershell
git add apps/web/src/features/student/NextLearningStepCard.tsx
git add apps/web/src/features/student/StudentLearningConsole.tsx
git add apps/web/src/components/TodayPlan.tsx
git add apps/web/src/App.tsx
git add apps/web/src/features/practice/PracticePanel.tsx
git add apps/web/src/features/mistakes/MistakeWorkspace.tsx
git add apps/web/src/features/report/ReportSummaryPanel.tsx
git add apps/web/src/styles.css
git add test/next-learning-step-ui.test.js
git commit -m "feat(web): unify student next learning steps"
git push origin codex/deployment-ready
```

Do not stage screenshots, logs, `var/`, or unrelated untracked files.

