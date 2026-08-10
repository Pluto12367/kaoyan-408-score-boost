# Student Learning Console v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a student home learning console that tells students what to do today, where to start, and how to enter self-directed study using existing data.

**Architecture:** Reuse the existing student dashboard route and the existing `StudentLaunchpad` home surface. Extract the new console behavior into one focused frontend component that receives existing state as props and emits navigation callbacks; `StudentSections` remains the wiring layer. No backend, database, planner, or Retrieval V2 production changes are introduced.

**Tech Stack:** React 18, TypeScript 5.5, Vite, Node `node:test`, existing CSS in `apps/web/src/styles.css`, existing `RoleSection` navigation.

## Global Constraints

- System location is the student home / overview area.
- Use approved option B: create a new student learning console component and wire it into the student home overview using existing data.
- Reuse existing data sources only: `todayPlan`, dashboard overview, `practiceSet`, `wrongQuestionSummary`, `reviewResources`, `masteryMap`, `learningProfile`, `stageReport`, and `learningCalendar`.
- Do not add backend endpoints.
- Do not add database migrations.
- Do not change planner rules or task-completion behavior.
- Do not integrate Retrieval V2 into production annotation in this feature.
- Console actions are navigation/focus actions only.
- Existing `TodayPlan`, practice, wrong-book, report, knowledge catalog, and stage assessment flows must remain usable.
- Follow TDD: write failing tests before production behavior changes.
- Do not use `git add .` or `git add -A`; stage explicit files only.

---

## File Structure

Create:

```text
apps/web/src/features/student/StudentLearningConsole.tsx
```

Responsibility: Pure presentational console. It derives learning path cards, status cards, autonomous-study actions, and the next-step suggestion from props. It does not fetch or mutate data.

Modify:

```text
apps/web/src/features/student/StudentSections.tsx
```

Responsibility: Pass existing data into `StudentLearningConsole` inside the dashboard section and keep `StudentLaunchpad` for the existing hero/exam/dashboard content.

Modify:

```text
apps/web/src/features/onboarding/StudentLaunchpad.tsx
```

Responsibility: Remove or reduce overlapping "what to do today" hero/action responsibility after the new console is rendered above it. Keep onboarding, exam entry, subject cards, mistake lists, and existing actions intact.

Modify:

```text
apps/web/src/styles.css
```

Responsibility: Add console layout styles only; avoid broad restyling.

Test:

```text
test/student-learning-console-ui.test.js
```

Responsibility: Static/behavior tests proving the console is rendered, uses existing data labels, exposes autonomous actions, and wires navigation callbacks through `StudentSections`/`App` source.

---

## Task 1: Console Component Contract and Rendering

**Files:**
- Create: `apps/web/src/features/student/StudentLearningConsole.tsx`
- Create: `test/student-learning-console-ui.test.js`
- Modify: `apps/web/src/styles.css`

**Interfaces:**

Produces:

```ts
export interface StudentLearningConsoleProps {
  todayPlan: TodayPlanType | null;
  todayPlanLoading: boolean;
  todayPlanError: string;
  wrongQuestionSummary: WrongQuestionSummary | null;
  masteryMap: MasteryMap | null;
  learningCalendar: LearningCalendar | null;
  onNavigate: (section: RoleSection) => void;
  onContinueToday: () => void;
}

export function StudentLearningConsole(props: StudentLearningConsoleProps): JSX.Element;
```

Consumes existing types:

```ts
import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';
import type { LearningCalendar, MasteryMap, WrongQuestionSummary } from '../../api';
import type { RoleSection } from '../../layouts/RoleNavigation';
```

- [ ] **Step 1: Write RED tests for the component contract**

Add `test/student-learning-console-ui.test.js` with source-level assertions. Use repository tests' existing style: read source files and assert stable strings/imports rather than requiring a browser.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const consolePath = 'apps/web/src/features/student/StudentLearningConsole.tsx';

test('student learning console component exposes the approved v1 contract', () => {
  const source = readFileSync(consolePath, 'utf8');
  assert.match(source, /export interface StudentLearningConsoleProps/);
  assert.match(source, /todayPlan: TodayPlanType \\| null/);
  assert.match(source, /wrongQuestionSummary: WrongQuestionSummary \\| null/);
  assert.match(source, /masteryMap: MasteryMap \\| null/);
  assert.match(source, /onNavigate: \\(section: RoleSection\\) => void/);
  assert.match(source, /onContinueToday: \\(\\) => void/);
  assert.match(source, /export function StudentLearningConsole/);
});
```

- [ ] **Step 2: Run RED**

Run:

```powershell
node --test test/student-learning-console-ui.test.js
```

Expected: FAIL with `ENOENT` because `StudentLearningConsole.tsx` does not exist.

- [ ] **Step 3: Write RED tests for visible learning guidance**

Extend `test/student-learning-console-ui.test.js`:

```js
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
```

- [ ] **Step 4: Implement minimal component**

Create `StudentLearningConsole.tsx` with these rules:

```tsx
import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';
import type { LearningCalendar, MasteryMap, WrongQuestionSummary } from '../../api';
import type { RoleSection } from '../../layouts/RoleNavigation';

export interface StudentLearningConsoleProps {
  todayPlan: TodayPlanType | null;
  todayPlanLoading: boolean;
  todayPlanError: string;
  wrongQuestionSummary: WrongQuestionSummary | null;
  masteryMap: MasteryMap | null;
  learningCalendar: LearningCalendar | null;
  onNavigate: (section: RoleSection) => void;
  onContinueToday: () => void;
}

function firstUnfinishedTask(plan: TodayPlanType | null) {
  return plan?.priorityTasks.find((task) => task.status !== 'completed' && !task.completed) ?? null;
}

function weakestPointTitle(masteryMap: MasteryMap | null) {
  return masteryMap?.weakestPoints?.[0]?.title ?? null;
}

export function StudentLearningConsole({
  todayPlan,
  todayPlanLoading,
  todayPlanError,
  wrongQuestionSummary,
  masteryMap,
  learningCalendar,
  onNavigate,
  onContinueToday,
}: StudentLearningConsoleProps) {
  const task = firstUnfinishedTask(todayPlan);
  const dueWrongCount = wrongQuestionSummary?.pendingCount ?? null;
  const weakPoint = weakestPointTitle(masteryMap);
  const completionText = todayPlan
    ? `${todayPlan.summary.completedTasks}/${todayPlan.summary.totalTasks}`
    : todayPlanLoading
      ? '加载中'
      : '--';
  const nextSuggestion = task
    ? `先完成最高优先级任务：${task.title}`
    : dueWrongCount && dueWrongCount > 0
      ? `先复盘 ${dueWrongCount} 道待处理错题，再做新练习`
      : '今日任务完成后，可以继续薄弱点练习或查看学习报告';

  const pathItems = [
    {
      title: task ? '第 1 步：开始今日优先任务' : '第 1 步：确认今日计划',
      description: task ? `${task.subject} · ${task.chapter} · ${task.minutes} 分钟` : (todayPlanError || '今日计划准备好后会显示优先任务'),
      action: '开始今日任务',
      onClick: onContinueToday,
    },
    {
      title: '第 2 步：复盘错题',
      description: dueWrongCount != null ? `${dueWrongCount} 道错题待复盘` : '错题数据加载后显示数量',
      action: '去错题本',
      onClick: () => onNavigate('wrong-book'),
    },
    {
      title: '第 3 步：薄弱点练习',
      description: weakPoint ? `当前优先：${weakPoint}` : '暂无薄弱点时使用推荐题组',
      action: '开始练习',
      onClick: () => onNavigate('question'),
    },
  ];

  const selfStudyActions: Array<{ title: string; description: string; section: RoleSection }> = [
    { title: '按薄弱点练', description: weakPoint ?? '使用推荐题组开始专项练习', section: 'question' },
    { title: '按科目练', description: '进入题库训练，自主选择练习方向', section: 'question' },
    { title: '错题复盘', description: dueWrongCount != null ? `${dueWrongCount} 道待处理` : '查看错因和同考点练习', section: 'wrong-book' },
    { title: '阶段测验', description: '用阶段测评检查最近学习效果', section: 'score-center' },
    { title: '学习报告', description: '查看掌握度、趋势和下一步建议', section: 'report' },
    { title: '知识图谱', description: '浏览 408 原子知识点目录', section: 'knowledge-catalog' },
  ];

  return (
    <section className="panel student-learning-console" aria-label="学生学习中控台">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">学习中控台</p>
          <h3>今天先做什么，一眼看清</h3>
        </div>
        <span>{nextSuggestion}</span>
      </div>

      <div className="learning-console-status" aria-label="当前状态">
        <article><span>今日完成</span><strong>{completionText}</strong></article>
        <article><span>今日正确率</span><strong>{todayPlan ? `${todayPlan.summary.todayAccuracyRate}%` : '--'}</strong></article>
        <article><span>连续学习</span><strong>{todayPlan?.summary.streakDays ?? learningCalendar?.streakDays ?? '--'} 天</strong></article>
        <article><span>待复盘错题</span><strong>{dueWrongCount ?? '--'} 道</strong></article>
      </div>

      <div className="learning-console-grid">
        <div className="learning-path-card">
          <h4>今日学习路径</h4>
          {pathItems.map((item) => (
            <article key={item.title}>
              <div><strong>{item.title}</strong><span>{item.description}</span></div>
              <button type="button" className="secondary-action" onClick={item.onClick}>{item.action}</button>
            </article>
          ))}
        </div>
        <div className="self-study-card">
          <h4>自主学习</h4>
          <div className="self-study-action-grid">
            {selfStudyActions.map((item) => (
              <button type="button" key={item.title} onClick={() => onNavigate(item.section)}>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Add minimal styles**

Append to `apps/web/src/styles.css`:

```css
.student-learning-console {
  display: grid;
  gap: 18px;
}

.learning-console-status,
.learning-console-grid,
.self-study-action-grid {
  display: grid;
  gap: 12px;
}

.learning-console-status {
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}

.learning-console-status article,
.learning-path-card,
.self-study-card,
.self-study-action-grid button {
  border: 1px solid var(--border-color, rgba(148, 163, 184, 0.24));
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.72);
  padding: 14px;
}

.learning-console-status span,
.learning-path-card span,
.self-study-action-grid span {
  display: block;
  color: var(--muted-text, #64748b);
  font-size: 0.9rem;
}

.learning-console-grid {
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
}

.learning-path-card {
  display: grid;
  gap: 12px;
}

.learning-path-card article {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: center;
}

.self-study-action-grid {
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}

.self-study-action-grid button {
  text-align: left;
  cursor: pointer;
}

@media (max-width: 780px) {
  .learning-console-grid {
    grid-template-columns: 1fr;
  }

  .learning-path-card article {
    align-items: stretch;
    flex-direction: column;
  }
}
```

- [ ] **Step 6: Run GREEN**

Run:

```powershell
node --test test/student-learning-console-ui.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 1**

Run:

```powershell
git add apps/web/src/features/student/StudentLearningConsole.tsx apps/web/src/styles.css test/student-learning-console-ui.test.js
git commit -m "feat: add student learning console"
```

---

## Task 2: Wire Console into Student Home

**Files:**
- Modify: `apps/web/src/features/student/StudentSections.tsx`
- Modify: `apps/web/src/features/onboarding/StudentLaunchpad.tsx`
- Modify: `test/student-learning-console-ui.test.js`

**Interfaces:**

Consumes from Task 1:

```ts
import { StudentLearningConsole } from './StudentLearningConsole';
```

Student dashboard section passes:

```tsx
<StudentLearningConsole
  todayPlan={props.todayPlan}
  todayPlanLoading={props.todayPlanLoading}
  todayPlanError={props.todayPlanError}
  wrongQuestionSummary={props.wrongQuestionSummary.data}
  masteryMap={props.masteryMap}
  learningCalendar={props.learningCalendar}
  onNavigate={props.onNavigate}
  onContinueToday={props.onContinueToday}
/>
```

- [ ] **Step 1: Write RED wiring tests**

Extend `test/student-learning-console-ui.test.js`:

```js
test('student dashboard wires the learning console above existing launchpad content', () => {
  const source = readFileSync('apps/web/src/features/student/StudentSections.tsx', 'utf8');
  assert.match(source, /StudentLearningConsole/);
  assert.match(source, /todayPlan=\\{props\\.todayPlan\\}/);
  assert.match(source, /wrongQuestionSummary=\\{props\\.wrongQuestionSummary\\.data\\}/);
  assert.match(source, /masteryMap=\\{props\\.masteryMap\\}/);
  assert.match(source, /learningCalendar=\\{props\\.learningCalendar\\}/);
  assert.match(source, /onContinueToday=\\{props\\.onContinueToday\\}/);
});

test('student launchpad no longer owns the primary daily-learning-path copy', () => {
  const source = readFileSync('apps/web/src/features/onboarding/StudentLaunchpad.tsx', 'utf8');
  assert.equal(source.includes('今天先做什么，一眼看清'), false);
});
```

- [ ] **Step 2: Run RED**

Run:

```powershell
node --test test/student-learning-console-ui.test.js
```

Expected: FAIL because `StudentSections.tsx` does not import or render `StudentLearningConsole`.

- [ ] **Step 3: Wire console into dashboard section**

In `apps/web/src/features/student/StudentSections.tsx`:

1. Add lazy import or direct import near existing student feature imports.

Use direct import because the dashboard already lazy-loads `StudentLaunchpad`, and the new console is small:

```ts
import { StudentLearningConsole } from './StudentLearningConsole';
```

2. Render it immediately before `StudentLaunchpad` in the dashboard Suspense block:

```tsx
<>
  <StudentLearningConsole
    todayPlan={props.todayPlan}
    todayPlanLoading={props.todayPlanLoading}
    todayPlanError={props.todayPlanError}
    wrongQuestionSummary={props.wrongQuestionSummary.data}
    masteryMap={props.masteryMap}
    learningCalendar={props.learningCalendar}
    onNavigate={props.onNavigate}
    onContinueToday={props.onContinueToday}
  />
  <StudentLaunchpad
    ...
  />
</>
```

3. Do not change section ids, route hash logic, or role navigation.

- [ ] **Step 4: Reduce overlapping launchpad hero copy only if needed**

If the dashboard now repeats the same "continue today" hero message twice, adjust `StudentLaunchpad` copy from primary daily guidance to broader dashboard context. Keep its existing buttons and exam panel.

Allowed minimal change:

```tsx
<p className="eyebrow">学习总览</p>
<h3>查看阶段数据和模拟训练</h3>
```

Do not remove onboarding, exam generation, subject cards, recent mistakes, or resume-session behavior.

- [ ] **Step 5: Run GREEN**

Run:

```powershell
node --test test/student-learning-console-ui.test.js
```

Expected: PASS.

- [ ] **Step 6: Run student UI regression tests**

Run:

```powershell
node --test test/p2-info-architecture.test.js test/p2-ux-cleanup.test.js test/today-plan-ui.test.js test/today-score-center-ui.test.js test/navigation-hash-sync.test.js test/mobile-nav-ui.test.js test/student-session-policy.test.js test/knowledge-catalog-ui.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```powershell
git add apps/web/src/features/student/StudentSections.tsx apps/web/src/features/onboarding/StudentLaunchpad.tsx test/student-learning-console-ui.test.js
git commit -m "feat: wire student learning console"
```

---

## Task 3: Full Verification and Scope Review

**Files:**
- No production files unless Task 1/2 verification reveals a focused fix is required.

**Interfaces:**

Consumes:

```text
StudentLearningConsole rendered on dashboard
existing navigation callbacks
existing student data hooks
```

Produces:

```text
verified student learning console v1
```

- [ ] **Step 1: Run focused console test**

Run:

```powershell
node --test test/student-learning-console-ui.test.js
```

Expected: PASS.

- [ ] **Step 2: Run affected frontend/static tests**

Run:

```powershell
node --test test/p2-info-architecture.test.js test/p2-ux-cleanup.test.js test/today-plan-ui.test.js test/today-score-center-ui.test.js test/navigation-hash-sync.test.js test/mobile-nav-ui.test.js test/student-session-policy.test.js test/knowledge-catalog-ui.test.js test/ux-redesign-ui.test.js
```

Expected: PASS.

- [ ] **Step 3: Run web build if TypeScript/TSX files changed**

Run:

```powershell
npm run build:web
```

Expected: PASS.

- [ ] **Step 4: Run full repository tests**

Run:

```powershell
npm test
```

Expected: 0 failures; existing skip may remain.

- [ ] **Step 5: Review diff scope**

Run:

```powershell
git diff --stat
git diff -- apps/web/src/features/student/StudentLearningConsole.tsx apps/web/src/features/student/StudentSections.tsx apps/web/src/features/onboarding/StudentLaunchpad.tsx apps/web/src/styles.css test/student-learning-console-ui.test.js
git status --short
```

Confirm:

```text
no backend changes
no database/schema/migration changes
no Retrieval V2 changes
no local-data changes
no unrelated UI redesign
```

- [ ] **Step 6: If Task 3 required fixes, commit them**

Only if fixes were made:

```powershell
git add <explicit fixed files>
git commit -m "fix: verify student learning console"
```

If no fixes were made, do not create an empty commit.

---

## Plan Self-Review

### Spec coverage

- System location: Task 2 wires the console into `StudentSections` dashboard.
- User-visible behavior: Task 1 renders today's path, self-directed actions, current status, and next-step suggestion.
- Data sources: Task 1 props and Task 2 wiring use existing `todayPlan`, wrong-summary, mastery, and calendar data; no new endpoint.
- Interaction model: Task 1 action buttons emit `onNavigate` / `onContinueToday`; no mutation or fetching.
- Architecture: Task 1 creates one presentational component; Task 2 keeps `App.tsx` / `StudentSections` as orchestration.
- Scope boundaries: Global constraints and Task 3 diff review forbid backend, database, planner, Retrieval V2, and large redesign.
- Error/empty states: Task 1 handles missing plan, wrong summary, and mastery map with generic copy and no invented counts.
- Testing: Tasks 1-3 add focused tests, affected UI regression, web build, and full repository test.

### Placeholder scan

No TBD/TODO/placeholders remain. Every task has explicit files, command lines, and expected outcomes.

### Type consistency

The plan consistently uses:

```text
StudentLearningConsole
StudentLearningConsoleProps
TodayPlanType
WrongQuestionSummary
MasteryMap
LearningCalendar
RoleSection
onNavigate
onContinueToday
```

No new backend or database interfaces are introduced.

