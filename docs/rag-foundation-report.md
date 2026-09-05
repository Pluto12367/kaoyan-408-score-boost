# Knowledge RAG Foundation — Phase AI-1 Report

> 日期：2026-09-05。分支 `feature/v3-product-refactor`。
> 前置审计：`docs/ai-foundation-audit.md`（Phase AI-0）。
> 本阶段不改 Prisma Schema、不改任何既有写路径与引擎。

## 1. 交付总览

新增 `apps/api/src/rag/` 模块（7 个源文件 + 模块注册），提供 408 知识语义检索基础层：

| 文件 | 职责 |
|---|---|
| `embedding-provider.ts` | Embedding 抽象 + 两个实现（本地确定性 / OpenAI 兼容远程） |
| `vector-store.ts` | VectorStore 抽象 + 进程内余弦相似度实现 |
| `knowledge-corpus.ts` | KnowledgeDocument / KnowledgeChunk 纯函数构建器 |
| `knowledge-search.ts` | chunk 命中 → 节点级聚合 + related nodes 富化（纯函数） |
| `knowledge-corpus.loader.ts` | DB → corpus 输入（KnowledgeNode / KnowledgeRelation / Question analysis） |
| `knowledge-search.service.ts` | 编排：懒构建索引 → embed 查询 → 检索 → 聚合 |
| `rag.controller.ts` + `rag.module.ts` | `GET /rag/knowledge/search` 端点与模块装配（app.module 已注册） |

## 2. 数据模型

### KnowledgeDocument（节点级）
- `documentId = node:{knowledgeNodeId}`，**knowledgeNodeId 是唯一身份**（来自 DB `KnowledgeNode`，不重建知识体系）。
- 携带 subject / nodeType / title / chapterPath（chapter→section 两级路径）/ importance / difficulty。

### KnowledgeChunk（检索单元）
- 三类 kind：
  - `node_overview`：科目名+章节路径+节点名+重要度/难度，每个活跃节点 1 个；
  - `node_relations`：前置/相关节点名称文本（来自 `KnowledgeRelation`，双向索引），仅有关系的节点生成；
  - `question_analysis`：题干+解析（截断 800 字符），来自 `Question(isCurrent)` 的 `analysis`，按 `QuestionKnowledgeNodeTag` 第一个节点归属。
- 数据来源（运行时全部以 **DB 为事实源**，`data/408/knowledge-tree-408-v2.json` 仅为 seed 资产——TD-A3 约束）：
  - KnowledgeNode（isActive=true）
  - KnowledgeRelation
  - Question + QuestionKnowledgeNodeTag（take 2000 上界）

### Embedding Metadata
- 每条向量记录：chunkId / knowledgeNodeId / subject / vector。
- 查询响应包含 `source`（provider 名）显式区分本地/远程嵌入。

## 3. Embedding Pipeline

双模式（审计 §5.1 冻结决策）：

1. **OpenAI 兼容远程**（`EMBEDDING_API_KEY` 配置时）：POST `{EMBEDDING_BASE_URL|https://api.openai.com/v1}/embeddings`，model=`EMBEDDING_MODEL|text-embedding-3-small`，批大小 64，超时 `EMBEDDING_TIMEOUT_MS|30000`；错误分类 EmbeddingError（timeout/rate_limited/http/network/invalid_response）。
2. **本地确定性 fallback**（无 key）：中文字符 unigram+bigram FNV-1a 哈希至 512 维 + L2 归一。零外部依赖、结果确定，保证无 key 环境 RAG 可用可测；`source='local-deterministic-v1'` 显式标识（不违反"禁止静默 mock"——演示模式回退是仓库既定设计内行为，生产建议配置真实 key）。

实现要点（参考 pgvector/AI SDK 模式）：向量 L2 归一后余弦=点积；远程结果按 index 对齐并按批大小防御性截断；空 apiKey 构造即抛错。

## 4. Vector Storage

- 接口：`replaceAll / search(vector,{topK,subject}) / size`，实现可替换（后续解冻 Schema 可换 pgvector，接口已预留——参考 pgvector cosine `1 - (a <=> b)` 与归一向量用内积的惯例）。
- 默认 `InMemoryVectorStore`：进程内暴力扫描 + subject 过滤 + topK 截断，按分数降序。索引懒构建（首次 search 触发），进程内单次构建；`resetIndex()` 供测试/未来失效逻辑使用。

## 5. Semantic Retrieval API

```
GET /rag/knowledge/search?q=<query>&subject=<DS|CO|OS|CN>&topK=<1..20>
```
- 鉴权：RoleGuard，student/teacher/admin。
- `q` 必填（空/缺失 → 400）；`topK` 钳制 1..20（默认 5）；`subject` 可选过滤。
- 响应：`{ query, source, indexSize, available, results[] }`；每条 result 含 `knowledgeNodeId / subject / nodeType / title / chapterPath / relevanceScore / matchedChunks(≤2) / relatedNodes(≤5)`。
- 无 DATABASE_URL：`available=false`、空结果、显式 warning 日志（无静默兜底）。
- 路由前缀 `rag/` 与既有路由零冲突（不触碰 `knowledge/:id`）。

## 6. 验收结果

**验收用例：输入 `"死锁产生条件"`**（`test/rag-knowledge-search.test.js`）：
- 返回 `OS-C06-S06-P02 死锁必要条件`（subject=OS，chapterPath=[进程管理, 死锁]），relevanceScore>0；
- relatedNodes 包含 `死锁定义`（PREREQUISITE）或 `信号量`（RELATED）；
- 附加用例：`PV操作` → 信号量节点命中；subject 过滤生效；本地嵌入在 `"死锁产生条件"` vs `"死锁的四个必要条件"` 上的相似度高于 vs `"信号量"`（语义相关性排序有效性）。

**测试**（39 项，全绿）：
- `rag-embedding.test.js`（12）：确定性、L2 归一、相对相似度排序、批处理、429/timeout 错误分类、provider 工厂。
- `rag-vector-store.test.js`（7）：replaceAll、精确命中 top1、降序、subject 过滤、零向量、topK 上界。
- `rag-corpus.test.js`（6）：空输入、overview/relations/question 三类 chunk、无解析跳过、800 字符截断、多节点取首节点。
- `rag-knowledge-search.test.js`（7）：聚合验收 + KnowledgeSearchService 懒索引/不可用显式空/空查询。
- `rag-api.test.js`（7）：路由、守卫、参数校验、模块导出、app.module 注册（源码契约）。

**构建**：`npx nest build`（apps/api）EXIT=0；`npm run build:shared` 通过。

## 7. 开源参考检查（AGENTS.md 要求）

1. **pgvector**（github.com/pgvector/pgvector）：余弦距离 `<=>`、归一向量用内积的优化、维度上限（vector 2000）——影响：VectorStore 接口按余弦相似度设计、向量 L2 归一、内存实现可替换为 pgvector 实现而不改调用方。
2. **Vercel AI SDK embeddings 文档**（ai-sdk.dev）：embed/embedMany 批量语义（结果与输入同序）、cosineSimilarity 排序、usage/重试/超时选项——影响：EmbeddingProvider.embed(texts) 返回与输入同序的 number[][]、查询侧单条 embed + 余弦排序、超时经 AbortController。
3. 未直接复制任何代码；全部按本仓库 Nest/Prisma/双模式约定重新实现。

## 8. 遗留与下一步

- **远程嵌入未实测真实 API**（无 EMBEDDING_API_KEY 环境）；接口与错误路径由 stub fetch 测试覆盖。生产配置后建议在 AI-5 阶段做一次真实冒烟。
- **索引无失效机制**：知识树内容静态，进程内一次构建即可；题目库更新后需重启或调用 `resetIndex()`——登记为 AI-5 缓存策略输入。
- **本地嵌入为词法级语义**：中文 bigram 哈希可覆盖"死锁产生条件→死锁必要条件"类同义改写，但非真实语义向量；验收标准已达成，远程 provider 可无缝升级。
- 下一步（Phase AI-2）：新增 `KnowledgeRetriever`，将 `KnowledgeSearchService.search()` 注入 Contextual Coach 上下文组装（保持 prompt shape 兼容）。
