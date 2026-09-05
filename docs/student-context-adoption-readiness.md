# StudentContext Adoption Readiness

**Decision:** READY FOR CONSUMER MIGRATION（限定为小步、带 adapter 的迁移）  
**Contract:** `student-context-v1`  
**Scope:** 只评估消费者是否可以开始迁移；本文件不迁移任何消费者。

## 1. Consumer Matrix

| Consumer | Current Source | StudentContext Fit | Missing Data | Risk | Recommended Order |
| --- | --- | --- | --- | --- | --- |
| `StudentHome` | `App.tsx` 组合 `GET /dashboard/overview`、`GET /overview/canonical`、`GET /today/plan`、`GET /review/due`、`mastery-map`、学习日历与多个 hooks；`StudentHome` 再由 `useDashboardViewModel` 组合 | **High for summary cards / state / today plan / momentum；Partial for the whole screen** | 题目目录、阶段测评题目、完整任务启动元数据、现有 `StudentAction` command context | Medium。当前同屏存在 legacy、canonical 与独立接口多源刷新；完整替换会影响启动/导航行为 | **Phase 1**：先迁移只读摘要，保留任务启动与题库/测评专用接口 |
| `ReportWorkspace / Overview Report` | `reports/overview` legacy DTO、`overview/canonical`、`DashboardOverview` props；`App.tsx` 额外用 assessment history + mastery map + wrong summary + streak 计算 `stageReport` | **Partial**。Context 可覆盖总览、节点掌握、练习、复习、今日计划与证据 | Assessment history 明细/趋势、阶段报告算法结果、资源推荐、诊断提交、反馈交互、报告专用 tab 数据 | High。报告是多模块工作台，不是单一 read model；直接替换会改变历史字段与交互契约 | **Phase 2**：先迁移 `ReportSummaryPanel` 的只读摘要，再逐页 parity |
| `Contextual Coach` | `ContextualCoachContextAssembler` 直接读取 `StudentStateProjectionService`、`QuestionsService`、`WrongQuestionProjectionService`、`AssessmentHistoryProjectionService`、`PracticeRecordRepository`、`ScoreCenterService`；`POST /ai/contextual-coach` 按场景组装 focus | **Partial for shared student background；Not sufficient for focus payload** | 题干/选项/解析与题目历史、错题复习历史、知识图谱关系/题目、assessment item、场景专属 message；当前还有 `assembledAt` 独立时间 | High。Coach 需要场景事实与 AI prompt contract；强行把 focus 数据塞入 StudentContext 会扩大其语义 | **Phase 3**：先用 StudentContext 作为背景输入，保留场景 focus assembler |
| `Knowledge page / KnowledgeCatalog` | 前端静态 `catalogData`/`buildKnowledgePointIndex`；`GET /knowledge/mastery`；`GET /knowledge/:id`；Node quest/detail API | **Low/Partial**。只能复用 Node mastery 与身份字段 | 完整知识树、前置/相关关系、频率证据、关联题目、考试题、quest 状态、Point↔Node 展示映射 | High。该页面是知识图谱/详情领域，不只是学生状态摘要；当前 `selectedPointId` 实际承载 catalog node identity 的边界需继续保持清晰 | **Phase 3**：在明确图谱与 Node/Point adapter 后单独迁移 |
| `RecommendationService` | `RecommendationService` 自己加载 `UserKnowledgeMastery`、`User`、`ReviewSchedule`、知识节点与推荐规则输入，生成 Action/Task | **Not a migration target**。StudentContext 只能作为未来解释/观测读模型 | 规则候选宇宙、前置节点 mastery、review summary、score breakdown、generation context、事务写入输入 | High。让决策引擎依赖聚合 Context 会造成依赖反向、规则字段丢失和潜在循环 | **Excluded**：保持独立 source loaders 与决策边界；如需共享只建立单向 adapter/事实接口 |
| `TestSection / Assessment` | `DashboardOverview.stageAssessment`、`/assessments/stage`、阶段测评提交接口、`assessment-history`；`ReportWorkspace` 内另有历史/阶段报告组合 | **Partial for status/summary；Not sufficient for execution** | 题目池、测评 session、提交命令、评分结果明细、历史 assessment items、assessment-specific coach focus | High。StudentContext 是 read-only，不能承载测评执行命令或替代 assessment contract | **Phase 2/3**：可先消费摘要，执行与明细继续使用 assessment APIs |

## 2. Migration Boundaries

### 可以迁移

- 首页和报告中的只读学生画像、目标、节点掌握、Point-level practice weakness、练习趋势、复习 due/overdue、今日任务摘要、学习活动趋势。
- 需要统一 `asOf` 的跨模块摘要，使用 `GET /student-context` 或服务端 QueryService。
- 通过明确 adapter 将 canonical `StudentContext` 转换为现有 UI view model；adapter 不得反向写入事实源。
- 推荐解释或 Coach 背景上下文的只读 evidence，保留 `knowledgeNodeId`、`knowledgePointId`、`actionId`、`studyTaskId` 的显式字段。

### 不应迁移

- Practice、Review、Mastery、Action、Task、UserEvent 的写路径。
- RecommendationService 的候选生成、排序、Action/Task 创建与事务逻辑。
- 阶段测评、题目练习、错题复习、学习会话等命令和执行载荷。
- KnowledgeCatalog 的完整图谱、题目详情、频率证据与 quest 状态。
- Contextual Coach 的题目/错题/知识图谱 focus 组装、LLM 调用和 prompt contract。

### 需要 adapter 的地方

- `DashboardOverview`、`MasteryMap`、`TodayPlan`、`TrialProgress`、`StudyReminders` 等 legacy DTO 与 canonical context 之间。
- `StudentAction` 所需的导航 command context；StudentContext 只提供事实和 evidence，不生成命令。
- Knowledge 页面 Node mastery 与既有 catalog Point 展示之间的明确 Node↔Point adapter。
- Coach 的 shared student background 与场景 focus 之间；不能把 focus 专用字段隐式加入 v1。

## 3. Freshness and Data Completeness

- `StudentContextQueryService` 在查询边界解析一次 `asOf`，并将同一时间传给已有 projection/loaders；纯 selector 不读取系统时钟。
- 现有前端 hooks 各自请求并记录 `lastSyncAt`，没有共同的请求级 `asOf`。这是迁移时需要处理的 freshness 差异，而不是把不同时间的快照拼成一个事实。
- v1 对 StudentHome 的摘要数据完整度足够；对 Report、Coach、Knowledge、Assessment 的领域专用数据并不完整。
- QueryService 在数据库可用时会并行调用既有 projection，并补充读取 User、UserKnowledgeMastery、LearningSession、StudyTaskCompletion、RecommendationAction、KnowledgePoint。当前未在真实生产库上测量延迟；应在迁移前做只读性能基线。

## 4. Identity and Dependency Safety

StudentContext 保持以下边界：

```text
knowledgeNodeId = KnowledgeNode.id
knowledgePointId = KnowledgePoint.id
actionId        = RecommendationAction.id
studyTaskId     = StudyTask.id
```

计划任务的 `actionId` 来自 `RecommendationAction.studyTaskId → action.id` 的关系读取，不通过字符串相等推断。Node mastery 与 Point practice weakness 也保持分离。

依赖方向冻结为：

```text
Source Facts → StudentContextQueryService → StudentContext → Consumer Adapter
```

`RecommendationService` 不得依赖 `StudentContextQueryService`；Coach 可以在未来消费 StudentContext 的背景部分，但仍保留其场景 focus assembler。

## 5. Recommended Order

### Phase 1 — StudentHome summary adoption

- 新增前端只读 query/adapter，先替换状态卡、趋势、复习计数和今日任务摘要。
- 任务启动、题目目录、阶段测评和现有 action command 暂时继续使用专用接口。
- 以 legacy/canonical parity 检查为准，允许逐区块回滚。

### Phase 2 — Report summary adoption

- 先迁移 `ReportSummaryPanel` 与报告顶部摘要。
- 保留 assessment history、stage report、review resources、诊断/反馈等专用数据源。
- 为每个字段标记 `MATCH / EXPECTED_CHANGE / LEGACY_ONLY / MISSING`，不做全量 DTO 替换。

### Phase 3 — Contextual/Domain consumers

- Coach 先接收 StudentContext 作为共享背景，再单独处理 question/wrong-question/knowledge/assessment focus。
- Knowledge 页面先建立 Node/Point adapter，再决定是否读取 context 的 Node mastery；图谱详情仍走专用 API。
- TestSection/Assessment 仅消费摘要，执行和结果明细保持原 assessment APIs。
- Recommendation 继续独立，不列入本迁移序列。

## 6. Non-Goals

- 不实施 Recommendation migration。
- 不实施 AI/Coach migration 或改变 LLM 行为。
- 不实施前端消费者迁移。
- 不修改 Prisma Schema、Migration 或历史数据。
- 不修改 Practice/Review/Mastery 写链、Action/Event runtime 或 D4-B4。
- 不扩大 StudentContext v1 为知识图谱、Recommendation result、AI memory 或 vector store。

## 7. Gate Decision

```text
READY FOR CONSUMER MIGRATION
```

限定条件：只能从 Phase 1 的 StudentHome 只读摘要开始；必须使用 adapter、parity 检查和可回滚的分区迁移。当前 `ENV-005` 与 `Phase 3.6.4-D4-B4` 继续保持环境阻塞，不影响本 readiness gate，也不得被误报为已验证。
