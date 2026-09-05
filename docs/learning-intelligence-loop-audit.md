# Learning Intelligence Loop — System Audit（Phase 1）

## 2026-09-05 takeover verification — supersedes unsupported conclusions below

Current status: audit reopened. The earlier all-covered verdict is not reliable. Verified against current implementations:

- `AnswerReceiptRepository.findByKey` uses `(userId,idempotencyKey)`, NOT `(userId,requestHash)`. Request hash validates payload compatibility.
- `submitPracticeSet` and `submitStageAssessment` call per-answer `createPracticeRecord` without supplying idempotency identities. Batch retries do not have a shared receipt or atomic batch boundary.
- `submitPracticeSession` uses `LearningSessionRepository.commitSubmission` and completed/revision guards, NOT AnswerReceipt. Already-completed sessions reject replay. Post-commit task progress/event/history failures need separate recovery analysis.
- `reviewWrongQuestion` records the reviewed flag/event only. The spaced-review/maturity path is `reportWrongReason` with `isReview=true`; do not conflate these routes.
- `reportWrongReason` publishes memory schedule/attempt before persistence and updates mastery after the attempt in a separate best-effort transaction. Failure can leave a false cached success or an unrepaired mastery gap.
- `submitStageAssessment` calls `createStageAssessmentResult`; it does not call `triggerLearningLoop`. The `stage_assessment` SESSION submission does. Only paper sessions write `recordPaperAssessmentHistory` here.
- `LearningLoopTriggerService` commits plan generation before separately recording `plan.generated`. They are not one atomic transaction; generation identity can support retry, but a durable automatic retry is not present in this service.
- `useStudentContextData` initially has no request-order or auth-change cancellation. Explicit refresh call sites alone do not prove freshness.
- `PracticeProjectionService` reads full practice history. Supplemental `take` bounds do not bound the whole query. Independent concurrent projection reads are not one database snapshot; `asOf` is an evaluation anchor, not historical reconstruction.
- ScoreCenter `applyReview` updates stability/retention/review dates; it preserves mastery attempt counters and mastery value. Review is not another EWMA answer attempt.

Existing changes are listed in `qa/learning-intelligence/takeover-git-status.txt`. New evidence and phase status live in `autonomous-development-state.md`; original sections below are historical audit material pending correction.

审计日期：2026-09-05
性质：只读审计（Phase 1，未修改代码）
范围：学习闭环全部十条流（Practice / Review / Assessment / StudyTask / StudyPlan / Recommendation / LearningSession / UserEvent / Mastery / StudentContext）
基线：SC-1…SC-5 全部 PASS；77/77 定向回归；分支 `feature/v3-product-refactor`

---

## 1. Event Entry Points（全部写入口，`study.controller.ts` + score-center）

| # | 入口 | 路由 | 服务链 | 事件性质 |
|---|---|---|---|---|
| E1 | 单题作答 | `POST /practice-records` (:386) | StudyService → PracticeRecord 写 + ScoreCenter.applyAttempts + ActionFeedbackTrigger（best-effort） | 学习事实 |
| E2 | 题组提交 | `POST /practice-sets/:id/submit` (:310) | 同上（批量）+ practiceSetResult | 学习事实 |
| E3 | 会话提交 | `POST /sessions/practice/:sessionId/submit` (:472) | LearningSession submit → PracticeRecord（AnswerReceipt 事务） | 学习事实（幂等） |
| E4 | 错题复盘 | `POST /wrong-questions/:questionId/review` (:280) | WrongQuestionReview 生命周期 → ReviewSchedule/ReviewAttempt → applyReview (:2292) | 学习事实 |
| E5 | 复盘原因 | `POST /wrong-questions/:questionId/reason` (:574) | 仅记录原因（isReview=false：无 Attempt、无反馈事件） | 元数据 |
| E6 | 阶段测评提交 | `POST /assessments/stage/submit` (:343) | StageAssessmentResult + stage_assessment 会话完成 → LearningLoop 触发 | 学习事实 + 计划触发 |
| E7 | 任务完成 | `POST /study-tasks/:taskId/complete` (:412) | StudyTaskCompletion + LearningLoop 触发次日计划 | 学习事实 + 计划触发 |
| E8 | 会话保存 | `POST /sessions/practice/:sessionId/save` (:447) / start (:440) | LearningSession 草稿 | 会话状态 |
| E9 | 遥测事件 | `POST /events` (:549) | telemetry allowlist（3.6.3 收紧） | 遥测 |
| E10 | 计划操作 | postpone/reschedule/rebalance/start (:514-562) | StudyTask 状态机 | 计划操作 |

## 2. State Transitions（事件 → 状态）

见 `docs/learning-event-state-transition-matrix.md`（Phase 2 完整矩阵 + Phase 3 幂等矩阵）。

## 3. Mastery Updates（唯一写入方 = ScoreCenterService）

- `applyAttempts(userId, records, tx?)` (:97)：PracticeRecord 事实 → EWMA 掌握度（OCC version 锁）。
- `applyReview(userId, questionId, ...)` (:139)：ReviewAttempt 结果 → 同一掌握度管线（study.service:2292 唯一调用点）。
- **硬规则（已验证未被破坏）**：LearningSignal / UserEvent **不直接更新 Mastery**（StudentStateFeedback 只写 UserEvent USER_ACTION_FEEDBACK）。
- 已知语义缺口（登记，不属本任务实施）：SC-P2-001 `toMasteryNodeFact` fallback 硬编码 weak；legacy `toReportMasteryDto` Node-as-Point（LEGACY COMPATIBILITY ONLY，无消费者转入 canonical）。

## 4. Recommendation Triggers

- 唯一运行时入口：`RecommendationService.generateDailyPlanFromState(userId, { scheduledDate, generation })`。
- 触发者：`LearningLoopTriggerService`（TriggerType = `task.complete` | `stage_assessment`，:9）→ 引擎 → StudyPlan/StudyTask + `plan.generated` 事件。
- 普通练习/复盘**不直接**触发计划生成（验收记录：Sprint 3.4）；推荐作用于次日计划与 practice-sets/review-resources 两个兼容端点（Sprint 3.3 迁移至引擎）。

## 5. Study Plan Generation

- 幂等：`StudyPlanRepository.createOrGetByGenerationKey`（userId+generationKey 唯一，:62）；generationKey = `LEARNING_LOOP:{userId}:{scheduledDate}:v1`（D4-B1）。
- 引擎确定性：无 Date.now()/Math.random()（契约钉死）；ID 口径 = knowledgeNodeId。

## 6. Task Completion

- `POST /study-tasks/:taskId/complete` → StudyTaskCompletion 事实 + ActivityProjection + LearningLoop 触发（同一事务后 best-effort）→ 今日完成后可提前生成明日计划（Today/Tomorrow 语义已验收）。

## 7. Review Progression

- WrongQuestionReview（错题生命周期）→ ReviewSchedule（due/overdue/stability）→ ReviewAttempt（复盘结果）→ applyReview → Mastery；isReview=false 的 reason 流不产生 Attempt/反馈（Sprint 3.5 验收）。
- 复盘进度（variantCorrectCount/3 等）由 WrongQuestionProjection 承载，供 MistakeWorkspace。

## 8. Missing Feedback Loops（审计结论：闭环完整，2 处有意断开 + 1 处登记缺口）

| 检查项 | 结论 |
|---|---|
| 练习 → Mastery → 次日推荐 | ✅ 闭环（mastery 即时更新；推荐在下次计划生成时消费最新 mastery） |
| 复盘 → Mastery → 推荐 | ✅ 闭环（applyReview 同管线） |
| 任务完成 → 次日计划 | ✅ 闭环（LearningLoop） |
| 测评完成 → 次日计划 | ✅ 闭环（stage_assessment 触发） |
| LearningSignal → Mastery | ⛔ **有意断开**（硬规则：反馈事件只写 UserEvent，禁止直改掌握度）——正确的架构断开，非遗漏 |
| Assessment → Mastery | ⚠️ 阶段测评的作答若产生 PracticeRecord 则进掌握度；纯测评分数只进 AssessmentHistory（不伪造掌握度——正确语义） |
| SC-P2-001 fallback weak 硬编码 | 登记缺口，待批独立批次（不混入本任务） |

## 9. Duplicate Calculations

- 掌握度：唯一计算点 = ScoreCenter（EWMA）；StudentContext/前端 adapter 均为投影/展示转换（SC-2/SC-5 已消除重复组合）。
- 推荐：唯一计算点 = shared 引擎（`packages/shared/src/score-center`）；compat 端点经 adapter 复用（Sprint 3.3）。
- 阶段报告：`computeStageReport` 在前端由三份事实合成（assessmentHistory + masteryMap + wrongSummary）——**已知重复真相**（Report 域分析指标，Convergence Gate 判定保留 report 投影）；非本任务范围。

## 10. Stale State Risks

- 读路径无服务端缓存（SC-4 决策：不引入）；每次 /student-context 现算（有界读取，SC-5）。
- 前端在全部学习事件提交后显式 `studentContext.refresh()`（App.tsx :382/:391/:639/:860/:1351）→ 消费者不接收陈旧摘要（Phase 8 详述）。
- projections 为现算派生，无物化滞后；唯一的"陈旧窗口"= 事件提交 → 前端刷新之间的 in-flight 请求（UI 层已有 loading 语义）。

## 11. Audit Verdict

闭环**结构完整**：E1-E7 全部接入 Student State → Mastery → Recommendation → Plan → Task → 新事实的循环；幂等基础设施（AnswerReceipt / eventKey / generationKey / creationKey）全覆盖且有专属测试。Phase 2-10 逐项验证见各文档；本任务预计以文档 + 定向回归补强为主，无破坏性实施需求。
