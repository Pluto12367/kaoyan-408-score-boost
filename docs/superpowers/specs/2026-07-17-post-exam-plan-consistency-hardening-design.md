# Post-Exam Plan Consistency Hardening Design

## Goal

Close the cross-module defects found in the final review of actionable post-exam tasks. Review
generation, onboarding plan replacement, and task lifecycle mutations must observe one serialized
per-user plan state. Review tasks must retain their identity, every date must stay at three tasks or
fewer, and every response must reflect the state actually committed to PostgreSQL.

## Scope

This hardening changes only the existing onboarding/study-plan repositories, study service behavior,
post-exam repository, and PostgreSQL integration coverage. It does not add a Prisma migration, a
second task lifecycle, application retries, or a new frontend workflow.

## Shared Serialization

All PostgreSQL operations that can change an active study plan use the same transaction-scoped lock:

```sql
SELECT pg_advisory_xact_lock(hashtext(userId))
```

The lock is the first statement in each transaction that performs one of these operations:

- create or replace the active onboarding plan;
- generate and merge post-exam review tasks;
- start a scheduled task;
- postpone a scheduled task;
- complete a scheduled task and adapt a future ordinary task.

After acquiring the lock, each operation reloads the active plan or owned task from PostgreSQL. It
does not write a full task object captured before the lock. Only fields owned by that operation are
updated. This prevents a stale lifecycle request from restoring a displaced date or a stale review
generation request from overwriting a newly protected status.

The API service updates its in-memory plan cache only after the transaction succeeds, using the task
or plan state returned by the repository. Memory mode keeps the same observable rules through a
per-user in-process mutation queue around onboarding, generation, start, postpone, and completion.

## Lifecycle Operations

`OnboardingPlanRepository` replaces the generic read-then-full-write `saveTask()` path with focused
transactional mutations:

- `startTask()` updates only status, `startedAt`, and `nextAvailableAt`;
- `postponeTask()` computes the nearest later date with fewer than three tasks while holding the
  lock, updates only scheduling/postpone fields, and extends beyond the current plan range when
  necessary;
- `completeTask()` updates completion fields and may adapt the nearest future ordinary task with the
  same knowledge point in the same transaction.

Adaptive completion must never select a task whose mode is `考后复盘` or whose ID starts with
`exam-review-`. A review task's mode, question count, reason, next action, knowledge point, and
deterministic identity remain unchanged when another review task is completed.

Onboarding replacement takes the same lock before user updates, active-plan archival, or new-plan
creation. The returned plan becomes the service cache only after commit.

## Post-Exam Response Truth

`ExamReviewPlanRepository` keeps its existing locked merge transaction, but the shared upsert helper
returns the persisted `ExamReviewPlan` row. The repository maps `generatedAt` from the row's
`createdAt`, rather than returning a caller-specific draft timestamp.

For concurrent generation:

1. the first request commits the deterministic tasks and summary;
2. the second request acquires the lock and reloads that committed state;
3. both responses contain the same complete summary, including `generatedAt`;
4. both service cache writes use the same persisted value.

Existing deterministic review task rows retain their lifecycle status and scheduled date.

## Capacity Rules

The invariant is global for active study plans: no date may contain more than three tasks.

- Review generation continues to use `mergePostExamTasks()`.
- Postponement selects only a later date with a current count below three.
- If all existing later dates are full, the operation advances one UTC date at a time beyond the
  latest scheduled date until capacity is available.
- In-progress, completed, and review tasks remain protected from review-generation displacement.

## Error Handling

- Missing or foreign active-plan tasks keep the existing non-disclosing not-found behavior.
- A completed task cannot be started or postponed.
- Impossible protected over-capacity input still fails the review-generation transaction and leaves
  cache and database state unchanged.
- Repository errors propagate; service caches are not changed on failure.
- No automatic retry hides serialization or optimistic-conflict defects.

## Verification

PostgreSQL integration coverage adds:

1. A one-knowledge-point exam where completing day 1 leaves day 2 and day 3 review identity and
   content unchanged.
2. Postponement onto consecutive full dates, proving the selected date has at most three tasks and
   the plan extends when required.
3. Full equality of concurrent review responses and the persisted summary, including
   `generatedAt`.
4. Review generation racing independently with task start, postpone, completion, and onboarding
   replacement. The committed result must preserve status, capacity, ownership, and exactly one
   active plan.
5. An exact Today Plan projection check: a test fixture places one generated review task on the
   current Asia/Shanghai study date, restarts the API, and asserts that `/today/plan` exposes that
   exact `taskId`, `mode`, date, and no answer-key data.

The release gate remains:

```powershell
npm test
npm run test:integration:postgres
npm run build:api
npm run build:web
npm run smoke:migration
git diff --check
```

## Acceptance Criteria

- All active-plan mutations share the same per-user serialization contract.
- No lifecycle request can restore a stale date or overwrite unrelated task fields.
- Review tasks retain their identity and content through completion adjustments.
- Start, completion, postponement, onboarding, and review generation preserve the three-task limit.
- Concurrent review responses equal each other and the persisted summary.
- The exact generated review task can be observed in Today Plan on its scheduled study date.
- All release commands pass with no new production warnings or schema migration.
