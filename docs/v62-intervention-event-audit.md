# V6.2 Intervention Event Source Audit

> 日期：2026-09-06。只读审计。映射六面 Intervention 来源与既有 identity。

## 1. 什么是真正的 Intervention？

一个 Intervention 是系统向学生主动交付的一次学习动作。必须满足：
1. 有明确的交付时间（createdAt / deliveredAt）
2. 有明确的目标（knowledgeNodeId / questionId / studyTaskId）
3. 有明确的来源（recommendation_engine / daily_planner / proactive_coach / exam_simulator / tutor）
4. 可以追溯到执行结果（StudyTaskCompletion / ReviewAttempt / PracticeRecord）

## 2. 六面来源审计

| Surface | 已有模型 | 已有 ID | Intervention Type | User Action 来源 | Outcome 来源 |
|---|---|---|---|---|---|
| Recommendation | RecommendationAction | action.id (cuid) | recommendation | StudyTask 执行 → PracticeRecord | UserKnowledgeMastery 变化 |
| Planner | StudyPlan + StudyTask | task.id (cuid) | study_plan_task | StudyTaskCompletion | 同上 |
| Coach | ProactiveCoach 卡片（不落库） | risk.type + date | coach_prompt | StudentHome 点击 → Task | 同上 |
| Review | ReviewSchedule + ReviewAttempt | schedule.id | review_task | ReviewAttempt → PracticeRecord | ReviewSchedule.stability |
| Practice | PracticeRecord | record.id | practice_task | 直接提交 | UserKnowledgeMastery |
| Exam | ExamPaper + AssessmentHistoryItem | paper.id | exam_simulation | 考试提交 | AssessmentHistoryItem + mastery |

## 3. 稳定 Identity

以下 ID 已存在且稳定，V6.2 不重新定义：

| ID | 表 | 用途 |
|---|---|---|
| recommendationActionId | RecommendationAction.id | 推荐动作唯一标识 |
| studyTaskId | StudyTask.id | 学习任务唯一标识 |
| actionId → studyTaskId | RecommendationAction.studyTaskId @unique | Action→Task 一对一绑定 |
| taskId | StudyTaskCompletion.taskId | 完成记录关联 |
| reviewScheduleId | ReviewSchedule.id | 复习排期唯一标识 |
| generationKey | StudyPlan.generationKey | 计划幂等 |

## 4. 重复记录风险

| 表 | 唯一约束 | 幂等保证 |
|---|---|---|
| RecommendationAction | creationKey | upsert 幂等 |
| StudyPlan | userId + generationKey | 幂等 |
| StudyTaskCompletion | userId + taskId + completedDate | 幂等 |
| ReviewSchedule | userId + questionId | upsert |
| WrongQuestionReview | userId + questionId | upsert |

## 5. V6.2 设计决策

**AD-V6.2-1**：InterventionEvent 是**派生视图**——从 RecommendationAction + StudyTask + StudyTaskCompletion + ReviewSchedule 联合派生，不建新表、不新增 Prisma model。

**AD-V6.2-2**：Event status 是**计算属性**——由底层记录的生命周期状态推导：
- `delivered`：RecommendationAction 存在且 status=CREATED
- `executed`：StudyTask 存在且 started
- `completed`：StudyTaskCompletion 存在
- `expired`：scheduledDate < today 且未完成
- `ignored`：deliveredAt 超过 N 天且无 User Action

**AD-V6.2-3**：User Action correlation 由既有 PracticeRecord / ReviewAttempt / StudyTaskCompletion 的 timestamp 匹配 intervention deliveredAt 窗口。

**AD-V6.2-4**：不建新事实表。InterventionEvent 纯函数派生，可从同一输入重建。
