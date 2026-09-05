# v3.4 Remote LLM Validation — Phase 1 Result: BLOCKED (Insufficient Balance)

> 日期：2026-09-06。Harness：`scripts/v34-remote-llm-smoke.mjs`（真实 HTTP 调用，非 stub）。
> 凭证来源：`.env.development` 的 `AI_API_KEY`（35 字符，DeepSeek sk- 格式）。

## 1. 结论

**REAL PROVIDER PASS=0/4 —— BLOCKED: INSUFFICIENT BALANCE（账户余额不足）。**

关键区分（mission 要求的诚实分级）：
- **认证链路真实有效**：provider 返回 **402 Insufficient Balance**（而非 401 Unauthorized）——key 是真实且被 DeepSeek 接受的，失败发生在计费层。
- **不是 stub PASS**：四类请求全部打到 `https://api.deepseek.com/chat/completions`（model `deepseek-v4-flash`），拿到的是真实 provider 错误响应。
- **不构成 functional PASS**：任何把此次结果标为"真实 LLM 验证通过"的表述都是伪造。Release Gate（Phase 13）必须标记 **RELEASE BLOCKED BY CREDENTIALS (billing)**。

## 2. 冒烟记录（真实请求参数与结果）

| # | label | 目的 | 结果 | latency | status |
|---|---|---|---|---|---|
| 1 | coach_plain | Coach 普通 JSON 请求（json_mode + guardrail prompt） | FAIL 402 | 671ms | 402 |
| 2 | coach_rag_grounded | RAG-grounded（knowledgeContext 信封 + 引用契约） | FAIL 402 | 1293ms | 402 |
| 3 | agent_tool_call | 强制单工具调用（tool_choice 强制 getStudentContext） | FAIL 402 | 409ms | 402 |
| 4 | agent_planning_selection | 自由工具选择（三工具真实 toolset，验证 planner 选路） | FAIL 402 | 423ms | 402 |

total_tokens: 0（无任何计费成功调用）。延迟 0.4~1.3s 为 provider 错误往返，不可作为性能基线。

## 3. 已验证的链路事实（无需计费即成立）

- 请求格式被 provider 接受（402 是计费错误，非 400 参数错误）——tools/tool_choice/json_mode/thinking 参数序列与 DeepSeek v4-flash 兼容性待计费后确认。
- 密钥管理符合要求：脚本从 env 文件加载，全程未打印密钥；错误响应不含敏感信息。

## 4. 解除阻塞条件（单一路径）

给 `.env.development` 中的 DeepSeek 账户充值（或替换为其他已充值 OpenAI 兼容 provider 的 `AI_API_KEY`/`AI_BASE_URL`）。解除后重跑：

```bash
node scripts/v34-remote-llm-smoke.mjs
```

期望：4/4 PASS 且 total_tokens > 0；随后 Phase 4（真实 Agent 编排）与 Phase 7（Coach 闭环）复用同一凭证路径。

## 5. 对后续 Phase 的影响

- Phase 4（Agent tool-calling）：**真实 LLM 维度 BLOCKED**；降级执行"高保真协议验证"——用真实 provider 错误路径 + 完整工具注册表 + 测试库（Phase 5-8 内覆盖），并在报告中标注等级。
- Phase 7/8 的"第二次回答体现状态变化"：状态变化断言（Mastery/Recommendation）不依赖 LLM，可全量验证；仅"AI 叙述质量"维度 BLOCKED。
- Phase 13 Release Gate：`REAL LLM: BLOCKED (billing)` 独立标注，不与 stub/contract 结果混写。
