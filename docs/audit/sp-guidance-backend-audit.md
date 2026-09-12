# Backend → Student guidance audit (SP guidance)

Scope: `apps/api/src/study/`, `apps/api/src/score-center/`, `apps/api/src/transfer-probe/`, `apps/api/src/score-anchor/`, `packages/shared/src`. Code is the only source of truth. All citations `path:line`.

Routing note: there is **no global prefix** (grep `setGlobalPrefix` in `apps/api/src` → No matches), so paths below are literal. **NOT FOUND** `apps/api/src/study/transfer-probe/` (glob `apps/api/src/study/**/transfer*` → 0); the probe lives at `apps/api/src/transfer-probe/`. **NOT FOUND** `apps/api/src/study/progress-narrative*` beyond one file (`progress-narrative.ts`, imported by `daily-brief.controller.ts:475`).

---

## 1. Recommendation explanation

### 1.1 Reason-code enum (authoritative)

`packages/shared/src/score-center/types.ts:19-28`

```ts
export type PriorityReasonCode =
  | 'HIGH_RECENT_FREQUENCY' | 'LOW_MASTERY' | 'LOW_ACCURACY' | 'REPEATED_WRONG'
  | 'REVIEW_DUE' | 'RISING_TREND' | 'PREREQUISITE_GAP' | 'EXAM_NEAR' | 'LOW_EVIDENCE';
```

Secondary, non-shared enum: task-level codes derived at read time (`apps/api/src/study/task-reason-codes.ts:27-30` thresholds; emitted set is a **subset** of the above, 4 codes only).

### 1.2 Emit sites (thresholds)

| Site | Trigger | file:line |
|---|---|---|
| `HIGH_RECENT_FREQUENCY` | `recent3Y.frequency >= 4` | `priority.ts:102` |
| `LOW_MASTERY` | `mastery < 0.55` | `priority.ts:103` |
| `LOW_ACCURACY` | `recentAccuracy < 0.65` | `priority.ts:104` |
| `REPEATED_WRONG` | `wrongCount >= 3` | `priority.ts:105` |
| `REVIEW_DUE` | `forgetting >= 0.55` | `priority.ts:106` |
| `RISING_TREND` | `trend.direction === 'RISING'` | `priority.ts:107` |
| `EXAM_NEAR` | `daysToExam <= 45` | `priority.ts:108` |
| `LOW_EVIDENCE` | `evidence.evidenceConfidence === 'LOW'` | `priority.ts:109` |
| `PREREQUISITE_GAP` | candidate swapped for unmet prerequisite | `plan.ts:76-78` |
| `REVIEW_DUE` (forced) | REVIEW item invariant | `recommendation.ts:159` |
| classic-task codes | weak-list membership + accuracy/wrong/days | `task-reason-codes.ts:36-43` |

All in `packages/shared/src/score-center/`.

### 1.3 Consumer copy mapping

- **`REASON_LABELS` (the only shared label map)** — `packages/shared/src/nodePlan.ts:41-51`, e.g. `LOW_MASTERY: '掌握度偏低'`, `LOW_EVIDENCE: '考频证据不足'`. Applied at `nodePlan.ts:123`: `reason: draft.reasonCodes.map((code) => REASON_LABELS[code] ?? code).join('，')`.
- Frontend duplicate: `apps/web/src/features/today-score-center/reason-copy.ts:2-10` (different copy: `LOW_EVIDENCE: '个人数据较少，当前为冷启动建议'`). Two vocabularies exist.
- **Raw-code leak**: score-center-generated tasks store the **English code string**, not a label — `apps/api/src/study/recommendation.service.ts:245` `reason: draft.reasonCodes.join('、')`. That `reason` is what `GET /today/plan` returns (`daily-brief.controller.ts:83`, `study.service.ts:1316`) and what the daily brief prints (`daily-brief.ts:74`). A student can therefore see e.g. `LOW_MASTERY、REPEATED_WRONG`.

### 1.4 Machine-readable score breakdown

- Type `PriorityBreakdown { examValue, weakness, forgetting, difficulty, trend, pinned }` — `types.ts:60-67`; weights `priority.ts:11-18`; computed `priority.ts:68-86`; `score` returned alongside `reasons` (`priority.ts:88-92`).
- Persisted per task: `recommendation.service.ts:251` `scoreBreakdown: (breakdownByNode.get(...) ?? {}) as Prisma.InputJsonValue`.
- Returned to students by `GET /score-center/generate` and the `today/plan.scoreCenter` block: `apps/api/src/score-center/service.ts:661` `scoreBreakdown: task.scoreBreakdown ?? {}`. `GET /today/plan` spreads the whole task row (`study.service.ts:1252-1258`), so `priorityScore` + `scoreBreakdown` + `reasonCodes` are all present.
- `GET /knowledge/mastery` returns **no** breakdown and **no** reason codes.

### 1.5 Fabricated / filler reasons — CONFIRMED

**Padding to a minimum count** — `packages/shared/src/score-center/priority.ts:111-121`:

```ts
if (reasons.length < 2) {
  const genericPool: Array<{ code: PriorityReasonCode; value: number }> = [
    { code: 'HIGH_RECENT_FREQUENCY', value: breakdown.examValue },
    { code: 'LOW_MASTERY', value: breakdown.weakness },
    { code: 'REVIEW_DUE', value: breakdown.forgetting },
  ];
  for (const candidate of [...genericPool].sort((l, r) => r.value - l.value)) {
    if (reasons.length >= 2) break;
    if (!reasons.includes(candidate.code)) reasons.push(candidate.code);
```

If no real trigger fired, this injects up to 2 codes chosen only by which **component is largest** — e.g. a node with rising frequency but high mastery and no forgetting gets `LOW_MASTERY`/`REVIEW_DUE` labels the student will read as fact. This is the single most decision-relevant honesty defect in recommendation explanation.

**Fabricated reason string** — `recommendation.service.ts:318`:

```ts
reason: draft.reasonCodes.join('、') || `recommendation:${draft.action}`,
```

When the code list is empty (possible: `task-reason-codes.ts:37` `if (!weak) return [];`), the persisted `RecommendationAction.reason` becomes the literal machine string `recommendation:LEARN`.

**Honest counter-examples** (documented and enforced): `task-reason-codes.ts:12-13,37` — "no fabricated justification", returns `[]` for an untracked point; `priority.ts:109` LOW_EVIDENCE is emitted for neutral evidence (`recommendation.service.ts:405-416`).

### 1.6 Actionable identity

- `RecommendationAction` rows carry a real id; student endpoints `POST /recommendation-actions`, `/start`, `/complete`, `/cancel`, `GET /:id/outcome|learning-signal|feedback` — `study.controller.ts:75-131`, all `@Roles('student','teacher','admin')`.
- Proactive interventions do **not**: `id` is synthetic `${risk.type}-${asOf.slice(0,10)}-${index}` (`apps/api/src/adaptive/proactive-coach.ts:98`); `actorHint: 'review'|'plan'|'practice'|'coach'` is a symbol, not an endpoint (`proactive-coach.ts:27,103`); `knowledgeNodeId` is optional (`proactive-coach.ts:104`). Its `actions` are **static per risk type** (`proactive-coach.ts:45,55,66,71,76,81`) — identical strings for every student with that risk.

---

## 2. Student-visible honesty states

### 2.1 Explicit "insufficient / unknown / unavailable"

| String / value | Where | file:line |
|---|---|---|
| `'练习量还不足以评估正确率（继续积累）'` | daily brief stateLines | `study/daily-brief.ts:67` |
| `'复习计划已清零'` / `'今日计划已清空，做一组推荐练习保持手感'` | daily brief | `daily-brief.ts:63,56` |
| `'掌握度快照不足，暂无法对比上周——继续练习会自动积累。'` | progress story `kind:'no_data'` | `study/progress-narrative.ts:59` |
| `mood:'unknown', kind:'insufficient_data', detail:'练习样本不足，尚无法形成任何判断'` | sprite state | `study/sprite-state.ts:378-387` |
| `'我还不够了解你——先做一组小练习，我才能真正帮上忙。'` | sprite line | `study/sprite-persona.ts:223` |
| `'这次没读到你的学习数据。不是你的问题，稍后再试试。'` | sprite `context_unavailable` | `sprite-persona.ts:234` |
| `verdict:'insufficient_data'` + `verdictBasis:'任务已完成，但完成标记≠能力证据…'` | task evidence | `shared/…/task-evidence.ts:112,115-119` |
| `'…暂无掌握度快照，暂无法判断能力变化。'` | task evidence | `task-evidence.ts:136` |
| `'完成标记≠学习发生…'` | learning-evidence activity-only | `learning-evidence.ts:196` |
| `'尚无学习证据记录：系统不会在缺少证据时给出能力判断。'` / `'…系统拒绝据此判断能力变化。'` | evidence summary `basis` | `learning-evidence.ts:353-357` |
| `'曝光遥测尚无数据，无法判断该推荐是否被学生看到。'`; `exposed: null` | recommendation funnel | `shared/…/recommendation-exposure.ts:190,205,59-61` |
| `'没有"预测 + 实测分数"成对的记录，因此不给出校准结论（没有误差 ≠ 没有数据）。'` | calibration basis | `shared/…/score-calibration.ts:290` |
| `status: 'not_started'` | `CalibrationEvidenceStatus` | `shared/score-anchor/score-anchor.ts:337,342` |
| `verdict='insufficient'`, summary `正确率 --%` | stage report | `packages/shared/src/stageReport.ts:124,131` |
| `status:'insufficient_data'`, `value:null`, `sampleSize:0` | StudentContext trends | `study/student-context.contract.ts:11,28-36` |
| `learningState:'insufficient_data'`, `dataQuality.status:'insufficient_data', reasons:['no_learning_facts']` | overview report | `study/overview-report-projection.service.ts:51-52,254,396-397` |
| `reason:'store_unavailable'` (17 sites, student-reachable) | daily-brief controller | `daily-brief.controller.ts:168,189,193,215,225,248,255,279,285,309,315,341,345,375,386,421,428,441,445,456,460` |
| `{ storeAvailable: false, reason: 'store_unavailable' }` | score anchor, transfer probe | `score-anchor/score-anchor.controller.ts:42,57,69,81,93,112`; `transfer-probe.controller.ts:42,52` |
| `bestAccuracy: 0` when store disabled | node quest | `score-center/service.ts:499,515` |

### 2.2 `null` = "not measured" (correct usage)

- `score-center/service.ts:377` `userState: mastery ? { … } : null`; `:329` `frequency: … : null`.
- `score-anchor/score-anchor.service.ts:726` `examDate: user?.examDate?.toISOString() ?? null`.
- `stage-assessment.adapter.ts:29-31` `bestScore/latestScore/latestAccuracyRate: number | null`.
- `task-evidence.ts:52,65` `accuracyRate: number | null` ("only when an observation exists"); `masteryDeltas…before/current/delta: number | null`.
- `transfer-probe.ts:203-204` `/** null when the gate is not met — honest absence, never zero. */ transferRate: number | null`.

### 2.3 `0` (or another constant) used where "not measured" is meant — CONFIRMED

| Fabrication | file:line |
|---|---|
| `averageMastery: practicedPoints.length ? … : 0` — an unpracticed student reads mastery **0**, not "unknown" | `mastery-summary-projection.service.ts:310-312` |
| `NEUTRAL_MASTERY = { mastery: 0.5, accuracy: 0.55, recentAccuracy: 0.55, attempts: 0, confidence: 0 }` injected as the student's state when no mastery row exists | `apps/api/src/score-center/repository.ts:34-41`, used at `recommendation.service.ts:146` |
| `overallAccuracyRate = … : 55` — **55 % accuracy invented** for a student with zero attempts | `recommendation.service.ts:207` |
| `daysToExam = … : Math.max(0, user?.remainingDays ?? 96)` — 96 days invented | `recommendation.service.ts:117` |
| `mastery ?? 0.5`, `recentAccuracy ?? 0.55` — defaults read as measurements | `priority.ts:52-53` |
| `estimateRetention()` → `0.5` for "unknown" (`lastReviewedAt/stabilityDays == null`) | `mastery.ts:53` |
| `recommendation.ts:31` `retention == null ? 0.5 : …` then used as a real forgetting value | `recommendation.ts:31,95` |
| `practiceAttempts: practice?.attempts ?? 0` — literal 0 indistinguishable from measured zero | `transfer-probe.service.ts:275` (via subagent) |
| `accuracyRate: attempts.length > 0 ? … : null` **is** honest — contrast case | `task-evidence.ts:64-65` |

The NEUTRAL_MASTERY injection is the root cause: a cold-start student's recommendation `facts.mastery` is reported as `0.5` (`recommendation.ts:141-146`) and the same 0.5 feeds ranking, so "mastery 0.50" is simultaneously a displayed fact and an unmeasured placeholder.

---

## 3. Mastery semantics surfaced to students

| Endpoint | Roles | Returned mastery fields | Confidence field? | file:line |
|---|---|---|---|---|
| `GET /knowledge/mastery` | student/teacher/admin | `mastery` (0–1 raw), `accuracy`, `recentAccuracy`, `attempts`, `correctCount`, `wrongCount`, `status` (`untouched|weak|review|mastered`), `questStatus`, `lastLearnedAt/lastReviewedAt/nextReviewAt` (ISO\|null) | **NO** | `score-center/routes.ts:29-34`; `score-center/service.ts:459-491` |
| `GET /knowledge/:id` | student+ | `userState.{mastery, accuracy, recentAccuracy, attempts, correctCount, wrongCount, retention, stabilityDays, last*At, nextReviewAt, **confidence**, pinned}` or `null` | YES | `score-center/service.ts:361-377` |
| `GET /dashboard/overview`, `GET /mastery-map` | student+ | `averageMastery` (int %), per-point `masteryRate`, `accuracyRate`, `practiceCount`, `wrongCount`, `status` | **NO** | `mastery-summary-projection.service.ts:56-68`; `study.controller.ts:227-235` |
| `GET /student-state` | student+ | `mastery.source: 'user_knowledge_mastery'\|'empty'`, `averageMastery`, weak counts | **NO** | `student-state.snapshot.ts:21-22,224-228` |
| `GET /coach/mastery-calibration` | student+ | stored mastery vs observed accuracy entries | entry-level | `daily-brief.controller.ts:436-448`; `learning-impact.service.ts:40-102` |
| `GET /coach/progress-narrative` | student+ | `masterySeries` → `weekDelta: number\|null` | no | `daily-brief.controller.ts:475-502`; `progress-narrative.ts:47,72` |
| `GET /mastery-trend` | student+ | per-day mastery series | no | `score-center/routes.ts:36-42` |

**Confidence definition is a saturating sample-size function** — `packages/shared/src/score-center/mastery.ts:44`:

```ts
confidence: Math.min(1, 1 - Math.exp(-(attempts + 1) / 12)),
```

Same shape elsewhere: `recommendation.ts:42` and `recommendation.service.ts:455` `attempts > 0 ? Math.min(1, 1 - Math.exp(-attempts / 12)) : 0`. It is a **pure function of attempt count** — no correctness, difficulty, or recency term — so 5 careless wrong answers give the same confidence as 5 careful right answers. It exists in the type (`types.ts:8`) and in `POST`-shaped writes but is **only surfaced by `GET /knowledge/:id`**; the two "mastery" endpoints a student most likely opens (`/knowledge/mastery`, `/mastery-map`) drop it.

Also note **value-space inconsistency**: `GET /knowledge/mastery` returns 0–1 (`mastery: row.mastery`) while `/mastery-map`, `/dashboard/overview`, `/student-state` return integer percent (`Math.round(row.mastery * 100)`) — no field name marks the unit.

Thresholds a student is judged against: `mastered >= 0.7`, `review >= 0.45` (`mastery.ts:68-72`); `attempts <= 0 → 'untouched'`, but the mastery-summary path reports `status` computed with real attempts while claiming `averageMastery: 0` for the same rows.

---

## 4. Score semantics: prediction vs assessment vs real outcome

| Endpoint | Roles | Fields | Separation visible? | file:line |
|---|---|---|---|---|
| `GET /coach/score-evidence` | student+ | `predictions[]` (`predictedScore/Min/Max`, `modelVersion`), `assessments[]` (`rawScore`, `normalizedScore`, `gradingMethod`), `outcomes[]` (`examType`, `verificationStatus`), `calibrationEvidence.{status, strata[{source,layer,n,gatePass}], pairedCount, pendingVerification, exclusions[]}` | **YES** — three arrays + `kind:'prediction'\|'assessment'\|'outcome'` | `score-anchor/score-anchor.controller.ts:97-115`; `score-anchor.service.ts:598-732` (`kind` at `:663,686,706`) |
| `POST /coach/score-evidence/predictions` | student+ | idempotent prediction write; validates `predictedScore` inside `[min,max]` | n/a | `score-anchor.controller.ts:33-45`; `score-anchor.service.ts:101-106` |
| `GET /exam/diagnosis/:sessionId` | student+ | `score150Estimate{value, objectiveEarnedEstimate, subjectiveEarned, basis, **confidence:'medium' (hardcoded)**}`, `gapDecomposition.predictedScore150`, `nodeLossUnmappedCount` | partial | `study/exam-diagnosis.ts:141-152,204-213`; `study.controller.ts:638-650` |
| `GET /exam/score-history` | student+ | trend text only | n/a | `exam-score-history.adapter.ts:38-51` |
| `GET /assessment-history` | student+ | `score`, `totalScore`, `accuracyRate`, `summary.{bestScore, latestAccuracyRate, improvementText}` | raw assessment only | `assessment-history.adapter.ts:3-27` |
| `GET /assessments/stage` | student+ | `current.accuracyRate \| null`, `assessmentTrend.latestScore/previousScore/delta`, `verdict` | trajectory | `stageReport.ts:118-159`; `stage-assessment.adapter.ts:27-31` |
| `GET /coach/score-calibration` | **teacher/admin only** | MAE/bias/coverage + `paired` evidence strings | YES | `daily-brief.controller.ts:332-348` |

**Disclaimer strings:**
- Student-reachable, but only as a parenthetical: `exam-diagnosis.ts:149` `basis: '客观题按正确率 × 80 折算（估算）；主观题为真实自评分'`; `:165` `'客观题口径估算（本科目题数×2 分；主观题自评分计入汇总行）'`; `:211` `'gap 基于估算分与目标分（估算），逐科空间见 perSubject'`. There is an honest `nodeLossUnmappedCount` (`exam-diagnosis.ts:171-173`).
- Rubric scoring, student-reachable (`GET /questions/:questionId/rubric`, `large-question.controller.ts:24-26`): `packages/shared/src/score-center/large-question-rubric.ts:100` `'本评分基于关键词匹配，不是语义判定…结果仅供参考，最终分数须由人工复核确认。'`
- **The explicit disclaimer is teacher/admin-only**: `score-calibration.ts:64` `'预测分是估算，不是真实成绩；校准只说明估算偏差，不代表实际考试结果。'`, `:296` `'预测分不等于真实成绩。'`, `:414` `'…预测分不等于真实成绩。'`. **NOT FOUND** any student-facing endpoint returning those sentences (grep `不代表|仅供参考|不是真实` in `apps/api/src` → 8 hits, all listed above; none is a student score response).

Assessment-vs-outcome separation is `assessment: ScoreSource/verificationStatus` on the outcome rows (`score-anchor.service.ts:695`), and unverified outcomes are excluded from calibration with `reason:'outcome_unverified'` (`:538`).

---

## 5. Transfer probe (迁移复测)

| Method + path | Roles | file:line |
|---|---|---|
| `GET /coach/transfer-probes` | student/teacher/admin | `transfer-probe/transfer-probe.controller.ts:29-31` |
| `GET /coach/transfer-observation` | student/teacher/admin | `:37-39` |
| `GET /coach/transfer-summary` | **teacher/admin only** | `:47-49` |

- Probe inbox returns `{ userId, storeAvailable, featureEnabled, cards, deliveredCount }` (`transfer-probe.controller.ts:34`; `transfer-probe.service.ts:220-226,265`). Card fields: `probeId, taskId, nodeId, nodeName, dueDate, bucket, isomorphism, kind, session|null, reason?` (`transfer-probe.service.ts:64-85`).
- **Student never sees the aggregates.** `transferRate` / `transferGap` / `sampleConfidence` come only from `getTransferSummary()` (`transfer-probe.service.ts:688-694`) behind `@Roles('teacher','admin')`; grep `sampleConfidence|transferRate|transferGap` in `apps/web/src` → 0 hits.
- Observation endpoint (`:657-662`) carries `authoritative: false` and a note: `'聚合迁移结论（TransferRate/Gap）在证据门（每节点 n≥5）满足后由教师/管理员视图提供；个人视角只呈现自己的探针事件。'` It has **no web call site** (`fetchTransferObservation` in `apps/web/src/api/endpoints/transferProbe.ts:63` — definition only), so students never receive that note.
- Gate state: `transfer-probe.ts:211` `gate: 'insufficient_data' | 'reported'`, set `:280` `gate: gateMet ? 'reported' : 'insufficient_data'`; `transferRate` is `null` when the gate is unmet (`:252`, comment `:203-204`).
- `sampleConfidence` is a **pure sample-size band**, explicitly not quality: `transfer-probe.ts:39` `/** Preregistered gate (formal design §12) — sample-size bands, never prediction quality. */`; bands `:40-44` `{minSampleSize: 5, mediumSampleSize: 20, highSampleSize: 50}`; formula `:257-263` `!gateMet ? null : attempts >= high ? 'high' : attempts >= medium ? 'medium' : 'low'`.
- `practiceAttempts: practice?.attempts ?? 0` (`:275`) — literal `0` ambiguous with measured zero; `ratePercent` returns `0` for `attempts === 0` (`:218-220`).
- Ingest coercion erases absence: `transfer-probe.service.ts:597-602` `nodeId: String(detail.nodeId ?? '')`, `bucket ?? 'MEDIUM'`, `isomorphism ?? 'unverified'`, `attempts: Number(… ?? 0)`.
- The probe payload itself carries **no disclaimer** (grep `authoritative|gateNote|note` in `transfer-probe.service.ts` → only `:660,:661,:690,:693`); honesty lives in UI copy (`TransferProbeCard.tsx:101,133,141,150`).
- Feature gate: `transfer-probe.service.ts:104` `return process.env.TRANSFER_PROBE_ENABLED === 'true';` — unset = off, returns `{featureEnabled:false, cards:[]}` (`:226-228`). The two projection endpoints **ignore** `featureEnabled` and still serve.

---

## 6. AI Coach / tutor: capability envelope and enforcement

| Constraint | Enforced by | file:line |
|---|---|---|
| "只能解释…不做计划、优先级或掌握度决策" | system prompt | `contextual-coach.prompt.ts:6` |
| "不要推断不存在的数据，也不要创建新的事实" | system prompt | `:7` |
| "不得虚构检索结果，也不得把相关性分数当作掌握度" | system prompt | `:8` |
| **"不能修改学习计划/创建任务/修改掌握度/安排复习/写入系统。绝不能声称这些事情已经发生。"** | system prompt only | `:9` |
| "只能解释、提醒和建议…不要把建议写成系统执行结果" | system prompt | `:10` |
| output shape frozen to `summary, replySteps, misconceptionTips, reviewCards, nextActions` | system prompt + normalizer | `:11-12`; `ai-tutor.service.ts:177-180` |
| "nextActions 禁止出现 create task、update plan、modify mastery、schedule review" | system prompt (string blacklist) | `:13` |

**Enforcement reality:** there is **no server-side validator** for those prohibitions — the prompt is the only guard. The one structural check is output *shape* normalisation: `normalizeContextualCoachModelResponse(content, buildTemplateContextualCoach(...))` (`ai-tutor.service.ts:177-180`) falls back to the deterministic template with `fallbackReason` + `errorType:'model_output'` (`:184-189`). The service performs **no writes** and exposes no tool/function-calling surface (whole file `ai-tutor.service.ts:1-275`).

**Actionable ids: NO.**
- `nextActions: string[]` — free text, no id (`contextual-coach.types.ts:57`).
- `reviewCards[].id` is a synthetic slug: template emits `'context-concept' | 'context-rule' | 'context-confusion'` (`contextual-coach.prompt.ts:51-53`); not a DB id.
- The response *does* carry a real subject reference: `contextType`, `contextId` (`questionId` or `knowledgeNodeId`), plus `sessionId` when session tracking is on (`contextual-coach.types.ts:60-73`). So the coach can point at **the question/node the student asked about**, but cannot hand the UI a task/recommendation/action id to execute.
- Request-side: `userId` in the body is rejected (`study.controller.ts:389` `throw new BadRequestException('userId is not allowed in request body')`).

**Degradation is visible to the client:** `source: 'contextual-coach-template'` + `fallbackReason: 'AI unavailable'` (`ai-tutor.service.ts:151-153`), `'AI_API_KEY not configured'` (`:68,109`), `provider_timeout|provider_rate_limited|provider_http_error|provider_network_error|provider_invalid_response|provider_error` (`:265-275`).

**Template fallback ships coaching copy the model never approved**: `contextual-coach.prompt.ts:43` `'…暂未连接模型，先按证据进行复盘。'`, `:49` `'不要把一次结果当成长期掌握度结论。'` — this one *is* an honesty string.

---

## 7. Existing guidance / education strings returned by the API

| Copy | Endpoint surface | file:line |
|---|---|---|
| headline `先完成「{title}」` / `计划已清空，先清 N 道逾期复习` / `计划已清空，先做今天到期的 N 道复习` | `GET /coach/daily-brief` | `daily-brief.ts:48-57` |
| stateLines `距离考试 N 天`, `逾期复习 N 道（先清债）`, `连续学习 N 天` | same | `daily-brief.ts:60-69` |
| basis line `逾期复习正在遗忘窗口里流失，优先恢复` | same | `daily-brief.ts:81` |
| followUp `今日计划全部完成——去「努力与效果」看看这周的变化。` / `今日已完成 x/y，完成剩余后回来复盘。` | same | `daily-brief.ts:88,90` |
| risk headlines: 知识回归 / 连续同型错误 / 复习债 / 学习中断 / 任务积压 / 模考表现偏低 | `GET /coach/proactive` | `proactive-coach.ts:39-83` |
| per-risk action lists e.g. `['重做该节点的 2-3 道基础题','对比基线复盘此前错因','通过变式题验证恢复情况']` | same | `proactive-coach.ts:45,55,66,71,76,81` |
| sprite lines `今天的计划全部完成…` / `连续学习 N 天，节奏已经长在你身上。` / `今天还有 N 个任务。从「…」开始就好。` / `我在。想学的时候点我…` | `GET /sprite/state` | `sprite-persona.ts:184,197,207,245` |
| milestone labels `N 个知识节点的提升通过了证据门槛` / `重做解决了 N 道错题` / `断档恢复完成，节奏已重建` | same | `sprite-state.ts:418,425,432,439` |
| task `nextAction` `完成后用 5 分钟整理 {title} 的关键规则。` | today plan / node plan | `nodePlan.ts:124` |
| per-status next action `建议回归基础，先看教材再刷题` / `建议安排巩固复习与变式练习` / `建议保持节奏，定期温习` | `GET /mastery-map` | `mastery-summary-projection.service.ts:352-357` |
| **one static suggestion for every weak point** `'建议回归基础概念，配合真题巩固该节点。'` | `GET /reports/overview` weakPoints | `mastery-summary-projection.service.ts:300` |
| evidence-basis sentences per action type (`'已判分的练习事实是可观测表现，构成强证据…'` etc., published taxonomy) | `GET /coach/learning-evidence` records | `learning-evidence.ts:147-193,196` |
| funnel row basis `'学生打开了该推荐的解释…'` / `'曝光遥测正常但未收到该推荐的曝光上报，判定为未被看到。'` | `GET /coach/recommendation-funnel` | `recommendation-exposure.ts:186-191` |
| reminder `'提醒完成首次引导和七天学习计划。'` | `GET /study-reminders` | `study.service.ts:4229-4231` |
| assessment cold start `'还没有测评记录，先完成一套模拟卷建立基线。'` / `'已建立第一次测评基线…'` | `GET /assessment-history` | `assessment-history.adapter.ts:50-51` |
| stage summary sentence stack + nextAction ladder | `GET /assessments/stage` | `stageReport.ts:130-147` |

Note the split: **structured labels exist for reason codes but the weak-point `suggestion` and proactive `actions` are single hard-coded strings** — every weak node gets byte-identical advice (`mastery-summary-projection.service.ts:300`).

---

## 8. Feature flags gating student-facing guidance

All boolean flags parse strictly (grep `process.env.` across `apps/api/src`, `packages/shared/src`).

| Env var | Parse site | Expression | Unset default | Student-facing capability |
|---|---|---|---|---|
| `MASTERY_SEMANTICS` | `packages/shared/src/score-center/mastery-semantics-switch.ts:101` (parse `:91-94`) | `parseMasterySemantics(env?.[…])` → `normalised === 'c1' ? 'c1' : 'legacy'` | **`legacy`** (typo cannot enable; doc `:88-90`) | Which mastery transition students' numbers come from: `score-center/service.ts:153` (practice), `:254,:266` (review). Catalogue `:68-85`; startup log `apps/api/src/main.ts:79` |
| `USE_KNODE_MASTERY` | `apps/api/src/study/study.service.ts:359` | `process.env.USE_KNODE_MASTERY === 'true' && this.nodeMasteryCacheLoaded && Boolean(this.prisma)` | **OFF → legacy read path** | Mastery-map / weak report / recommendations / today plan read `UserKnowledgeMastery` (`:299,644,885,2755,2764,4310`) |
| `TRANSFER_PROBE_ENABLED` | `apps/api/src/transfer-probe/transfer-probe.service.ts:104` | `=== 'true'` | **OFF** (also AND-ed with `DATABASE_URL`, `:99`) | 迁移复测 scheduling + `GET /coach/transfer-probes` (`:226-228`) |
| `ALLOW_DEMO_AUTH` | `apps/api/src/auth/auth.service.ts:75` (`:93`, `:113`; log `main.ts:75`; validator `public-environment.ts:48`) | `process.env.NODE_ENV === 'production' \|\| process.env.ALLOW_DEMO_AUTH !== 'true'` | **disabled** (`!== 'true'` denies) | `POST /auth/demo-login`; `requireRole` fallback identities |
| `AI_API_KEY` | `apps/api/src/study/ai-tutor.service.ts:51-52` | `apiKey ? new DeepSeekClient(...) : null` (truthy) | **unset → deterministic template** | AI coach vs template (`:63-69,148-163`) |
| `EMBEDDING_API_KEY` | `apps/api/src/rag/embedding-provider.ts:46` | `env.EMBEDDING_API_KEY?.trim()` | unset → `LocalDeterministicEmbeddingProvider` (`:58`) | Retrieval provider only (both paths return results) |
| `ALLOW_FAKE_DOCUMENT_PROVIDER` + `QUESTION_IMPORT_DOCUMENT_PROVIDER` | `apps/api/src/questions/questions.module.ts:51` | `=== 'fake' && ... === 'true'` | OFF / Tencent OCR (`:48`) | **NOT student-facing** (teacher import) |
| `ALLOW_INSECURE_HTTP_IP` | `apps/api/src/public-environment.ts:61` (`main.ts:20`) | `=== 'true'` | FALSE | Startup env validation only |

**Shadow / experiment paths are NOT env-gated** — grep `process\.env\.[A-Z_]*(SHADOW|EXPERIMENT|SEMANTICS|BETA|CALIBRATION)` → no matches for review-shadow, review-semantics-shadow, review-mastery-shadow, shadow-decision-chain, score-calibration, beta-metrics, coach-experiments. Their `enabled` getters are `Boolean(process.env.DATABASE_URL && this.prisma)` (`review-shadow.service.ts:23`, `score-calibration.service.ts:66`, `beta-metrics.service.ts:17`, `shadow-decision-chain.service.ts:51`) → **in any Postgres deployment these run by default**; they stay invisible purely through role gates (`daily-brief.controller.ts:162,271,301,365,412` = teacher/admin). `review-semantics-shadow.service.ts` and `review-mastery-shadow.service.ts` read no env at all.

Flag-name caveat: grep `TRANSFER_PROBE_ENABLED|MASTERY_SEMANTICS|USE_KNODE_MASTERY` in root `.env.example` and `.env.development.example` → 0 hits; only `ALLOW_DEMO_AUTH="true"` is documented (`.env.example:6`). Two behaviour-changing mastery flags and the probe flag are effectively **undiscoverable from the env templates**.

---

## Decision-relevant summary

1. **`priority.ts:111-121` fabricates up to 2 reason codes** whenever fewer than 2 real triggers fire — student-visible explanations can be false.
2. **`recommendation.service.ts:207` invents `55 %` accuracy and `:117` invents `96` days**; `NEUTRAL_MASTERY` (`score-center/repository.ts:34-41`) reports `mastery 0.5 / accuracy 0.55` to a student with zero attempts.
3. **`GET /knowledge/mastery` and `/mastery-map` return no confidence field**, while the only confidence that exists is `1 - e^(-(attempts+1)/12)` (`mastery.ts:44`) — a sample-size proxy, not quality.
4. **`mastery-summary-projection.service.ts:310-312` reports `averageMastery: 0`** for unmeasured students; the sibling overview projection correctly uses `null` (`overview-report-projection.service.ts:362`).
5. **Predicted-score disclaimers are teacher/admin-only**; students get only `（估算）` parentheticals (`exam-diagnosis.ts:149,165,211`).
6. **Prediction / assessment / real outcome are correctly separated** in `GET /coach/score-evidence` (three arrays + `kind`, `score-anchor.service.ts:663,686,706`).
7. **Transfer-probe aggregates never reach students**; `sampleConfidence` is a sample-size band (5/20/50) and the honesty `note` is unreachable (no web call site).
8. **Coach prohibitions are prompt-only** (`contextual-coach.prompt.ts:9,13`); `nextActions` carry no actionable id (`contextual-coach.types.ts:57`).
9. **Two mastery-semantics flags plus the probe flag are absent from every `.env` template**, so defaults silently decide student-visible semantics.
