# Knowledge Catalog Engine（P0-2）Implementation Plan

> **For agentic workers:** Follow the repo workflow: read the design spec, get the user's option choice at Gate 0, then implement TDD task-by-task.

**Goal:** 让经典学习闭环以全量 408 知识目录为准（或与今日提分引擎统一口径），消除 16 粗粒度点与 1149 原子点割裂。

**Architecture:** 复用既有 `KnowledgeNode`/`KnowledgePointNodeMap`/`QuestionKnowledgeNodeTag` 表；经典闭环计算来源保持 `KnowledgePoint`（方案 B）或切换 `KnowledgeNode`（方案 A/C）；命名与展示统一解析目录。

**Tech Stack:** NestJS + Prisma + shared 纯函数 + node:test；脚本沿用 `scripts/seed-408-v2.mjs` 模式。

## Global Constraints

- 先读 `docs/PROJECT_CONTEXT.md`、`docs/ARCHITECTURE.md`、`docs/superpowers/specs/2026-08-14-knowledge-catalog-engine-design.md`。
- 方案选择必须先经用户确认（Gate 0）；禁止未经确认的大规模重构与破坏性迁移。
- 使用 TDD：先写 RED 测试再改行为。
- 不改判题/错因/计划算法；不破坏现有 API 路由与响应结构；新增字段向后兼容。
- 不自动 git add/commit/push（等用户批准）。

## Gate 0：方案确认（必须先完成）

- [ ] 向用户呈现方案 A/B/C（设计文档第 3 节），推荐 B，等用户确认后再进入任务 1。

## Task 1：桥接映射数据与脚本（方案 B 前置）

- [ ] 设计 `data/408/knowledge-point-node-map.json`（16 粗粒度点 → PRIMARY 原子点映射，含 confidence）。
- [ ] 新增 `scripts/seed-knowledge-point-map.mjs`：幂等填充 `KnowledgePointNodeMap`（并验证目标节点存在）。
- [ ] RED：`test/knowledge-point-node-map.test.js` 契约测试（脚本存在、读映射文件、PRIMARY 目标均为 KnowledgeNode）。
- [ ] GREEN：实现脚本。
- [ ] 验证：`node scripts/seed-knowledge-point-map.mjs --dry-run`；集成脚本断言映射行数与目标节点存在。

## Task 2：经典闭环命名解析到目录（方案 B）

- [ ] RED：`packages/shared` 新增纯函数 `resolveKnowledgePointDisplay`（id → 目录标题/章节，无映射时回退原值）。
- [ ] GREEN：实现纯函数 + 单测（字面量断言）。
- [ ] 接线：`StudyService.getMasteryMap`/`computeWeaknessReport`/错题详情/推荐题组的命名经解析函数输出。
- [ ] 回归：掌握度/薄弱/错题相关测试全绿。

## Task 3：验证与文档

- [ ] `npm test` 全量；`npm run build:web`；`test:integration:postgres`（含映射断言）。
- [ ] 更新 `docs/PROJECT_CONTEXT.md`/`docs/ARCHITECTURE.md`/`docs/ROADMAP.md`（P0-2 状态、P2-2 收敛情况）。
- [ ] 汇报并申请提交/推送批准。

## Task 4（可选，方案 C 前置调研）

- [ ] 评估 `UserKnowledgeMastery` 作为唯一口径的迁移方案与回填脚本，单独设计文档。
