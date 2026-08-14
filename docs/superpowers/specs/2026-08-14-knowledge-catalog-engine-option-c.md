# 方案 C 调研：以 UserKnowledgeMastery 为唯一掌握度源

> 状态：调研/设计 + Phase 1（数据回填）、Phase 2（只读切换）、Phase 2b（计划语义迁移到 `knowledgeNodeId`）已实施（2026-08-14）。配套计划见 `docs/superpowers/plans/2026-08-14-knowledge-catalog-engine.md` Task 4-10。

## 1. 背景与目标

当前系统存在两套掌握度口径（P2-2）：

- **经典闭环**：`StudyService` 内存计算（`computeMasteryReport` / `computeWeaknessReport` / `buildStudyPlan`），以 16 个粗粒度 `KnowledgePoint` + `PracticeRecord` 为输入，实时推导。
- **今日提分（score-center）**：`UserKnowledgeMastery` 表按 `KnowledgeNode`（1149 原子点）持久化掌握度，由 `ScoreCenterService.applyAttempts`/`applyReview` 更新，驱动 `generateDailyPlan`。

方案 B（已上线）用 `KnowledgePointNodeMap` 统一了**对外命名/展示**；方案 C 的目标是统一**计算口径**：`UserKnowledgeMastery` 成为唯一掌握度来源，经典闭环的掌握度地图、薄弱报告、推荐、计划全部消费它，关闭 P2-2。

## 2. 现状事实核对（以代码为准）

- `UserKnowledgeMastery` 字段：mastery / accuracy / recentAccuracy / attempts / correctCount / wrongCount / retention / stabilityDays / lastLearnedAt / lastReviewedAt / nextReviewAt / confidence / pinned（`prisma/schema.prisma`）。
- 写入点：`applyAttempts`（单题 `POST /practice-records` 与会话提交时，经 `ScoreCenterService.applyAttempts(userId, records, tx)` 调用）、`applyReview`（错题复盘）、`completeTask`（仅任务状态）。`applyAttempts` 逐题：解析题目→知识点节点 → `updateMasteryAfterAttempt`（EMA：PRIMARY α=0.18 / SECONDARY α=0.07；含 accuracy/recentAccuracy/confidence）。
- 归因链（`resolveKnowledgeNodesForQuestion`）：`QuestionKnowledgeNodeTag` 直连（真题标签，756 条）优先；否则 `QuestionKnowledgePoint → KnowledgePoint → KnowledgePointNodeMap`（方案 B 的 16 条 PRIMARY 映射）兜底。**starter-320 题可归因**。
- 缺口：**历史 `PracticeRecord`（桥接上线前）从未重放进 `UserKnowledgeMastery`**；线上该表行数极少，回填是方案 C 的前置。
- 经典闭环仍从 `this.records` 内存实时计算；`extrasByPoint`（任务完成度/错题）也会并入掌握度。

## 3. 目标口径定义

- **唯一掌握度**：`UserKnowledgeMastery.mastery`（节点级，0..1），聚合到科目/章节用于展示。
- **状态派生**：节点状态（未掌握/复习中/已掌握）由 mastery + confidence + retention 派生（对齐 score-center 现有逻辑），替代 `computeMasteryReport` 的窗口正确率状态。
- **辅助指标**：错因统计、用时/速度风险仍来自 `PracticeRecord`（不是掌握度源，不并入 C 范围）。
- **计划/推荐**：优先消费节点掌握度 + 频率证据（复用 `calculatePriority`/`composeDailyPlan` 思路），题目过滤按节点归因。

## 4. 数据归因与回填（Phase 1）

### 4.1 归因链（实施时复用）

`PracticeRecord.questionId → QuestionKnowledgeNodeTag（PRIMARY/SECONDARY）`，无标签时 `→ QuestionKnowledgePoint → KnowledgePoint → KnowledgePointNodeMap（PRIMARY）`。

### 4.2 回填脚本（新增 `scripts/backfill-user-mastery.mjs`）

- 按用户、按 `submittedAt` 顺序重放全部 `PracticeRecord` 到 `UserKnowledgeMastery`（同一归因与 `updateMasteryAfterAttempt` 逻辑）。
- 幂等策略：记录 `lastReplayedAt`（SystemConfig 或按用户节点重置后全量重放）；重放前先删除该用户全部 `UserKnowledgeMastery` 行再重建，避免重复累加。
- `--dry-run` 输出可归因记录比例与缺失原因（无标签且无映射的题目列表）。
- 集成测试：回填后每节点 attempts/correctCount 与 PracticeRecord 推导一致；重跑幂等。

## 5. 读取切换（Phase 2，灰度）

用环境开关（建议 `USE_KNODE_MASTERY=true`）控制，默认关闭，逐项灰度：

1. **掌握度地图** `getMasteryMap`：改读 `UserKnowledgeMastery`（节点→掌握度/状态/置信度），按科目聚合 averageMastery/weak/review/mastered 计数；输出结构保持现有 `MasteryMap` 兼容（title/chapter 用节点名与父链，方案 B 已统一命名）。
2. **薄弱报告** `getOverviewReport`：`weakPoints` 由节点掌握度推导（mastery 低于阈值且 attempts>0），保留 `speedRisks`/错因统计来自 records；`WeaknessReport` 结构不变。
3. **推荐题组** `getRecommendedPracticeSet`：薄弱点/题目过滤按节点归因（题目 → 节点 → 掌握度）。
4. **计划** `generatePlan`/`buildStudyPlan`：输入改为节点掌握度+频率（复用 score-center 的 `calculatePriority` 思路）；`StudyTask` 的知识点字段建议统一为 `knowledgeNodeId`（与 score-center 计划一致），Onboarding 七天计划迁移放在 Phase 2b 单独评审。

无库/内存模式（`DATABASE_URL` 缺失）保留现有内存口径（C 仅 DB 模式生效）。

## 6. 影响与兼容

- API 响应结构不变；**数值会漂移**（EMA 掌握度 vs 窗口正确率）——提供“对比模式”：灰度期双算并存并记日志差异，抽样确认后再切换。
- 前端：掌握度地图/报告/推荐依赖的字段保持兼容；显示命名沿用方案 B 的目录解析。
- 计划任务 `knowledgePointId` 语义变化影响最大（今日任务、完成度、考后复习合并），故单独划为 Phase 2b。
- 数据稀疏：新用户节点无记录时使用 neutral（mastery 0.5），与 score-center 现状一致。

## 7. 风险与回滚

- **数值漂移与排序变化**：通过对比模式 + 抽样断言控制；回滚 = 关闭开关（读路径即时回到旧口径）。
- **回填幂等/并发**：单实例当前，按用户 advisory lock；回填脚本可重复执行。
- **历史记录归因缺失**：无标签且无映射的题目不会进入节点掌握度——dry-run 列出，评估后决定是否补标签。
- **回归面大**：掌握度/报告/推荐/计划全部走一遍 `npm test`、`test:integration:postgres`、前端浏览器审计。

## 8. 分阶段实施计划

- **Phase 1 数据层**：归因 dry-run 统计 + 回填脚本 + 集成测试（幂等、可归因率）。
- **Phase 2 只读切换（灰度）**：mastery map → weakness report → recommendations → plan（各步独立开关/对比）。
- **Phase 2b 计划语义**：Onboarding 七天计划与 `StudyTask` 迁移到 `knowledgeNodeId`（单独评审）。
- **Phase 3 收敛**：关闭旧内存掌握度路径，删除/冻结未用代码，P2-2 标记完成；性能优化（节点掌握度缓存）。

## 9. 验收标准

1. 同一考点在掌握度地图、薄弱报告、推荐题组、计划、错题/答题反馈中的**数值与命名一致**（抽样断言）。
2. 回填后各节点 `attempts/correctCount/accuracy` 与 `PracticeRecord` 推导一致；重跑幂等。
3. 对比模式灰度期：旧口径与新口径结论方向一致（无矛盾 TOP 薄弱点），差异有日志可查。
4. 无库/内存模式行为不变；`npm test`、`npm run build:api/build:web`、`test:integration:postgres` 全绿；线上浏览器审计无回归。

## 10. 与既有工作的关系

- 方案 B（`KnowledgePointNodeMap` + 显示解析）是 C 的**数据与命名基础**（归因兜底与目录名）。
- score-center 引擎（`updateMasteryAfterAttempt`/`calculatePriority`/`composeDailyPlan`）是 C 的**计算核心**，C 是把它从“今日提分”扩展到全闭环。
- 完成 C 后，P0-2 目标（经典闭环以全量知识目录为准）与 P2-2（两套口径）同时收敛。
