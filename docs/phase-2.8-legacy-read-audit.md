# Phase 2.8 Legacy Read Path Audit

> 审计性质：只读审计。
>
> 本阶段仅分析剩余 legacy read path，不修改 Controller、`StudyService`、schema、migration 或 tests。

## 1. 审计结论

`StudyController` 中仍有一批 endpoint 直接调用 `StudyService`。其中一部分已经具备可复用的 Query/Projection 替代路径，可以逐步迁移；另一部分属于 write path、AI 生成、session 写入、后台管理或未来仍需保留的 legacy 兼容能力，不适合在本阶段直接移除。

当前可以明确分成三类：

- **已迁移但仍保留兼容入口**：`today/plan`、`dashboard/overview`、`wrong-questions` 的查询类接口
- **仍由 Controller 直接调用 legacy `StudyService` 且应优先迁移**：`assessments/stage`、`learning-calendar`、`student-state` 相关的少量聚合 read path、`reports/overview`、`assessment-history` 等
- **应长期保留在 `StudyService` 的 write / AI / admin / session 路径**：如提交、保存、生成、回写、管理类方法

结论：**Phase 2.8 的目标不是删除 `StudyService`，而是把剩余 read path 分类清楚，建立下一批可迁移清单。**

---

# 2. Controller 仍调用 `StudyService` 的 endpoint 清单

下表只列出当前 `StudyController` 中仍然直接调用 `StudyService` 的 endpoint。

| Endpoint | Method | Current Service | 是否read path | 是否应该迁移 | 优先级 |
|---|---|---|---:|---:|---|
| `/knowledge-points` | GET | `studyService.listKnowledgePoints()` | 是 | 否（内容目录 read，可另行独立） | 低 |
| `/knowledge-points` | POST | `studyService.createKnowledgePoint()` | 否（write） | 否 | 不迁移 |
| `/students/:userId/profile` | GET | `studyService.getStudentLearningProfile()` | 是 | 可考虑迁移 | 中 |
| `/wrong-questions/:questionId/review` | POST | `studyService.reviewWrongQuestion()` | 否（write） | 否 | 不迁移 |
| `/practice-sets/recommended` | GET | `studyService.getRecommendedPracticeSet()` | 是 | 视推荐边界而定，通常不作为纯 read model 首批迁移 | 低 |
| `/review-resources/recommended` | GET | `studyService.getRecommendedReviewResources()` | 是 | 同上，偏推荐逻辑 | 低 |
| `/practice-sets/:practiceSetId/submit` | POST | `studyService.submitPracticeSet()` | 否（write） | 否 | 不迁移 |
| `/assessments/stage` | GET | `studyService.getStageAssessment()` | 是 | 是 | 高 |
| `/assessments/stage/submit` | POST | `studyService.submitStageAssessment()` | 否（write） | 否 | 不迁移 |
| `/ai/tutor-reply` | POST | `studyService.createTutorReply()` | 否（AI write） | 否 | 不迁移 |
| `/ai/follow-up` | POST | `studyService.createAiFollowUp()` | 否（AI write） | 否 | 不迁移 |
| `/practice-records` | POST | `studyService.createPracticeRecord()` | 否（write） | 否 | 不迁移 |
| `/study-tasks/:taskId/complete` | POST | `studyService.completeStudyTask()` | 否（write） | 否 | 不迁移 |
| `/diagnostics/profile` | POST | `studyService.applyDiagnosticProfile()` | 否（write） | 否 | 不迁移 |
| `/sessions/practice/start` | POST | `studyService.startPracticeSession()` | 否（write） | 否 | 不迁移 |
| `/sessions/practice/:sessionId/save` | POST | `studyService.savePracticeProgress()` | 否（write） | 否 | 不迁移 |
| `/sessions/practice/:sessionId` | GET | `studyService.getPracticeSession()` | 是 | 视 session read model 而定 | 中 |
| `/sessions/active` | GET | `studyService.listActiveSessions()` | 是 | 可考虑迁移 | 中 |
| `/sessions/practice/:sessionId/submit` | POST | `studyService.submitPracticeSession()` | 否（write） | 否 | 不迁移 |
| `/onboarding/status` | GET | `studyService.getOnboardingStatus()` | 是 | 视 onboarding read model 而定 | 中 |
| `/onboarding/complete` | POST | `studyService.completeOnboarding()` | 否（write） | 否 | 不迁移 |
| `/tasks/:taskId/postpone` | POST | `studyService.postponeTask()` | 否（write） | 否 | 不迁移 |
| `/tasks/:taskId/reschedule` | POST | `studyService.rescheduleTask()` | 否（write） | 否 | 不迁移 |
| `/tasks/rebalance` | POST | `studyService.rebalanceTasks()` | 否（write） | 否 | 不迁移 |
| `/assessment-history/import` | POST | `studyService.importAssessmentHistory()` | 否（write） | 否 | 不迁移 |
| `/events` | POST | `studyService.recordUserEvent()` | 否（write） | 否 | 不迁移 |
| `/tasks/:taskId/start` | POST | `studyService.startTask()` | 否（write） | 否 | 不迁移 |
| `/wrong-questions/:questionId/reason` | POST | `studyService.reportWrongReason()` | 否（write） | 否 | 不迁移 |
| `/wrong-questions/:questionId/detail` | GET | `studyService.getWrongQuestionDetail()` | 是 | 可复用 WrongQuestionQuery / snapshot | 中 |
| `/wrong-questions/:questionId/note` | PATCH | `studyService.updateWrongQuestionNote()` | 否（write） | 否 | 不迁移 |
| `/exam/report/:sessionId` | GET | `studyService.getExamReport()` | 是 | 可考虑单独 read model | 中 |
| `/exam/review-tasks/:sessionId` | POST | `studyService.generatePostExamReviewTasks()` | 否（生成/写） | 否 | 不迁移 |
| `/exam/score-history` | GET | `studyService.getExamScoreHistory()` | 是 | 可复用 assessment projection | 中 |
| `/papers` | GET | `studyService.listPapers()` | 是 | 可能更适合 content/paper query | 低 |
| `/papers/generate` | POST | `studyService.generatePaper()` | 否（生成） | 否 | 不迁移 |
| `/papers/:paperId/submit` | POST | `studyService.submitPaper()` | 否（write） | 否 | 不迁移 |
| `/admin/metrics` | GET | `studyService.getAdminMetrics()` | 是 | 否（admin analytics） | 低 |
| `/admin/users` | GET | `studyService.getAdminUsers()` | 是 | 否（admin analytics） | 低 |
| `/admin/users/:userId/trial-status` | POST | `studyService.updateAdminUserTrialStatus()` | 否（write） | 否 | 不迁移 |
| `/admin/teacher-authorizations` | GET | `studyService.listTeacherStudentAuthorizations()` | 是 | 否（admin管理） | 低 |
| `/admin/teacher-authorizations` | POST | `studyService.grantTeacherStudentAuthorization()` | 否（write） | 否 | 不迁移 |
| `/admin/teacher-authorizations/:teacherId/:studentId` | DELETE | `studyService.revokeTeacherStudentAuthorization()` | 否（write） | 否 | 不迁移 |
| `/admin/feedback` | GET | `studyService.getFeedbackList()` | 是 | 否（admin管理） | 低 |
| `/admin/review-queue` | GET | `studyService.getReviewQueue()` | 是 | 否（admin管理） | 低 |
| `/admin/review-queue/:reviewItemId/approve` | POST | `studyService.approveReviewItem()` | 否（write） | 否 | 不迁移 |
| `/admin/review-queue/:reviewItemId/recheck` | POST | `studyService.markReviewItemNeedsRecheck()` | 否（write） | 否 | 不迁移 |
| `/admin/system-config` | GET | `studyService.getSystemConfig()` | 是 | 否（admin/config） | 低 |
| `/admin/system-config` | POST | `studyService.updateSystemConfig()` | 否（write） | 否 | 不迁移 |
| `/teacher/class-analytics` | GET | `studyService.getTeacherClassAnalytics()` | 是 | 否（teacher analytics） | 低 |

---

# 3. `StudyService` public 方法分析

下面按四类对 `StudyService` 的 public 方法进行分类。

## A. 已经迁移，可以保留兼容

这些方法已经有 Query/Projection 替代，`StudyService` 未来应尽量不再作为 controller 入口，但短期可保留兼容：

| 方法 | 当前状态 | 说明 |
|---|---|---|
| `getTodayPlan(userId)` | 已迁移到 `TodayPlanQueryService` | controller 已接入新 query；`StudyService` 可作为兼容保留 |
| `getDashboardOverview(userId)` | 已迁移到 `DashboardQueryService` | controller 已接入新 query；`StudyService` 可保留兼容 |
| `listWrongQuestions(userId, filters)` | 已迁移到 `WrongQuestionQueryService` | controller 已接入新 query；`StudyService` 可保留兼容 |
| `getWrongQuestionSummary(userId)` | 已迁移到 `WrongQuestionQueryService` | 同上 |
| `getLearningCalendar(userId)` | 已迁移到 `StudentStateLearningCalendarQueryService` | controller 已接入新 query；兼容保留即可 |
| `getTrialProgress(userId)` | 已迁移到 `StudentStateTrialProgressQueryService` | controller 已接入新 query；兼容保留即可 |
| `getSprintPlan(userId)` | 已迁移到 `StudentStateSprintPlanQueryService` | controller 已接入新 query；兼容保留即可 |
| `getMasteryMap(userId)` | 已迁移到 `StudentStateQueryService` | controller 已接入新 query；兼容保留即可 |

## B. 仍被 Controller 使用

这些 public 方法当前仍被 controller 直接使用，且尚未完全替换：

| 方法 | 当前用途 | 建议 |
|---|---|---|
| `getStudentLearningProfile(userId)` | `/students/:userId/profile` | 可考虑单独 query / projection |
| `getStageAssessment(userId)` | `/assessments/stage` | 应优先设计独立 assessment read model |
| `getPracticeSession(sessionId, userId)` | practice session read | 视 session read model 再决定 |
| `listActiveSessions(userId)` | active sessions read | 可作为 session read model 候选 |
| `getOnboardingStatus(userId)` | onboarding status read | 可考虑拆到 onboarding read model |
| `getWrongQuestionDetail(questionId, userId)` | wrong question detail read | 可复用 wrong question projection/query |
| `getExamReport(sessionId, userId)` | exam report read | 独立 read model 候选 |
| `getExamScoreHistory(userId)` | exam score history read | 可复用 assessment projection |
| `listPapers(forStudent)` | papers list | content/curriculum read，单独看是否值得迁移 |
| `getAdminMetrics()` / `getAdminUsers()` / `getFeedbackList()` / `getReviewQueue()` / `getSystemConfig()` / `getTeacherClassAnalytics()` | admin/analytics read | 非 student dashboard 主线，优先级较低 |
| `listKnowledgePoints()` | content list | 更像内容目录服务，不是 student state 迁移主线 |

## C. 内部 write path 依赖

这些方法是明确的写路径或写前校验/写后派生，**不应迁移到 Query 层**：

| 方法 | 说明 |
|---|---|
| `recordUserEvent()` | 事件写入 |
| `createKnowledgePoint()` | 创建内容 |
| `reviewWrongQuestion()` | 错题复习写回 |
| `getRecommendedPracticeSet()` / `getRecommendedReviewResources()` | 虽然是 GET，但属于推荐逻辑，和写前决策强耦合 |
| `submitPracticeSet()` | 提交作答 |
| `submitStageAssessment()` | 提交测评 |
| `createTutorReply()` / `createAiFollowUp()` | AI 交互/写回 |
| `createPracticeRecord()` | 写入练习记录 |
| `completeStudyTask()` | 写入任务完成 |
| `applyDiagnosticProfile()` | 写入诊断状态 |
| `startPracticeSession()` / `savePracticeProgress()` / `submitPracticeSession()` | session 写路径 |
| `completeOnboarding()` | onboarding 写路径 |
| `postponeTask()` / `rescheduleTask()` / `rebalanceTasks()` | task 调度写路径 |
| `importAssessmentHistory()` | 写入测评历史 |
| `startTask()` | 任务状态变更 |
| `reportWrongReason()` / `updateWrongQuestionNote()` | 错题原因/备注写回 |
| `generatePostExamReviewTasks()` | 生成计划 + 写路径 |
| `approveReviewItem()` / `markReviewItemNeedsRecheck()` | review queue 写路径 |
| `updateAdminUserTrialStatus()` / `grantTeacherStudentAuthorization()` / `revokeTeacherStudentAuthorization()` / `updateSystemConfig()` | 管理写路径 |
| `submitPaper()` / `generatePaper()` | paper 写路径 |

## D. 未来 AI / StudentState 需要保留

这些方法虽然看起来像 read，但属于未来 StudentState / AI / analytics 的基础事实或兼容锚点，建议保留：

| 方法 | 原因 |
|---|---|
| `getOverviewReport(userId)` | 报告聚合仍可能作为独立 report read model 的事实来源 |
| `getRecommendedPracticeSet(userId)` | 推荐系统暂不迁移，属于 AI/策略能力 |
| `getRecommendedReviewResources(userId)` | 同上 |
| `listKnowledgePoints()` | 内容目录可能被多个 read model 复用 |
| `getAdminMetrics()` | 管理统计，不属于学员 read path |
| `getTeacherClassAnalytics()` | 教师维度 analytics，不应强行并入 student read model |
| `getFeedbackList()` / `getReviewQueue()` / `getSystemConfig()` | 管理后台能力，保留 |
| `getPracticeFeedback(questionId)` | 作为 createPracticeRecord 的后置补充，未来依然有用 |

---

# 4. 已有 Query / Projection 可复用能力

## 4.1 `WrongQuestionQueryService`

可复用接口：

- `getWrongQuestionsCompat(userId, filters)`
- `getWrongQuestionSummaryCompat(userId)`
- `getDueReviewsCompat(userId)`

建议用途：

- 继续作为 `wrong-questions`、`wrong-questions/summary`、`review/due` 的主入口
- `DashboardQueryService` 未来如果要补充 `wrongQuestionSummary`，可直接复用其 facts / snapshot 边界，不必回到 `StudyService`

## 4.2 `TodayPlanQueryService`

可复用接口：

- `getTodayPlanCompat(userId, asOf?)`

建议用途：

- `today/plan` 已迁移
- `DashboardQueryService` 可复用其结果作为今日计划摘要事实来源
- 这是当前最成熟的 plan read model

## 4.3 `DashboardQueryService`

可复用接口：

- `getDashboardOverviewCompat(userId, asOf?)`

建议用途：

- 作为 dashboard 的唯一兼容入口
- 未来如果继续拆分 dashboard 内部事实，可在 projection 层扩展，不应回退到 `StudyService`

## 4.4 `StudentStateProjectionService`

可复用内容：

- `goal`
- `mastery`
- `weakPoints`
- `reviewDue`
- `studyTasks`
- `assessmentSummary`
- `wrongQuestionSummary`（只作为摘要，不替代完整 wrong-question query）

建议用途：

- student-state 系列接口（已迁移）
- dashboard / today plan / trial progress / sprint plan 的基础事实
- 对于 `getStageAssessment()`，只能提供摘要，不足以完全替代旧接口

---

# 5. Phase 2.8.1 审计结果

## 5.1 推荐迁移顺序

建议按以下顺序继续迁移剩余 legacy read path：

1. **`/assessments/stage`**
   - 这是当前最明显的 legacy read path
   - 可考虑拆成独立 `AssessmentQueryService` / `AssessmentProjectionService`

2. **`/students/:userId/profile`**
   - 如果前端仍重度依赖 profile 读模型，可设计独立 profile query

3. **`/wrong-questions/:questionId/detail`**
   - 可复用已有 wrong question projection/query 边界，迁移成本低于重新设计

4. **`/exam/score-history`**
   - 与 assessment facts / history 强相关，适合复用 assessment projection

5. **`/sessions/practice/:sessionId`、`/sessions/active`、`/onboarding/status`**
   - 属于 session/onboarding read model，可在后续阶段统一拆分

6. **`/reports/overview`、`/exam/report/:sessionId`**
   - 属于更复杂的聚合 read path，建议在前面基础 facts 稳定后再迁移

## 5.2 不建议迁移列表

当前不建议在 Phase 2.8 直接迁移的部分：

- 所有 POST / PATCH / DELETE 写路径
- 推荐生成类接口：
  - `/practice-sets/recommended`
  - `/review-resources/recommended`
- AI 对话类接口：
  - `/ai/tutor-reply`
  - `/ai/follow-up`
- 管理和权限类接口
- 系统配置类接口
- 任何会触发写入、状态变更、队列审批、任务调度的接口

## 5.3 删除 `StudyService` 前置条件

在考虑删除 `StudyService` 之前，至少需要满足：

1. **所有 Controller read path 已迁移**
   - Dashboard / Today Plan / Wrong Questions / Student State / Assessment / Session / Report / Profile 等均有独立 QueryService

2. **所有 QueryService / Projection Service 的 parity 测试通过**
   - 新旧 DTO 在固定 `asOf` 下达到可接受兼容

3. **写路径与 read 路径彻底分离**
   - `StudyService` 若仍承担写逻辑，可保留为 command service；但不能再承载 read 聚合

4. **前端确认不再依赖 legacy DTO 的历史字段**
   - 特别是 `knowledgePoints` / `questions` / `report` / `plan` 等复合字段

5. **admin / teacher / analytics / AI 边界明确**
   - 不能把后台分析能力错误地并入 student read model

6. **所有导入路径 / controller wiring / module provider 已改为 query 层**

---

# 6. 结论

Phase 2.8 的审计结果表明：

- `Dashboard`、`TodayPlan`、`WrongQuestion`、`StudentState` 的主读路径已基本具备 query/projection/adapter 分层；
- 仍残留的 legacy read path 主要集中在 `StageAssessment`、`Profile`、`ExamReport`、`Session`、`Onboarding` 与部分 `StudyService` 复合聚合接口；
- `StudyService` 现阶段仍应保留作为兼容与 write/AI/管理入口，但不应继续承担 dashboard/today/wrong-questions 这类主 read path。

下一步建议优先进入：

```text
Phase 2.8.2 -> Assessment / Profile / Session read path 拆分
```

本阶段只完成只读审计，等待评审后再进入设计或实现阶段。
