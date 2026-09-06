# V6.2 Intervention Event Architecture

> 日期：2026-09-06。以 V6.2 套件（14/14）+ 全量回归实证。

## 1. Intervention Event 全景

```
Recommendation        Planner           Coach           Review          Practice         Exam
     │                    │                │                │               │               │
     ▼                    ▼                ▼                ▼               ▼               ▼
Recommendation     StudyPlan+Task    Intervention      ReviewSchedule  PracticeRecord   ExamPaper
Action             (generationKey)   Card (not persisted) +Attempt     (canonical)      +Assessment
     │                    │                                             │
     └────────────────────┴─────────────────┬───────────────────────────┘
                                            ▼
                              deriveInterventionEvents()
                                            │
                              ┌─────────────┼─────────────┐
                              ▼             ▼             ▼
                         delivered      executed      completed
                              │             │             │
                              ▼             ▼             ▼
                         ignored         expired      LearningOutcome
                              │                           (V6-1)
                              └────────────┬───────────────┘
                                           ▼
                                  OutcomeAttribution
                                           ▼
                                  Effectiveness Report
                                           ▼
                                  Experiment Engine
                                           ▼
                                  Strategy Optimizer (proposal)
                                           ▼
                                  Human Approval → Production
```

## 2. InterventionEvent 契约

| 字段 | 类型 | 来源 |
|---|---|---|
| interventionId | string | RecommendationAction.id / ReviewSchedule.id |
| userId | string | 同底层记录 |
| type | enum | recommendation / study_plan_task / review_task / practice_task / coach_prompt / exam_simulation |
| targetKnowledgeNodeId | string? | StudyTask.knowledgeNodeId / null |
| source | string | recommendation_engine / review_engine / ... |
| createdAt | ISO | 底层记录创建时间 |
| executedAt | ISO? | StudyTask.startedAt |
| completedAt | ISO? | StudyTaskCompletion.completedAt |
| status | enum | delivered / executed / completed / expired / ignored |
| recommendationActionId | string? | 直接引用 |
| studyTaskId | string? | 直接引用 |
| reviewScheduleId | string? | 直接引用 |
| eventKey | string | 确定性幂等 key |

## 3. 生命周期状态机

```
delivered ──→ executed ──→ completed
    │                          │
    ├──→ expired               │
    │                          │
    └──→ ignored               │
```

状态推导规则（纯函数，非存储）：
- `completed`：StudyTaskCompletion 存在
- `executed`：StudyTask.startedAt 存在且未完成
- `expired`：scheduledDate < now 且未完成
- `ignored`：createdAt > 7 天且无 User Action
- `delivered`：其他

## 4. Idempotency

- `eventKey` = `intervention:{creationKey}` 或 `intervention:review:{scheduleId}`
- `deriveInterventionEvents` 对重复 eventKey 去重
- 不依赖外部幂等机制——纯函数天然幂等

## 5. User Action Correlation

| 状态 | 条件 |
|---|---|
| executed | PracticeRecord.submittedAt >= intervention.createdAt |
| ignored | delivered > 7 天且无 User Action |
| partial | 已交付但未过 7 天且未执行 |
| expired | past scheduledDate |
| completed | StudyTaskCompletion 存在 |

## 6. Outcome Correlation

- **direct**：outcome.interventionId === event.interventionId
- **knowledge_node**：outcome.knowledgeNodeId === event.targetKnowledgeNodeId
- **none**：无匹配 → matched=false, masteryGain=null

## 7. 与 V6-1/V4 的关系

| 组件 | 关系 |
|---|---|
| LearningOutcome (V6-1) | Outcome Correlation 的输入 |
| OutcomeAttribution (V6-1) | Outcome Correlation 的下游 |
| LearningSignal (V4-2) | Event 触发因子（signal → risk → intervention） |
| Risk Detection (V4-3) | Event 触发条件（risk → proactive intervention） |
| AiMetrics (AI-12) | Event 记录（recordAgentRun/recordCoachIntervention） |
