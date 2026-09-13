> **ARCHIVED / HISTORICAL / SUPERSEDED — DO NOT USE AS A CURRENT RULE SOURCE.**
> Phase 2.8.5 handoff material (2026-08-30). Facts here may be obsolete and some
> instructions are known to be wrong (see `README.md` in this directory).
> Current rules: repository root `AGENTS.md`.
> Current status: `docs/current-sprint.md`.
# Current Tasks

## Phase 2.8.5: OverviewReportSelectorExtraction

Primary task:

Create `OverviewReportSelector`.

Expected location:

- `apps/api/src/study/overview-report.selector.ts`

Use `stage-assessment.selector.ts` as the nearest local pattern.

## Required Scope

The selector should:

- Accept `OverviewReportSnapshot`.
- Return a deterministic selection result.
- Select weak points.
- Select speed risks.
- Summarize mistake patterns.
- Include ranks, scores, evidence IDs, and source metadata.

The selector must not:

- access Prisma
- access repositories
- inject services
- generate UI text
- generate recommendations
- mutate the snapshot
- call `StudyService`

## Keep Unchanged In This Phase

Do not modify:

- `StudyService.getOverviewReport()`
- `StudyController.getOverviewReport()`
- `/reports/overview` behavior
- Prisma schema
- database migrations
- business logic in `computeWeaknessReport()`

## Add Contract Tests

Add focused tests for:

- empty snapshot returns empty selections
- weak point selection ranks by deterministic priority
- speed risk selection uses slow answer evidence
- mistake pattern summary counts and sorts reasons
- selector does not require service/database setup
- ID semantics are explicit when knowledge point IDs and knowledge node IDs coexist

Suggested test location:

- Existing `test/` convention should be followed.
- Search current selector tests before adding a new file.

## Suggested Selector Output

The output should include:

- `weakPointSelection`
- `speedRiskSelection`
- `mistakePatternSummary`
- `meta`

It should not include:

- `suggestion`
- `nextAction`
- `recommendation`
- `summary`
- `actionText`
- `actionAnchor`
