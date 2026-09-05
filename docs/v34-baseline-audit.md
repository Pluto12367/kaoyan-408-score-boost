# v3.4 Baseline & Checkpoint Audit — Phase 0

> 日期：2026-09-06。基线 HEAD：`4271b91`（`b3ca19c` + §6.3 关闭增量）。分支 `feature/v3-product-refactor`。
> 本阶段零代码修改，只做事实核对与回归重跑。

## 1. Git checkpoint 现状

| Tag | Commit | 内容 |
|---|---|---|
| `v3.0-student-context` | `4f58fe3` | V3 StudentContext 主线基线 |
| `v3.2-ai-agent-production` | `ce0d949` | AI-0…AI-12（RAG/Agent/Memory/Planner/Safety/Eval/Metrics，54 文件） |
| `v3.3-ai-learning-companion` | `b3ca19c` | PX-1…PX-5（Coach Session/Daily/Exam/Tutor/Multi-Agent，26 文件） |
| （无 tag） | `7c7b4ff` | PX 收尾：题-节点精确映射（ExamQuestionRepository） |
| （无 tag） | `4271b91` | PX 报告 §6.3 关闭标记 |

## 2. 工作树归属（164 文件未提交——全部非本任务线）

- **Learning Loop / Action 在途线**（前序接手时已存在）：`action-*.ts`、`recommendation-action*.ts`、`canonical-event-writer.service.ts` 等 study 模块未跟踪文件 + `learning-loop-trigger.service.ts` 等修改。
- **前端主题优化线**（受保护清单）：`ExamSession.tsx`、`PracticePanel.tsx`、`styles.css`、`theme-*`、`themePreference.ts`、相关测试。
- **其他前序在途**：Knowledge Galaxy、Review Center、`StudentSections.tsx`、score-center 三文件、`.worktrees/` 临时检出。
- **规则重申**：v3.4 全程只精确 add 自己的增量，禁 `git add -A`/reset/clean/restore/checkout。

## 3. 环境凭证与基础设施（Phase 1/2/5-8 的先决条件）

| 项 | 进程环境 | `.env.development` | 结论 |
|---|---|---|---|
| `AI_API_KEY` | MISSING | **PRESENT（35 字符，非 placeholder，DeepSeek sk- 格式）** | **Phase 1 真实 LLM smoke 可执行**（从 env 文件加载，不打印值） |
| `AI_BASE_URL` / `AI_MODEL` | MISSING | `https://api.deepseek.com` / `deepseek-v4-flash` | DeepSeek 官方 API |
| `EMBEDDING_API_KEY` | MISSING | 不存在 | **Phase 2 = BLOCKED BY CREDENTIALS**（DeepSeek 无 /embeddings 端点，无法复用 AI key） |
| `DATABASE_URL`（进程） | MISSING | `localhost:5432/kaoyan408`（开发库） | 业务库地址存在；v3.4 集成验证用测试库 fixture |
| Docker / 测试库 | — | — | **Docker UP，`127.0.0.1:55432` REACHABLE** → Phase 5/6/8 的 PostgreSQL 闭环验证可执行（`compose.test.yml` fixture，沿用仓库既有测试库，不做 migration/schema 变更） |

成本与安全边界（自我约束）：真实 smoke 仅限小 token 预算（max_tokens 压低、单次 few calls）、密钥只经环境变量注入脚本、日志/报告中零密钥内容。

## 4. AI 回归基线（本次重跑，不沿用历史 PASS）

28 个 AI 测试文件（foundation 10 + production 8 + PX 5 + coach 既有 5）：

```
tests 240 / pass 240 / fail 0   （node --test，本机执行）
```

各域分解与上期一致：RAG 39、Coach RAG 12、Agent 29（V1）+13（Planner）+12（Guard）、Memory 9、V2 14、PX 52、metrics 12、eval 26、coach 既有契约若干。

## 5. 分层验证等级现状（Phase 0 快照，后续逐层升级）

| 层 | 当前等级 | 升级路径 |
|---|---|---|
| 单元/契约（stub 工具、脚本化 LLM） | **Contract PASS**（240/240） | — |
| RAG 检索（本地确定性嵌入 + fixture 语料） | Contract PASS | Phase 3 真实语料/DB 验证 |
| Agent 工具编排 | Contract PASS | Phase 4 真实 LLM 驱动 |
| Coach/Planner/Exam/Tutor | Contract PASS | Phase 7/8 闭环（真实 LLM + 测试库） |
| 远程 LLM | **未验证** | Phase 1 smoke |
| 远程 Embedding | **BLOCKED**（无凭证，Provider 不支持） | Phase 2 blocker 文档 |
| PostgreSQL 闭环（Mastery/Recommendation 变化） | 上期 D4-B4 fixture PASS，本轮未重跑 | Phase 5/6/8 重验 |
| Production Readiness | **未达成** | Phase 13 Release Gate |

## 6. v3.4 执行计划（基于上述事实）

- Phase 1：真实 DeepSeek smoke（.env.development key）→ 记录 latency/tokens/fallback。
- Phase 2：`docs/v34-remote-embedding-blocker.md`（BLOCKED BY CREDENTIALS + provider 限制说明）。
- Phase 3：RAG 管线在真实 DB 知识树（1296 节点）上验证，评测集扩到 ≥20 查询（四科）。
- Phase 4：真实 LLM 驱动 Agent 工具调用验证（真实 key + stub-free 工具注册表 + 测试库）。
- Phase 5-8：PostgreSQL 测试库上的四条闭环验证（Planning / Review / Coach / Exam），断言 Mastery/Recommendation 真实变化。
- Phase 9-12：Failure engineering、性能基线、Evaluation V2、Observability 完善。
- Phase 13-16：Release Gate（真实层与 stub 层分开标注）→ 全量回归 → 架构文档 → 最终报告。
