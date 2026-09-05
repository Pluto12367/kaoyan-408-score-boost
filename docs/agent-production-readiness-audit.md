# Agent Production Readiness Audit — Phase AI-6

> 日期：2026-09-05。对象：AI Foundation 交付的 Study Agent V1（`apps/api/src/agent/`）与 Knowledge RAG V1（`apps/api/src/rag/`）。
> 事实来源：当前工作树代码（逐项核对文件与行号）。只读审计。

## 1. 八维度审计

### 1.1 Tool 生命周期 — 满足（有注意项）

- `StudyAgentToolRegistry` 为无状态单例：`execute()` 即时执行、无工具级缓存、无队列；工具集由纯函数 `listStudyAgentTools()` 冻结（`agent-tools.ts`）。
- 依赖全部为注入的既有服务实例（StudentContextQueryService / KnowledgeSearchService / QuestionsService / WrongQuestionQueryService / RecommendationService），生命周期 = Nest 容器单例，与请求解耦。
- 注意项：工具执行时长未设单独上限——工具底层是本地 DB/内存查询，实际风险低；风险集中在 LLM 循环（见 1.6）。

### 1.2 Tool 输入输出 contract — 部分满足

- 输入：白名单校验（`AGENT_TOOL_NAMES` includes）+ 参数校验（subject 枚举、topK 钳制 1..5、availableMinutes 枚举 30/60/120/180、`requiredString` 必填）。未知工具与非法枚举显式报错。
- 输出：手工有界（题目 10 / 错题 10 / 计划预览 8 / 计划任务 8；搜题剥除 answer/analysis）。
- 缺口：无 schema 化输出验证与版本字段；工具结果直接透传给 LLM（4000 字符截断兜底）。

### 1.3 Agent Memory — 缺失

- 每次 `run()` 完全独立：无学习记忆层，重复请求重复推导；agent 对"学生昨天刚复盘过什么、长期什么模式"无感知，只能靠单次 StudentContext 快照。
- → AI-7 补齐。

### 1.4 Conversation Context — 缺失（设计内）

- V1 为单轮规划 agent：`messages` 数组仅存活于单次 LLM 循环；无跨轮对话。不是缺陷而是 V1 范围；AI-7 的 memory 层提供"跨请求记忆"的替代路径（不引入聊天历史依赖）。

### 1.5 Failure Handling — 良好

- LLM 失败 → 确定性 workflow 兜底，`fallbackReason='llm_error: …'` 显式（`study-agent.service.ts` runLlmLoop catch）。
- 单工具失败 → 步骤记录 error、流程继续、答案仍生成（降级测试覆盖）。
- 空消息 → 引导语，不执行任何工具。
- 步数耗尽 → `max_steps_reached` 显式返回。

### 1.6 LLM Timeout — 满足（有组合风险）

- `DeepSeekClient` AbortController 超时默认 25s（`AI_TIMEOUT_MS`），超时分类为 `ChatCompletionError('timeout')`。
- **TD-P1（新）**：Agent 循环无 wall-clock 总上限。最坏 6 步 × 25s ≈ 150s+，可能超过反向代理/浏览器超时。缓解建议：run 级 deadline（如 60s）超限提前返回已收集结果。

### 1.7 Retry Strategy — 缺失（决策：保持不加）

- 无任何自动重试。429/瞬时网络错误 → 直接落 workflow 模式。
- 与仓库既有 AI 路径（contextual coach）的"fallback 不 retry"模式一致；重试会放大成本与延迟，登记为有意决策而非缺口。若未来加重试，应在 AgentLlm 边界做且仅限 429/timeout 各 1 次。

### 1.8 Cost Control — 部分

- 已有：`MAX_LLM_STEPS=6` 硬上限；工具结果截断 4000 字符；LLM `max_tokens` 默认 2000（`AI_MAX_TOKENS`）；全局 ThrottlerGuard 60 req/min。
- **TD-P2（新）**：无 token 计量（DeepSeekClient 未解析响应 `usage` 字段）；无每用户/每窗口预算；单步 LLM 可一次返回多个工具调用，步数上限是唯一闸门。
- 定量最坏估算：6 步，输入随工具结果累积（≤6×4000 字符 ≈ 4-6k tokens）+ 输出 6×2000 → 单次 run ≈ 上限 2 万 tokens 量级。可控但无护栏。

## 2. 四个关键风险问题

### Q1：当前 Agent 能否连续运行一天？

**能，带条件。** 依据：
- 无状态请求路径（run 内局部变量，无跨请求累积）；RAG 索引 TTL（默认 1h）自动重建且 `replaceAll` 为整体替换、无累积泄漏；InMemoryVectorStore 无增长路径。
- 全局限流 60 req/min 已存在。
- 条件缺口：无 token 预算护栏（TD-P2）、无 run 级 deadline（TD-P1）、指标只写 stdout 无聚合（TD-P4）——均不阻塞"跑一天"，阻塞"跑一天且可观测、可控"。

### Q2：是否可能无限调用工具？

**不可能。** `MAX_LLM_STEPS=6` 循环硬上限；每轮工具调用来自单次 LLM 响应的 toolCalls 数组，受循环次数兜底；非白名单工具名被过滤（测试钉死）。workflow 路径为固定 ≤5 次工具调用。

### Q3：是否可能无限消耗 token？

**不会无限，但无总量保证。** 上界 ≈ 2 万 tokens/run（见 1.8），由步数与截断兜底；缺 token 计量与预算护栏 → AI-12 补 usage 解析与快照指标；预算护栏按最小方案（env 可配的每 run token 软上限）在 AI-12 一并落地。

### Q4：是否可能生成错误计划 / 绕过业务边界？

**错误计划：可能，有边界。** `createStudyTask` 的入参已钳制（minutes 枚举、日期格式、scheduledDate 允许任意合法日期——LLM 可把任务排到任意未来日；预览项未经能力/重复/已掌握过滤）。canonical writer 保证幂等与一致性，但**不校验计划合理性** → AI-9 Plan Validation 补齐（超容量/重复/已掌握三类违规）。
**绕过边界：不可能。** 源码边界测试钉死：agent 层无数据库客户端引用、无写原语；唯一写路径 = `RecommendationService.generateDailyPlanFromState`；`createTasks` 需显式授权 flag；控制器拒绝 body userId。

## 3. 缺口 → 后续阶段映射

| 缺口 | 阶段 | 最小方案 |
|---|---|---|
| GAP-1 无学习记忆 | AI-7 | 从 StudentContext 派生只读三层记忆（短期/中期/长期），纯函数可重建，不建表 |
| GAP-2 RAG 无改写/混合/图扩展/难度感知 | AI-8 | 规则化 query rewrite + hybrid 融合 + 1-hop 关系扩展 + mastery 调权；V1 API 不变 |
| GAP-3 无 planner/plan validation | AI-9 | Planner 编排 + 纯函数 Validator（容量/重复/已掌握/认知负荷） |
| GAP-4 无安全护栏 | AI-10 | Guard：注入检测、输入净化、知识引用校验（knowledgeNodeId 必配）、显式"不知道" |
| GAP-5 无评估框架 | AI-11 | node:test 固定评测集（检索命中/无关拒答/工具选择/计划质量/个性化） |
| GAP-6 指标不可查询 | AI-12 | 内存滑动窗口 metrics + admin 快照接口 + usage 解析 |
| TD-P1 run 级 deadline | AI-9 一并落地 | 60s 默认（env 可配），超限返回已收集步骤 |
| TD-P2 token 预算 | AI-12 | usage 解析 + 每 run 软上限（超限提前收敛） |
| TD-P4 日志无聚合 | AI-12 | AiMetricsService 快照接口 |

## 4. 结论

V1 是合格的受控原型：边界安全（不可能绕过业务层）、步数有硬闸、失败有兜底、日志有结构。距离"连续运行一天的生产系统"差四件事：记忆（重复请求智能复用）、计划合理性校验、安全护栏、可查询的运行指标——分别对应 AI-7/9/10/12，均在"不新增基础设施、不碰冻结域"约束内可完成。
