# Project agent instructions

## 核心规则（所有 AI 编程代理必须遵守）

### 1. 事实来源

- 以当前仓库的实际代码、配置文件、Prisma Schema、迁移、Git 历史与测试为唯一事实来源；不依赖历史聊天记录或口头描述。
- 文档与代码冲突时以代码为准，并在汇报中记录差异。
- 任何"我记得/可能/曾经考虑过"的结论，必须先 grep 或读文件验证，再写入文档或代码。

### 2. 修改前必读

- 首次进入本仓库或跨模块修改前，必须阅读 `docs/PROJECT_CONTEXT.md` 与 `docs/ARCHITECTURE.md`。
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

### 8. 汇报

- 汇报内容：修改文件、验证结果（附命令与输出摘要）、遗留风险、下一步建议。
- 修改范围、影响、风险须在动手前向用户说明。

### 9. Git

- 不自动提交、不自动推送、不自动创建分支；Git 写操作仅在用户明确要求时执行。

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
