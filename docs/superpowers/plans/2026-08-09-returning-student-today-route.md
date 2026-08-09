# Returning Student Today Route Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the returning-student dashboard’s competing first-screen actions with an ordered “今日学习路线” that launches the highest-priority actionable task into the correct knowledge-point practice or review flow in one click.

**Architecture:** Keep the server-generated `TodayPlan` as the recommendation source of truth. Add a pure frontend policy module for ordering, current-task selection, destination mapping, action copy, and content preflight; keep `TodayLearningRoute` presentational; let `App.tsx` perform the existing start API call and short-lived navigation context only after preflight succeeds. Reuse the existing question bank and wrong-question filters without adding endpoints, persistence, routing libraries, or production mock behavior.

**Tech Stack:** React, TypeScript, Vite, existing CSS system, npm workspaces, `node:test`, `typescript.transpileModule`, existing hash-based `RoleSection` navigation.

## Global Constraints

- The approved design is `docs/superpowers/specs/2026-08-09-returning-student-today-route-design.md`; implementation must remain consistent with it.
- Do not modify Question Annotation, Retrieval V2, retrieval/search, Prisma, migrations, API routes, response contracts, scoring, mastery, recommendation, or plan-generation algorithms.
- Treat `TodayPlan.priorityTasks` as the only source for route order and current-task selection. Do not merge or reorder from Today Score Center.
- This is frontend orchestration only. Data remains sourced from the existing today-plan, question, and wrong-question resources; production must never silently fall back to mock data.
- A known task may call `startTask` only after the relevant knowledge point has local launchable content. Missing content must show an explicit error and must not start or navigate.
- An unknown `mode` must not call `startTask`; focus the task in the existing plan page instead.
- Preserve the existing dedicated plan editor, question submission behavior, wrong-question server filtering, mobile bottom navigation, and onboarding path.
- Follow TDD for every behavior change: add a focused failing test, run it and capture the expected failure, add the smallest implementation, then rerun to green.
- The repository is already an isolated Codex worktree and currently has a detached HEAD. Do not create/switch a branch, stage, commit, push, or alter worktrees unless the user explicitly authorizes that Git write.
- Do not use the approved bitmap mockup as a runtime asset. It is visual direction only.
- Before claiming completion, run the full repository verification chain and inspect the final diff for forbidden files.

---

## Open-Source Reference Direction

Before implementation, reopen and record the useful patterns from these primary sources. Do not copy their source code or introduce their packages.

- [GOV.UK Design System — Task list](https://design-system.service.gov.uk/components/task-list/): concise task names and hints, non-button-like status labels, clear actionable rows, and updated status after returning from a task.
- [U.S. Web Design System — Process list](https://designsystem.digital.gov/components/process-list/): semantic ordered sequence, consistent headings, visible progression, and a compact 3–10 step hierarchy.
- [WAI-ARIA 1.2 — `status` role](https://www.w3.org/TR/wai-aria-1.2/#status) and [WCAG ARIA19](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA19): advisory asynchronous feedback should use a polite, atomic live status; reserve alerts for urgent interruption.

How these references influence this implementation:

- Render the learning route as an ordered list and keep statuses visually distinct from actions.
- Expand only the current actionable task; keep later tasks concise.
- Keep exactly one high-emphasis action in the route.
- Announce launch errors/status updates without stealing focus.
- Reimplement these ideas using the repository’s existing React/CSS architecture.

---

## File Map

### Create

- `apps/web/src/features/onboarding/todayLearningRoute.ts` — pure ordering, selection, mode mapping, action-label, and launch-preflight policy.
- `apps/web/src/features/onboarding/TodayLearningRoute.tsx` — presentational ordered route and its loading/error/complete/waiting states.
- `test/today-learning-route.test.js` — executable pure-policy tests.
- `test/today-learning-route-ui.test.js` — source-contract tests for route UI and App wiring.

### Modify

- `apps/web/src/features/onboarding/StudentLaunchpad.tsx` — put the route first and remove the competing hero/KPI/quick-action first screen while retaining lower dashboard evidence.
- `apps/web/src/features/student/StudentSections.tsx` — pass route callbacks/status and wrong-book initial knowledge-point context through the student shell.
- `apps/web/src/features/mistakes/MistakeWorkspace.tsx` — accept and synchronize an optional initial knowledge-point filter.
- `apps/web/src/App.tsx` — preflight/start/navigate orchestration and temporary scoped question/review context.
- `apps/web/src/styles.css` — route timeline, states, responsive layout, focus, and reduced-motion styling.
- `test/p2-info-architecture.test.js` — preserve dashboard-summary-versus-plan-editor separation with the new route.
- `test/p2-kpi-consistency.test.js` — stop requiring the removed dashboard estimated-gain KPI while retaining report KPI consistency.
- `test/stage3-practice-metadata.test.js` — replace obsolete launchpad hero assumptions with scoped-practice metadata assertions.
- `test/today-plan-ui.test.js` — preserve plan editing and focus behavior while recognizing the dashboard route summary.
- `test/ux-redesign-ui.test.js` — replace old hero/quick-action tokens with the approved route hierarchy.
- `test/web-desktop-actions.test.js` — assert the route’s single primary task action and retained lower-page actions.
- `test/wrong-question-filter.test.js` — cover initial knowledge-point synchronization without changing production mock rules.

### Explicitly Out of Scope

- Any file whose purpose/name contains Question Annotation, Retrieval V2, retrieval, semantic search, embedding, reranking, or question annotation.
- `prisma/**`, `apps/api/**`, migrations, shared recommendation/scoring algorithms, and API endpoint contracts.

---

## Task 1: Pre-Coding Reference and Baseline Gate

**Files:**

- Read: `docs/development/open-source-reference-check.md`
- Read: `docs/development/pre-coding-checklist.md`
- Read: the three primary references above
- Read: every file in the File Map before editing it
- No source-file changes

**Produces:** A recorded reference summary, clean baseline evidence, and a confirmed allowed-file boundary.

- [ ] **Step 1: Reopen the reference sources and record the adopted patterns**

Record in the active implementation notes/commentary:

```text
GOV.UK: concise task/hint/status separation; one actionable row.
USWDS: semantic ordered process; consistent hierarchy and compact steps.
WAI-ARIA/WCAG: role=status for polite atomic launch feedback; no focus theft.
Decision: reimplement locally; no copied code, package, CSS, or markup.
```

- [ ] **Step 2: Confirm Git and scope baseline**

Run:

```powershell
git status --short --branch
git diff --name-only
rg -n "Question Annotation|Retrieval V2|retrieval|rerank|embedding" apps/web/src test
```

Expected: detached HEAD is acceptable; only the already approved design/plan docs may be untracked before coding; record any pre-existing user changes and do not overwrite them.

- [ ] **Step 3: Run the affected baseline tests**

Run:

```powershell
node --test test/p2-info-architecture.test.js test/p2-kpi-consistency.test.js test/stage3-practice-metadata.test.js test/today-plan-ui.test.js test/ux-redesign-ui.test.js test/web-desktop-actions.test.js test/wrong-question-filter.test.js
```

Expected: PASS before the new tests exist. If any baseline test fails, stop and diagnose it with `superpowers:systematic-debugging`; do not hide the baseline failure by weakening assertions.

- [ ] **Step 4: Read the actual interfaces and freeze the implementation boundary**

Confirm these existing facts in code:

```text
TodayPlan task fields: id, knowledgePointId, mode, priority, status,
nextAvailableAt, completed, progress.
startTask(taskId) is POST /tasks/:id/start.
StudentLaunchpad is dashboard-only; TodayPlan owns plan editing.
MistakeWorkspace already owns knowledgePointId filter and server fetch.
App owns practiceIndex/currentQuestion and hash-section navigation.
```

Do not proceed if a fact differs; update this plan/spec first and seek approval if the UX or scope would materially change.

---

## Task 2: Build the Pure Today-Route Policy with TDD

**Files:**

- Create: `test/today-learning-route.test.js`
- Create: `apps/web/src/features/onboarding/todayLearningRoute.ts`

**Interfaces:**

```ts
export type TodayPlanTask = TodayPlan['priorityTasks'][number];
export type TodayTaskDestination = 'question' | 'wrong-book' | 'plan';

export interface TodayRouteState {
  orderedTasks: TodayPlanTask[];
  currentTask: TodayPlanTask | null;
  nextAvailableAt: string | null;
  allCompleted: boolean;
}

export interface TodayTaskLaunchContext {
  taskId: string;
  knowledgePointId: string;
  destination: Exclude<TodayTaskDestination, 'plan'>;
}

export type TodayTaskPreflight =
  | { kind: 'ready'; context: TodayTaskLaunchContext }
  | { kind: 'navigate-plan'; taskId: string }
  | { kind: 'error'; message: string };
```

- [ ] **Step 1: Write a transpile-and-import helper and failing route-selection tests**

Create `test/today-learning-route.test.js` with the repository’s existing TypeScript test pattern:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ts from 'typescript';

async function loadPolicy() {
  const url = new URL('../apps/web/src/features/onboarding/todayLearningRoute.ts', import.meta.url);
  const source = await fs.readFile(url, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`);
}

const task = (overrides = {}) => ({
  id: 'task-1', knowledgePointId: 'kp-1', subject: '数据结构', chapter: '树',
  title: '二叉树专项', minutes: 20, questionCount: 10, mode: '专项训练',
  priority: '中', reason: '近期错误较多', nextAction: '完成专项训练',
  scheduledDate: '2026-08-09', status: 'pending', postponeCount: 0,
  ...overrides,
});

test('selects the highest-priority actionable unfinished task stably', async () => {
  const { resolveTodayRoute } = await loadPolicy();
  const result = resolveTodayRoute([
    task({ id: 'medium-first' }),
    task({ id: 'high-first', priority: '高' }),
    task({ id: 'high-second', priority: '高' }),
    task({ id: 'done', priority: '高', status: 'completed', completed: true }),
  ], Date.parse('2026-08-09T10:00:00+08:00'));
  assert.equal(result.currentTask.id, 'high-first');
  assert.deepEqual(result.orderedTasks.map((item) => item.id), [
    'high-first', 'high-second', 'done', 'medium-first',
  ]);
  assert.equal(result.allCompleted, false);
});

test('waits for the earliest future postponed task', async () => {
  const { resolveTodayRoute } = await loadPolicy();
  const result = resolveTodayRoute([
    task({ id: 'later', status: 'postponed', nextAvailableAt: '2026-08-10T10:00:00+08:00' }),
    task({ id: 'sooner', status: 'postponed', nextAvailableAt: '2026-08-09T15:00:00+08:00' }),
  ], Date.parse('2026-08-09T10:00:00+08:00'));
  assert.equal(result.currentTask, null);
  assert.equal(result.nextAvailableAt, '2026-08-09T15:00:00+08:00');
  assert.equal(result.allCompleted, false);
});
```

Add cases for due postponed tasks becoming actionable, an empty/all-completed list, and `in_progress` action copy.

- [ ] **Step 2: Run the new policy tests and verify RED**

Run:

```powershell
node --test test/today-learning-route.test.js
```

Expected: FAIL with module-not-found because `todayLearningRoute.ts` does not exist.

- [ ] **Step 3: Implement deterministic ordering and state selection**

Create `apps/web/src/features/onboarding/todayLearningRoute.ts`:

```ts
import type { TodayPlan } from '../../api/endpoints/onboarding';

export type TodayPlanTask = TodayPlan['priorityTasks'][number];
export type TodayTaskDestination = 'question' | 'wrong-book' | 'plan';

export interface TodayRouteState {
  orderedTasks: TodayPlanTask[];
  currentTask: TodayPlanTask | null;
  nextAvailableAt: string | null;
  allCompleted: boolean;
}

export interface TodayTaskLaunchContext {
  taskId: string;
  knowledgePointId: string;
  destination: Exclude<TodayTaskDestination, 'plan'>;
}

interface LaunchableQuestion { id: string; knowledgePointIds: string[] }
interface LaunchableWrongQuestion { questionId: string; knowledgePointId: string }

export type TodayTaskPreflight =
  | { kind: 'ready'; context: TodayTaskLaunchContext }
  | { kind: 'navigate-plan'; taskId: string }
  | { kind: 'error'; message: string };

const PRIORITY_WEIGHT = { 高: 0, 中: 1, 低: 2 } as const;
const QUESTION_MODES = new Set(['基础例题', '专项训练', '阶段巩固']);
const REVIEW_MODES = new Set(['诊断复盘', '考后复盘']);

function isCompleted(task: TodayPlanTask) {
  return task.status === 'completed' || task.completed === true;
}

function isActionable(task: TodayPlanTask, nowMs: number) {
  if (isCompleted(task)) return false;
  if (task.status === 'pending' || task.status === 'in_progress') return true;
  if (task.status !== 'postponed' || !task.nextAvailableAt) return task.status === 'postponed';
  const availableAt = Date.parse(task.nextAvailableAt);
  return Number.isFinite(availableAt) && availableAt <= nowMs;
}

export function resolveTodayRoute(tasks: TodayPlanTask[], nowMs = Date.now()): TodayRouteState {
  const orderedTasks = tasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) =>
      PRIORITY_WEIGHT[left.task.priority] - PRIORITY_WEIGHT[right.task.priority]
      || left.index - right.index)
    .map(({ task }) => task);
  const currentTask = orderedTasks.find((task) => isActionable(task, nowMs)) ?? null;
  const futureTimes = orderedTasks
    .filter((task) => !isCompleted(task) && task.status === 'postponed' && task.nextAvailableAt)
    .map((task) => task.nextAvailableAt as string)
    .filter((value) => Number.isFinite(Date.parse(value)) && Date.parse(value) > nowMs)
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  return {
    orderedTasks,
    currentTask,
    nextAvailableAt: currentTask ? null : futureTimes[0] ?? null,
    allCompleted: orderedTasks.every(isCompleted),
  };
}
```

- [ ] **Step 4: Add failing destination, label, and preflight tests**

Append tests that lock the exact whitelist and safe behavior:

```js
test('maps only known modes and safely falls back to plan', async () => {
  const { resolveTodayTaskDestination } = await loadPolicy();
  assert.equal(resolveTodayTaskDestination('基础例题'), 'question');
  assert.equal(resolveTodayTaskDestination('专项训练'), 'question');
  assert.equal(resolveTodayTaskDestination('阶段巩固'), 'question');
  assert.equal(resolveTodayTaskDestination('诊断复盘'), 'wrong-book');
  assert.equal(resolveTodayTaskDestination('考后复盘'), 'wrong-book');
  assert.equal(resolveTodayTaskDestination('新服务端模式'), 'plan');
});

test('preflight rejects missing content before a task can start', async () => {
  const { preflightTodayTaskLaunch } = await loadPolicy();
  assert.deepEqual(preflightTodayTaskLaunch(task(), [], []), {
    kind: 'error', message: '该知识点暂无可用题目，请先调整今日计划。',
  });
  assert.deepEqual(preflightTodayTaskLaunch(task({ mode: '诊断复盘' }), [], []), {
    kind: 'error', message: '该知识点暂无待复盘错题，请先调整今日计划。',
  });
  assert.deepEqual(preflightTodayTaskLaunch(task({ mode: '未知' }), [], []), {
    kind: 'navigate-plan', taskId: 'task-1',
  });
});
```

Run and verify the new assertions fail because the functions are not exported yet.

- [ ] **Step 5: Implement exact mode mapping, action copy, and preflight**

Add to the policy module:

```ts
export function resolveTodayTaskDestination(mode: string): TodayTaskDestination {
  if (QUESTION_MODES.has(mode)) return 'question';
  if (REVIEW_MODES.has(mode)) return 'wrong-book';
  return 'plan';
}

export function getTodayTaskActionLabel(task: TodayPlanTask, destination: TodayTaskDestination) {
  if (destination === 'plan') return '查看任务';
  const verb = task.status === 'in_progress' ? '继续' : '开始';
  return `${verb}${destination === 'question' ? '练习' : '复盘'}`;
}

export function preflightTodayTaskLaunch(
  task: TodayPlanTask,
  questions: LaunchableQuestion[],
  wrongQuestions: LaunchableWrongQuestion[],
): TodayTaskPreflight {
  const destination = resolveTodayTaskDestination(task.mode);
  if (destination === 'plan') return { kind: 'navigate-plan', taskId: task.id };
  const hasContent = destination === 'question'
    ? questions.some((question) => question.knowledgePointIds.includes(task.knowledgePointId))
    : wrongQuestions.some((question) => question.knowledgePointId === task.knowledgePointId);
  if (!hasContent) {
    return {
      kind: 'error',
      message: destination === 'question'
        ? '该知识点暂无可用题目，请先调整今日计划。'
        : '该知识点暂无待复盘错题，请先调整今日计划。',
    };
  }
  return {
    kind: 'ready',
    context: { taskId: task.id, knowledgePointId: task.knowledgePointId, destination },
  };
}
```

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```powershell
node --test test/today-learning-route.test.js
```

Expected: all policy cases pass. Do not proceed until priority stability, due/future postponement, completion, exact mode mapping, labels, missing-content errors, and unknown-mode fallback are green.

---

## Task 3: Build the Presentational Route Component with TDD

**Files:**

- Create: `test/today-learning-route-ui.test.js`
- Create: `apps/web/src/features/onboarding/TodayLearningRoute.tsx`

**Interface:**

```ts
interface TodayLearningRouteProps {
  plan: TodayPlan | null;
  loading: boolean;
  error: string;
  launchingTaskId: string | null;
  launchError: string;
  onRetry: () => void;
  onLaunch: (task: TodayPlanTask) => void;
  onOpenPlan: () => void;
  onOpenWrongBook: () => void;
  onOpenReport: () => void;
}
```

- [ ] **Step 1: Write failing component source-contract tests**

Create `test/today-learning-route-ui.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const source = (path) => fs.readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('today route is an ordered presentational workflow with one task primary action', async () => {
  const ui = await source('apps/web/src/features/onboarding/TodayLearningRoute.tsx');
  assert.match(ui, /<ol[^>]*className="today-route-list"/);
  assert.match(ui, /resolveTodayRoute\(/);
  assert.match(ui, /getTodayTaskActionLabel\(/);
  assert.match(ui, /className="today-route-primary"/);
  assert.equal((ui.match(/today-route-primary/g) ?? []).length, 1);
  assert.match(ui, /role="status"/);
  assert.doesNotMatch(ui, /startTask|fetchTodayPlan|setActiveSection/);
});

test('today route renders loading, fetch error, complete, and postponed-only states', async () => {
  const ui = await source('apps/web/src/features/onboarding/TodayLearningRoute.tsx');
  for (const token of [
    'today-route-skeleton', '重新加载', '今日任务已完成', '下一项任务可开始时间',
  ]) assert.match(ui, new RegExp(token));
});
```

- [ ] **Step 2: Run the UI test and verify RED**

Run:

```powershell
node --test test/today-learning-route-ui.test.js
```

Expected: FAIL because `TodayLearningRoute.tsx` does not exist.

- [ ] **Step 3: Implement the component state shell**

Create the component with this branching order:

```tsx
export function TodayLearningRoute(props: TodayLearningRouteProps) {
  if (props.loading) {
    return <section className="panel today-route" aria-label="今日学习路线"><div className="today-route-skeleton" role="status">正在加载今日学习路线…</div></section>;
  }
  if (props.error) {
    return <section className="panel today-route" aria-label="今日学习路线"><p role="status">{props.error}</p><button type="button" className="text-button" onClick={props.onRetry}>重新加载</button></section>;
  }
  if (!props.plan) {
    return <section className="panel today-route" aria-label="今日学习路线"><p>完成入学引导和诊断后生成今日路线。</p></section>;
  }

  const route = resolveTodayRoute(props.plan.priorityTasks);
  const totalMinutes = props.plan.priorityTasks.reduce((sum, task) => sum + task.minutes, 0);
  const completedMinutes = props.plan.priorityTasks.reduce(
    (sum, task) => sum + ((task.status === 'completed' || task.completed) ? task.minutes : task.progress?.minutesSpent ?? 0),
    0,
  );
  return <section className="panel today-route" aria-labelledby="today-route-title">
    <header className="today-route-header">
      <div>
        <span className="eyebrow">今天先完成最重要的一件事</span>
        <h2 id="today-route-title">今日学习路线</h2>
      </div>
      <div className="today-route-summary">预计 {totalMinutes} 分钟 · 已完成 {completedMinutes} 分钟</div>
      <button type="button" className="text-button" onClick={props.onOpenPlan}>调整计划</button>
    </header>

    <div className="today-route-live" role="status" aria-live="polite" aria-atomic="true">
      {props.launchError}
    </div>

    {route.allCompleted && <div className="today-route-terminal">
      <strong>今日任务已完成</strong>
      <p>今天的核心路线已经走完，可以查看报告或复习错题。</p>
      <div className="today-route-secondary-actions">
        <button type="button" className="text-button" onClick={props.onOpenReport}>查看报告</button>
        <button type="button" className="text-button" onClick={props.onOpenWrongBook}>复习错题</button>
      </div>
    </div>}

    {!route.allCompleted && !route.currentTask && route.nextAvailableAt && <div className="today-route-terminal">
      <strong>当前任务正在等待</strong>
      <p>下一项任务可开始时间：{new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }).format(new Date(route.nextAvailableAt))}</p>
    </div>}

    <ol className="today-route-list">
      {route.orderedTasks.map((task) => {
        const isCurrent = task.id === route.currentTask?.id;
        const destination = resolveTodayTaskDestination(task.mode);
        const completed = task.status === 'completed' || task.completed;
        const statusText = completed ? '已完成' : task.status === 'in_progress' ? '进行中' : task.status === 'postponed' ? '已延后' : '待开始';
        return <li key={task.id} className={isCurrent ? 'today-route-item is-current' : 'today-route-item'}>
          <span className="today-route-index" aria-hidden="true" />
          <div className="today-route-content">
            <div className="today-route-task-heading">
              <h3>{task.title}</h3>
              <span className={`today-route-status status-${task.status}`}>{statusText}</span>
            </div>
            <p className="today-route-meta">{task.subject} · {task.chapter} · {task.minutes} 分钟</p>
            {isCurrent && <>
              <p className="today-route-reason">{task.reason}</p>
              <p className="today-route-progress">
                {task.progress?.completedQuestionCount ?? 0}/{task.questionCount} 题
                {task.progress ? ` · 已学习 ${task.progress.minutesSpent} 分钟` : ''}
              </p>
              <button
                type="button"
                className="today-route-primary"
                disabled={props.launchingTaskId === task.id}
                onClick={() => props.onLaunch(task)}
              >{props.launchingTaskId === task.id ? '正在启动…' : getTodayTaskActionLabel(task, destination)}</button>
            </>}
          </div>
        </li>;
      })}
    </ol>
  </section>;
}
```

Use native `<ol>`, `<li>`, headings, and buttons. Status markers must be text, not clickable pseudo-buttons. Only the current task branch may contain `today-route-primary`.

- [ ] **Step 4: Implement terminal states without introducing a second primary action**

- For `route.allCompleted`, show `今日任务已完成` plus low-emphasis `查看报告` and `复习错题` buttons.
- For `!route.currentTask && route.nextAvailableAt`, show `下一项任务可开始时间：…` and only the low-emphasis `调整计划` path.
- For empty `priorityTasks`, treat the generated plan as complete; do not invent a task.
- Show task `reason`, `questionCount`, `minutes`, and progress only for the expanded current task.
- Show later/completed tasks as compact rows with their status text.

- [ ] **Step 5: Run the focused UI tests and web type check**

Run:

```powershell
node --test test/today-learning-route-ui.test.js test/today-learning-route.test.js
npm run build:web
```

Expected: tests PASS and TypeScript/Vite build succeeds.

---

## Task 4: Wire Safe One-Click Launch and Scoped Practice in App

**Files:**

- Modify: `test/today-learning-route-ui.test.js`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/features/student/StudentSections.tsx`

**Produces:** A short-lived `TodayTaskLaunchContext`; no new global store, endpoint, or persistent field.

- [ ] **Step 1: Add failing App-wiring assertions**

Append source-contract tests:

```js
test('App preflights content before starting and navigating a today task', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /preflightTodayTaskLaunch\(task, questions, wrongQuestions\)/);
  assert.match(app, /if \(preflight\.kind === 'error'\)/);
  assert.match(app, /if \(preflight\.kind === 'navigate-plan'\)/);
  assert.match(app, /await startTask\(task\.id\)/);
  assert.match(app, /setTodayTaskLaunchContext\(preflight\.context\)/);
  assert.match(app, /setActiveSection\(preflight\.context\.destination\)/);
});

test('task-scoped question navigation never advances through the full question bank', async () => {
  const app = await source('apps/web/src/App.tsx');
  assert.match(app, /const activePracticeQuestions = todayTaskLaunchContext\?\.destination === 'question'/);
  assert.match(app, /activePracticeQuestions\.filter|questions\.filter/);
  assert.match(app, /practiceIndex >= activePracticeQuestions\.length - 1/);
  assert.match(app, /activePracticeQuestions\[Math\.min\(/);
});
```

Run the test and confirm RED because the launch context and policy wiring do not exist.

- [ ] **Step 2: Add launch state and the safe handler in `App.tsx`**

Import `startTask` from the existing onboarding endpoint and policy types/functions. Add:

```ts
const [todayTaskLaunchContext, setTodayTaskLaunchContext] = useState<TodayTaskLaunchContext | null>(null);
const [todayTaskLaunchingId, setTodayTaskLaunchingId] = useState<string | null>(null);
const [todayTaskLaunchError, setTodayTaskLaunchError] = useState('');

async function handleLaunchTodayTask(task: TodayPlanTask) {
  const preflight = preflightTodayTaskLaunch(task, questions, wrongQuestions);
  setTodayTaskLaunchError('');
  if (preflight.kind === 'error') {
    setTodayTaskLaunchError(preflight.message);
    return;
  }
  if (preflight.kind === 'navigate-plan') {
    setPlanFocusTaskId(preflight.taskId);
    setActiveSection('plan');
    return;
  }
  setTodayTaskLaunchingId(task.id);
  try {
    await startTask(task.id);
    invalidatePracticeAttempt(practiceSubmissionGateRef.current);
    applyPracticeAttemptState(restartAttempt(readPracticeAttemptState()));
    setRedoQuestionId(null);
    setVariantOfQuestionId(null);
    setTodayTaskLaunchContext(preflight.context);
    setPracticeStatus(preflight.context.destination === 'question'
      ? `已开始 ${task.title}，本轮只练习对应知识点。`
      : `已打开 ${task.title} 的待复盘错题。`);
    void refreshTodayPlan();
    void trackEvent('task.start', { taskId: task.id, mode: task.mode });
    setActiveSection(preflight.context.destination);
  } catch (error) {
    setTodayTaskLaunchError(error instanceof Error ? error.message : '任务启动失败，请重试。');
  } finally {
    setTodayTaskLaunchingId(null);
  }
}
```

The implementation must preserve this order: preflight → optional API start → context → navigation. Neither the error branch nor unknown-mode branch calls `startTask`.

- [ ] **Step 3: Scope all question-bank navigation to the task pool**

Immediately before `currentQuestion`, derive:

```ts
const activePracticeQuestions = todayTaskLaunchContext?.destination === 'question'
  ? questions.filter((question) => question.knowledgePointIds.includes(todayTaskLaunchContext.knowledgePointId))
  : questions;
const currentQuestion = (redoQuestionId
  ? activePracticeQuestions.find((question) => question.id === redoQuestionId)
  : undefined)
  ?? activePracticeQuestions[Math.min(practiceIndex, Math.max(0, activePracticeQuestions.length - 1))];
```

Then replace full-bank length/index references in `handleNextQuestion` with `activePracticeQuestions`. Keep answer submission, timers, redo, and variant logic unchanged. Preflight guarantees a task-scoped pool is non-empty before context is installed.

Update `handleRestartQuestionBank` to clear `todayTaskLaunchContext` before restarting the full bank:

```ts
setTodayTaskLaunchContext(null);
```

Clear the context when the active section no longer matches its destination:

```ts
useEffect(() => {
  if (todayTaskLaunchContext && activeSection !== todayTaskLaunchContext.destination) {
    setTodayTaskLaunchContext(null);
  }
}, [activeSection, todayTaskLaunchContext]);
```

- [ ] **Step 4: Thread route props through `StudentSections.tsx`**

Extend the existing student-section props with:

```ts
todayTaskLaunchingId: string | null;
todayTaskLaunchError: string;
todayTaskLaunchContext: TodayTaskLaunchContext | null;
onLaunchTodayTask: (task: TodayPlanTask) => void;
onRetryTodayPlan: () => void;
```

Pass them from `App.tsx` into `StudentLaunchpad`; do not move API calls into `StudentSections`.

- [ ] **Step 5: Run focused tests and web build**

Run:

```powershell
node --test test/today-learning-route.test.js test/today-learning-route-ui.test.js test/stage3-practice-metadata.test.js
npm run build:web
```

Expected: all pass. If existing practice tests expose a regression, use `superpowers:systematic-debugging` before changing behavior.

---

## Task 5: Seed the Wrong-Book Knowledge Filter with TDD

**Files:**

- Modify: `test/wrong-question-filter.test.js`
- Modify: `test/today-learning-route-ui.test.js`
- Modify: `apps/web/src/features/mistakes/MistakeWorkspace.tsx`
- Modify: `apps/web/src/features/student/StudentSections.tsx`
- Modify: `apps/web/src/App.tsx`

**Interface change:**

```ts
initialKnowledgePointId?: string | null;
```

- [ ] **Step 1: Add failing initial-filter contract tests**

In `test/wrong-question-filter.test.js`, add:

```js
test('mistake workspace synchronizes an explicit initial knowledge-point filter', async () => {
  const workspace = await source('apps/web/src/features/mistakes/MistakeWorkspace.tsx');
  assert.match(workspace, /initialKnowledgePointId\?: string \| null/);
  assert.match(workspace, /setKnowledgePointId\(initialKnowledgePointId \?\? ''\)/);
  assert.match(workspace, /\[initialKnowledgePointId\]/);
  assert.match(workspace, /isMockAllowed\(\)/);
});
```

In `test/today-learning-route-ui.test.js`, assert that `StudentSections` passes only wrong-book context to the workspace:

```js
assert.match(studentSections, /initialKnowledgePointId=\{props\.todayTaskLaunchContext\?\.destination === 'wrong-book'/);
```

Run both tests and verify RED.

- [ ] **Step 2: Add the optional prop and synchronization effect**

Update `MistakeWorkspaceProps`, the function signature, and add this effect immediately after the filter state:

```ts
useEffect(() => {
  if (initialKnowledgePointId !== undefined) {
    setKnowledgePointId(initialKnowledgePointId ?? '');
  }
}, [initialKnowledgePointId]);
```

Do not change `fetchWrongQuestions`, its explicit error, or the existing `isMockAllowed()` gate. The existing filter effect will perform the server fetch after the state updates.

- [ ] **Step 3: Pass only wrong-book launch context**

In `StudentSections.tsx`:

```tsx
initialKnowledgePointId={props.todayTaskLaunchContext?.destination === 'wrong-book'
  ? props.todayTaskLaunchContext.knowledgePointId
  : undefined}
```

When the user leaves `wrong-book`, the App effect from Task 4 clears the launch context. A manually chosen filter remains user-controlled until that explicit route-context transition.

- [ ] **Step 4: Run focused tests and web build**

Run:

```powershell
node --test test/wrong-question-filter.test.js test/today-learning-route-ui.test.js
npm run build:web
```

Expected: PASS with no change to production fallback behavior.

---

## Task 6: Integrate the Route into the Dashboard and Apply the Approved Visual Hierarchy

**Files:**

- Modify: `apps/web/src/features/onboarding/StudentLaunchpad.tsx`
- Modify: `apps/web/src/features/student/StudentSections.tsx`
- Modify: `apps/web/src/App.tsx`
- Modify: `apps/web/src/styles.css`
- Modify: `test/p2-info-architecture.test.js`
- Modify: `test/p2-kpi-consistency.test.js`
- Modify: `test/stage3-practice-metadata.test.js`
- Modify: `test/today-plan-ui.test.js`
- Modify: `test/ux-redesign-ui.test.js`
- Modify: `test/web-desktop-actions.test.js`

- [ ] **Step 1: Update existing tests first to express the approved dashboard contract**

Replace obsolete assertions for `student-dashboard-hero`, `quickActions`, hero progress, and first-screen KPI cards with assertions for:

```js
assert.match(launchpad, /<TodayLearningRoute/);
assert.match(launchpad, /plan=\{todayPlan\}/);
assert.match(launchpad, /onLaunch=\{onLaunchTodayTask\}/);
assert.doesNotMatch(launchpad, /const quickActions|student-dashboard-hero|预计提分空间/);
assert.doesNotMatch(launchpad, /<TodayPlan/);
```

Preserve these existing product contracts:

- `StudentLaunchpad` remains a summary/launch surface, not the full `TodayPlan` editor.
- Today-plan adjustment, postponement, rescheduling, and focus behavior remain in the plan section.
- Report estimated-gain logic remains tested in the report; the dashboard no longer duplicates that KPI.
- Lower-page subject mastery, weak points, recent mistakes, weekly rhythm, trend, and exam preparation remain available.

Run the seven affected test files and verify RED for the old launchpad implementation.

- [ ] **Step 2: Replace the launchpad first screen with `TodayLearningRoute`**

Update `StudentLaunchpadProps`:

```ts
todayTaskLaunchingId: string | null;
todayTaskLaunchError: string;
onLaunchTodayTask: (task: TodayPlanTask) => void;
onRetryTodayPlan: () => void;
```

After the onboarding early return, render:

```tsx
<TodayLearningRoute
  plan={todayPlan}
  loading={todayPlanLoading}
  error={todayPlanError}
  launchingTaskId={todayTaskLaunchingId}
  launchError={todayTaskLaunchError}
  onRetry={onRetryTodayPlan}
  onLaunch={onLaunchTodayTask}
  onOpenPlan={() => onNavigate('plan')}
  onOpenWrongBook={() => onNavigate('wrong-book')}
  onOpenReport={() => onNavigate('report')}
/>
```

Remove the old hero, KPI strip, and `quickActions` array plus their now-unused imports/derived values. Keep all approved lower dashboard sections and exam configuration behavior.

- [ ] **Step 3: Add route styles without refactoring unrelated CSS**

Add locally scoped selectors:

```css
.today-route { overflow: hidden; }
.today-route-header { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 16px; align-items: end; }
.today-route-list { display: grid; gap: 12px; margin: 24px 0 0; padding: 0; list-style: none; counter-reset: today-route; }
.today-route-item { position: relative; display: grid; grid-template-columns: 28px minmax(0, 1fr); gap: 12px; min-width: 0; }
.today-route-item::before { counter-increment: today-route; content: counter(today-route); }
.today-route-item.is-current { padding: 20px; border: 1px solid var(--color-primary-border); border-radius: var(--radius-lg); background: var(--color-surface); }
.today-route-primary { justify-self: start; }
.today-route-summary, .today-route-meta { color: var(--color-text-muted); }
.today-route-skeleton { min-height: 220px; }

@media (max-width: 720px) {
  .today-route-header { grid-template-columns: minmax(0, 1fr); align-items: start; }
  .today-route-item.is-current { padding: 16px; }
  .today-route-primary { width: 100%; }
}

@media (prefers-reduced-motion: reduce) {
  .today-route * { scroll-behavior: auto; transition-duration: 0.01ms; animation-duration: 0.01ms; }
}
```

Use the actual token names already defined in `styles.css`; if any example token does not exist, map it to the nearest existing token instead of adding a parallel design-token system. Add visible `:focus-visible` treatment consistent with existing buttons. Do not delete an old selector until `rg` proves it has no remaining use.

- [ ] **Step 4: Complete prop wiring and remove obsolete `handleContinueToday`**

Pass `refreshTodayPlan`, launch status, and `handleLaunchTodayTask` through `StudentSections`. Remove `handleContinueToday` and its prop only after `rg -n "handleContinueToday|onContinueToday" apps/web/src test` shows every caller has migrated.

- [ ] **Step 5: Run the affected frontend tests**

Run:

```powershell
node --test test/today-learning-route.test.js test/today-learning-route-ui.test.js test/p2-info-architecture.test.js test/p2-kpi-consistency.test.js test/stage3-practice-metadata.test.js test/today-plan-ui.test.js test/ux-redesign-ui.test.js test/web-desktop-actions.test.js test/wrong-question-filter.test.js
```

Expected: PASS. Assertions must describe the approved behavior; do not merely delete failing tests.

- [ ] **Step 6: Run the web build**

Run:

```powershell
npm run build:web
```

Expected: PASS with no unused imports, invalid props, or unsafe possibly-undefined question access.

---

## Task 7: Full Verification, Browser Smoke, and Scope Audit

**Files:**

- Verify only; modify source only if a failing test reveals an in-scope defect and repeat TDD.

- [ ] **Step 1: Run the repository test suite**

Run:

```powershell
npm test
```

Expected: PASS. Capture the test count and zero failures.

- [ ] **Step 2: Run both required builds**

Run:

```powershell
npm run build:web
npm run build:api
```

Expected: both PASS. The API build is a compatibility gate even though no API file changes are allowed.

- [ ] **Step 3: Run the local aggregate check**

Run:

```powershell
npm run check:local
```

Expected: PASS for `node --test` and `scripts/verify-ui.mjs`.

- [ ] **Step 4: Perform browser smoke tests at three widths**

Use the existing local development/mock mode only as permitted by `apps/web/src/api/env.ts`. Check desktop, 720px, and 375px:

1. Returning dashboard shows the route above lower evidence and only one high-emphasis task action.
2. Loading shows a skeleton and no stale action.
3. Today-plan fetch error is explicit and retryable.
4. Known practice task starts once and opens only matching knowledge-point questions.
5. Known review task starts once and opens the matching wrong-book filter.
6. Missing question/review content stays on the dashboard, does not call start, and shows an explicit status.
7. Unknown mode opens/focuses the plan task without calling start.
8. All-completed state has no task primary action.
9. Future-postponed-only state shows the earliest available time.
10. Keyboard order follows visual order; launch feedback is announced; no horizontal overflow or covered content; mobile bottom navigation remains usable.

Record screenshots only as verification artifacts; do not add them to the repo unless the user asks.

- [ ] **Step 5: Audit the final diff and forbidden boundary**

Run:

```powershell
git diff --check
git status --short
git diff --name-only
git diff -- apps/web/src test
```

Manually verify every changed path appears in the File Map and none is related to Question Annotation or Retrieval V2. Also run:

```powershell
git diff --name-only | rg -i "question.?annotation|retrieval|rerank|embedding|prisma|migration|apps/api"
```

Expected: no output. If there is output, stop and remove only this task’s accidental changes; preserve pre-existing user work.

- [ ] **Step 6: Decide whether PostgreSQL integration is required**

Expected decision: not required because the approved implementation is frontend-only and changes no data layer/API. If any backend, schema, migration, or persistence file was touched, the boundary has been violated: stop, report it, and obtain new approval before running or retaining that work.

- [ ] **Step 7: Prepare the handoff without Git writes**

Report:

- Created/modified files.
- Open-source reference direction and how it shaped the ordered route, single action, and live feedback.
- Exact commands and output summaries for targeted tests, `npm test`, both builds, `check:local`, and browser smoke.
- Confirmation that Question Annotation / Retrieval V2 and backend/data files were untouched.
- Remaining risks, especially free-string `mode` expansion and local-content availability.
- No branch/stage/commit/push was performed unless separately authorized by the user.
