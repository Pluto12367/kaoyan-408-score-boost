# AI Evaluation Framework & Report — Phase AI-11

> 日期：2026-09-05。框架载体：node:test 固定评测集（确定性、可重复、随 `npm test` 持续回归）。
> 本次跑分：**13/13 通过**（检索 3 + Agent 4 + Coach 6，含全部指标断言）。

## 1. 框架设计

- **可重复**：全部评测使用确定性组件（本地嵌入 provider、固定语料 fixture、脚本化 LLM、纯函数 validator）——同一代码必然同一结果；评测即回归。
- **三层评测面**：RAG（检索质量）、Agent（行为质量）、Coach（个性化质量），与生产三入口一一对应。
- **指标即断言**：每项指标表达为阈值断言，跌破即测试失败，防止质量回退。

## 2. RAG 评测（`test/ai-eval-retrieval.test.js`）

### retrieval accuracy（检索命中率）
- 评测集：**12 条固定查询**，覆盖四科（DS 链表/二叉树/快排、CO 流水线/中断、OS 信号量/PV/死锁/页面置换、TCP 握手/拥塞、IP 分类）。
- 指标：Top-3 包含预期 `knowledgeNodeId`。
- **结果：12/12 = 100%**。要点：口语查询（"PV不会"）经 V2 rewrite 后命中"信号量"节点；释义改写（"死锁的四个必要条件是什么"）命中"死锁必要条件"。

### irrelevant retrieval（无关拒答）
- 评测集：3 条域外查询（天气/晚饭/股票）。
- 指标：Top-1 relevance < 0.25。
- **结果：3/3 拒答成功**（本地确定性嵌入下域外查询与 408 语料几乎零重叠）。

### relevance ordering（相对排序）
- 释义查询的预期节点排名先于无关节点。**通过**。

已知局限（登记）：本地确定性嵌入为词法级语义；真实语义泛化需配置远程 embedding provider（`EMBEDDING_API_KEY`），评测集无需修改即可复跑。

## 3. Agent 评测（`test/ai-eval-agent.test.js`）

### tool selection（工具选择）
- 场景 1（解释型提问"为什么死锁总错"）：脚本化 LLM 选择 `getStudentContext → searchKnowledge → getWrongQuestions` —— 步骤序列与工具执行完全一致。**通过**。
- 场景 2（规划请求但未授权写入）：LLM 输出中夹带 `createStudyTask` 调用 → Guard 硬闸拒绝，推荐服务**零调用**。**通过**（安全边界评测）。

### plan quality（计划质量）
- 构造四重缺陷计划（重复 + 已掌握节点 + 超容量 + 正常项）→ validator 输出唯一保留项，removed 原因精确覆盖 `duplicate / already_mastered / over_capacity`，总分钟 ≤ 预算。**通过**。

### failure recovery（故障恢复）
- LLM 完全不可用（connection refused）→ workflow 兜底跑满四步读取管线，答案非空，`fallbackReason` 显式。**通过**。

## 4. Coach 评测（`test/ai-eval-coach.test.js`）

### personalization（个性化）
- 弱科学生上下文（weakPoints=死锁必要条件）→ 输出锚定其错题材料。**通过**。
- 强者上下文（0 薄弱/8 掌握）→ 摘要仍证据驱动、动作非空。**通过**。
- knowledge_node 场景 → 锚定节点详情 + 三张复习卡。**通过**。

### response quality（输出质量）
- 五字段契约（summary/replySteps/misconceptionTips/reviewCards/nextActions）对任意输入（含空消息）始终成立，reviewCards type 枚举合法。**通过**。

### safety/budget regressions（护栏回归）
- Coach prompt 守卫语句（不得修改/不得虚构检索结果）+ assembler 有界切片（slice 3/5）作为持续回归断言。**通过**。

## 5. 运行方式与扩展

```bash
node --test --test-timeout=20000 test/ai-eval-retrieval.test.js test/ai-eval-agent.test.js test/ai-eval-coach.test.js
```

扩展评测集：在 `RETRIEVAL_CASES` 追加 `[query, expectedNodeId]`；新增 Agent 场景按"脚本化 LLM + 全 mock registry"模板复制；预期质量阈值变化需同步更新本报告（第 2 节跑分为 2026-09-05 基线）。
