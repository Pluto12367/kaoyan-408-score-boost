# 优化路线开源参考检查（UX 提升线 + 求职向 P0-P2）

> 日期：2026-09-07。目的：为下一阶段优化（回流闭环/流式/观测/评估/复习算法/练习心流/MCP）寻找可借鉴的开源项目。
> 纪律：只借鉴模式与数据模型，不复制代码；引入任何依赖前须评估与仓库零配置原则/红线的相容性。

## 方向 → 项目对照总表

| # | 优化方向 | 项目 | 可借鉴强度 |
|---|---|---|---|
| A | AI 对话体验/流式 | [lobe-chat](https://github.com/lobehub/lobe-chat) | ★★★ |
| B | LLM 观测（trace+成本） | [Langfuse](https://github.com/langfuse/langfuse) | ★★★（借数据模型，不部署） |
| C | LLM 评估 CI | [promptfoo](https://github.com/promptfoo/promptfoo) | ★★（借格式，用 node:test 实现） |
| D | 复习调度算法升级 | [FSRS / ts-fsrs](https://github.com/open-spaced-repetition) | ★★★ |
| E | 考试系统多端+通知 | [学之思 xzs](https://github.com/mindskip/xzs-mysql) | ★★ |
| F | 苏格拉底 AI 家教深化 | [Tutor-GPT (plastic-labs)](https://github.com/plastic-labs/tutor-gpt)、[DeepTutor](https://github.com/HKUDS/DeepTutor)、[SocraticLM](https://github.com/Ljyustc/SocraticLM) | ★★（SocraticLM 数据集可喂评估集） |
| G | MCP 工具暴露 | [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) + [Inspector](https://github.com/modelcontextprotocol/inspector) | ★★★ |
| H | 现代 LMS 信息架构 | [LearnHouse](https://github.com/learnhouse/learnhouse) | ★（低优先） |

## A. lobe-chat — 流式与对话体验（对应 UX②/求职P0-2）

- **借鉴**：SSE 流式渲染管线（边解析边渲染的分块协议设计）；会话/消息持久化分层（会话列表→消息→元数据）；消息级元数据展示（模型、耗时、token——正好接我们的 fallbackReason 契约）；MCP 市场化接入工具的客户端形态。
- **不采纳**：Next.js 技术栈整体迁移；其完整聊天 UI（我们已有 TutorPanel + 精灵对话，形态不同）；重依赖树。
- **第一步**：在 `/ai/contextual-coach` 加 SSE 变体端点（`text/event-stream`），复用现有 provider 抽象；前端打字机渲染 + 断流降级到模板。

## B. Langfuse — trace 数据模型（对应 求职P0-3/P1-4/P1-5）

- **借鉴**：**数据模型是其精髓**——`trace`（一次用户请求）→ `span/observation`（generation / tool / retrieval 三类子观察，含 latency、cost、input/output、parent 链）；dataset + experiment 的评估闭环形态；按模型的价格表折算成本。
- **不采纳**：**不在 2C2G 自托管 Langfuse**（v3 需要 ClickHouse+Redis+PG，超出内存预算）；不引 SDK。
- **第一步**：借其数据模型建**内部轻量版**——`AgentTrace` 表（correlationId 已贯穿 supervisor，天然主键）+ 三类 span JSON + admin 查看页；成本按 DeepSeek 价格表常量折算。零新服务，符合仓库自建纪律。

## C. promptfoo — 评估门禁形态（对应 求职P1-4）

- **借鉴**：YAML 声明式测试用例（prompt+vars+assert）的组织方式；"prompt 变更 → PR 上跑回归 → diff 可审"的 CI 形态；红队用例的组织方式。
- **不采纳**：CI 中引入 promptfoo 本体（违反"零配置可启动"，且我们 LLM 还在 402）。
- **第一步**：用 node:test + JSON golden set 实现同构物：`test/agent-evals/`（50-100 条，从 AiTutorLog 真实记录提取）+ 断言器（引用命中率/拒答正确率/格式契约）；LLM 解锁后可对拍真实输出。

## D. FSRS — 复习调度算法升级（对应核心闭环，最有学习科学含金量的一项）

- **现状对标**：我们的 `ReviewSchedule` 已有 stabilityDays/consecutiveCorrect/nextReviewAt（SM-2 近亲，固定 1/3/7/14 间隔）；[ts-fsrs](https://open-spaced-repetition.github.io/ts-fsrs/) 提供 TS 实现的 [FSRS 算法](https://github.com/open-spaced-repetition/fsrs4anki)（DSR 记忆三分量模型：难度/稳定性/可提取性，按用户历史优化间隔）。
- **借鉴**：DSR 三分量记忆状态模型（与现有 stability 字段心智连续）；最优间隔公式与遗忘曲线驱动的 nextReviewAt；Anki 社区已大规模验证的参数默认值。
- **不采纳/须谨慎**：直接引 npm 包进生产写路径前，须按 AGENTS.md §5 做算法变更影响分析；更符合仓库哲学的做法是把 FSRS 核心公式重实现进 `packages/shared` 纯函数（对齐"掌握度/复习算法在 shared"的既有约定），与现算法做并行对比实验（effectiveness 管线现成）后再切换。
- **第一步**：shared 新增 `fsrs-scheduler.ts` 纯函数 + 对照测试（同输入下 SM-2 vs FSRS 的间隔序列）；挂进 `/coach/experiment-assignment` 做影子对比。

## E. 学之思 xzs — 考试系统多端与触达（对应 UX①/③）

- **借鉴**：**微信小程序端**的覆盖策略（考研学生真实所在）；消息通知/任务中心的形态；考试记录页的用时/得分/自行批改展示。
- **不采纳**：Java/Vue 技术栈；其无自适应模型的题库架构。
- **第一步**：先把站内"消息中心"（backlog #48 站内提醒）做出来，小程序是后置大决策。

## F. 开源 AI 家教 — Tutor Mode 深化与评估集素材

- [Tutor-GPT](https://github.com/plastic-labs/tutor-gpt)：**Theory-of-Mind**——对话中维护学生情绪/动机状态的记忆，提示升级策略（hint→nudge→explain）。借鉴其"学生状态影响提示策略"的分层，接到我们已有的 checkUnderstanding 判据上。
- [DeepTutor](https://github.com/HKUDS/DeepTutor)：终身个性化档案的文档理解路线，参考其 long-term profile 组织。
- [SocraticLM/EULER](https://github.com/Ljyustc/SocraticLM)：**其开源数据集可直接作为我们苏格拉底行为的评估集种子**（正反例标注现成）——喂给 C 的 golden set。

## G. MCP 官方参考实现 — 工具暴露（对应 求职P1-6）

- **借鉴**：[官方 servers 仓库](https://github.com/modelcontextprotocol/servers)的 server 代码结构（stdio + streamable HTTP 两种传输）；[Inspector](https://github.com/modelcontextprotocol/inspector) 作为调试工具。
- **红线落地**：只暴露**只读工具**（getStudentContext/searchKnowledge/getWrongQuestions）；`createStudyTask` 绝不进 MCP 面（写权限硬闸沿用）。
- **第一步**：用官方 TS SDK 包一个 `mcp-server` 入口（独立进程，不进 Nest 主服务），Inspector 连通验证。

## H. LearnHouse — 低优先

Notion 式编辑器/CLI 自托管体验有启发，但我们产品是个人自适应学习而非课程交付，信息架构可借鉴点有限。仅在改版首页 IA 时回看。

## 结论（引用进下阶段设计的模式）

1. 流式协议形态 ← lobe-chat；2. trace 三类 span 数据模型 ← Langfuse（自建轻量）；3. 评估用例组织 ← promptfoo（node:test 实现）；4. DSR 记忆模型 ← FSRS（shared 纯函数重实现 + 影子实验）；5. 苏格拉底评估集种子 ← SocraticLM 数据集；6. 只读 MCP server ← 官方参考实现。

## Sources

- [lobehub/lobe-chat](https://github.com/lobehub/lobe-chat) · [LobeHub MCP](https://lobehub.com/mcp)
- [langfuse/langfuse](https://github.com/langfuse/langfuse) · [Observability docs](https://langfuse.com/docs/observability/overview)
- [promptfoo/promptfoo](https://github.com/promptfoo/promptfoo) · [CI/CD 集成](https://www.promptfoo.dev/docs/integrations/ci-cd/)
- [open-spaced-repetition](https://github.com/open-spaced-repetition) · [ts-fsrs 文档](https://open-spaced-repetition.github.io/ts-fsrs/) · [fsrs4anki](https://github.com/open-spaced-repetition/fsrs4anki)
- [mindskip/xzs-mysql](https://github.com/mindskip/xzs-mysql)
- [plastic-labs/tutor-gpt](https://github.com/plastic-labs/tutor-gpt) · [HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor) · [Ljyustc/SocraticLM](https://github.com/Ljyustc/SocraticLM)
- [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) · [MCP 规范](https://modelcontextprotocol.io)
- [learnhouse/learnhouse](https://github.com/learnhouse/learnhouse)
