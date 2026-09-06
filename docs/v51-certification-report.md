# V5.1 Production Certification Report

> 日期：2026-09-06。基线 tag `v5.0-production-launch` → `656a887`。
> 分级诚实标注：Stub PASS / Contract PASS / Integration PASS / Real Provider PASS / Production Certification PASS 严格区分。

## 1. Real LLM Provider — **REAL_LLM_BLOCKED_BY_BILLING**

- `AI_API_KEY`（35 字符）认证链路有效（HTTP 402 非 401）
- 4 类请求（coach plain / RAG-grounded / forced tool call / free tool selection）全部 402
- latency 0.4-1.3s（错误往返）；tokens=0（无成功调用）
- 脚本：`scripts/v34-remote-llm-smoke.mjs`；解除后重跑即可升级 Real Provider PASS

## 2. Real Embedding Provider — **REAL_EMBEDDING_BLOCKED**

- 无凭证 + DeepSeek 无 `/embeddings` 端点
- 解除后验证清单：`docs/v34-remote-embedding-blocker.md` §3

## 3. Real RAG — **Integration PASS（嵌入维度 BLOCKED）**

真实 DB 语料（1297 节点 / 1388 chunks / 235 真题 / 1149 快照）全管线：top3Hit 91.7%、precision@3 0.681、recall 0.917、拒答 75%、p95 8ms。指标基线 `scripts/v34-rag-pipeline-eval.mjs`。已知局限：本地词法嵌入语义上限（排序章节碰撞 + 拒答 1 miss）——远程语义向量可消除。

## 4. Real Agent — **Integration PASS（编排）；LLM 自主决策 BLOCKED**

工具编排 13/13（工具顺序、参数验证、权限闸、幂等、FK 拒写、deadline、步数上限）；V5-4 journey 全链路 7/7（注册→做题→错题→State→推荐→Planner→幂等→Review stability）。Agent 零 DB 引用边界测试持续钉死。

## 5. Real Coach — **Integration PASS（上下文/Session/个性化）；LLM 叙述 BLOCKED**

Coach Session Memory + 对话压缩 + Prompt V2 + RAG grounding 全部 Contract/Integration PASS（44/44 项 coach 套件）；LLM 叙述维度 BLOCKED。

## 6. Real Exam — **Integration PASS**

四模式策略出卷（topic_drill/chapter_test/comprehensive/mock_exam）从真实题库 + 真实节点选题，LLM 零参与；考后分析 → 推荐变化实证。

## 7. Real User Journey — **Integration PASS（11/11）**

`scripts/v5-user-journey-eval.mjs`：Register → Corpus → Questions → Practice(wrong→right) → WrongQuestionReview → StudentContext weak 1→0 → Recommendation reacts → Planner writes real StudyPlan → Idempotent replan → Review stability 1.7。全链路真实测试库行验证。

## 8. Cost — **管道就绪；采样 BLOCKED**

Token 计量管道（DeepSeekClient usage 解析 + AiMetricsService）就绪；每 token 预算由步数闸（6 步）+ 输入界（2000 字符）+ 限流（60 req/min）组合封顶。真实采样 BLOCKED。

## 9. Performance — **Integration PASS（本地）**

| 指标 | 值 |
|---|---|
| RAG 检索 p95 | 8ms（1388 chunks） |
| RAG payload | 1.7KB / 5 结果 |
| signals/risks/adaptive | 微秒级（纯函数） |
| LLM 延迟 | BLOCKED（无法采样） |

## 10. Security — **Integration PASS**

- Agent 零 DB 引用（源码边界测试，agent/rag 目录审计持续）
- 写权限硬闸（未授权 createStudyTask → tool_permission_denied，writer 0 调用）
- Prompt injection 10 模式检测 + 防御前缀 + knowledge grounding 契约
- Tool args 白名单验证 + sanitize 2000 字符界
- `GET /ai/metrics` admin-only + 无敏感日志

## 11. Failure Engineering — **Integration PASS**

12 类失败场景（garbage input/malformed JSON/timeout/rate limit/tool failure/partial execution/duplicate execution/invalid args/prompt injection/oversized/unauthorized write/real FK rejection）全部降级不崩溃，Student State 不破坏。

## 12. Evaluation Datasets Frozen

| 数据集 | 位置 | 断言数 |
|---|---|---|
| Signals | `test/v4-learning-signals.test.js` | 9 |
| Signal Service | `test/v4-learning-signal-service.test.js` | 3 |
| Risks | `test/v4-learning-risk.test.js` | 10 |
| Adaptive Layer | `test/v4-adaptive-recommendation.test.js` | 6 |
| Review/Practice | `test/v4-adaptive-review-practice.test.js` | 10 |
| Exam Strategy | `test/v4-adaptive-exam.test.js` | 5 |
| Planner Prompt | `test/v4-adaptive-planner.test.js` | 2 |
| Eval V3 | `test/v4-evaluation-v3.test.js` | 8 test / 53+ 断言 |
| Experiment | `test/v4-experiment-observability.test.js` | 5 |
| Failure Engineering | `test/v4-failure-engineering.test.js` | 6 |
| RAG Pipeline | `scripts/v34-rag-pipeline-eval.mjs` | 28 查询用例 |
| User Journey | `scripts/v5-user-journey-eval.mjs` | 11 步 |
| PX Coach | `test/px1-coach-productization.test.js` | 12 |
| PX Daily | `test/px2-daily-agent.test.js` | 7 |
| PX Exam | `test/px3-exam-simulator.test.js` | 8 |
| PX Tutor/Multi | `test/px4-px5-tutor-multiagent.test.js` | 13 |

**合计 200+ 断言**（V4+V5 全套件）。任何 AI 修改必须复跑。

## 13. Full Regression / Build

全量 `npm test`：1791/1767/22（22 为前序工作线 UI 契约债，零新增）。三端构建 PASS。Fresh checkout（v3.4.1-closure + v3.5 RC worktree）实证。

## 14. Final Gate

| 维度 | Gate |
|---|---|
| Architecture | ✅ PASS |
| Correctness | ✅ PASS |
| **Real Provider** | ❌ **BLOCKED BY BILLING/PROVIDER** |
| RAG | ✅ PASS（Integration，嵌入 BLOCKED） |
| Agent | ✅ PASS（Integration，LLM BLOCKED） |
| Coach | ✅ PASS（Integration，LLM BLOCKED） |
| Exam | ✅ PASS |
| Security | ✅ PASS |
| Performance | ✅ PASS（本地维度） |
| Cost | ⚠️ 管道就绪，采样 BLOCKED |
| Observability | ✅ PASS |
| **Production Certification** | **CODE/ARCHITECTURE READY — REAL PROVIDER BLOCKED** |
