# StudentHome Context Migration Closure

审计日期：2026-09-03  
范围：StudentContext v1 首个消费者 StudentHome 摘要迁移  
环境状态：`ENV-005 = BLOCKED`；`Phase 3.6.4-D4-B4 = BLOCKED BY ENVIRONMENT`

本文件只记录架构与代码审计结论，不改变生产代码、Schema、Migration、写路径或其他消费者。

## 1. Canonical Summary Source

StudentHome 通过 `useStudentContextData` 请求 `GET /student-context`，将返回的只读上下文交给 `useDashboardViewModel`，再由 `toStudentHomeSummary` 做纯展示适配。

| 摘要 | Canonical source | StudentHome 使用位置 | 结论 |
|---|---|---|---|
| mastery | `StudentContext.mastery`，节点身份为 `knowledgeNodeId` | `StudentStateCard`、弱点标题 | PASS；不使用 Point 行为指标冒充 Node mastery |
| practice | `practice.recentAccuracy`、`practice.recentVolume` | `LearningTrend` footer | PASS；按 `window/status` 显示，日历柱状明细仍为 legacy |
| review | `review.dueCount`、`review.overdueCount` | `LearningTrend` footer | PASS；错题详细队列仍为 legacy |
| today plan | `plan.completion` | `TodayMission` progress | PASS；任务对象与启动回调仍为 legacy |
| momentum | `momentum.studyStreak` | StudentHome streak strip | PASS；逐日活动明细仍为 legacy |

当 StudentContext 可用时，`useDashboardViewModel` 优先使用上述摘要；只有上下文不存在时才回退到 CanonicalOverview 或原 dashboard 数据。

## 2. Legacy Responsibility

以下数据仍由 legacy 链路提供，属于有意保留的明细或行为边界：

- TodayPlan 任务对象、题数、章节、完成状态与 `onLaunchTodayTask` 回调；
- `learningCalendar.days` 的逐日活动柱状图与今日练习次数；
- 错题详细列表、复习入口、题目详情与复盘行为；
- 知识图谱、复杂 Dashboard 专属数据；
- 所有写操作和现有刷新/导航回调。

这些数据没有被复制进 StudentContext 摘要，也没有改变既有写入语义。

## 3. Duplicate Query Analysis

当前页面会并行保留：

- `useStudentContextData` → `GET /student-context`；
- `useDashboardOverviewData` → `GET /dashboard/overview`；
- 既有 progress/learning hooks → 掌握度地图、日历、错题和任务明细端点。

这构成迁移期的并行读取，而不是第二个 StudentContext 组合器。代码中没有发现同一 render effect 对 StudentContext 的重复请求；刷新动作只显式调用一次 `studentContext.refresh()`。

当前没有新增缓存或 single-flight。并行 legacy 请求会带来额外读取与刷新成本，但它是保留复杂详情和兼容回退所需的已知代价，不阻塞 ReportWorkspace 摘要迁移。若未来要减少请求，应单独做 query/cache 设计，不在本门禁中改变。

## 4. Adapter Boundary

`apps/web/src/features/student/home/studentHomeContextAdapter.ts` 保持 presentation-only：

- 无 API、Prisma、环境变量或全局状态依赖；
- 无 `Date.now()` / `new Date()`；
- 不写数据库、不修改输入、不创建 Action/Task/Event；
- 只做 Node mastery → 四科摘要、trend/null 展示语义和证据计数转换。

`useDashboardViewModel` 中仍存在 legacy completion fallback 与日历 trend 计算，但在 StudentContext 存在时不作为 canonical 摘要来源；任务和逐日活动图属于明确保留的 legacy 明细。

## 5. State Semantics

- `loading`：StudentContext 尚未返回时显示同步状态，同时继续渲染 legacy 视图；
- `error`：请求失败且无旧上下文时显示错误，继续保留 legacy 视图；没有静默替换为 mock；
- `empty` / `insufficient_data`：adapter 返回 `null` 或 `--`，不制造掌握度、完成率或趋势的零值；
- `asOf`：上下文 payload 中的 `asOf` 原样传入摘要，adapter 不重新解释时间窗口；
- 当前 hook 未固定单次页面生命周期的 `asOf`，每次刷新由服务端产生新的 live snapshot。这是已知 freshness 语义，若未来需要跨模块同一快照，应另行设计 request-level `asOf`/cache，不在本次迁移修复。

## 6. Identity Audit

- mastery 摘要只读取 `knowledgeNodeId`；Point-level `weakPoints` 不被映射为 mastery；
- 练习/错题的 Point 身份仍由 legacy 详细数据承载；
- StudentContext 任务明确区分 `studyTaskId` 与 `actionId`；
- adapter 输出没有无类型的 `id` 字段，也没有 `task.id === action.id` 或 Node-as-Point 转换。

结论：Node / Point / Action / Task identity boundary 在 StudentHome 摘要边界保持完整。

## 7. Regression Risk

1. StudentContext 与 legacy overview 并行加载，可能增加首屏请求量和刷新延迟；当前是兼容迁移的显式成本。
2. 上下文存在但数据不足时，摘要显示 `--`，不会自动降级到可能语义不同的 legacy 指标；这是契约要求，需在后续 UX 验证中观察。
3. 客户端 `StudentContext` 类型是后端契约的显式 mirror，未来字段变更需要同步 contract test 与 TypeScript 检查。
4. `npm test`、Vite bundle 与 PostgreSQL integration 仍受宿主环境 `spawn EPERM` 阻塞，因此本门禁只依赖可执行的定向测试与静态检查。

以上风险均不要求修改 StudentContext contract 或 StudentHome 生产逻辑才能继续下一个摘要消费者。

## 8. Gate Decision

**READY FOR REPORT WORKSPACE**

进入下一消费者前必须继续遵守：

- ReportWorkspace 仍需单独设计和适配；
- 不迁移 RecommendationService、Coach、Knowledge、Assessment；
- 不改变 Student State 写路径、Schema、Migration、AI 或 D4-B4；
- 保留 `ENV-005 = BLOCKED` 与 `D4-B4 = BLOCKED BY ENVIRONMENT` 状态。
