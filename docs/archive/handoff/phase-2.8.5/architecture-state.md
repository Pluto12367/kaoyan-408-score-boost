> **ARCHIVED / HISTORICAL / SUPERSEDED — DO NOT USE AS A CURRENT RULE SOURCE.**
> Phase 2.8.5 handoff material (2026-08-30). Facts here may be obsolete and some
> instructions are known to be wrong (see `README.md` in this directory).
> Current rules: repository root `AGENTS.md`.
> Current status: `docs/current-sprint.md`.
# Architecture State

## Overall Architecture

The repository is a monorepo:

- `apps/api`: NestJS API.
- `apps/web`: React/Vite frontend.
- `packages/shared`: shared domain types and pure functions.
- `prisma`: PostgreSQL schema and migrations.

The API is gradually moving from legacy service-heavy read methods toward CQRS-style read models. The intended read architecture is:

Projection -> Snapshot -> Selector -> Adapter -> QueryService -> Controller.

`StudyService` remains a large legacy orchestration service and still owns many write paths and legacy read paths.

## CQRS Migration State

Already migrated or partially migrated read paths include:

- Dashboard read path:
  - `dashboard-projection.service.ts`
  - `dashboard.snapshot.ts`
  - `dashboard.adapter.ts`
  - `dashboard-query.service.ts`
- Assessment history:
  - `assessment-history-projection.service.ts`
  - `assessment-history.snapshot.ts`
  - `assessment-history.adapter.ts`
  - `assessment-history-query.service.ts`
- Exam score history:
  - `exam-score-history.projection.service.ts`
  - `exam-score-history.snapshot.ts`
  - `exam-score-history.adapter.ts`
  - `exam-score-history.query.service.ts`
- Wrong question query:
  - `wrong-question-projection.service.ts`
  - `wrong-question.snapshot.ts`
  - `wrong-question.adapter.ts`
  - `wrong-question-query.service.ts`
- Today plan read model:
  - `today-plan-projection.service.ts`
  - `today-plan.snapshot.ts`
  - `today-plan.adapter.ts`
  - `today-plan-query.service.ts`
- Stage assessment selector pattern:
  - `stage-assessment.snapshot.ts`
  - `stage-assessment.selector.ts`
  - `stage-assessment.adapter.ts`

Still legacy:

- `StudyService.getOverviewReport()`
- `GET /reports/overview`
- Multiple internal `StudyService` consumers that use `getOverviewReport()`.

## StudentFacts Design

The future StudentFacts direction is to keep stable student facts separate from selection, recommendation, and UI formatting.

Recommended conceptual structure:

```ts
interface StudentFactsSnapshot {
  userFacts: unknown;
  practiceFacts: unknown;
  masteryFacts: unknown;
  wrongQuestionFacts: unknown;
  assessmentFacts: unknown;
  taskFacts: unknown;
}
```

Facts must be derived from canonical sources such as:

- `User`
- `PracticeRecord`
- `UserKnowledgeMastery`
- `WrongQuestionReview`
- `ReviewSchedule`
- `ReviewAttempt`
- `StudyPlan`
- `StudyTask`
- `StudyTaskProgress`
- `AssessmentHistoryItem`

Facts must not contain:

- UI copy.
- recommendation text.
- next actions.
- selector outputs.
- prompt/RAG content.

## OverviewReportSnapshot Design

`apps/api/src/study/overview-report.snapshot.ts` defines the current Overview report facts contract.

It contains:

- `goalFacts`
- `practiceFacts`
- `knowledgePointFacts`
- `masteryFacts`

It explicitly must not contain:

- `nextAction`
- `reason`
- UI copy
- DTO formatting
- selector results such as `weakPoints` or `speedRisks`
- database/repository/service access

Important limitation: the current snapshot does not include `wrongQuestionFacts`. Mistake pattern summary for Phase 2.8.5 should therefore be based on `practiceFacts.records[].mistakeReason`, unless a later phase extends the snapshot.

## Projection System

Current projections relevant to Overview migration:

- `MasterySummaryProjectionService`
  - Reads or receives `UserKnowledgeMastery` rows.
  - Builds mastery summary and weak mastery node facts.
  - Also contains legacy compatibility helpers such as `toReportMasteryDto`.
- `PracticeProjectionService`
  - Reads `PracticeRecord` and `LearningSession`.
  - Produces practice count, correct count, accuracy, duration, records.
- `StudentStateProjectionService`
  - Builds a broader student-state snapshot from user, mastery, wrong question, review, task, and assessment facts.
- `WrongQuestionProjectionService`
  - Builds wrong-question facts from practice records, wrong-question reviews, review schedules, attempts, questions, and knowledge points.
- `DashboardProjectionService`
  - Composes other projections for dashboard use.
  - Should not be treated as a canonical fact source for Overview.

## Current Overview Implementation

`StudyService.getOverviewReport()` currently does:

1. Resolve user.
2. Refresh node mastery cache if needed.
3. Call shared `computeWeaknessReport()` using legacy `KnowledgePoint` and in-memory `PracticeRecord` data.
4. Apply catalog display mapping.
5. If `MasterySummaryProjectionService` exists, replace weak points with `UserKnowledgeMastery`-derived weak points through `toReportMasteryDto()`.
6. Return the legacy `WeaknessReport` shape.

This is a mixed read model and should be split carefully.
