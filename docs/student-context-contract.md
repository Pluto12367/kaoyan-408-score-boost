# StudentContext v1 Contract

**Status:** Contract + TDD implementation baseline  
**Version:** `student-context-v1`  
**Role:** read-only derived context

## 1. Purpose

`StudentContext` provides one stable, authenticated read model for consumers
that need a cross-domain view of a student. It composes existing facts from
practice, mastery, review, plans, sessions, activity, and recommendation
evidence.

```text
Source Facts
    ↓
StudentContextQueryService
    ↓
buildStudentContext(sourceFacts)
    ↓
StudentContext v1
    ↓
Frontend / Recommendation adapters / AI Coach (future consumers)
```

It is not a persistence model, an event store, a recommendation result, AI
memory, or a vector store.

## 2. Source of Truth

The following existing models remain authoritative:

| Fact | Source of truth | StudentContext use |
| --- | --- | --- |
| User profile and exam goals | `User` | `profile`, `exam` |
| Practice behavior and timing | `PracticeRecord` | `practice`, point-level practice weakness |
| Node mastery | `UserKnowledgeMastery` (and snapshots for historical reads) | `mastery.weakNodes`, `improvingPoints`, `masteredPoints` |
| Wrong-question lifecycle | `WrongQuestionReview` | review lifecycle and risk context |
| Review schedule/outcomes | `ReviewSchedule`, `ReviewAttempt` | due/overdue and high-risk review facts |
| Plans and tasks | `StudyPlan`, `StudyTask`, `StudyTaskProgress`, completions | `plan` |
| Learning activity | `LearningSession`, task completions, practice timestamps | `momentum` |
| Recommendation provenance | `RecommendationAction.evidenceRefs`, task reason/score facts, canonical event evidence | `recommendationEvidence` |

`PracticeRecord`/`ReviewAttempt` continue to feed the Mastery Engine. A
`LearningSignal` or `UserEvent` must never update `UserKnowledgeMastery` through
this context.

## 3. Derived Context

The context is assembled on demand by
`StudentContextQueryService` and selected by the pure
`buildStudentContext(...)` function. It is rebuildable from source facts and
has no write side effects.

Top-level sections are:

```text
version
userId
asOf
freshness
profile
exam
mastery
practice
review
plan
momentum
recommendationEvidence
```

Missing source rows are represented as `null`, an empty collection where the
collection itself is meaningful, or an explicit `insufficient_data` status.
The selector never invents a baseline, evidence reference, or mastery value.

## 4. Contract shape

The canonical TypeScript definitions are in
`apps/api/src/study/student-context.contract.ts`.

### Profile and exam

Profile contains authenticated `userId`, optional display/role facts, target
school, weakest subject, and diagnosis. Exam contains exam year, target/current
score, remaining days, and study stage. Unavailable `User` fields are `null`.

### Mastery

- `weakNodes` contains `knowledgeNodeId` and Node mastery facts from
  `UserKnowledgeMastery`.
- `weakPoints` contains `knowledgePointId` and practice-derived weakness
  facts. It is not synthetic Point mastery.
- `improvingPoints` and `masteredPoints` retain `knowledgeNodeId` when their
  source is Node mastery; their historical names do not change the identity
  contract.
- `source` is `user_knowledge_mastery` when rows are available, otherwise
  `empty`.

### Practice

`recentAccuracy` and `recentVolume` are explicit trend objects. Subject
distribution is derived from point/catalog facts when available. Practice
records retain `knowledgePointId`; they never receive a Node ID by fallback.

### Review

Review exposes due and overdue counts, reviewed/resolved counts, the next due
time, and a bounded list of high-risk questions. The source is
`review_schedule` or `empty`.

### Plan

Tasks use `studyTaskId`. An associated `actionId` is optional and is read from
the Action → Task relation; it is never inferred from task ID equality.
Completion contains completed/total counts and an explicit trend for the
requested window.

### Momentum

Momentum contains a derived active-day streak, recent `learningSessionId`
records, and an activity trend. A session's optional `actionId` remains a
separate identity.

### Recommendation evidence

Evidence entries preserve source, timestamp, and any applicable
`knowledgeNodeId`, `knowledgePointId`, `actionId`, `studyTaskId`, or
`referenceId`. Evidence is provenance, not a second recommendation source.

## 5. Identity rules

The following value spaces are disjoint:

```text
knowledgeNodeId   = KnowledgeNode.id
knowledgePointId  = KnowledgePoint.id
actionId          = RecommendationAction.id
studyTaskId       = StudyTask.id
learningSessionId = LearningSession.id
```

The contract forbids a generic `id` field for these relationships and forbids
Node-as-Point conversion. Point-level practice weakness and Node-level mastery
must remain separate even when a mapping exists.

## 6. Trend semantics

Every trend object has the same shape:

```ts
{
  window: string;
  baseline: number | null;
  sampleSize: number;
  status: 'sufficient' | 'insufficient_data';
  value: number | null;
}
```

`window` is explicit (`last7d`, `last30d`, `activity`, or a contract-defined
scope). `baseline` is computed only from an explicit baseline range. A trend is
`insufficient_data` when the current or baseline sample is unavailable; its
`value` and `baseline` are `null`, not zero.

## 7. `insufficient_data` semantics

`insufficient_data` means the requested conclusion cannot be supported by the
available source facts. It is different from a valid measured zero. For
example, no practice records yields an unavailable accuracy trend, not 0%
accuracy; no mastery rows yields `mastery.source = empty`, not zero mastery.

Collections may be empty when the collection has no members, but any metric
that needs a sample carries its status explicitly.

## 8. `asOf` semantics

`asOf` is the logical query time. The read boundary resolves it once and passes
the resulting ISO timestamp to every source loader and to the pure selector.
The selector never calls `Date.now()` or creates a current-time default.

Window ranges are explicit inputs derived from the same `asOf`. Source
freshness records when a source was observed; freshness is not the same as an
event's occurrence time. A source that cannot answer the requested time range
is marked unavailable rather than silently mixed with a different time basis.

## 9. Dependency direction

```text
Authenticated read controller
        ↓
StudentContextQueryService
        ↓
Existing read projections / repositories / Prisma read queries
        ↓
buildStudentContext(sourceFacts)
```

The query service may compose read models but does not write, start a
transaction for mutation, create a task/action/event, update mastery, invoke
the recommendation algorithm, or call an LLM. `RecommendationService` does
not depend on `StudentContextQueryService`.

## 10. Current consumers

This contract is introduced as a stable read boundary; existing Home, Report,
Recommendation, and Contextual Coach consumers are not migrated in this task.
Legacy endpoints and their adapters remain available until a separate parity
and migration decision is approved.

## 11. Future AI / RAG usage

Future Contextual Coach or retrieval orchestration may use StudentContext as a
structured, provenance-aware input. It must remain separate from retrieval
storage, prompt generation, tool calling, and agent loops. RAG must not write
back to this context or to mastery through feedback events.

## 12. Explicitly rejected designs

- A second persisted Student State or StudentContext table.
- Expanding `StudentStateProjectionService` into a universal context owner.
- Using `StudyService.getOverviewReport()` as the canonical context source.
- Making `RecommendationService` a query-service dependency.
- Recreating context assembly independently in each frontend screen.
- Implicit per-loader wall-clock windows.
- Using `UserEvent` as an event-sourced replacement for learning facts.
- Adding RAG, Agent, schema, migration, or consumer migration to this contract.

