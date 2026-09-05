# V4 Autonomous Development State — Adaptive Learning OS

> **上下文恢复入口**：发生上下文压缩后，首先读本文件，再读 `docs/current-sprint.md`。
> 最后更新：2026-09-06（V4-1 完成）。

## Current Mission

V4 Adaptive Learning OS——把系统从"被动响应"升级为"持续观察→预测→主动干预→执行→调整"的自适应学习闭环。

## Current Phase

V4-7 Adaptive Review（动态 spacing/intensity，保持既有 ReviewSchedule 语义）。

## Completed

- **V4-0**：持久状态账本（本文件）。
- **V4-2**：Learning Signal Engine 完成——apps/api/src/adaptive/learning-signals.ts（8 类信号纯函数，deterministic，baseline-gated 优雅降级）+ LearningSignalService（Nest 壳，StudentContext 单一入口）。测试 9+3 全绿。
- **V4-5**：Agent Adaptive Planner 完成——StudyAgentService 构造器尾部追加 @Optional LearningSignalService；systemPrompt 注入学习信号 brief + derivePlanningStrategy 策略指令（规则派生，非 LLM）。
- **V4-6**：Proactive Coach 完成——apps/api/src/adaptive/proactive-coach.ts（风险→主动干预卡片：headline/actions/actorHint，按 severity 排序，确定性可重建）。测试 6/6。
- **V4-4**：Adaptive Recommendation Layer 完成——apps/api/src/adaptive/adaptive-recommendation.ts（risk boost/exam proximity/review card/overload cap，确定性重排）+ DailyPlanningService 集成（adaptive 字段进 DailyStudyPlan）。测试 6/6 + px2 回归。
- **V4-3**：LearningRiskDetector 完成——apps/api/src/adaptive/learning-risk.ts（6 类风险：knowledge_regression/repeated_mistake/review_debt/study_inactivity/overload/exam_risk；evidence-based 纯函数，severity/confidence/recommendation；健康学生零风险）。测试 10/10。
- **V4-1**：自适应闭环审计 → `docs/v4-adaptive-learning-audit.md`。核心结论：被动闭环（表现→State→推荐→计划→行为→结果）已在 v3.4 实证完整；**主动自适应层缺失**（Signal/Risk/Predict/Proactive）= V4 增量空间。
- 前序基线：v3.4.1-closure（`3a1fbc9`，fresh checkout 三端构建 PASS）+ B2-B6 收口（工作树归零，RC `a18a85e`）。全量 1721/1694/22（22 为前序工作线 UI 契约债）。

## In Progress

- V4-2：`apps/api/src/adaptive/learning-signals.ts`（8 类信号纯函数）+ `LearningSignalService`。输入 = StudentContext（canonical）+ 可选历史基线；只读、可重建、非事实源。

## Pending（依赖序）

- V4-3 Risk Detector（6 类风险，evidence-based，禁 LLM 单独判定）
- V4-4 Adaptive Recommendation Layer（引擎前置适配，不重写引擎）
- V4-5 Agent Adaptive Planner（signals/risks 注入 planner 输入）
- V4-6 Proactive Coach（信号/风险驱动的主动干预）
- V4-7 Adaptive Review（spacing/intensity，保持既有 ReviewSchedule 语义）
- V4-8 Personalized Practice（真实题库/节点选题）
- V4-9 Adaptive Exam Simulation（难度进阶）
- V4-10 Evaluation V3（50+ 确定性用例）
- V4-11 Experiment Framework（离线策略对比基础设施）
- V4-12 Observability（learning intelligence metrics）
- V4-13 Failure Engineering（错误信号/误报/陈旧上下文/重复干预）
- V4-14 Performance（latency/P95/query count 基线）
- V4-15 Release Gate（`docs/v4-release-gate.md`）
- V4-16 文档（`docs/v4-adaptive-learning-architecture.md` + final report）

## Blocked

- Real AI Provider（402 Insufficient Balance / embedding provider 缺失）——仅影响 Real Provider 层验证；Contract/Integration 层可全量推进。

## Architecture Decisions（累积）

- **AD-V4-1**：Learning Signal / Risk 的唯一输入是 StudentContext（canonical read boundary）+ 其派生视图；需要历史的信号以"可选基线输入"参数化（`UserMasterySnapshot` 每日快照表已存在，经只读 repository 提供），不建新事实源、不改 Schema。
- **AD-V4-2**：V4-4 Adaptive Layer 是推荐引擎的**前置适配**（输入证据增强/结果重排），不修改 `packages/shared/src/score-center/*` 引擎核心。
- **AD-V4-3**：风险判定 evidence-based 纯函数；LLM 仅在叙述/教学层使用。
- **AD-V4-4**：主动干预（proactive）全部经既有 canonical 写通道（createStudyTask / 既有 review 服务）；Proactive Coach 不新增写路径。

## Technical Debt（V4 新登记）

- TD-V4-1：StudentContext 单时点视图，无内建历史对比（mastery change/regression 信号需基线输入或 snapshot 表查询——经只读 repo 解决）。
- TD-V4-2：per-question 错题连击（wrong streak）数据在 WrongQuestionReview.consecutiveCorrect 中，StudentContext 未承载——信号以汇总比例 + highRisk 近似，精确 streak 留待契约演进。

## Known Risks

- Real Provider BLOCKED（billing）——真实 LLM 叙述/工具选择维度验证持续推迟。
- 22 项既有 UI 契约测试债（前序工作线）。

## Next Task

V4-7：Adaptive Review——动态 spacing/intensity，保持既有 ReviewSchedule 语义。

## Last Validation (V4-5: adaptive-planner 2/2 + agent/signal/risks 回归 57/57)

v3.4.1-closure fresh worktree：三端构建 PASS；六域核心回归 168/172（4 fail = 既有 freshness 债）；全量 1721/1694/22。
