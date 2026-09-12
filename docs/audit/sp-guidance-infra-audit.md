# Student Operating Protocol — Guidance Infrastructure Audit

Read-only audit of measurement + state infrastructure that a "Student Operating Protocol" guidance layer could reuse.
Source of truth: code only (schema, migrations, API, shared package, scripts, tests). Docs ignored.
Method: read/grep/glob only; no file was modified except this report.

---

## 1. UserEvent / telemetry

**Model** — `prisma/schema.prisma:211-222`

| field | line | note |
|---|---|---|
| `id String @id @default(cuid())` | 212 | |
| `userId String` | 213 | FK → User, `onDelete: Cascade` (:218) |
| `type String` | 214 | **free String, not an enum** |
| `eventKey String?` | 215 | nullable → telemetry rows have no identity |
| `payload Json?` | 216 | schema-free detail bag |
| `createdAt DateTime @default(now())` | 217 | |
| `@@index([userId, type, createdAt])` | 220 | |
| `@@unique([userId, eventKey])` | 221 | |

Migrations: `prisma/migrations/20260806130000_user_events/migration.sql:3,12`; identity added later —
`20260902160000_user_event_event_key/migration.sql:2` `ALTER TABLE "UserEvent" ADD COLUMN "eventKey" TEXT;` and `:6-7` `CREATE UNIQUE INDEX "UserEvent_userId_eventKey_key" ON "UserEvent"("userId", "eventKey");`.

**Writers** — `apps/api/src/study/user-event.repository.ts`
- `record()` :22-31 — telemetry path, **no eventKey** (no idempotency). `recordTelemetry()` :33-35 delegates.
- `recordCanonical()` :51-84 — eventKey-scoped, idempotent; pre-read inside a tx (:66-71), P2002 catch + re-read outside (:73-83; rationale :37-50).
- `findCanonical()` :94-105, `listByType()` :108-116, `hasTriggerKey()` :118-129 (scans `plan.generated` payloads).
- `enabled` getter :18-20 = `Boolean(process.env.DATABASE_URL)` → **no writes without a DB**.

**Canonical writer** — `apps/api/src/study/canonical-event-writer.service.ts:85-96`
- rejects non-reserved types (:86-88), requires a non-empty `eventKey` (:90-93), delegates (:95).
- `deriveEventKey()` :108-123 — `USER_ACTION_FEEDBACK:{userId}:{actionId}:{signalType}` (:114) and `PLAN_GENERATED:{generationKey}` / `PLAN_GENERATED:{userId}:{triggerKey}` (:119,121).

**Allowed telemetry event types** — `canonical-event-writer.service.ts:5-30` (`TELEMETRY_EVENT_TYPES`, 21 entries):
`page.view`, `button.click`, `ui.interaction`, `client.error`, `practice.set_start`, `practice.set_restart`, `practice.bank_restart`, `practice.learning_mode_start`, `task.start`, `task.manual_complete`, `task.postpone`, `task.reschedule`, `task.rebalance`, `wrong.open_review`, `quest.start`, `quest.complete`, `assessment.generate`, `tutor.ask`, `sprite.interact`, `recommendation.exposed`, `recommendation.viewed`.

**Reserved canonical event types** — `canonical-event-writer.service.ts:32-56` (`RESERVED_CANONICAL_EVENT_TYPES`, 19 entries):
`USER_ACTION_FEEDBACK`, `plan.generated`, `practice.submit`, `task.complete`, `session.submit`, `wrong.review`, `assessment.import`, `ACTION_COMPLETED`, `PRACTICE_ATTRIBUTED`, `REVIEW_ATTRIBUTED`, `recommendation.created`, `recommendation.accepted`, `recommendation.completed`, `recommendation.failed`, `learning.insight.created`, `knowledge.gap.detected`, `study.strategy.updated`, `EVIDENCE_RECORDED`, `REVIEW_MASTERY_APPLIED`.

**Emission-site count per reserved type** (grep `'(TYPE)'` over `apps/api/src`, exclude the constant array):

| type | emission sites | evidence |
|---|---|---|
| `EVIDENCE_RECORDED` | 1 writer (N callers) | `learning-evidence.service.ts:34,344` |
| `plan.generated` | 1 | `learning-loop-trigger.service.ts:79-92` |
| `REVIEW_MASTERY_APPLIED` | 1 | `review-mastery-integration.service.ts:240` |
| `USER_ACTION_FEEDBACK` | 1 (direct prisma write) | `student-state-feedback.repository.ts:50-57` |
| `practice.submit` | 3 | `study.service.ts:3140,3211,3292` |
| `task.complete` | 1 | `study.service.ts:3589` |
| `session.submit` | 1 | `study.service.ts:4647` |
| `wrong.review` | 1 | `study.service.ts:2243` |
| `assessment.import` | 1 | `study.service.ts:1914` |
| `recommendation.created` / `.accepted` / `.completed` / `.failed` | **0** | grep → only `:43-46` |
| `ACTION_COMPLETED`, `PRACTICE_ATTRIBUTED`, `REVIEW_ATTRIBUTED` | **0** | grep → only `:40-42` |
| `learning.insight.created`, `knowledge.gap.detected`, `study.strategy.updated` | **0** | grep → only `:47-49` |

Nuance: the 5 legacy types are emitted through `trackUserEvent()` (`study.service.ts:183-192` → `userEventRepository.record`, **no eventKey**) even though they sit in the *reserved canonical* list — so they are neither server-only-guarded nor idempotent.

**`eventKey` identity / uniqueness**: identity is the `(userId, eventKey)` pair (`schema.prisma:221`); `null` is allowed and Postgres permits many NULLs, so telemetry rows are unbounded duplicates by design. Idempotency example: `PLAN_GENERATED:{generationKey}` (`learning-loop-trigger.service.ts:82`) + duplicate check `hasTriggerKey` (`learning-loop-trigger.service.ts:66-68`).

**HTTP entry** — `POST /events`: `study.controller.ts:556-567` (canonical → 403 `:560-562`; non-allowlisted → 400 `:563-565`); service mirror `study.service.ts:237-246`; DTO `dto/user-event.dto.ts:3-11` (`type` 1..64 chars, `payload` object).

**Write-only signal**: `USER_ACTION_FEEDBACK` is persisted but never read — no query by that type exists (grep `USER_ACTION_FEEDBACK` → only adapter/repository/constants). Dedupe key built at `student-state-feedback.adapter.ts:45-47`.

## 2. StudyTask / recommendation lifecycle

| model | lines | key fields | idempotency |
|---|---|---|---|
| `StudyPlan` | 676-697 | `phase, targetScore, remainingDays, dailyHours, checkpoint, generationKey?, source?, modelVersion?, targetExamDate?, availableMinutes?, stale, status @default("ACTIVE")` (:679-690) | `@@unique([userId, generationKey])` :696 |
| `StudyTask` | 699-730 | `priorityScore?, recommendationAction?, reasonCodes Json?, scoreBreakdown Json?, generatedRank?, subject, chapter, title, mode, minutes, questionCount, scheduledDate, priority @default("低"), reason, nextAction, status @default("pending") :719, postponeCount :720, startedAt?, nextAvailableAt?, completedAt?, completed` | none; index `[planId, scheduledDate, status]` :729 |
| `StudyTaskCompletion` | 645-659 | `completedQuestionCount?, correctCount?, minutesSpent?, selfRating?, completedAt` | `@@unique([userId, taskId, completedDate])` :657 |
| `StudyTaskProgress` | 661-674 | cumulative `completedQuestionCount/correctCount/minutesSpent` | `@@unique([userId, taskId])` :672 |
| `RecommendationAction` | 224-250 | `actionType, targetType, targetId, reason, evidenceRefs Json, status @default("CREATED") :232, version @default(0) :233, creationKey :234, studyTaskId? @unique :235, startedAt?/completedAt?/cancelledAt?` | `@@unique([userId, creationKey])` :247 |

**Action status enum (string)**: `recommendation-action.repository.ts:5` `'CREATED' | 'STARTED' | 'COMPLETED' | 'CANCELLED' | 'EXPIRED'`.
Transitions with optimistic concurrency: `recommendation-action.service.ts:26-29` (`startAction` CREATED→STARTED, `completeAction` STARTED→COMPLETED, `cancelAction` CREATED|STARTED→CANCELLED, `expireAction` CREATED→EXPIRED); version guard `:19-25`.

**Idempotency keys**
- `creationKey` = `{userId}:{scheduledDate}:{actionType}:{targetType}:{targetId}` — `recommendation-action-adapter.service.ts:21-23`; generation-key variant `createRecommendationActionKey(...)` `:40-42`; upsert `:44-48` + P2002 retry `:49-57`.
- `generationKey` for plans: `StudyPlan.generationKey` (:684) + `createLearningLoopGenerationKey` (`learning-loop-trigger.service.ts:41`); probe plan uses `transfer-probe-plan:{userId}` (`transfer-probe.service.ts:514`).
- Note `recommendation-action.service.ts:6,14` still validates `actionType ∈ {PRACTICE, REVIEW}`; `TRANSFER_PROBE` and other new types must go through the adapter upsert path (`recommendation-action-adapter.service.ts:35-39`).

**Recommendation lifecycle: emitted vs status-only**

| fact | emitted event? | where stored |
|---|---|---|
| recommendation created | **NO** (`recommendation.created` count = 0) | `RecommendationAction.status='CREATED'` :232, adapter :46 |
| started | NO (`recommendation.accepted` = 0) | `status='STARTED'` + `startedAt` (`recommendation-action.service.ts:26`) |
| completed | NO (`recommendation.completed` = 0) | `status='COMPLETED'` + `completedAt` :27 |
| failed/cancelled/expired | NO (0) | `CANCELLED`/`EXPIRED` :28-29 |
| outcome signal derived from status | YES, as `USER_ACTION_FEEDBACK` | `action-learning-signal.service.ts:23-27` → `student-state-feedback.repository.ts:50-57` |
| exposure (did student see it) | YES, client telemetry only | `recommendation.exposed`/`.viewed` (:28-29), read by `recommendation-exposure.service.ts:63-67` |
| plan generated | YES `plan.generated` | `learning-loop-trigger.service.ts:79-92` |

## 3. Evidence layer

**Kinds / strength** — `packages/shared/src/score-center/learning-evidence.ts`
- `LearningActionType` :28-33 = `practice.answered | task.completed | review.marked | review.recalled | assessment.submitted`
- `EvidenceKind` :41 = `none | self_reported | recall_outcome | objective_performance`
- `EvidenceStrength` :43 = `none | weak | strong`
- published taxonomy `LEARNING_ACTION_TAXONOMY` :147-193 (per action: kind, strength, `canInfluenceMastery`); `classifyLearningAction` :198-258 — `review.recalled` with `recallObserved` → strong (:201-204); `observedAttempts > 0` → objective/strong (:216-218); `review.marked` → none/none (:232-242); `task.completed` self-report → weak (:245-248), else none (:249-257, basis :196).
- identity `learningEvidenceKey` :316-335 → `LEARNING_EVIDENCE:{userId}:{action}:{source}{:scope}{:occurrence}`; occurrence appended so legacy day key remains a prefix (:322-328).
- `summarizeLearningEvidence` :344-368 → `{total, strong, weak, none, abilityEvidenceCount, hasAbilityEvidence, basis}`.

**Recording service** — `apps/api/src/study/learning-evidence.service.ts`
- `LEARNING_EVIDENCE_EVENT_TYPE = 'EVIDENCE_RECORDED'` :34; canonical write with eventKey :329-354.
- Producers: `recordTaskCompletion` :77-102, `recordReviewMarked` :112-127, `recordReviewRecall` :137-151, `recordReviewRecallDurable` :161-175, `recordObservedPerformance` :178-209, `recordTaskCompletionEvidence` :221-236 (+ observed-outcome scan around completion, ±3d window :39, 200-row cap :40, :242-287).
- Read: `list()` :312-327; defensive decode with kind/strength/action allowlists :408-414,417-456.
- Call sites: `study.service.ts:2249` (review.marked), `:3542`, `:3597` (task completion), `:4786` (probe performance); `review-mastery-integration.service.ts:146`; `large-question.service.ts:135`.
- Route: `GET /coach/learning-evidence` `daily-brief.controller.ts:206-229` (self-only, no `userId` override).

**`task-evidence.ts` verdict enum + thresholds** — `packages/shared/src/score-center/task-evidence.ts`
- enum :55 `verdict: 'improved' | 'practiced' | 'practiced_no_gain' | 'insufficient_data'`.
- `resolveVerdict` :104-142: task not completed → `insufficient_data` (:111-113); `attempts === 0` → `insufficient_data` (:114-119); any node `delta > 0` → `improved` (:121-128); else `accuracyRate >= 60` → `practiced` (:131-137, note absence stated :136); else `practiced_no_gain` (:139-142).
- `masteryDeltas` computed from `atCompletion` vs `current` snapshots (:67-77). Service + route: `task-evidence.service.ts`, `GET /coach/task-evidence` `daily-brief.controller.ts:184-196`.

## 4. Mastery + score models

**`UserKnowledgeMastery`** — `schema.prisma:1007-1033`: `mastery @default(0.5)` :1011, `accuracy`/`recentAccuracy @default(0.55)` :1012-1013, `attempts/correctCount/wrongCount` :1014-1016, `retention?` :1017, `stabilityDays?` :1018, `lastLearnedAt?/lastReviewedAt?/nextReviewAt?` :1019-1021, **`confidence Float @default(0.0)` :1022**, `pinned` :1023, `version` :1024; `@@unique([userId, knowledgeNodeId])` :1031, `@@index([userId, nextReviewAt])` :1032.

Confidence formula — `packages/shared/src/score-center/mastery.ts:44`
`confidence: Math.min(1, 1 - Math.exp(-(attempts + 1) / 12))` (mirrored in `recommendation.service.ts:455`).
Related: EMA update `updateMasteryAfterAttempt` :24-46 (alpha PRIMARY/SECONDARY :32; target :20-21), `deriveNodeMasteryStatus` :68-73 (`untouched` / `weak <0.45` / `review <0.7` / `mastered`). Single writer is `ScoreCenterService.applyAttempts/applyReview` (`apps/api/src/score-center/service.ts`); the evidence layer is explicitly barred from writing mastery (`learning-evidence.service.ts:11-12`).

**`UserMasterySnapshot`** — `schema.prisma:1035-1051`: `mastery, attempts, correctCount, wrongCount, snapshotDate, createdAt`; `@@unique([userId, knowledgeNodeId, snapshotDate])` :1049; `@@index([userId, snapshotDate])` :1050.

**Score ledger (append-only, 4 tables)** — `schema.prisma:1084-1183`

| model | lines | fields | uniqueness |
|---|---|---|---|
| `ScorePrediction` | 1084-1108 | `predictionKey, modelVersion, predictedScore, predictedMin/MaxScore?, normalizedTotalScale 150, semantic @default("exam_total"), source @default("MODEL_OUTPUT"), generatedFor?, inputsSnapshot Json?, generatedAt` | `@@unique([userId, predictionKey])` :1106 |
| `ScoreAssessment` | 1110-1136 | `originType, originId, rawScore, rawTotalScale, normalizedScore?, semantic, source, gradingMethod?, examDate?, title?, evidenceRefs Json?, recordedAt` | `@@unique([userId, originType, originId])` :1134 |
| `ScoreOutcome` | 1138-1165 | `examType, dedupKey?, rawScore, rawTotalScale, normalizedScore?, semantic, source, verificationStatus @default("unverified"), verifiedBy?/verifiedAt?, occurredAt, evidenceRefs?, recordedAt` | `@@unique([userId, dedupKey])` :1163 |
| `ScoreCorrection` | 1167-1183 | `targetKind, targetId, correctedFields Json, reason, correctedBy, correctedAt` | index `[targetKind,targetId]` :1181 |

**Write-path guards** — `apps/api/src/score-anchor/score-anchor.service.ts`
- invariant summary :11-26 (provenance follows the actor; future dates rejected; rows never updated; unverified never enters primary stratum).
- prediction: range checks :102-107, duplicate read-back :108-112, unique race retry :131-140.
- assessment: `validateScoreEvidence` :158-166; **student claiming `TEACHER_GRADED` → 403** :171-173; `originType = external_import|teacher_entry` by role :174; **future `examDate` → 400** :176-182; `normalizeScore` :184-187; `originId = clientKey ?? assess-{uuid}` :189; dedupe :190-195, race :216-222.
- paper dual-write (best-effort, `semantic: 'accuracy_rate'`) :231-257; outcome `occurredAt` in the past + `verificationStatus` transition; corrections folded read-side via `resolveCorrectedEvidence` :656-674; access discipline (teacher authorization) :620-632.
- Routes — `score-anchor.controller.ts:33-97`: `POST coach/score-evidence/{predictions,assessments,outcomes,corrections}` `@Roles('student','teacher','admin')`; `POST .../outcomes/:id/verify` `@Roles('teacher','admin')` :73-75; `GET coach/score-evidence` :97-115 (student self-only :109). Prediction write is self-only :40-41.
- Migration: `prisma/migrations/20260912120000_score_anchor_foundation/migration.sql:2,5,36,81-87,105`.

**`User.examDate`** — `schema.prisma:160` with design note :157-159 ("the exam date is a FACT entered by the user; the legacy `remainingDays` … is never promoted back into a fact"). Column added by `20260912120000_score_anchor_foundation/migration.sql:2`.
**WRITER: NOT FOUND.** grep pattern `examDate` over `*.ts|*.tsx|*.js|*.mjs` repo-wide returns only reads (`score-anchor.service.ts:635,726`) plus `ScoreAssessment.examDate` writes (`:210`) and web copy ("可在个人信息中录入", `apps/web/src/features/report/ScoreAnchorPanel.tsx:112`). `remainingDays` (:152) is the field actually written/used (`learning-profile.repository.ts:43-48`).

## 5. Transfer probe state

**Identity constants** — `packages/shared/src/transfer-probe/transfer-probe.ts:21-27`
`TRANSFER_PROBE_ACTION_TYPE='TRANSFER_PROBE'` :21, `TRANSFER_PROBE_PLAN_SOURCE='transfer-probe'` :22, `TRANSFER_PROBE_SESSION_TYPE='transfer_probe'` :23, `TRANSFER_PROBE_POOL_SOURCE='transfer_probe_pool'` :24, `TRANSFER_PROBE_EVIDENCE_KIND='transfer_probe'` :25, `TRANSFER_PROBE_TASK_MODE='复测'` :26, `TRANSFER_PROBE_REASON` :27.
Windows :30-37 (`targetDaysAfter:2, minElapsedHours:36, graceDays:7, maxDeliveriesPerDay:3, minDaysBetweenProbesPerNode:14, interventionWindowDays:3`); gate :40-44 (`minSampleSize:5, mediumSampleSize:20, highSampleSize:50`); `deriveProbeCreationKey` :125-127 → `TRANSFER_PROBE:{userId}:{nodeId}:{scheduledDate}`.

**What is persisted** (no new tables; ownership discipline :10-15)

| fact | storage | evidence |
|---|---|---|
| probe identity | `RecommendationAction.actionType='TRANSFER_PROBE'` + 1:1 `StudyTask` (`studyTaskId @unique`) | `schema.prisma:227,235`; queries `transfer-probe.service.ts:140,234,313` |
| probe task | `StudyTask.mode='复测'`, `scheduledDate`, plan `source='transfer-probe'`, `generationKey='transfer-probe-plan:{userId}'` | `transfer-probe.service.ts:513-531` |
| probe attempts | `PracticeRecord` via `LearningSession.type='transfer_probe'` | `schema.prisma:345`; exclusion filter `transfer-probe.service.ts:616` |
| probe evidence | `UserEvent type='EVIDENCE_RECORDED'` + `detail.kind='transfer_probe'` (attempts/correct in `payload.metrics`) | written atomically in the submit tx: `study.service.ts:4774-4803` (`detail` :4793-4801) |
| eligibility audit | `practiceRecord`/`learningSession`/`question.familyId`/prior probe event | `transfer-probe.service.ts:450-486` |

**Projection** — `buildTransferProjection` `transfer-probe.ts:228-288`
- strata keyed `(nodeId, kind, bucket, isomorphism)` and never merged (:222-227,239); `invalidated` excluded entirely (:237).
- **Evidence gate**: `const gateMet = stratum.attempts >= TRANSFER_PROBE_GATE.minSampleSize` :251; `transferRate` is `null` below the gate (:252) — "honest absence, never zero" (:203).
- `sampleConfidence` :257-263 (null / high ≥50 / medium ≥20 / low); `transferGap = transferRate − practiceAccuracy` :264-266; `gate: gateMet ? 'reported' : 'insufficient_data'` :280.
- Service: `TransferProbeProjection` `transfer-probe.service.ts:573-695`; `loadProbeEvents` :581-606 (1000 rows); `practiceAccuracyByNode` :608-629 (excludes probe sessions :616); `getTransferObservation` (self, events only) :632-663 — note :661 `聚合迁移结论（TransferRate/Gap）… 由教师/管理员视图提供`; `getTransferSummary` (teacher/admin) :666-695.
- Routes — `transfer-probe.controller.ts:29` (`coach/transfer-probes`, student+), `:37` (`coach/transfer-observation`, self events only), `:47-49` (`coach/transfer-summary`, `@Roles('teacher','admin')`).
- Eligibility verdicts: `evaluateProbeEligibility` :163-172, reject enum :150-157 (`not_in_pool, prior_attempt, prior_exposure, same_family_seen, previously_used_as_probe, difficulty_mismatch, type_mismatch`).
- Harnesses: `scripts/integration-transfer-probe.mjs` (asserts `transferRate === null` below gate, exactly one evidence event per probe), `scripts/analyze-transfer-probe-e2.mjs:72-83`.

## 6. Existing measurement / analytics services

| service | path | computes | gate | route + guard | student-facing consumer |
|---|---|---|---|---|---|
| effectiveness | `apps/api/src/effectiveness/effectiveness.{controller,service,assembly}.ts` | per-node `masteryBefore/After/gain`, `attemptsInWindow`, `accuracyInWindow`, `evidenceGate` (`service.ts:120-147`); profile archetype `classifyStudent` (`learning-effectiveness.ts:31-59`); experiments verdict `A_better|B_better|no_significant_difference|insufficient_data` (`learning-effectiveness.ts:78`) | `EVIDENCE_GATE {minSampleSize:5, minEffectSize:0.05, requiredConfidence:'medium'}` (`effectiveness.assembly.ts:62-70`); `MIN_WINDOW_ATTEMPTS=2` (`outcome-pipeline.ts:44`); experiments `minSampleSize:3` (`effectiveness.service.ts:362`) | `GET /effectiveness/{summary,outcomes,interventions}` `@Roles('student','teacher','admin')` (`controller.ts:28-64`); `/experiments` `@Roles('teacher','admin')` :70-72 | **YES** — `apps/web/.../endpoints/effectiveness.ts:69` → `EffectivenessPanel.tsx:44,51` → `ReportWorkspace.tsx:150`; server-side `daily-brief.controller.ts:486`, `sprite.controller.ts:180`, `study.service.ts:1203` |
| ai-metrics | `apps/api/src/ai-metrics/ai-metrics.{service,controller}.ts` | in-memory ring `MAX_EVENTS=5000`, `WINDOW_MS=3600000` (`service.ts:94-95`): failure/hit/cache/fallback rates, `p95LatencyMs` (:322-326), token sums; `evaluation.passRate: 0` hardcoded (:194); `snapshotLearningIntelligence` :201-241 (risk bySeverity, `gatePassed/gateInsufficient`) | none (only window/cap) | `GET /ai/metrics`, `GET /ai/learning-intelligence` `@Roles('admin')` (`controller.ts:18-28`) | **NO** — grep `ai/metrics|ai/learning-intelligence` in `apps/web/src` → 0 |
| beta-metrics | `apps/api/src/study/beta-metrics.service.ts` | `calculate()` :20-120 `core` block :106-117: registration/diagnostic/first-task completion, **day1/day7 retention** (`retention()` :141-152), weekly plan completion, wrong-question second accuracy, mock completion, api failure, session recovery | none; `rate = denominator>0 ? … : null` :126 | `GET /admin/metrics` `@Roles('admin')` (`study.controller.ts:759-761` → `study.service.ts:1606-1611`) | **NO** (admin web panel only: `apps/web/.../endpoints/dashboard.ts:229`) |
| outcome-tracking | `packages/shared/src/score-center/outcome-tracking.ts`; consumer `apps/api/src/study/learning-impact.service.ts:171` | before/after windows around an action on the same node: attempts, accuracy, wrong count, mastery; verdict :56 | `OUTCOME_WINDOW_DAYS=14` :61; `after.attempts < 3` → `insufficient_data` :124; `rateLift>=10` or `masteryLift>=0.1` → `improved` :145 | `GET /coach/outcome-tracking` `@Roles('student','teacher','admin')` (`daily-brief.controller.ts:451-453`), self-scoped :458 | **NO** — grep `coach/outcome-tracking` in `apps/web/src` → 0 |
| mastery-calibration | `packages/shared/src/score-center/mastery-calibration.ts`; consumer `learning-impact.service.ts:92` | stored EMA vs observed recent accuracy per node: `evidenceEstimate`, `difference`, `suggestedDirection` :29-37 | `CALIBRATION_DIRECTION_THRESHOLD=0.15`, `HIGH=10`, `MEDIUM=5`, `MAX=20` :14-17; sample 0 → `null` + `'hold'` :51-60 | `GET /coach/mastery-calibration` `@Roles('student','teacher','admin')` (`daily-brief.controller.ts:436-438`) | **NO** (grep in web → 0) |
| score-calibration | `packages/shared/src/score-center/score-calibration.ts`; consumer `apps/api/src/study/score-calibration.service.ts:263,405` | prediction vs recorded assessment: MAE / signed bias / range coverage; strata per provenance :259; `authoritative:false` :278 | `CALIBRATION_MIN_SAMPLE = 5` :60 (values null below :239-246); `improvement` needs ≥2 rows :300 | `GET /coach/score-calibration` `@Roles('teacher','admin')` (`daily-brief.controller.ts:332-334`) | **NO** |
| data-quality | `apps/api/src/study/admin-data-quality{,.service}.ts` | catalog coverage: `coverageRate` (:69-72, empty catalog → 100), `healthFlags` :88-100, samples capped `SAMPLE_MAX=10` (`service.ts:14`) | none | `GET /admin/data-quality` `@Roles('admin')` (`study.controller.ts:749-751`), 503 when store absent :753-755 | **NO** |

## 7. Experiment assignment

- Function: `assignExperimentArm` — `apps/api/src/study/coach-experiments.ts:15-22`
  ```ts
  const digest = createHash('sha256').update(`${userId}::${experimentKey}`).digest();
  return arms[digest[0] % arms.length];
  ```
  Algorithm: SHA-256 of `userId::experimentKey`, first byte mod arm count → deterministic, sticky per user+experiment, **no persistence** (:4-5 "no persistence, no peeking"); default arms `DEFAULT_EXPERIMENT_ARMS = ['control','variant']` :13.
- **Every call site** (grep `assignExperimentArm` over repo → 3 hits incl. import):
  1. `daily-brief.controller.ts:25` (import)
  2. `daily-brief.controller.ts:135` — inside `GET /coach/experiment-assignment` :125-137, `@Roles('student','teacher','admin')`; responds `{ key, arm }` only (:136) — "the endpoint only labels — features decide what varies" (:122-124).
- Generic arm container used by the *post-hoc* cohort comparison: `ExperimentArm` `effectiveness/learning-effectiveness.ts:63`, `runExperiment(armA, armB)` :88-89; proposal-only (`requiresApproval: true`), `@Roles('teacher','admin')` (`effectiveness.controller.ts:70-72`).
- **Does any experiment vary student-visible behaviour? NO.** No web consumer of the assignment endpoint (grep `experiment-assignment` over `apps/web/src` → 0), no arm persisted, no arm consulted by any recommendation/projection module. Arms are labels returned to a caller that does not act on them.
- Adjacent signal: `deriveFeedbackInsights` :44-64 with `NEGATIVE_RATING_MAX=2` :36, `CANDIDATE_NEGATIVE_MIN=3` :37 → `GET /coach/feedback-insight` `@Roles('teacher','admin')` (`daily-brief.controller.ts:143-145`).

## 8. Guidance-relevant existing state (reusable triggers)

| fact needed for contextual guidance | model/field or event | file:line | exists? |
|---|---|---|---|
| first login / onboarding done | `User.createdAt`, `User.onboardingCompletedAt` | `schema.prisma:162,161` | YES |
| last login / last seen | — | — | **NOT FOUND** (grep `lastLogin|lastLoginAt|lastSeenAt|firstLogin` in `prisma/schema.prisma` → 0) |
| activity proxy for "student returned" | `OperationLog.createdAt`; `UserEvent.createdAt` | `schema.prisma:288,217` | YES |
| session counts / recency | `LearningSession.{type,completed,startedAt,lastActiveAt,totalActiveMs}` | `schema.prisma:345,357,353,354,355`; counted `student-state-reminder-query.service.ts:111-117` | YES |
| wrong-question counts | `WrongQuestionReview.{resolved,resolvedAt}`; `StudentStateSnapshot.wrongQuestionSummary` | `schema.prisma:636-637`; `student-state.snapshot.ts:43-50` (built :194) | YES |
| review schedule state | `ReviewSchedule.{nextReviewAt,stability,consecutiveCorrect,reviewCount,lastReviewedAt}`; `ReviewAttempt` | `schema.prisma:759-762,773-797`; `StudentStateSnapshot.reviewDue` :60-65 | YES |
| streak | **computed, never stored** — `buildMomentum` walks activity days | `student-context.selector.ts:367-377`; also `student-state-reminder-query.service.ts:58-93` | YES (derived; no `streak` column — grep `streak` in `schema.prisma` → 0) |
| task completion | `StudyTaskCompletion` unique `(userId,taskId,completedDate)`; `StudyTask.{status,postponeCount,completedAt}`; `StudyTaskProgress` | `schema.prisma:657,719-724,661-674` | YES |
| exposure telemetry | `recommendation.exposed` / `recommendation.viewed`; read via `listByType` | `canonical-event-writer.service.ts:28-29`; `recommendation-exposure.service.ts:63-67`; null-when-absent semantics `packages/shared/src/score-center/recommendation-exposure.ts:94,101-102,129` | YES (client-originated only) |
| mastery + gap facts | `UserKnowledgeMastery`; `StudentContextMastery.{weakNodes,weakPoints,improvingPoints,masteredPoints}` | `schema.prisma:1007`; `student-context.contract.ts:94-104` | YES |
| evidence receipts | `EVIDENCE_RECORDED` payload (kind/strength/metrics/detail) | `learning-evidence.service.ts:344`; taxonomy `learning-evidence.ts:147-193` | YES |
| probe state | section 5 | — | YES |
| exam countdown | `User.remainingDays` (derived cache) | `schema.prisma:152` | YES |
| exam date fact | `User.examDate` — column exists, **no writer** | `schema.prisma:160`; reads only `score-anchor.service.ts:635,726` | Column YES / write path **NOT FOUND** |
| trial checklist (5 onboarding items) | `buildTrialProgressDto` from goal/task/practice/wrong/feedback counts | `student-state-trial-progress.adapter.ts:29-79` | YES |
| feedback (rating + scene) | `FeedbackSubmission.{rating,scene,status,message}` | `schema.prisma:255-258` | YES |
| arbitrary guidance state store | `RuntimeState.{key,value Json}` — keys in use: `coach-session:{userId}`, `sprite-memory:{userId}`, `questionReviewItems` | `schema.prisma:742-746`; `coach-session.repository.ts:16-20`; `sprite-memory.repository.ts:16-20`; `questions.service.ts:52` | YES |
| "guidance shown / dismissed" state | — | grep `dismiss\|Dismiss` over `apps/api/src` → 0; no column/table | **NOT FOUND** |
| experiment arm per user | — | `assignExperimentArm` has no storage (`coach-experiments.ts:15-22`) | **NOT FOUND** |

## 9. Existing "guidance"-like backend systems

| system | entry (file:line) | trigger inputs | output shape | cap / dedup / persistence | dismissible + remembered? |
|---|---|---|---|---|---|
| sprite (mood/milestones/persona/memory) | `buildSpriteState` `sprite-state.ts:167`; mood ladder :231; milestones :411; persona `sprite-persona.ts:103`; memory `sprite-memory.ts:29,43` | `context.momentum.studyStreak` :169, `review.dueCount/overdueCount` :170, `practice.recentAccuracy.status` :171, plan carry-over :264,272, intervention severity :283, story `weekDelta/gatesPassed/resolvedCount` :300,312,320 | `SpriteState` :128 (mood, moodReason + evidenceRefs, presence, lines, bond/milestones, memory ≤3) | `milestones.slice(0,3)` :218; memory `slice(0,3)` :225 and `MAX_SPRITE_MEMORY_ENTRIES = 12` (`sprite-memory.ts:14`) with exact-text dedupe :54; memory persisted in `RuntimeState` (`sprite-memory.repository.ts:52-55`); **bubble frequency cap is client-localStorage only** | memory deletion persisted (`sprite.controller.ts:154`); server-side dismiss **NOT FOUND** |
| coach/proactive | `deriveProactiveInterventions` `adaptive/proactive-coach.ts:92`; risks `learning-risk.ts:32`; signals `learning-signals.ts:100`; route `GET /coach/proactive` `daily-brief.controller.ts:97-119` | mastery weak/improving/mastered nodes, review due/overdue, recent accuracy, streak/active days, plan completion, high-risk questions, baseline regressions (`learning-signals.ts:104-198`) | `ProactiveIntervention` `proactive-coach.ts:21` (id, trigger, severity, headline, actions, actorHint, knowledgeNodeId?) | cap `slice(0, 2)` `daily-brief.controller.ts:111` (same `sprite.controller.ts:210-211`); id embeds date (`proactive-coach.ts:98`) but is never checked; **no persistence**, recomputed per request | **NOT FOUND** (grep `dismiss\|Dismiss` → 0) |
| coach/daily-brief | `buildDailyBrief` `daily-brief.ts:43`; route `daily-brief.controller.ts:59-89` | `exam.remainingDays` :73, `momentum.studyStreak` :74, recentAccuracy :76-77, review due/overdue :79, plan tasks + summary :80-87 | `DailyBrief` :35 (dateKey, headline, stateLines, priorities, followUpNote) | **NO CAP / NO DEDUP**; `dateKey` only echoed; not persisted | **NOT FOUND** |
| coach/progress-narrative | `buildProgressStory` `progress-narrative.ts:40`; route `daily-brief.controller.ts:475-502` | mastery trend 14d :485, recentAccuracy + baseline :491-493, effectiveness `outcomeCorrelation.matched` :496, `review.resolvedCount` :498, streak :499 | `ProgressStory` :29 (lines with kind `gain|decline|flat|milestone|no_data` :22, weekDelta) | NO CAP / NO DEDUP; validity gate only (≥2 points `progress-narrative.ts:36`); not persisted | **NOT FOUND** |
| coach/weekly* → weekly intensity | `deriveWeeklyAdjustment` `weekly-adjustment.ts:33`, `applyWeeklyIntensity` :78; caller `study.service.ts:1204` (inside `getTodayPlan`) | `effectiveness.getOutcomes(userId,7)` attempts/gain/gate (`study.service.ts:1203-1209`), `openDebt` :1210; thresholds `MIN_EVALUATED_ATTEMPTS=2`, `UP_GAIN=0.1` (`weekly-adjustment.ts:28-29`) | `WeeklyAdjustment` :21 (`intensity_up|maintain|intensity_down`, factor, note, evidence) | recompute only when no current window (`study.service.ts:1191-1195`); **persisted** into the plan `weeklyAdjustment` (`:1219`; field `onboarding-plan.repository.ts:53`; read back `:1276`) | **NOT FOUND** |
| other rule-based reminders | `buildStudyRemindersDto` `student-state-reminder.adapter.ts:63`; route `GET /study-reminders` `study.controller.ts:207-215` | weak points, due/wrong question, today tasks, activity (streakDays/todayPracticeCount), trial progress (`student-state-reminder-query.service.ts:28-134`) | `StudyRemindersDto` :16 (items with type `weakness|wrong-question|daily-task|habit|trial|feedback`, priority, actionAnchor) | NO CAP / NO DEDUP; recomputed, not persisted | **NOT FOUND** |
| contextual coach (LLM) | `POST /ai/contextual-coach` `study.controller.ts:382` (rejects body `userId` :389) | `StudentContext`/`StudentState` assembled per request (`contextual-coach-context-assembler.service.ts:43`) | `ContextualCoachResponse` `contextual-coach.types.ts:60` | conversation persisted in `RuntimeState` key `coach-session:{userId}` (`coach-session.repository.ts:5,16-20`) | no dismiss; session is a memory, not a dismissal |

Cross-cutting: the **only real exactly-once dedup in the repo is plan generation** (`plan.generated` `eventKey` + `triggerKey` scan: `learning-loop-trigger.service.ts:66,82`; `user-event.repository.ts:118-129`), not guidance delivery.

## 10. Where student-visible behaviour can change with zero schema change

| extension point | evidence |
|---|---|
| **`RuntimeState` key/value JSON store** (guidance state, once-per-day keys, dismissal memory) — reuse the existing `coach-session:{userId}` / `sprite-memory:{userId}` pattern | `schema.prisma:742-746`; `coach-session.repository.ts:16-20,51-59`; `sprite-memory.repository.ts:16-20,49-57` |
| **`UserEvent` append-only log**: `type` is free String, `payload` free Json, and `(userId,eventKey)` gives structural exactly-once | `schema.prisma:214-216,221`; writer `canonical-event-writer.service.ts:85-96`; `deriveEventKey` :108-123 |
| **Allowlist extension points** for new event types (no migration) | `TELEMETRY_EVENT_TYPES` `canonical-event-writer.service.ts:5-30`; `RESERVED_CANONICAL_EVENT_TYPES` :32-56; `isTelemetryEventType` :60-62 |
| **Client-observable telemetry channel** `POST /events` + validation | `study.controller.ts:556-567`; `study.service.ts:237-246`; DTO `dto/user-event.dto.ts:3-11` |
| **String enum-like columns that accept new values** | `RecommendationAction.actionType` `schema.prisma:227` (already extended with `TRANSFER_PROBE`, `recommendation-action-adapter.service.ts:35-39`), `status` :232; `LearningSession.type` :345; `StudyTask.mode/status/priority` :712,719,716; `StudyPlan.phase/source/status` :679,685,690; `FeedbackSubmission.scene/status` :256,258; `ScoreAssessment.originType/semantic/source/gradingMethod` :1114-1125; `ScoreOutcome.examType/verificationStatus` :1142,1154; `User.studyStage` :153 |
| **DTO allowlists to widen (or deliberately keep closed)** | session types `@IsIn(['practice_set','stage_assessment','paper'])` `dto/learning-session.dto.ts:20`; plan adjust `@IsIn(['reduce','priority_only'])` `dto/plan-adjustment.dto.ts:20`; event type 1..64 chars `dto/user-event.dto.ts:4-7` |
| **JSON payload columns already carried verbatim** | `StudyTask.reasonCodes/scoreBreakdown` :706-707; `RecommendationAction.evidenceRefs` :231; `ScoreAssessment.evidenceRefs` :1130; evidence `detail` `learning-evidence.ts:109` |
| **Projection endpoints a guidance layer can extend** | `GET /student-state` `study.controller.ts:175`; `GET /student-context` :185; `GET /study-reminders` :207; `GET /trial-progress` :197; `GET /sprint-plan` :217; `GET /coach/daily-brief` `daily-brief.controller.ts:59`; `/coach/proactive` :97; `/coach/progress-narrative` :475; `GET /sprite/state` `sprite.controller.ts:43` |
| **Canonical read models to reuse instead of a new engine** | `StudentContext` `student-context.contract.ts:197-210`; `StudentStateSnapshot` `student-state.snapshot.ts:101-111` (explicitly non-persisted, `:1-5`) |
| Not extensible without migration | `User.trialStatus` (`enum TrialStatus` `schema.prisma:21`, field :147), `Subject`/`Difficulty`/`QuestionType`/`AccountStatus`/`EvidenceConfidence`/`AnswerReceiptStatus` enums |

---

## Bottom line

- **Exists**: append-only event log with exactly-once identity (`UserEvent.type`/`eventKey`); evidence layer with strength taxonomy + honest-null; single-writer mastery with a confidence formula; 4-table score ledger with write guards; gated transfer probe; rich guarded read models (`StudentContext`, `StudentStateSnapshot`, coach projections).
- **Missing**: persisted guidance shown/dismissed state; persisted experiment arm or student-visible arm effect; last-login/last-seen field; a writer for `User.examDate`; server-side frequency cap or dedup on any guidance surface.
- **Off-the-shelf KPIs**: day1/day7 retention + funnel rates (`beta-metrics.service.ts:106-117`); accuracy/mastery gain behind `EVIDENCE_GATE` (`effectiveness.assembly.ts:62-70`); score MAE/bias/coverage behind `CALIBRATION_MIN_SAMPLE=5` (`score-calibration.ts:60`); probe TransferRate/TransferGap behind `minSampleSize=5` (`transfer-probe.ts:40-44,251`); task-evidence + outcome-tracking verdict enums.
- **Top zero-migration extension points**: `RuntimeState` JSON KV with the `{prefix}:{userId}` convention (guidance/dismissal state); `UserEvent.type` + `eventKey` (new server events, exactly-once); `RecommendationAction.actionType` / `LearningSession.type` / `StudyTask.mode` string columns (new action kinds); `POST /events` (client-observed exposure); existing `/coach/*` + `/student-*` projections (render surface).
