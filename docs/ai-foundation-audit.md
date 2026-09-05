# AI Intelligence Foundation — Phase AI-0 架构审计

> 日期：2026-09-05。分支 `feature/v3-product-refactor`，HEAD `4f58fe3`（含在途工作树）。
> 事实来源：当前仓库代码（引用处标注文件与行号）。本审计为只读调查，未修改任何代码。

## 1. 审计范围

按照 Milestone 目标，逐项核对六类 AI 接入基础：

| 对象 | 事实来源 |
|---|---|
| Contextual Coach | `apps/api/src/study/contextual-coach*.ts`、`ai-tutor.service.ts` |
| StudentContext | `student-context.contract.ts`、`student-context.query.service.ts`、`student-context.selector.ts` |
| Knowledge 数据 | `prisma/schema.prisma`（KnowledgeNode/Relation/ExamTag/Frequency）、`data/408/knowledge-tree-408-v2.json`、`packages/shared/src/knowledgeCatalog.ts` |
| Question 数据 | `prisma/schema.prisma` Question 系 model、`QuestionKnowledgeNodeTag` |
| WrongQuestion 数据 | `WrongQuestionReview`、`ReviewSchedule`、`wrong-question-projection.service.ts` |
| Recommendation 数据 | `packages/shared/src/score-center/`（契约冻结）、`recommendation.service.ts` |

## 2. 当前能力（已具备）

### 2.1 Contextual Coach（可用的 LLM 编排骨架）

- 端点 `POST /study/ai/contextual-coach`（`study.controller.ts:375`），四类场景 `question / wrong_question / knowledge_node / assessment`。
- `ContextualCoachContextAssembler` 以 **StudentContext 为 canonical base**（`@Optional StudentContextQueryService` 桥接 + legacy StudentState 兜底），场景 focus 由专用 loader 组装（`contextual-coach-context-assembler.service.ts:26-95`）。
- Prompt guardrail 已冻结：AI 只能解释/提醒/建议，禁止声称修改计划、掌握度、复习（`contextual-coach.prompt.ts:4-14`）。
- 输出规范化 + 模板 fallback：`normalizeContextualCoachModelResponse` 校验字段、剔除多余字段；provider 失败按 errorType 分类降级（`ai-tutor.service.ts:134-219`）。
- Observability：`contextual_coach.completed` 结构化日志携带 source/fallbackReason/errorType/durationMs；真实调用写 `AiTutorLog`。
- LLM 客户端：`DeepSeekClient`（OpenAI 兼容，`AI_BASE_URL`/`AI_MODEL` 可换），超时/限流/网络错误分类，`AI_API_KEY` 缺失时显式 template fallback（source 字段区分，不静默 mock）。

### 2.2 StudentContext 满足 AI Context 要求（结论：满足，作为唯一入口成立）

- 契约 v1（`student-context.contract.ts`）覆盖 profile / exam / mastery（weak/improving/mastered 三桶 + point 级练习薄弱）/ practice（趋势+科目分布）/ review（due/overdue/high-risk）/ plan（今日任务+完成率）/ momentum（streak+近期 session）/ recommendationEvidence，含 freshness 来源健康度。
- 读取有界（SC-5 TASK 1：session take 10、completions 8 天窗、actions take 200、目录按需 IN 查询，`student-context.query.service.ts:113-147`）。
- 纯函数 selector，无框架/时钟依赖，可测试。
- 已确认唯一缺口：契约刻意不携带 `goal.dailyHours` 与 `task.mode`（assembler 注释声明"must not be added"），coach 桥接时从 StudentState 读取这两字段——这是**设计内**的补读，不是缺口。

### 2.3 Knowledge 数据（结构完备，缺检索层）

- 数据库：`KnowledgeNode`（id/parentId/subject/nodeType/name/importance/difficulty/syllabusVersion/isActive + 7 类关系）、`KnowledgeRelation`（唯一约束 fromId+toId+type）、`ExamQuestionKnowledgeTag`、`KnowledgeFrequencySnapshot`。
- 知识树资产：`data/408/knowledge-tree-408-v2.json` = **1296 节点**（4 subject / 24 chapter / 119 section / 1149 atomicPoint），atomicPoint 带 prerequisites/relatedPoints/questionTypes/stages/examStats；由 `scripts/seed-408-v2.mjs` 播种。
- 共享目录逻辑：`knowledgeCatalog.ts` 提供 `buildKnowledgeTree / filterKnowledgeTree / searchKnowledgeTree / buildKnowledgePointIndex`。`searchKnowledgeTree` 是**纯子串匹配**（`name.toLowerCase().includes(needle)`），无语义能力、无排序打分。
- `ScoreCenterService.getKnowledgeDetail` 已能按 nodeId 给出 detail + 关联题 + 真题命中 + frequency（coach knowledge_node 场景已消费）。

### 2.4 Question 数据

- `Question`（stem/options/answer/analysis/difficulty/type/source/year）+ `QuestionFamily` 版本化；`QuestionKnowledgeNodeTag`（node 口径）与 `QuestionKnowledgePoint`（point 口径）双标签；解析（analysis）字段天然是 RAG 的 Solution 语料。

### 2.5 WrongQuestion 数据

- `WrongQuestionReview`（userId+questionId 唯一）+ `ReviewSchedule`（stability/nextReviewAt/reviewCount + `ReviewAttempt` 明细）；`wrong-question-projection.service.ts` 提供快照（current/resolved items + attemptHistory + reviewHistory）。错因分类（5 类）在 `packages/shared/src/learning.ts` 判题时落库。

### 2.6 Recommendation 数据

- 引擎契约冻结（`docs/sprint3-recommendation-contract.md`）：唯一 ID = `knowledgeNodeId`，纯函数、时间注入、无 Date.now/Math.random；`RecommendationService.generateDailyPlanFromState` 支持注入 scheduledDate 与 generationKey 幂等。Agent 复用计划生成时可直接走该 Service。

## 3. 缺失能力（Milestone 必须补齐）

1. **无 Embedding / 向量检索**：全仓无 embedding 代码（grep `embedding` 零命中）。`searchKnowledgeTree` 仅子串匹配——"死锁产生条件"查不到"死锁的四个必要条件"类节点除非字面重合。
2. **Coach 无知识检索步骤**：当前流程是 StudentContext + 场景 focus → Prompt。用户自由提问（如"为什么PV操作总错"）时，AI 拿不到 PV/信号量相关 408 知识语料，只能靠模型自身知识，存在幻觉风险，也无 relevance score 证据。
3. **无 Agent / Tool Calling**：无 orchestrator、无工具注册表、无多步规划。现有 `/ai/*` 均为单轮"组装上下文→一次 LLM 调用"。
4. **无学习规划 Agent 的写路径编排**：`generateDailyPlanFromState` 存在但没有面向 Agent 的受控调用面（工具签名、权限边界、审计）。
5. **RAG 语料未成文档化**：knowledge tree JSON、Question analysis、Knowledge Relation 分散在表与 JSON 资产中，没有统一的 KnowledgeDocument/Chunk 视图。

## 4. 技术债（沿用既有登记 + 本次新发现）

既有（`current-sprint.md` / `autonomous-development-state.md`，不属于本 Milestone 修复范围）：
- 全量 `npm test` 有 25 个预存失败（在途工作线债务）；Windows 沙箱 `spawn EPERM` 需升级执行。
- 掌握度双口径（P2-2）、StudyService/App.tsx 巨型单文件（P2-3）、Sprint 3.4 P1 多实例幂等。
- 测试库 `127.0.0.1:55432`（勿用 localhost）。

本审计新登记：
- **TD-A1**：`AiTutorService` 在构造器里读 `process.env.AI_API_KEY` 自建 client（`ai-tutor.service.ts:44-47`），不易注入 mock client——RAG/Agent 阶段如需共享 provider 抽象，建议以"新增服务注入"而非改动该类的方式扩展（构造器尾部追加参数规则见地雷清单）。
- **TD-A2**：coach 的 focus 中 `knowledge_node` 场景参数名叫 `knowledgePointId` 但实为 Node id（代码注释已声明，repository 层同名），RAG 层命名必须统一用 `knowledgeNodeId`，避免二次混淆。
- **TD-A3**：知识树 JSON 与 DB 双份事实（JSON 567KB / DB 表）。RAG 层必须以 **DB KnowledgeNode 为运行时事实源**，JSON 仅作为 seed 资产，禁止 RAG 直接读 JSON 绕过 DB。
- **TD-A4**：`AiTutorLog.questionId` 可空，但无独立"检索/agent"日志模型——AI-5 观测扩展需复用 AiTutorLog 或结构化日志，禁止新增 Prisma 表（Schema 冻结）。

## 5. 下一阶段路线（AI-1 → AI-5）

| Phase | 交付 | 关键约束 |
|---|---|---|
| AI-1 Knowledge RAG Foundation | KnowledgeDocument/Chunk 视图（以 `knowledgeNodeId` 为唯一身份）、Embedding Pipeline（provider 抽象 + 无 key 时确定性本地向量 fallback）、Vector Storage 抽象（内存实现，接口可换 pgvector）、`KnowledgeSearchService` + `GET /knowledge/search` 语义检索 API | 不改 Prisma Schema；DB KnowledgeNode 为事实源；复用 knowledgeCatalog 类型；向量数据放内存/进程内存储（Schema 冻结期不引入新基础设施） |
| AI-2 Coach RAG Integration | 新增 `KnowledgeRetriever`，coach 流程升级为 Intent→StudentContext→Retrieval→Assembly→LLM；`ContextualCoachContext` 增量字段（可选、向后兼容），prompt shape 不破坏 | 模板 fallback 行为保持；normalizer/guardrail 测试全部保持绿 |
| AI-3 Agent Foundation | Study Agent V1：LLM + Orchestrator + 6 个只读/受控工具（getStudentContext / searchKnowledge / searchQuestion / getWrongQuestions / generateStudyPlan / createStudyTask）；写操作仅经既有 Service | Agent 不直接碰 Prisma；工具层全部薄封装既有 Service |
| AI-4 Agent Workflow | 多步任务编排（"安排今天408学习"全链路），步骤级观测 | 复用 AI-3 工具注册表 |
| AI-5 Production Hardening | Token 预算、缓存、观测、failure fallback、全量回归 | 最终报告 `docs/ai-intelligence-final-report.md` |

### 5.1 关键设计决策（提前冻结）

1. **Embedding 双模式**：配置 `EMBEDDING_API_KEY`（OpenAI 兼容 `/embeddings`）走真实 provider；未配置时用确定性本地嵌入（n-gram/字符袋哈希向量）——保证无外部依赖时 RAG 仍可测试、可验收，且 source 字段显式区分，不违反"禁止静默 mock"（演示模式回退是仓库既定设计内行为，生产环境需配置真实 key 或显式降级标识）。
2. **Vector Storage 进程内实现**：Schema 冻结 → 不建表。抽象 `VectorStore` 接口（upsert/search），默认内存实现带启动时重建；后续如解冻可换 pgvector 实现，接口已预留。
3. **knowledgeNodeId 是 RAG 唯一身份**：chunk 元数据携带 nodeId/subject/nodeType/chapter 路径，检索结果回 DB 校验 isActive。
4. **Agent 写边界**：`createStudyTask` 工具只允许调用既有 `RecommendationService`/plan 写路径，禁止工具内出现任何 `prisma` 引用。

## 6. 验收基线（当前可运行）

- 定向 coach 测试：`contextual-coach-*.test.js` 11 个文件（integration/context/api/base-context/evaluation/normalizer/observability/prompt/ui-fallback/ui）。
- 构建：`npm run build:api` / `build:shared` 可用；`build:web` TypeScript 部分通过（Vite bundle 受本机 spawn EPERM 限制）。
- RAG 验收用例（AI-1）："死锁产生条件" → 返回 OS 死锁相关 atomicPoint 节点（预期命中 `OS` 科目"死锁"章节节点），含 knowledgeNodeId / subject / title / related nodes / relevance score。
