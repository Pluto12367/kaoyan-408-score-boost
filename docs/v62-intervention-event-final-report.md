# V6.2 Intervention Event — Final Report

> 日期：2026-09-06。基线 `eb90c5a`（V6.1）→ 完成 `f3d0c32`。工作树归零。

## 1. Event Sources

| Surface | 模型 | ID | V6.2 Event Type |
|---|---|---|---|
| Recommendation | RecommendationAction | action.id | recommendation |
| Planner | StudyPlan + StudyTask | task.id | study_plan_task |
| Coach | ProactiveCoach 卡片 | risk.type + date | coach_prompt |
| Review | ReviewSchedule + ReviewAttempt | schedule.id | review_task |
| Practice | PracticeRecord | record.id | practice_task |
| Exam | ExamPaper + AssessmentHistoryItem | paper.id | exam_simulation |

## 2. Contract

`InterventionEvent` 纯派生视图：interventionId / userId / type / target / source / createdAt / executedAt / completedAt / status / recommendationActionId / studyTaskId / reviewScheduleId / eventKey。不建新表，不新增事实源。

## 3. Identity

复用既有 canonical ID（recommendationActionId / studyTaskId / reviewScheduleId），不重新定义。

## 4. Execution Semantics

状态机：delivered → executed → completed / expired / ignored。纯函数推导（非存储），同输入必同输出。

## 5. Outcome Correlation

- direct：outcome.interventionId === event.interventionId
- knowledge_node：outcome.knowledgeNodeId === event.targetKnowledgeNodeId
- correlation ≠ causation

## 6. Data Quality

duplicate event 去重（eventKey）；garbage input 安全降级；同输入确定性。

## 7. Idempotency

eventKey 确定性幂等；重复 eventKey 自然去重。

## 8. Metrics

AiMetrics 已有 recordAgentRun/recordCoachIntervention/recordLearningOutcomeDelta；V6.2 无新增 metrics 需求。

## 9-14. Tests / Build / Remaining

- v62-intervention-event.test.js：14/14
- 全量 1852/1828/22（零新增）
- 三端构建 PASS

## 15. Remaining Risks

- InterventionEvent 为派生视图，不持久化——需要历史查询时从 DB 重新派生
- Coach intervention（proactive card）当前不落库，event 来源为 risk.type 推导——未来如需持久化需 ADR
