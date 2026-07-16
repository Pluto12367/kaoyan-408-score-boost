# Actionable Post-Exam Review Tasks Design

## Goal

Turn the existing three-day post-exam review plan into real tasks in the student's Today Plan. The tasks must use the same start, complete, postpone, persistence, and authorization behavior as ordinary study tasks.

This change extends the current Stage 6 mock-exam workflow. It does not redesign the full seven-day planning algorithm or the exam timer.

## User Outcome

After submitting a paper, the student receives one high-priority review task on each of the next three local calendar days (`D+1`, `D+2`, and `D+3`). Each task appears in Today Plan on its scheduled date and can be started, completed, or postponed like any other study task.

Today Plan continues to contain at most three tasks per day. A post-exam task takes priority over an ordinary task, but never moves a task that is already in progress or completed.

## Chosen Approach

Materialize every review day as a normal `StudyTask` in the student's active `StudyPlan`.

The alternatives were rejected for the following reasons:

- Keeping actionable tasks only inside `ExamReviewPlan.days` would require a second task lifecycle and duplicate the existing action endpoints.
- Overlaying transient tasks in the frontend would not support reliable persistence, cross-device use, or rescheduling.

`ExamReviewPlan` remains the immutable, report-facing summary of why the tasks were generated. `StudyTask` becomes the operational representation used by Today Plan.

## Task Shape and Traceability

One `StudyTask` is created for each review-plan day. The task uses:

- A deterministic ID: `exam-review-${sessionId}-day-${dayIndex}`.
- The selected weak point's `knowledgePointId`, subject, and title.
- `mode: "考后复盘"`.
- High priority.
- The existing question and minute targets: 15/90, 12/60, and 8/45.
- A reason that identifies the source exam and its accuracy.
- A next action that summarizes the review steps already stored in `ExamReviewPlan.days`.

The deterministic ID makes generation idempotent and provides an explicit link back to the exam session without adding another database migration in this iteration.

`knowledgePointLosses` and `ExamReviewPlan.days` must retain `knowledgePointId`. If an exam has no detected loss, the task uses the highest-priority available 408 knowledge point. If no knowledge point exists, plan generation fails with a clear module error instead of creating an invalid `StudyTask`.

## Active Plan Handling

If the student has an active seven-day plan, review tasks are merged into it.

If no active plan exists, the service creates a normal seven-day plan from the student's current profile and diagnostic data through a plan-only repository operation. This operation must not set `onboardingCompletedAt`, change trial status, or otherwise claim that onboarding was completed.

The newly created or existing plan is the only active plan modified by the merge.

## Scheduling Rules

The initial target dates are the next three consecutive local calendar days after submission: `D+1`, `D+2`, and `D+3`.

For each review task, in day order:

1. Insert the review task on its target date when the date has fewer than three tasks.
2. If the date already has three tasks, select the lowest-priority ordinary task that is still `pending` or `postponed`.
3. Move that ordinary task to the nearest later date with capacity, then insert the review task.
4. If the moved task causes another date to exceed capacity, repeat the same displacement rule until every date contains at most three tasks.
5. Extend the plan beyond its original seven-day window when no existing date has capacity.

The scheduler never moves:

- A task with status `in_progress` or `completed`.
- Another post-exam review task.

If a target date contains three protected tasks, the review task moves to the nearest later date with capacity. Its persisted and displayed date must be the actual date selected by the scheduler.

When ordinary tasks have the same priority, the task with the latest original position is displaced first. This preserves the earlier learning sequence as much as possible.

## Transaction and Cache Consistency

The repository gains one focused operation that ensures an active plan, inserts the three deterministic review tasks, and applies all required date changes in one PostgreSQL transaction.

The transaction must:

- Verify that the exam session belongs to the authenticated student.
- Lock or otherwise serialize modifications to the active plan.
- Treat existing deterministic task IDs as an idempotent success.
- Reject task IDs that exist under another user or plan.
- Commit all insertions and shifts together.

The service updates `sevenDayPlansByUser` and `examReviewPlans` only after the database transaction succeeds. On failure, the existing in-memory and persisted plans remain unchanged. After a concurrent conflict, the losing request reloads and returns the committed plan.

Memory-only development mode applies the same scheduling function to a cloned plan and replaces the cache only after the operation succeeds.

## API and Frontend Behavior

The existing post-exam review generation endpoint remains idempotent. Its response includes the review summary plus the actual scheduled task IDs and dates.

No second Today Plan section is introduced. Review tasks appear in the existing priority task list with the `考后复盘` mode label. Existing task start, complete, and postpone endpoints continue to operate because the review tasks are normal owned `StudyTask` rows.

Completing a review task contributes to the same daily completion metrics as an ordinary task. Postponing it uses the existing postpone behavior; the initial generation priority does not prevent an explicit student postponement.

## Error Handling

- Missing or foreign exam sessions return the existing not-found or forbidden response.
- Missing knowledge-point content returns a clear generation error and creates no partial plan.
- Database failures roll back task insertion and all displaced dates.
- The frontend shows the module error and offers retry; it does not fabricate review tasks or switch to mock data in staging or production.
- A repeated successful request returns the persisted task schedule without changing dates again.

## Tests and Acceptance Criteria

Unit tests cover the pure scheduling rules:

- Insert on `D+1`, `D+2`, and `D+3` when capacity exists.
- Keep every date at three tasks or fewer.
- Displace the lowest-priority pending ordinary task.
- Preserve in-progress, completed, and existing review tasks.
- Cascade displacement and extend the plan when required.
- Move the review task when all target-date tasks are protected.
- Produce deterministic, idempotent task IDs.

PostgreSQL integration tests cover:

- Task and `knowledgePointId` persistence across API restart.
- Start, complete, and postpone actions on a generated review task.
- Generation for a student without an active plan without marking onboarding complete.
- Duplicate and concurrent generation.
- Transaction rollback after an injected failure.
- Student A cannot generate, read, or modify Student B's review tasks.
- Dates follow the application's local study-date boundary.

Frontend/API smoke coverage verifies that a submitted paper can generate a review plan, that the scheduled task appears in Today Plan on its actual date, and that the response exposes no answer-key data.

The feature is accepted when one complete exam submission produces three persistent, actionable review tasks with no day exceeding three tasks, and the behavior remains correct after restart and retry.

## Out of Scope

- Changing the 180-minute timer semantics or adding automatic submission.
- Redesigning the exam-paper blueprint.
- Changing the spaced-repetition algorithm for individual wrong questions.
- Adding notifications, calendar integrations, or a separate post-exam dashboard.
- Rebuilding the entire planning engine beyond the conflict rules required here.
