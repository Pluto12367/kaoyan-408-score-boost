# v3.4 AI Release Gate

> 日期：2026-09-06。本文件定义 v3.4 各验证维度的 PASS 阈值与当前实测状态。
> 诚实分级：Stub PASS（mock 注入）＜ Contract PASS（纯函数契约）＜ Integration PASS（真实 DB/语料）＜ **Real Provider PASS**（真实远程调用）＜ Production Readiness。

## 1. Gate 状态总表

| 维度 | 阈值 | 当前实测 | 等级 | Gate |
|---|---|---|---|---|
| Correctness（AI 域单元/契约） | 0 失败 | 240/240（28 文件） | Contract PASS | ✅ |
| RAG retrieval（真实 DB 语料 1297 节点/1388 chunks） | top3Hit ≥ 85%，拒答 ≥ 75% | top3Hit **91.7%**（22/24），precision@3 **0.681**，recall **0.917**，拒答 **75%**（3/4） | Integration PASS | ✅ |
| Agent tool orchestration（真实 DB + 真实工具 + canonical writer） | 全部编排断言 PASS | 13/13（含 FK 保护、幂等、权限闸、步数/deadline） | Integration PASS | ✅ |
| Learning closed loops（Planning/Review/Coach/Exam） | 状态变化断言全 PASS | 21/21（mastery 0.40→0.60、stability null→1.7、coach weak 1→0、planner 焦点迁移） | Integration PASS | ✅ |
| Remote LLM | 4/4 smoke PASS 且 tokens>0 | **4/4 FAIL — 402 Insufficient Balance**（认证链路真实：402 非 401） | **BLOCKED (billing)** | ❌ |
| Remote Embedding | 真实 /embeddings 调用 PASS | 无凭证 + DeepSeek 无 embeddings 端点 | **BLOCKED (credentials/provider)** | ❌ |
| Reliability（failure engineering） | 崩溃 0 / 脏写 0 / 重复 plan 0 | 既有测试覆盖 12 类失败场景 + 闭环脚本实见 FK 拒写、幂等收敛 | Integration PASS | ✅ |
| Latency（RAG 检索，1388 chunks 本地） | p95 < 50ms | avg 8ms / p95 8ms | Integration PASS | ✅ |
| Token 预算 | usage 可计量 | DeepSeekClient 解析 usage（真实调用因 BLOCKED 未采样） | Contract PASS | ⚠️ |
| LLM 自主决策质量（tool 选择/参数由模型生成） | 真实 provider 下工具序列正确 | **BLOCKED**（脚本化 LLM 代替） | **BLOCKED (billing)** | ❌ |
| Observability | 指标全且无敏感信息 | `GET /ai/metrics` 全维度 + 日志审计无密钥 | Contract PASS | ✅ |

## 2. 结论

**RELEASE BLOCKED BY CREDENTIALS (LLM billing + embedding provider)** —— 全部可在当前架构内运行的部分（Contract + Integration）已通过；两个 BLOCKED 项均不影响数据安全与状态一致性（LLM 失败路径全部降级到确定性 workflow，不产生任何写坏状态的通道）。

## 3. 解除阻塞后的升门动作

1. 充值 DeepSeek 或替换 `AI_API_KEY`/`AI_BASE_URL` → 重跑 `scripts/v34-remote-llm-smoke.mjs`（4/4 PASS + tokens>0）。
2. 配置 embeddings provider（`EMBEDDING_API_KEY`/`EMBEDDING_BASE_URL`/`EMBEDDING_MODEL`）→ 按 `docs/v34-remote-embedding-blocker.md` §3 清单验证维度/归一/批量。
3. 用真实 key 复跑 Phase 7/8 的 LLM 叙述维度（coach 第二次回答体现状态变化、agent 真实工具选择序列）。
4. 全部通过后，Release Gate 整体转 **Production Readiness PASS**。
