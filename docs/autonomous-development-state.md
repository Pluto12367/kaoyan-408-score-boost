# Learning Intelligence Platform — Autonomous Development State

Updated: 2026-09-05. This milestone ledger supplements `current-sprint.md`, the repository entry point. Recover from this file after context compaction.

## Current Milestone
Learning Intelligence Platform — Full Learning Loop Hardening. **IN PROGRESS; previous COMPLETE declaration is not accepted evidence.**

## Current Phase
Phase 2: event/state consistency and recovery. Phase 1 takeover audit found material differences from prior report; correction section is in `learning-intelligence-loop-audit.md`.

## Completed Phases
Phase 1 initial entry/transaction/refresh audit complete; remaining per-domain depth is tracked in subsequent phases. Existing Phase 1–12 documents are inputs, not proof of completion.

## In Progress
- Review cache failure fix: 3 RED -> 3 GREEN; related regression 40/40 PASS. Changed only `StudyService.reportWrongReason` cache publication order, plus new `test/learning-intelligence-review-recovery.test.js`.
- Review atomicity: added failing mastery-write test, then grouped ReviewAttempt/Schedule/WrongQuestionReview and existing ScoreCenter.applyReview under shared transaction. 34/34 related tests PASS; real database failure injection still pending.
- Direct stage-assessment feedback: RED confirmed no trigger; minimal existing-trigger call after result now passes 13/13 with LearningLoop regression.
- API startup DI: real Nest context reproduced Object injection failure. Explicit LearningSessionRepository token fixed; 16/16 related tests PASS. Full integration now boots API.
- Follow up review mastery atomicity, direct assessment trigger, and hook freshness.
- PostgreSQL full integration running against temporary compose test database.

## Pending
1. Phase 1: correct `learning-intelligence-loop-audit.md` from implementation evidence.
2. Phase 2: correct event/state matrix; reproduce missing transitions before fixes.
3. Phase 3: verify Practice/Review/Task/Plan/Action identities and retry semantics.
4. Phase 4: verify canonical mastery updates and document fallback semantics.
5. Phase 5: verify generation consistency and update recommendation audit.
6. Phase 6: verify task completion changes state and subsequent recommendation inputs.
7. Phase 7: verify due/overdue/completed/failed review feedback.
8. Phase 8: verify request ordering, auth changes and timestamp provenance.
9. Phase 9: reproduce partial failure/retry/order failures; apply compatible TDD fixes.
10. Phase 10: measure selector CPU, UTF-8 payload, query counts/durations where runnable; distinguish fixture measurements from database measurements.
11. Phase 11: targeted regression and full npm test.
12. Phase 12: update architecture with actual before/after and limitations.
13. Phase 13: npm test, build:api, build:web, PostgreSQL integration, Git scope verification.
14. Phase 14: final report covering all 20 requested sections; COMPLETE only if all DoD gates pass.

## Blocked
Default sandbox node:test = spawn EPERM; escalated execution works. Docker 29.2.0 works escalated; compose fixture started healthy. **D4-B4 now PASS** (`generation-integration.log`: one plan, two tasks/actions, one event, zero rollback artifacts). ENV-005 is lifted for this fixture. Full PostgreSQL regression currently FAIL at `scripts/integration-postgres.mjs:1254`, target-date three-task fixture assumption, investigation pending.

## Architecture Decisions
Keep existing sources of truth and read-only StudentContext. No schema/migration/engine redesign, Git writes, or protected theme-file edits. Any necessary breaking decision gets an ADR; independent work continues.

## Known Risks
- Existing report calls 1477 passing / 25 failing tests PASS; this violates the requested DoD.
- Existing reports claim bounded reads and no freshness gaps; current code still reads practice history and hook has overlapping async requests. Verify before accepting conclusions.
- Large dirty working tree belongs to multiple existing workstreams; only task-specific deltas will be changed.

## Next Task
Correct transition matrix and identity conclusions; reproduce review mastery failure and direct assessment missing trigger. Then proceed through remaining phases without waiting for user continuation.

## Last Validation
- `npm test` escalated baseline: 1504 tests, 1477 pass, 25 fail, 2 skip. Log `qa/learning-intelligence/baseline-tests-unsandboxed.log`. These failures existed before takeover code changes; not yet all classified or cleared.
- Review RED: 3 expected assertion failures, log `review-recovery-red.log`.
- Review GREEN: 3/3, log `review-recovery-green.log`.
- `node --test test/learning-intelligence-review-recovery.test.js test/action-feedback-trigger.test.js test/wrong-question-lifecycle.test.js test/review-action-attribution.test.js`: 40/40 PASS, log `review-regression.log`.
- No final build/full regression success claimed yet.
