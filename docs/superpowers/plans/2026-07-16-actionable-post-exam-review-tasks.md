# Actionable Post-Exam Review Tasks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each three-day post-exam review plan as three owned, actionable `StudyTask` rows that appear in Today Plan without allowing any day to exceed three tasks.

**Architecture:** Add a pure scheduling function to `@kaoyan408/shared`, then call it from one PostgreSQL transaction in `ExamReviewPlanRepository`. `StudyService` creates traceable review-task candidates from the exam report and only replaces its in-memory plan caches after persistence succeeds. Existing task start, complete, and postpone endpoints remain the only task lifecycle API.

**Tech Stack:** TypeScript, Node.js test runner, NestJS 10, Prisma 5, PostgreSQL 16, React 18, Vite 5

## Global Constraints

- Initial review dates are the next three consecutive Asia/Shanghai study dates: `D+1`, `D+2`, and `D+3`.
- Today Plan contains at most three tasks per date.
- Review tasks use deterministic IDs: `exam-review-${sessionId}-day-${dayIndex}`.
- Review tasks displace only ordinary tasks with status `pending` or `postponed`.
- Tasks with status `in_progress` or `completed`, and existing `考后复盘` tasks, are protected.
- A missing active plan is created without setting `onboardingCompletedAt` or changing trial status.
- PostgreSQL insertion, displacement, and `ExamReviewPlan` persistence commit atomically.
- Memory mode uses the same pure scheduler and replaces caches only after successful scheduling.
- No Prisma schema migration and no second task lifecycle are introduced.
- The unrelated `kaoyan-408-content-starter/` directory must remain untracked and uncommitted.

---

### Task 1: Pure Three-Task-Per-Day Scheduler

**Files:**
- Create: `packages/shared/src/postExamScheduling.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `test/post-exam-scheduling.test.js`

**Interfaces:**
- Consumes: structurally typed tasks with `id`, `scheduledDate`, `priority`, `status`, and `mode`.
- Produces: `mergePostExamTasks<T extends SchedulableStudyTask>(currentTasks: readonly T[], reviewTasks: readonly T[]): T[]`.
- Produces: `postExamTaskId(sessionId: string, dayIndex: number): string`.

- [ ] **Step 1: Write failing scheduler tests**

Create `test/post-exam-scheduling.test.js` with fixtures that cover insertion, displacement, protected tasks, cascading, extension, and idempotency:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mergePostExamTasks,
  postExamTaskId,
} from '../packages/shared/dist/postExamScheduling.js';

const task = (id, date, priority = '中', status = 'pending', mode = '专项训练') => ({
  id,
  scheduledDate: date,
  priority,
  status,
  mode,
});

test('post-exam tasks displace the lowest-priority pending ordinary task', () => {
  const current = [
    task('high', '2026-07-17', '高'),
    task('medium', '2026-07-17', '中'),
    task('low', '2026-07-17', '低'),
  ];
  const review = task(postExamTaskId('session-1', 1), '2026-07-17', '高', 'pending', '考后复盘');
  const result = mergePostExamTasks(current, [review]);

  assert.equal(result.find((item) => item.id === review.id).scheduledDate, '2026-07-17');
  assert.equal(result.find((item) => item.id === 'low').scheduledDate, '2026-07-18');
  assert.equal(result.filter((item) => item.scheduledDate === '2026-07-17').length, 3);
});

test('scheduler preserves protected tasks and moves the review task to the next capacity', () => {
  const current = [
    task('started', '2026-07-17', '低', 'in_progress'),
    task('done', '2026-07-17', '低', 'completed'),
    task('older-review', '2026-07-17', '高', 'pending', '考后复盘'),
  ];
  const review = task(postExamTaskId('session-2', 1), '2026-07-17', '高', 'pending', '考后复盘');
  const result = mergePostExamTasks(current, [review]);

  assert.equal(result.find((item) => item.id === 'started').scheduledDate, '2026-07-17');
  assert.equal(result.find((item) => item.id === 'done').scheduledDate, '2026-07-17');
  assert.equal(result.find((item) => item.id === review.id).scheduledDate, '2026-07-18');
});

test('scheduler cascades displaced tasks, extends the plan, and is idempotent', () => {
  const dates = ['2026-07-17', '2026-07-18', '2026-07-19'];
  const current = dates.flatMap((date, day) => [0, 1, 2].map((slot) => task(`task-${day}-${slot}`, date, slot === 2 ? '低' : '中')));
  const reviews = dates.map((date, index) => task(postExamTaskId('session-3', index + 1), date, '高', 'pending', '考后复盘'));
  const once = mergePostExamTasks(current, reviews);
  const twice = mergePostExamTasks(once, reviews);

  for (const date of new Set(once.map((item) => item.scheduledDate))) {
    assert.ok(once.filter((item) => item.scheduledDate === date).length <= 3);
  }
  assert.ok(once.some((item) => item.scheduledDate > '2026-07-19'));
  assert.deepEqual(twice, once);
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npm run build:shared && node --test test/post-exam-scheduling.test.js
```

Expected: FAIL because `postExamScheduling.js` does not exist.

- [ ] **Step 3: Implement the minimal pure scheduler**

Create `packages/shared/src/postExamScheduling.ts`:

```ts
export interface SchedulableStudyTask {
  id: string;
  scheduledDate: string;
  priority: '高' | '中' | '低';
  status: 'pending' | 'in_progress' | 'postponed' | 'completed';
  mode: string;
}

const MAX_TASKS_PER_DAY = 3;
const priorityRank = { 高: 3, 中: 2, 低: 1 } as const;

export function postExamTaskId(sessionId: string, dayIndex: number) {
  return `exam-review-${sessionId}-day-${dayIndex}`;
}

export function mergePostExamTasks<T extends SchedulableStudyTask>(
  currentTasks: readonly T[],
  reviewTasks: readonly T[],
): T[] {
  const tasks = currentTasks.map((item) => ({ ...item })) as T[];

  for (const candidate of reviewTasks) {
    if (tasks.some((item) => item.id === candidate.id)) continue;
    const review = { ...candidate } as T;
    let date = review.scheduledDate;
    let canDisplace = true;

    while (true) {
      const dayTasks = tasks.filter((item) => item.scheduledDate === date);
      if (dayTasks.length < MAX_TASKS_PER_DAY) {
        review.scheduledDate = date;
        tasks.push(review);
        break;
      }

      const movable = canDisplace
        ? dayTasks
          .filter((item) => item.mode !== '考后复盘' && (item.status === 'pending' || item.status === 'postponed'))
          .sort((left, right) => priorityRank[left.priority] - priorityRank[right.priority] || tasks.indexOf(right) - tasks.indexOf(left))[0]
        : undefined;

      if (!movable) {
        canDisplace = false;
        date = addStudyDays(date, 1);
        continue;
      }

      movable.scheduledDate = findNextCapacityDate(tasks, addStudyDays(date, 1), movable.id);
      review.scheduledDate = date;
      tasks.push(review);
      break;
    }
  }

  return tasks;
}

function findNextCapacityDate<T extends SchedulableStudyTask>(tasks: readonly T[], start: string, movingId: string) {
  let date = start;
  while (tasks.filter((item) => item.id !== movingId && item.scheduledDate === date).length >= MAX_TASKS_PER_DAY) {
    date = addStudyDays(date, 1);
  }
  return date;
}

function addStudyDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
```

Export it from `packages/shared/src/index.ts`:

```ts
export * from './postExamScheduling';
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
npm run build:shared && node --test test/post-exam-scheduling.test.js
```

Expected: 3 tests pass.

- [ ] **Step 5: Run the complete unit suite**

Run: `npm test`

Expected: all existing tests plus the new scheduler tests pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add packages/shared/src/postExamScheduling.ts packages/shared/src/index.ts test/post-exam-scheduling.test.js
git commit -m "Add post-exam task scheduler"
```

---

### Task 2: Transactional Actionable Review Tasks

**Files:**
- Modify: `apps/api/src/study/exam-review-plan.repository.ts`
- Modify: `apps/api/src/study/study.service.ts`
- Modify: `apps/web/src/api/endpoints/exam.ts`
- Modify: `scripts/integration-postgres.mjs`

**Interfaces:**
- Consumes: `mergePostExamTasks()` and `postExamTaskId()` from Task 1.
- Produces: `ExamReviewDay` fields `knowledgePointId: string` and `taskId: string`.
- Produces: `ExamReviewPlanRepository.saveActionablePlan(input): Promise<{ reviewPlan: ExamReviewPlanState; studyPlan: SevenDayPlanState }>`.
- Produces: `PostExamReviewTasks.days[].taskId` and the actual persisted `date`.

- [ ] **Step 1: Add failing happy-path PostgreSQL assertions**

Immediately after the existing `examReviewPlan` request in `scripts/integration-postgres.mjs`, add:

```js
assert(examReviewPlan.days.every((day) => day.taskId && day.knowledgePointId), 'review days must retain actionable task and knowledge-point IDs');
const persistedReviewTasks = await prisma.studyTask.findMany({
  where: { id: { in: examReviewPlan.days.map((day) => day.taskId) } },
  orderBy: { scheduledDate: 'asc' },
});
assert(persistedReviewTasks.length === 3, 'review plan must create three StudyTask rows');
assert(persistedReviewTasks.every((task) => task.mode === '考后复盘' && task.priority === '高'), 'review tasks must be high-priority post-exam tasks');
for (const date of new Set(persistedReviewTasks.map((task) => task.scheduledDate))) {
  assert(await prisma.studyTask.count({ where: { planId: persistedReviewTasks[0].planId, scheduledDate: date } }) <= 3, 'review scheduling must keep each day at three tasks or fewer');
}
```

Start, complete, and postpone three different generated tasks through the existing endpoints and assert success:

```js
const [startable, completable, postponable] = examReviewPlan.days;
assert((await postJson(`${apiUrl}/tasks/${startable.taskId}/start`, {}, studentHeaders)).status === 'in_progress', 'review task must use the existing start endpoint');
assert((await postJson(`${apiUrl}/study-tasks/${completable.taskId}/complete`, {}, studentHeaders)).status === 'completed', 'review task must use the existing complete endpoint');
assert((await postJson(`${apiUrl}/tasks/${postponable.taskId}/postpone`, {}, studentHeaders)).rescheduledDate > postponable.date, 'review task must use the existing postpone endpoint');
```

- [ ] **Step 2: Run PostgreSQL integration and verify RED**

Run:

```bash
npm run db:test:up
npm run test:integration:postgres
```

Expected: FAIL because review days lack task IDs and no `StudyTask` rows are created.

- [ ] **Step 3: Extend report and review contracts**

In `StudyService.getExamReport()`, retain the map key in every loss:

```ts
const pointLosses = new Map<string, { knowledgePointId: string; title: string; subject: string; wrongCount: number }>();
const existing = pointLosses.get(key) ?? {
  knowledgePointId: key,
  title: point?.title ?? key,
  subject: point?.subject ?? '未分类',
  wrongCount: 0,
};
```

Extend `ExamReviewDay` and the matching frontend types:

```ts
export interface ExamReviewDay {
  dayIndex: number;
  taskId: string;
  knowledgePointId: string;
  date: string;
  focus: string;
  subject: string;
  questionCount: number;
  minutes: number;
  tasks: string[];
}
```

Update `apps/web/src/api/endpoints/exam.ts` so `knowledgePointLosses` includes `knowledgePointId` and review days include `taskId` and `knowledgePointId`.

- [ ] **Step 4: Add the atomic repository operation**

Add this input and method to `ExamReviewPlanRepository`:

```ts
export interface SaveActionableReviewPlanInput {
  reviewPlan: ExamReviewPlanState;
  reviewTasks: ScheduledStudyTaskState[];
  fallbackPlan: SevenDayPlanState;
}

async saveActionablePlan(input: SaveActionableReviewPlanInput) {
  if (!this.enabled) {
    return {
      reviewPlan: input.reviewPlan,
      studyPlan: {
        ...input.fallbackPlan,
        tasks: mergePostExamTasks(input.fallbackPlan.tasks, input.reviewTasks),
      },
    };
  }

  return this.prisma.$transaction(async (tx) => {
    const session = await tx.learningSession.findFirst({
      where: { id: input.reviewPlan.examSessionId, userId: input.reviewPlan.userId, type: 'paper', completed: true },
      select: { id: true },
    });
    if (!session) throw new Error('Completed owned paper session was not found');

    let active = await tx.studyPlan.findFirst({
      where: { userId: input.reviewPlan.userId, status: 'ACTIVE' },
      include: { tasks: { orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!active) active = await createStudyPlan(tx, input.fallbackPlan);

    const current = toSevenDayPlan(active);
    const merged = mergePostExamTasks(current.tasks, input.reviewTasks);
    await persistTaskSchedule(tx, active.id, current.tasks, merged);

    const actualDates = new Map(merged.map((task) => [task.id, task.scheduledDate]));
    const persistedPlan = {
      ...input.reviewPlan,
      days: input.reviewPlan.days.map((day) => ({ ...day, date: actualDates.get(day.taskId) ?? day.date })),
    };
    await upsertExamReviewPlan(tx, persistedPlan);
    return { reviewPlan: persistedPlan, studyPlan: { ...current, tasks: merged } };
  });
}
```

Implement the three focused private helpers in the same repository:

- `createStudyPlan(tx, fallbackPlan)` creates the plan and its ordinary tasks but does not update `User`.
- `toSevenDayPlan(row)` uses the same field mapping as `OnboardingPlanRepository.load()`.
- `persistTaskSchedule(tx, planId, before, after)` creates only missing deterministic review tasks and updates only tasks whose `scheduledDate` changed.
- `upsertExamReviewPlan(tx, plan)` contains the existing upsert mapping so `save()` and `saveActionablePlan()` share one implementation.

Before creating a review task, query its ID globally. If it belongs to another plan, throw `Error('Post-exam task ID is already owned by another plan')`.

- [ ] **Step 5: Connect `StudyService` without premature cache writes**

Build each review day with a deterministic task ID and knowledge point. Use the highest `importance`, then `frequency`, knowledge point as the fallback when the report has no losses. Throw `BadRequestException('No knowledge point is available for post-exam review')` only when the catalog is empty.

Create three `ScheduledStudyTaskState` candidates:

```ts
const reviewTasks = days.map((day) => ({
  id: day.taskId,
  knowledgePointId: day.knowledgePointId,
  subject: day.subject as Subject,
  chapter: this.knowledgePoints.find((point) => point.id === day.knowledgePointId)?.chapter ?? '',
  title: `考后复盘：${day.focus}`,
  mode: '考后复盘',
  minutes: day.minutes,
  questionCount: day.questionCount,
  scheduledDate: day.date,
  priority: '高' as const,
  reason: `来自模拟考试 ${sessionId}，本次正确率 ${report.summary.accuracyRate}%`,
  nextAction: day.tasks.join(' '),
  status: 'pending' as const,
  postponeCount: 0,
}));
```

Do not return early merely because `examReviewPlans` contains the session. Use the cached plan as the immutable draft when present, rebuild it only when absent, and always call `saveActionablePlan()`. This repairs a missing operational projection after an older deployment or cache reload:

```ts
const recommendation = report.summary.accuracyRate >= 80
  ? '本次考试表现较好，重点保持限时训练节奏，巩固已掌握考点。'
  : report.summary.accuracyRate >= 60
    ? '本次考试处于中间水平，优先复盘错题知识点，再做同考点专项训练。'
    : '基础还存在明显短板，建议暂停新题，先回到高频考点的概念和例题。';
const cachedPlan = this.examReviewPlans.get(sessionId);
if (cachedPlan && cachedPlan.userId !== userId) {
  throw new ForbiddenException('You can only access your own exam review plan');
}
const reviewPlan: ExamReviewPlanState = cachedPlan ?? {
  userId,
  examSessionId: sessionId,
  generatedAt: new Date().toISOString(),
  examAccuracyRate: report.summary.accuracyRate,
  weakPointTitles: report.knowledgePointLosses.slice(0, 3).map((point) => point.title),
  days,
  recommendation,
};
const persisted = await this.examReviewPlanRepository.saveActionablePlan({
  reviewPlan,
  reviewTasks,
  fallbackPlan: this.sevenDayPlansByUser.get(userId) ?? this.buildSevenDayPlan(userId),
});
```

Only after the repository resolves, replace both caches:

```ts
this.examReviewPlans.set(sessionId, persisted.reviewPlan);
this.sevenDayPlansByUser.set(userId, persisted.studyPlan);
return persisted.reviewPlan;
```

- [ ] **Step 6: Run integration and builds**

Run:

```bash
npm run test:integration:postgres
npm run build:api
npm run build:web
```

Expected: integration exits with `{ "ok": true }`; both builds exit 0.

- [ ] **Step 7: Commit Task 2**

```bash
git add apps/api/src/study/exam-review-plan.repository.ts apps/api/src/study/study.service.ts apps/web/src/api/endpoints/exam.ts scripts/integration-postgres.mjs
git commit -m "Persist actionable post-exam review tasks"
```

---

### Task 3: Concurrency, Rollback, No-Plan, and Ownership Hardening

**Files:**
- Modify: `scripts/integration-postgres.mjs`
- Modify: `apps/api/src/study/exam-review-plan.repository.ts`

**Interfaces:**
- Consumes: `saveActionablePlan()` from Task 2.
- Produces: idempotent behavior under duplicate and concurrent HTTP requests.
- Produces: no-plan bootstrap that preserves `User.onboardingCompletedAt` and `User.trialStatus`.

- [ ] **Step 1: Add failing duplicate and concurrency assertions**

Add a fresh submitted paper session, then request review generation twice concurrently:

```js
const concurrentPlans = await Promise.all([
  postJson(`${apiUrl}/exam/review-tasks/${concurrentSession.id}`, {}, studentHeaders),
  postJson(`${apiUrl}/exam/review-tasks/${concurrentSession.id}`, {}, studentHeaders),
]);
assert.deepEqual(concurrentPlans[0].days, concurrentPlans[1].days, 'concurrent generation must return one stable schedule');
assert(await prisma.studyTask.count({ where: { id: { in: concurrentPlans[0].days.map((day) => day.taskId) } } }) === 3, 'concurrent generation must create exactly three tasks');
```

Expected current failure before hardening: duplicate creation error or divergent schedules.

- [ ] **Step 2: Add no-plan and ownership assertions**

Register a second student, submit a minimal paper session without completing onboarding, and generate review tasks. Assert:

```js
const noPlanUser = await prisma.user.findUnique({ where: { id: noPlanStudent.user.id } });
assert(noPlanUser.onboardingCompletedAt === null, 'plan bootstrap must not mark onboarding complete');
assert(noPlanUser.trialStatus === 'INVITED', 'plan bootstrap must not change trial status');
assert(await prisma.studyPlan.count({ where: { userId: noPlanStudent.user.id, status: 'ACTIVE' } }) === 1, 'review generation must bootstrap one active plan');
await expectPostStatus(`${apiUrl}/exam/review-tasks/${concurrentSession.id}`, {}, 403, noPlanHeaders);
await expectPostStatus(`${apiUrl}/tasks/${concurrentPlans[0].days[0].taskId}/start`, {}, 400, noPlanHeaders);
```

Use the endpoint's established 400 not-found response for a foreign task ID; do not reveal whether the task exists.

- [ ] **Step 3: Add transaction rollback fault injection**

Create a PostgreSQL trigger that fails the second post-exam `StudyTask` insert:

```sql
CREATE OR REPLACE FUNCTION integration_fail_exam_review_task() RETURNS trigger AS $$
BEGIN
  IF NEW."mode" = '考后复盘' AND NEW."id" LIKE '%-day-2' THEN
    RAISE EXCEPTION 'integration post-exam task failure';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER integration_fail_exam_review_task_trigger
BEFORE INSERT ON "StudyTask"
FOR EACH ROW EXECUTE FUNCTION integration_fail_exam_review_task();
```

Call the endpoint, expect HTTP 500, drop the trigger/function, then assert:

```js
assert(await prisma.examReviewPlan.count({ where: { sessionId: rollbackSession.id } }) === 0, 'failed scheduling must not persist the review summary');
assert(await prisma.studyTask.count({ where: { id: { startsWith: `exam-review-${rollbackSession.id}` } } }) === 0, 'failed scheduling must not leave partial tasks');
assert.deepEqual(await readPlanDates(prisma, rollbackStudentId), datesBeforeFailure, 'failed scheduling must roll back displaced dates');
```

Retry after removing the trigger and assert success.

- [ ] **Step 4: Run PostgreSQL integration and fix only observed defects**

Run: `npm run test:integration:postgres`

Expected: FAIL at concurrent generation because two transactions can observe the same pre-insert state.

- [ ] **Step 5: Serialize each user's review-plan transaction**

Make the advisory lock the first statement inside `saveActionablePlan()`'s transaction, before reading the session, active plan, or existing tasks:

```ts
return this.prisma.$transaction(async (tx) => {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.reviewPlan.userId}))`;
  const session = await tx.learningSession.findFirst({
    where: {
      id: input.reviewPlan.examSessionId,
      userId: input.reviewPlan.userId,
      type: 'paper',
      completed: true,
    },
    select: { id: true },
  });
  // Keep the active-plan read, merge, writes, and returned mapping below this lock.
```

The second request then reads the task rows committed by the first request. `mergePostExamTasks()` skips their deterministic IDs, and both requests return the same actual dates. Do not add application-level retries.

- [ ] **Step 6: Re-run integration and verify GREEN**

Run: `npm run test:integration:postgres`

Expected: all concurrency, rollback, bootstrap, authorization, action, and restart assertions pass.

- [ ] **Step 7: Verify restart persistence and local-date behavior**

After the existing API restart in `scripts/integration-postgres.mjs`, assert:

```js
const restoredActionablePlan = await postJson(`${apiUrl}/exam/review-tasks/${concurrentSession.id}`, {}, studentHeaders);
assert.deepEqual(restoredActionablePlan.days, concurrentPlans[0].days, 'restart must preserve the actual scheduled dates');
const restoredTodayPlan = await getJson(`${apiUrl}/today/plan`, studentHeaders);
assert(restoredTodayPlan.weekProgress.every((day) => day.taskCount <= 3), 'restored plan must keep the daily capacity invariant');
```

Expected: review dates remain based on the existing Asia/Shanghai `todayKey()` boundary.

- [ ] **Step 8: Commit Task 3**

```bash
git add scripts/integration-postgres.mjs apps/api/src/study/exam-review-plan.repository.ts apps/api/src/study/study.service.ts
git commit -m "Harden post-exam review scheduling"
```

---

### Task 4: Release Verification and Deployment Commit

**Files:**
- Modify only if verification exposes a directly related defect: files from Tasks 1-3.

**Interfaces:**
- Consumes: all earlier tasks.
- Produces: release evidence for unit, PostgreSQL, API, web, and smoke paths.

- [ ] **Step 1: Run formatting and diff checks**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only intended files and the unrelated untracked content directory are shown.

- [ ] **Step 2: Run the full release suite**

Run:

```bash
npm test
npm run test:integration:postgres
npm run build:api
npm run build:web
npm run smoke:migration
```

Expected: every command exits 0. The integration script prints `{ "ok": true }` and `persistedExamReviewDays: 3`.

- [ ] **Step 3: Inspect the final diff against the design**

Verify all of the following from code and test output:

- Three deterministic review task IDs exist per completed paper.
- Persisted dates match response dates.
- Every date contains at most three tasks.
- Only pending/postponed ordinary tasks move.
- Existing task actions work for review tasks.
- Duplicate, concurrent, rollback, restart, no-plan, and cross-user cases are covered.
- Production code does not create mock review tasks after API failure.

- [ ] **Step 4: Commit any verification-only fixes**

If Step 2 required a directly related fix:

```bash
git add packages/shared/src/postExamScheduling.ts apps/api/src/study/exam-review-plan.repository.ts apps/api/src/study/study.service.ts apps/web/src/api/endpoints/exam.ts scripts/integration-postgres.mjs
git commit -m "Fix post-exam review verification gaps"
```

If no fix was needed, do not create an empty commit.

- [ ] **Step 5: Push the verified branch**

Run:

```bash
git push origin codex/deployment-ready
```

Expected: GitHub accepts the commits and the deployment workflow starts for `codex/deployment-ready`.
