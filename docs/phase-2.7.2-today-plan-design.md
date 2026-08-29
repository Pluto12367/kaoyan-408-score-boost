# Phase 2.7.2-B Today / Plan Read Model Design

> 基于：`docs/phase-2.7.2-today-plan-audit.md`
>
> 本文是设计阶段产物，仅描述 Read Model 迁移边界，不实现代码。
>
> 本阶段禁止并且未执行：修改代码、创建 service、修改 Prisma schema、改变 Controller wiring。

## 设计原则

1. Today / Plan Read Model 只读取事实，不写入事实。
2. `StudentStateSnapshot` 是跨域学生状态事实投影，不直接等同于旧 `TodayPlan` DTO。
3. 计划策略、文案和 fallback 不应污染 snapshot。
4. 迁移必须保持现有 `GET /today/plan` 的兼容响应，先 parity，再切换 Controller。
5. `reviewDue` 应与已经迁移的 WrongQuestion projection 使用同一事实口径。
6. 当前内存态 plan/task 数据必须逐步被持久化 projection 替代，而不是直接复制到新 service。

---

# 1. 当前 Legacy Today/Plan DTO

## 1.1 `GET /today/plan`

| 项目 | 当前内容 |
|---|---|
| endpoint | `GET /today/plan` |
| Controller 入口 | `StudyController.getTodayPlan()` |
| StudyService 方法 | `StudyService.getTodayPlan(userId)` |
| 当前主数据来源 | `sevenDayPlansByUser`、`onboardingProfiles`、`StudyTask`/计划数据、`PracticeRecord`、`ReviewSchedule`、任务进度、Score Center |
| 当前调用的旧方法 | `generatePlan()`、`getOverviewReport()`、`getLearningCalendar()`、`listWrongQuestions()`、`getDueReviews()`、`getTaskProgressView()`、`getSevenDayPlanSummary()` |
| 主要消费者 | `StudentLearningConsole`、`StudentHome`、`TodayPlan` |

当前调用链：

```text
GET /today/plan
  → StudyController.getTodayPlan(user.id)
  → StudyService.getTodayPlan(userId)
  → 计划刷新/生成 + 报告 + 日历 + 错题 + 到期复习 + 任务进度 + Score Center
  → TodayPlan DTO
```

## 1.2 Legacy `TodayPlan` DTO 结构

前端契约位于 `apps/web/src/api/endpoints/onboarding.ts`，当前结构包括：

```text
TodayPlan
├─ userId
├─ phase
├─ generatedAt
├─ summary
│  ├─ completedTasks
│  ├─ totalTasks
│  ├─ completionRate
│  ├─ todayAccuracyRate
│  └─ streakDays
├─ priorityTasks[]
│  ├─ id
│  ├─ knowledgePointId
│  ├─ questionIds?
│  ├─ subject
│  ├─ chapter
│  ├─ title
│  ├─ minutes
│  ├─ questionCount
│  ├─ mode
│  ├─ priority
│  ├─ reason
│  ├─ nextAction
│  ├─ scheduledDate
│  ├─ status
│  ├─ postponeCount
│  ├─ startedAt?
│  ├─ nextAvailableAt?
│  ├─ completed?
│  └─ progress?
│     ├─ completedQuestionCount
│     ├─ correctCount
│     ├─ minutesSpent
│     └─ reachedTarget
├─ weekProgress[]
│  ├─ date
│  ├─ taskCount
│  ├─ completedTasks
│  ├─ totalMinutes
│  ├─ focusTitle?
│  └─ focusCompleted?
├─ reviewDue
├─ checkpoint
└─ scoreCenter?
```

DTO 中混合了三类内容：

1. 事实：用户、任务状态、日期、计数、进度、复习到期数量；
2. 派生事实：完成率、准确率、streak、阶段；
3. 策略/展示：`reason`、`nextAction`、`checkpoint`、任务排序、`scoreCenter` 内容。

## 1.3 `GET /sprint-plan`

| 项目 | 当前内容 |
|---|---|
| endpoint | `GET /sprint-plan` |
| Controller 入口 | `StudyController.getSprintPlan()` |
| 当前方法 | `StudentStateSprintPlanQueryService.getSprintPlanCompat()` |
| 原 legacy 方法 | `StudyService.getSprintPlan()` |
| 当前状态 | 已切换到 Student State 专用兼容 query service |
| 主要事实 | 七日冲刺计划、任务、风险、阶段状态 |

该接口不应再次并入 Today Plan migration。它已经有独立的兼容 query service，应保持边界稳定。

## 1.4 `GET /dashboard/overview`

| 项目 | 当前内容 |
|---|---|
| endpoint | `GET /dashboard/overview` |
| Controller 入口 | `StudyController.getDashboardOverview()` |
| StudyService 方法 | `StudyService.getDashboardOverview(userId)` |
| 计划相关内容 | plan、report、learningCalendar、wrongQuestions、scoreCenter 等 dashboard 聚合 |
| 当前状态 | 未迁移，仍间接依赖 legacy plan/错题读取 |

它不是 Today Plan 的直接兼容入口，但属于 Plan read model 的下游消费者，应在 Today Plan 稳定后再迁移。

## 1.5 `GET /practice-sets/recommended`

| 项目 | 当前内容 |
|---|---|
| endpoint | `GET /practice-sets/recommended` |
| Controller 入口 | `StudyController.getRecommendedPracticeSet()` |
| StudyService 方法 | `StudyService.getRecommendedPracticeSet(userId)` |
| 计划关系 | 使用 report、stage、fallback daily tasks 和节点题目映射生成练习集 |
| 当前状态 | 未迁移，属于计划推荐下游 |

不建议将练习集推荐字段直接放入 `TodayPlanSnapshot`。

## 1.6 `GET /review-resources/recommended`

| 项目 | 当前内容 |
|---|---|
| endpoint | `GET /review-resources/recommended` |
| Controller 入口 | `StudyController.getRecommendedReviewResources()` |
| StudyService 方法 | `StudyService.getRecommendedReviewResources(userId)` |
| 计划关系 | 为弱点生成概念卡、错因清单、专项训练 |
| 当前状态 | 未迁移，属于 Review Resource read model |

它可以消费 Today/Student State 事实，但不应与 TodayPlan snapshot 合并。

---

# 2. StudentState 可复用事实

## A. 已存在 Projection

## A.1 ActivityProjection

Activity Projection 适合提供：

- 学习活动日期
- 当日是否活跃
- 练习和任务活动聚合
- streak 相关事实

Today Plan 可以复用它支撑：

- `summary.streakDays`
- 今日活动状态
- 日历型展示

不应让 ActivityProjection 负责：

- 生成任务优先级
- 生成 `reason`
- 生成 `nextAction`
- 生成任务排序

## A.2 WrongQuestionProjection

WrongQuestionProjection / `WrongQuestionSnapshot` 适合提供：

- 当前错题数量
- 已解决错题数量
- 到期复习数量
- 最早到期时间
- ReviewSchedule 状态
- 最新错因和错题计数（在需要具体错题时）

Today Plan 当前最重要的复用字段是：

```text
reviewDue.dueCount
```

它应替代：

```text
StudyService.getDueReviews(userId).dueCount
```

这样可以使：

```text
GET /today/plan.reviewDue
===
GET /review/due.dueCount
```

具体错题列表和错因清单不应嵌入 TodayPlanSnapshot，应该由 WrongQuestionQueryService 单独提供给对应消费者。

## A.3 StudentStateSnapshot

当前已有的可复用事实：

### 用户目标 `goal`

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

- 计划阶段上下文
- 用户目标展示
- 任务策略的输入事实

### 掌握度 `mastery`

- `averageMastery`
- `nodeCount`
- `practicedNodeCount`
- `weakCount`
- `reviewCount`
- `masteredCount`
- `lastUpdatedAt`

用途：

- Today summary
- 阶段说明
- 计划策略输入

### 薄弱点 `weakPoints`

- `knowledgeNodeId`
- `subject`
- `chapter`
- `title`
- `masteryRate`
- `accuracyRate`
- `attempts`
- `wrongCount`

用途：

- 计划 focus 知识点
- 推荐训练输入
- 任务事实的知识点补充

### 错题摘要 `wrongQuestionSummary`

- `total`
- `unresolved`
- `reviewed`
- `resolved`
- `latestWrongAt`

用途：

- Today summary
- 计划风险事实
- 任务策略输入

限制：

- 没有具体错题 id 列表；
- 没有 `latestMistakeReason`；
- `total` 是当前错题数量，不是历史错误次数总和。

### 到期复习 `reviewDue`

- `dueCount`
- `overdueCount`
- `nextReviewAt`
- `items`

用途：

- 直接提供 TodayPlan 的 `reviewDue`
- 支撑“今日复习”事实

### 任务 `studyTasks`

- 今日任务 `today`
- status
- scheduledDate
- completed
- completedAt
- priority
- mode
- questionCount
- minutes
- completedQuestionCount
- correctCount
- minutesSpent
- reachedTarget

用途：

- TodayPlan `priorityTasks` 的基础事实
- summary 完成数和进度

当前缺口：

- `knowledgePointId`
- `questionIds`
- `reason`
- `nextAction`
- `postponeCount`
- `startedAt`
- `nextAvailableAt`
- 完整 `weekProgress`
- `checkpoint`

### 测评摘要 `assessmentSummary`

- `attemptCount`
- `bestScore`
- `latestAccuracyRate`
- `improvementText`

用途：

- 计划阶段上下文
- checkpoint 生成输入
- 学习进展展示

## B. 需要补充的 facts

以下属于 Today Plan 需要但 StudentState 当前未完整提供的事实：

### B.1 计划事实

来源候选：`StudyPlan` / `OnboardingPlanRepository` / 计划持久化模型。

需要：

- active plan id
- plan phase
- plan version
- plan generated/updated time
- plan date window
- checkpoint 的原始事实状态
- 当前计划是否过期

注意：`checkpoint` 的解释文案不应放入事实层，但 checkpoint 状态、日期和完成标记可以是事实。

### B.2 任务关联事实

来源候选：`StudyTask` 以及任务关联数据。

需要：

- `knowledgePointId`
- 任务对应的 question ids
- 任务创建时间
- startedAt
- postponeCount
- nextAvailableAt
- 原始 priority / mode

当前 `StudentTaskSnapshot` 已有部分字段，但还不足以完整重建旧 DTO。

### B.3 周计划事实

来源候选：`StudyPlan`、`StudyTask` 聚合。

需要：

- 日期
- 每日任务数
- 每日完成任务数
- 每日总时长
- 每日 focus 知识点或标题
- focus 是否完成

`weekProgress` 应由事实 projection 提供，不应由 adapter 重新遍历内存计划 Map。

### B.4 任务进度事实

来源候选：`StudyTaskProgress`，必要时兼容内存 fallback。

需要：

- completedQuestionCount
- correctCount
- minutesSpent
- 达标事实

`reachedTarget` 可视为基于任务目标和进度的派生事实；第一阶段可在 snapshot builder 中统一计算，但不要在 adapter 中重复计算。

### B.5 活动/准确率事实

来源候选：`PracticeRecord`、ActivityProjection、Mastery Projection。

需要明确：

- `todayAccuracyRate` 的时间窗口；
- 是否包含当天全部 PracticeRecord；
- 是否使用 UserKnowledgeMastery 派生值；
- 无记录时的默认值。

必须先锁定口径，再接入 TodayPlanSnapshot。

### B.6 Score Center plan facts

来源：`ScoreCenterService.getTodayScoreCenterPlan()`。

Score Center 内容可以作为独立嵌入事实，但它不应被硬编码进 StudentState 基础 snapshot，除非所有 Student State 消费者都需要该数据。

建议将它作为 Today Plan 的可选 supplemental read model：

```text
TodayPlanSnapshot + ScoreCenterPlanSnapshot?
```

而不是修改 StudentStateSnapshot 的核心结构。

---

# 3. Snapshot 设计

## 3.1 设计目标

建议设计：

```text
TodayPlanSnapshot
```

它是 Today Plan 专属的事实 read model，负责承接：

- 用户当前计划上下文；
- 当前日期窗口；
- 今日任务事实；
- 周计划事实；
- 任务进度事实；
- 到期复习事实；
- 学习准确率和活动事实；
- 可选 Score Center 原始事实。

它不负责：

- 生成推荐文案；
- 决定任务优先级排序；
- 生成 fallback 任务；
- 生成用户行动建议；
- 输出前端路由和按钮配置。

## 3.2 推荐结构

以下是设计级结构，不是实现代码：

```text
TodayPlanSnapshot
├─ source
├─ userId
├─ asOf
├─ plan
│  ├─ id
│  ├─ phase
│  ├─ status
│  ├─ windowStart
│  ├─ windowEnd
│  ├─ generatedAt
│  └─ checkpointState?
├─ today
│  ├─ date
│  ├─ tasks[]
│  ├─ completedTaskCount
│  ├─ totalTaskCount
│  └─ activity facts
├─ week
│  └─ days[]
├─ reviewDue
├─ accuracy
├─ activity
├─ masterySummary
├─ weakPoints?
├─ taskProgress[]
└─ scoreCenterFacts?
```

## 3.3 字段来源和兼容性说明

### 根字段

| 字段 | 事实来源 | 来源 projection | Legacy DTO 是否需要 |
|---|---|---|---:|
| `source` | projection 组合 | TodayPlanProjection | 否，建议保留用于审计 |
| `userId` | 请求用户 | Query input / User | 是 |
| `asOf` | 查询时间 | Query input | 否，建议保留用于确定性测试 |

### `plan`

| 字段 | 来源表/事实 | 来源 projection | Legacy DTO 是否需要 |
|---|---|---|---:|
| `plan.id` | `StudyPlan` | Plan projection | 否 |
| `plan.phase` | `StudyPlan` / 计划阶段 | Plan projection | 是，对应 `phase` |
| `plan.status` | `StudyPlan` 状态 | Plan projection | 否 |
| `plan.windowStart` | 计划日期窗口 | Plan projection | 否 |
| `plan.windowEnd` | 计划日期窗口 | Plan projection | 否 |
| `plan.generatedAt` | 计划记录 | Plan projection | 可选 |
| `plan.checkpointState` | 计划 checkpoint 原始状态 | Plan projection | 否，旧 DTO 只需文案 |

### `today`

| 字段 | 来源表/事实 | 来源 projection | Legacy DTO 是否需要 |
|---|---|---|---:|
| `today.date` | `asOf` / study date | TodayPlan projection | 否，隐含于请求日期 |
| `today.tasks` | `StudyTask` | StudentState / Task projection | 是，对应 `priorityTasks` 基础数据 |
| `today.completedTaskCount` | `StudyTask.status` | Task projection | 是，对应 summary |
| `today.totalTaskCount` | `StudyTask` | Task projection | 是，对应 summary |
| `today.activity` | `PracticeRecord` / ActivityProjection | ActivityProjection | 否，支持 streak/准确率 |

### `tasks[]`

建议每个任务事实包含：

- `id`
- `knowledgePointId`（如果任务事实表有该关联）
- `questionIds`（任务关联事实）
- `title`
- `subject`
- `chapter`
- `minutes`
- `questionCount`
- `mode`
- `priority`
- `scheduledDate`
- `status`
- `completed`
- `completedAt`
- `startedAt`
- `postponeCount`
- `nextAvailableAt`
- `progress`

其中：

| 字段 | 来源表/事实 | 来源 projection | Legacy DTO 是否需要 |
|---|---|---|---:|
| `id` | `StudyTask` | Task projection | 是 |
| `knowledgePointId` | `StudyTask`/任务关联 | Task projection | 是 |
| `questionIds` | 任务题目关联或节点目录 | Task projection / catalog projection | 是，可选 |
| `title` | `StudyTask` | Task projection | 是 |
| `subject` | 知识点/任务事实 | Task/catalog projection | 是 |
| `chapter` | 知识点/任务事实 | Task/catalog projection | 是 |
| `minutes` | `StudyTask` | Task projection | 是 |
| `questionCount` | `StudyTask` | Task projection | 是 |
| `mode` | `StudyTask` | Task projection | 是 |
| `priority` | `StudyTask` | Task projection | 是 |
| `scheduledDate` | `StudyTask` | Task projection | 是 |
| `status` | `StudyTask` | Task projection | 是 |
| `completed` | `StudyTask` | Task projection | 是 |
| `completedAt` | `StudyTask` | Task projection | 可选 |
| `startedAt` | StudyTask/事件事实 | Task projection | 可选 |
| `postponeCount` | 任务延期事实 | Task projection | 是 |
| `nextAvailableAt` | 任务延期事实 | Task projection | 可选 |
| `progress` | `StudyTaskProgress` | Task progress projection | 是，可选 |

不建议将以下内容放进任务 snapshot：

- `reason`
- `nextAction`
- UI action anchor
- “优先完成”类文案

### `week.days[]`

建议事实字段：

- `date`
- `taskCount`
- `completedTasks`
- `totalMinutes`
- `focusKnowledgePointId?`
- `focusCompleted`

来源：

- `StudyPlan`
- `StudyTask`
- 任务进度
- 知识点关联

Legacy DTO 映射：

- `date`
- `taskCount`
- `completedTasks`
- `totalMinutes`
- `focusTitle` 由 adapter 根据知识点事实生成
- `focusCompleted`

### `reviewDue`

| 字段 | 来源表/事实 | 来源 projection | Legacy DTO 是否需要 |
|---|---|---|---:|
| `dueCount` | `ReviewSchedule.nextReviewAt`, `stability` | WrongQuestionProjection / StudentStateSnapshot | 是，旧 DTO 只需要数字 |
| `overdueCount` | nextReviewAt 与 asOf 日期 | StudentStateSnapshot | 否 |
| `nextReviewAt` | `ReviewSchedule` | WrongQuestionProjection | 否 |
| `items` | `ReviewSchedule` | WrongQuestionProjection | 否，Today Plan 第一阶段可不输出 |

### `accuracy`

建议事实字段：

- `todayAccuracyRate`
- `windowStart`
- `windowEnd`
- `attemptCount`
- `correctCount`

来源候选：

- `PracticeRecord`
- ActivityProjection
- report projection

Legacy DTO 是否需要：

- `todayAccuracyRate` 是；
- 其余字段不是，但建议保留以便审计和 parity。

### `activity`

建议事实字段：

- `streakDays`
- `isActiveToday`
- `latestActivityAt`

来源：

- ActivityProjection
- PracticeRecord
- StudyTask activity

Legacy DTO 是否需要：

- `streakDays` 是；
- 其余字段是新 read model 辅助事实。

### `masterySummary`

可引用 StudentState 的：

- `averageMastery`
- `weakCount`
- `reviewCount`
- `masteredCount`
- `lastUpdatedAt`

Legacy DTO 当前不直接需要，但可供 phase/checkpoint 策略使用。

### `weakPoints`

可以引用 StudentState 的 weakPoints：

- knowledge node id
- subject
- chapter
- title
- accuracy
- mastery
- attempts
- wrong count

Legacy DTO 当前不直接返回，但可用于：

- 任务策略输入；
- 下游推荐；
- parity 解释。

### `scoreCenterFacts`

建议作为可选独立字段或 supplemental model。

来源：

- Score Center repository
- `ScoreCenterService.getTodayScoreCenterPlan()`

Legacy DTO：

- `scoreCenter` 是可选字段，需要兼容；
- 但其推荐文案和排序不应进入核心 TodayPlanSnapshot。

---

# 4. QueryService 设计

## 4.1 建议名称

```text
today-plan-query.service.ts
```

建议类职责：

```text
TodayPlanQueryService
```

它是只读协调层，不是计划生成器。

## 4.2 输入

| 输入 | 类型语义 | 说明 |
|---|---|---|
| `userId` | string | 已经由 Controller 完成权限边界解析的用户 id |
| `asOf` | Date 或 ISO string | 查询时间，默认当前时间，但测试必须显式传入 |

必须使用 `asOf`，不要在内部多个地方分别调用 `new Date()`。

## 4.3 内部读取职责

TodayPlanQueryService 应协调：

```text
StudentStateProjectionService.getSnapshot(userId, asOf)
  ├─ goal
  ├─ mastery
  ├─ weakPoints
  ├─ wrongQuestionSummary
  ├─ reviewDue
  ├─ studyTasks
  └─ assessmentSummary

+ Plan projection
+ Task detail/progress projection
+ ActivityProjection
+ ScoreCenter optional projection
+ TodayPlanAdapter
```

## 4.4 输出

对外输出：

```text
Legacy TodayPlan DTO
```

内部建议流程：

```text
userId + asOf
  ↓
TodayPlanSnapshot
  ↓
TodayPlanAdapter
  ↓
Legacy TodayPlan DTO
```

## 4.5 不应由 QueryService 承担的职责

不应在 `TodayPlanQueryService` 中：

- 创建计划；
- 刷新过期计划并写库；
- 延期任务；
- 重排任务；
- 完成任务；
- 记录学习行为；
- 修改 PracticeRecord；
- 修改 ReviewSchedule；
- 生成不可追溯的内存态事实。

当前 `StudyService.getTodayPlan()` 会在计划过期时刷新并保存计划，这属于读请求触发写入的 legacy 行为。迁移时必须单独决策：

1. 保持兼容，允许外部 refresh command 负责刷新；或
2. 在过渡期保留明确的 plan refresh command；或
3. 暂时封装 legacy refresh，但在 read model 中记录其副作用风险。

不应在新 QueryService 中无条件复制这个副作用。

---

# 5. Adapter 边界

## 5.1 Snapshot → DTO

推荐链路：

```text
TodayPlanSnapshot
  ↓
TodayPlanAdapter
  ↓
Legacy TodayPlan DTO
```

## 5.2 可以放在 Adapter 的逻辑

### 文案

- `reason`
- `nextAction`
- `checkpoint` 展示文案
- 阶段说明
- “今日有 N 道待复习”类文本

### Fallback

- 没有计划时的旧兼容字段；
- 没有任务时的默认数组；
- 没有 Score Center 时的 `null`；
- 没有知识点标题时的显示回退；
- 旧 DTO 对可选字段的省略规则。

Fallback 的前提是它不能伪造底层事实。例如：

- 可以输出空 `weekProgress`；
- 不应伪造一个数据库中不存在的已完成任务。

### 排序

- priorityTasks 的兼容排序；
- weekProgress 的日期排序；
- 到期任务按 nextReviewAt 排序；
- 同优先级下按稳定 id 排序。

但排序只应作用于 DTO 输出，不应在 snapshot 中固化 UI 排序结果。

### 字段兼容

- `reviewDue.dueCount` → `reviewDue`
- `StudentTaskSnapshot` → `priorityTasks[]`
- `focusKnowledgePointId` → `focusTitle`
- 内部 checkpoint state → 旧 `checkpoint` 文案
- 内部 task progress → 旧 `progress` 对象

## 5.3 不能放在 Adapter 的逻辑

Adapter 不得负责：

- Prisma 查询；
- repository 调用；
- 从数据库重新查错题；
- 从数据库重新查任务；
- 判断用户权限；
- 修改计划；
- 写入 ReviewSchedule；
- 写入 StudyTask；
- 重新计算事实型 `reviewDue`；
- 重新计算 PracticeRecord 的准确率；
- 决定当前任务是否真实完成；
- 通过当前时间偷偷改变 snapshot；
- 依据 UI 页面状态改变事实。

尤其需要避免：

```text
Adapter 内调用 StudyService.getDueReviews()
Adapter 内调用 StudyService.listWrongQuestions()
Adapter 内访问 this.records / this.reviewSchedules
```

否则会形成“新 snapshot + 旧事实”的隐性双读路径。

---

# 6. 迁移顺序

## 2.7.2-B：contract

本阶段目标：锁定契约，不写实现。

产出：

- TodayPlan Legacy DTO 字段清单；
- `TodayPlanSnapshot` 字段边界；
- StudentState 可复用字段清单；
- 事实与展示策略分层；
- 无副作用 read path 原则；
- `asOf` 确定性要求。

本设计文档即为该阶段产物，等待确认后再进入下一阶段。

## 2.7.2-C：projection

建议内容：

1. 定义 Today Plan 事实 row；
2. 读取 `StudyPlan` / `StudyTask` / `StudyTaskProgress`；
3. 复用 StudentStateSnapshot；
4. 复用 ActivityProjection；
5. 复用 WrongQuestion reviewDue；
6. 读取 Score Center optional facts；
7. 构建 `TodayPlanSnapshot`；
8. 为 scheduled plan、fallback plan、延期任务、空数据编写 projection 测试。

本阶段不切 Controller。

## 2.7.2-D：adapter

建议内容：

1. 建立 `TodayPlanAdapter`；
2. snapshot 转换为旧 `TodayPlan` DTO；
3. 保持旧字段名称和可选字段语义；
4. 将文案、fallback、排序全部集中在 adapter；
5. 不从 adapter 读取 legacy facts。

本阶段继续保留旧 Controller 路径作为对照。

## 2.7.2-E：parity

至少覆盖：

- 无 onboarding profile；
- 有效 scheduled plan；
- 计划窗口过期；
- fallback generated plan；
- postponed task；
- started task；
- completed task；
- 有和无 ReviewSchedule；
- 有和无错题；
- 有和无持久化 StudyTaskProgress；
- 有和无 Score Center；
- 无 `DATABASE_URL`；
- 固定 `asOf` 下的同一输出；
- priorityTasks 顺序；
- weekProgress 顺序；
- `reviewDue` 与 `/review/due` 一致。

parity 不只比较 JSON 形状，还应比较事实语义：

- completed task 数量；
- reviewDue；
- accuracy；
- task progress；
- scheduledDate；
- completed status。

## 2.7.2-F：controller wiring

最终切换：

```text
StudyController.getTodayPlan()
  → TodayPlanQueryService.getTodayPlanCompat(user.id, asOf)
```

Controller 切换要求：

- 保持角色权限；
- 保持 user.id 来源；
- 不允许客户端伪造 userId；
- 不改变旧 DTO；
- 暂时保留 `StudyService.getTodayPlan()` 作为回滚/对照路径；
- 观察稳定后再删除 legacy read orchestration。

---

# 最终建议

当前不建议直接实现 `TodayPlanQueryService`，应先确认以下边界：

1. `TodayPlanSnapshot` 是否允许包含 `scoreCenterFacts`；
2. `StudyTask` 是否已有完整的 knowledge point / question relation；
3. `postponeCount`、`startedAt`、`nextAvailableAt` 的持久化来源；
4. `todayAccuracyRate` 的时间窗口和计算口径；
5. 计划过期时的读请求副作用是否保留；
6. `reviewDue` 是否正式统一到 StudentState / WrongQuestion projection；
7. `weekProgress` 是否作为 TodayPlan 专属 projection，而不是扩展 StudentStateSnapshot。

推荐决策：

```text
StudentStateSnapshot
  = 通用学生事实

TodayPlanSnapshot
  = Today/Plan 专属事实聚合

TodayPlanAdapter
  = Legacy DTO 兼容与展示策略

TodayPlanQueryService
  = 只读协调
```

本阶段完成的是 **2.7.2-B contract design**，等待确认后再进入 2.7.2-C projection。
