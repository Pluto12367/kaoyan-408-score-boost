# V3 产品重构执行计划（Sprint 0 基线）

> 状态：已冻结（Sprint 0，仅文档）
> 分支：`feature/v3-product-refactor`
> 冻结基线：V2 baseline（8 个一级导航，详见迁移地图）
> 本文件是 V3 重构的单一执行计划来源。配套文档：`docs/v3-acceptance.md`、`docs/v3-migration-map.md`。

---

## 1. V3 产品定位

AI 驱动的 408 自适应学习闭环系统。

核心闭环：

```
诊断/理解学生状态
→ 决定下一步
→ 学习
→ 训练
→ 错误恢复
→ 掌握验证
→ 更新学生状态
→ 自动生成下一任务
```

## 2. 核心产品原则

1. 首页 = 今日学习驾驶舱，而不是 Dashboard
2. 题库 = 训练工作台，而不是简单题目仓库
3. 知识 = 我的知识能力中心，而不是知识百科
4. 错题 = 错误恢复中心，而不是错题列表
5. 测试 = 阶段能力诊断中心，而不是单纯考试页面
6. AI = 上下文能力层（Contextual AI Coach），而不是独立聊天页面
7. 一级导航最多 5 个
8. 默认只展示最重要的信息，采用分层信息架构
9. 所有模块共享统一 Student State
10. 不为了增加功能而增加功能

## 3. V3 目标架构

### 3.1 导航收敛（8 → 5）

| V3 导航 | 合并来源（V2） | 定位 |
|---|---|---|
| 首页 | dashboard + plan + score-center | 今日学习驾驶舱：今日任务、下一步行动、折叠式状态摘要 |
| 题库 | question + practice | 训练工作台：针对性训练、即时反馈、内嵌 AI 教练 |
| 知识 | knowledge-catalog | 我的知识能力中心：掌握状态 + 闯关 + 真题证据 |
| 错题 | wrong-book + review | 错误恢复中心：错误恢复、间隔复习、变式验证 |
| 测试 | report + exam + assessment | 阶段能力诊断中心：诊断、报告、结果反哺学习 |

AI（原 `ai` 导航）移出一级导航，转为 Contextual AI Coach 嵌入：
- 题库：答题后讲解、相似题推荐
- 错题：复盘引导、错因追问
- 测试：考后分析、下一阶段建议
- 知识：概念追问

### 3.2 架构原则

1. **一个 Student State**：唯一真相源为 Prisma `UserKnowledgeMastery` + `PracticeRecord` + `StudyTask` + `UserEvent`。
2. **一个 Mastery Engine**：唯一实现 `packages/shared/src/score-center/mastery.ts`（EWMA 更新）+ `nodeMastery.ts`（展示层）。
3. **一个 Recommendation Engine**：`packages/shared/src/score-center/priority.ts` + `plan.ts` 为唯一推荐入口。
4. **一个学习闭环控制器**：负责「行为事件 → 更新状态 → 生成下一任务」。

### 3.3 分层信息架构（首页默认视图）

- L1 今日任务（唯一默认展示）
- L2 下一步行动（AI 建议 + 理由，抽屉展开）
- L3 状态摘要（掌握度、趋势、统计，全部折叠）

## 4. 前端重构计划

### 4.1 页面迁移

| V2 页面 | V3 去向 | 说明 |
|---|---|---|
| `dashboard` / StudentLearningConsole | 首页 | 重排：顶部今日任务，中部下一步行动，底部折叠摘要 |
| `plan` / TodayPlan、StudyPlanOverview | 首页 | TodayPlan 组件整体迁入首页顶部 |
| `score-center` / TodaysScoreCenter | 首页 | 推荐卡片作为「今日任务」数据源，WhyRecommendedDrawer 作为首页抽屉 |
| `question` / PracticePanel | 题库 | 吸收 TutorPanel 为答题后内嵌 AI 教练 |
| `knowledge-catalog` / KnowledgeCatalog | 知识 | 保留 |
| `wrong-book` / MistakeWorkspace | 错题 | 吸收 AI 复盘引导 |
| `report` / ReportWorkspace | 测试 | 收敛为考后报告抽屉 |
| `ai` / TutorPanel | 组件化 | ContextualCoach，嵌入题库/错题/测试/知识 |

### 4.2 路由与导航调整

- `apps/web/src/layouts/RoleNavigation.tsx`：studentItems 收敛为 5 项；删除 `ai`。
- `apps/web/src/layouts/RoleLayouts.tsx`：同步。
- `apps/web/src/features/student/StudentSections.tsx`：删除 `plan` / `score-center` / `ai` 分支；新增 `test` 分支。
- `apps/web/src/App.tsx`：状态与事件接线调整。
- 新增 `apps/web/src/features/test/TestSection.tsx`（测试中心容器）。

### 4.3 组件调整

- 新增 `apps/web/src/components/ContextualCoach.tsx`（通用 AI 教练容器）。
- 删除 `TutorPanel` 独立页面壳，保留内层逻辑。
- 删除首页重复信息区块（LearningProfileCard 中与 Report 面板重复的 insight）。

## 5. 后端重构计划

### 5.1 Service 职责调整

| 现状 | 目标 |
|---|---|
| `study/study.service.ts`（4661 行单体，含多套重复计算） | 仅保留：今日计划 + 任务编排 + 学习闭环控制器；删除重复的掌握度/推荐/错题统计实现 |
| `score-center/service.ts`（applyAttempts / applyReview） | 升级为唯一 Student State 写入方 |
| 新增闭环控制器 | 提交答题 → 写 PracticeRecord → 更新 UserKnowledgeMastery → 检查任务达标 → 生成下一任务 |

### 5.2 API 调整

- 删除前端不再调用的 `/trial-progress`、`/study-reminders`、`/sprint-plan` 冗余聚合（或降级为首页折叠数据）。
- `/today/plan` 与 score-center 计划合并为单一「今日任务」数据源。
- 新增统一完成入口（复用 `completeStudyTask` 语义）：活动完成 → 更新状态 → 生成下一任务。
- `GET /dashboard/overview` 精简 payload。

### 5.3 数据流

```
答题提交(PracticeRecord)
  → 闭环控制器
  → applyAttempts（UserKnowledgeMastery 原子更新 + UserMasterySnapshot 快照）
  → 若答错：touchWrongQuestion + ReviewSchedule 排期
  → 任务进度累计（StudyTask）
  → 达标后 composeDailyPlan 生成次日任务（StudyTask）
  → 前端首页自动刷新（单次 /today/plan 拉取）
```

## 6. 数据模型调整

### 6.1 StudentState（唯一真相源）

- `UserKnowledgeMastery`：mastery / accuracy / recentAccuracy / attempts / retention / stabilityDays / nextReviewAt / confidence
- `PracticeRecord`：行为事实
- `StudyTask`：任务与进度
- `UserEvent`：行为事件流（type：attempt / review / task_complete / assessment）
- 前端删除 `mockData.ts` / `api/mocks/dashboard.ts` 内存态。

### 6.2 KnowledgeState

- `KnowledgeNode`（原子节点）+ `ExamQuestionKnowledgeTag`（真题证据）+ `KnowledgePointNodeMap`（桥接）保持不变。
- 知识页掌握状态唯一取自 `getMyMastery` / `getKnowledgeDetail`。

### 6.3 MasteryEngine

- 唯一实现：`score-center/mastery.ts`（`updateMasteryAfterAttempt` / `updateStabilityAfterReview` / `estimateRetention`）。
- 唯一展示层：`nodeMastery.ts`（`buildNodeMasteryMap` / `buildMasteryTrend` / `deriveNodeWeakPoints`）。
- 废弃：`learning.ts` 的 `computeMasteryReport` 及其调用链、`study.service.ts` `getMasteryMap` 非 node 分支。

## 7. Sprint 计划

### Sprint 0：准备（本次）
- 目标：基线冻结、文档化。
- 交付：本计划 + `v3-acceptance.md` + `v3-migration-map.md`。
- 验收：无业务代码改动；分支可构建；文档通过评审。

### Sprint 1：导航和页面收敛
- 目标：学生端 8 导航 → 5 导航；首页合并 dashboard + plan + score-center；移除 ai 一级导航。
- 文件：`RoleNavigation.tsx`、`RoleLayouts.tsx`、`StudentSections.tsx`、`App.tsx`、新增 `TestSection.tsx`。
- 风险：中。移除导航后旧入口失效，须保证信息不丢失。
- 验收：见 `docs/v3-acceptance.md` A 部分。

### Sprint 2：StudentState 统一
- 目标：前后端唯一 Student State；删除内存态重复数据。
- 文件：`apps/web/src/mockData.ts`、`apps/web/src/api/mocks/dashboard.ts`、`useStudentProgressData.ts`、`study.service.ts` 相关聚合、`score-center/service.ts`。
- 风险：高。状态来源切换影响所有页面数据。

### Sprint 3：学习闭环打通
- 目标：答题 → 更新掌握度 → 生成下一任务全自动。
- 文件：`study.service.ts`（createPracticeRecord / completeStudyTask）、`score-center/service.ts`（applyAttempts 扩展）、新增闭环控制器、`apps/web/src/api/endpoints/score-center.ts`。
- 风险：高。闭环写放大，需事务与幂等。

### Sprint 4：AI Context 集成
- 目标：Contextual AI Coach 嵌入题库/错题/测试/知识。
- 文件：`TutorPanel.tsx`（→ ContextualCoach）、`PracticePanel.tsx`、`MistakeWorkspace.tsx`、`TestSection.tsx`、`KnowledgePointDetailDrawer.tsx`。
- 风险：低。前端集成为主，后端 `ai-tutor.service.ts` 复用。

## 8. 保留 / 迁移 / 废弃（汇总）

### 保留
- `prisma/schema.prisma` 全部核心模型。
- `packages/shared/src/score-center/*`、`nodeMastery.ts`、`knowledgeCatalog.ts`、`ai-tutor.ts`。
- `apps/api/src/score-center/*`、`questions/*`（含题库导入）、`auth/*`。
- `apps/web/src/features/knowledge-catalog/*`、`TodayPlan.tsx`、`ExamSession.tsx`、`MistakeWorkspace.tsx`、`PracticePanel.tsx` 内层逻辑。

### 迁移
- `learning.ts` 掌握度公式 → `score-center/mastery.ts` + `nodeMastery.ts`。
- `study.service.ts` 内存态统计 → Prisma + UserKnowledgeMastery。
- `TutorPanel` → `ContextualCoach`。
- `TodaysScoreCenter` 推荐展示 → 首页今日任务数据源。

### 废弃
- `apps/web/src/mockData.ts`、`apps/web/src/api/mocks/dashboard.ts`。
- 前端 `ai` 导航项与 `TutorPanel` 独立页面壳。
- `study.service.ts` 重复计算分支、`/trial-progress`、`/study-reminders`、`/sprint-plan` 冗余聚合。
- 首页重复信息区块。

## 9. 约束

- 每个 Sprint 独立可合并、可回滚。
- 不删除数据库模型；模型迁移只做字段/索引扩展，不做破坏性变更。
- 每个 Sprint 完成后必须通过 `npm run build:shared && npm run build:api && npm run build:web`。
