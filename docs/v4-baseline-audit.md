# V4 Baseline Audit

> 日期：2026-09-06。基线 HEAD：`7311834`（v3.5 Release Candidate `a18a85e` + 状态文档）。工作树：**归零**（0 脏文件）。

## 1. 版本线

```
v3.0-student-context   → 4f58fe3  StudentContext 主线
v3.2-ai-agent-production → ce0d949  AI-0..AI-12
v3.3-ai-learning-companion → b3ca19c  PX-1..PX-5
v3.4.1-closure         → 3a1fbc9  源闭包修复（fresh checkout 可构建）
v3.5 RC                → a18a85e  B2..B6 工作线收口（工作树归零）
HEAD                   → 7311834  状态文档
```

## 2. 当前架构（已验证能力清单）

| 层 | 能力 | 验证等级 |
|---|---|---|
| State | PracticeRecord / UserKnowledgeMastery(含 snapshots) / WrongQuestionReview / ReviewSchedule+Attempt / StudyPlan+Task / StudyTaskCompletion / LearningSession / UserEvent / AnswerReceipt / AssessmentHistoryItem | Source of Truth（既有） |
| Read | StudentContext v1（canonical 只读边界，bounded reads，freshness） | Contract + Integration PASS |
| RAG | V2 pipeline（rewrite/hybrid/graph/difficulty），真实语料 top3Hit 91.7% | Integration PASS（local embedding；remote BLOCKED） |
| Agent | 六工具 + V1 loop + workflow 兜底 + Planner(validate→execute) + 权限闸 + deadline | Integration PASS（真实 DB 写入实证） |
| Memory | 三层 Learning Memory（StudentContext 派生） | Contract PASS |
| Coach | Session memory + 压缩 + 个性化 V2 + RAG grounding | Contract PASS |
| Exam | 真实题库+真实节点出卷 + 确定性分析 | Integration PASS |
| Adaptive（雏形） | DailyPlanningService.deriveDifficultyAdjustment（reduce/maintain/challenge 三档规则） | Contract PASS |
| Observability | AiMetrics（agent/rag/coach/evaluation）+ /ai/metrics admin | Contract PASS |

## 3. 已有技术债

- 22 项前序工作线 UI 契约测试失败（student-action-ui 12、freshness 4、单发 6）——v3.4 基线在册，非 AI 域。
- StudentContext 单时点无历史对比（V4 信号需基线注入或 snapshot 查询）。
- per-question 错题连击未进 StudentContext。
- Real Provider BLOCKED（LLM billing / embedding provider）。
- 既有 ENV-005 全量 PostgreSQL integration 状态（专项闭环已用 55432 fixture 实库验证）。

## 4. Current Blockers

- AI 凭证（402 billing / embedding provider 缺失）——仅影响 Real Provider 层。
- 无代码/环境阻塞。

## 5. 工作树状态

归零。v3.4.1 以来全部增量（B2-B6、v3.4 验证脚本、文档）均已按工作线精确入库。

## 6. V4 增量空间（详见 v4-adaptive-learning-audit.md）

被动闭环完整（已实证）；主动自适应层（Signal → Risk → Predict → Proactive → Adapt）缺失——V4-2 起逐层补齐。
