# StudentContext — Consumer Convergence Gate

审计日期：2026-09-04
范围：StudentHome + ReportWorkspace 两个 StudentContext 消费者的收敛性只读审计
环境：`ENV-005 = BLOCKED`；`D4-B4 = BLOCKED BY ENVIRONMENT`
前端基线：`4f58fe3`（工作树含未提交在途工作线）

本文件是**只读审计**，不修改 StudentContext、任何 adapter、消费者、backend、Schema、Migration、Recommendation、AI。唯一产物是这份文档。

核心结论先置：两个消费者已形成**一致的 consumer pattern**（纯展示 adapter + 上游 hook 加载 + legacy 兜底），但存在**三处需要明确取舍的语义分歧**与**少量可复用的共享契约级静态工具**。本门禁判定：**READY FOR NEXT CONSUMER**（下述推荐 Contextual Coach 的只读桥接，需单独批准）。

---

## 1. Current Consumers

StudentContext 的**前端消费面**只有两个（均为摘要式消费）；backend 端 `StudentContext` 只被自身 `QueryService / selector / module / controller` 使用，无其他后端消费者。

| 消费者 | 入口 | 适配器 | 消费的摘要 | 兜底链 |
|---|---|---|---|---|
| StudentHome | `useStudentContextData` → `useDashboardViewModel` | `studentHomeContextAdapter.toStudentHomeSummary` | mastery 平均/分科、weakNode、practice accuracy/volume、review due/overdue、plan completion、studyStreak | contextSummary → canonicalOverview → masteryMap/report |
| ReportWorkspace | `App.tsx` → `StudentSections` → `TestSection` → `ReportWorkspace` → `ReportSummaryPanel` | `reportWorkspaceContextAdapter.toReportWorkspaceSummary` | mastery 平均/weakNodes/counts、practice accuracy/volume、review due/overdue、plan completion、studyStreak | contextSummary → canonicalOverview → masteryMap/report |

两者入口不同（StudentHome 走 `useDashboardViewModel`；ReportWorkspace 走 `ReportSummaryPanel`），但都遵守：

- **单一 hook 加载**：`/student-context` 由 `useStudentContextData` 统一拉取，调用方把 `context.data` 或整体 `ModuleResource` 下传；
- **纯展示 adapter**：无 fetch、无 `Date.now()`、无写入、无 domain 重算；
- **legacy 兜底**：StudentContext 缺失/加载中时不阻塞，回退到 canonicalOverview → masteryMap/report。

---

## 2. Adapter Comparison

| 维度 | `studentHomeContextAdapter` | `reportWorkspaceContextAdapter` | 结论 |
|---|---|---|---|
| 输出形状 | `StudentHomeSummary`（分科 subjects + weakNode + counts） | `ReportWorkspaceSummary`（weakNodes + counts + todayTaskCount） | 不同（服务不同屏幕） |
| `averageMastery` | `roundPercent(nodes.map(mastery))` | `roundPercent(nodes.map(mastery))` | **相同逻辑** |
| `asPercent` | `Math.round(max(0,min(1,v))*100)` | `Math.round(max(0,min(1,v))*100)` | **完全相同** |
| `roundPercent` | 同 | 同 | **完全相同** |
| 分科判定 `subjectId` | 内置（数据/操作/组成/网络） | 无分科 | StudentHome 独有（Report 显示 Node 级非分科） |
| weakNode 选取 | `weakNodes[0]` | `weakNodes` 数组 | 不同（报告要列表，首页要单点） |
| plan status | `source==='empty' ? insufficient : completion.rate.status` | 同 | **相同** |
| review status | `source==='empty' ? insufficient : sufficient` | 同 | **相同** |
| practice status | `source==='empty' ? insufficient : (accuracy或volume sufficient)` | 同 | **相同** |
| hasSufficientData | freshness sufficient + 任一源有数据 | 同 | **相同** |
| 是否消费 Point weakness | 否（`weakPoints` 不进 mastery 摘要） | 否（`weakPoints` 不进 mastery 摘要） | 一致（身份边界正确） |
| 是否新增 pendingWrongQuestionCount | 否 | 否 | **一致（契约未扩）** |

**职责一致性：PASS。** 两个 adapter 的核心数值转化（`asPercent` / `roundPercent` / status 推断 / source→insufficient / 身份保留）完全一致；差异只在**输出形状与屏幕粒度**（分科 vs 列表），属合理分化。

**是否存在重复 domain logic：** 有——`asPercent`、`roundPercent`、`practiceStatus`、`reviewStatus`、`planStatus`、`momentumStatus`、`hasSufficientData`、`allNodes` 这些**纯静态、无副作用、无领域重算**的转换在两端各自复制。它们不涉及实际领域事实的计算（只是百分制转换与状态归一），因此属于**可安全复用的共享契约级工具**，而非需要保护的业务规则。

---

## 3. State Semantics Comparison

| 状态 | StudentHome | ReportWorkspace | 结论 |
|---|---|---|---|
| loading | `useStudentContextData` loading → 保留 legacy 视图，不阻塞 | 同（`studentContext.data` 为 null → 回退） | 一致 |
| error | context error → 显示 error 文案，不静默 mock | 同（`canonicalOverview`/legacy 兜底） | 一致（都遵守「错误不下钻」） |
| empty | `source='empty'` → `insufficient_data`，值 `null | '--'` | 同 | 一致 |
| insufficient_data | `value=null`，不制造 0 | `value=null`，不制造 0 | 一致 |
| asOf | `contextSummary.asOf` 原样传入 | `summary.asOf` 原样返回 | **一致**（均保留契约 asOf，不重算窗口） |
| practice window/sampleSize | `practice.window`/`sampleSize` 传入 | `practice.window`/`sampleSize` 传入 | 一致 |
| pendingWrongCount | context 存在时**置 null**（用 canonicalOverview/wrongQuestionSummary） | context 存在时仍读 `canonicalOverview.reviewStatus.pendingWrongQuestionCount`（`pendingWrongCount` 未从 context 取） | **分歧**（见下） |
| weakPointReason | context 存在 → '基于节点掌握度证据' | `report.weakPoints[0]?.suggestion`（legacy） | 分歧（报告保留 legacy 建议文案） |

**分歧点 1 — `pendingWrongCount` 来源：**
- StudentHome：context 存在时 `pendingWrongCount: null`（因为 StudentContext.review **不含** pendingCount，不臆造），回退到 canonicalOverview/`wrongQuestionSummary.pendingCount`。
- ReportWorkspace：`pendingWrongCount` 始终读 `canonicalOverview.reviewStatus.pendingWrongQuestionCount`，**不依赖 context**。

两者都**正确**：都避免从 StudentContext 臆造 pending 计数（契约无此字段）。差异在于报告仍从 canonicalOverview 读它（因为报告的风险文案依赖待复盘数），而首页直接置 null。这是「StudentContext 未覆盖该字段」这一事实的两个合法处理方式，**不是 bug**；但意味着 pendingCount 目前**没有统一的 canonical 来源**。

**分歧点 2 — weakPointReason 文案：** 首页生成「基于节点掌握度证据」，报告保留 legacy `suggestion`。属屏幕文案差异，不涉身份。

**共性（强收敛）**：null 语义、insufficient_data 不造零、asOf 保留、window 保留、身份保留、loading/error 不阻塞——**五项全部一致**。这是已经稳定、可复用的 consumer pattern。

---

## 4. Legacy Request Inventory

ReportWorkspace + StudentHome 当前并行请求及其标记。

| 请求 | 归属消费者 | 标记 |
|---|---|---|
| `GET /student-context` | 两者摘要 | **A. REQUIRED BY CURRENT UI**（canonical 摘要源） |
| `GET /overview/canonical` | 两者（canonicalOverview） | **B. COMPATIBILITY READ** + **C. DUPLICATE SUMMARY SOURCE**（与 StudentContext 重叠的 mastery/practice/review/progress 摘要仍在被读作兜底） |
| `GET /dashboard/overview` | 两者（student/report/weakPoints/learningCalendar 明细） | **A. REQUIRED**（复杂明细与写路径仍依赖） |
| `GET /trial-progress` | Report 的 trial | **E. OUT OF SCOPE**（专属） |
| `GET /study-reminders` | Report 的 reminders | **E** |
| `GET /sprint-plan` | Report 的 sprint | **E** |
| `GET /mastery-map` | 两者兜底 | **B. COMPATIBILITY READ** + **C. DUPLICATE SUMMARY SOURCE**（与 StudentContext 的节点掌握度重叠） |
| `GET /students/:id/profile` | Report 的 LearningProfile | **E** |
| `GET /review-resources/recommended` | Report 的 ReviewResources | **E** |
| `GET /wrong-questions/summary` | 两者 pendingCount 兜底 | **B. COMPATIBILITY READ** |
| `GET /assessment-history` | Report 的 StageReport/History | **E** |
| `GET /mastery-trend` | Report 的 MasteryTrendPanel | **E** |
| `GET /today/plan` | 两者 todayPlan 明细/任务对象 | **A. REQUIRED**（任务对象与启动回调不可替代） |
| `GET /review/due` | 两者 dueReviews | **A. REQUIRED**（明细） |

**标记分析：**
- `C. DUPLICATE SUMMARY SOURCE`：`/overview/canonical` 与 `/mastery-map` 的 摘要级字段（averageMastery、weakNodes、review、last7d）在 StudentContext 已接管后仍被并行读取，作为**语义兜底**。这是迁移期已知并行成本，**不应现在删除**（用户要求：不删除任何 endpoint/hook）。
- **未来可移除候选**：当 StudentContext 对「摘要级」字段全量接管、且 ReportWorkspace 摘要不再依赖 canonicalOverview 之后，`/overview/canonical` 与 `/mastery-map` 的**摘要级**用途可降级为仅明细兜底。这属于后续收敛，不在本轮。

**明确 A/D/E 判断：**
- 摘要级：`/overview/canonical` → **B + C**（兜底 + 重复源）；`/mastery-map` → **B + C**。
- 明细/专属/写路径：`/dashboard/overview`（明细）、`/today/plan`（任务对象）、`/review/due`（明细）、trial/reminders/sprint/profile/resources/history/trend → **A 或 E**。
- `/dashboard/overview` 的 `report`/`weakPoints` 摘要字段 → **B/C**（与 StudentContext 重叠，但报告仍以 WeaknessReport 为准）。

---

## 5. Contract Sufficiency

**READY AS-IS**（不需要扩字段即可服务下一个摘要消费者）。

| 检查项 | 结论 |
|---|---|
| `pendingWrongQuestionCount` | **不进契约**。StudentContext.review 无此字段；StudentHome 置 null，Report 走 canonicalOverview。/overview/canonical 的 `reviewStatus.pendingWrongQuestionCount` 已是该摘要的 canonical 来源。 |
| report-specific 字段（stageReport、weakPoints.suggestion、speedRisks） | **不进契约**，保留 Report projection。StudentContext.mastery 只含 Node 掌握度与 Point 行为弱点（无 suggestion/speed）。 |
| assessment-specific 字段（assessment trend/history） | **不进契约**，保留 Assessment 专属。 |
| graph/detail 字段（知识图谱、题目详情） | **不进契约**，保留 Knowledge/Assessment。 |
| trial/reminder/sprint | **不进契约**，保留专属 API。 |
| `recommendationEvidence` | 契约已有，作为 provenance（非第二推荐源）。 |

**结论：不属于「通用 Student State Summary」的数据（pendingCount、report 分析、assessment 历史、图谱详情、trial/reminder/sprint）一律不进入 StudentContext。** 这与 StudentContext Contract §10/§12「不扩字段、不引入报表级分析」一致。

---

## 6. Duplication / Risk

| 风险 | 级别 | 说明 | 处理建议 |
|---|---|---|---|
| `asPercent`/`roundPercent`/status 推断在两端复制 | 低 | 纯静态契约级转换，无领域重算 | **可选**：未来若出现第 3 个消费者，可基于"共享语义"抽取为一个极小的纯函数模块（仅百分制/状态归一，不含领域事实），否则不抽。**不在本轮改**。 |
| `pendingWrongCount` 无统一 canonical 来源 | 中 | 首页 null，报告读 canonicalOverview | **记录为 DISCOVERY**，不扩契约；下个消费者若也需 pendingCount，应统一到 `/overview/canonical.reviewStatus` 而非 StudentContext。 |
| with `weakPointReason` 文案分歧 | 低 | 屏幕文案差异 | 忽略。 |
| `/overview/canonical` + `/mastery-map` 作为摘要兜底并行 | 中 | 迁移期已知并行成本 | 保留兜底；后续 StudentContext 全接管后降级为明细。 |
| Contextual Coach 不消费 StudentContext | 中 | Coach 场景由 backend ContextAssembler 独立组装（读 StudentStateProjection 等），未统一到 StudentContext | 见 §7 推荐。 |

**身份风险：Low。** 两个 adapter 都仅用 `knowledgeNodeId` 表达 Node 掌握度，`weakPoints`（Point）不进入 mastery 摘要，且都未消费 legacy `StageReport.mastery.weakestPoints[].knowledgePointId`（Node-as-Point）。`studyTaskId` 与 `actionId` 均未合并。

---

## 7. Recommended Next Consumer

**推荐：Contextual Coach（后端 ContextAssembler 作为 StudentContext 的只读桥接消费者）。**

选择依据（三选一）：

| 候选 | StudentContext 复用价值 | architecture risk | 是否需扩契约 |
|---|---|---|---|
| **Contextual Coach** | **高**：Coach 场景需要 mastery/momentum/review 等 cross-domain 摘要，StudentContext 现成提供；当前后端 ContextAssembler 反而绕开 StudentContext 从 StudentStateProjection/PracticeRecord/WrongQuestion/AssessmentHistory 各自组装，存在重复读取。 | **低**：只读，不改变 Coach 的 LLM/Agent 边界；桥接只替换"场景事实"的数据来源。 | 需评估（见下） |
| Knowledge | 中低：Knowledge 主要消费图谱/详情（`getKnowledgeDetail`/`fetchMyMastery`），StudentContext 只提供 Node mastery 摘要，复用价值有限。 | 中：Knowledge 有图谱/详情边界，迁移易破坏详情语义。 | 不必要 |
| Assessment | 低：Assessment 是执行/结果接口，StudentContext 无考试执行/结果明细。 | 中：执行路径不应被只读摘要替代。 | 不必要 |

**架构价值**：Contextual Coach 目前是**唯一一个"绕开 StudentContext 拼装跨域学习事实"的后端消费者**（读 StudentStateProjectionService、PracticeRecordRepository、WrongQuestionProjectionService、AssessmentHistoryProjectionService、ScoreCenterService）。让 ContextAssembler 以 StudentContext 为**场景事实的只读来源**，可以把「当前学习事实」统一到 canonical read model，避免 Coach 与 StudentContext 各自对同一事实做不同解读。

**Domain boundary 保持**：仅把 ContextAssembler 的 `buildStudentContext` 场景事实改为读 StudentContext（只读），不改 LLM prompt、不改 normalizer、不改 Agent 循环、不改 Student State 写路径。Contextual Coach 仍保留自己的场景 focus assembler（与 Client 的 `request.contextType` 对应）。

**必须先确认（Precondition）**：StudentContext 的 `recommendationEvidence`、`momentum.recentSessions`、`mastery` 是否足以覆盖 Coach 四类场景（question/wrong_question/knowledge_node/assessment）所需的上下文。若某场景需要 `assessment` 历史或 `knowledgePointId` 详情而 StudentContext 缺，则**不扩契约**，保留该场景走 legacy 组装。

> 注意：因 Contextual Coach 目前零 StudentContext 消费（见 §1 grep 结果），把 StudentContext 作为 Coach 场景事实源属于**新增一个 backend 消费者**，涉及 backend 代码与非本次 scope 的 Coach 稳定性验证（3.5.x/3.6）。因此**不进入本轮封闭**；仅作为下轮迁移建议。

---

## 8. Migration Preconditions

若批准下一个消费者（Contextual Coach 桥接），需先满足：

1. 确认 StudentContext 覆盖 Coach 四类场景所需的事实；缺则**对缺口场景保留 legacy 组装，不扩契约**。
2. Bridge 必须保持**只读**：不创建 Action/Task/Event、不改 Student State、不写 Mastery。
3. 保留 Coach 的 prompt/normalizer 场景 focus 独立性；只替换"场景事实"来源。
4. 若第 3 个摘要消费者出现，再评估是否抽取共享纯函数（仅百分制/状态归一），当前不抽。
5. 继续遵守：不新增 pendingCount 到 StudentContext；`/overview/canonical.reviewStatus` 是 pending 计数的 canonical 来源。

---

## 9. Non-Goals（本轮明确不做）

- 不修改 StudentContext 契约、任何 adapter、任何消费者。
- 不删除任何 endpoint / legacy hook（`/overview/canonical`、`/dashboard/overview`、`/mastery-map` 等全部保留）。
- 不把 StudentContext 扩成"通用大 adapter"；不为了 DRY 抽共享 `asPercent`/`roundPercent`（除非第 3 个消费者出现且语义稳定）。
- 不迁移 RecommendationService、Knowledge（图谱/详情）、Assessment（执行/结果）、AI/Agent/RAG。
- 不改 Student State 写路径、Schema、Migration、D4-B4、ENV-005。
- 不做跨模块 request-level `asOf`/cache 设计。
- 不固定单次页面生命周期的 `asOf`（每次刷新由服务端产生新 live snapshot）。

---

## 10. Gate Decision

**READY FOR NEXT CONSUMER**

判定依据：

- **Consumer pattern 已稳定**：两个消费者均遵循「纯展示 adapter + `useStudentContextData` 单一 hook + legacy 兜底」，null / insufficient_data / asOf / identity / loading-error 语义五项一致。
- **Adapter 职责一致**：数值转化与状态推断逻辑完全一致，差异只在屏幕粒度（分科 vs Node 列表），属合理分化。
- **Contract 满足当前摘要需求**：`READY AS-IS`，不需要扩字段；pendingCount/report 分析/assessment 历史/图谱详情/trial/reminder/sprint 均不进入 StudentContext。
- **身份边界安全**：无 Node-as-Point 传播，无 Action/Task 混用，无 legacy StageReport 错误身份消费。

**下阶段（需单独批准）**：把 Contextual Coach 的 ContextAssembler 桥接到 StudentContext 作为只读场景事实源，前提是不扩契约、保持 prompt/Agent 边界、且缺口场景保留 legacy。

必须遵守沿用约束：
- StudentContext != Source of Truth；`learningSignal/UserEvent` 不直接改 mastery。
- 保留 `ENV-005 = BLOCKED`、`D4-B4 = BLOCKED BY ENVIRONMENT`。
- 本门禁未修改任何生产代码；完整 `npm test` / Vite bundle / PostgreSQL integration 仍受宿主环境 `spawn EPERM` 阻塞，如实记录。
