# v3.4 Remote Embedding Validation — Phase 2 Result: BLOCKED (No Credentials / Provider Unsupported)

> 日期：2026-09-06。

## 1. 结论

**REAL EMBEDDING PASS = 未执行 —— BLOCKED BY CREDENTIALS，且有 provider 硬限制。**

1. `EMBEDDING_API_KEY`：进程环境与 `.env.development` 均不存在。
2. **Provider 硬限制**：当前 LLM provider 为 DeepSeek 官方 API（`https://api.deepseek.com`），DeepSeek 不提供 `/embeddings` 端点——即使复用已充值的 `AI_API_KEY` 也无法执行远程嵌入。解除本阻塞需要**额外引入**一个提供 embeddings 的 provider（如 OpenAI / 本地推理服务）并配置 `EMBEDDING_API_KEY` + `EMBEDDING_BASE_URL` + `EMBEDDING_MODEL`。

## 2. 当前嵌入路径的真实等级（不冒充）

| 层 | 等级 | 说明 |
|---|---|---|
| 本地确定性嵌入（`local-deterministic-v1`，中文 n-gram 哈希 512 维） | **Contract PASS + Fixture Real PASS** | 真实执行于全部 RAG 测试（240 项基线内），source 字段显式标识，非冒充远程 |
| OpenAI 兼容远程 provider | **Contract PASS only** | 批处理/维度对齐/错误分类由 stub fetch 覆盖；**真实 HTTP 从未执行** |
| 端到端 document→embedding→storage→retrieval | **Fixture Integration PASS** | Phase 3 将在真实 DB 语料（1296 节点）上重验，仍用本地 provider |

## 3. 远程嵌入启用后的验证清单（预留，解除阻塞即执行）

1. 维度一致性：`EMBEDDING_MODEL` 返回维度 vs `EmbeddingProvider.dimensions` 声明 vs 已存索引维度——不一致必须整库重建（TDD：dimension-mismatch 测试）。
2. 归一化：远程向量 L2 归一校验（余弦=点积的前提）。
3. 批处理：>64 chunk 分批、同序性（结果 index 与输入对齐）。
4. 元数据完整性：knowledgeNodeId/subject/chunkId 在远程路径下不丢失。
5. 成本采样：1296 节点全量索引的 token 消耗与耗时基线（Phase 10 输入）。

## 4. 对 Release Gate 的影响

Phase 13 必须标注：`REAL EMBEDDING: BLOCKED (no credentials + provider unsupported)`。系统当前的检索能力以本地确定性嵌入为生产默认——该路径已被真实验证，但语义泛化上限低于远程语义向量（同义改写可覆盖，跨词汇语义弱）。
