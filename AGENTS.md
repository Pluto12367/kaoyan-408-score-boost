# Project agent instructions

## 核心规则（所有 AI 编程代理必须遵守）

### 1. 事实来源

- 以当前仓库的实际代码、配置文件、Prisma Schema、迁移、Git 历史与测试为唯一事实来源；不依赖历史聊天记录或口头描述。
- 文档与代码冲突时以代码为准，并在汇报中记录差异。
- 任何"我记得/可能/曾经考虑过"的结论，必须先 grep 或读文件验证，再写入文档或代码。

### 2. 修改前必读

- 首次进入本仓库或跨模块修改前，必须阅读 `docs/PROJECT_CONTEXT.md` 与 `docs/ARCHITECTURE.md`。
- 开工前按下方"Agent Startup Contract"完成读取并输出 `PROTOCOL CHECK`。
- 修改代码前，按下方"Open-source reference check"执行开源参考检查（仅限代码修改类任务）。

### 3. 任务范围

- 每次只处理一个明确任务；不顺手"捎带"修改无关文件。
- 优先小范围、可独立验证的修改；禁止未经用户确认的大规模重构、框架迁移、目录重写。
- 禁止创建与核心提分闭环无关的新功能。

### 4. Mock 与数据

- 禁止静默回退 Mock/演示数据。API 请求失败必须显式展示错误，不得无提示切换为演示数据。
- 前端在静态演示模式（GitHub Pages 无 API）与本地 DEV 的 mock 回退是设计内行为；生产/预发环境禁止任何 mock（见 `apps/web/src/api/env.ts`）。
- 修改数据层时，必须说明数据来源（PostgreSQL / RuntimeState JSON / 内存）与影响范围。

### 5. 兼容性

- 禁止破坏现有 API 路由、响应结构、Prisma 模型与迁移兼容性。
- 新增字段/端点必须向后兼容；修改判题、掌握度、计划算法时必须同步影响分析。

### 6. 数据库变更

- 涉及 Schema 或迁移，必须提前说明：变更类型、数据迁移方案、对现有数据的影响、回滚方式。
- 未确认前不执行破坏性迁移（drop、重命名、清表）。

### 7. 验证门禁

- 完成后运行仓库已配置的验证链：类型检查与构建（`npm run build:api` / `npm run build:web`）、测试（`npm test`）、受影响模块的集成/冒烟测试（如 `npm run test:integration:postgres`）。
- 当前仓库未配置 ESLint/Prettier（无 lint 脚本与配置文件，见根目录 `package.json`）；若引入 Lint，需保持零配置可启动。
- 未通过验证时不得声称任务已完成。
- 验证结果必须按 §11 RULE-15 的五个词如实标记（`PASS` / `FAIL` / `SKIPPED` / `BLOCKED` / `UNVERIFIED`），禁止把未运行或未验证的门禁报成 `PASS`。
- 门禁不可执行时按 §11 RULE-04 使用替代门禁并显式标记；完整门禁目录见 `docs/development/verification-gates.md`。

### 8. 汇报

- 汇报内容：修改文件、验证结果（附命令与输出摘要）、遗留风险、下一步建议。
- 修改范围、影响、风险须在动手前向用户说明。

### 9. Git

- 不自动提交、不自动推送、不自动创建分支；Git 写操作仅在用户明确要求时执行。

### 10. 状态入口

- 所有 Agent 开始工作前必须读取 `docs/current-sprint.md`（项目唯一常青状态入口：当前阶段、进行中任务、在途文件归属、地雷清单）。完成一个阶段后由当值 Agent 更新该文件。

## §11 Development Protocol Red Lines

本节是硬规则摘要（不可协商）。**详细流程**见 `docs/development/development-protocol.md`；**门禁目录**见 `docs/development/verification-gates.md`；**语义契约**见 `docs/development/score-mastery-evidence-semantics.md` 与 `docs/development/observed-derived-proxy.md`。

### RULE-01 三段门禁

任何重要的开发任务必须依次经过：

```
Read-only Audit → Design Gate → TDD RED → GREEN
→ Integration → Real E2E → Regression → Verification
```

禁止跳过 Read-only Audit 直接设计，禁止跳过 Design Gate 直接编码。仅只读审计或纯文档任务可只走其适用阶段。

### RULE-02 禁止篡改证据

禁止：

- 修改测试断言来凑绿；
- 弱化、删除或跳过既有断言；
- 修改 shared engine 来绕过问题；
- 为了让测试通过而改变被测行为。

测试失败时必须先定位语义，再决定是"修复实现"还是"有理由地更新断言"——后者必须在报告中单列。

### RULE-03 真实 E2E

涉及 database / cross-module / auth / production semantics 的改动，必须有**真实 PostgreSQL + 真实 HTTP** 的端到端证据，且至少包含一条**拒绝路径**断言（401/403、ownership、幂等、重复提交）。

桩服务（stub）测试、内存回退、仅断言"路由由 404 变 401"均**不构成**业务行为的 E2E 证据。

### RULE-04 替代门禁必须标记

沙箱替代门禁（如 `EPERM` 环境下逐文件 `node --test`、`tsc --noEmit`）只在**环境原因**导致真实门禁不可执行时允许使用，且必须：

- 在报告中显式标记 `SUBSTITUTE GATE`；
- 写明替代命令；
- 写明因此**丢失的覆盖维度**。

禁止用替代门禁冒充真实 E2E，禁止以替代门禁支撑发布、部署或"已验证"结论。产品原因导致的失败是 `FAIL`，不是替代门禁。

### RULE-05 四类量级必须区分

任何数字必须属于且仅属于一类：

```
OBSERVED    直接测量/直接记录
DERIVED     由 OBSERVED 确定性推导
PROXY       估计或未标定模型输出
UNAVAILABLE 现有证据无法得到
```

禁止把 `PROXY` 当作 `OBSERVED`；禁止把多个 `PROXY` 组合后当作观测。

### RULE-06 null ≠ 0

未知数据不得伪造为零。禁止 `|| 默认值`、`?? 0`、`?? 0.75` 之类把"未知"变成"确定值"的回退。缺失证据的正确输出是 `null` + 显式原因。

"没有遥测"不得报成"0 次"；样本不足必须输出 `insufficient_data`。

### RULE-07 禁止跨层直接成立

以下推导禁止直接成立：

```
Activity   → Ability
Proxy      → Observed
Prediction → Outcome
Mastery    → Actual Score
```

### RULE-08 Score / Evidence / Mastery 语义隔离

三者的 canonical source 与唯一写方必须保持隔离，任何一层不得伪造另一层。详见 `docs/development/score-mastery-evidence-semantics.md`。

### RULE-09 禁止第二套 SoT

禁止新建第二套 Mastery SoT、Evidence Ledger、Task System 或 Recommendation Engine，除非 Owner 明确批准。

### RULE-10 verified content 不可伪造

禁止存在 `generated content → verified` 的自动升级路径。`verified` 必须经过规定的验证链与人工批准链，且必须可追溯到具名评审人与时间。

### RULE-11 禁止把 proxy 称为 Verified Score Gain

禁止把下列输出称为 `Verified Score Gain`：expected score、expected benefit、recoverable score、transfer gap、model output、mastery gain、accuracy gain、predicted score，或它们的任意组合。

`Verified Score Gain / 30d` 目前**未实现**（PRIMARY 层校准样本 = 0），因此任何"提分"数字都不得声称已验证。

### RULE-12 Git 保护

禁止：

```
git add .
git add -A
git add -u
```

必须**按清单精确 `git add`**。禁止 `git reset --hard`、`git clean -fd`、`git checkout -- .`、`git restore .`。不得覆盖其他 Agent 或 Owner 的在途文件；无法归属的未跟踪文件一律不碰。

### RULE-13 生产边界

Agent 默认 **NO PRODUCTION DEPLOYMENT**。生产服务器操作由 Owner 执行，除非 Owner 明确批准。

必须严格区分，禁止混用：

```
CODE READY           代码与证据完成，未部署
DEPLOYMENT PENDING   等待 Owner 批准或执行
DEPLOYED             已观察到新代码在目标运行
DEPLOYED AND VERIFIED 外部观测确认目标行为符合预期
FAILED               部署尝试未成功
```

`CODE READY` 不得报成 `DEPLOYED`；`DEPLOYED` 不得报成 `DEPLOYED AND VERIFIED`。

### RULE-14 Owner Decision / STOP 是合法终态

遇到以下事项不得擅自决策，必须 STOP 并上报：

- schema 扩展或变更；
- 破坏性迁移（drop / rename / truncate）；
- Score / Mastery / Evidence 语义变更；
- 生产行为或 feature flag 变更；
- 排序货币切换（如 priority → ROI）；
- 新建第二套 SoT；
- 超出任务范围的范围扩张；
- 归档可能属于其他 Agent 的活跃工作；
- 两条有效规范存在无法调和的产品语义冲突（治理冲突）。

STOP 上报格式：

```
STOP CONDITION
Evidence:
Risk:
Decision Required:
```

STOP 之后的正确终态是 `BLOCKED` 或 `PARTIAL`，不是"猜测 Owner 意图后继续"。

### RULE-15 验证报告必须如实标记

每个门禁只能标：

```
PASS       已运行且符合预期
FAIL       已运行且不符合预期
SKIPPED    有意未运行，必须给原因
BLOCKED    无法运行，必须给具体阻塞条件
UNVERIFIED 完全未检查
```

禁止 `SKIPPED → PASS`、`BLOCKED → PASS`、`UNVERIFIED → PASS`。

### RULE-16 状态账本维护

阶段完成后必须更新 `docs/current-sprint.md`，但**只更新当前状态**，不得把全部历史重复写入当前摘要。

职责边界：

> `AGENTS.md` = HOW（规则）
> `docs/current-sprint.md` = WHERE / STATUS（状态）

## Agent Startup Contract

每个新 Agent / 新会话接管项目时，必须按顺序读取：

1. `AGENTS.md`（本文件）
2. `docs/current-sprint.md`
3. `docs/PROJECT_CONTEXT.md` 与 `docs/ARCHITECTURE.md`（架构与技术地图）
4. 与当前任务直接相关的 architecture / design 文档
5. 涉及开发流程 → `docs/development/development-protocol.md`
6. 涉及验证 → `docs/development/verification-gates.md`
7. 涉及 Score / Mastery / Evidence → `docs/development/score-mastery-evidence-semantics.md` 与 `docs/development/observed-derived-proxy.md`

然后在首次工作报告中输出（**只报告本任务实际适用的规范与边界，不复述全部规则**）：

```
PROTOCOL CHECK

AGENTS.md: READ
current-sprint.md: READ

Applicable Protocols:
- ...

Current Branch:
Current HEAD:
Working Tree:

Current Milestone:
Allowed Scope:
Forbidden Scope:

Required Gates:
STOP Conditions:
```

### 唯一入口约束

根目录 `AGENTS.md` 是**唯一** Agent 总规范入口。禁止新增 `agent.md`、`agents.md`、`CODEX.md`、`PROJECT_AGENT.md`、`AGENT_RULES.md` 等竞争入口，除非 Owner 明确批准。

`CLAUDE.md` 是 Claude Code 的**架构 / 技术地图**，不是第二套规则；与 `AGENTS.md` 冲突时以 `AGENTS.md` 为准。

## Open-source reference check before coding

Before writing or modifying code in this repository, perform a lightweight open-source reference check.

Required workflow:

1. Search 2-4 similar open-source projects, official examples, or mature documentation sources for the feature or fix being implemented.
2. Summarize the useful patterns, such as API shape, data model, UI flow, edge cases, and testing approach.
3. Do not copy source code directly. Re-implement the idea in this project's architecture.
4. If no useful reference is found, state that explicitly before coding.
5. In the final handoff, briefly mention the reference direction and how it influenced the implementation.

This applies to new features, behavior changes, bug fixes, scripts, deployment workflow changes, account/auth changes, question-bank import changes, and other code-affecting work.

Pure read-only investigation, status reporting, running existing commands, or documentation-only edits do not require this check.

For the longer checklist, see `docs/development/open-source-reference-check.md`.
For a short pre-coding checklist, see `docs/development/pre-coding-checklist.md`.

## 常用验证命令

- 测试：`npm test`（先构建 shared，再跑 node:test）
- 本地全量检查：`npm run check:local`
- 构建与类型检查：`npm run build:api` / `npm run build:web`
- PostgreSQL 集成测试：`npm run test:integration:postgres`（测试库见 `compose.test.yml`）
- 环境校验：`npm run validate:env:development`
- 文档更新类任务无需开源参考检查，但仍须遵守第 1、2、9 节。
