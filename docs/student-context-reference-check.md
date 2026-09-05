# StudentContext Reference Check

**Status:** `STUDENT CONTEXT REFERENCE GATE = PASS`  
**Architecture decision:** Option B — Dedicated Canonical Composition Boundary  
**Date:** 2026-09-03

## Scope and decision context

This document records the engineering reference check for the approved
`StudentContext` design. It is a design/reference gate only. It does not
introduce the TypeScript contract, selector, query service, API route,
database change, consumer migration, or UI change.

The approved direction is:

```text
Existing source facts / read projections
                ↓
StudentContextQueryService
                ↓
buildStudentContext(sourceFacts)
                ↓
Canonical StudentContext v1
                ↓
Future Frontend / Recommendation / AI Coach
```

`StudentContext` is a read-only, derived, deterministic context. It is not a
new source of truth and it must not write facts, mutate mastery, create a
recommendation action, create a study task, or emit a user event.

## 1. References

| Reference | Link | Relevant architecture location | Pattern used for this decision |
| --- | --- | --- | --- |
| Microsoft Azure Architecture Center — CQRS pattern | [CQRS Pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs) | Command/write side versus query/read side | Keep StudentContext on a query boundary; return a stable DTO and keep writes outside the context path. |
| Martin Fowler — CQRS | [CQRS](https://martinfowler.com/bliki/CQRS.html) | Separate update and display models | Use a separate display-oriented composition model only where it reduces consumer coupling; do not replace the domain write model globally. |
| Microsoft Azure Architecture Center — Materialized View pattern | [Materialized View pattern](https://learn.microsoft.com/en-us/azure/architecture/patterns/materialized-view) | Read-only view composed from one or more normalized stores | Compose existing facts into a rebuildable read model; keep freshness explicit and avoid a persisted materialized table until scale requires it. |
| OpenTelemetry — Context specification | [OpenTelemetry Context specification](https://opentelemetry.io/docs/specs/otel/context/) | Explicit execution-scoped context propagation | Treat context as immutable and explicit. Inputs such as `userId`, `asOf`, and windows must be passed, not discovered through global state. |
| Microsoft Azure Architecture Center — RAG information retrieval | [RAG information retrieval](https://learn.microsoft.com/azure/architecture/ai-ml/guide/rag/rag-information-retrieval) | Retrieval/orchestration gathers context before an LLM call | Reserve StudentContext as a structured input to a future retrieval/orchestration layer; do not implement RAG or agent behavior in this gate. |

## 2. Pattern observed

### 2.1 Query-side composition, not write-side mutation

The CQRS references consistently separate mutation commands from read models.
The read path can combine facts and shape a consumer-specific DTO, but it does
not become an alternative persistence model. This matches the repository's
existing split between `PracticeRecord`, `UserKnowledgeMastery`, review facts,
plan/task facts, and the read-only projection services.

### 2.2 A display model is useful only at a bounded boundary

Fowler's guidance is deliberately conditional: CQRS is valuable where the
read/write models have materially different concerns, but applying it to every
screen adds needless complexity. The StudentContext is therefore a bounded
composition boundary for cross-domain student context, not a replacement for
`StudentStateProjectionService`, `OverviewReportProjectionService`, or
`StudyService`.

### 2.3 Rebuildable view over existing sources

The materialized-view pattern describes a view derived from one or more source
stores, with a clear freshness trade-off. For the current system the first
implementation should be an on-demand, in-process read model assembled from
existing repositories/projections. It should remain reproducible from source
facts and be eligible for later caching or materialization without changing its
contract.

### 2.4 Explicit immutable context inputs

The OpenTelemetry Context specification is not a student-domain model, but its
useful boundary rule is directly applicable: context is explicit, scoped, and
immutable. A StudentContext query must receive `userId` and an explicit
`asOf`; it must not depend on ambient request state, a module singleton, or an
implicit `Date.now()` default that changes the result between consumers.

### 2.5 Context assembly is upstream of AI generation

The RAG reference separates retrieval/context assembly from the later model
call. This supports keeping StudentContext as a structured, provenance-aware
input. It must not call the LLM, decide a recommendation, or become a vector
store in the current phase.

## 3. Relevance to the current repository

The current repository already has the ingredients for composition, but they
are exposed through several independent boundaries:

- `StudentStateProjectionService` reads user profile, `UserKnowledgeMastery`,
  practice, wrong-question, review, task, and assessment facts into a
  read-only `StudentStateSnapshot`.
- `OverviewReportProjectionService` builds a canonical overview with explicit
  node/point identity, separated node/practice/speed weaknesses, progress
  windows, assessment, review, actions, and evidence.
- `DashboardProjectionService`, `TodayPlanProjectionService`,
  `PracticeProjectionService`, `WrongQuestionProjectionService`,
  `AssessmentProjectionService`, and `ActivityProjectionService` each expose
  narrower read models.
- `ContextualCoachContextAssemblerService` currently composes several of
  those sources directly for AI context, while `RecommendationService` owns
  deterministic recommendation computation and must remain outside the new
  context dependency direction.

This is exactly the point at which a dedicated composition boundary can reduce
consumer-specific assembly without changing any source-of-truth or command
path. It also exposes current gaps that the implementation must represent
honestly: activity/session enrichment, subject distribution, evidence linkage,
and consistent `asOf` filtering are not all supplied by one existing loader.

## 4. Adopt

### 4.1 Contract shape

Adopt a versioned, JSON-serializable `StudentContext v1` with these top-level
sections:

```text
profile
exam
mastery
practice
review
plan
momentum
recommendationEvidence
```

The contract must use explicit nullable/insufficient-data semantics. It must
not fill missing evidence with a fabricated zero or a display sentence.

Identity-bearing collections remain separate:

- mastery/node weakness lists use `knowledgeNodeId` (a `KnowledgeNode.id`);
- practice weakness lists use `knowledgePointId` (a `KnowledgePoint.id`);
- actions use `actionId` (`RecommendationAction.id`);
- plan tasks use `studyTaskId` (`StudyTask.id`).

No generic `id` field may carry more than one identity space.

### 4.2 Composition boundary

Adopt a dedicated `StudentContextQueryService` as the orchestration boundary.
It may call existing read repositories/projections and small read-only loaders,
then pass a source-facts object to a pure `buildStudentContext(...)` selector.

The selector owns deterministic aggregation, identity-specific grouping,
window/status calculation, and null semantics. It does not issue writes or
reach into controllers. The query service owns authentication-scoped user
selection, explicit time inputs, and source loading; it does not duplicate
recommendation algorithms.

### 4.3 Freshness and `asOf`

Adopt explicit query inputs:

```ts
{
  userId,
  asOf,
  windows?: {
    practice?: { startAt: Date; endAt: Date },
    activity?: { startAt: Date; endAt: Date },
    assessment?: { startAt: Date; endAt: Date }
  }
}
```

The concrete TypeScript shape is for the next Contract + TDD gate; the rule is
already frozen here. `asOf` is required at the composition boundary (or a
single controller-owned default is passed in once). The selector must not call
`Date.now()` and must report freshness/status when a source cannot answer the
requested window. `computedAt` should be derived from the supplied query
context, not independently sampled by each sub-loader.

### 4.4 Source-of-truth direction

Adopt this dependency direction:

```text
Controller / future read API
        ↓
StudentContextQueryService
        ↓
Existing read projections / repositories / source facts
        ↓
buildStudentContext (pure selector)
```

Future Frontend and AI Coach consumers may read the context. Recommendation
may consume the context only through an explicitly approved future integration;
`RecommendationService` must not become a dependency of the context query
service, and the context query service must not call recommendation generation.

### 4.5 Provenance and evidence

Where existing evidence or source identifiers are available, preserve them in
`recommendationEvidence` with timestamp and explicit node/point/action
identity. Where they are not available, return the Contract's insufficient
status rather than inventing an evidence reference. The context is an
aggregation of facts and provenance, not an evidence database.

## 5. Reject

The following patterns are explicitly rejected for StudentContext v1:

1. **A second persisted Student State table.** It would create another source
   of truth and introduce synchronization/backfill work that the current
   architecture does not need.
2. **Expanding `StudentStateProjectionService` into the universal context
   owner.** It would blur the existing snapshot boundary and couple all future
   consumers to one projection's semantics.
3. **Calling `StudyService.getOverviewReport()` as the canonical source.** It is
   a legacy/compatibility path and would reintroduce its consumer-specific
   semantics instead of composing the approved canonical sources.
4. **Letting `RecommendationService` depend on StudentContext.** This creates
   a dependency cycle risk and allows a read context to become a hidden
   recommendation-generation entry point.
5. **Front-end composition as the contract.** Home, report, and coach screens
   currently combine several endpoints; encoding that assembly in the browser
   would preserve divergence and make AI consumers reproduce UI rules.
6. **Implicit wall-clock windows.** A selector that samples `Date.now()` or
   lets each loader choose its own default window is nondeterministic and
   cannot support parity or reliable AI context snapshots.
7. **RAG, tool calling, or an agent loop in the context layer.** Retrieval and
   generation remain a later AI concern; StudentContext only supplies a
   structured, provenance-aware input.
8. **Event-sourced StudentContext.** `UserEvent` remains a feedback/telemetry
   fact source; it must not replace Practice/Review/Mastery/Plan facts or
   directly mutate `UserKnowledgeMastery`.

## 6. Architecture impact

### StudentState

No source-of-truth change. `PracticeRecord` remains behavior evidence,
`UserKnowledgeMastery` remains the mastery fact, and review/plan/session facts
retain their existing writers. StudentContext may read the existing snapshot
and loaders, but it must not write or widen Student State semantics.

### OverviewProjection

No replacement or consumer migration in this phase. The Overview projection is
the strongest existing canonical read model for report-specific semantics and
can be one source of facts. StudentContext should reuse its identity and
evidence rules where appropriate rather than reimplementing a competing
overview contract. Report parity differences remain a later migration concern.

### RecommendationService

No algorithm or dependency change. Recommendation remains deterministic and
consumes its existing mastery/evidence inputs. A future adapter may expose
StudentContext to recommendation consumers only after a separate dependency and
contract review.

### ContextualCoach

No AI behavior change now. The current assembler remains compatible. A future
integration can replace duplicated context assembly with StudentContext as an
input, while `AiTutorService` and fallback/guardrail behavior remain outside
the selector.

### StudentContextQueryService

This is the new bounded composition owner. It loads explicit source facts,
passes them to the pure selector, preserves identity/provenance, and exposes a
stable read boundary. It must be side-effect free from the caller's point of
view and must not create actions/tasks/events or invoke an LLM.

## 7. Final recommendation

The reference check supports proceeding with Option B at the next gate:

- **Contract shape:** versioned `StudentContext v1`, immutable read DTO with
  profile/exam/mastery/practice/review/plan/momentum/evidence sections and
  explicit insufficient-data semantics.
- **Composition boundary:** dedicated `StudentContextQueryService` plus a pure
  `buildStudentContext(sourceFacts)` selector.
- **Freshness / `asOf`:** explicit `asOf` and explicit windows; no selector
  calls to `Date.now()`; source freshness/status is visible to consumers.
- **Dependency direction:** read API/controller → query service → existing
  read projections/repositories → pure selector; future Frontend/AI consume
  the result. Recommendation generation is not a dependency.
- **Selector responsibility:** deterministic composition, identity-separated
  aggregation, window/status calculation, and provenance assembly only.
- **Persistence:** no new table, no Schema/Migration change, and no historical
  backfill in StudentContext v1.

This gate therefore passes and authorizes the next separately scoped activity:
StudentContext Contract + TDD. It does not authorize consumer migration, AI/RAG
work, or any D4-B4 environment retry.

## 8. Scope confirmation

This reference gate changed only this documentation file. No TypeScript source,
test, Prisma schema, migration, API consumer, UI, Student State write path,
Recommendation algorithm, or AI behavior was modified.
