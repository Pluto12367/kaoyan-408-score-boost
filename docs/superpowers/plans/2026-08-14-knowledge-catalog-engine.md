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

- [x] 向用户呈现方案 A/B/C（设计文档第 3 节），用户已确认方案 B（2026-08-14）。

## Task 1：桥接映射数据与脚本（方案 B 前置）

- [x] 设计 `data/408/knowledge-point-node-map.json`（16 粗粒度点 → PRIMARY 原子点映射，含 confidence）。
- [x] 新增 `scripts/seed-knowledge-point-map.mjs`：幂等填充 `KnowledgePointNodeMap`（并验证目标节点存在）。
- [x] RED：`test/knowledge-point-node-map.test.js` 契约测试（脚本存在、读映射文件、PRIMARY 目标均为 KnowledgeNode）。
- [x] GREEN：实现脚本。
- [x] 验证：`node scripts/seed-knowledge-point-map.mjs --dry-run`；集成脚本断言映射行数与目标节点存在。

## Task 2：经典闭环命名解析到目录（方案 B）

- [x] RED：`packages/shared` 新增纯函数 `resolveKnowledgePointDisplay`（id → 目录标题/章节，无映射时回退原值）。
- [x] GREEN：实现纯函数 + 单测（字面量断言）。
- [x] 接线：`StudyService.getMasteryMap`/`getOverviewReport`（薄弱/速度风险）/`listWrongQuestions` 的命名经解析函数输出。
- [x] 回归：掌握度/薄弱/错题相关测试全绿。

## Task 3：验证与文档

- [x] `npm test` 全量；`npm run build:web`；`test:integration:postgres`（含映射断言）。
- [x] 更新 `docs/PROJECT_CONTEXT.md`/`docs/ARCHITECTURE.md`/`docs/ROADMAP.md`（P0-2 状态、P2-2 收敛情况）。
- [x] 汇报并申请提交/推送批准。

## Task 4（可选，方案 C 前置调研）

- [x] 评估 `UserKnowledgeMastery` 作为唯一口径的迁移方案与回填脚本，单独设计文档（`docs/superpowers/specs/2026-08-14-knowledge-catalog-engine-option-c.md`，2026-08-14）。
- [x] Phase 1 数据层：归因 dry-run + 回填脚本 + 集成测试（`scripts/backfill-user-mastery.mjs` + 集成回归，已随阶段 0 完成）。

## Task 5（阶段 1）：知识图谱掌握度着色

- [x] RED：`test/node-mastery-status.test.js`（`deriveNodeMasteryStatus` 状态映射）、`test/knowledge-graph-mastery.test.js`（后端端点/服务、共享导出、前端接线契约）。
- [x] GREEN：`packages/shared/src/score-center/mastery.ts` 新增 `deriveNodeMasteryStatus`（untouched/weak/review/mastered）。
- [x] GREEN：`apps/api/src/score-center/service.ts` 新增 `getMyMastery`；`routes.ts` 新增 `GET /knowledge/mastery`（student/teacher/admin，置于 `knowledge/:id` 之前）。
- [x] GREEN：`apps/web/src/api/endpoints/score-center.ts` 新增 `fetchMyMastery` + `NodeMasterySummary`。
- [x] GREEN：`KnowledgeCatalog.tsx` 加载掌握度 → `masteryById` → 传树与抽屉；`KnowledgeTree.tsx` 行着色 + 状态徽章；`KnowledgePointDetailDrawer.tsx` “我的掌握度” + “去练习”；`App.tsx` 传 `onNavigate`。
- [x] 行为级断言：`scripts/integration-postgres.mjs` 增加 `GET /knowledge/mastery` 返回练习节点统计与派生状态。
- [x] 验证：`npm test` 537 项 536 通过 / 1 跳过；`build:api`/`build:web` 通过；`test:integration:postgres`、`test:integration:content-import` 通过。
