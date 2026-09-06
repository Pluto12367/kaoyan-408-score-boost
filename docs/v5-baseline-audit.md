# V5 Baseline Audit — Production Launch & Real-World Validation

> 日期：2026-09-06。基线 HEAD：`7311834`（v3.5 RC + V4 文档）。工作树：**归零**。分支 `feature/v3-product-refactor`。

## 1. Release Baseline（版本线终态）

```
v4.0-adaptive-learning-os → 641450d  V4 Adaptive Learning OS（含最终文档）
7311834                   → v3.5 Release Candidate + V4 状态文档
a18a85e                   → B6 工作线归零
a47d4b8                   → B5 主题系统
3ce2d9c                   → B4 Score Center 桥接
4a1e570                   → B3 Student Home/Report
b796099                   → B2 Review Center / Knowledge Galaxy
c5cb7be                   → readiness report
3a1fbc9  v3.4.1-closure   → B1.2 源闭包
8aa1a84                   → B1 源闭包 111 文件
ce0d949  v3.2-ai-agent-production
b3ca19c  v3.3-ai-learning-companion
4f58fe3  v3.0-student-context
```

全链可独立检出、可构建、可测试（v3.4.1-closure fresh worktree 实证 + v3.5 RC fresh worktree 同验证）。

## 2. Remaining Blockers

| 项 | 类型 | 解除条件 | 影响面 |
|---|---|---|---|
| DeepSeek API 402 Insufficient Balance | **BLOCKED BY CREDENTIALS/BILLING** | 充值或换 provider → 重跑 `scripts/v34-remote-llm-smoke.mjs` | Real LLM/Agent/Coach/Planner 叙述维度 |
| Embedding provider 缺失（DeepSeek 无端点） | **BLOCKED BY CREDENTIALS/PROVIDER** | 引入 embeddings provider | Real Embedding 维度 |
| 22 项前序工作线 UI 契约测试债 | 前序工作线（W1/W4） | 所有者收口 | 非本任务域 |
| ENV-005 全量 PostgreSQL integration | 环境项 | 按仓库既有流程 | 不伪造；专项闭环已实库验证 |

## 3. Worktree Ownership

工作树归零。前序 `.worktrees/` 检出（actionable-post-exam-tasks 等）和 `.codex/worktrees/` 为前序工作线的临时检出，由所有者管理，不在本任务范围。

## 4. Known Technical Debt

- 22 项前序工作线 UI 契约测试失败（student-action-ui 12、freshness 4、单发 6）
- 本地词法嵌入的语义上限（远程 provider 可消除）
- `StudentLearningConsole.tsx` 未引用组件（所有者决定去留）
- StudentContext 精确 per-question streak 契约缺口（TD-V4-2）

## 5. V5 Phase 依赖矩阵

| Phase | 依赖凭证？ | 状态 |
|---|---|---|
| V5-0 Baseline | 否 | ✅ 本文件 |
| V5-1 Real Provider | **是（billing + embedding provider）** | ⚠️ BLOCKED，可重试 |
| V5-2 Real RAG（50+ 查询） | 嵌入部分是；检索基础设施部分否 | 可部分执行（本地嵌入基线+真库语料） |
| V5-3 Real Agent | LLM 部分是；工具编排部分否 | 可部分执行 |
| V5-4 Real User Journey | 否（测试库已就绪） | ✅ 可执行 |
| V5-5 Production Deployment | 否（配置+脚本+验证） | ✅ 可执行 |
| V5-6 Performance | 否（本地基线可建立） | ✅ 可执行 |
| V5-7 Cost Engineering | 需凭证采样真实 token；预算管道可建 | 可部分执行 |
| V5-8 Security | 否 | ✅ 可执行 |
| V5-9 Observability | 否 | ✅ 可执行 |
| V5-10 Release Gate | 汇总 | 待各 Phase 完成 |
| V5-11 Final Regression | 否 | ✅ 可执行 |
| V5-12 Final Release | 汇总 | 待各 Phase 完成 |
