# Phase Status

## Completed Or Partially Completed Phases

The following read-path migrations are present in code:

- Dashboard read path.
- AssessmentHistory read path.
- ExamScoreHistory read path.
- WrongQuestion query read path.
- TodayPlan read path.
- StageAssessment selector pattern.
- OverviewReport selector (Phase 2.8.5 first extraction step).

The following foundations are present:

- `StudentStateSnapshot`
- `StudentStateProjectionService`
- `OverviewReportSnapshot`
- `OverviewReportSelector` (pure selection over the snapshot, with contract tests
  in `test/overview-report-selector.test.js` and
  `test/overview-report-snapshot-contract.test.js`)
- `MasterySummaryProjectionService`
- `PracticeProjectionService`
- `WrongQuestionProjectionService`

## Current Phase

Current phase: Phase 2.8.5 first extraction step is DONE (as of 2026-08-29).

State:

- `apps/api/src/study/overview-report.selector.ts` exists and is pure
  (no DB / repository / service / UI / recommendation access).
- The selector is intentionally NOT wired into `StudyService` or
  `StudyController` yet.
- `StudyService.getOverviewReport()` is still the active legacy path for
  `GET /reports/overview`.

## Unfinished Tasks

Remaining Phase 2.8.5+ work:

1. Build an `OverviewReportAdapter` for legacy `/reports/overview` DTO
   compatibility (`WeaknessReport` fields must be preserved).
2. Switch `/reports/overview` from `StudyService` to
   Projection -> Snapshot -> Selector -> Adapter -> QueryService.
3. Migrate the ~10 internal `StudyService.getOverviewReport()` consumers
   (reminders, sprint plan, today plan, recommendations, stage assessment,
   profile, admin metrics, teacher analytics) away from the legacy
   `WeaknessReport`.
4. Keep legacy `/reports/overview` response shape byte-compatible until all
   consumers are migrated.
