# Phase 2.7.2 Today / Plan Read Path Audit

> 审计性质：只读前置审计。
>
> 范围：`study.controller.ts`、`study.service.ts`、Student State projection，以及 Today / Plan 相关前端契约。
>
> 本阶段未修改代码，未创建 service，未执行迁移实现。

## 审计结论

当前 Today / Plan 读取仍以 `StudyService` 为主入口，且同时使用：

- 内存态 onboarding / plan / task Map；
- `PracticeRecord` legacy records；
- `ReviewSchedule` legacy Map；
- `StudyTaskProgress` repository；
- `getOverviewReport()` 和 `getLearningCalendar()` 的 legacy 兼容路径；
- Score Center 的独立数据库投影。

Student State 已经提供了可复用的统一只读字段：

- `goal`
- `mastery`
- `weakPoints`
- `wrongQuestionSummary`
- `reviewDue`
- `studyTasks`
- `assessmentSummary`

但 Student State 当前还不能完全替代 Today Plan DTO，因为它没有完整提供：

- 今日计划的 `phase`
- 计划生成原因和 `nextAction`
- `weekProgress`
- `checkpoint`
- `scoreCenter`
- 每个任务的 `questionIds`
- postpone / reschedule 后的完整兼容字段

因此建议采用“先复用 Student State 事实，再保留 Today Plan adapter”的渐进迁移方式，而不是直接将 Today Plan 响应替换为 StudentStateSnapshot。

---

# A. Today 接口列表

## A.1 `GET /today/plan`

Controller 定义：

```text
StudyController.getTodayPlan(user)
  → StudyService.getTodayPlan(user.id)
```

这是当前唯一明确以 `today/` 为前缀的 Study Controller GET 接口。

前端调用：

```text
apps/web/src/api/endpoints/onboarding.ts
  → fetchTodayPlan()
  → GET /today/plan
  → TodayPlan DTO
```

主要消费者：

- `StudentLearningConsole`
- `StudentHome`
- `TodayPlan`
- 首页今日任务卡片

## A.2 `GET /today/*` 扫描结果

当前 `study.controller.ts` 中未发现其他 `GET /today/*` 路由。

已发现的相关 today 语义接口：

| 接口 | 作用 | 是否直接属于 Today 读取 |
|---|---|---:|
| `GET /today/plan` | 今日计划完整响应 | 是 |
| `GET /learning-calendar` | 学习日历和今日活动 | 否，属于 Today 相关事实 |
| `GET /study-reminders` | 学习提醒 | 否，属于 Today 相关兼容读取 |
| `GET /review/due` | 到期复习 | 否，属于 Today 计划消费的数据 |
| `GET /student-state` | 统一学生状态 | 否，是潜在事实来源 |

## A.3 与 Today 相关但不是 GET 的接口

以下接口会改变 Today Plan 下次读取结果：

- `POST /onboarding/complete`
- `POST /tasks/:taskId/start`
- `POST /tasks/:taskId/postpone`
- `POST /tasks/:taskId/reschedule`
- `POST /tasks/rebalance`
- `POST /study-tasks/:taskId/complete`
- `POST /practice-records`
- `POST /sessions/practice/:sessionId/submit`
- `POST /assessment-history/import`

这些接口不属于本次 read path 迁移，但必须作为 Today Plan 读取的一致性上游记录。

---

# B. Plan 接口列表

## B.1 `GET /sprint-plan`

```text
GET /sprint-plan
  → StudyController.getSprintPlan()
  → StudentStateSprintPlanQueryService.getSprintPlanCompat()
```

该接口已经从 Student State 专用 query service 输出兼容 DTO。

它是旧的 Plan 读取入口，但当前已经不再直接调用 `StudyService.getSprintPlan()`。

## B.2 `GET /today/plan`

```text
GET /today/plan
  → StudyController.getTodayPlan()
  → StudyService.getTodayPlan()
```

该接口仍未迁移到 Student State query service。

## B.3 `GET /dashboard/overview`

```text
GET /dashboard/overview
  → StudyController.getDashboardOverview()
  → StudyService.getDashboardOverview()
```

虽然 URL 不含 `plan`，但 dashboard 响应包含：

- `plan`
- `wrongQuestions`
- `report`
- `learningCalendar`
- `scoreCenter`

因此它是 Plan 相关的聚合读取入口。

## B.4 `GET /practice-sets/recommended`

```text
GET /practice-sets/recommended
  → StudyController.getRecommendedPracticeSet()
  → StudyService.getRecommendedPracticeSet()
```

该接口不是计划本身，但受到：

- report 弱点
- mastery
- 当前学习阶段
- fallback plan dailyTasks

影响，属于计划推荐下游。

## B.5 `GET /review-resources/recommended`

```text
GET /review-resources/recommended
  → StudyController.getRecommendedReviewResources()
  → StudyService.getRecommendedReviewResources()
```

属于学习计划资源推荐，不是计划状态本身。

## B.6 Plan 相关写接口

当前 Controller 中 Plan / Task 相关写入接口：

| 接口 | 当前服务 | 对后续读取的影响 |
|---|---|---|
| `POST /onboarding/complete` | `completeOnboarding()` | 创建或刷新计划 |
| `POST /tasks/:taskId/start` | `startTask()` | 改变任务状态 |
| `POST /tasks/:taskId/postpone` | `postponeTask()` | 改变可用时间和延期计数 |
| `POST /tasks/:taskId/reschedule` | `rescheduleTask()` | 改变 scheduledDate |
| `POST /tasks/rebalance` | `rebalanceTasks()` | 改变任务负载和计划 |
| `POST /study-tasks/:taskId/complete` | `completeStudyTask()` | 改变任务完成状态和进度 |
| `POST /assessment-history/import` | `importAssessmentHistory()` | 影响计划阶段和报告 |

---

# C. 当前 StudyService 调用链

## C.1 `getTodayPlan()` 总链路

```text
GET /today/plan
  ↓
StudyController.getTodayPlan(user.id)
  ↓
StudyService.getTodayPlan(userId)
  ├─ todayKey()
  ├─ sevenDayPlansByUser
  ├─ onboardingProfiles
  ├─ buildSevenDayPlan()
  ├─ onboardingPlanRepository.saveOnboarding()
  ├─ generatePlan(userId)
  ├─ getOverviewReport(userId)
  ├─ getLearningCalendar(userId)
  ├─ listWrongQuestions(userId)
  ├─ scoreCenterService.getTodayScoreCenterPlan(userId)
  ├─ learningProgressRepository.loadStudyTaskProgress(userId)
  ├─ getTaskProgressView()
  ├─ getSevenDayPlanSummary()
  └─ getDueReviews(userId)
  ↓
TodayPlan DTO
```

## C.2 scheduled plan 分支

当 `sevenDayPlansByUser` 中存在有效计划时：

```text
sevenDayPlansByUser[userId]
  ↓
筛选 scheduledDate === today
  ↓
统计 completedTasks
  ↓
组装 priorityTasks
  ├─ task 原始字段
  ├─ completed
  ├─ progress
  └─ questionIds
  ↓
summary
  ├─ completedTasks
  ├─ totalTasks
  ├─ completionRate
  ├─ report.accuracyRate
  └─ calendar.streakDays
  ↓
reviewDue = getDueReviews(userId).dueCount
weekProgress = getSevenDayPlanSummary(scheduledPlan).days
checkpoint = scheduledPlan.checkpoint
scoreCenter
```

## C.3 fallback plan 分支

当没有有效 scheduled plan 时：

```text
generatePlan(userId)
  ↓
过滤 postponedTasks
  ↓
取前 3 个 availableTasks
  ↓
补充：
  ├─ progress
  ├─ status
  ├─ postponeCount
  ├─ scheduledDate
  └─ questionIds
  ↓
TodayPlan DTO
```

该分支的任务状态来源混合：

- task.completed
- `startedTasks` 内存 Set
- `postponedTasks` 内存 Map
- `learningProgressRepository`

## C.4 当前 StudyService 内部读取依赖

| 调用 | 当前来源 | 迁移状态 |
|---|---|---|
| `generatePlan()` | legacy records / profile / mastery / task state | 未迁移 |
| `getOverviewReport()` | legacy records + optional mastery projection | 混合 |
| `getLearningCalendar()` | StudyService legacy calendar projection | 已有 Student State 替代入口，但 Today Plan 未切换 |
| `listWrongQuestions()` | legacy `this.records` / review Map | 已有 WrongQuestionSnapshot 替代，但 Today Plan 未切换 |
| `getDueReviews()` | legacy `reviewSchedules` Map | `/review/due` 已迁移，Today Plan 未切换 |
| `getTaskProgressView()` | persisted progress + memory fallback | 未统一 |
| `scoreCenterService.getTodayScoreCenterPlan()` | Score Center Prisma/repository | 独立路径 |
| `getSevenDayPlanSummary()` | `ScheduledStudyTaskState` | 未迁移 |

## C.5 `getDashboardOverview()` 调用链

```text
GET /dashboard/overview
  ↓
StudyService.getDashboardOverview(userId)
  ├─ listWrongQuestions(userId)
  ├─ getOverviewReport(userId)
  ├─ generatePlan(userId)
  ├─ getLearningCalendar(userId)
  └─ score center / dashboard fields
```

其中 `wrongQuestions` 仍是 legacy 读取，是 Plan/Dashboard 迁移的关联风险。

---

# D. 可以复用的 StudentState 数据

Student State 的现有结构位于：

`apps/api/src/study/student-state.snapshot.ts`

## D.1 `goal`

可以复用字段：

- `targetSchool`
- `targetScore`
- `currentScore`
- `dailyHours`
- `remainingDays`
- `stage`
- `weakestSubject`
- `diagnosis`
- `examYear`
- `onboardingCompletedAt`

用途：

- 计划阶段展示
- 阶段文案
- 计划生成所需的用户目标上下文

不能完全替代：

- legacy `OnboardingProfileState`
- `SevenDayPlanState.phase`
- 已保存计划的 checkpoint

## D.2 `mastery`

可以复用：

- average mastery
- weak/review/mastered counts
- practiced node count
- last updated time

用途：

- Today Plan summary
- 推荐计划说明
- 阶段判断

风险：

- `StudyService.generatePlan()` 仍可能使用 `nodeMasteryByUser` 和 legacy records；
- Student State mastery 来自 `UserKnowledgeMastery` projection；
- 两者需要 parity 测试，不能直接假定完全等价。

## D.3 `weakPoints`

可复用字段：

- `knowledgeNodeId`
- `subject`
- `chapter`
- `title`
- `masteryRate`
- `accuracyRate`
- `attempts`
- `wrongCount`

用途：

- 计划任务 focus
- 推荐练习集
- Review Resources 弱点候选
- priority task reason

缺少：

- `weaknessScore`
- `topReason`
- `suggestion`
- legacy report 的部分速度风险字段

## D.4 `wrongQuestionSummary`

可复用字段：

- `total`
- `unresolved`
- `reviewed`
- `resolved`
- `latestWrongAt`

用途：

- Today Plan 摘要
- Dashboard 摘要
- 任务优先级说明

注意：

- 它是摘要，不包含具体错题列表；
- 不能替代 Review Resources 中对具体 `wrongCount` 和 `latestMistakeReason` 的读取；
- 当前 summary 的 `total` 是 current wrong items 数量，不等于所有历史错误次数。

## D.5 `reviewDue`

可复用字段：

- `dueCount`
- `overdueCount`
- `nextReviewAt`
- `items`

它是 Today Plan 当前最适合直接复用的字段。

当前 `getTodayPlan()` 的 `reviewDue` 只返回一个数字，而 Student State 还提供了：

- overdue 数量
- 最早到期时间
- 最多 5 个到期项目

建议 Today Plan 第一阶段只使用：

```text
reviewDue = studentState.reviewDue.dueCount
```

保持旧 DTO 兼容，不立即扩展响应。

## D.6 `studyTasks`

可复用字段：

- 今日任务列表 `studyTasks.today`
- 任务状态
- 计划日期
- 完成状态
- 优先级
- 模式
- 题数
- 分钟数
- 已完成题数
- 正确数
- 用时
- `reachedTarget`

这是迁移 Today Plan 最有价值的已有结构。

但与旧 `TodayPlan.priorityTasks` 存在差异：

| 旧 TodayPlan 字段 | StudentTaskSnapshot 是否有 |
|---|---:|
| `id` | 是 |
| `knowledgePointId` | 否 |
| `questionIds` | 否 |
| `subject` | 否 |
| `chapter` | 否 |
| `title` | 是 |
| `minutes` | 是 |
| `questionCount` | 是 |
| `mode` | 是 |
| `priority` | 是 |
| `reason` | 否 |
| `nextAction` | 否 |
| `scheduledDate` | 是 |
| `status` | 是 |
| `postponeCount` | 否 |
| `startedAt` | 否 |
| `nextAvailableAt` | 否 |
| `completed` | 是 |
| `progress` | 已展开为字段 |

因此 Student State 可以提供 Today Plan 的任务事实子集，但不能独立生成完整 legacy DTO。

## D.7 `assessmentSummary`

可复用字段：

- attempt count
- best score
- latest accuracy rate
- improvement text

用途：

- 计划阶段提示
- checkpoint 辅助文案
- 学习进展摘要

当前 TodayPlan DTO 没有直接对应字段，但可作为新 UI 或下一版 DTO 的输入。

---

# E. 需要新增的 QueryService

## E.1 推荐新增：`TodayPlanQueryService`

职责：

- 读取 Today Plan 所需的事实；
- 调用 Student State projection；
- 读取计划和任务相关持久化数据；
- 复用 Score Center plan；
- 通过 adapter 输出兼容 `TodayPlan` DTO。

建议边界：

```text
TodayPlanQueryService
  ├─ StudentStateProjectionService
  ├─ WrongQuestionQueryService 或 due projection
  ├─ ScoreCenterService
  ├─ StudyTask / task progress repository
  ├─ OnboardingPlanRepository
  └─ TodayPlanAdapter
```

## E.2 不建议让 QueryService 负责的内容

不建议 `TodayPlanQueryService` 负责：

- 创建 onboarding plan；
- 推迟任务；
- 重排任务；
- 完成任务；
- 记录 PracticeRecord；
- 生成或修改数据库状态。

这些属于 command service 或现有 `StudyService` 写路径。

## E.3 是否需要独立 `PlanQueryService`

当前建议：不立即拆成两个 service。

原因：

- `GET /sprint-plan` 已由 `StudentStateSprintPlanQueryService` 覆盖；
- `GET /today/plan` 是计划、任务、错题到期、学习表现和 Score Center 的聚合响应；
- 单独新增 `PlanQueryService` 容易与 `TodayPlanQueryService`、`StudentStateSprintPlanQueryService` 职责重叠。

建议先新增一个明确的：

```text
TodayPlanQueryService
```

未来如果出现：

- 周计划详情
- 计划历史
- 计划版本
- 计划 diff

再评估拆出 `StudyPlanQueryService`。

## E.4 需要的 Adapter

建议存在一个独立的 Today Plan adapter，职责是将：

```text
StudentStateSnapshot
+ persisted plan details
+ ScoreCenterPlan
+ legacy strategy fields
```

转换为现有 `TodayPlan` DTO。

adapter 负责：

- `priorityTasks` 字段兼容
- `summary` 字段兼容
- `weekProgress`
- `checkpoint`
- `scoreCenter`
- 旧状态字符串

adapter 不负责：

- 查询数据库
- 生成新计划
- 修改任务
- 推断事实

---

# F. 迁移顺序建议

## F.1 第一步：锁定当前 Today Plan 契约

先为当前 `TodayPlan` 响应建立 fixture/parity 约束，重点覆盖：

- 无 onboarding profile；
- 有效 scheduled plan；
- scheduled plan 已过期并刷新；
- fallback generated plan；
- postponed task；
- started task；
- completed task；
- 有/无 review due；
- 有/无 Score Center；
- 有任务进度持久化；
- 无 `DATABASE_URL` fallback。

## F.2 第二步：只读引入 Student State，不改变响应

新增 Today Plan 查询协调层，但先保持旧 DTO：

```text
TodayPlanQueryService
  → StudentStateProjectionService
  → 现有 plan/task 事实
  → 旧 TodayPlan DTO
```

本阶段只做双读或对照，不切换 Controller 返回值。

## F.3 第三步：先替换 `reviewDue`

把：

```text
StudyService.getDueReviews(userId).dueCount
```

替换为：

```text
StudentStateSnapshot.reviewDue.dueCount
```

验收标准：

```text
GET /today/plan.reviewDue
===
GET /review/due.dueCount
```

同时确认：

- 同一 `asOf`；
- mastered schedule 不计入；
- nextReviewAt 边界一致；
- 数据库和无数据库 fallback 行为明确。

## F.4 第四步：迁移任务事实

优先复用：

- `StudentStateSnapshot.studyTasks.today`
- `StudyTaskProgress`
- `StudyTask.completed`
- `StudyTask.status`

保留现有策略字段来源：

- `reason`
- `nextAction`
- `questionIds`
- `postponeCount`
- `startedAt`
- `nextAvailableAt`

直到这些字段有稳定的持久化 projection 后，再完全替换旧 plan task 组装。

## F.5 第五步：迁移 weekProgress 和 checkpoint

这两个字段当前主要来源于：

- `SevenDayPlanState`
- `getSevenDayPlanSummary()`
- `scheduledPlan.checkpoint`

建议新增计划事实 projection，但不要塞进基础 StudentStateSnapshot，除非确认所有学生状态消费者都需要完整周计划。

## F.6 第六步：迁移 Review Resources 和 Practice Set 下游

Today Plan 基础事实稳定后，再处理：

- `GET /review-resources/recommended`
- `GET /practice-sets/recommended`

使其分别从：

- Student State weakPoints / mastery
- WrongQuestionSnapshot
- Score Center

读取，而不是重复调用 StudyService legacy methods。

## F.7 第七步：迁移 Dashboard / Teacher Analytics

最后处理：

- `GET /dashboard/overview`
- `GET /teacher/class-analytics`
- admin memory metrics

避免在 Today Plan 尚未稳定时同时改动多个聚合入口。

## F.8 第八步：清理 legacy Today Plan reads

满足以下条件后再清理：

- Today Plan parity 测试通过；
- reviewDue 与 `/review/due` 一致；
- task progress 持久化和 fallback 规则明确；
- plan refresh / postpone / reschedule 行为无回归；
- Score Center 可选依赖行为保持；
- 无调用方再依赖 `StudyService.getTodayPlan()` 内部 legacy read path。

候选清理项：

- `StudyService.getDueReviews()` 在 Today Plan 中的调用；
- `StudyService.listWrongQuestions()` 在 Today Plan 中的调用；
- `StudyService.getLearningCalendar()` 在 Today Plan 中的调用；
- 重复的 task progress 组装；
- legacy `getTodayPlan()` read orchestration。

---

# 结论

## 当前已迁移

- `GET /sprint-plan` 已通过 `StudentStateSprintPlanQueryService` 输出兼容 DTO；
- `GET /student-state` 已提供完整的学生状态基础 projection；
- `GET /learning-calendar` 已通过 Student State 专用 query service；
- `GET /review/due` 已通过 WrongQuestion projection/query/adapter；
- `GET /mastery-map` 已通过 mastery projection。

## 当前未迁移

- `GET /today/plan` 仍直接调用 `StudyService.getTodayPlan()`；
- `getTodayPlan()` 仍依赖 legacy `getDueReviews()`；
- `getTodayPlan()` 仍调用 legacy `listWrongQuestions()`；
- 计划任务仍混合使用内存态、repository 和 Student State 不同来源；
- `weekProgress`、`checkpoint`、`reason`、`nextAction`、`questionIds` 尚无完整 Student State 对应字段。

## 推荐下一步

```text
先确认并批准 TodayPlanQueryService 的边界
  ↓
建立 TodayPlan parity fixtures
  ↓
只读接入 StudentStateProjection
  ↓
优先统一 reviewDue
  ↓
再迁移 task facts
  ↓
最后处理 weekProgress / checkpoint / recommendation
```

本次仅完成审计报告，没有创建 service，没有修改代码。
