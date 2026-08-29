# Phase 2.7 Read Path Audit

> 审计范围：Phase 2.7 之前的 `StudyService` 读取入口，以及 `study.controller.ts`、`score-center`、AI Tutor、Student State 相关读取链路。
>
> 审计性质：只读审计。本报告不包含实现方案代码，也未修改业务代码。

## 1. 审计结论摘要

当前系统已经完成三类错题读取迁移：

- `GET /wrong-questions`
- `GET /wrong-questions/summary`
- `GET /review/due`

这三条接口已经经过：

```text
Controller
  → WrongQuestionQueryService
  → WrongQuestionProjectionService
  → WrongQuestionSnapshot
  → WrongQuestionAdapter
```

仍未迁移的主要读取入口包括：

- `GET /wrong-questions/:questionId/detail`
- `GET /review-resources/recommended`
- `GET /today/plan`
- `GET /practice-sets/recommended`
- `GET /dashboard/overview`
- `GET /reports/overview`
- teacher/admin 视图中直接调用 `listWrongQuestions()` 的聚合逻辑
- AI Tutor 内通过 `StudyService.records` 构造最近错题上下文的逻辑

当前最大的系统性问题不是 Controller 路由缺失，而是 `StudyService` 中仍有大量读取入口直接依赖 legacy facts：

- `this.records`
- `this.reviewSchedules`
- `this.reviewAttemptsByKey`
- `this.wrongQuestionReviewDatesByUser`
- `this.questions`
- `this.knowledgePoints`
- `this.nodeMasteryByUser`

新旧读取链路目前并存，可能造成持久化数据库状态与内存态返回结果不一致。

---

# A. 已迁移接口

## A.1 `GET /wrong-questions`

Controller：

```text
StudyController.listWrongQuestions()
  → WrongQuestionQueryService.getWrongQuestionsCompat()
  → WrongQuestionProjectionService.getSnapshot()
  → WrongQuestionSnapshot.currentWrongItems
  → toLegacyWrongQuestions()
```

事实来源：

- `PracticeRecord`
- `WrongQuestionReview`
- `ReviewSchedule`
- `ReviewAttempt`
- `Question`
- `KnowledgePoint`

已迁移内容：

- 当前错题 membership
- 最新作答状态
- 错误次数
- 作答历史
- 复盘状态
- 掌握判定条件
- 知识点元数据

仍存在的兼容层：

- `reviewStatus`
- `masteryStatus`
- 筛选参数解析

这些由 adapter/query 层生成，不属于 legacy fact 依赖。

## A.2 `GET /wrong-questions/summary`

Controller：

```text
StudyController.getWrongQuestionSummary()
  → WrongQuestionQueryService.getWrongQuestionSummaryCompat()
  → WrongQuestionProjectionService.getSnapshot()
  → toLegacyWrongQuestionSummary()
```

当前摘要已经基于 snapshot 计算：

- pending/reviewed/resolved
- total wrong count
- mastery stats
- mistake reason stats
- priority redo items
- next review actions

需要注意：摘要中的行动文本仍然属于 adapter 策略，不是事实来源。

## A.3 `GET /review/due`

Controller：

```text
StudyController.getDueReviews()
  → WrongQuestionQueryService.getDueReviewsCompat()
  → WrongQuestionProjectionService.getSnapshot()
  → WrongQuestionSnapshot.dueItems
  → toLegacyDueReviews()
```

当前到期判断已经基于：

- `ReviewSchedule.stability`
- `ReviewSchedule.nextReviewAt`
- `asOf`

这条接口已经是后续 Today Plan 统一 `reviewDue` 的目标事实口径。

## A.4 Student State 相关读取

已接入的 Controller 读取入口包括：

- `GET /student-state`
- `GET /mastery-map`
- `GET /trial-progress`
- `GET /study-reminders`
- `GET /sprint-plan`
- `GET /learning-calendar`

主要链路：

```text
Controller
  → StudentStateProjectionService / StudentStateQueryService / 专用 QueryService
  → Prisma projection
  → StudentStateSnapshot 或兼容 DTO
```

Student State 已经覆盖：

- 用户目标
- 掌握度摘要
- 薄弱点
- 错题摘要
- 到期复习摘要
- 学习日历
- 任务与任务进度
- 测评摘要

但这并不意味着整个 `StudyService` 已停止读取 legacy facts。大量旧聚合方法仍然存在备用或主路径。

## A.5 Score Center 事实读取

`ScoreCenterService` 已经直接通过 repository 读取和更新：

- `UserKnowledgeMastery`
- mastery snapshots
- knowledge nodes
- frequency snapshots
- node quests
- exam question relations
- wrong-question touch 状态

代表性读取入口包括：

- 知识点详情
- 错题关联真题/知识点链接
- 当前用户 mastery
- 今日 score center plan
- 节点题目与频次信息

Score Center 的优势是已经以 Prisma/repository 为主要事实来源，但它和 `StudyService` 的旧错题、旧 mastery 计算仍并存，尚未完成全局口径统一。

---

# B. 未迁移接口

## B.1 `GET /wrong-questions/:questionId/detail`

当前链路：

```text
StudyController.getWrongQuestionDetail()
  → StudyService.getWrongQuestionDetail(questionId, user.id)
  → StudyService.records
  → StudyService.questions
  → StudyService.knowledgePoints
  → StudyService.reviewSchedules
  → StudyService.reviewAttemptsByKey
  → getMasteryState()
  → findSimilarQuestions()
  → buildReviewLayers()
  → 旧详情对象
```

未迁移内容：

- 题目详情事实
- 作答历史
- 复习计划
- 复习历史
- 掌握条件
- 相似题
- review layers
- recommendation

其中基础事实可以迁移到 `WrongQuestionDetailSnapshot`；相似题、review layers、recommendation 应保留为 adapter 或 detail strategy。

## B.2 `GET /review-resources/recommended`

当前链路：

```text
StudyController.getRecommendedReviewResources()
  → StudyService.getRecommendedReviewResources(userId)
  ├─ getOverviewReport(userId)
  ├─ getMasteryMap(userId)
  ├─ listWrongQuestions(userId)
  └─ knowledgePoints
  → 生成 ReviewResourceRecommendation
```

该接口不是纯错题接口，而是弱点驱动的资源推荐接口。

错题事实影响：

- 对应知识点的错误次数
- 最新错因
- “错因检查清单”资源文案
- “去错题本复盘”行动

主要事实来源仍是：

- `PracticeRecord`
- legacy `listWrongQuestions()`
- legacy `getOverviewReport()`
- legacy `getMasteryMap()`

## B.3 `GET /today/plan`

当前链路：

```text
StudyController.getTodayPlan()
  → StudyService.getTodayPlan(user.id)
  ├─ sevenDayPlansByUser
  ├─ generatePlan()
  ├─ getOverviewReport()
  ├─ getLearningCalendar()
  ├─ listWrongQuestions()
  ├─ scoreCenterService.getTodayScoreCenterPlan()
  ├─ learningProgressRepository.loadStudyTaskProgress()
  └─ getDueReviews()
  → TodayPlan DTO
```

错题相关输出：

- `summary.todayAccuracyRate`
- `reviewDue`
- 任务 reason/nextAction 的间接影响
- 任务题目关联的间接影响

虽然 `/review/due` 已迁移，但 Today Plan 仍然调用：

```text
StudyService.getDueReviews()
```

因此 `/today/plan` 的 `reviewDue` 可能与 `/review/due` 不一致。

## B.4 `GET /practice-sets/recommended`

当前链路：

```text
StudyController.getRecommendedPracticeSet()
  → StudyService.getRecommendedPracticeSet(userId)
  ├─ getOverviewReport()
  ├─ generatePlan()
  ├─ nodeMastery / node question mapping
  └─ questions
  → 推荐练习集
```

该接口没有直接调用 `listWrongQuestions()`，但会通过以下事实间接反映错题：

- 弱点报告
- 准确率
- mastery
- 任务知识点
- 节点题目映射

它属于“弱点/掌握度驱动推荐”，不是当前 Phase 2.7 的直接错题迁移对象。

## B.5 `GET /dashboard/overview`

当前链路：

```text
StudyController.getDashboardOverview()
  → StudyService.getDashboardOverview(userId)
  ├─ listWrongQuestions()
  ├─ getOverviewReport()
  ├─ generatePlan()
  ├─ getLearningCalendar()
  └─ 其他 dashboard facts
```

该接口直接返回 `wrongQuestions`，仍然依赖 legacy `listWrongQuestions()`。

这是一个明显的未迁移读取入口。即使前端页面已经转向 Student State 或新的错题接口，外部调用者仍可能通过该接口得到旧口径数据。

## B.6 `GET /reports/overview`

当前 Controller 仍调用：

```text
StudyController.getOverviewReport()
  → StudyService.getOverviewReport(userId)
```

`getOverviewReport()` 的数据路径是混合的：

- legacy `this.records`
- legacy `this.knowledgePoints`
- `computeWeaknessReport()`
- `nodeMasteryByUser`
- 可选 `MasterySummaryProjectionService`
- `toReportMasteryDto()`

因此它不是完全 legacy，也不是完全 Student State projection，属于混合读取路径。

## B.7 Teacher Class Analytics

当前链路中，每个学生会读取：

```text
getOverviewReport(userId)
generatePlan(userId)
listWrongQuestions(userId)
getMasteryMap(userId)
getAssessmentHistory(userId)
getLearningCalendar(userId)
```

因此 teacher analytics 仍直接依赖：

- legacy wrong question list
- legacy plan generation
- legacy mastery map fallback

它应在核心 Student State 与错题读取迁移完成后再迁移。

## B.8 Admin Memory Metrics

无数据库或 fallback 模式下，`getMemoryAdminMetrics()` 会读取：

```text
getOverviewReport()
getLearningCalendar()
listWrongQuestions()
generatePlan()
getReviewQueue()
this.records
```

该入口是 admin 运营读模型的 fallback，不是 P0 直接目标，但需要记录为 legacy 依赖。

---

# C. 仍依赖 legacy facts 的地方

## C.1 `StudyService.listWrongQuestions()`

这是当前最核心的 legacy 错题读取源。

它直接读取：

- `this.records`
- `this.questions`
- `this.knowledgePoints`
- `this.wrongQuestionReviewDatesByUser`
- `getMasteryState()`
- `knowledgePointDisplay`

它与新 snapshot 的主要差异：

1. 内存态而非 Prisma projection；
2. 依赖 `wrongQuestionReviewDatesByUser`，而 snapshot 读取 `WrongQuestionReview`；
3. 只按最新 PracticeRecord 判断当前错题；
4. 缺少统一 `asOf`；
5. 同时间记录没有显式 `id` 稳定排序；
6. 掌握状态仍来自旧 `getMasteryState()`；
7. 详情、摘要、teacher analytics 等旧聚合仍可能间接调用它。

## C.2 `StudyService.getDueReviews()`

虽然 Controller 的 `/review/due` 已切换到新 query service，但 `StudyService.getTodayPlan()` 仍调用旧方法。

旧方法直接读取：

- `this.reviewSchedules`
- `this.questions`
- `this.knowledgePoints`
- 当前运行时间 `new Date()`

风险：

- 与 `WrongQuestionSnapshot.dueItems` 的 `asOf` 口径不一致；
- 与数据库持久化 ReviewSchedule 可能不一致；
- Today Plan 与 `/review/due` 可能显示不同数量。

## C.3 `StudyService.getWrongQuestionDetail()`

直接读取：

- `this.records`
- `this.questions`
- `this.knowledgePoints`
- `this.reviewSchedules`
- `this.reviewAttemptsByKey`
- `this.knowledgePointDisplay`

并调用：

- `getMasteryState()`
- `findSimilarQuestions()`
- `buildReviewLayers()`

这是 Phase 2.7 的核心 legacy read path。

## C.4 `StudyService.getMasteryState()`

它基于：

- `this.reviewSchedules`
- `this.records`
- `variantQuestionId`
- `correct`

计算：

- `stability`
- `consecutiveCorrect`
- `variantCorrectCount`
- `masteryStatus`

新 snapshot 已经拥有同等事实字段，但旧详情、列表和其他 service 仍可能继续调用该函数。

## C.5 Overview Report

`getOverviewReport()` 仍以 legacy PracticeRecord/KnowledgePoint 为基础计算：

```text
computeWeaknessReport()
  → applyCatalogDisplay()
  → 可选 MasterySummaryProjectionService 覆盖 weakPoints/summary
```

这形成混合口径：

- accuracy 可能来自 legacy records；
- weakPoints 可能来自 mastery projection；
- display 仍走 legacy catalog mapping；
- 其他调用者无法只根据方法名判断数据来源。

## C.6 Dashboard Overview

`getDashboardOverview()` 直接包含：

```text
wrongQuestions: this.listWrongQuestions(uid)
```

因此即使 `/wrong-questions` 已迁移，dashboard 仍可能返回旧错题 DTO。

## C.7 Today Plan

`getTodayPlan()` 中存在两个重要 legacy 依赖：

```text
const wrongQuestions = this.listWrongQuestions(userId);
const reviewDue = this.getDueReviews(userId).dueCount;
```

当前返回中 `wrongQuestions` 变量主要用于计算/兼容逻辑，而 `reviewDue` 是显式输出。两者都应在后续迁移中清理或切换到新 query/projection。

## C.8 Review Resources

`getRecommendedReviewResources()` 直接调用：

```text
const wrongQuestions = this.listWrongQuestions(userId);
```

因此“错因检查清单”仍依赖 legacy 错题 DTO。

## C.9 Teacher Analytics

`getTeacherClassAnalytics()` 为每位学生调用：

```text
const wrongQuestions = this.listWrongQuestions(userId);
```

teacher 端的错题数和错题详情消费仍未统一到 snapshot。

## C.10 AI Tutor 上下文

AI Tutor 当前并没有直接调用 `WrongQuestionQueryService`。

调用链：

```text
POST /ai/tutor-reply
  → StudyController.createTutorReply()
  → StudyService.createTutorReply()
  ├─ this.questions
  ├─ this.knowledgePoints
  ├─ buildEvidenceSummary()
  ├─ collectSimilarQuestions()
  ├─ buildTutorContext()
  └─ AiTutorService.explain()
```

```text
POST /ai/follow-up
  → StudyController.createAiFollowUp()
  → StudyService.createAiFollowUp()
  ├─ this.questions
  ├─ this.knowledgePoints
  ├─ buildEvidenceSummary()
  ├─ buildTutorContext()
  └─ AiTutorService.followUp()
```

`buildTutorContext()` 中的 `recentWrongQuestions` 直接来自：

- `this.records`
- 当前知识点
- `this.questions`

因此 AI Tutor 依赖 legacy PracticeRecord facts，具体包括：

- 最近错误题目
- 最近错因
- 相关知识点
- 题目解析和标准答案

注意：AI Tutor 当前不是错题列表接口，但它是错题事实的下游消费者。迁移时建议只替换上下文事实来源，不要把 AI 生成内容放入 WrongQuestionSnapshot。

## C.11 Score Center 与 legacy facts 的边界

Score Center 主要通过 Prisma repository 读取 mastery 和知识图谱事实，但以下边界仍未完全清理：

1. `StudyService` 的 `getRecommendedPracticeSet()` 仍负责旧的报告/计划到题目选择；
2. `StudyService` 的 `getRecommendedReviewResources()` 仍把 Score Center/legacy report 与 legacy wrong list 混合；
3. `getTodayPlan()` 仍同时组合 Score Center plan 与 legacy due count；
4. 错题触达 `touchWrongQuestion()` 与旧 WrongQuestionReview/ReviewSchedule 之间还需要统一事实语义。

Score Center 不是当前 Phase 2.7 的直接删除对象，但需要作为下游事实消费者纳入迁移测试。

---

# D. 下一阶段迁移建议

## D.1 P0：完成 Wrong Question Detail Read Migration

推荐链路：

```text
GET /wrong-questions/:questionId/detail
  → WrongQuestionQueryService
  → WrongQuestionProjectionService
  → WrongQuestionDetailSnapshot
  → WrongQuestionDetailAdapter
```

迁移内容：

1. 题目与知识点事实；
2. 最新作答和完整作答历史；
3. 错题复盘状态；
4. ReviewSchedule；
5. ReviewAttempt 历史；
6. mastery criteria；
7. 与旧接口的 parity 测试。

必须保留兼容行为：

- 当前错题和已解决错题都可按既有策略查询；
- `reviewSchedule` 无记录时仍为 `null`；
- `note` 顶层字段继续输出；
- `reviewHistory` 字段结构不破坏前端；
- `similarQuestions`、`reviewLayers`、`recommendation` 由 adapter/补充策略生成。

## D.2 P0：统一 Today Plan 的 `reviewDue`

目标：

```text
Today Plan.reviewDue
  ===
WrongQuestionQueryService / WrongQuestionSnapshot.dueItems.length
```

建议：

- 不先重构整个 Today Plan；
- 只替换到期复习数量的数据来源；
- 保持任务生成、排序、延期、重排行为不变；
- 增加与 `/review/due` 的一致性测试。

## D.3 P1：迁移 Review Resources 的错题增强部分

建议拆分：

```text
ReviewResourceQueryService
  ├─ StudentState / Mastery projection：弱点候选
  ├─ WrongQuestionQueryService：错题增强事实
  └─ ReviewResourceAdapter：资源文案和行动策略
```

保持现有行为：

- 最多 3 个弱点知识点；
- 资源数量和类型不变；
- 有错题时显示错误次数和最新错因；
- 无错题时显示固定错因检查清单；
- `actionAnchor` 不变。

## D.4 P1：迁移 Dashboard 与 Teacher Analytics 的错题读取

优先替换：

- `getDashboardOverview()` 中的 `listWrongQuestions()`；
- `getTeacherClassAnalytics()` 中的 `listWrongQuestions()`；
- admin memory metrics 中的错题计数。

建议使用：

- `WrongQuestionQueryService` 的兼容 DTO；或
- 面向聚合场景的 `WrongQuestionSnapshot` 计数接口。

不建议让 dashboard/teacher 继续重新实现错题分组规则。

## D.5 P1：统一 Overview Report 的 mastery 口径

当前 `getOverviewReport()` 仍是混合读取路径，建议：

1. 明确 PracticeRecord report 与 UserKnowledgeMastery report 的边界；
2. 让 report 明确声明 source；
3. 避免 weakPoints、accuracy、wrongCount 分别来自不同口径；
4. 通过同一组 fixture 验证 Student State、Report、Wrong Question Summary 一致性。

## D.6 P2：迁移 AI Tutor 的 recent wrong context

建议：

- AI Tutor 继续保留在 `AiTutorService`/StudyService 命令链路；
- 仅把 `recentWrongQuestions` 的事实读取改为明确 projection/query；
- 不将 AI 的解释、推荐、follow-up 结果放入错题 snapshot；
- 保留当前 fallback template 行为。

推荐上下文边界：

```text
WrongQuestion / PracticeRecord facts
  → AiTutorContext
  → AiTutorService
```

## D.7 P2：清理 StudyService 旧读取入口

在以下条件满足后再删除或废弃旧方法：

- detail parity 测试通过；
- Today Plan 与 `/review/due` 一致；
- Review Resources 已切换；
- dashboard/teacher analytics 已切换；
- AI Tutor 上下文来源已明确；
- 写命令已经保证数据库与 snapshot 可见性一致。

最终候选清理项：

- `listWrongQuestions()`
- `getDueReviews()`
- `getWrongQuestionDetail()`
- `getMasteryState()`
- 旧 `getWrongQuestionSummary()`
- 旧 review resource 错题查找逻辑

---

# 4. 推荐迁移顺序

```text
Phase 2.7.1
  只读审计（本报告）

Phase 2.7.2
  WrongQuestionDetailSnapshot 类型和纯函数

Phase 2.7.3
  Detail Projection + Detail Adapter + parity tests

Phase 2.7.4
  Controller 切换，保留 StudyService fallback

Phase 2.7.5
  Today Plan.reviewDue 统一到新 due projection

Phase 2.7.6
  Review Resources 错题增强迁移

Phase 2.7.7
  Dashboard / Teacher Analytics 错题读取迁移

Phase 2.7.8
  AI Tutor recent wrong context 迁移

Phase 2.7.9
  清理 StudyService legacy read paths
```

---

# 5. 最终维护负责人结论

当前系统已经完成“错题核心列表/摘要/到期复习”的读取迁移，但尚未完成“所有 StudyService 读取入口”的迁移。

最重要的边界判断是：

1. `WrongQuestionSnapshot` 是错题事实层；
2. `WrongQuestionAdapter` 是兼容输出与展示策略层；
3. Review Resources、Today Plan、Dashboard、Teacher Analytics、AI Tutor 都是错题事实的不同下游消费者；
4. 它们不应各自重新读取和重算错题事实；
5. 迁移应先完成 detail，再统一下游消费，最后删除 legacy read paths。

当前下一步应锁定为：

```text
WrongQuestionDetailSnapshot
  → Detail Projection
  → Detail Adapter
  → Detail Controller Cutover
```

本审计没有实现代码，也没有修改业务文件。
