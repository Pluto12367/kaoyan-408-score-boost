# ReportWorkspace — StudentContext Design Gate

审计日期：2026-09-04
范围：ReportWorkspace（`apps/web/src/features/report/`）数据请求与 StudentContext v1 消费者的设计判定
环境状态：`ENV-005 = BLOCKED`；`D4-B4 = BLOCKED BY ENVIRONMENT`
基线：分支 `feature/v3-product-refactor`，工作树含大量已确认在途工作线

本文件是**只读设计门禁**，不修改任何生产代码、Schema、Migration、写路径或其他消费者。它回答一个问题：

> ReportWorkspace 的哪些区域应该消费 StudentContext？

并对每个区域给出 A/B/C/D 判定、推荐迁移边界、身份审计、加载语义、以及最多 2~3 步的迁移顺序。

---

## 1. Current Data Flow

ReportWorkspace 是纯展示组件，不直接发请求；数据全部由 `App.tsx` 加载，经 `StudentSections` → `TestSection` → `ReportWorkspace` 传入。

```text
App.tsx (useMemo stageReport + hooks)
   ├─ useDashboardOverviewData ──► GET /dashboard/overview ──► { student, report(WeaknessReport),
   │                                                        questions, plan, wrongQuestions,
   │                                                        learningCalendar, stageAssessment, ... }
   ├─ useCanonicalOverviewData ──► GET /overview/canonical ──► canonicalOverview (可选 fallback)
   ├─ useStudentContextData  ──► GET /student-context    ──► studentContext
   ├─ useStudentProgressData ──► trial-progress / study-reminders / sprint-plan / mastery-map / learning-profile
   ├─ useStudentLearningData ──► practice-sets/recommended / review-resources / wrong-questions/summary / assessment-history
   └─ useStudentProgressData ──► computeStageReport(records, assessmentHistory, masteryMap, wrongSummary, streakDays)
                                                                          │
                                                                          ▼
        StudentSections ──► TestSection ──► ReportWorkspace ──► 5 tabs
                                                     ├─ overview: ReportSummaryPanel + StudentProgressOverview['metrics'] + LearningProfilePanel
                                                     ├─ mastery:  MasteryTrendPanel + StudentProgressOverview['mastery'] + WeaknessReportPanel
                                                     ├─ history:  StageReportPanel + AssessmentHistoryPanel
                                                     ├─ actions:  StudentProgressOverview['trial','reminders','sprint']
                                                     └─ resources: ReviewResourcesPanel + FeedbackPanel + DiagnosticSummary
```

**关键事实：`studentContext` 只传入 `StudentHome`（dashboard），**没有传入 `TestSection` / `ReportWorkspace`**。** 因此 ReportWorkspace 当前的摘要来源是：

| 摘要 | 当前实际来源 | 当 canonicalOverview 存在时 |
|---|---|---|
| mastery 平均/节点薄弱 | `masteryMap`（`/mastery-map`） | `canonicalOverview.mastery` |
| practice 正确率/趋势 | `report.accuracyRate`（`/dashboard/overview`） | `canonicalOverview.progress.last7d` |
| 弱点（Node/Point 分开） | `report.weakPoints` / `masteryMap.weakestPoints` | `canonicalOverview.weaknesses` |
| 错题待复盘 | `stageReport.wrong.pendingCount` / `wrongQuestionSummary` | `canonicalOverview.reviewStatus` |
| 阶段对比/测评趋势 | `stageReport`（前端 `computeStageReport`） | （部分，但 stageReport 独立） |
| 计划任务 | `todayPlan` | `todayPlan` |
| 连续学习 | `learningCalendar.streakDays` / `stageReport.streakDays` | 无 canonical 覆盖 |

---

## 2. Consumer Inventory

逐面板列出数据请求与实际消费字段。

| # | 面板 | 请求/输入 | 消费的关键字段 | 数据域 |
|---|---|---|---|---|
| 1 | `ReportSummaryPanel` | `canonicalOverview`, `report`, `stageReport`, `masteryMap`, `learningProfile`, `wrongQuestionSummary`, `todayPlan` | 预测分、进步/风险、node/point 弱点、错题复盘数、近 7 日趋势 | mastery / practice / review / plan / exam |
| 2 | `StudentProgressOverview['metrics']` | `canonicalOverview`, `report`, `student`, `masteryMap` | 目标分、正确率、剩余天数、预测分 | exam / practice / mastery |
| 3 | `StudentProgressOverview['mastery']` | `canonicalOverview`, `masteryMap` | 节点掌握度（`knowledgeNodeId`）+ Point 数据 | mastery |
| 4 | `StudentProgressOverview['trial'/'reminders'/'sprint']` | `trialProgress`, `studyReminders`, `sprintPlan` | 试用引导、提醒、7 天冲刺 | 专属 API |
| 5 | `WeaknessReportPanel` | `report` | `weakPoints[]`（Point 行为） | practice / weakness |
| 6 | `StageReportPanel` | `stageReport` | 答题表现、测评趋势、掌握度、错题处理、连续天数 | report 专属 |
| 7 | `AssessmentHistoryPanel` | `assessmentHistory` | 测评历史列表 | assessment 专属 |
| 8 | `MasteryTrendPanel` | `fetchMasteryTrend(14)`（`/trend` 直连） | 每日掌握度快照趋势 | mastery 专属 |
| 9 | `LearningProfilePanel` | `learningProfile`（`/students/:id/profile`） | 循环统计、学习状态、时间线 | 专属 API |
| 10 | `ReviewResourcesPanel` | `reviewResources`（`/review-resources/recommended`） | 复习资源推荐 | 专属 API / 推荐 |
| 11 | `FeedbackPanel` / `DiagnosticSummary` | `feedbackStatus`, `diagnosticStatus`, `plan` | 写动作状态 | 写路径 |

---

## 3. Area Classification

判定规则（对应第二节目标）：

- **A. SHOULD_USE_STUDENT_CONTEXT** —— 该摘要存在于 StudentContext，且用 StudentContext 可消除重复真相 / 满足 loading/insufficient_data 语义。
- **B. SHOULD_KEEP_REPORT_PROJECTION** —— 属于 `overview/canonical` 或 report 专属分析，StudentContext 不承载或承载不足。
- **C. SHOULD_KEEP_SPECIALIZED_API** —— trial / reminder / sprint / assessment-history / review-resources / learning-profile / mastery-trend，StudentContext 只提供摘要不提供明细。
- **D. DISCOVERY_ONLY** —— 这里不判定。

| 报告区域 | 分类 | 理由 |
|---|---|---|
| ① 报告 master summary（预测分、进步/风险、长期薄弱点） | **A（部分）** | `predicted`/`improvements`/`risks` 底层是 mastery、practice trend、review、plan 的摘要，StudentContext 已具备 `mastery`、`practice.recentAccuracy`、`review`、`plan`。但 `estimatedPredictedScore` 需要 `exam.remainingDays/current/target`，StudentContext 也具备。**可迁移**。 |
| ② metrics 网格（正确率、预测分） | **A（部分）** | `correct-accuracy` 可用 `StudentContext.practice.recentAccuracy`；但 canonicalOverview 的 `progress.last7d.status`、`sampleSize` 更完整。**可部分迁移**；保留 canonicalOverview 作为优先后备。 |
| ③ 掌握度地图（四科节点掌握） | **A** | `StudentContext.mastery.weakNodes/improvingPoints/masteredPoints` 以 `knowledgeNodeId` 提供，与 canonical 节点口径一致。当前 `masteryMap`（legacy `/mastery-map`）+ `canonicalOverview.mastery` 重复。**用 StudentContext 收敛**。 |
| ④ trial / reminders / sprint | **C** | StudentContext 无这些专属数据（`momentum` 只提供 streak / sessions / activity trend），保留专属 API。 |
| ⑤ WeaknessReportPanel（Point 行为弱点） | **B** | `WeaknessReport.weakPoints[]` 是 Point practice 行为 + `topReason` + `suggestion`，StudentContext 只有 `mastery.weakPoints`（Point 行为弱点，无 `suggestion`）。**保留** canonical/report 投影。 |
| ⑥ StageReportPanel（答题/测评/错题/连续） | **B** | 阶段对比、测评趋势、错题处理、streak 是 report 专属聚合，StudentContext 无阶段对比。**保留**。 |
| ⑦ AssessmentHistoryPanel | **C** | 专属历史列表，StudentContext 无。保留。 |
| ⑧ MasteryTrendPanel（每日快照趋势） | **C** | `/trend` 每日快照，StudentContext 只有当前态，无历史。保留。 |
| ⑨ LearningProfilePanel | **C** | `getStudentLearningProfile` 专属循环统计 + 时间线。保留。 |
| ⑩ ReviewResourcesPanel | **C** | `review-resources/recommended` 是推荐结果，StudentContext 无。保留。 |
| ⑪ FeedbackPanel / DiagnosticSummary | **C** | 写路径，不属读摘要。保留。 |

---

## 4. StudentContext Mapping

当 StudentContext 可用时，ReportWorkspace 的摘要字段应映射为：

| 报告展示字段 | StudentContext 字段 | 备注 |
|---|---|---|
| 平均掌握度 / 节点薄弱 | `mastery.weakNodes`（`knowledgeNodeId`）、`mastery.improvingPoints`、`mastery.masteredPoints` | 不把 `mastery.weakPoints`（Point 行为）当掌握度 |
| 最近正确率 | `practice.recentAccuracy.value`（`window=last7d`） | `status=insufficient_data` 时显示 `--`，不显示 0 |
| 最近练习量 | `practice.recentVolume` | 同上 |
| 待复盘错题 | `review.dueCount`、`review.overdueCount`、`review.pendingWrongQuestionCount` | 注意：StudentContext 的 `review` 没有 `pendingWrongQuestionCount` 字段，需引入或回退 | 
| 今日计划完成 | `plan.completion.completedCount/totalCount/rate` | `studyTaskId` 与 `actionId` 分离 |
| 连续学习 | `momentum.studyStreak` | |
| 目标/剩余天数 | `exam.targetScore/currentScore/remainingDays`、`profile.targetSchool` | |

**关键缺口**（StudentContext 未覆盖，需保留 legacy 或扩展契约）：
- `review.pendingWrongQuestionCount`（待复盘）、`review.reviewedCount`、`review.resolvedCount` —— StudentContext 有 `reviewedCount/resolvedCount`，但**缺 pending 计数**。ReportSummaryPanel 的 `pendingWrongCount` 依赖它。
- `report.speedRisks`（Poind 行为速度风险）—— StudentContext `mastery.weakPoints` 无 `slowCount`；`practice` 无速度风险。保留 report。
- `stageReport` 阶段对比 —— StudentContext 无。保留。
- `assessments` 趋势 —— StudentContext 无。保留。

> 结论：**不要为了迁移 ReportWorkspace 扩大 StudentContext**。待复盘计数和阶段对比属于 report-specific 数据；只有当确认多个摘要消费者都需要同一字段时才进 StudentContext。

---

## 5. Duplicate Truth Analysis

当前 ReportWorkspace 存在**三套并行摘要来源**：

| 领域 | 来源 1 | 来源 2 | 来源 3 | 重复真相 |
|---|---|---|---|---|
| 平均掌握度 | `canonicalOverview.mastery.averageMastery` | `masteryMap`（`/mastery-map`）四科平均 | 无 | **重复**；两者都应来自 `UserKnowledgeMastery`，但经不同管线（canonical selector vs legacy buildNodeMasteryMap） |
| 最近正确率 | `canonicalOverview.progress.last7d.current` | `report.accuracyRate`（近 20 次） | 无 | **重复**；窗口不一致（last7d vs 近 20 次） |
| 弱点 | `canonicalOverview.weaknesses.nodeWeaknesses/practiceWeaknesses` | `report.weakPoints` / `masteryMap.weakestPoints` | `stageReport.mastery.weakestPoints` | **重复**（Node 与 Point 口径不同） |
| 错题待复盘 | `canonicalOverview.reviewStatus.pendingWrongQuestionCount` | `stageReport.wrong.pendingCount` | `wrongQuestionSummary.pendingCount` | **重复** |
| 连续学习 | `stageReport.streakDays` | `learningCalendar.streakDays` | `momentum.studyStreak`（StudentContext） | **重复** |

**重复真相是当前 ReportWorkspace 最大的架构负债**：同一领域多处不同窗口/口径计算，导致「预测分」「进步/风险」「长期薄弱点」在 canonical 与 legacy 之间取值不一致。

**方向**：新增 StudentContext 作为**第三个、也是最终摘要事实源**，让 ReportWorkspace 只保留：
1. `StudentContext` 摘要（mastery/practice/review/plan/momentum/exam）；
2. canonical 或 report 投影用于报告/阶段对比（`stageReport`、`WeaknessReport.speedRisks`）；
3. 专属 API（trial/reminders/sprint/history/resources/profile/trend）。

消除「同一摘要由 masteryMap 与 canonicalOverview 各算一次」的重复；同域数据只从 StudentContext 读取。

---

## 6. Loading / Error / Empty / insufficient_data

| 状态 | StudentContext 语义 | ReportWorkspace 应展示 | 当前行为 | 是否需要改 |
|---|---|---|---|---|
| loading | `context.state==='loading'`，`data=null` | 保留 legacy 视图（`masteryMap`/`report`/canonical），不阻塞 | ReportWorkspace 不读 context，仍用 legacy | 迁移后需保持「loading 不阻塞 + 保留 legacy 兜底」 |
| error | `context.state==='error'`，`data` 可保留旧值 | 显示错误且**不静默回退 mock** | ReportWorkspace 不读 context | 同左侧兜底 |
| empty | 集合为空 | 显示「暂无数据」，不用 0 伪造 | canonical/masteryMap 已有类似逻辑 | 保持 |
| insufficient_data | `status='insufficient_data'`，`value=null` | 显示 `--` | ReportWorkspace 部分字段（如 `predicted`）已这样做 | 迁移字段需遵守 |

**约定**：迁移后的摘要适配层必须复刻 StudentHome 的 `studentHomeContextAdapter` 风格：
- 不 mock、不写库、不创建 Action/Task/Event；
- 不把 `insufficient_data` 当成 0；
- `loading`/`error` 时保留 legacy 兜底，不回退到不同语义的指标。

---

## 7. asOf / Freshness

| 项 | 现状 | 结论 |
|---|---|---|
| `canonicalOverview` | `GET /overview/canonical?asOf=`（可选）；控制器用 `new Date()` 兜底 | 单请求 live snapshot |
| `studentContext` | `GET /student-context?asOf=`（可选）；控制器 `new Date()` 兜底 | 单请求 live snapshot |
| `masteryMap` / trial / reminders / sprint | 无 `asOf` 参数 | 各自 freshness |

**当前 ReportWorkspace 没有任何跨模块固定 `asOf` 的机制**：三套摘要各自在不同时刻计算，窗口边界不一（last7d vs 近 20 次）。这解释了「正确率」在不同面板显示不同值。

方向：ReportWorkspace 摘要消费 StudentContext 时，以 `StudentContext.asOf` 为该摘要的读边界；若未来要跨模块同快照，应单独设计 request-level `asOf`/cache，**不在本次设计门禁中实现**。

---

## 8. Identity Audit

| 身份 | 规则 | ReportWorkspace 现状 | 结论 |
|---|---|---|---|
| `knowledgeNodeId` | `KnowledgeNode.id`，mastery 用 | `MasteryTrendPanel`/canonical/masteryMap 用节点 | OK |
| `knowledgePointId` | `KnowledgePoint.id`，practice 行为用 | `WeaknessReportPanel` 用 `report.weakPoints[].knowledgePointId`；StageReport `mastery.weakestPoints[].knowledgePointId` | **警告**：`StageReport.mastery.weakestPoints` 的 `knowledgePointId` 可能是 Node ID 的 legacy 兼容（见 OVERVIEW-REPORT-CONTRACT §5）。需审计 `computeStageReport` 是否把 Node 当 Point |
| `actionId` | `RecommendationAction.id` | ReportWorkspace 不直接用 | OK |
| `studyTaskId` | `StudyTask.id` | ReportWorkspace 用 `todayPlan.priorityTasks[].id`（task id） | OK；不与 actionId 混用 |

**最需注意的身份风险**：
1. `computeStageReport`（`packages/shared/src/stageReport.ts`）在 `masteryPoints` 处接收 `masteryMap.data.subjects.flatMap(...)` 的 Point。`buildMasteryMapFromState` 已将 Node mastery 适配为 legacy `MasteryMap`，其 `point.knowledgePointId` 实际承载 **Node ID**（Sprint 2 已知的 legacy 适配）。因此 `StageReport.mastery.weakestPoints[].knowledgePointId` 的真实身份是 **Node ID**。这是 legacy compat，**不得进入 StudentContext**；StudentContext 的 `weakNodes` 明确用 `knowledgeNodeId`。
2. `WeaknessReport.weakPoints[].knowledgePointId` 是真实 Point 行为弱点，非 Node。

> 结论：身份边界在 StudentContext 内部保持完整；但 `report`/`stageReport` 的 Point 字段存在 legacy 兼容（Node ID 塞进 Point 字段），在 ReportWorkspace 摘要迁移中**区分 Node mastery 与 Point 行为**，不得混用。

---

## 9. Migration Order

推荐最多 3 个步骤，每步独立可验证、可回退。

**Step 1 — 只读接口契约对齐（不消费）**
- 明确 StudentContext 已覆盖 report 摘要所需的字段；确认 `review` 是否需补 `pendingWrongQuestionCount`。
- 产出：StudentContext 与 ReportWorkspace 摘要字段的映射表（§4 已给出初版）。
- **不碰生产代码**。

**Step 2 — ReportWorkspace 摘要适配层（首个消费者迁移）**
- 新增 `reportWorkspaceContextAdapter.ts`（纯展示适配，复刻 `studentHomeContextAdapter` 边界）。
- 在 `TestSection`/`ReportWorkspace` 接收 `studentContext`，先用于**overview tab** 的：平均掌握度、最近正确率、待复盘错题、今日计划完成、连续学习。
- 保持 `loading`/`error`/`insufficient_data` 时回退到 legacy（masteryMap / report / canonical），不回退到不同语义指标。
- **配契约测试**（Node 身份、Point 行为分离、`insufficient_data→--`、无 mock 写库）。

**Step 3 — 幂等收敛与重复真相消解（可选，低优先级）**
- 在 overview tab 对「平均掌握度」「最近正确率」两个重复源做 canonical 覆盖：StudentContext 存在时视为摘要来源，否则用 canonicalOverview，最后才用 masteryMap/report。
- 保留 `stageReport`（阶段对比）、`WeaknessReportPanel`、专属 API 不动。
- 这不扩大 StudentContext 契约，也不迁移 Recommendation/Coach/Knowledge/Assessment。

---

## 10. Non-Goals（本轮明确不做）

- **不迁移整个 ReportWorkspace 到 StudentContext**；只迁移摘要（overview 摘要、掌握度、correct/trend、待复盘、计划完成、streak）。
- 不迁移 RecommendationService、Coach、Knowledge（图谱/详情）、Assessment（执行/结果）。
- 不改 Student State 写路径、Schema、Migration、AI、D4-B4。
- 不修改 `computeStageReport` / `buildMasteryMapFromState` 的 legacy Point↔Node 适配（标记为 legacy compat，保留）。
- 不新增 Evidence storage、不建立 request-level `asOf`/cache、不引入 RAG/Agent。
- 不删除 legacy `masteryMap`/`report`/`stageReport` 数据源——它们继续作为明细与兜底。

---

## 11. Gate Decision

**READY FOR REPORT WORKSPACE — MIGRATION PLANNED**

判定：

- ReportWorkspace 的**摘要域**（mastery 平均/节点、最近 correct/trend、待复盘错题、计划完成、连续学习）应消费 StudentContext，因为它们与 StudentHome 已迁移的摘要是同一批、同一事实源，且能消除重复真相。
- ReportWorkspace 的**分析/明细域**（`stageReport` 阶段对比、`WeaknessReport.speedRisks`、`AssessmentHistory`、`MasteryTrend` 每日快照、`LearningProfile`、`ReviewResources`、trial/reminders/sprint）**保留**各自的 report projection / 专属 API。
- 迁移边界 = **只读摘要适配**（§9 Step 2），不改契约、不改写路径、不实现 Step 3 之外的收敛。

必须遵守（进入下一消费者前沿用 StudentHome Closure 的约束）：

- `ReportWorkspace` 迁移只做 presentation-only adapter，不查库、不 recompute mastery、不创建 Action/Task/Event、不改变 ID。
- StudentContext != Source of Truth；`learningSignal/UserEvent` 不得直接改 mastery。
- 保留 `ENV-005 = BLOCKED`、`D4-B4 = BLOCKED BY ENVIRONMENT`。
- 验证：契约/适配测试 + shared/API/Web 类型检查可行；完整 `npm test`、Vite bundle、PostgreSQL integration 仍受宿主环境 `spawn EPERM` 阻塞，如实记录，不标记通过。

**本门禁不修改生产代码。** 步骤 1（只读契约对齐）当前已由本文件 §4/§8 完成；步骤 2（summarize 适配层）与步骤 3（收敛）待另行批准后实施。
