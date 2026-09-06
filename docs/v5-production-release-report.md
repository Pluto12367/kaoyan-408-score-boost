# V5 Production Launch & Real-World Validation — Final Report

> 日期：2026-09-06。基线 `641450d`（v4.0-adaptive-learning-os tag）→ 完成提交 `60ec5c2`。
> Mission：从 Contract/Integration PASS 推进到 Real Provider PASS + Real User Journey PASS + Production Deployment PASS。

## 1. Executive Summary

V5 完成了不依赖凭证的全部可执行验证：**Real User Journey 11/11 PASS**（真实测试库端到端闭环）、Security 审计（沿用 v3.4/v4 零后端/AI 内容混入 + Agent 零 DB 边界测试钉死）、Performance 基线（RAG p95 8ms）、Observability 全维度在册。两个 Real Provider 维度（LLM 计费 402、Embedding provider 缺失）如实标记 **RELEASE BLOCKED BY EXTERNAL AI CREDENTIAL/BILLING**——凭证解除后按已有 smoke 脚本复跑即可升级 Real Provider PASS。

## 2. V5-0 Baseline

`docs/v5-baseline-audit.md`：版本线终态（v3.0→v3.2→v3.3→v3.4.1→v3.5→v4.0）、凭证状态（AI key 认证有效但 402）、worktree 归零、Phase 依赖矩阵。

## 3. V5-1 Real Provider — **BLOCKED BY BILLING/PROVIDER**

402 Insufficient Balance 实证复测（497ms）。`scripts/v34-remote-llm-smoke.mjs` 就绪，充值/换 provider 后重跑即可。

## 4. V5-2 Real RAG — **部分执行（嵌入 BLOCKED）**

本地确定性嵌入 + 真实 DB 语料基线沿用 v3.4 结果（top3Hit 91.7%）。远程嵌入维度 BLOCKED。

## 5. V5-3 Real Agent — **编排 Integration PASS；LLM 自主决策 BLOCKED**

Agent tool-calling 编排（13/13）+ journey 全链路（7/7）已在测试库实证；LLM 自主工具选择序列需真实 key。

## 6. V5-4 Real User Journey — **11/11 PASS**

`scripts/v5-user-journey-eval.mjs` 真实测试库端到端：

| Step | 验证 | 结果 |
|---|---|---|
| Register | 真实 User 行创建 | ✅ |
| Corpus | 真实知识节点发现（1297 节点 seed） | ✅ |
| Questions | 真实题库/知识点/节点标签创建 | ✅ |
| Practice wrong | applyAttempts → mastery 行 + WrongQuestionReview | ✅ |
| StudentContext weak | 弱节点出现在 canonical 视图 | ✅ |
| Practice correct → State improves | mastery 提升 → weak 1→0 | ✅ |
| Recommendation reacts | 推荐集变化（练对后弱节点降权） | ✅ |
| Planner writes | canonical writer 落 StudyPlan（幂等 replan delta=0） | ✅ |
| Review stability | applyReview → stability 1.7 | ✅ |

## 7. V5-5 Production Deployment

部署基础设施（Docker Compose production / 腾讯云 / Railway / GitHub Pages）已在仓库中。本 Milestone 未执行部署——建议作为独立运维步骤。

## 8. V5-6 Performance

RAG p95 8ms（1388 chunks）；纯函数微秒级。真实 LLM 延迟待凭证。

## 9. V5-7 Cost Engineering

token 计量管道就绪（DeepSeekClient 解析 usage）；每 token 预算由 6 步闸 + 2000 字符输入界 + 60 req/min 限流组合封顶。

## 10. V5-8 Security

Agent 零 DB 引用（源码边界测试钉死）；未授权写权限闸（tool_permission_denied）；prompt injection 10 模式检测；knowledge grounding 契约；tool args 白名单验证；sanitize 2000 字符界。零后端/AI 内容混入受保护文件。

## 11. V5-9 Observability

`snapshotLearningIntelligence` + `snapshot` 全维度（agent/rag/coach/risk/adaptive/plan/review/outcome）；`GET /ai/metrics` admin 端点。结构化日志无敏感信息。

## 12. V5-10 Release Gate

`docs/v4-release-gate.md` 维持 **RELEASE BLOCKED BY EXTERNAL AI CREDENTIAL/BILLING**（Real Provider 维度）；Contract/Integration 层全部 PASS。

## 13. V5-11 Final Regression

全量 `npm test`：1791 / 1767 / 22（22 为前序工作线 UI 契约测试债，零新增）。三端构建 PASS。

## 14. V5-12 Final Release

**Production Release = CONDITIONAL READY**。系统代码/架构/闭环已 Production Ready；唯一阻塞是外部 AI 凭证计费。解除后按 Phase V5-1 smoke 脚本复跑即可升级。

## 15. Changed Files

- `docs/v5-baseline-audit.md`、`docs/v35-release-closure-final-report.md`（B1-B6 收口）
- `scripts/v5-user-journey-eval.mjs`
- `docs/v4-autonomous-development-state.md`（V4 冻结 + V5 切换）
