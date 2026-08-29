# Agent Context For Future AI Agent

You are continuing work on a 408 exam score-improvement system.

## Product Goal

The system helps students answer:

1. What knowledge points are weak?
2. Why are mistakes happening?
3. What should be learned next?
4. Which questions should be practiced?
5. Did the student improve over time?

## Current Phase

Current phase: Phase 2.8.5 pre-stage.

Immediate task:

Create `OverviewReportSelector`.

Important current facts:

- `OverviewReportSnapshot` already exists.
- `OverviewReportSelector` exists (pure, contract-tested) and is intentionally not wired yet.
- `StudyService.getOverviewReport()` still serves the legacy report.
- `StudyController.getOverviewReport()` still calls `StudyService.getOverviewReport()` directly.
- The legacy report uses `computeWeaknessReport()` and then optionally overlays `UserKnowledgeMastery` weak points.

Next step: build the `OverviewReportAdapter` for legacy `WeaknessReport` compatibility,
then switch `/reports/overview` to the new chain.

## Forbidden Actions

Do not:

- modify business code unless the user asks for implementation
- change Prisma schema
- change migrations
- refactor `StudyService`
- change controller routes
- change `/reports/overview` response shape
- add recommendation text to selector
- add UI text to selector
- store selector output as facts
- rely on historical chat as fact

Use the current repository as the source of truth.

## Architecture Principles

Use this chain:

```text
StudentFacts / Snapshot
  -> Selector
  -> Adapter
  -> QueryService
  -> Controller
```

For AI:

```text
StudentFacts / Snapshot
  -> Selector
  -> Agent Context Builder
  -> RAG
  -> AI Coach
```

For recommendations:

```text
StudentFacts / Snapshot
  -> Selector
  -> Recommendation Engine
```

Layer responsibilities:

- Snapshot: stable facts only.
- Selector: deterministic selection, ranking, and evidence references.
- Adapter: legacy DTO and presentation compatibility.
- AI Coach: explanation and conversational guidance.
- Recommendation Engine: concrete next actions, tasks, questions, and resources.

## Next Implementation Task

Create:

- `apps/api/src/study/overview-report.selector.ts`

Expected selector behavior:

- input: `OverviewReportSnapshot`
- output: weak point selection, speed risk selection, mistake pattern summary, metadata
- no DB access
- no service dependency
- no UI text
- no recommendation
- deterministic ordering

Suggested pattern:

- follow `apps/api/src/study/stage-assessment.selector.ts`

## Test Expectations

Add contract tests for:

- empty snapshot
- weak point ranking
- speed risk ranking
- mistake reason counting
- stable tie-breaking
- absence of recommendation/UI fields

Run:

```bash
npm test
npm run build:api
```

Run `npm run build:web` if shared or frontend-visible types change.

Run `npm run test:integration:postgres` if Prisma-backed projection/query behavior changes.
