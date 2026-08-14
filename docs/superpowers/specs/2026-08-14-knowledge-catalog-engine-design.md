# 知识目录全量接入学习引擎（P0-2）设计

## 1. 背景与现状核实

ROADMAP P0-1（知识点目录接入学习引擎）已于 2026-08-05 标记完成：`KnowledgePointRepository` 接入 `StudyService`，DB 中的知识点目录参与掌握度/薄弱/推荐/计划计算，`POST /knowledge-points` 持久化，空库与已导入库两种启动顺序均已覆盖（集成测试验证）。

当前系统存在**两套掌握度/知识体系并存**：

| 体系 | 数据模型 | 用途 |
|---|---|---|
| 经典闭环 | `KnowledgePoint`（16 个粗粒度导入点；无库时内置 4 点兜底） | `getMasteryMap`、薄弱报告、推荐题组、学习计划、错题命名 |
| 目录/今日提分 | `KnowledgeNode`（`scripts/seed-408-v2.mjs` 种入 1149 原子点 + 关系 + 2022-2026 真题标签 + 频率快照）、`UserKnowledgeMastery` | 408 知识图谱、今日提分引擎（`StudyTask.knowledgeNodeId`） |

桥接与标签表 `KnowledgePointNodeMap`、`QuestionKnowledgeNodeTag` 已存在于 Prisma Schema，但经典闭环尚未使用。前端知识图谱页展示的 1149 原子点目录与经典闭环的 16 粗粒度点互不相通。

## 2. 目标

让经典学习闭环（掌握度地图、薄弱报告、推荐题组、学习计划、错题命名）以全量知识目录为准（或与今日提分引擎统一口径），消除“图谱看 1149 点、闭环算 16 点”的割裂。

## 3. 方案选项

### 方案 A：经典闭环切换到 KnowledgeNode 目录

`StudyService` 的掌握度/薄弱/推荐/计划改以 `KnowledgeNode` 目录为唯一来源；答题记录通过题目→知识点标签（`QuestionKnowledgeNodeTag` / `QuestionKnowledgePoint`）归因到原子点；`UserKnowledgeMastery` 作为持久化掌握度唯一口径。

- 影响：掌握度地图、薄弱报告、推荐、计划的行为与命名全部变化；前端需按章节/科目标题聚合 1149 点；历史 `PracticeRecord.knowledgePointId` 需迁移或实时映射；改造面大、需完整回归。

### 方案 B：保留两套体系，用 KnowledgePointNodeMap 桥接（推荐先做）

把 16 个粗粒度 `KnowledgePoint` 通过 `KnowledgePointNodeMap`（PRIMARY 映射）关联到目录原子点；经典闭环计算仍用 `KnowledgePoint`，但**对外命名与展示统一解析到目录节点**；`GET /knowledge-points` 与掌握度/薄弱/错题命名附带目录映射后的标题/章节。

- 影响：改造小、行为风险低、可独立验证；但两套口径在计算层面仍未合并（P2-2 保留为后续项）。
- 前置：需要教研确认 16 粗粒度点 → 目录节点的映射（一个粗粒度点可能对应多个原子点，选 PRIMARY 代表点）。

### 方案 C：以 UserKnowledgeMastery 为唯一掌握度源

经典闭环只消费 `UserKnowledgeMastery`（按 KnowledgeNode），`PracticeRecord` 归因到原子点后统一更新。

- 影响：架构最干净，但需要归因改造、历史掌握度回填、大范围行为验证；建议作为方案 B 验证后的后续阶段。

## 4. 数据与映射约定

- 目录：`data/408/knowledge-tree-408-v2.json`（节点 id 稳定，含 parentId/subject/nodeType/importance/difficulty/prerequisites）。
- 现有题目绑定：starter-320 CSV 绑定 16 粗粒度点（`QuestionKnowledgePoint`）；真题标签 `QuestionKnowledgeNodeTag` 精确到原子点。
- 桥接：`KnowledgePointNodeMap(knowledgePointId, knowledgeNodeId, mappingType, confidence)` 已存在，按 PRIMARY 映射填充。
- 迁移/回滚：方案 B 为纯增量（新增映射行），不修改既有行；回滚 = 删除映射行。

## 5. 验收标准（以方案 B 为例）

1. 每个 `KnowledgePoint` 在 `KnowledgePointNodeMap` 中至少一条 PRIMARY 映射，目标为 `KnowledgeNode` 原子点。
2. 经典闭环输出的掌握度、薄弱报告、推荐题组、错题命名与目录一致（经映射解析，不出现原始 id 或空标题）。
3. `seed-408-v2` 与映射填充脚本幂等；空库/已导入库两种启动顺序均可启动。
4. 前端掌握度地图与报告无空标题/重复标题，移动端无横向溢出。
5. `npm test`、`npm run build:web`、`test:integration:postgres` 全绿。

## 6. 非目标

- 不改判题、错因分类、计划生成算法本身。
- 不引入 AI 自动推荐。
- 不删除既有 `KnowledgePoint` 数据或 API 路由。

## 7. 风险

- 粗粒度点 → 原子点映射需要教研确认（16 点与 1149 点非一一对应）。
- 历史 `PracticeRecord.knowledgePointId` 指向粗粒度点，展示命名切换需映射兜底。
- 方案 C（统一口径）影响面大，需单独评审后实施。
