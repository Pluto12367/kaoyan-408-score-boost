# Learning Intelligence Architecture

日期：2026-09-05（Phase 12）
范围：学习闭环全景架构（Source Facts / Student State / Mastery / Recommendation / Study Plan / Review / Practice / Events / StudentContext）
性质：架构文档（只读审计产物；无代码变更）

---

## 1. Full Learning Loop

```text
                    ┌──────────────────────────────────────────────┐
                    │                                              │
                    ▼                                              │
  Learning Actions（写入口）                                        │
  ├─ 练习: practice-records / practice-sets/:id/submit             │
  │        / sessions/practice/:id/submit                          │
  ├─ 复盘: wrong-questions/:id/review（reason-only 不产生 Attempt） │
  ├─ 测评: assessments/stage/submit                                │
  └─ 任务: study-tasks/:taskId/complete                            │
        │                                                          │
        ▼  幂等层（见 §3）                                          │
  Learning Events / Facts                                          │
  ├─ PracticeRecord（+AnswerReceipt 幂等台账）                      │
  ├─ ReviewSchedule / ReviewAttempt / WrongQuestionReview          │
  ├─ StudyTaskCompletion / StageAssessmentResult                   │
  └─ LearningSession                                               │
        │                                                          │
        ▼                                                          │
  Student State（Source of Truth）                                  │
  ├─ Mastery Engine（唯一写入方 ScoreCenterService）                │
  │    applyAttempts（练习）/ applyReview（复盘）→ EWMA + OCC        │
  ├─ Plan/Task 状态机（StudyPlan/StudyTask）                        │
  └─ UserEvent（CanonicalEventWriter，eventKey 幂等）               │
        │                                                          │
        ├──► LearningLoopTrigger（task.complete / stage_assessment）┤
        │        ↓ generationKey = LEARNING_LOOP:{userId}:{date}:v1│
        │    Recommendation Engine（纯函数，knowledgeNodeId 口径）   │
        │        ↓                                                 │
        │    StudyPlan + StudyTask（createOrGetByGenerationKey）    │
        │        + RecommendationAction（creationKey 幂等）          │
        │        + plan.generated 事件（PLAN_GENERATED:{genKey}）    │
        │                                                          │
        ▼                                                          │
  Projections（现算、无物化滞后）                                    │
  StudentState / Practice / WrongQuestion / TodayPlan / Assessment │
        │                                                          │
        ▼                                                          │
  StudentContext v1（唯一 canonical read boundary，只读派生）        │
        ├── StudentHome（摘要 adapter）                             │
        ├── ReportWorkspace summary（摘要 adapter）                 │
        ├── Contextual Coach（backend base state）                  │
        └── 学习事件提交后前端显式 refresh → 回到 Learning Actions ──┘
```

## 2. Layer Responsibilities & Boundaries

| 层 | 职责 | 禁止 |
|---|---|---|
| Learning Actions | 接收学习行为 | 直接改投影/推荐 |
| Facts + Events | 持久化学习事实与幂等台账 | — |
| Mastery Engine | 唯一掌握度写入方（EWMA/OCC） | 任何其他路径写 mastery；LearningSignal/UserEvent 直改 mastery（架构断开） |
| Recommendation Engine | 纯函数决策（确定性、无时钟） | 写状态；knowledgePointId 入引擎 |
| Study Plan / Tasks | 计划状态机 | 重复生成（generationKey 幂等） |
| Projections | 现算读模型 | 物化为第二事实源 |
| StudentContext | 只读 canonical 摘要 | 写路径、AI 记忆、RAG 存储、推荐计算 |

## 3. Idempotency & Reliability Spine

```text
练习提交  → AnswerReceipt (userId+requestHash)      重放不重复计费
计划生成  → StudyPlan.generationKey (userId+genKey)  同日同源一份
动作创建  → Action.creationKey (ACTION:{genKey}:...) 同代同靶一个 Action
计划事件  → UserEvent.eventKey (PLAN_GENERATED:...)  DB 唯一 + 冲突回读
反馈事件  → UserEvent (userId, actionId, signalType) repository 级去重
失败恢复  → 事务回滚 + fresh read 收敛；反馈触发 best-effort 不回滚业务事实
```

跨实例并发集成验证（D4-B4）= BLOCKED BY ENVIRONMENT（既有登记）。

## 4. Consistency Guarantees（证据索引）

| 保证 | 文档 |
|---|---|
| 事件 → 状态 → 投影 → 推荐归宿矩阵 | `learning-event-state-transition-matrix.md` |
| 幂等矩阵（5 类身份全覆盖） | 同上 §2 |
| same/different generation → action identity | `recommendation-consistency-audit.md` |
| 掌握度一致性（唯一写入方；SC-P2-001 与 legacy Node-as-Point 登记） | `learning-intelligence-loop-audit.md` §3 |
| 学习计划/复盘反馈闭环 | loop audit §8 |
| 新鲜度（asOf 单点 + 前端事件后 refresh 5 处） | loop audit §10 |
| StudentContext 读取有界化 + payload 预算 | `student-context-production-hardening-final-report.md` |

## 5. Known Debt / Open Items

1. SC-P2-001：mastery fallback `status:'weak'` 硬编码（待批独立批次）。
2. legacy `toReportMasteryDto` Node-as-Point（LEGACY COMPATIBILITY ONLY，零 canonical 消费者）。
3. D4-B4 跨实例并发集成验证（ENV 阻塞）。
4. 前端 `computeStageReport` 三源合成（Report 域分析指标，Convergence Gate 判定保留）。
5. V2→V3 UI 迁移债测试（current-sprint §3 清单）。
