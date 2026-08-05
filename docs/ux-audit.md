# UX 现状审计（ux-audit）

> 维护约定：本文档是只读审计结论，信息一律以代码为准；基线 commit：`eceb7a2`（2026-08-05）。业务代码未在本轮修改。
> 阅读顺序建议：`docs/PROJECT_CONTEXT.md` → `docs/ARCHITECTURE.md` → 本文档 → `docs/ux-improvement-spec.md` → `docs/ux-implementation-roadmap.md`。

## 1. 审计方法

- 范围：`apps/web/src`、`apps/api/src`、`packages/shared/src`、`prisma/schema.prisma`、`test/`。
- 依据：实际代码、路由、Schema、组件渲染分支，不依赖口头描述。
- 未修改任何业务代码；仅新增本文档与配套设计文档。

## 2. 已实现功能（可直接复用）

| 能力 | 位置 | 说明 |
|---|---|---|
| 认证/邀请/角色/数据隔离 | `apps/api/src/auth/`、`apps/web/src/hooks/useAuth.ts` | 自定义 JWT + refresh 轮换；`RoleGuard`；学生只能看自己 |
| 题库 CRUD + 文档导入 | `apps/api/src/questions/`（含 `import/`） | 320 题内容在 `kaoyan-408-content-starter/` |
| 初始诊断（目标/当前分/天数/小时/最弱科） | `applyDiagnosticProfile`（`apps/api/src/study/study.service.ts:645`）、`apps/web/src/components/OnboardingWizard.tsx` | 已持久化到 `User` 诊断字段 |
| 七天计划 + 今日任务 + 完成度调整 | `apps/api/src/study/onboarding-plan.repository.ts`、`buildSevenDayPlan`、`getTodayPlan`（study.service.ts:744）、`apps/web/src/components/TodayPlan.tsx` | `StudyPlan`/`StudyTask` 表；任务含 `priority/reason/nextAction/postponeCount` |
| 单题练习与判题 | `POST /practice-records`、`buildPracticeRecord`（study.service.ts:1979）、`apps/web/src/features/practice/PracticePanel.tsx` | 判题复用 `packages/shared/src/learning.ts` 的 `classifyMistake` |
| 练习会话（快照/自动保存/断点） | `apps/api/src/study/learning-session.repository.ts`、`apps/web/src/hooks/usePracticeSession.ts`、`apps/web/src/components/ExamSession.tsx` | revision 乐观锁 + 8 秒自动保存 + localStorage 断点 |
| 推荐题组 / 阶段小测 | `getRecommendedPracticeSet`、`getStageAssessment`（study.service.ts:1778 / 2258） | 按薄弱点生成 |
| 错题本（聚合/错因统计/重做） | `listWrongQuestions`（study.service.ts:1438）、`getWrongQuestionSummary`、`apps/web/src/features/mistakes/MistakeWorkspace.tsx` | 实时推导，无独立错题表 |
| 间隔复习 1/3/7/14 天 | `reportWrongReason`（study.service.ts:1509）、`apps/api/src/study/review-schedule.repository.ts`、`apps/web/src/components/WrongQuestionDetail.tsx` | `ReviewSchedule`/`ReviewAttempt` 表；连续答对 3 次标记 mastered |
| 模拟考试 + 考试报告 + 考后复习任务 + 成绩趋势 | `submitPracticeSession`（study.service.ts:2899）、`getExamReport`（3159）、`generatePostExamReviewTasks`、`getExamScoreHistory`、`apps/web/src/components/ExamReport.tsx` | 会话提交写 `AssessmentHistoryItem`（P1-1 已修复） |
| 学习日历/提醒/冲刺计划 | `getLearningCalendar`（2173）、`getStudyReminders`、`getSprintPlan`（437） | |
| 学习画像/时间线 | `getStudentLearningProfile`（582）、`apps/web/src/features/report/LearningProfilePanel.tsx` | |
| 教师班级分析 | `getTeacherClassAnalytics`、`apps/web/src/features/teacher/TeacherWorkspace.tsx` | |
| 管理看板 | `apps/api/src/study/beta-metrics.service.ts`、`apps/web/src/features/admin/` | |
| 反馈 | `POST /feedback`、`apps/web/src/features/feedback/FeedbackPanel.tsx` | 场景 + 评分 + 文本 |
| 边界状态基础设施 | `apps/web/src/hooks/moduleResource.ts`、`apps/web/src/components/ModuleResourceState.tsx`、`ApiStateIndicator.tsx` | loading/error/mock/retry 通用组件已存在，覆盖不完整（见 §7） |

## 3. 部分实现功能

- **诊断结果**：`DiagnosticSummary.tsx` 只展示"当前估分/目标分/最弱科目/计划阶段"4 个数字；没有预计水平、TOP 薄弱点、推荐任务及原因、预计学习时间、学习顺序。诊断输入也缺少四科基础、历史成绩导入入口。
- **掌握度**：`getMasteryMap`（study.service.ts:502）只基于内存 records + **内置 4 个知识点**实时计算，导入的 16 个知识点未参与（ROADMAP P0-1）；且与 `computeWeaknessReport` 是两套口径（ROADMAP P2-2）。
- **错题状态**：只有 `reviewed/pending` 两态（`listWrongQuestions` 的 `reviewStatus`），"已掌握"依赖用户在错题详情手动重做连续 3 次正确（`reportWrongReason` 的 `consecutiveCorrect>=3`）；没有同知识点变式题自动复测、没有答题时间/自信程度/间隔后复测的综合判定。
- **AI 答疑**：`createTutorReply`（study.service.ts:2333）是标准解析模板；`AiTutorLog` 表从未写入；前端 `handleAskTutor` 硬编码 `selectedAnswer: 'A'`（`apps/web/src/App.tsx`，ROADMAP P1-3）。
- **学习报告**：无独立报告页/接口，由 `dashboard/overview`、`reports/overview`、`mastery-map`、`assessment-history`、`exam/report/:sessionId`、`students/:id/profile` 拼装（`PROJECT_CONTEXT` §6）；报告无"结论先行"。
- **移动端**：`@media (max-width: 900px)`（`styles.css:2747`）把侧边栏改为静态顶部栏；无底部导航、无状态恢复。
- **评估历史**：已从 RuntimeState 迁移到 `AssessmentHistoryItem`（P2-1 完成），但 `getExamScoreHistory` 只读内存 `practiceSessions`，重启后历史只来自 `AssessmentHistoryItem` 的 `items`，两路径口径不同。
- **任务计划调整**：`createTaskCompletionAdjustment`（study.service.ts:2826）能输出 `intensity/tomorrowQuestionTarget/reviewTarget`，但只用于即时展示，未真正落到 `StudyTask` 的后续安排；逾期任务只有"延期"（`postponeTask`），没有"降低本周任务量/只保留高优先级"。

## 4. 缺失功能（相对目标闭环）

- **首页学习驾驶舱**：无"今日任务 + 进度 + 预计剩余时间 + 继续今日学习主按钮"首屏；无"最薄弱点/预测分数/掌握度趋势/错题复习提醒"的实时数据聚合（现为静态演示卡片，见 §6）。
- **三模式练习**：无"学习模式（每题即看解析）/训练模式（一组后看解析）/模拟模式（严格计时不提前给答案）"；当前只有 `practice_set / stage_assessment / paper` 三种会话类型，学习模式下单题练习（`PracticePanel`）答完只显示状态文本，不展示解析。
- **答题元数据**：无"确定/不确定/完全不会"自信度、无"是否查看提示/是否修改答案"、无"是否重复犯错"显式标记；`PracticeRecord` 无这些字段（见 §8）。
- **错误类型 8 类**：当前 `MistakeReason = '概念不清' | '知识点混淆' | '审题问题' | '计算失误' | '速度偏慢'`（`packages/shared/src/domain.ts`）；缺"知识点没学过/公式记错/时间不足/蒙题"；会话模式错题一律记 `'待复盘'`（`gradePracticeSessionAnswers`），无差异化学习建议。
- **错题筛选**：`GET /wrong-questions` 无筛选参数（无科目/章节/知识点/错误类型/错误次数/掌握状态/复习时间/重要程度）。
- **变式题**：`findSimilarQuestions` 只是同考点题推荐，无"变式题复测"闭环；复习界面不提供"原题回顾→变式→易混辨析→综合应用"四层资源。
- **任务逾期处理**：无"重新安排/降低本周任务量/只保留高优先级"操作（只有 `POST /tasks/:id/postpone`）。
- **用户信任说明**：无"掌握度如何计算/为什么推荐/预测分数仅为估算/AI 内容标识/可反馈题目与解析错误"的说明文案；反馈无结构化分类（"题目有误/答案有误/解析不清楚/知识点分类错误/AI 回答有问题"）。
- **预测分数**：`WeaknessReport.estimatedGain` 存在，但无基于趋势/剩余天数的预测模型与展示。
- **行为埋点**：无用户行为事件表/接口（`OperationLog` 只记录 API 日志）。
- **教师端学情报告 / AI 辅助页**：占位（ROADMAP P3-1）。

## 5. 重复功能 / 结构问题

- `dashboard` 与 `plan` 两个导航项渲染**同一个** `StudentLaunchpad`（`apps/web/src/App.tsx:999`，条件为 `visibleSection === 'dashboard' || visibleSection === 'plan'`）。
- `dashboard` 与 `report` 都渲染 `StudentProgressOverview + LearningProfilePanel + FeedbackPanel + DiagnosticSummary`（`App.tsx:1045` 条件 `dashboard || report`）。
- "学习日历"块在 `plan/question/report/ai` 四个 section 下都渲染，且 `id="wrong-book"` 与错题本 section 重复（`App.tsx:1063-1079`，`id` 冲突是明显笔误）。
- `WeaknessReportPanel`（标题"提分报告"）在 `question` 段也渲染（`App.tsx:1122` 附近），与 `report` 段的报告重复。
- 掌握度存在两套口径：`getMasteryMap`（正确率×0.7+覆盖度×0.3）与 `computeWeaknessReport`（错误率×100+重要性×8+频率×6）（ROADMAP P2-2）。
- 前端 `report` 数据来自 `dashboardOverview.overview.data` 的 `report` 字段（`App.tsx:113`），与独立 `reports/overview` 接口重复计算。
- 单题练习（`PracticePanel`）与推荐题组/测评/考试（`ExamSession`）是两套并行的答题 UI，行为与数据落点不同。

## 6. 无效或低价值功能（含数据真实性问题）

- **`StudentLaunchpad.tsx` 硬编码演示数据在生产渲染**：`kpiCards`（"今日任务 7/10"、"预计提分 +18"）、`subjectCards`（正确率 78%/72%/68%/75%、"已学 328/420"）、`focusPoints`、`recentMistakes`、`weekSchedule`、`mastery-trend`（`[38,42,50,49,64,62,75]`）均为常量（`apps/web/src/features/onboarding/StudentLaunchpad.tsx`），且该组件在**任意环境**（含生产）渲染，不经过 `isMockAllowed()` 门禁（`apps/web/src/api/env.ts`）。与 AGENTS.md"生产/预发环境禁止任何 mock"冲突，是最需要优先修复的真实性问题。
- 首页 hero"继续刷题"按钮直接启动**模拟考试**（`startConfiguredExam`），不是回到今日任务，与"继续今日学习"预期不符。
- `DiagnosticSummary` 的按钮文案是"提交演示诊断"（`apps/web/src/features/diagnostic/DiagnosticSummary.tsx`），生产语义错误。
- header 全局"生成阶段测评"按钮（`App.tsx:991` 附近）把管理/运营动作混入学生工作台顶部。
- 试用引导（`trial-progress`）与问卷外链（`FeedbackPanel` 的腾讯问卷）对已走完闭环的用户是持续噪音。

## 7. 页面体验问题

- 首页不回答"今天做什么/哪里最薄弱/最近是否进步"，而是静态卡片 + 模块堆叠（§6）。
- 今日任务无"预计剩余时间"；进度条来自 `summary`（`TodayPlan.tsx`），但 hero 的 70% 是硬编码。
- 单题练习答后无解析展示、无下一题引导、无错因选择入口直接衔接（`PracticePanel` 的 `status` 只是文本）。
- `ErrorReasonSelector`（错因选择）的选项与目标 8 类错因不一致（目标"公式记错/蒙题/时间不足/知识点没学过"缺失）。
- AI 答疑无分层提示（第一层考点→第二层思路→第三层部分步骤→第四层完整解析）；`TutorPanel` 快捷问题固定 3 个且不携带"当前题目/用户答案/正确答案/知识点/错因/最近错题"上下文。
- 报告页无"结论先行"（本周预计提升/主要进步/当前风险/下周最重要任务/长期薄弱点），`StageReportPanel` 以图表数字开头。
- 错题本无筛选栏；错题详情 `WrongQuestionDetail.tsx` 无"复习模式"（原题→变式→辨析→综合）流程。
- 任务卡片已展示 `reason`（`TodayPlan.tsx` 的 `task-reason`），但 `StudyPlanOverview` 侧无；逾期任务无操作菜单。

## 8. 数据结构问题

- `PracticeRecord`（`prisma/schema.prisma`）：缺 `confidence`（自信度）、`usedHint`（查看提示）、`answerModified`（修改答案）、`repeatedWrong`（重复犯错）字段；`knowledgePointId` 只存题目 `knowledgePointIds[0]`（`buildPracticeRecord` 与 `createPracticeRecord`（shared）均取首点），多知识点题目薄弱归因会偏差（ROADMAP P2-4）。
- `ReviewSchedule`：`stability` 用字符串 `learning/review/mastered`，判定只靠手动重做连续正确 3 次；无"变式题复测记录"字段/关联；无掌握判定的时间/置信条件。
- `WrongQuestionReview`：只记录 `reviewedAt`，无状态演进；错题本"已掌握"无法从中推导。
- `User`：缺四科基础水平（数据结构/组成原理/操作系统/网络各自当前水平）、历史成绩导入模型；现有 `currentScore` 为单一总分。
- 无行为埋点表（如 `UserEvent`）。
- `AiTutorLog` 表存在但从未写入（`PROJECT_CONTEXT` §6）。
- 预测分数无模型/表；`estimatedGain` 为公式估算。

## 9. 前后端接口问题

- 错因归因不一致：单题 `buildPracticeRecord` 用 `classifyMistake`；会话提交 `gradePracticeSessionAnswers` 一律 `'待复盘'`，提交后不回填错因（`applySessionProgress`）。
- `GET /wrong-questions` 无筛选 query 参数；无"掌握状态"查询维度。
- `POST /ai/tutor-reply` 无 `level`（分层）参数、无 `mistakeReason/relatedWrongQuestions` 上下文；`POST /ai/follow-up` 无对话历史。
- 无埋点接口；无"预测分数"接口。
- `POST /practice-records` DTO（`apps/api/src/study/dto/create-practice-record.dto.ts`）无 `confidence/usedHint/answerModified` 字段。
- `GET /today/plan` 与 `generatePlan` 双路径（有 scheduledPlan 与无 scheduledPlan 返回不同结构，`weekProgress` 与 `priorityTasks` 数据源不同），前端需兼容两种结构。
- 无"变式题生成/复测提交"接口；`findSimilarQuestions` 是内部方法。

## 10. 移动端问题

- 无底部导航：`RoleNavigation` 渲染为侧边栏按钮列表，`<=900px` 时变为静态顶部堆叠（`styles.css:2752`），与目标"五项目底部导航（首页/学习/练习/错题/我的）"不符。
- 学生导航 6 项（dashboard/plan/question/wrong-book/report/ai），其中 dashboard 与 plan 内容相同（§5）。
- 无"返回页面后的状态恢复"：无路由，刷新即回到 dashboard；会话恢复靠 `ResumeSessionBanner`（仅未提交会话）。
- 答题选项点击区域：`option-btn` 为整行按钮，基本可用；但 `PracticePanel` 的 `options` 按钮无 `min-height` 保障（待视觉验收）。
- 弹窗：`submit-confirm-overlay` 在移动端为全屏覆盖（`styles.css:526`），尺寸可用但需验收。
- 图表：掌握度趋势为 `div` 柱（`StudentLaunchpad` 硬编码），无真实数据图表组件。

## 11. 性能与稳定性问题

- `StudyService` 3655 行、`App.tsx` 1300+ 行单文件（ROADMAP P2-3），迭代风险高。
- `getDashboardOverview` / `getTodayPlan` / `getOverviewReport` 每次请求全量重算 `computeWeaknessReport` 与 `generatePlan`，O(题量×知识点) 线性重算。
- 内存双模式 + 多实例一致性：`this.records`/`this.practiceSessions` 等为进程内存，多实例部署会分片（当前单实例，`ARCHITECTURE` §10）。
- `ExamSession.handleSubmit` 的 `catch {}` 静默吞错，交卷失败无用户提示（`apps/web/src/components/ExamSession.tsx`）。
- `PracticePanel` 单题提交无提交中禁用状态（`handleSubmitAnswer` 依赖 `status` 文本，无防重复标志）。
- 模拟考试"异常恢复"：`ResumeSessionBanner` 支持，但交卷中断场景无显式"数据已保存"提示。

## 12. 测试覆盖现状

- `test/` 35 个文件，`npm test` 197 项（196 通过 / 1 跳过，2026-08-05 部署日志）。
- 已有：`today-plan-ui.test.js`、`stage-report.test.js`、`ux-redesign-ui.test.js`、`student-session-policy.test.js`、`post-exam-scheduling.test.js`、`postponement-scheduling.test.js` 等。
- 缺口：无"首页数据真实性（生产无硬编码演示值）"测试；无"错题筛选/变式复测"测试；无"三模式练习"测试。

## 13. 优先级总览（详细方案见 roadmap）

1. **P0-真实性**：移除/门禁 `StudentLaunchpad` 硬编码演示数据（生产）。
2. **P0-信息架构**：收敛重复 section（dashboard/plan/report），建立"首页驾驶舱"单一入口。
3. **P0-闭环**：单题练习即答即析、错因 8 类、会话错因回填、错题筛选与复测。
4. **P1**：动态计划、预测分数、掌握度趋势、AI 分层、变式题、周报。
5. **P2**：埋点、知识图谱等（不进入本轮 P0）。
