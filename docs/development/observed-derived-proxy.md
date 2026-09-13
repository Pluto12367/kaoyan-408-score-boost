# OBSERVED / DERIVED / PROXY / UNAVAILABLE

> **Status**: authoritative classification contract.
> **Rule summary**: root [`AGENTS.md`](../../AGENTS.md) §11 RULE-05, RULE-06, RULE-11.
> **Layer semantics**: [score-mastery-evidence-semantics.md](score-mastery-evidence-semantics.md).
>
> If this file conflicts with root `AGENTS.md`, **`AGENTS.md` governs**.
> This file **restates already-approved S1 semantic decisions**. It does not
> redefine product semantics. Changing a class assignment is an Owner gate.

---

## 1. The four classes

Every number the system shows, stores, or reasons over must belong to exactly
one class. The class determines what may be claimed about it.

| Class | Meaning | Example | Can claim real score? |
|---|---|---|---|
| `OBSERVED` | directly measured or directly recorded | actual assessment score; a graded attempt | Yes, as an observation |
| `DERIVED` | deterministically calculated from observed values | normalized score; score loss; calibration MAE | Only as a derived result |
| `PROXY` | an estimate or uncalibrated model output | `mastery`; `expectedBenefit`; predicted score | No |
| `UNAVAILABLE` | not obtainable from existing evidence | unknown exposure; unmeasured recoverability | No - and must not be imputed |

### 1.1 Definitions in operational terms

- `OBSERVED` - there exists a stored record of the thing itself. You can point
  at a row.
- `DERIVED` - there exists a pure function from `OBSERVED` inputs whose output
  is reproducible by anyone re-running it. Deterministic, no model, no
  heuristic.
- `PROXY` - the thing you want was not measured; something correlated was. A
  model, an estimate, an EMA, a heuristic interval.
- `UNAVAILABLE` - the inputs that would be required simply do not exist in the
  system. The correct output is `null` plus an explicit reason - **never** `0`,
  never a default, never an estimate.

---

## 2. `null` is not `0`

> **RULE-06**: `null != 0`. Unknown data must never be fabricated as zero.

This is the single most repeated defect class in this repository's history.
Verified examples of the pattern that must not reappear:

| Anti-pattern | Why it is a defect |
|---|---|
| no snapshot -> frequency `0` | reads as "never examined", fabricating a fact |
| no mastery row -> mastery `0.5` assumed | invents a measurement |
| no prerequisite edge -> "ready" | converts absence of data into a positive claim |
| no exposure telemetry -> `exposed = 0` | reports "not seen" when the truth is "unknown" |
| missing `totalScale` -> default `150` | silently changes the meaning of the number |
| missing `remainingDays` -> `0` | drives a time factor to an extreme value |
| synthetic completion default (`?? 0.75`) | fabricates observed performance |

Two related honesty rules:

1. **Absence of telemetry is not a zero.** When an instrument never ran, the
   correct value is `null` plus "telemetry unavailable". Once the instrument is
   demonstrably working, absence becomes a meaningful `false` - "not observed".
   `null` (unknown) and `false` (known-absent) are different and must stay
   different.
2. **Insufficient sample is a conclusion.** Below the preregistered threshold,
   the output is `insufficient_data` - never a low-confidence number presented
   as if it were measured.

---

## 3. Canonical class assignments

### 3.1 `OBSERVED`

| Value | Source |
|---|---|
| `ScoreAssessment` row | teacher / rubric / import entry |
| `ScoreOutcome` row | real exam or verified mock; `verificationStatus` may still be `unverified` |
| `PracticeRecord`, `ReviewAttempt` | graded attempts |
| `UserEvent(type='EVIDENCE_RECORDED')` | observed performance |
| `KnowledgeFrequencySnapshot.primaryScore5y` | real exam point value from past papers |
| `Question.maxScore`, when annotated | content-declared point value |
| explicit `lostScore` on a priced question | assessment loss attributed to a node |

### 3.2 `DERIVED`

| Value | Derivation |
|---|---|
| `normalizedScore` | `normalizeScore` - deterministic, requires explicit scale |
| score loss (`rawTotalScale - rawScore`) | arithmetic on an `OBSERVED` row |
| calibration MAE / bias / median / withinRange | computed from paired `OBSERVED` values |
| `ScoreOutcome.verificationStatus` | state machine |

### 3.3 `PROXY`

| Value | Why it is a proxy | Confidence ceiling |
|---|---|---|
| `UserKnowledgeMastery.mastery` | EMA over binary practice correctness | proxy by construction |
| `accuracy` / `recentAccuracy` | practice accuracy, not exam ability | proxy |
| `Question.selfScore >= 0.6 -> correct` | self-report | proxy, and a known contamination source |
| `estimatePredictedScore` | heuristic interpolation, never calibrated against real scores | proxy |
| `score150Estimate` | objective accuracy x 80 + subjective self-report | proxy |
| recommendation `priority` (0-100) | dimensionless ranking value | proxy |
| `recoverability` (opportunity factor) | self-declared as unmeasured | `low` |
| `trainingCost` (`estimateMinutes`) | a production *estimate*, not a measurement | `medium` |
| `nodeLoss` (`lostCount x frequency`) | a question-count proxy, **not** a score loss | proxy |
| `expectedBenefit` | explicitly "an estimate, not a measurement" | proxy, `calibrated: false` |

### 3.4 `UNAVAILABLE`

| Value | Why |
|---|---|
| recoverable score | no direct measurement exists |
| per-item loss on an unpriced question | no point value exists; do not impute one from "average value", frequency or difficulty |
| unknown exposure (no telemetry) | instrument never ran |
| `Verified Score Gain` | requires matched PRIMARY-layer before/after pairs; sample is currently zero |

---

## 4. Presentation rules

Binding on both API and UI.

| Question | Rule |
|---|---|
| May it be displayed? | `OBSERVED` and `DERIVED`: yes. `PROXY`: yes, **only** when labelled. `UNAVAILABLE`: never as a value - show the absence and the reason. |
| What label is required? | `PROXY` must carry an explicit proxy/estimate marker in the user's language (e.g. "estimate", "排序参考"). `UNAVAILABLE` must state what is missing. |
| Is `basis` mandatory? | Yes for every score-like or ability-like output. `PROXY` additionally carries its confidence ceiling and `calibrated: false`. |
| May it enter ranking? | `OBSERVED`/`DERIVED`: yes. `PROXY`: only inside the engine that owns it, with the class preserved. `expectedBenefit` specifically: **no** - it may not enter student-visible narrative and may not drive ranking. |
| May it be persisted as fact? | Only `OBSERVED`. `DERIVED` may be recomputed; `PROXY` may be stored only as model output with its `modelVersion` and `inputsSnapshot`. |
| May it be compared across classes? | No. MAE / bias / median are never reported as a single blended number across calibration strata. |

### 4.1 Proxy may not be silently upgraded

> **RULE**: `PROXY != OBSERVED`.

A proxy becomes observed only when a genuinely different measurement exists for
it - not by relabelling, not by adding decimals, not by combining several proxies.

Combining proxies does not produce an observation. It produces a proxy of
unknown validity.

---

## 5. `Verified Score Gain` - explicitly not claimable

The project North Star is `Verified Score Gain / 30d`.

| Fact | Value |
|---|---|
| Implemented? | **No.** The string exists only in documentation |
| Why not | requires "pre-intervention score -> intervention -> post-intervention score" pairs in the `PRIMARY` calibration layer; the `PRIMARY` sample is currently zero, and `ScoreOutcome` has no automatic source (manual/teacher entry only) |
| Consequence | any "gain" number computed today would be fabricated |

Terminology note: in `Verified Score Gain`, "Verified" refers to the
**provenance of the measurement** (a PRIMARY-layer, provenance-verified
assessment). It does **not** mean "the system verified that the student
improved".

> **RULE-11**: none of the following may be called `Verified Score Gain`:
> expected score, expected benefit, recoverable score, transfer gap, model
> output, mastery gain, accuracy gain, predicted score, or any combination of them.

Currently allowed, with labels:

| Statement | Allowed phrasing |
|---|---|
| mastery moved from a to b | ability proxy change |
| accuracy improved over a window | observed practice performance change (label the window and sample) |
| transfer gap measured | transfer evidence indicator, lower than practice performance (labelled as evidence, not score) |
| predicted score | model output (`PROXY`, `calibrated: false`) |
| any of the above | **not** a score improvement |

---

## 6. Enforcement checklist

Before merging a change that introduces or surfaces any number:

- [ ] The number's class is stated in the code or its contract.
- [ ] The class is stated in the user-facing copy (for `PROXY` and `UNAVAILABLE`).
- [ ] `null` is preserved; no `|| default`, `?? 0`, `?? 0.75` fallback.
- [ ] Sample-size gates produce `insufficient_data` rather than a number.
- [ ] Calibration strata are not blended.
- [ ] No proxy is labelled as observed, verified, measured, or a gain.
- [ ] A test pins the absent-data branch (`null`, not `0`) and the proxy label.