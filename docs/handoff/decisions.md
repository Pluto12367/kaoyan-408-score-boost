# Architecture Decisions

## Decision 1: Snapshot Stores Facts Only

Snapshots are read-only fact contracts.

They may contain stable facts and deterministic factual aggregates. They must not contain:

- selector results
- UI copy
- recommendations
- next actions
- prompt text
- RAG chunks
- service/repository/database access

This is already documented in `overview-report.snapshot.ts`, `student-state.snapshot.ts`, and `wrong-question.snapshot.ts`.

## Decision 2: Selector Performs Selection Only

`OverviewReportSelector` should select and rank facts.

Allowed output:

- selected weak point candidates
- selected speed risk candidates
- mistake pattern summary
- rank
- score
- evidence IDs
- selection metadata

Forbidden output:

- `nextAction`
- `suggestion`
- `recommendation`
- UI labels
- UI descriptions
- action anchors
- learning-plan text

## Decision 3: Adapter Owns Legacy Compatibility

Legacy clients currently depend on `WeaknessReport`.

Fields such as `summary`, `estimatedGain`, `suggestion`, and legacy `knowledgePointId` compatibility should be handled by an adapter, not by the selector or snapshot.

## Decision 4: UserKnowledgeMastery Is The Direction For Mastery

Future mastery facts should primarily come from `UserKnowledgeMastery`.

Legacy `computeMasteryReport()` computes mastery-like values from `PracticeRecord`, but this is not the long-term canonical mastery source.

## Decision 5: Practice Facts Are Evidence, Not Mastery

`PracticeRecord` supports:

- attempts
- correct/wrong counts
- accuracy
- slow answer detection
- mistake reason statistics

It should not become the long-term canonical mastery state once `UserKnowledgeMastery` is available.

## Decision 6: RAG Is Downstream Of Selection

RAG should not be used to decide student facts.

The correct sequence is:

StudentFacts -> Selector -> Agent Context Builder -> RAG enrichment -> AI Coach.

## Decision 7: Recommendation Engine Is Downstream Of Selection

Selector answers "what is important".

Recommendation Engine answers "what should the student do next".

Do not mix these responsibilities.

## Decision 8: Do Not Break Legacy DTOs During Extraction

Phase 2.8.5 should be additive.

Do not change:

- `/reports/overview` response shape
- `StudyService.getOverviewReport()`
- `StudyController.getOverviewReport()`
- Prisma schema

until the compatibility adapter and tests are ready.
