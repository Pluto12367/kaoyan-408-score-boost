# Score / Mastery / Evidence Semantics

> **Status**: authoritative semantic contract.
> **Rule summary**: root [`AGENTS.md`](../../AGENTS.md) §11 RULE-07, RULE-08, RULE-09.
> **Class taxonomy**: [observed-derived-proxy.md](observed-derived-proxy.md).
> **Procedure**: [development-protocol.md](development-protocol.md).
>
> If this file conflicts with root `AGENTS.md`, **`AGENTS.md` governs**.
> This file **restates existing, already-approved semantics**. It does not
> introduce new product decisions. Changing anything here is an Owner gate.

---

## 1. Why this document exists

The V12-0 audit found the project's most damaging class of defect was not a
missing feature but a **collapsed distinction**: "the student did something",
"the system observed something", and "the student can do something" were all
rendered as the same kind of statement. The same collapse let a model estimate
be read as a measured score.

This document draws the seams that must never be crossed again. Every rule below
is enforced somewhere in code or tests; the enforcement site is cited.

---

## 2. The three layers

```text
ACTIVITY   something happened            (a marker)
EVIDENCE   something was OBSERVED        (a traceable observation)
ABILITY    what we infer from evidence   (mastery)
```

The taxonomy lives in `packages/shared/src/score-center/learning-evidence.ts`.

| Layer | Definition | Canonical source | Class |
|---|---|---|---|
| **Activity** | An action occurred. Carries no claim about capability. | `PracticeRecord`, `ReviewAttempt`, `LearningSession`, `StudyTaskCompletion`, `UserEvent` | `OBSERVED` (as an action) |
| **Evidence** | A traceable observation of performance that can support a capability statement. | `UserEvent(type='EVIDENCE_RECORDED')` | `OBSERVED` |
| **Ability** | The inferred capability state. | `UserKnowledgeMastery` | `PROXY` |

### 2.1 Activity is not Evidence

> **RULE**: an activity marker never constitutes capability evidence.

Enforcement: `learning-evidence.ts:17` states it; `LearningActionVerdict` carries
`isActivity: true` together with an explicit `isEvidence` and
`canInfluenceMastery`, so a consumer cannot accidentally read an activity as
evidence.

Consequences:

- Completing a task is not evidence of learning.
- Marking a question as reviewed is not evidence of recall.
- A study streak is not evidence of ability.

### 2.2 Evidence is graded, and self-report is weak

Evidence kind and strength (`learning-evidence.ts:41`, `:43`):

| Kind | Strength | Can influence mastery |
|---|---|---|
| `none` | `none` | no - activity only |
| `self_reported` | `weak` | no |
| `recall_outcome` | `strong` | yes |
| `objective_performance` | `strong` | yes |

> A student's self-reported numbers are **weak** evidence by construction.
> A self-report may be surfaced, but it must be labelled and must never be
> promoted to an ability claim.

### 2.3 Ability is a PROXY, not a measurement

`UserKnowledgeMastery.mastery` (`prisma/schema.prisma:1011`) is an exponential
moving average over **binary practice correctness**.

It is therefore a proxy for practice performance - **not** a measurement of exam
ability, and **not** a score. Known validity threats, all verified in the audit:

- self-report contamination (`Question.selfScore >= 0.6` counted as correct),
- direction transience (an EMA can move opposite to the observed trend),
- a neutral `0.5` prior at cold start,
- `confidence` being a function of sample size rather than of quality.

> **RULE**: `mastery` must never be presented as an exam score, a score gap, or a
> score gain.

---

## 3. Mastery: single writer

| Field | Value |
|---|---|
| Canonical source | `UserKnowledgeMastery` |
| Unique writer | `ScoreCenterService.applyAttempts` / `applyReview` |
| Concurrency | optimistic concurrency control via `version` (`schema.prisma:1024`) |
| Frozen | yes - see [`docs/current-sprint.md`](../current-sprint.md) §7 |

**Forbidden**

- Any second mastery writer, second mastery table, or second mastery formula.
- Recomputing mastery in a read path and persisting it.
- Deriving mastery from anything other than observed attempts.
- Modules that read mastery gaining a write path (**RULE-09**).

Read-only consumers may project mastery, but a projection is not a source of
truth and must not be stored as fact.

---

## 4. Evidence: single ledger

| Field | Value |
|---|---|
| Canonical source | `UserEvent` rows with `type = 'EVIDENCE_RECORDED'` |
| Server-exclusive | `EVIDENCE_RECORDED` is in the reserved canonical event types and **not** in the client telemetry allowlist |
| Idempotency | `(userId, eventKey)` uniqueness |

Because the type is server-exclusive, a client cannot fabricate evidence.

> **RULE**: the evidence ledger is append-only. Evidence rows are not updated;
> corrections are appended.

Consequences:

- A read model may summarise evidence; it may not create or amend it.
- Absence of evidence is a conclusion (`observed = null`), not a zero.
- Stub or synthetic values must never enter the evidence path. A known example
  is the historical synthetic default for completion metrics, which is locked
  by test so that it cannot leak into evidence.

---

## 5. Score: three tables, three writers, three guards

The score layer is deliberately split so that the forbidden transitions are
**structurally inexpressible**.

| Table | Meaning | Class | Write path | Guard |
|---|---|---|---|---|
| `ScorePrediction` (`schema.prisma:1084`) | what the model thinks you will score | `PROXY` | prediction endpoint | model output, keyed by `predictionKey`; `source` defaults to `MODEL_OUTPUT` |
| `ScoreAssessment` (`:1110`) | a performance that was measured | `OBSERVED` | assessment endpoint | provenance in `source`; `semantic` distinguishes `exam_total` from `accuracy_rate` |
| `ScoreOutcome` (`:1138`) | a final result that actually happened | `OBSERVED` | outcome endpoint | `verificationStatus` may only go `unverified -> verified`, by teacher/admin |

`ScoreCorrection` (`:1167`) is append-only: it records
`targetKind` / `targetId` / `correctedFields` / `reason` / `correctedBy`, and
never mutates the original evidence row.

### 5.1 The forbidden transitions

> **RULE-07**: these must never be made to hold directly.

```text
Activity     -> Ability
Proxy        -> Observed
Prediction   -> Outcome
Mastery      -> Actual Score
```

| Forbidden transition | Why it is structurally blocked |
|---|---|
| Prediction -> Outcome | different tables, different endpoints, no method writes both |
| Proxy -> Observed | `calibrationLayerOf` maps only `PRIMARY` sources (`TEACHER_GRADED`, `RUBRIC_GRADED`, `REAL_EXAM`) to the primary stratum; `MOCK`/`DIAGNOSTIC`/`IMPORTED` are `PROXY` |
| Activity -> Ability | `canInfluenceMastery` is `false` for activity-only and self-reported evidence |
| Mastery -> Actual Score | no code path writes a score from mastery |

### 5.2 Scale and semantic separation

- `normalizeScore` requires an explicit `totalScale`. There is **no**
  `|| 150` fallback: a missing scale is rejected, not guessed.
- `semantic = exam_total` and `semantic = accuracy_rate` are not interchangeable.
  An in-app full paper's percentage is stored as `accuracy_rate` and is
  **structurally barred** from total-score calibration.
- Mixing dimensions must be impossible to express, not merely discouraged.

### 5.3 Provenance is mandatory

Every score row carries `source`, and:
- `recordedAt` must never impersonate the exam date (`examDate` stays `null` when
  unknown - `schema.prisma:1126`);
- unverified outcomes never enter the primary calibration stratum;
- MAE / bias / median are never reported as a single blended number across
  strata.

### 5.4 Subjective-question contamination is a known, registered defect

`Question.selfScore >= 0.6` counted as "correct" contaminates both `accuracy`
and `mastery`. `Question.rubric` exists in the schema but has zero production
rows. Therefore:

> **RULE**: no design may assume subjective-question scores are trustworthy.
> Loss derived from `selfScore` is `PROXY`; only rubric-graded loss may be
> `OBSERVED`, and the two must be reported separately, never merged.

---

## 6. Separation enforcement checklist

Before merging anything that touches these layers, confirm:

- [ ] No new writer of `UserKnowledgeMastery`.
- [ ] No update or delete of `EVIDENCE_RECORDED`.
- [ ] No method that writes more than one of prediction / assessment / outcome.
- [ ] No `generated -> verified` promotion path (**RULE-10**).
- [ ] No `|| 150`, `?? 0`, or `?? 0.75` style fallback that fabricates a value.
- [ ] Every score-like output carries its class and its basis.
- [ ] Absent data stays `null`, never `0`.
- [ ] Any projected ability value is labelled `PROXY`, not `OBSERVED`.

---

## 7. Canonical-source summary

| Concept | Canonical source | Unique writer | Class |
|---|---|---|---|
| Activity | `PracticeRecord` / `ReviewAttempt` / `LearningSession` / `StudyTaskCompletion` / `UserEvent` | multiple, append-only | `OBSERVED` (action) |
| Evidence | `UserEvent(type='EVIDENCE_RECORDED')` | evidence service | `OBSERVED` |
| Ability (mastery) | `UserKnowledgeMastery` | `ScoreCenterService` only | `PROXY` |
| Prediction | `ScorePrediction` | prediction path | `PROXY` |
| Assessment | `ScoreAssessment` | assessment path | `OBSERVED` |
| Outcome | `ScoreOutcome` | outcome path | `OBSERVED` |
| Correction | `ScoreCorrection` | correction path | append-only audit |