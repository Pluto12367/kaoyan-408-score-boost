# StudentContext Consumer Discovery Audit

审计日期：2026-09-05
范围：StudentContext Consumer Convergence Milestone — Phase 1 消费者发现审计 + Phase 4 legacy 边界分类
环境：`ENV-005 = BLOCKED`；`D4-B4 = BLOCKED BY ENVIRONMENT`
基线：`4f58fe3` + 本轮工作树（Coach base bridge 已实现并通过定向测试）

本文件是只读审计。扫描范围为仓库实际代码（grep 证据见各表），数据源覆盖任务规定的七类：
`StudentStateProjectionService`、`PracticeRecord`、`UserKnowledgeMastery`、`WrongQuestionReview`、`StudyPlan`、`AssessmentHistory`、`ScoreCenter`。

核心结论：**summary 域的消费者迁移已全部完成（StudentHome / Contextual Coach / ReportWorkspace summary），当前仓库不存在"应当迁移但仍独立组装 student state"的 Category B 消费者。** 其余直接读取 SoT 的代码分属三类合法边界：StudentContext 自身的 source-facts 装配层、投影/兼容读层（服务 detail 端点）、以及领域专属 detail 屏幕。

---

## 1. Method

- 后端：grep `StudentStateProjectionService` 引用面；grep 绕过 repository/projection 直接读 Prisma SoT 模型的文件。
- 前端：对 16 个数据 fetch 函数建立 consumer → fetch 映射（`api/endpoints`、`api/index`、`api/mocks` 除外）。
- 对每个候选消费者按"是否组装 student state summary / 是否领域专属 detail"判定。

## 2. Backend Consumer Inventory

| # | 文件 | 读取 | 分类 | 依据 |
|---|---|---|---|---|
| B1 | `student-context.query.service.ts` | StudentState/Practice/WrongQuestion/TodayPlan/Assessment projections + supplemental Prisma | **A（本体）** | StudentContext 的 source-facts 装配层本身；它是 canonical composition boundary，不是消费者 |
| B2 | `contextual-coach-context-assembler.service.ts` | StudentContext（base）+ StudentState（仅 dailyHours/task.mode 缺口）+ 四场景专属 loader | **A** | Step 1 base bridge 已迁移；缺口读已文档化（契约外两字段，禁止扩契约） |
| B3 | `dashboard-projection.service.ts` | StudentState + WrongQuestion + TodayPlan + Practice + Assessment | **C（兼容读层）** | 组装 `/dashboard/overview` legacy DTO；前端复杂明细（questions 列表、report、learningCalendar、写路径上下文）仍依赖；属迁移期兼容读取 |
| B4 | `student-state-query.service.ts` | MasterySummaryProjection（`getMasteryMapCompat`） | **C（兼容读层）** | `/mastery-map` legacy 端点；前端 masteryMap 兜底仍用 |
| B5 | `student-state-reminder-query.service.ts` | StudentState + Prisma(feedbackSubmission/learningSession/practiceRecord/studyTaskCompletion/wrongQuestionReview) | **C（投影层）** | `/study-reminders` 专属投影；reminder 规则不在 StudentContext 契约内 |
| B6 | `student-state-sprint-plan-query.service.ts` | StudentState + Prisma(practiceRecord/studyPlan/systemConfig) | **C（投影层）** | `/sprint-plan` 专属投影（7 天冲刺） |
| B7 | `student-state-trial-progress-query.service.ts` | StudentState + Prisma(feedbackSubmission/learningSession/studyTaskCompletion/wrongQuestionReview) | **C（投影层）** | `/trial-progress` 专属投影 |
| B8 | `student-state-learning-calendar-query.service.ts` | StudentState + Prisma(practiceRecord/studyTaskCompletion) | **C（投影层）** | `/learning-calendar` 逐日活动明细；StudentContext 只有 momentum 摘要 |
| B9 | `today-plan-projection.service.ts` / `stage-assessment-projection.service.ts` / `assessment-*-projection/query` / `wrong-question-projection/query` / `practice-projection` 等 | 各自 SoT | **C（投影层）** | 这些是 StudentContext 的 facts 来源与 detail 端点供给者；迁移它们等于依赖倒置 |
| B10 | `study.service.ts` | 宽泛（getOverviewReport ×5 调用点、写路径） | **C（legacy 服务）** | `/reports/overview` legacy 与写路径宿主；写路径禁碰；legacy 读取保留（Sprint 3.x 迁移模式 = Legacy → Adapter → 引擎） |
| B11 | `beta-metrics.service.ts` | Prisma(knowledgePoint/learningSession/operationLog/practiceRecord/question) | **C（admin）** | 运营指标，非 student-facing |
| B12 | `task-progress-consistency-checker.service.ts` | Prisma(answerReceipt/learningSession/practiceRecord/studyTask/studyTaskCompletion) | **C（内部一致性工具）** | 数据完整性巡检，需直读 SoT，属其职责 |
| B13 | `score-center/service.ts` | Prisma（mastery/knowledge detail/relation） | **C（领域 SoT 服务）** | Mastery Engine 宿主 + `GET /knowledge/mastery`、`getKnowledgeDetail`；写路径禁碰 |

## 3. Frontend Consumer Inventory

| # | 消费者 | 数据来源 | 分类 | 依据 |
|---|---|---|---|---|
| F1 | StudentHome（`useDashboardViewModel` + `studentHomeContextAdapter`） | `GET /student-context` | **A** | 五类摘要 canonical = StudentContext；legacy 仅作 loading/error 兜底与任务对象明细 |
| F2 | ReportWorkspace summary（`ReportSummaryPanel` + `reportWorkspaceContextAdapter`） | `GET /student-context` | **A** | mastery/practice/review(due,overdue)/plan/momentum 摘要已接管；canonicalOverview/masteryMap/report 为语义兜底 |
| F3 | Contextual Coach 前端（`ContextualCoach`） | `POST /ai/contextual-coach` | **A** | 场景事实由后端 ContextAssembler 组装（base 已接 StudentContext）；前端零 student state 组装 |
| F4 | KnowledgeCatalog（`fetchMyMastery` → `masteryById` 全目录覆盖） | `GET /knowledge/mastery`（UserKnowledgeMastery SoT 读端点） | **C（领域专属）** | 浏览 UI 需要**全量**节点掌握度（含 untouched/review 节点的每点进度条、首屏高亮、subject weakCount）；StudentContext.mastery 按设计只暴露 weak/improving/mastered 桶（summary），不承载全图。迁移 = 扩契约 + 破坏浏览语义 → 不迁。读取走 mastery SoT 自身读端点，非独立二次组装；键为 `knowledgeNodeId`（身份安全） |
| F5 | MistakeWorkspace | `GET /wrong-questions`、dueReviews、summary | **C（领域专属）** | 错题生命周期 detail（筛选、复盘、变式、笔记）是 WrongQuestionReview 领域；StudentContext.review 只有意为 summary |
| F6 | MasteryTrendPanel | `GET /mastery-trend`（每日快照） | **C（领域专属）** | 历史时间序列；StudentContext 只有当前态 |
| F7 | StageReportPanel / AssessmentHistoryPanel / ExamReport | stageReport / assessment-history / exam report | **C（领域专属）** | 测评分析（Rule 3：Assessment 保留 exam analytics） |
| F8 | LearningProfilePanel / LearningProfileCard | `/students/:id/profile` | **C（领域专属）** | 闭环轨迹 + 时间线 |
| F9 | StudentProgressOverview（metrics/mastery sections） | canonicalOverview / masteryMap | **C（report 投影消费）** | 节点/Point 明细卡片属 report 分析域（Design Gate 判定 B 类保留项）；summary 已由 F1/F2 接管 |
| F10 | trial / reminders / sprint 面板 | 三个专属端点 | **C（领域专属）** | 契约外专属数据（多次 Gate 一致判定） |
| F11 | ReviewResourcesPanel / recommended practice set | 推荐端点 | **C（领域专属）** | 推荐结果（RecommendationService 边界保留） |
| F12 | `useDashboardOverviewData`（App 级） | `/dashboard/overview` | **C（兼容读）** | 复杂明细供给（questions/report/learningCalendar/写路径上下文）；summary 优先级已被 F1/F2 覆盖；未来清理候选 |
| F13 | Teacher/Admin 视图 | 各自端点 | **C（非 student-facing）** | 不在本 milestone 范围 |

## 4. Classification Summary

- **Category A（已迁移）**：StudentHome、Contextual Coach（base bridge）、ReportWorkspace summary、Coach 前端。
- **Category B（需迁移）**：**空**。原 B 清单中最后一项（ReportWorkspace summary）已在前一轮迁移并通过验收；Knowledge/Assessment 经证据审计降级为 C（见 §3 F4/F7 依据）。
- **Category C（保持独立）**：投影/兼容读层（B3–B9）、legacy 服务与内部工具（B10–B12）、领域 detail 屏幕（F4–F12）、非 student-facing（B11/F13）。

## 5. Duplicate Composition Check（"No duplicate student state composition"）

对"同一 summary 被两处独立计算"的复查：

| Summary | 计算点 | 状态 |
|---|---|---|
| mastery 平均/分科 | StudentContext.selector（canonical）↔ `studentHomeContextAdapter`/`reportWorkspaceContextAdapter`（纯展示转换，非二次计算）↔ canonicalOverview/masteryMap（仅 StudentContext 缺席时兜底） | ✅ 无重复 canonical；adapter 不重算领域事实 |
| practice 正确率/趋势 | 同上 | ✅ |
| review due/overdue | 同上 | ✅ |
| plan completion | 同上 | ✅ |
| momentum streak | 同上 | ✅ |
| 待复盘错题 pendingCount | `/overview/canonical.reviewStatus`（canonical）↔ stageReport/wrongQuestionSummary（legacy 兜底） | ⚠️ 已记录（Convergence Gate DISCOVERY）；pendingCount 不入 StudentContext 为既定红线，legacy 兜底合法 |
| Coach base student state | StudentContext（canonical）↔ StudentState（仅 dailyHours/mode 缺口 + 未注入时 legacy fallback） | ✅ 缺口读已文档化 |

## 6. Legacy Boundary Classification（Phase 4）

| 项 | 分类 | 处置 |
|---|---|---|
| `/dashboard/overview`（B3+F12） | Required legacy | 保留；detail 依赖仍在；未来清理候选（F12） |
| `/mastery-map`（B4） | Required legacy | 保留；前端兜底仍用 |
| `/student-state` 端点 | Required legacy | 保留（投影读边界） |
| `/reports/overview`（B10） | Required legacy | 保留（legacy report 契约） |
| 四个 specialized query services（B5–B8） | Required legacy（投影层） | 保留 |
| Coach StudentState 缺口读（B2 内） | Migration candidate（远期） | 若未来契约向后兼容增量覆盖 dailyHours/task.mode，可收敛；当前禁止扩契约 |
| 死代码 | 未发现 | 无删除动作 |

## 7. Identity / Freshness Spot Audit（全消费者）

- **Node/Point**：F4 KnowledgeCatalog 以 `knowledgeNodeId` 为 mastery 键（正确）；F1/F2 adapter 弱点列表只含 `knowledgeNodeId`；无 Node-as-Point 传播（legacy `StageReport.mastery.weakestPoints[].knowledgePointId` 仍无消费者转入 canonical， Coach/adapter 均未触碰）。
- **Action/Task**：StudentContext.plan 分离 `studyTaskId`/`actionId`；Coach currentTasks 键集不含 actionId；adapter 不合并。
- **Freshness**：三个 A 类消费者的 state 时间语义均来自 `StudentContext.asOf`/query boundary；前端 adapter 无 `new Date()`（测试钉死）；Coach focus loader 保留实时行为（设计内差异，已文档化）。
- **insufficient_data**：adapter 一律 `null`/`--`，不制造 0（测试钉死）。

## 8. Conclusion

Phase 1 审计完成：**无剩余 Category B 消费者**。Summary 域收敛已完成；领域 detail 与投影层按 Rule 3 保留独立。进入 Phase 3（Contract Hardening 审查）与 Final Validation。
