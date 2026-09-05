# v3.4 AI Production Validation & Closed-Loop Learning — Final Report

> 日期：2026-09-06。基线 HEAD `4271b91`（tag v3.3-ai-learning-companion）。分支 `feature/v3-product-refactor`。
> Mission：不堆新功能，验证并强化真实闭环——AI → Learning Action → Practice/Review → Student State → Mastery → Recommendation → Next Action。

## 1. Executive Summary

v3.4 将"代码已存在"升级为"行为已验证"：在真实 PostgreSQL 测试库（seed 后 1297 知识节点/1388 RAG chunks/235 真题/1149 考频快照）上，以生产代码路径跑通 **6 条学习闭环**（规划/掌握度反馈/复习/Coach/考试/写安全），闭环断言 21+13 项全绿；RAG 真实语料检索 top3Hit **91.7%**（precision@3 0.681 / recall 0.917，avg latency 8ms）；**发现并修复 1 个真实检索缺陷**（口语泛化词污染检索，TDD 修复）。远程 LLM 因账户余额不足（402，认证链路已证实真实）与远程 Embedding 因无凭证+provider 不支持，均如实标记 **BLOCKED**——Release Gate 为 `RELEASE BLOCKED BY CREDENTIALS`，未将任何 stub 结果冒充为真实 provider PASS。

## 2. Baseline

`docs/v34-baseline-audit.md`：240 项 AI 测试全绿重跑（不沿用历史 PASS）；环境凭证盘点（AI_API_KEY PRESENT / EMBEDDING_API_KEY MISSING / 测试库 55432 UP）；164 个未提交文件归属确认（全为前序在途线，零触碰）。

## 3. Real LLM Validation

**BLOCKED (Insufficient Balance)**。`scripts/v34-remote-llm-smoke.mjs` 真实调用 DeepSeek 官方 API（4 类请求：coach plain / RAG-grounded / 强制工具调用 / 自由工具选择）→ 全部 402。关键事实：**402 而非 401 证明认证链路真实**（key 被 provider 接受，失败在计费层）；请求格式（tools/tool_choice/json_mode/thinking）被接受（非 400）。详见 `docs/v34-remote-llm-blocker.md`。解除路径：充值或换已充值 OpenAI 兼容 provider 后重跑脚本。

## 4. Real Embedding Validation

**BLOCKED (credentials + provider 不支持)**：`EMBEDDING_API_KEY` 不存在；DeepSeek 官方 API 无 `/embeddings` 端点，无法复用 LLM key。当前生产默认的本地确定性嵌入（`local-deterministic-v1`）已被真实验证（Phase 3 全部基于它）。详见 `docs/v34-remote-embedding-blocker.md`（含解除后 5 步验证清单）。

## 5. RAG Validation（真实 DB 语料）

`scripts/v34-rag-pipeline-eval.mjs`：完整生产管线（DB 语料→corpus→embedding→index→rewrite→hybrid→graph→difficulty）。

| 指标 | 值 |
|---|---|
| top3Hit | **22/24 = 91.7%**（四科 24 查询，真值动态解析自 DB，无硬编码 id） |
| precision@3 | **0.681** |
| recall | **0.917** |
| irrelevant rejection | 3/4 |
| avg / p95 latency | 8ms / 8ms（1388 chunks） |
| payload | 1.7KB / 5 结果 |

**发现并修复真实缺陷**：口语规则把"是什么"扩成"概念/定义"注入检索向量查询，真实语料上使所有"XX定义"节点获得虚假亲和力（TLB case：top1 从 TLB 变"图的定义"）。TDD 修复：口语命中仅作意图信号（appliedRules），不再注入检索词；术语扩展保留（"PV不会"仍扩 PV操作/信号量）。修复后 TLB case 进入 top3。

已知局限（如实记录，不凑绿）：拓扑排序 case（"排序"bigram 在排序章节多节点的碰撞压过图章节目标）与 1 个无关拒答漏网（无关查询 topScore 0.13-0.41 与相关区间重叠）——本地词法嵌入语义上限，远程语义向量解除阻塞后可消除。

## 6. Agent Validation

`scripts/v34-agent-toolcalling-eval.mjs`：**13/13**。真实工具注册表（六工具全真实依赖）+ 真实 DB + 脚本化 LLM（协议同真实 provider）。验证：工具顺序、参数正确、安全投影、失败恢复、6 步上限、deadline、**写权限闸（未授权 createStudyTask → writer 0 调用）**、**canonical writer 真实落库 + generationKey 幂等（同 user+date 二次创建 delta=0）**、真实外键拒非法写（eval user 缺失时 StudyPlan create 被 FK 拒绝——数据库层保护实证）、真实 provider 可达（invalid key → 401）。

## 7. Coach Validation

P7（coach-exam-loop-eval）：**3/3**。"为什么PV操作总错？"→ wrong_question 装配：StudentContext weakPoints=[信号量]（真实 mastery）→ RAG grounding（生产者消费者问题 0.45，PV 强相关）→ 练习转对后**第二次装配 weak 1→0、avgMastery 40→60**——状态变化真实反映到 AI 上下文。LLM 叙述维度 BLOCKED（billing），上下文管线维度 Integration PASS。

## 8. Planner Validation

P5：planner 经 canonical writer 落真实 StudyPlan+StudyTask（tasks=2，generationKey=`AGENT:{user}:{date}:v1`）；validatePlan 四规则在真实数据上运行；planner 焦点随考试结果迁移（P8）。

## 9. Exam Simulator Validation

P8：真实节点检索→真实题库选题（3 题/3 覆盖点）→作答→analysis（accuracy 0%、weakPoints=3，确定性）→mastery 行累积→**planner 焦点迁移实证**（组相联映射→优先级调度）。

## 10. Learning Closed Loop（核心业务验收）

六条通路全部 Integration PASS（架构图与断言明细：`docs/v34-ai-production-architecture.md` §2）。核心证据链：**错题→mastery 0.402→引擎 priority 46→练对→mastery 0.596→priority 39**（真实 evidence+真实 mastery+真实引擎打分）；复习→stability null→1.7（成功）/持平（失败，引擎设计 mult 1.0）。

**重要语义澄清（验证中实证，非缺陷）**：mastery 变化后节点被挤出推荐 top8 属引擎正确行为——(a) examValue（真题频率，权重 0.37）主导排序；(b) 36h 冷却窗口对刚学节点 ×0.55 降权防刷。mastery 对推荐的响应在节点级 priority 上实证（46→39），不受 items cap 掩盖。

## 11. Failure Engineering

12 类场景覆盖映射（既有 240 项测试 + v3.4 闭环脚本）：LLM timeout（client+deadline）/ malformed（normalizer）/ tool failure（恢复测试）/ 超时后写（deadline 跳过写步骤）/ retrieval empty（显式 available=false）/ irrelevant（拒答+ungrounded 标记）/ embedding failure（5 类错误分类）/ partial execution（步骤级 error 继续）/ duplicate execution（幂等实测 delta=0）/ invalid args（枚举钳制）/ prompt injection（10 模式+引用契约）/ oversized（2000 字符界）。另实证真实 FK 拒非法写。结论：**不崩溃、不写坏 Student State、不产生重复 StudyPlan、不伪造成功**全部成立。

## 12. Performance

RAG：1388 chunks avg 8ms / p95 8ms、payload 1.7KB——无瓶颈证据，无需引入新基础设施。Agent/Coach 真实 LLM 延迟 BLOCKED 未采样；token 计量管道（usage 解析+metrics）就绪，解除阻塞即出基线。P95/token 维度在 `AiMetricsService.snapshot` 持续可用。

## 13. Evaluation（V2）

RAG precision@3 0.681 / recall 0.917 / top3Hit 91.7% / 拒答 75%（28 用例）；Agent tool accuracy + plan feasibility + failure recovery；Coach personalization/grounding/actionability；Exam coverage/difficulty/misconception。Regression dataset 固化于 `test/ai-eval-*`、`test/px-eval-productization.test.js`、`scripts/v34-rag-pipeline-eval.mjs`——任何 AI 修改必须复跑。

## 14. Observability

`GET /ai/metrics`（admin）全维度（agent 含 p95/tokens、rag 含 cacheHitRate、coach fallbackRate、evaluation passRate）。敏感信息审计：脚本与日志路径无密钥；结构化日志仅含 id/分数/时长。

## 15. Changed Files（v3.4 增量）

新增：`scripts/v34-remote-llm-smoke.mjs`、`scripts/v34-rag-pipeline-eval.mjs`、`scripts/v34-agent-toolcalling-eval.mjs`、`scripts/v34-closed-loop-eval.mjs`、`scripts/v34-coach-exam-loop-eval.mjs`；`docs/v34-baseline-audit.md`、`docs/v34-remote-llm-blocker.md`、`docs/v34-remote-embedding-blocker.md`、`docs/v34-ai-release-gate.md`、`docs/v34-ai-production-architecture.md`、本报告。
修改：`apps/api/src/rag/learning-rag.ts`（唯一产品代码修复：口语泛化词不注入检索，TDD）；`test/learning-rag.test.js`（断言随契约更新）；`docs/current-sprint.md`。

## 16. Tests

- AI 域基线 240/240（28 文件，v3.4 开始时重跑）。
- v3.4 新增评测断言：RAG 28 用例 + Agent 13 + 闭环 21——全部 PASS。
- rewrite 修复后受影响套件 48/48。

## 17. Build

`build:shared` PASS；`build:api` EXIT=0；`build:web` PASS（`✓ built in 11.45s`）。
全量 `npm test`：**1721 tests / 1694 pass / 25 fail / 2 skipped**——25 失败与预存基线一致（12×student-action-ui、4×student-context-freshness 及其他在途 UI wiring 债务），零新增。

## 18. Blocked Items

| 项 | 类型 | 解除条件 |
|---|---|---|
| Remote LLM 4 类 smoke | **BLOCKED BY CREDENTIALS (billing 402)** | 充值/换 provider → 重跑 smoke |
| Remote Embedding | **BLOCKED BY CREDENTIALS + provider 不支持** | 引入 embeddings provider 按清单验证 |
| LLM 自主决策质量（真实工具选择序列） | BLOCKED（随 LLM） | 同上 |
| ENV-005 / 全量 PostgreSQL integration | 环境项（测试库 fixture 本身 UP 且已用） | 按仓库既有流程，不伪造 |

## 19. Risks

1. 本地词法嵌入语义上限（拓扑/拒答两个已记录 miss）——远程 provider 解除后消除。
2. 真实 LLM 延迟/token 基线缺失（billing 阻塞）——计量管道就绪，缺采样。
3. 评测集 28 用例规模有限；题库扩充后建议扩到 50+ 并保持真值动态解析。
4. 闭环验证基于一次性测试库数据；生产库首次启用 RAG 需索引预热（TTL 自动重建）。

## 20. Next Milestone 建议

1. **Credentials Unblock**（最优先）：充值/配置真实 LLM+embedding → 复跑 Phase 1/2/4/7 的 Real Provider 层 → Release Gate 转 Production Readiness PASS。
2. **LLM-in-the-loop evaluation**：真实 provider 就绪后把工具选择评测升级为模型生成。
3. **RAG 语义升级**：远程向量替换时按 blocker 清单做维度迁移。
4. **前端 AI 面板**：消费 `GET /ai/metrics` 与 supervisor 端点（v3.4 零前端改动）。
