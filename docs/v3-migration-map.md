# V3 迁移地图（Sprint 0 基线）

> 本文档记录 V2 → V3 的完整迁移映射：
> - V2 页面 → V3 页面映射
> - V2 服务 → V3 服务映射
> - 旧数据模型 → 新数据模型迁移策略
>
> 所有路径均为审计时确认的真实路径。

---

## 1. V2 页面 → V3 页面映射

### 1.1 学生端一级导航（8 → 5）

| V2 导航 | V2 页面/组件（真实路径） | V3 导航 | V3 动作 | 说明 |
|---|---|---|---|---|
| dashboard（学习总览） | `apps/web/src/features/student/StudentLearningConsole.tsx`、`apps/web/src/features/dashboard/LearningProfileCard.tsx` | 首页 | 迁移 + 重排 | L1 今日任务 / L2 下一步行动 / L3 折叠摘要 |
| plan（今日计划） | `apps/web/src/components/TodayPlan.tsx`、`apps/web/src/features/plan/StudyPlanOverview.tsx`、`apps/web/src/features/onboarding/todayLearningRoute.ts` | 首页 | 并入 | TodayPlan 迁入首页顶部 |
| score-center（今日提分） | `apps/web/src/features/today-score-center/TodaysScoreCenter.tsx`、`RecommendationCard.tsx`、`WhyRecommendedDrawer.tsx` | 首页 | 并入 | 推荐卡片作为「今日任务」数据源 |
| knowledge-catalog（408知识图谱） | `apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx`、`KnowledgeTree.tsx`、`KnowledgePointDetailDrawer.tsx` | 知识 | 保留 | 掌握状态改为取自 `getMyMastery` |
| question（题库训练） | `apps/web/src/features/practice/PracticePanel.tsx` | 题库 | 保留 + 增强 | 吸收 TutorPanel 为内嵌 AI 教练 |
| wrong-book（错题复盘） | `apps/web/src/features/mistakes/MistakeWorkspace.tsx`、`apps/web/src/components/WrongQuestionDetail.tsx` | 错题 | 保留 + 增强 | 吸收 AI 复盘引导 |
| report（提分报告） | `apps/web/src/features/report/ReportWorkspace.tsx`（含 StageReportPanel / WeaknessReportPanel / MasteryTrendPanel / LearningProfilePanel / ReviewResourcesPanel / AssessmentHistoryPanel） | 测试 | 收敛 | 考后报告抽屉 |
| ai（AI 答疑） | `apps/web/src/features/tutor/TutorPanel.tsx` | — | 组件化 | 转为 `ContextualCoach`，嵌入各页 |

### 1.2 新增页面

| V3 页面 | 建议路径 | 说明 |
|---|---|---|
| 测试中心 | `apps/web/src/features/test/TestSection.tsx` | 阶段测评入口 + 模拟卷入口 + 报告抽屉 |
| Contextual AI Coach | `apps/web/src/components/ContextualCoach.tsx` | 通用 AI 教练容器，props：context type / questionId / knowledgePointId |

### 1.3 导航与路由文件

| 文件 | V2 状态 | V3 动作 |
|---|---|---|
| `apps/web/src/layouts/RoleNavigation.tsx` | 学生 8 项（dashboard/plan/score-center/knowledge-catalog/question/wrong-book/report/ai） | studentItems 收敛 5 项；删 `ai`；StudentBottomNav 同步 |
| `apps/web/src/layouts/RoleLayouts.tsx` | 渲染导航 + sections | 同步 5 项 |
| `apps/web/src/features/student/StudentSections.tsx` | 分发 8 个分支 | 删 plan/score-center/ai 分支；新增 test 分支 |
| `apps/web/src/App.tsx` | 1587 行，集中状态接线 | 状态与事件接线调整 |
| `apps/web/src/features/navigation/useRoleSectionNavigation.ts` | 导航逻辑 | 同步 |

---

## 2. V2 服务 → V3 服务映射

### 2.1 API 端点

| V2 端点（controller 确认） | V3 动作 | 说明 |
|---|---|---|
| `GET /dashboard/overview` | 重构 | 精简 payload，只返回首页驾驶舱最小字段 |
| `GET /today/plan` | 保留 + 合并 | 与 score-center 计划合并为单一「今日任务」数据源 |
| `POST /study-tasks/:taskId/complete` | 保留 | 升级为闭环统一完成入口（更新状态 + 生成下一任务） |
| `GET /trial-progress` | 废弃 | 冗余聚合 |
| `GET /study-reminders` | 废弃 | 冗余聚合 |
| `GET /sprint-plan` | 废弃 | 冗余聚合 |
| `GET /mastery-map` | 迁移 | 改为读取 `getMyMastery`（score-center 唯一来源） |
| `POST /practice-records` | 保留 + 增强 | 接入闭环控制器 |
| `GET /wrong-questions*` | 保留 | 状态来源改为 UserKnowledgeMastery |
| `POST /assessments/stage/submit` | 保留 | 提交后触发 composeDailyPlan |
| `POST /ai/tutor-reply`、`POST /ai/follow-up` | 保留 | 供 ContextualCoach 复用 |

### 2.2 后端 Service

| V2 服务（真实路径） | V3 动作 | 说明 |
|---|---|---|
| `apps/api/src/study/study.service.ts`（4661 行） | 拆分 | 仅保留今日计划 + 任务编排 + 闭环控制器；删除重复的掌握度/推荐/错题统计实现 |
| `apps/api/src/score-center/service.ts` | 升级 | 唯一 Student State 写入方（applyAttempts / applyReview 已为原子更新入口） |
| `apps/api/src/score-center/repository.ts` | 保留 | 数据访问层 |
| `apps/api/src/questions/questions.service.ts` | 保留 | 题库 |
| `apps/api/src/study/ai-tutor.service.ts` | 保留 | AI 上下文 |
| 新增闭环控制器 | 新增 | 行为事件 → 更新状态 → 生成下一任务 |

### 2.3 共享计算函数（packages/shared/src）

| 函数 | V2 用途 | V3 动作 |
|---|---|---|
| `learning.ts` `computeMasteryReport` | 掌握度报告（V2 主） | 废弃，改为 nodeMastery + score-center/mastery |
| `nodeMastery.ts` `buildNodeMasteryMap` / `buildMasteryTrend` / `deriveNodeWeakPoints` | 节点掌握度展示 | 保留，唯一展示层 |
| `score-center/mastery.ts` `updateMasteryAfterAttempt` / `updateStabilityAfterReview` / `estimateRetention` | 原子掌握度 | 保留，唯一实现 |
| `score-center/priority.ts` `calculatePriority` | 优先级 | 保留，唯一推荐入口 |
| `score-center/plan.ts` `composeDailyPlan` | 每日任务 | 保留，唯一推荐入口 |
| `ai-tutor.ts` | AI 模板 | 保留 |

---

## 3. 旧数据模型 → 新数据模型迁移策略

### 3.1 原则

- **不删除数据库模型、不改变数据库结构**（V3 期间）。
- 只做：字段/索引扩展、数据回填、读取路径切换。
- 唯一真相源：`UserKnowledgeMastery` + `PracticeRecord` + `StudyTask` + `UserEvent`。

### 3.2 模型清单与迁移状态

| 模型（prisma/schema.prisma） | V2 角色 | V3 角色 | 迁移动作 |
|---|---|---|---|
| `UserKnowledgeMastery` | 原子掌握度（已存在，score-center 写入） | 唯一掌握度事实 | 无结构变更；扩大写入面 |
| `UserMasterySnapshot` | 快照（score-center 写入） | 趋势唯一来源 | 无结构变更 |
| `PracticeRecord` | 行为事实 | 闭环输入 | 无结构变更 |
| `StudyTask` | 计划任务 | 任务执行与进度 | 无结构变更 |
| `UserEvent` | 事件记录 | 闭环观测 | 扩展 type 枚举（attempt / review / task_complete / assessment） |
| `ReviewSchedule` + `ReviewAttempt` | 间隔复习 | 错误恢复排期 | 无结构变更 |
| `KnowledgeNode` + `ExamQuestionKnowledgeTag` + `KnowledgePointNodeMap` | 知识树 + 真题证据 + 桥接 | 知识中心 | 无结构变更 |
| `KnowledgePoint` | 知识点（V2 旧掌握度 key） | 保留为兼容层 | 只读；写入路径逐步切换到 KnowledgeNode |
| `StudyPlan` | 计划 | 保留 | 与 score-center 计划共存，最终以 `source: 'score-center'` 为主 |
| `WrongQuestionReview` | 错题复盘 | 保留 | 与 ReviewSchedule 语义合并校验 |
| `AiTutorLog` | AI 日志 | 保留 | 无变更 |
| 前端内存态（`mockData.ts`、`api/mocks/dashboard.ts`） | V2 无后端时的占位 | 废弃 | 删除（Sprint 2） |

### 3.3 数据一致性回填（如需要）

| 场景 | 策略 |
|---|---|
| 已有 PracticeRecord 但无 UserKnowledgeMastery | 一次性回填：遍历 records 调 `applyAttempts`（幂等，按 submittedAt 顺序） |
| 已有 ReviewSchedule 但 mastery 为默认值 | 保留 schedule，不动 mastery |
| 知识页历史掌握数据 | 读取路径切换，不迁移数据 |
| 双写窗口（Sprint 2 过渡期） | 以 `UserKnowledgeMastery` 为准，页面读取统一切换后删除旧读取 |

### 3.4 删除计划（全部在 Sprint 2 之后执行）

1. `apps/web/src/mockData.ts`
2. `apps/web/src/api/mocks/dashboard.ts`
3. `study.service.ts` 中 `computeMasteryReport` 调用链与 `getMasteryMap` 非 node 分支
4. `/trial-progress`、`/study-reminders`、`/sprint-plan` 端点

---

## 4. 迁移顺序依赖

```
Sprint 1（导航收敛，无状态依赖）
  ↓
Sprint 2（StudentState 统一，需要 Sprint 1 页面稳定）
  ↓
Sprint 3（学习闭环，需要 Sprint 2 唯一状态）
  ↓
Sprint 4（AI 集成，依赖页面已收敛）
```

每个 Sprint 独立可合并、可回滚；迁移顺序不可颠倒。
