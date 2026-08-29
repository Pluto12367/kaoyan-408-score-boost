# Phase 2.7.3 Dashboard Read Path Audit

> 审计性质：只读审计。
>
> 本阶段仅分析 `GET /dashboard/overview` 的当前读取链路，不修改 Controller、`StudyService`、schema 或 migration，也不创建 service。

## 1. 审计结论

`GET /dashboard/overview` 当前仍完全由 `StudyService` 聚合：

```text
GET /dashboard/overview
  → StudyController.getDashboardOverview()
  → StudyService.getDashboardOverview(userId)
  → legacy catalog + legacy records + legacy wrong questions
    + legacy calendar + legacy assessment + legacy report + legacy plan
  → Dashboard Overview DTO
```

该接口不是单一领域查询，而是一个历史聚合 DTO。它同时返回：

- 学生资料；
- 知识点目录；
- 全部题目展示数据；
- 当前用户练习记录；
- 错题列表；
- 学习日历；
- 阶段测评；
- 学情报告；
- 学习计划。

其中仅部分学生状态已经有 Student State projection 可复用；知识点目录、题目列表、完整练习记录和 legacy report/plan 仍没有等价的统一 Dashboard projection。

结论：需要设计独立的 `DashboardQueryService`，但是否需要完整 `DashboardSnapshot` 要按“事实聚合”和“兼容 DTO”分层处理，不能直接把当前 legacy DTO 原样搬入新 projection。

---

# A. Controller 入口

Controller 当前入口：

```text
GET /dashboard/overview
  → StudyController.getDashboardOverview(user, viewUserId?)
  → resolveUserId(user, viewUserId)
  → StudyService.getDashboardOverview(resolvedUserId)
```

路由特征：

- HTTP path：`/dashboard/overview`
- 方法：GET
- 角色：`student`、`teacher`、`admin`
- 支持 `userId` query 参数；最终由 `resolveUserId()` 做权限校验
- 学生只能访问自己；教师需要授权；管理员可查看指定用户
- 当前 Controller 没有 dashboard 专用 query service 注入

当前代码语义：

```text
Controller 负责 userId 权限解析
StudyService 负责全部 dashboard 读取和 DTO 组装
```

后续迁移时应保留 Controller 的权限边界，不应把授权逻辑下沉到 adapter 或 snapshot。

---

# B. StudyService 调用链

## B.1 主调用链

```text
StudyController.getDashboardOverview()
  → resolveUserId()
  → StudyService.getDashboardOverview(uid)
  ├─ this.dataSource
  ├─ getStudent(uid)
  ├─ this.knowledgePoints
  ├─ this.questions → toStudentQuestions()
  ├─ this.records.filter(userId === uid)
  ├─ listWrongQuestions(uid)
  ├─ getLearningCalendar(uid)
  ├─ getStageAssessment(uid)
  ├─ getOverviewReport(uid)
  └─ generatePlan(uid)
```

## B.2 现有方法读取来源

| 方法 | 当前来源 | 说明 |
|---|---|---|
| `getStudent()` | `student` / user memory fallback | 用户目标、阶段、学习配置 |
| `listKnowledgePoints()` / 直接 `knowledgePoints` | knowledge point memory / catalog | 返回完整知识点目录 |
| `toStudentQuestions(this.questions)` | question memory / catalog | 返回完整学生可见题目 |
| `this.records.filter()` | legacy PracticeRecord memory | 返回用户全部练习记录 |
| `listWrongQuestions()` | legacy `records` + review Map + mastery helper | 当前错题旧投影 |
| `getLearningCalendar()` | legacy records/events/task state | 活跃日、streak、日历汇总 |
| `getStageAssessment()` | legacy assessment/records/questions | 阶段测评内容和用户状态 |
| `getOverviewReport()` | legacy records + optional mastery projection | 弱点、准确率、速度风险和建议 |
| `generatePlan()` | legacy profiles/records/mastery/task memory | 每日计划和任务推荐 |

## B.3 重要特征：该接口包含全量内容

Dashboard 当前不是纯“用户状态摘要”，而是包含：

```text
所有知识点
所有题目
当前用户全部练习记录
```

因此其响应大小和数据生命周期与 Student State 完全不同。不能仅用 `StudentStateSnapshot` 替代整个 Dashboard DTO。

---

# C. 当前 DTO 字段

当前 `getDashboardOverview()` 返回对象结构：

```text
DashboardOverview
├─ source
├─ student
├─ knowledgePoints[]
├─ questions[]
├─ practiceRecords[]
├─ wrongQuestions[]
├─ learningCalendar
├─ stageAssessment
├─ report
└─ plan
```

## C.1 `source`

来源：

- `this.dataSource`

语义：

- memory-api / postgresql 等运行模式标记

性质：

- 运行环境元数据，不是学生事实
- 可以在兼容 adapter 中保留
- 不应成为核心 DashboardSnapshot 的业务事实

## C.2 `student`

来源：

- `getStudent(uid)`
- user profile / memory fallback

常见内容：

- id
- name
- role
- targetScore
- currentScore
- targetSchool
- studyStage
- weakestSubject
- dailyHours
- remainingDays

可复用 Student State：

- `goal` 中包含大部分目标字段

缺口：

- 完整学生 profile 字段可能比 `goal` 更多；
- `goal` 是只读 projection，不能直接当作完整旧 student DTO。

## C.3 `knowledgePoints[]`

来源：

- `this.knowledgePoints`
- catalog display mapping

性质：

- 内容目录事实
- 不属于 StudentStateSnapshot
- 目前没有 Dashboard-specific catalog projection

迁移判断：

- 第一阶段可继续由独立 catalog query 提供；
- 不应复制到 StudentStateSnapshot；
- 不应在 DashboardSnapshot 内加入全部题库详情，除非确认 dashboard API 契约必须继续返回全量数据。

## C.4 `questions[]`

来源：

- `this.questions`
- `toStudentQuestions()`

性质：

- 题库内容展示
- 不属于用户状态事实

迁移判断：

- 应由 Questions/Catalog read path 提供；
- Dashboard QueryService 只协调，不应重新实现题目 view mapping；
- 可考虑 adapter 继续组合现有 question query，但不纳入学生状态 snapshot。

## C.5 `practiceRecords[]`

来源：

- `this.records.filter((r) => r.userId === uid)`

性质：

- 用户练习事实
- 当前仍为 legacy memory records

可复用 Student State：

- StudentState 只保留有限 PracticeRecord 派生事实：掌握度、准确率、错题摘要、assessment summary 等

不能由 StudentState 替代：

- 完整 selectedAnswer
- questionId 级别的每次作答
- timeSpentSec
- mistakeReason
- submittedAt 的全量历史
- variantQuestionId

迁移判断：

- 如果旧 dashboard 客户端确实依赖完整记录，需新增独立 practice history projection/query；
- 不应扩大 StudentStateSnapshot 以容纳全量作答明细。

## C.6 `wrongQuestions[]`

来源：

- 当前 `StudyService.listWrongQuestions(uid)`

状态：

- `/wrong-questions` 已通过 `WrongQuestionQueryService` 迁移；
- Dashboard 仍直接走 legacy list；
- 这是 Dashboard 当前最明确的错题 legacy 依赖。

迁移建议：

- 使用 `WrongQuestionQueryService` 的兼容 DTO；或
- 使用 `WrongQuestionSnapshot` 的摘要/列表 adapter；
- Dashboard 不应自己重新分组 PracticeRecord。

## C.7 `learningCalendar`

来源：

- 当前 `StudyService.getLearningCalendar(uid)`

状态：

- Controller 的 `GET /learning-calendar` 已接入 `StudentStateLearningCalendarQueryService`；
- Dashboard 仍调用 StudyService legacy 方法。

迁移建议：

- Dashboard 复用 `StudentStateLearningCalendarQueryService` 的兼容输出；
- 不应同时保留另一套 calendar 计算。

## C.8 `stageAssessment`

来源：

- `StudyService.getStageAssessment(uid)`
- assessment history / question catalog / user answers

状态：

- 当前未由 Student StateSnapshot 完整覆盖；
- StudentState 只有 `assessmentSummary`，没有阶段测评试卷/题目/作答详情。

迁移判断：

- `assessmentSummary` 可复用；
- 完整 `stageAssessment` 需要独立 assessment query/projection；
- 不应把完整测评内容塞进 DashboardSnapshot 的学生状态段。

## C.9 `report`

来源：

- `getOverviewReport(uid)`
- legacy `PracticeRecord` report calculation
- optional `MasterySummaryProjectionService`

状态：

- 是混合 read path；
- 部分 weakPoints/summary 可来自 mastery projection；
- accuracy、speedRisks 等仍可能来自 legacy records。

迁移判断：

- Student State 的 `mastery` 和 `weakPoints` 可作为报告摘要事实；
- 完整 report DTO 需要独立 report query；
- Dashboard QueryService 不应直接调用 `StudyService.getOverviewReport()` 作为长期方案。

## C.10 `plan`

来源：

- `generatePlan(uid)`
- legacy onboarding/profile/task/mastery/records

状态：

- `GET /today/plan` 已迁移到 TodayPlanQueryService；
- Dashboard 仍直接调用 `StudyService.generatePlan()`，不是新的 TodayPlan read path；
- 该 plan 不是同一个 TodayPlan DTO，而是内部生成计划结构。

迁移判断：

- 不能直接用 `TodayPlanQueryService` 替换，除非确认 dashboard 的 `plan` 契约允许改成 TodayPlan DTO；
- 应先识别 dashboard 前端实际消费字段；
- 可能需要 DashboardPlanAdapter 或独立 plan summary projection。

---

# D. 数据来源分析

## D.1 PracticeRecord

当前用途：

- `practiceRecords[]` 全量返回；
- `wrongQuestions[]` 旧错题计算；
- `learningCalendar`；
- `stageAssessment`；
- `report`；
- `generatePlan`；
- 可能影响 student profile 的活动时间。

迁移状态：

- 已进入 Student State 的部分派生字段；
- 未替代 dashboard 的全量历史记录；
- legacy `this.records` 仍是多个下游的事实来源。

## D.2 ReviewSchedule

当前用途：

- `wrongQuestions` 的复习字段；
- 到期复习；
- 计划推荐的复习信号。

迁移状态：

- WrongQuestionSnapshot 已可提供 review/due facts；
- Dashboard 当前仍通过旧错题列表间接消费；
- 应改为复用 `WrongQuestionQueryService`，不应重新计算。

## D.3 StudyTask / StudyTaskCompletion / StudyTaskProgress

当前用途：

- plan；
- learningCalendar；
- 任务完成率和状态；
- dashboard 计划摘要。

迁移状态：

- StudentStateSnapshot 已包含基础 task facts 和 progress；
- `StudyTaskCompletion` 目前没有完整进入 Student StateSnapshot；
- 计划刷新和任务操作仍由 StudyService legacy path 负责。

## D.4 LearningSession

当前 `getDashboardOverview()` 没有直接返回 LearningSession，但 session 写入和活动可能间接影响：

- PracticeRecord
- task progress
- learning calendar
- plan completion

迁移判断：

- 不应把 LearningSession 全量并入 DashboardSnapshot；
- 如 dashboard 需要“当前学习中”状态，应新增 activity/session summary fact；
- 当前 DTO 没有明确 session 字段，可暂不纳入第一阶段。

## D.5 UserKnowledgeMastery

用途：

- mastery map；
- report weakPoints；
- generatePlan；
- recommendation。

迁移状态：

- StudentState mastery projection 已可复用；
- Dashboard 当前仍可能通过 StudyService 混合使用 node mastery 和 legacy records。

## D.6 StudentStateSnapshot

可复用：

- goal
- mastery
- weakPoints
- wrongQuestionSummary
- reviewDue
- studyTasks
- assessmentSummary

不能直接替代：

- 全量 `knowledgePoints`
- 全量 `questions`
- 全量 `practiceRecords`
- 完整 `stageAssessment`
- 完整 `report`
- legacy `plan`
- source/runtime metadata

---

# E. 可复用 StudentState facts

## E.1 直接复用

Dashboard 可以直接消费以下 StudentState facts：

| StudentState 字段 | Dashboard 用途 | 是否可直接映射 |
|---|---|---:|
| `goal` | `student` 的目标/阶段摘要 | 部分 |
| `mastery` | `report`/mastery 摘要 | 部分 |
| `weakPoints` | `report.weakPoints` 或弱点摘要 | 部分 |
| `wrongQuestionSummary` | `wrongQuestions` 数量摘要 | 否，不能替代完整列表 |
| `reviewDue` | 错题复习状态/到期摘要 | 部分 |
| `studyTasks` | plan/tasks 摘要 | 部分 |
| `assessmentSummary` | stageAssessment 摘要 | 部分 |

## E.2 通过已有 query service 复用

建议 Dashboard 复用已存在的兼容 query：

- `StudentStateLearningCalendarQueryService`
- `WrongQuestionQueryService`
- `StudentStateQueryService`
- `StudentStateSprintPlanQueryService`
- `StudentStateTrialProgressQueryService`

注意：QueryService 之间不要互相访问 Controller 或 `StudyService`，Dashboard 只做协调。

## E.3 不应复用 StudentState 的字段

以下内容不应强行扩展到 StudentState：

- 题库全量数据；
- 全量练习记录；
- 阶段测评完整题目；
- 计划推荐文案；
- Dashboard 专属 source 字段；
- 前端 UI action 字段。

---

# F. 是否需要新的 DashboardSnapshot

## F.1 结论

需要，但建议分层，而不是复制当前 DTO：

```text
DashboardSnapshot
├─ profileFacts
├─ catalogFacts?
├─ practiceHistoryFacts?
├─ wrongQuestionFacts
├─ activityFacts
├─ assessmentFacts
├─ reportFacts
└─ planFacts
```

## F.2 必须遵守的边界

`DashboardSnapshot` 只保存事实，不保存：

- UI 文案；
- `nextAction`；
- 推荐策略；
- 排序结果；
- DTO 专属字段名；
- 前端 action anchor；
- 题目展示 view model。

## F.3 是否把全量目录/题目放进 Snapshot

当前不建议。

原因：

1. 目录和题库是内容域事实，不是 Dashboard 用户状态；
2. 全量内容会放大 snapshot 体积；
3. 题目 view mapping 已有 Questions service；
4. 不利于 Dashboard QueryService 与 Student State 的职责分离。

如兼容 DTO 暂时必须返回，建议由独立 catalog query 结果在 adapter/协调层组合，而不是成为核心 DashboardSnapshot 字段。

## F.4 是否把完整 PracticeRecord 放进 Snapshot

取决于实际前端契约：

- 如果仅使用数量、最近活动、准确率，则复用 StudentState/Activity facts；
- 如果使用完整作答历史，则需要独立 `PracticeHistoryProjection`；
- 不应为了兼容旧 DTO 把完整历史塞入 StudentStateSnapshot。

## F.5 推荐的最小 DashboardSnapshot

第一阶段建议只包含：

```text
profileFacts
activityFacts
wrongQuestionFacts
assessmentFacts
reportSummaryFacts
planSummaryFacts
```

全量目录、题目、PracticeRecord 作为独立 supplemental reads，待前端使用情况确认后再决定是否迁移。

---

# G. 建议的 DashboardQueryService 读取边界

虽然本阶段不创建 service，但后续设计可采用：

```text
GET /dashboard/overview
  → DashboardQueryService
  ├─ StudentStateProjectionService
  ├─ WrongQuestionQueryService
  ├─ StudentStateLearningCalendarQueryService
  ├─ assessment query/projection
  ├─ report projection/query
  ├─ TodayPlanQueryService 或 plan summary query
  ├─ catalog query（如旧 DTO 必须保留）
  └─ DashboardAdapter
```

DashboardQueryService 只协调：

- `userId`
- `asOf`
- 各 projection/query 的调用
- supplemental read 组合
- DashboardSnapshot 到 DTO 的 adapter

不应负责：

- 直接 Prisma 查询；
- 重新计算错题；
- 重新生成计划；
- 生成文案；
- 修改数据库；
- 复制 `StudyService` 内部 legacy 算法。

---

# H. 审查后建议的迁移顺序

## H.1 P0：确认 Dashboard 实际消费契约

先确认前端和外部调用方是否真的使用：

- 全量 `knowledgePoints`；
- 全量 `questions`；
- 全量 `practiceRecords`；
- 完整 `stageAssessment`；
- `plan` 的具体字段。

这是决定 DashboardSnapshot 大小和拆分方式的前置条件。

## H.2 P1：先迁移错题和日历下游

替换：

- `wrongQuestions` → `WrongQuestionQueryService`
- `learningCalendar` → `StudentStateLearningCalendarQueryService`

这两个已有稳定兼容 query，风险最低。

## H.3 P1：复用 TodayPlanQueryService 提供计划摘要

不要直接替换旧 `plan`，先确认字段兼容：

- 如果只需要今日任务、完成率、reviewDue，可使用 TodayPlan DTO；
- 如果需要旧的 generated plan 结构，需要独立 plan summary adapter。

## H.4 P2：拆分 report 和 assessment

- `reportSummaryFacts` 使用 mastery/StudentState projection；
- 完整 report 保留独立 report query；
- `assessmentSummary` 使用 StudentState；
- 完整 assessment 保留独立 assessment query。

## H.5 P2：处理 practice history 和 catalog supplemental reads

按实际消费者决定：

- 独立 PracticeHistoryQueryService；
- 独立 QuestionCatalogQueryService；
- Dashboard DTO 兼容组合；
- 或逐步移除不必要的全量字段。

## H.6 P3：最终 Controller wiring

在完成 parity 后，再将：

```text
StudyService.getDashboardOverview()
```

替换为：

```text
DashboardQueryService.getDashboardOverviewCompat()
```

Controller 的 `resolveUserId()`、权限和 endpoint 保持不变。

---

# 最终结论

`GET /dashboard/overview` 当前不是单纯的 dashboard summary，而是一个包含多个内容域和学生域数据的 legacy 聚合接口。

已可复用：

- StudentState 的 goal/mastery/weakPoints/task/reviewDue/assessmentSummary；
- WrongQuestionQueryService；
- StudentStateLearningCalendarQueryService；
- TodayPlanQueryService 的计划兼容输出。

仍需独立处理：

- 全量知识点目录；
- 全量题目；
- 全量 PracticeRecord；
- 完整阶段测评；
- 完整 report；
- dashboard 旧 plan 结构。

推荐后续设计：

```text
先确认前端实际字段消费
  ↓
设计最小 DashboardSnapshot
  ↓
接入错题/日历已有 projection
  ↓
接入 Today Plan summary
  ↓
补充 report/assessment/catalog/history
  ↓
建立 parity
  ↓
最后切换 Controller
```

本阶段仅完成只读审计，等待审查后再进入 Dashboard Read Model 设计阶段。
