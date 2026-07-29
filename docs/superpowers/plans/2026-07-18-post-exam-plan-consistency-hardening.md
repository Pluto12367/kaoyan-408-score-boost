# Post-Exam Plan Consistency Hardening Implementation Plan

**Goal:** Make post-exam review tasks remain truthful, capacity-safe, and race-safe across task
lifecycle changes and onboarding plan replacement.

**Architecture:** All active-plan mutations use the same PostgreSQL advisory lock and reload state
inside the locked transaction. The service serializes memory/cache mutations per user. Repository
methods update only fields owned by the requested operation and return persisted state for cache
replacement.

**Tech Stack:** TypeScript, NestJS 10, Prisma 5, PostgreSQL 16, Node.js test runner

## Global Constraints

- Use strict TDD: add the focused failing assertion before each production fix.
- No Prisma migration, application retry loop, second task lifecycle, or frontend-only workaround.
- Preserve existing endpoint status codes and non-disclosing ownership behavior.
- Never touch or commit `kaoyan-408-content-starter/`.
- Run PostgreSQL commands with approved elevation when Windows sandboxing raises `EPERM`.

---

## Task 1: Persisted Summary Truth And Review Identity

**Files:**

- Modify `apps/api/src/study/exam-review-plan.repository.ts`.
- Modify `apps/api/src/study/study.service.ts`.
- Modify `scripts/integration-postgres.mjs`.

### RED

Extend the existing concurrent generation case to assert:

- both complete responses are deeply equal, not only `days`;
- both `generatedAt` values equal persisted `ExamReviewPlan.createdAt`;
- the response remains equal after API restart.

Add a one-knowledge-point lifecycle assertion:

- snapshot day 2 and day 3 review rows;
- complete day 1 through the normal endpoint;
- assert day 2 and day 3 retain ID, mode, question count, reason, next action, knowledge point, and
  scheduled date.

Run `npm run test:integration:postgres`. Expected RED is a concurrent `generatedAt` mismatch and/or a
future review row changed to adaptive ordinary training.

### GREEN

- Make `upsertExamReviewPlan()` return the upserted row.
- Map `ExamReviewPlanState.generatedAt` from the persisted row's `createdAt`.
- Return this mapped persisted summary from `saveActionablePlan()`.
- When selecting an adaptive future task after completion, exclude `mode === '考后复盘'` and IDs
  beginning with `exam-review-`.

Run:

```powershell
npm run test:integration:postgres
npm run build:api
git diff --check
```

Commit: `Preserve post-exam task identity`

---

## Task 2: Locked Field-Level Task Lifecycle And Capacity

**Files:**

- Modify `apps/api/src/study/onboarding-plan.repository.ts`.
- Modify `apps/api/src/study/study.service.ts`.
- Modify `scripts/integration-postgres.mjs`.

### Repository Contract

Replace scheduled-task uses of the full-object `saveTask()` path with focused methods:

```ts
startTask(userId: string, taskId: string, startedAt: string)
postponeTask(userId: string, taskId: string)
completeTask(userId: string, taskId: string, completedAt: string, adjustment: FutureTaskAdjustment)
```

Each PostgreSQL method:

1. opens a transaction;
2. acquires `pg_advisory_xact_lock(hashtext(userId))` as its first statement;
3. reloads the owned task and active plan;
4. validates current persisted status;
5. updates only fields owned by that operation;
6. returns mapped persisted task state.

`completeTask()` updates the completed row and, in the same transaction, optionally adapts the nearest
future ordinary task with the same knowledge point. It excludes review mode and deterministic review
IDs.

`postponeTask()` chooses the nearest later date containing fewer than three tasks. If every later date
is full, it advances from the latest scheduled UTC date until a free date exists. It increments the
persisted postpone count rather than trusting cache state.

### Service Cache Serialization

Add a small per-user promise queue in `StudyService` and run these complete service operations through
it:

- `startTask`;
- `postponeTask`;
- `completeStudyTask`;
- `completeOnboarding`;
- `generatePostExamReviewTasks`.

Memory mode performs its existing mutation inside the same queue. PostgreSQL mode replaces matching
cache rows only after repository success.

### RED

Add capacity and lifecycle races:

- postpone onto three consecutive full dates and assert extension plus every date `<= 3`;
- race review generation independently with start, postpone, and complete;
- assert the final persisted task status/date matches the lifecycle response and every date remains
  `<= 3`.

Run `npm run test:integration:postgres`. Expected RED is a four-task date or stale field/date overwrite.

### GREEN

Implement the focused repository methods and service queue, then run:

```powershell
npm run test:integration:postgres
npm run build:api
git diff --check
```

Commit: `Serialize study task lifecycle`

---

## Task 3: Onboarding Replacement Under The Shared Lock

**Files:**

- Modify `apps/api/src/study/onboarding-plan.repository.ts`.
- Modify `apps/api/src/study/study.service.ts`.
- Modify `scripts/integration-postgres.mjs`.

### Required Behavior

`saveOnboarding()` acquires the same user advisory lock before reading or writing user/plan state and
returns the persisted active `SevenDayPlanState`.

If a pre-onboarding fallback plan already contains review tasks:

1. load its non-completed review tasks while locked;
2. merge them into the newly generated ordinary plan with `mergePostExamTasks()`;
3. archive old active plans and create exactly one new active plan with the merged schedule;
4. update affected `ExamReviewPlan.days[].date` JSON values in the same transaction;
5. return the persisted merged plan for the service cache.

This makes either race order valid:

- onboarding first: review generation uses the new plan;
- review generation first: onboarding carries review tasks into the replacement plan.

### RED

For a fresh student with a completed paper but no onboarding, race review generation and onboarding.
Assert:

- exactly one active plan;
- exactly three deterministic review rows belong to that active plan;
- response summary dates equal the active task dates;
- no date exceeds three tasks;
- onboarding profile/trial changes occur exactly once.

Expected RED before the fix: review rows remain on an archived plan or disappear from the new plan.

### GREEN

Implement the locked carry-over and summary-date update. Run integration, API build, and diff check.

Commit: `Preserve reviews across onboarding`

---

## Task 4: Exact Today Plan Projection And Regression Completion

**Files:**

- Modify `scripts/integration-postgres.mjs`.
- Modify production files only if this test reveals a directly related defect.

### Test Fixture

Use a dedicated generated review plan. In one test-only Prisma transaction:

- move one generated review task to the current Asia/Shanghai study date;
- keep the date at no more than three tasks;
- update the matching `ExamReviewPlan.days` JSON date;
- restart the API so caches reload from PostgreSQL.

Call `/today/plan` and assert:

- `priorityTasks` contains the exact deterministic review `taskId`;
- mode is `考后复盘`;
- scheduled date is the controlled current date;
- no answer-key fields are present;
- every week-progress date has at most three tasks.

Also retain all prior duplicate, rollback, restart, no-plan, and cross-user assertions.

Run `npm run test:integration:postgres`.

Commit test changes with the closest preceding production task; do not create an empty commit.

---

## Task 5: Release Verification And Final Review

Run fresh:

```powershell
git diff --check 9ecd3a7..HEAD
npm test
npm run test:integration:postgres
npm run build:api
npm run build:web
npm run smoke:migration
```

Acceptance audit:

- review task identity survives completion adjustment;
- postpone and all races preserve the three-task limit;
- all plan mutations share the user lock;
- onboarding race leaves one active plan containing the review rows;
- concurrent full responses equal persisted state;
- exact review task appears in Today Plan;
- no schema migration, retries, second lifecycle, or production mock fallback was added.

Request a final broad review across the full feature diff. Fix every Critical or Important finding,
rerun the complete release suite, and only then proceed to branch integration.
