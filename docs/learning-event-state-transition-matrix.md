# Learning Event → State Transition Matrix（Phase 2）+ Idempotency Matrix（Phase 3）

日期：2026-09-05
性质：只读审计矩阵；幂等缺口的验证以现有测试证据为准

---

## 1. Event → Expected State Change → Projection Change → Recommendation Impact

| 事件 | 预期状态变更 | 预期投影变化 | 预期推荐影响 | 验证锚点 |
|---|---|---|---|---|
| E1 单题作答 | +PracticeRecord；UserKnowledgeMastery（EWMA，OCC）；AnswerReceipt | practice/mastery/review 摘要变化；ActivityProjection | 下次计划生成时引擎读到新 mastery | `test/answer-receipt.test.js`、`score-center-optimistic-lock.test.js` |
| E2 题组提交 | 批量 PracticeRecord + 同上 | 同上 + practiceSetResult | 同上 | practice-set 提交测试族 |
| E3 会话提交 | 同 E1（事务内 AnswerReceipt 幂等） + LearningSession completed | 同上 | 同上 | `answer-receipt.test.js` |
| E4 错题复盘 | WrongQuestionReview reviewed/resolved；ReviewSchedule（stability/nextReviewAt）；ReviewAttempt；Mastery（applyReview） | wrong-question 摘要（due/overdue/resolved）+ review | 同上 | `wrong-question-lifecycle.test.js` |
| E5 复盘原因 | 仅 WrongQuestionReview 元数据 | 错题原因统计 | 无（isReview=false 无 Attempt/反馈） | wrong-question-evidence 测试族 |
| E6 阶段测评 | StageAssessmentResult；AssessmentHistory；stage_assessment 会话完成 | assessment 摘要 | **触发次日计划**（LearningLoop TriggerType=stage_assessment） | `learning-loop-trigger.test.js`(10) |
| E7 任务完成 | StudyTask completed + StudyTaskCompletion | plan/momentum/activity | **触发次日计划**（TriggerType=task.complete） | 同上 + `task-progress-auto.test.js` |
| E8 会话 save | LearningSession 草稿更新 | momentum（未提交不计入事实） | 无（提交后才进事实） | sessions 测试族 |
| E9 遥测 | UserEvent（allowlist 类型） | 无投影（telemetry-only） | 无 | `canonical-event-boundary.test.js`(8) |
| E10 计划操作 | StudyTask status/postpone 计数 | today-plan 投影 | 无直接触发（不影响当日生成幂等） | today-plan 测试族 |
| 反馈事件（内部） | UserEvent USER_ACTION_FEEDBACK（repository 级幂等） | 无投影 | 无（**禁止直改 Mastery**——架构断开） | `student-state-feedback-event-key.test.js`(4)、`student-state-feedback-adapter.test.js` |

**缺失/不一致排查结论：** 每个学习事件都有明确的状态/投影/推荐归宿；无"事件黑洞"（写入后无人消费）。两处有意断开（LearningSignal→Mastery、reason-only 流程）为架构规则而非缺陷。

## 2. Idempotency Matrix（Phase 3）

| 事件 | 幂等机制 | 锚点 | 重复投递行为 | 专属测试 |
|---|---|---|---|---|
| 练习提交（E1/E2/E3） | `AnswerReceipt`（userId+requestHash 唯一；事务内 create 冲突回读） | `answer-receipt.repository.ts:30-45` | 重放返回既有 receipt，**不重复进进度/掌握度/反馈** | `answer-receipt.test.js`、`study-task-progress.test.js` |
| plan.generated 事件 | `UserEvent.eventKey` = `PLAN_GENERATED:{generationKey}`（DB (userId,eventKey) 唯一 + 冲突回读） | `canonical-event-writer.service.ts:71-76` | 同 generation 重试收敛为一行 | `plan-generated-event-identity.test.js`(5)、`canonical-event-boundary.test.js`(8) |
| StudyPlan 生成 | `StudyPlanRepository.createOrGetByGenerationKey`（userId+generationKey 唯一） | `study-plan.repository.ts:62` | 同 generation 复用既有计划；外层事务回滚后 fresh read 收敛 | `study-plan-idempotency.test.js`(4)、`study-plan-runtime-adoption.test.js` |
| RecommendationAction | creationKey = `ACTION:{generationKey}:{actionType}:{targetType}:{targetId}`（无 generation 的 legacy draft 用 date-scoped key） | `action-creation-key.ts:16` | 同 generation 幂等复用并绑定同一 StudyTask | `action-creation-key-contract.test.js`、`action-runtime.test.js`、`recommendation-action-generation-runtime.test.js`(5) |
| 反馈事件（内部） | UserEvent (userId, actionId, signalType) repository 级去重 | StudentStateFeedbackRepository | 重复信号不重复落事件 | `student-state-feedback-event-key.test.js`(4) |
| generationKey 本身 | `LEARNING_LOOP:{userId}:{scheduledDate}:v1`（确定性） | `generation-key.ts` + LearningLoop | 同日同源只生成一次 | `generation-key-contract.test.js`、`learning-loop-trigger.test.js`(10) |
| 遥测 /events | telemetry allowlist（白名单外拒收）；canonical writer 要求 eventKey | controller :549 | 白名单内重复由客户端语义决定（telemetry 允许重复） | `canonical-event-boundary.test.js` |

**跨实例并发验证（D4-B4）**：`scripts/integration-generation-reliability.mjs` + 集成测试已建立，因测试库 migration 未应用而 **BLOCKED BY ENVIRONMENT**（既有状态，维持，不伪造）。单进程级幂等已由上述单元级测试全覆盖。

**缺口扫描结论：** 五类身份（AnswerReceipt / UserEvent.eventKey / StudyPlan generationKey / Action creationKey / generationKey）全部有 DB 级或 repository 级唯一保护 + 专属测试；**无缺失保护需要新增**。Phase 10 的失败恢复场景同样由这些机制覆盖（partial failure → 事务回滚 + fresh read；duplicate → 冲突回读；retry → 幂等复用；out-of-order → AnswerReceipt pending takeover）。
