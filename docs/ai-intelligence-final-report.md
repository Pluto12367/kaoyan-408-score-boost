# AI Intelligence Layer Completion Report — Milestone Final

> 日期：2026-09-05。分支 `feature/v3-product-refactor`（工作树，未提交——Git 写操作等待用户指令）。
> 范围：AI Intelligence Foundation Milestone（Phase AI-0 → AI-5）。
> 硬约束遵守情况：未修改 Prisma Schema、未修改 Practice 写路径、未修改 Mastery Engine、未修改 Recommendation Engine 算法、未修改 StudentContext 核心语义、未删除任何 legacy API、未引入新基础设施（无新表/新服务进程/新依赖包）。

## 1. 最终验收清单

| 验收项 | 状态 | 证据 |
|---|---|---|
| StudentContext 作为 AI 唯一上下文入口 | ✅ | Coach base 走 `StudentContextQueryService`（AI-2 前已确立）；Agent `getStudentContext` 工具直接消费 canonical read model（`agent-tools.ts: getStudentContext`） |
| Knowledge RAG 可用 | ✅ | `GET /rag/knowledge/search`；验收用例"死锁产生条件"→ `OS-C06-S06-P02 死锁必要条件`（subject/title/related/score 全返回）；39 项 RAG 测试全绿 |
| Contextual Coach 支持知识检索 | ✅ | `KnowledgeRetriever` 注入 assembler，`knowledgeContext` 增量字段；12 项 AI-2 测试 + 既有 coach 测试全绿（prompt shape 兼容） |
| Agent 可调用业务 Tools | ✅ | 六工具注册表：getStudentContext / searchKnowledge / searchQuestion / getWrongQuestions / generateStudyPlan / createStudyTask；22+7 项 Agent 测试全绿 |
| Agent 不能绕过业务层修改数据 | ✅ | 源码边界测试：agent 层无数据库客户端引用、无直接写原语；唯一写工具 `createStudyTask` → `RecommendationService.generateDailyPlanFromState`（canonical 计划写入路径，generationKey=`AGENT:{userId}:{date}:v1` 幂等） |
| 完整测试 | ✅ | 新增 74 项（RAG 39 + Coach RAG 12 + Agent 29）；全量 1597 项 / 25 失败 = 预存基线（见 §5） |
| Build 通过 | ✅ | `build:shared` / `build:api`（nest build EXIT=0）/ `build:web` 见 §5 |
| 文档完整 | ✅ | 本报告 + `ai-foundation-audit.md` + `rag-foundation-report.md` + `current-sprint.md` 更新 |

## 2. 分阶段交付

### Phase AI-0 — AI Architecture Audit
`docs/ai-foundation-audit.md`。结论：StudentContext 满足 AI Context 要求；六类数据结构完备；缺口=embedding/检索层/Agent 层；新登记技术债 TD-A1…TD-A4。

### Phase AI-1 — Knowledge RAG Foundation
新增 `apps/api/src/rag/`（详见 `docs/rag-foundation-report.md`）：
- **KnowledgeDocument/KnowledgeChunk**：`knowledgeNodeId` 唯一身份；三类 chunk（node_overview / node_relations / question_analysis）；运行时事实源=DB KnowledgeNode/KnowledgeRelation/Question.analysis（JSON 树仅为 seed 资产）。
- **Embedding Pipeline**：`EmbeddingProvider` 抽象。`EMBEDDING_API_KEY` 配置→OpenAI 兼容远程（批 64/超时/错误分类）；否则→本地确定性中文字符 n-gram 哈希 512 维 L2 归一（零依赖、可测、source 显式标识）。
- **Vector Storage 抽象**：`VectorStore` 接口 + `InMemoryVectorStore`（余弦、subject 过滤、topK）；接口预留 pgvector 替换。
- **KnowledgeSearchService + `GET /rag/knowledge/search`**：懒构建索引、TTL 失效（`RAG_INDEX_TTL_MS`，默认 1h）、结构化观测日志。

### Phase AI-2 — Contextual Coach RAG Integration
- 新增 `KnowledgeRetriever`（失败隔离、结果有界：≤3 节点×≤3 相关）。
- Assembler 增第 8 个 `@Optional` 构造参数（尾部追加，遵守位置参数地雷规则），检索查询优先级：用户消息 → 场景 focus 推导（题干/节点名）。
- `ContextualCoachContext.knowledgeContext` 为**可选增量字段**；无 retriever 时上下文与 prompt 形状逐字节不变（legacy DI 兼容测试钉死）。
- System prompt 增加一行知识使用边界（不得虚构检索结果/不得把相关性当掌握度），既有 guardrail 断言全部保持。

### Phase AI-3 — Agent Foundation
新增 `apps/api/src/agent/`：
- **StudyAgentToolRegistry**：六工具白名单；参数校验（subject 枚举、topK 钳制、minutes 枚举）；输出有界（题 10/错题 10/计划项 8；搜题仅题干投影，剥除答案/解析）。
- **StudyAgentService**：LLM 工具调用循环（≤6 步、工具结果截断 4000 字符、非白名单工具调用忽略）+ 确定性 workflow 兜底，fallbackReason 显式。
- **AgentLlm 边界**：`DeepSeekAgentLlm` 适配器（`AI_API_KEY` 缺失→null→workflow 模式，无静默 mock）；`DeepSeekClient` 增量支持 OpenAI tools 协议（不传 tools 时请求体与旧版一致，兼容性测试钉死）。
- **`POST /agent/study/run`**：RoleGuard 三角色；拒绝 body userId（与 coach 同款防护）；createTasks/availableMinutes/scheduledDate 白名单校验。

### Phase AI-4 — Agent Workflow
验收场景"帮我安排今天408学习"端到端测试：getStudentContext → mastery 分析（薄弱节点→检索查询）→ searchKnowledge → getWrongQuestions → generateStudyPlan（只读预览）→ [createTasks=true 时 createStudyTask 落计划]。默认**不写**；写入必须显式授权且走 canonical writer。工具失败逐级降级（步骤记录 error，流程不抛错）。

### Phase AI-5 — Production Hardening
- **Token 控制**：工具输出分片上限（§AI-3 数值）、LLM 工具结果 4000 字符截断、retriever 节点/相关数上限、解析文本 800 字符截断、coach message 1000 字符（既有）。
- **Cache**：RAG 索引进程内缓存 + TTL（可配），`resetIndex()` 显式失效入口。
- **Observability**：`knowledge_search.completed` 与 `study_agent.completed` 结构化日志（durationMs/resultCount/topScore/failedSteps/fallbackReason）；沿用 coach 既有观测字段风格。
- **Failure fallback**：远程 embedding→错误分类（EmbeddingError）；检索失败→显式 unavailable 上下文；LLM 失败→workflow 兜底；无 key→模板/workflow 模式（source 字段区分，生产无静默 mock）。

## 3. 开源参考方向（AGENTS.md 要求汇总）

1. **pgvector**：余弦距离/归一向量内积优化/维度上限 → VectorStore 接口按余弦设计、L2 归一、可替换实现。
2. **Vercel AI SDK embeddings**：embed/embedMany 输入输出同序、cosineSimilarity 排序、超时/重试 → EmbeddingProvider 契约与查询侧实现。
3. **OpenAI tool-calling 协议**（chat completions tools/tool_calls/tool role）→ DeepSeekClient 增量与 AgentLlm 适配器形状。
未复制任何源码；全部按本仓库 Nest/Prisma/双模式约定重新实现。

## 4. 修改文件清单（本 Milestone 全部增量）

新增：
- `apps/api/src/rag/`：embedding-provider.ts、vector-store.ts、knowledge-corpus.ts、knowledge-search.ts、knowledge-corpus.loader.ts、knowledge-search.service.ts、knowledge-retriever.service.ts、rag.controller.ts、rag.module.ts
- `apps/api/src/agent/`：agent-tools.ts、study-agent.service.ts、agent-llm.ts、agent.controller.ts、agent.module.ts
- `test/`：rag-embedding、rag-vector-store、rag-corpus、rag-knowledge-search、rag-api、contextual-coach-rag、study-agent、study-agent-workflow（8 个文件，74 项）
- `docs/`：ai-foundation-audit.md、rag-foundation-report.md、ai-intelligence-final-report.md（本文件）

修改：
- `apps/api/src/app.module.ts`：注册 RagModule、AgentModule
- `apps/api/src/study/study.module.ts`：imports 增加 RagModule（一行）
- `apps/api/src/study/deepseek-client.ts`：ChatMessage 联合类型扩展 + tools/tool_calls 透传（不传时请求体不变，测试钉死）
- `apps/api/src/study/contextual-coach.types.ts`：`knowledgeContext?` 可选字段
- `apps/api/src/study/contextual-coach-context-assembler.service.ts`：第 8 个 @Optional 参数 + knowledgeContext 附加 + focus 查询推导
- `apps/api/src/study/contextual-coach.prompt.ts`：system prompt 增加一行知识边界

明确未动：prisma/、Mastery Engine（score-center 共享引擎）、Recommendation Engine 算法、Practice 写路径、全部 legacy API、前端（0 文件）、他人主题在途文件、score-center 在途文件。

## 5. 验证结果（命令与输出摘要）

- `npm run build:shared` → PASS
- `npm run build:api`（nest build）→ EXIT=0
- `npm run build:web` → PASS（Vite 完整 bundle `✓ built in 38.15s`，前端零改动）
- 定向：RAG 39/39、Coach RAG 12/12、Agent 29/29、coach 既有 11 文件 + question-import-http 组合 109/109
- 全量 `npm test`（最终门禁）：**1597 tests / 1570 pass / 25 fail / 2 skipped**——25 失败与接管时文档基线完全一致（12×student-action-ui、4×student-context-freshness、其余 UI wiring 在途工作线债务；此前 question-import-http 的 4 个失败系本 Milestone 曾引入的 RagModule DI 回归，已修复归零；2 处 StudyModule wiring 契约冲突已按单一注册契约回退修复）。

## 6. 遗留风险与建议

1. **远程嵌入未做真实 API 冒烟**（环境无 EMBEDDING_API_KEY）：接口/错误路径已由 stub 覆盖；启用后建议跑一次真实索引构建核对维度与延迟。
2. **本地嵌入为词法级语义**：满足验收（同义改写命中），但跨词汇语义（如"竞争条件"→"死锁"）弱；配置远程 provider 即可无缝升级。
3. **Agent generationKey 复用 StudyPlan 唯一约束**：`AGENT:{userId}:{date}:v1` 幂等依赖 `StudyPlan.generationKey` 迁移已在库（D4-B4 已 PASS）；若目标库未应用迁移，agent 写路径会如 legacy 一样回退到非幂等创建（与既有 Recommendation 行为一致，未引入新风险）。
4. **Agent LLM 循环的真实模型行为未实测**（无 key）：协议映射已测；首次启用建议人工观察工具选择与步数。
5. **Working tree 含多条在途工作线**：本 Milestone 文件清单见 §4，提交时请按清单精确 `git add`，勿 `git add -A`（他人主题文件在保护清单内）。
