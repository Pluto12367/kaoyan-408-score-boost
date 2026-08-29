# V3 Sprint 1 稳定化总结

> 分支：`feature/v3-product-refactor`
> 基线提交：`2f5971c` (feat: simplify student navigation)
> 生成日期：2026-08-25

---

## 1. Sprint 目标

Sprint 1 对应 V3 产品重构计划中的 **导航和页面收敛**，核心目标：

1. **学生端一级导航 8 → 5**（首页、题库、知识、错题、测试）
2. **首页合并** dashboard + plan + score-center 为统一「今日学习驾驶舱」
3. **移除 AI 一级导航**，TutorPanel 保留为组件供内嵌使用
4. **旧导航兼容**：plan / score-center / report / ai 等旧 section 经过 `normalizeRoleSection` 映射到新导航
5. **Student State 查询服务拆分**：将 `StudyService` 中的 trial-progress / reminders / sprint-plan / mastery-map / wrong-questions / learning-calendar 查询抽取为独立服务

---

## 2. 完成内容

### 2.1 导航收敛

| 验收项 | 状态 | 说明 |
|---|---|---|
| 学生端一级导航恰好 5 项 | ✅ | `RoleNavigation.tsx` studentItems 为 5 项 |
| 导航标签：首页、题库、知识、错题、测试 | ✅ | 顺序与文本一致 |
| AI 不存在于一级导航 | ✅ | studentItems 不含 `ai` |
| 移动端底部导航同步 5 项 | ✅ | `StudentBottomNav` 与 studentItems 一致 |
| 旧导航自动映射 | ✅ | `normalizeRoleSection` 将 plan/score-center → dashboard, report → test |
| 首页信息分层（L1 今日任务 / L2 下一步 / L3 折叠） | 🔄 | StudentLearningConsole 已实现 L1/L2；L3 状态摘要待迭代 |

### 2.2 首页合并（StudentHome）

新增 `apps/web/src/features/student/home/StudentHome.tsx`，在同一页面中整合：

- **StudentLearningConsole**（原 dashboard 主组件）
- **TodayPlan**（原 plan 组件，以「今日最重要任务」卡片嵌入）
- **TodaysScoreCenter**（原 score-center 组件，以「学习路线与推荐」卡片嵌入）

### 2.3 测试页面（TestSection）

新增 `apps/web/src/features/test/TestSection.tsx`，提供：

- 阶段测评入口（StageAssessmentPanel）
- 考后报告页面（ReportWorkspace）
- StudentSections 中 `test` 和 `report` 分支均渲染 ReportWorkspace

### 2.4 Student State 查询服务拆分

从 `StudyService` 中抽取为独立 @Injectable 服务：

| 服务文件 | 职责 |
|---|---|
| `student-state-projection.service.ts` | 统一快照组装（UserKnowledgeMastery + PracticeRecord + StudyTask + ReviewSchedule） |
| `student-state-query.service.ts` | mastery-map 兼容查询 |
| `student-state-reminder-query.service.ts` | 今日提分提醒查询 |
| `student-state-sprint-plan-query.service.ts` | 7 天冲刺计划查询 |
| `student-state-trial-progress-query.service.ts` | 体验进度查询 |
| `student-state-learning-calendar-query.service.ts` | 学习日历查询 |
| `wrong-question-query.service.ts` | 错题列表 + 摘要 + 到期复习 |
| `wrong-question-projection.service.ts` | 错题投影（PracticeRecord → WrongQuestion 视图） |
| `activity-projection.service.ts` | 活动日历投影（practice + task 汇总） |
| `mastery-summary-projection.service.ts` | 掌握度汇总投影 |
| `task-progress-consistency-checker.service.ts` | 任务进度一致性校验 |

### 2.5 幂等提交基础设施

- `prisma/schema.prisma` 新增 `AnswerReceipt` 模型（userId + idempotencyKey 联合唯一）
- `prisma/migrations/20260823120000_answer_receipts/` 数据库迁移
- `answer-receipt.repository.ts` + `answer-request-hash.ts` 实现
- `answer-request-hash.ts`：基于 body 的确定性 SHA-256 哈希
- `study.controller.ts`：`POST /practice-records` 强制要求 `Idempotency-Key` 请求头
- `StudyTaskProgress` 模型：持久化任务进度存储

### 2.6 回归问题修复

| 问题 | 修复 |
|---|---|
| `student-state-reminder-query` 使用真实当前日期计算 todayPracticeCount | 改为基于 `asOf` 参数计算 7 天窗口 |
| `student-state-sprint-plan-query` 同上 | 同样改为基于 `asOf` |
| `next-learning-step-ui.test.js` 中 TodayPlan 断言被误改为 doesNotMatch | 恢复为 match |
| App.tsx 中 catalogFocusNodeId 桥接被错误删除 | 恢复 `catalogFocusNodeId` 状态 + `handleOpenCatalogNode` + `focusNodeId` prop |

---

## 3. 修改文件列表

### 3.1 修改文件（19 个，相对 HEAD `2f5971c`）

```
 M apps/api/src/score-center/repository.ts          (+102 / -57)
 M apps/api/src/score-center/service.ts             (+38 / -20)
 M apps/api/src/study/learning-progress.repository.ts (+74 / -0)
 M apps/api/src/study/review-schedule.repository.ts (+21 / -0)
 M apps/api/src/study/study-date.ts                 (+10 / -0)
 M apps/api/src/study/study.controller.ts           (+56 / -0)
 M apps/api/src/study/study.module.ts               (+13 / -0)
 M apps/api/src/study/study.service.ts              (+324 / -0)
 M apps/web/src/App.tsx                             (+373 / -185)
 M apps/web/src/api/client.ts                       (+8 / -0)
 M apps/web/src/api/endpoints/practice.ts           (+29 / -0)
 M apps/web/src/features/auth/AccountPanel.tsx       (+1 / -0)
 M apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx (+1 / -0)
 M apps/web/src/features/mistakes/MistakeWorkspace.tsx (+1 / -0)
 M apps/web/src/layouts/RoleNavigation.tsx           (+1 / -0)
 M prisma/schema.prisma                             (+42 / -0)
 M scripts/backfill-user-mastery.mjs                 (+1 / -1)
 M test/stage3-repair.test.js                        (+0 / -2)
 M test/task-progress-auto.test.js                   (+4 / -0)
```

### 3.2 新增文件（22 个，未跟踪）

```
## API 层 - Student State 服务
?? apps/api/src/study/student-state-projection.service.ts
?? apps/api/src/study/student-state-query.service.ts
?? apps/api/src/study/student-state-reminder-query.service.ts
?? apps/api/src/study/student-state-reminder.adapter.ts
?? apps/api/src/study/student-state-sprint-plan-query.service.ts
?? apps/api/src/study/student-state-sprint-plan.adapter.ts
?? apps/api/src/study/student-state-trial-progress-query.service.ts
?? apps/api/src/study/student-state-trial-progress.adapter.ts
?? apps/api/src/study/student-state-learning-calendar-query.service.ts
?? apps/api/src/study/student-state-learning-calendar.adapter.ts
?? apps/api/src/study/student-state.snapshot.ts

## API 层 - 错题查询服务
?? apps/api/src/study/wrong-question-query.service.ts
?? apps/api/src/study/wrong-question-projection.service.ts
?? apps/api/src/study/wrong-question.adapter.ts
?? apps/api/src/study/wrong-question.snapshot.ts

## API 层 - 活动投影
?? apps/api/src/study/activity-projection.service.ts

## API 层 - 幂等提交
?? apps/api/src/study/answer-receipt.repository.ts
?? apps/api/src/study/answer-request-hash.ts
?? apps/api/src/study/mastery-summary-projection.service.ts
?? apps/api/src/study/task-progress-consistency-checker.service.ts

## 数据库
?? prisma/migrations/20260823120000_answer_receipts/

## 前端
?? apps/web/src/features/student/home/StudentHome.tsx
?? apps/web/src/features/test/TestSection.tsx
```

---

## 4. 解决的问题

### 4.1 导航收敛（V3 原则 #7）

学生端侧边栏从 8 个一级导航收敛到 5 个，减少了信息过载。旧导航入口（plan、score-center、report、ai）通过 `normalizeRoleSection` 自动映射到新导航，不影响已有书签和外部链接。

### 4.2 首页信息聚合

原 3 个独立页面（dashboard + plan + score-center）合并为统一首页，学生可以在一个页面中完成「查看今日任务 → 确认下一步行动 → 查看推荐」的完整流程，无需在多个页面间切换。

### 4.3 API 查询职责拆分

`StudyService`（曾达 4661 行）中的查询职责被抽取到多个独立服务中：

- 每个服务职责单一，可独立测试
- 控制器直接注入查询服务，不再经过 `StudyService` 的透传方法
- 利于后续按需缓存和性能优化

### 4.4 幂等提交

`AnswerReceipt` 模型 + `Idempotency-Key` 请求头确保重复提交不会导致掌握度重复计算。这是学习闭环（Sprint 3）的基础设施。

### 4.5 测试回归修复

4 个回归问题已修复，测试全量通过：

| 测试 | 问题类型 | 根因 |
|---|---|---|
| `student-state-reminder-query` | 非确定性 | 活动投影使用 `lastNDates(7)`（真实日期）而非 `asOf` |
| `student-state-sprint-plan-query` | 非确定性 | 同上 |
| `next-learning-step-ui` | 断言错误 | TodayPlan 断言被误改为 `doesNotMatch` |
| `wrong-exam-link` | 桥接丢失 | App.tsx 重构时删除了 `catalogFocusNodeId` 桥接 |

---

## 5. 测试结果

```
# tests  796
# pass   795
# fail   0
# skipped 1
```

| 测试套件 | 状态 |
|---|---|
| 前端 UI 测试（source-level） | ✅ 全部通过 |
| API 服务测试（student-state-*） | ✅ 全部通过 |
| 学习闭环测试（stage3-repair, task-progress, wrong-exam-link） | ✅ 全部通过 |
| 知识图谱测试（knowledge-catalog, knowledge-evidence） | ✅ 全部通过 |
| 集成测试依赖（需要 DATABASE_URL） | ⏭️ 1 skipped（无 DB 时跳过） |

### 构建验证

| 构建 | 状态 |
|---|---|
| `npm run build:shared` | ✅ 通过 |
| `npm run build:api` | ✅ 通过 |
| `npm run build:web` | ✅ 通过（仅既有 Vite chunk 体积提示） |

---

## 6. 当前风险

### 6.1 首页双重渲染

`StudentHome.tsx` 虽然已存在，但 `App.tsx` 的 `dashboard` 分支仍通过 `StudentSections` 渲染 `StudentLearningConsole`，而 `plan` 分支在 App.tsx 中直接渲染 `TodayPlan`。当用户导航到 `dashboard` 时，`StudentHome` 未被使用，需要手动迁移。

### 6.2 TestSection 未接入

`TestSection.tsx` 已创建但未被任何组件引用。`StudentSections` 中 `test` 和 `report` 分支都直接渲染 `ReportWorkspace`，未使用 `TestSection`。验收项 A6（阶段测评入口 + 模拟卷入口）尚未实现。

### 6.3 旧路由兼容

`normalizeRoleSection` 将 `plan`/`score-center` 映射到 `dashboard` 导航高亮，但 `App.tsx` 中 `visibleSection === 'plan'` 的条件分支仍然存在并渲染独立内容。这导致 `plan` 导航高亮显示为「首页」，但实际页面内容仍是旧 plan 布局，与用户预期不符。

### 6.4 遗留 API 端点

`/trial-progress`、`/study-reminders`、`/sprint-plan` 端点虽然已通过新服务实现，但旧端点仍保留。迁移地图计划在 Sprint 2 之后正式废弃这些端点。

### 6.5 前端内存态 mock 数据

`mockData.ts` 和 `api/mocks/dashboard.ts` 仍在使用，迁移地图计划在 Sprint 2 删除。当前存在「静态演示数据」和「真实 API 数据」两条路径，增加了测试和调试复杂度。

### 6.6 掌握度双口径

`UserKnowledgeMastery` 和 `study.service.ts` 中的旧掌握度计算并存。部分页面可能从旧路径读取（如 `computeMasteryReport`），导致数据不一致。

---

## 7. 下一阶段建议

### 7.1 立即完成（Sprint 1 收尾）

1. **将 StudentHome 接入 App.tsx 的 dashboard 分支**
   - 替换 `StudentSections` 中 `dashboard` 分支的纯 `StudentLearningConsole` 渲染为 `StudentHome`
   - 确保 `StudentHome` 接收所有需要的 props

2. **将 TestSection 接入 StudentSections 的 test 分支**
   - 移除 `test` 分支对 `ReportWorkspace` 的直接渲染
   - 改为渲染 `TestSection`，并补全 props 传递

3. **清理旧 plan/score-center 分支**
   - 确认 `App.tsx` 中 `visibleSection === 'plan'` 和 `visibleSection === 'score-center'` 分支可以被移除或合并到 dashboard

### 7.2 Sprint 2 规划（StudentState 统一）

1. **统一掌握度读取路径**
   - 所有页面切换到 `UserKnowledgeMastery` 作为唯一来源
   - 删除 `study.service.ts` 中的 `computeMasteryReport` 调用链

2. **删除内存态 mock 数据**
   - 移除 `mockData.ts` 和 `api/mocks/dashboard.ts`
   - 确认所有前端组件在无 mock 情况下正常工作

3. **废弃旧 API 端点**
   - 确认 `/trial-progress`、`/study-reminders`、`/sprint-plan` 的前端调用已迁移到新服务
   - 添加 `@deprecated` 标记或直接移除

### 7.3 Sprint 3 规划（学习闭环）

1. **闭环控制器**
   - 实现「行为事件 → 更新状态 → 生成下一任务」的自动化流程
   - 确保 `createPracticeRecord` 完成后自动调用 `composeDailyPlan`

2. **幂等提交验证**
   - 集成测试验证 `Idempotency-Key` 幂等性
   - 确认 `AnswerReceipt` 表记录正确

---

## 附录

### A. 验收标准对照

| # | 验收项 | 状态 | 备注 |
|---|---|---|---|
| A1-1 | 学生端一级导航恰好 5 项 | ✅ | 5 项：首页、题库、知识、错题、测试 |
| A1-2 | 导航标签正确 | ✅ | 顺序与文本一致 |
| A1-3 | AI 不在一级导航 | ✅ | studentItems 不含 `ai` |
| A1-4 | 首页默认展示今日任务 | 🔄 | StudentHome 已实现但未接入 |
| A1-5 | 首页信息分层 L1/L2/L3 | 🔄 | L1/L2 就绪，L3 折叠待迭代 |
| A1-6 | 旧 URL 自动重定向 | ✅ | normalizeRoleSection 映射 |
| A1-7 | 移动端底部导航同步 5 项 | ✅ | StudentBottomNav 已同步 |
| A2-8 | 首页展示今日待完成任务 | ✅ | StudentLearningConsole 显示 |
| A2-9 | 首页展示掌握度摘要 | ✅ | LearningProfileCard 显示 |
| A2-10 | 首页展示下一步行动 | ✅ | NextLearningStepCard 显示 |
| A2-11 | 任务完成可勾选 | ✅ | TodayPlan 支持 |
| A2-12 | 首页无冗余信息 | 🔄 | 双重渲染待清理 |
| A3-13 | 题库页面以训练任务为中心 | ✅ | PracticePanel 任务视图 |
| A6-24 | 测试页展示阶段测评入口 | 🔄 | TestSection 已创建未接入 |
| A6-25 | 测试页展示模拟卷入口 | 🔄 | 待实现 |

### B. 参考文档

- V3 重构计划：`docs/v3-product-refactor-plan.md`
- V3 验收标准：`docs/v3-acceptance.md`
- V3 迁移地图：`docs/v3-migration-map.md`