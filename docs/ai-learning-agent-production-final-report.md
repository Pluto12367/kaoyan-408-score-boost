# AI Learning Agent Production Evolution — Milestone Final Report

> 日期：2026-09-05。分支 `feature/v3-product-refactor`（工作树，未提交）。
> 范围：AI Learning Agent Production Evolution Milestone（Phase AI-6 → AI-12），在 AI Foundation（AI-0…AI-5）之上演进。
> 硬约束遵守：未修改 Prisma Schema / Mastery Engine / Recommendation Engine / Practice 写路径；未删除任何 API；Memory 与全部 RAG 能力经由 StudentContext（未绕过）；Agent 层零数据库访问（源码边界测试持续钉死）。

## 1. 最终验收清单

| 验收项 | 状态 | 证据 |
|---|---|---|
| Agent Memory Layer | ✅ | `learning-memory.ts`（纯函数三层派生）+ `LearningMemoryService`；只读/可重建/非 SoT 有测试钉死；设计文档 `docs/agent-memory-design.md` |
| Advanced RAG | ✅ | V2 pipeline（rewrite/hybrid/graph expansion/difficulty）`learning-rag.ts` + `LearningRagService` + `GET /rag/knowledge/v2/search`；V1 契约零改动 |
| Agent Planner | ✅ | `StudyPlannerService`（Goal→Analyze→Draft→Validate→Execute→Return）+ `POST /agent/study/plan`；四规则 `validatePlan`（容量/重复/已掌握/认知负荷）；run 级 deadline（TD-P1 关闭） |
| Safety Boundary | ✅ | `agent-guard.ts`：输入净化、注入检测（中英 10 模式）、引用校验（knowledgeNodeId 必配、未知引用剔除）、显式"不知道"；写工具权限硬闸（未授权 `createStudyTask` 调用被拒且不执行） |
| Evaluation Framework | ✅ | 3 个评测套件 13 项（检索命中 12/12、无关拒答、工具选择、计划质量、故障恢复、个性化）；报告 `docs/ai-evaluation-report.md` |
| Production Metrics | ✅ | `AiMetricsService`（滑窗 1h/5000 事件环）+ `GET /ai/metrics`（admin）+ DeepSeek usage 解析 + 三面埋点（agent/rag/coach） |
| Tests | ✅ | 本 Milestone 新增 96 项（memory 9 + V2 14 + planner 13 + guard 12 + metrics 12 + eval 13 + 既有 AI 域 23）；AI 域组合回归 **160/160** |
| Build | ✅ | `build:shared` / `build:api` EXIT=0 / `build:web` PASS（前端零改动） |
| Documentation | ✅ | 审计、Memory 设计、评测报告、本报告 |

## 2. 分阶段交付（AI-6 → AI-12）

### AI-6 Agent Architecture Audit → `docs/agent-production-readiness-audit.md`
八维度审计 + 四个关键问题回答：**能**连续运行一天（带条件）；**不可能**无限调用工具（6 步硬闸）；token 有上界但当时无计量（→AI-12）；**可能**生成未校验的错误计划（→AI-9）；**不可能**绕过业务边界。新登记 TD-P1（无 run deadline）、TD-P2（无 token 计量）、TD-P4（指标不可查询）——分别由 AI-9/AI-12 关闭；TD-P3（无重试）为有意决策：与仓库"fallback 不 retry"既有模式一致。

### AI-7 Agent Memory Layer → `docs/agent-memory-design.md`
- **单一来源**：仅从 canonical StudentContext 派生（practice/wrong-question/review/plan 事实已聚合其中）。
- **三层**：shortTerm（今日任务+进行中会话）/ midTerm（薄弱节点≤3、高危错题≤3、到期复习）/ longTerm（streak、正确率趋势、科目重心、备考目标）。
- **brief 注入**：≤900 字符确定性摘要注入 LLM system prompt；加载失败仅 warn 不阻塞。
- 已知缺口（有意）：assessment 历史不进 memory（StudentContext v1 契约不承载；直接读表=绕过 canonical 入口，被否决），待契约演进增量补齐。

### AI-8 Advanced RAG（Learning RAG V2）
- **Query Rewrite**：规则化术语表（PV→PV操作/信号量/进程同步、死锁族、LRU/FIFO/TCP…）+ 口语规范化（"不会"→概念/机制/步骤）。确定性、零成本；LLM rewrite 留作可选增强。
- **Hybrid Retrieval**：`0.65·vector + 0.30·keyword(字符 n-gram 重叠) + 0.05·titleBoost` 融合重排。
- **Graph Expansion**：1-hop KnowledgeRelation 邻居（≤3/seed、去重、0.5×seed 分、标记 `graph_expansion`+reachedFrom）。
- **Difficulty Awareness**：StudentContext mastery 调权——已掌握（≥0.8）降权 0.7；薄弱区进阶题（difficulty≥4）轻降并标记；生产个性化路径由调用方传 StudentContext mastery（agent/内部），HTTP `mastery` 参数仅供显式调用与评测。
- V1 API/service 契约零改动；`KnowledgeSearchService.getGraphSnapshot()` 为新增只读读法。

### AI-9 Agent Planning（Study Agent V2）
- `POST /agent/study/plan`：默认 validate-only；`execute:true` 才写（写仍走 `createStudyTask` → canonical writer，幂等 generationKey）。
- `validatePlan` 四规则：`already_mastered`（mastery≥0.85 剔除）/ `duplicate`（同节点同动作保高分）/ `over_capacity`（超预算从低分尾剔除）/ `learn_limit`（LEARN≤3 认知负荷）；输出 removed 审计轨迹——已掌握任务、重复任务在写入前被禁止。
- **Run deadline**（TD-P1）：`AGENT_RUN_DEADLINE_MS`（默认 60s）；LLM 循环超限提前返回已收集步骤（`deadline_exceeded`）；workflow 写步骤超限跳过（绝不带病写入）。

### AI-10 AI Safety Boundary
- `sanitizeAgentInput`：2000 字符界 + 控制字符剥离。
- `detectPromptInjection`：10 类中英模式（ignore-instructions/role-override/reveal-prompt/jailbreak/fake-system-tag/中文变体）；命中不硬拒（防误伤）而是包防御前缀继续执行。
- **知识引用契约**：LLM 输出契约扩为 `{summary, focusNodes, suggestions, knowledgeRefs, unknown}`；`knowledgeRefs` 必须命中本次 run 实际见过的 knowledgeNodeId 集合（检索结果+上下文桶），未知引用剔除并报告 `invalidCitations`；知识性断言（定义/条件/机制…）无引用 → `ungroundedKnowledgeClaim` 标记。
- **"不知道"**：`unknown:true` 或 summary 前缀（不知道/无法确定/I don't know…）→ `admittedUnknown`；system prompt 明确"没有依据就明确回答不知道，不要编造"。
- **Tool 权限硬闸**：`createStudyTask` 在 `createTasks!==true` 时于循环内被拒（`tool_permission_denied`），即使 LLM 输出该调用也绝不执行——评测用例证明推荐服务零调用。

### AI-11 Evaluation System → `docs/ai-evaluation-report.md`
指标即断言（跌破=测试失败）：retrieval accuracy **12/12**（四科固定集，含口语/释义改写）、irrelevant rejection 3/3（top score<0.25）、tool selection 2 场景、plan quality（三缺陷齐过滤）、failure recovery（LLM 全挂→workflow 完整跑满）、coach personalization（强弱上下文差异化+契约完整）。

### AI-12 Production Observability
- `AiMetricsService`：全局模块；滑窗 60min/事件环 5000；agent（runs/llm/workflow/failureRate/toolCalls/latency p50-p95/tokens）、rag（searches/hitRate/avgTopScore/latency）、coach（responses/fallbackRate/latency）。
- **Token 计量（TD-P2 关闭）**：DeepSeekClient 解析 `usage`（缺失时 undefined，向后兼容有测试）；AgentLlm 透传 → run 结束入 metrics。
- `GET /ai/metrics`（admin only）——Dashboard 数据接口：见 §5。
- 埋点均为 `@Optional` 注入（既有 DI 组合与测试零破坏，AI 域 160 项回归全绿佐证）。

## 3. 修改文件清单（本 Milestone 增量）

新增：
- `apps/api/src/agent/`：learning-memory.ts、learning-memory.service.ts、plan-validator.ts、study-planner.service.ts、agent-guard.ts
- `apps/api/src/rag/`：learning-rag.ts、learning-rag.service.ts
- `apps/api/src/ai-metrics/`：ai-metrics.service.ts、ai-metrics.module.ts、ai-metrics.controller.ts
- `test/`：agent-memory、learning-rag、study-planner、agent-guard、ai-metrics、ai-eval-retrieval、ai-eval-agent、ai-eval-coach（8 文件）
- `docs/`：agent-production-readiness-audit.md、agent-memory-design.md、ai-evaluation-report.md、ai-learning-agent-production-final-report.md（本文件）

修改：
- `apps/api/src/app.module.ts`：注册 AiMetricsModule（global）
- `apps/api/src/agent/`：agent.module.ts（memory/planner/metrics 装配）、agent.controller.ts（`/agent/study/plan`）、agent-tools.ts（默认 minutes 60）、study-agent.service.ts（memory 注入、guard、deadline、usage 计量、metrics）
- `apps/api/src/agent/agent-llm.ts`：usage 透传
- `apps/api/src/rag/`：knowledge-search.service.ts（getGraphSnapshot、metrics 埋点）、rag.controller.ts（v2 路由）、rag.module.ts（LearningRagService）
- `apps/api/src/study/`：deepseek-client.ts（usage 解析）、ai-tutor.service.ts（coach metrics 埋点，尾部 @Optional）
- `docs/current-sprint.md`：状态入口更新

明确未动：prisma/、Mastery Engine、Recommendation Engine 算法、Practice 写路径、legacy API、前端（0 文件）、他人主题在途文件、score-center 在途文件。

## 4. 审计遗留问题的最终状态

| 审计项 | AI-6 状态 | 现状态 |
|---|---|---|
| TD-P1 run deadline | 缺失 | ✅ 已实现（60s 默认，env 可配，LLM+workflow 双路覆盖） |
| TD-P2 token 计量/预算 | 缺失 | ✅ 计量+入 metrics；预算护栏以"usage 可见+60/min 限流+6 步闸"组合替代硬预算（未做 per-user 预算，见 §6 遗留） |
| TD-P4 指标不可查询 | 缺失 | ✅ AiMetricsService + admin 快照 API |
| 无限工具调用 | 不可能 | 保持（6 步闸+白名单+权限硬闸） |
| 错误计划 | 可能 | ✅ 四规则 validator 前置过滤（已掌握/重复/超容量/超载） |
| 绕过业务边界 | 不可能 | 保持（边界测试+权限硬闸+写入唯一通道） |

## 5. 验证结果

- 定向：AI-7 memory 9/9；AI-8 V2 14/14；AI-9 planner 13/13；AI-10 guard 12/12；AI-12 metrics 12/12；AI-11 eval 13/13。
- AI 域组合回归（AI-5+AI-6~12 全部 18 个测试文件）：**160/160 PASS**。
- 全量 `npm test`：见 §8 最终门禁数字（预存基线 25 失败不变）。
- 构建：`build:shared` PASS；`build:api` EXIT=0；`build:web` PASS。

## 6. 遗留风险与建议

1. **远程 LLM/embedding 真实链路未实测**（环境无 key）：协议、usage、错误分类、fallback 均有 stub 覆盖；启用后建议按评测集复跑一次真实冒烟。
2. **Per-user token 预算未做硬闸**：当前组合护栏（6 步+2000 输入界+60 req/min 限流+usage 可观测）已封顶单次成本；若开放高频调用，建议在 AiMetrics 快照上做阈值告警后再决定是否加硬预算。
3. **Metrics 为进程内存活视图**：重启归零（有意，避免 Schema 冻结期建表）；需要历史趋势时接外部聚合（如从结构化日志采集），接口形状已稳定。
4. **Memory 的 assessment 缺口**：待 StudentContext 契约演进（既有提案线）后在 memory.longTerm 增量补齐。
5. **评测基线**：`docs/ai-evaluation-report.md` 跑分为 2026-09-05 本地确定性嵌入基线；切换远程 provider 后预期命中结构变化，需复跑并更新报告。

## 7. Dashboard 数据接口设计（AI-12 交付）

`GET /ai/metrics`（RoleGuard admin）返回：

```json
{
  "window": { "maxAgeMinutes": 60, "eventCap": 5000 },
  "agent": {
    "runs": 0, "llmRuns": 0, "workflowRuns": 0,
    "failureRate": 0, "toolCalls": 0, "failedToolCalls": 0,
    "avgLatencyMs": null, "p95LatencyMs": null,
    "tokens": { "prompt": 0, "completion": 0, "total": 0 }
  },
  "rag": { "searches": 0, "hitRate": 0, "avgTopScore": null, "avgLatencyMs": null },
  "coach": { "responses": 0, "fallbackRate": 0, "avgLatencyMs": null }
}
```

Dashboard 消费建议：agent.failureRate 与 tokens.total 做预算告警；rag.hitRate/avgTopScore 做检索质量趋势；coach.fallbackRate 监控 provider 健康。前端页面不在本 Milestone 范围（冻结域纪律：前端零改动）。

## 8. 结论

AI Foundation（原型/基建就绪）已升级为生产形态的 AI 学习系统：**记忆**（可重建的三层学习记忆）、**检索**（改写+混合+图扩展+难度感知的 Learning RAG V2）、**规划**（带验证与显式执行门的自主 Planner）、**安全**（注入防护/引用契约/承认不知道/写权限硬闸）、**质量**（指标即断言的评测框架）、**可观测**（三面滑窗指标+admin 快照）。八项最终验收全部达成，冻结域零触碰。
