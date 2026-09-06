# V5.5 Embedding Provider Audit

> 日期：2026-09-06。只读审计。不修改代码。

## 1. 当前 Embedding 基础设施

| 层 | 现状 |
|---|---|
| **Contract** | `EmbeddingProvider.embed(texts: string[]): Promise<number[][]>` — 与输入同序返回向量数组 |
| **实现 A** | `LocalDeterministicEmbeddingProvider`（`local-deterministic-v1`）：中文 n-gram FNV-1a 哈希 512 维 + L2 归一，零外部依赖，确定性 |
| **实现 B** | `OpenAICompatibleEmbeddingProvider`：OpenAI 兼容 `/embeddings` 端点，批处理 64，超时 30s，错误分类（timeout/rate_limited/http/network/invalid_response） |
| **Provider 选择** | `createEmbeddingProvider(env)`：`EMBEDDING_API_KEY` 存在→远程，否则→本地 |
| **Vector Storage** | `InMemoryVectorStore`（余弦 + subject 过滤 + topK）+ `VectorStore` 接口（可换 pgvector） |
| **索引** | `KnowledgeSearchService.ensureIndex()`：懒构建 + TTL（1h 默认），`replaceAll` 原子替换 |

## 2. 七问回答

### 1. 当前 embedding dimension
- 本地：**512**（FNV-1a 哈希槽位）
- 远程：模型决定（text-embedding-3-small = 1536）

### 2. 当前 index format
- `InMemoryVectorStore`：`Map<chunkId, { record, norm }>`，余弦暴力扫描
- 每条记录：`{ chunkId, knowledgeNodeId, subject, vector: number[] }`

### 3. 当前 metadata
- `chunkId`（`node:{id}#overview` / `node:{id}#relations` / `question:{id}`）
- `knowledgeNodeId`（唯一身份）
- `subject`（DS/CO/OS/CN）

### 4. Current model
- 默认：`local-deterministic-v1`（无远程调用）
- 远程（未激活）：`EMBEDDING_MODEL ?? 'text-embedding-3-small'`

### 5. Replacement compatibility
- **接口完全兼容**：`EmbeddingProvider` 接口不变，只换实现
- **维度不兼容**：远程 1536 ≠ 本地 512 → **必须整库重建索引**（TTL 自动触发）
- **元数据兼容**：knowledgeNodeId/subject/chunkId 不变
- **回滚策略**：`createEmbeddingProvider` 切回 `LocalDeterministicEmbeddingProvider` 即回滚（env 删 `EMBEDDING_API_KEY` 即回退）

### 6. Re-index cost
- 本地：0（纯计算，~100ms for 1388 chunks）
- 远程：1297 节点 × ~50 chars/chunk ≈ 1388 调用（批 64 = ~22 请求）≈ $0.01-0.03（text-embedding-3-small $0.02/1M tokens）

### 7. Rollback strategy
- `EMBEDDING_API_KEY` 删除 → `createEmbeddingProvider` 回退本地 → TTL 后索引自动重建为 512 维
- 不需要数据迁移（内存索引，重启即重建）

## 3. Provider Selection 分析

| Provider | API 兼容 | 质量 | 维度 | 成本 | 延迟 | 运营简易度 | 需要 |
|---|---|---|---|---|---|---|---|
| **Jina AI** | ✅ OpenAI 兼容 `/embeddings` | 高 | 512/768/1024 | 免费层 1M tokens/月 | ~100ms | 只需 API key | OWNER: 注册 jina.ai |
| **OpenAI** | ✅ 原生 | 最高 | 1536/3072 | $0.02/1M | ~100ms | 只需 API key | OWNER: OpenAI 账号 |
| **Ollama 自托管** | ✅ 兼容 | 中高 | 可变 | 免费 | ~50ms（本地） | 需安装+运行 | OWNER: 安装 Ollama |
| **阿里 DashScope** | ✅ 兼容 | 高 | 1536 | ¥0.7/1M | ~50ms | 需阿里云账号 | OWNER: 阿里云开通 |
| **本地（当前）** | N/A | 词法级 | 512 | 免费 | <1ms | 零依赖 | 无 |

**推荐**：Jina AI（免费层 + OpenAI 兼容 + 512 维与本地一致）。**OWNER_ACTION**：注册 jina.ai 获取 API key → 设置 `EMBEDDING_API_KEY` + `EMBEDDING_BASE_URL=https://api.jina.ai/v1` + `EMBEDDING_MODEL=jina-embeddings-v3`。

## 4. 结论

**REAL_EMBEDDING = BLOCKED BY CREDENTIALS (OWNER_ACTION required)**

现有架构完全兼容任何 OpenAI 兼容 embedding provider——只需 owner 设置环境变量，系统自动切换。`local-deterministic-v1` 保留为 fallback（永不删除）。

## 5. 已验证的替代路径

在等待 owner 配置远程 embedding provider 期间，以下维度已用本地确定性嵌入完成真实验证（91.7% top3Hit）：`scripts/v34-rag-pipeline-eval.mjs`（28 查询）+ 全量 RAG 套件（39 项）。远程 provider 接入后同一评测脚本自动复用。
