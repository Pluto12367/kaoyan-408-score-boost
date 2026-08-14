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

## Task 6（阶段 2）：图谱掌握度驱动掌握度地图/薄弱报告/推荐（方案 C 只读切换）

- [x] RED：`test/node-mastery-map.test.js`（`deriveNodeWeakPoints`/`buildNodeMasteryMap` 行为）、`test/node-mastery-read-switch.test.js`（开关与接线契约）。
- [x] GREEN：`packages/shared/src/nodeMastery.ts` 新增节点掌握度聚合纯函数（掌握度地图形状与旧 `MasteryMap` 兼容、薄弱点推导）。
- [x] GREEN：`apps/api/src/score-center/repository.ts` 新增 `loadActiveAtomicNodeCatalog`（原子点 + 父链章节）。
- [x] GREEN：`apps/api/src/study/study.service.ts` 新增 `USE_KNODE_MASTERY` 只读开关（DB 模式生效，默认关闭）：启动时构建节点目录/题目归因/掌握度缓存，写入后刷新；`getMasteryMap`/`getOverviewReport(weakPoints)`/`getRecommendedPracticeSet` 切换到节点口径（推荐按节点归因过滤题目，无匹配回退旧口径）。
- [x] 行为级断言：`scripts/integration-postgres.mjs` 灰度重启后断言 `/mastery-map` 含弱节点（weak/review 状态）、`/dashboard/overview` 薄弱点由节点掌握度推导、`/practice-sets/recommended` 按节点归因返回题目。
- [x] 验证：`npm test` 544 项 543 通过 / 1 跳过；`build:api`/`build:web` 通过；`test:integration:postgres`、`test:integration:content-import` 通过。
- 说明：计划语义迁移（Onboarding 七天计划/StudyTask 统一 `knowledgeNodeId`）属 Phase 2b，按设计单独评审，不在本阶段。

## Task 7（阶段 3）：题库图谱化 + 真题接入

- [x] RED：`test/question-node-linker.test.js`（linker 纯函数行为）、`test/knowledge-detail-graph-links.test.js`（知识详情/抽屉/App 接线契约）。
- [x] GREEN：`scripts/link-question-bank-to-nodes.mjs`——按确定性链（直连标签优先 → `QuestionKnowledgePoint → KnowledgePointNodeMap PRIMARY`）为全部 live 题目物化 `QuestionKnowledgeNodeTag`（`source='bridge:knowledge-point-map'`），`--dry-run` 审计覆盖率，<70% 阻断写入（Bridge Rollout Gate），幂等。
- [x] GREEN：`GET /knowledge/:id` 扩展 `relatedQuestions`（该节点关联题库题，最多 20 条）与 `examQuestions`（真题命中，含年份/题号/题型/分值/摘要/来源链接，最多 10 条），响应向后兼容。
- [x] GREEN：图谱详情抽屉新增“考点题库（N 题）”列表（每题可“练习本题”）与“真题命中”列表（真题来源新窗口打开）；App 经 `onPracticeQuestion` 复用既有重做流程启动练习。
- [x] 行为级断言：`integration-postgres`（知识详情返回关联题 + 真题命中）、`integration-content-import`（seed 原子目录+映射后 linker 覆盖率=1、320 条标签、幂等、详情含关联题与真题）。
- [x] 验证：`npm test` 551 项 550 通过 / 1 跳过；`build:api`/`build:web` 通过；`test:integration:postgres`、`test:integration:content-import` 通过。

## Task 8（阶段 4）：报告图谱化（掌握度趋势）

- [x] RED：`test/mastery-trend.test.js`（`buildMasteryTrend` 整体/分科/提升/下滑）、`test/mastery-trend-wiring.test.js`（端点/快照写入/schema/前端面板契约）。
- [x] GREEN：新增 `UserMasterySnapshot` 表（用户×节点×日唯一）+ additive 迁移；`applyAttempts`/`applyReview` 写掌握度时同步 upsert 每日快照；回填脚本重放历史记录时重建历史快照（幂等）。
- [x] GREEN：`GET /mastery-trend?days=N`（1..90，默认 14）返回整体/分科序列、分科最弱节点、提升最快/需要关注 delta；无库模式返回空结构。
- [x] GREEN：前端报告“四科掌握度”页新增“掌握度趋势”面板（柱状趋势、最弱节点、提升/下滑列表；静态演示模式提示不展示）。
- [x] 行为级断言：`integration-postgres`（练习写快照、趋势端点含整体序列与最弱节点、回填重建快照且幂等）。
- [x] 验证：`npm test` 556 项 555 通过 / 1 跳过；`build:api`/`build:web` 通过；`test:integration:postgres`、`test:integration:content-import` 通过。

## Task 9（阶段 5）：收敛工程化

- [x] 旧口径冻结：`USE_KNODE_MASTERY=true` 时启动日志明确 `legacy mastery read path frozen`，掌握度地图/薄弱/推荐不再走内存旧口径。
- [x] 多实例/性能：节点掌握度只读缓存 60s TTL 自动刷新（`ensureNodeMasteryFresh`/`reloadNodeMasteries`），多实例最终一致；快照表带唯一/索引。
- [x] 无障碍：图谱科目标签 `aria-controls`、章节/小节行 `aria-expanded`、趋势柱状图 `role=img + aria-label`。
- [x] HTTPS：新增 `deploy/tencent-ip/nginx-https.conf.example`（443 ssl + 80 重定向 + 证书挂载说明），部署文档第 9 节补 Certbot 签发/续期步骤。
- [x] 运行手册：新增 `docs/operations/mastery-graph-convergence-runbook.md`（阶段 0→5 生产上线顺序：部署→清重→回填→linker→灰度开关→验收→边界）。
- [x] 验证：`npm test` 560 项 559 通过 / 1 跳过；`build:api`/`build:web` 通过；`test:integration:postgres` 通过。
