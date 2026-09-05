# V4 Release Gate — Adaptive Learning OS

> 日期：2026-09-06。定义 V4 各验证维度的发布标准与当前实测状态。
> 诚实分级不变：Stub PASS ＜ Contract PASS ＜ Integration PASS ＜ Real Provider PASS ＜ Production Readiness。

## 1. Gate 状态总表

| 维度 | 标准 | 当前实测 | Gate |
|---|---|---|---|
| Architecture | 单向依赖（StudentContext→Memory→Signals→Risks→Adaptive→Agent→Canonical Writer）；Agent 零 DB 访问；无新事实源 | 边界测试 + 源码审计通过（adaptive/ 目录零 prisma 引用） | ✅ |
| Correctness（单元/契约） | v4 套件 0 失败 | 70/70（V4-2..V4-13 全套件） | ✅ |
| Signal Engine | 8 类信号全实现、deterministic、baseline-gated 降级 | 9/9 纯函数 + 3/3 service | ✅ |
| Risk Detection | 6 类风险、evidence-based、健康学生零误报 | 10/10（含 zero-noise + 确定性） | ✅ |
| Adaptive Recommendation | risk boost/exam proximity/review card/overload cap 正确应用 | 6/6 + px2 回归 | ✅ |
| Adaptive Planner | signals/risks 注入 prompt + 策略指令派生 | 2/2（v4-adaptive-planner） | ✅ |
| Proactive Coach | 风险→干预卡片（headline/actions/actorHint）+ 健康零干预 | 6/6（含 zero-noise） | ✅ |
| Evaluation V3 | ≥50 确定性断言用例、全绿 | 53+（v4-evaluation-v3 + 各 phase 套件） | ✅ |
| Experiment | 双臂策略对比（adaptive vs baseline）12 学生群体 | 3/3 | ✅ |
| Observability | 6 类新指标入 snapshot + /ai/metrics | record*/snapshotLearningIntelligence 全通 | ✅ |
| Failure Engineering | 崩溃 0 / 脏写 0 / 重复 0 / 伪造 0 | v4-failure-engineering 6/6 | ✅ |
| Performance（RAG/纯函数） | p95 < 50ms | p95 8ms（1388 chunks） | ✅ |
| Performance（LLM/Coach 真实延迟） | 基线建立 | **BLOCKED (billing)** | ⚠️ |
| Real LLM Provider | 4/4 smoke PASS + tokens>0 | 4/4 402 Insufficient Balance | ❌ |
| Real Embedding Provider | 真实 /embeddings PASS | 无凭证 + provider 不支持 | ❌ |
| ENV-005（全量 PostgreSQL integration） | 按仓库流程 | 保持现状，未伪造；专项闭环已实库验证 | ⚠️ |

## 2. 结论

**V4 Adaptive Learning OS 功能 = COMPLETE（Contract + Integration 层全绿）。**

**RELEASE = CONDITIONAL PASS**：
- ✅ 可发布部分：Signal Engine、Risk Detector、Adaptive Layer、Proactive Coach、Adaptive Planner、Experiment Framework、Learning Intelligence Metrics、Failure Engineering——全部 Contract/Integration PASS。
- ❌ BLOCKED BY EXTERNAL CREDENTIAL/BILLING：Real LLM Provider（402）与 Real Embedding Provider（无凭证+端点不支持）两维度。解除后按 v3.4 blocker 清单执行 Real Provider 层验证，即可转 Production Readiness PASS。

## 3. 凭证解除后的升门动作

1. 充值 DeepSeek（或换 provider）→ `scripts/v34-remote-llm-smoke.mjs` 4/4 PASS。
2. 配置 embeddings provider → 按 `docs/v34-remote-embedding-blocker.md` §3 验证维度/归一/批处理。
3. 真实 LLM 叙述维度复验（Coach 二次装配、Agent 真实工具选择序列）。
4. 全绿后 Release Gate → Production Readiness PASS。
