# Agent Memory Layer Design — Phase AI-7

> 日期：2026-09-05。实现：`apps/api/src/agent/learning-memory.ts`（纯函数）+ `learning-memory.service.ts`（Nest 壳）。
> 硬约束：不建表、不改 Schema；**不绕过 StudentContext**；Memory 只读、可重建、永不成为 Source of Truth。

## 1. 设计原则

1. **单一事实来源**：Memory 的唯一输入是 canonical `StudentContext`。Practice / WrongQuestion / Review / Plan 事实已由 StudentContext 聚合（mastery/practice/review/plan/momentum 段），Memory 层是**视图重排**，不是第二套状态模型。
2. **只读**：无任何写方法、无存储介质（无表/无 localStorage/无进程内累积缓存——每次请求重新派生）。源码边界测试钉死（无数据库客户端引用、无 write 原语）。
3. **可重建**：核心是纯函数 `buildLearningMemoryFromContext(context)`，同输入必同输出（确定性测试钉死）；删除任何状态后可从 StudentContext 完整重建。
4. **不使用聊天历史**：跨请求记忆来自学习事实的派生视图，而非对话记录。

## 2. 三层结构

| 层 | 内容 | 来源（StudentContext 段） | 界 |
|---|---|---|---|
| **短期**（当前学习任务） | openTasks（今日 pending/in_progress，≤5，带 knowledgeNodeId）、completedToday、liveSession（最近未完成 session） | plan.todayTasks、momentum.recentSessions | 当日 |
| **中期**（近期薄弱知识） | weakNodes（≤3，带 mastery）、improvingNodes（≤3）、highRiskQuestions（按 wrongCount 降序 ≤3）、dueCount/overdueCount | mastery.weakNodes/improvingPoints、review.highRiskQuestions/due | 近 7~30 天 |
| **长期**（历史学习模式） | studyStreak、recentAccuracy（趋势值+状态）、topSubjects（≤3）、examGoal（目标/当前/剩余天数/阶段/最弱科目） | momentum、practice、exam、profile | 全历史聚合 |

### 已知缺口（有意决策）
StudentContext v1 刻意不承载 assessment facts（契约决定，`student-context.query.service.ts` 中 assessment 被显式弃用），因此长期模式**不含测评历史分数**。直接读 AssessmentHistoryItem 表会绕过 canonical 入口，被设计否决；待 StudentContext 契约演进（存在既有提案线）后在 Memory 增量补齐。

## 3. Memory Retrieval Layer

- `LearningMemoryService.getLearningMemory(userId)` → 三层结构 + `brief`（紧凑中文摘要，≤900 字符，确定性渲染，用于 prompt 注入）。
- 检索裁剪按调用方需求：
  - Agent（规划）：完整三层注入 system prompt 背景；
  - 后续 Coach/其他消费方可复用同一 service 按层取用（`memory.shortTerm / midTerm / longTerm` 独立可序列化）。
- 时间基准：调用时刻注入（service 内 clock 可注入，默认 `new Date()`），StudentContext 的 `asOf` 随查询生效。

## 4. Agent 集成

- `StudyAgentService` 构造器尾部追加 `@Optional() LearningMemoryService`（遵守位置参数地雷规则；未注入时行为与 V1 完全一致）。
- 注入点：**LLM system prompt** 尾部追加一行"学习记忆（只读背景，来自学生上下文）：{brief}"。加载失败仅 warn，不阻塞 run（failure-isolated）。
- workflow 兜底路径不注入（保持确定性输出契约稳定）；workflow 的个性化已由 StudentContext 步骤承载。
- 明确不做：Memory 不作为工具暴露给 LLM（工具集冻结为六个，避免扩权面）；不写入任何存储。

## 5. 测试与验证

`test/agent-memory.test.js`（9 项，全绿）：
- 三层结构与边界（≤5/≤3/降序）；空 StudentContext 安全空层；确定性（同输入 deepEqual）；brief 紧凑有界且不含 undefined；
- Service 仅经 StudentContextQueryService 派生（调用断言）；
- 边界：两文件无数据库客户端引用、无 write 原语、无持久化调用；
- Agent 消费：system prompt 注入 brief + 失败不阻塞（源码契约）。
- 既有 Agent 套件回归 29/29 全绿（构造器追加参数未破坏任何既有测试）。

## 6. 为什么不用"聊天历史 / 向量记忆库"

- 聊天历史：与里程碑约束相悖（任务明确要求不以聊天历史为 memory），且引入上下文膨胀与隐私面。
- 向量记忆库：需要持久化（Schema 冻结）且当前无真实数据沉淀；StudentContext 派生视图已覆盖"学习记忆"的核心语义，且零存储、零重建成本。未来若需个性化长期记忆（如学习偏好笔记），应先走 StudentContext 契约演进，而非 agent 私有存储。
