# Phase 2.8.5 Handoff README

## Project Introduction

This repository is a 408 postgraduate exam score-improvement system. It is not a generic question bank. The core product loop is:

login -> diagnostic -> study plan -> practice -> answer grading -> knowledge linkage -> mastery update -> wrong-question review -> weak-point selection -> recommendation -> assessment -> report.

The stack is:

- API: NestJS 10, TypeScript, CommonJS, Prisma, PostgreSQL.
- Web: React 18, Vite, TypeScript.
- Shared domain package: `packages/shared`, used by both API and web.
- Database schema and migrations: `prisma/`.

The current backend migration direction is to split large legacy `StudyService` read paths into CQRS-style:

Projection -> Snapshot -> Selector -> Adapter -> Query/Controller.

## Current Stage

The project is in the Phase 2.8.5 pre-stage.

The immediate architecture target is `OverviewReportSelectorExtraction`:

- `OverviewReportSnapshot` already exists at `apps/api/src/study/overview-report.snapshot.ts`.
- `OverviewReportSelector` exists at `apps/api/src/study/overview-report.selector.ts`
  with contract tests; it is intentionally NOT wired into `StudyService` or
  `StudyController` yet.
- `StudyService.getOverviewReport()` still uses legacy shared `computeWeaknessReport()`.
- `/reports/overview` still calls `StudyService.getOverviewReport()` directly.

The next agent should implement the `OverviewReportAdapter` (legacy `WeaknessReport`
compatibility) before switching the endpoint.

## How To Continue

1. Read this handoff package first.
2. Then read:
   - `docs/PROJECT_CONTEXT.md`
   - `docs/ARCHITECTURE.md`
   - `apps/api/src/study/overview-report.snapshot.ts`
   - `packages/shared/src/learning.ts`
   - `apps/api/src/study/study.service.ts`
3. Implement Phase 2.8.5 in a small, additive way:
   - Create `OverviewReportSelector`.
   - Add focused contract tests.
   - Do not change `StudyService.getOverviewReport()` yet.
   - Do not change `StudyController` yet.
   - Do not change Prisma schema.
4. Preserve legacy `WeaknessReport` compatibility until an adapter migration is explicitly planned.

## Non-Goals

- Do not refactor all of `StudyService`.
- Do not migrate `/reports/overview` in the same step unless explicitly requested.
- Do not introduce recommendation output into the selector.
- Do not persist selector output as facts.
- Do not modify production API response shapes without a compatibility adapter.
