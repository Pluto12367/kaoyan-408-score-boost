# Phase 2.7.3-F Assessment / Practice Facts Projection Design

> 本文为只读审计与设计产物。
>
> 本阶段未修改 Controller、`StudyService`、schema、migration 或 write path，未实现 projection。

## 1. 目标与当前缺口

当前 `DashboardProjectionService` 已经组合：

- `StudentStateProjectionService`
- `WrongQuestionProjectionService`
- `TodayPlanProjectionService`

但 `DashboardSnapshot` 的以下两个事实域仍为空或不完整：

- `practiceFacts`
- `assessmentFacts`

因此当前 Dashboard legacy parity 存在已知边界：

1. `practiceRecords[]` 不能由 Dashboard projection 复原；
2. `stageAssessment` 只能使用空或 StudentState 的有限摘要；
3. assessment 的 score、accuracy、submittedAt 不能完整进入新的 Dashboard snapshot；
4. LearningSession 尚未进入 Dashboard snapshot。

本阶段建议先补齐事实 projection，再设计 DTO adapter 或 Controller wiring。

---

# 2. Practice facts 审计

## 2.1 Legacy 来源

`StudyService.getDashboardOverview(userId)` 当前直接返回：

```text
this.records.filter((record) => record.userId === userId)
```

`this.records` 的初始化路径：

```text
PracticeRecordRepository.initialize()
  → database mode: PracticeRecord 表
  → memory mode: seed PracticeRecord[]
```

写入路径包括：

- `createPracticeRecord()`
- `createPracticeRecordLegacy()`
- `createPracticeRecordWithReceipt()`
- `submitPracticeSet()`
- `submitPracticeSession()`
- `submitPaper()` / exam related flows

数据库事实表为 `PracticeRecord`，主要字段包括：

- id
- userId
- questionId
- knowledgePointId
- selectedAnswer
- correct
- timeSpentSec
- selfScore
- maxScore
- mistakeReason
- submittedAt
- variantQuestionId

## 2.2 StudentState 已使用的 PracticeRecord facts

`StudentStateProjectionService` 当前只读取有限字段：

- `questionId`
- `correct`
- `submittedAt`

这些字段用于：

- current wrong question membership
- latest wrong time
- wrong question summary
- 部分活动和学习状态派生

StudentState 没有暴露：

- 全量记录 id
- knowledgePointId
- selectedAnswer
- timeSpentSec
- mistakeReason
- selfScore / maxScore
- variantQuestionId

因此不能用 StudentStateSnapshot 直接替代 Dashboard legacy 的 `practiceRecords[]`。

## 2.3 建议的 PracticeHistoryProjection

建议新增独立的只读事实 query/projection，名称可为：

```text
PracticeHistoryProjectionService
```

或作为 DashboardProjectionService 的只读依赖，由更通用的 repository/projection 提供：

```text
PracticeRecordFactsQuery
```

推荐边界：

```text
PracticeRecord
  → PracticeHistoryFacts
  → DashboardSnapshot.practiceFacts
```

不建议：

- 扩展 StudentStateSnapshot 以承载全量作答历史；
- 在 Dashboard adapter 中重新查询 PracticeRecord；
- 从 wrong question snapshot 反推完整练习记录。

## 2.4 PracticeFacts 建议字段

当前 `DashboardPracticeFact` 已定义：

- id
- userId
- questionId
- knowledgePointId
- correct
- timeSpentSec
- mistakeReason
- submittedAt
- variantQuestionId

这些字段均是事实，不包含：

- recommendation
- nextAction
- UI label
- priority
- 展示排序结果

建议 projection 查询：

- `where.userId = userId`
- `submittedAt <= asOf`
- 稳定排序由 projection 只保证事实读取的确定性，不把 UI priority 排序写入 snapshot

时间边界：

```text
PracticeRecord.submittedAt <= asOf
```

是否保留未来记录应由 query 明确排除，不应依赖当前时间。

## 2.5 PracticeFacts 与 Legacy DTO 映射

| PracticeFacts | Legacy `practiceRecords[]` |
|---|---|
| records | 直接映射为兼容记录对象 |
| totalCount | 可用于 dashboard summary，不替代 records |
| latestSubmittedAt | 活动摘要输入 |
| `correct` | accuracy/report 输入 |
| `mistakeReason` | legacy 记录字段 |
| `submittedAt` | legacy 记录字段 |

如果旧 DTO 还需要 `selectedAnswer`、`selfScore`、`maxScore`，当前 snapshot contract 需要在后续 contract change 中扩展；本阶段不直接修改 contract。

---

# 3. Assessment facts 审计

## 3.1 Legacy 来源

`StudyService.getAssessmentHistory(userId)` 使用：

```text
this.assessmentHistoryItems
  .filter((item) => item.userId === userId)
```

数据库模式下初始化来源：

```text
AssessmentHistoryRepository.loadAll()
  → AssessmentHistoryItem 表
```

内存模式下来源：

```text
StudyService.assessmentHistoryItems seed data
```

AssessmentHistoryItem 的主要持久化字段：

- id
- sessionId
- paperId
- userId
- title
- submittedAt
- score
- totalScore
- accuracyRate
- elapsedSec
- unansweredCount
- weakPointTitle
- reviewSuggestion

写入来源包括：

- `importAssessmentHistory()`
- `createStageAssessmentResult()`
- `recordPaperAssessmentHistory()`

## 3.2 StudentState 已使用的 assessment facts

`StudentStateProjectionService` 当前查询 `AssessmentHistoryItem` 的有限字段：

- score
- accuracyRate
- submittedAt（用于排序）

并构建：

```text
assessmentSummary
├─ attemptCount
├─ bestScore
├─ latestAccuracyRate
└─ improvementText
```

当前没有暴露：

- assessment id
- title
- totalScore
- elapsedSec
- unansweredCount
- weakPointTitle
- reviewSuggestion
- sessionId / paperId
- latestScore
- latestSubmittedAt 的完整 DTO 级记录

因此 StudentState 的 `assessmentSummary` 只能支持 dashboard 摘要，不能完整替代 legacy `stageAssessment` 或 assessment history DTO。

## 3.3 建议的 AssessmentProjection

建议新增独立只读 projection：

```text
AssessmentFactsQuery
  → AssessmentHistoryItem facts
  → DashboardSnapshot.assessmentFacts
```

第一阶段只投影 `DashboardAssessmentFacts` 已定义字段：

- attemptCount
- bestScore
- latestScore
- latestAccuracyRate
- latestSubmittedAt

完整 assessment history 可另行设计，不在 DashboardSnapshot 中直接承载所有 assessment 内容。

## 3.4 Assessment 时间边界

必须固定：

```text
AssessmentHistoryItem.submittedAt <= asOf
```

计算口径：

- `attemptCount`：截止 `asOf` 的记录数；
- `bestScore`：所有纳入记录的最大 score；
- `latestScore`：按 submittedAt 降序的第一条；
- `latestAccuracyRate`：最新记录的 accuracyRate；
- `latestSubmittedAt`：最新记录的 submittedAt。

同时间记录应使用稳定次级排序：

```text
submittedAt DESC, id DESC
```

该排序只用于确定 latest fact，不是 UI 排序策略。

## 3.5 AssessmentFacts 与 Legacy DTO 映射

| AssessmentFacts | Legacy dashboard 使用 |
|---|---|
| attemptCount | stageAssessment/history summary |
| bestScore | report / stage summary |
| latestScore | latest assessment summary |
| latestAccuracyRate | latest assessment summary |
| latestSubmittedAt | activity/assessment metadata |

`weakPointTitle` 和 `reviewSuggestion` 属于完整 assessment detail。它们如果仍被旧 dashboard 依赖，应由独立 assessment detail query 处理，不应扩展核心 DashboardSnapshot。

---

# 4. LearningSession facts 审计

## 4.1 当前来源

Prisma schema 中的 `LearningSession` 包含：

- id
- userId
- type
- resourceId
- questionIds
- questionSnapshot
- answers
- markedQuestions
- currentIndex
- revision
- startedAt
- lastActiveAt
- totalActiveMs
- lastResumeAt
- completed

`StudyService` 的 session 读取入口包括：

- `getPracticeSession(sessionId, userId)`
- `listActiveSessions(userId)`
- `getExamReport(sessionId, userId)`
- session submit / resume 相关逻辑

当前 `getDashboardOverview()` 没有直接返回 LearningSession，但它可以影响：

- activity
- task progress
- PracticeRecord
- assessment history

## 4.2 Dashboard 是否必须立即加入 Session facts

建议：保留 contract，但延后完整接入。

原因：

1. 当前 legacy Dashboard DTO 没有明确 session 字段；
2. Dashboard 的 activity 可以先复用 StudentState/Activity projection；
3. 将完整 session 内容放入 dashboard 会引入题目快照和答案状态等过多数据；
4. 如果只需要当前活动 session，应单独提供最小 session summary。

若接入，建议仅投影：

- id
- userId
- type
- startedAt
- lastActiveAt
- completed
- activeCount
- latestActiveAt

不投影：

- answers
- questionSnapshot
- markedQuestions
- UI 恢复状态

---

# 5. DashboardProjectionService 边界设计

## 5.1 当前依赖

当前 DashboardProjectionService 依赖：

```text
StudentStateProjectionService
WrongQuestionProjectionService
TodayPlanProjectionService
```

它可以继续作为聚合协调者，但不应自己复制 PracticeRecord/Assessment 的计算细节。

## 5.2 建议新增依赖

推荐依赖接口：

```text
PracticeFactsProjection
AssessmentFactsProjection
```

可以有两种实现方式。

### 方案 A：独立 QueryService

```text
DashboardProjectionService
  ├─ StudentStateProjectionService
  ├─ WrongQuestionProjectionService
  ├─ TodayPlanProjectionService
  ├─ PracticeFactsQueryService
  └─ AssessmentFactsQueryService
```

优点：

- 复用性强；
- 时间边界清晰；
- 可以独立测试；
- Dashboard 只做组装。

### 方案 B：Dashboard 内部只读 repository

不推荐让 DashboardProjectionService 直接持有 Prisma/repository。

原因：

- 增加 Dashboard 与 schema 的耦合；
- 难以复用；
- 容易复制 legacy 查询逻辑；
- 不利于纯 projection contract 测试。

## 5.3 不应由 DashboardProjectionService 负责

- 生成 Legacy Dashboard DTO；
- 生成报告文案；
- 计算推荐；
- 生成 priority card；
- 生成 nextAction；
- 改写 StudentState 事实；
- 合并 UI 字段；
- 修改数据库。

---

# 6. 无数据库与 fallback 设计

## 6.1 无 `DATABASE_URL`

当前各 projection 的约定是返回空事实或内存 seed facts。

建议保持：

```text
DashboardSnapshot
├─ practiceFacts.source = 'empty'
├─ assessmentFacts.source = 'empty'
└─ sessionFacts.source = 'empty'
```

不能在 projection 中凭空生成：

- 推荐分数；
- 模拟 assessment 结果；
- 虚构 PracticeRecord；
- UI fallback 文案。

## 6.2 memory mode

如果项目要求 memory mode 继续支持 demo 数据，则应由明确的 memory fact provider 提供：

- seed PracticeRecord；
- seed AssessmentHistoryItem；
- seed LearningSession（如果存在）。

不建议 DashboardProjectionService 直接读取 `StudyService` 的 private memory arrays。

---

# 7. 推荐测试设计

## 7.1 Practice facts tests

至少覆盖：

- 截止 `asOf` 的记录才进入 snapshot；
- 其他用户记录被排除；
- correct/incorrect 保持；
- mistakeReason 保持；
- latestSubmittedAt 正确；
- 空结果返回 `source: empty`；
- 不包含 recommendation/nextAction/UI 字段。

## 7.2 Assessment facts tests

至少覆盖：

- 截止 `asOf` 的记录；
- other user 排除；
- bestScore；
- latestScore；
- latestAccuracyRate；
- latestSubmittedAt；
- 同时间稳定排序；
- 空结果返回 null/0；
- 不包含 reviewSuggestion 等 presentation 字段。

## 7.3 Dashboard integration tests

覆盖：

- StudentState facts 与 practice/assessment facts 同一 userId；
- 所有依赖收到同一个 `asOf`；
- projection 不调用 StudyService；
- projection 不生成 Legacy DTO；
- snapshot 不包含 `nextAction`、`recommendation`、`priorityCard`、checkpoint 文案。

---

# 8. 建议实施顺序

## Phase 2.7.3-F-1：practice contract

- 确认 `DashboardPracticeFact` 是否需要补充 selectedAnswer/selfScore/maxScore；
- 固定 `asOf` 边界；
- 确定 memory mode 的 facts provider。

## Phase 2.7.3-F-2：assessment contract

- 确认 Dashboard 只需要 summary 还是需要完整 history；
- 固定 best/latest 计算口径；
- 保持 reviewSuggestion/weakPointTitle 不进入核心 snapshot。

## Phase 2.7.3-F-3：practice projection

- 新增独立只读 Practice facts query/projection；
- 加入 DashboardProjectionService；
- 不接 Controller。

## Phase 2.7.3-F-4：assessment projection

- 新增独立只读 Assessment facts query/projection；
- 加入 DashboardProjectionService；
- 不接 Controller。

## Phase 2.7.3-F-5：parity

- 比较 legacy `practiceRecords[]` 与新 facts；
- 比较 assessment summary；
- 明确记录完整 detail 字段差异；
- 不在 adapter 中补查数据库。

## Phase 2.7.3-F-6：后续 adapter/controller

只有在事实 parity 完成后，才进入：

- Dashboard adapter 补齐；
- DashboardQueryService；
- Controller wiring。

---

# 最终结论

当前缺失的 `practiceFacts` 和 `assessmentFacts` 不能通过扩大 StudentStateSnapshot 简单解决。

推荐边界：

```text
StudentStateProjection
  → 用户状态事实

WrongQuestionProjection
  → 错题与复习事实

TodayPlanProjection
  → 今日计划事实

PracticeFactsProjection
  → 全量练习事实

AssessmentFactsProjection
  → 测评摘要事实

DashboardProjectionService
  → 只读事实聚合

DashboardAdapter
  → Legacy DTO 兼容
```

本阶段仅完成审计、边界和实施设计，未写代码，等待评审。
