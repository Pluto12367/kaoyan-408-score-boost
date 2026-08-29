# Dependency Map

## Current Legacy Overview Chain

```text
StudyController.getOverviewReport
  -> StudyService.getOverviewReport
      -> getStudent
      -> ensureNodeMasteryFresh
      -> computeWeaknessReport
          -> computeMasteryReport
      -> applyCatalogDisplay
      -> MasterySummaryProjectionService.getProjectionFromRows
      -> toReportMasteryDto
```

Key files:

- `apps/api/src/study/study.controller.ts`
- `apps/api/src/study/study.service.ts`
- `packages/shared/src/learning.ts`
- `packages/shared/src/domain.ts`
- `apps/api/src/study/mastery-summary-projection.service.ts`

## Target Overview Chain

```text
Projection
  -> Snapshot
      -> Selector
          -> Adapter
              -> QueryService
                  -> Controller
```

For Phase 2.8.5, only the Selector is expected.

The first extraction step should look like:

```text
OverviewReportSnapshot
  -> OverviewReportSelector
      -> OverviewReportSelection
```

Do not wire this into controller or service yet unless explicitly requested.

## Current Projection Files

Student state:

- `apps/api/src/study/student-state-projection.service.ts`
- `apps/api/src/study/student-state.snapshot.ts`
- `apps/api/src/study/student-state-query.service.ts`
- `apps/api/src/study/student-state-reminder-query.service.ts`
- `apps/api/src/study/student-state-sprint-plan-query.service.ts`
- `apps/api/src/study/student-state-trial-progress-query.service.ts`
- `apps/api/src/study/student-state-learning-calendar-query.service.ts`

Mastery:

- `apps/api/src/study/mastery-summary-projection.service.ts`
- `apps/api/src/score-center/service.ts`
- `apps/api/src/score-center/repository.ts`
- `packages/shared/src/score-center/mastery.ts`
- `packages/shared/src/nodeMastery.ts`

Practice:

- `apps/api/src/study/practice-projection.service.ts`
- `prisma/schema.prisma` model `PracticeRecord`

Wrong questions:

- `apps/api/src/study/wrong-question-projection.service.ts`
- `apps/api/src/study/wrong-question.snapshot.ts`
- `apps/api/src/study/wrong-question.adapter.ts`
- `apps/api/src/study/wrong-question-query.service.ts`

Dashboard:

- `apps/api/src/study/dashboard-projection.service.ts`
- `apps/api/src/study/dashboard.snapshot.ts`
- `apps/api/src/study/dashboard.adapter.ts`
- `apps/api/src/study/dashboard-query.service.ts`

Today plan:

- `apps/api/src/study/today-plan-projection.service.ts`
- `apps/api/src/study/today-plan.snapshot.ts`
- `apps/api/src/study/today-plan.adapter.ts`
- `apps/api/src/study/today-plan-query.service.ts`

Stage assessment:

- `apps/api/src/study/stage-assessment-projection.service.ts`
- `apps/api/src/study/stage-assessment.snapshot.ts`
- `apps/api/src/study/stage-assessment.selector.ts`
- `apps/api/src/study/stage-assessment.adapter.ts`
- `apps/api/src/study/stage-assessment-query.service.ts`

Overview:

- `apps/api/src/study/overview-report.snapshot.ts`
- Missing: `apps/api/src/study/overview-report.selector.ts`
- Future: `apps/api/src/study/overview-report.adapter.ts`
- Future: `apps/api/src/study/overview-report-projection.service.ts`
- Future: `apps/api/src/study/overview-report-query.service.ts`

## Important Internal Consumers Of Legacy Overview

`StudyService.getOverviewReport()` is used by:

- initial state
- study reminders
- sprint plan
- student learning profile
- admin metrics
- teacher analytics
- recommended practice set
- recommended review resources
- stage assessment

This means the legacy DTO must remain compatible until those consumers are migrated.
