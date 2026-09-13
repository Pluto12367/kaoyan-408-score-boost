# UX 改造实施路线图（ux-implementation-roadmap）

> 维护约定：每个阶段可独立完成、独立测试、不破坏现有功能；未通过验证不得声称完成（验证命令见根目录 `AGENTS.md` §7）。基线 commit：`eceb7a2`。本轮不修改业务代码，只输出方案。

## 阶段总览

| 阶段 | 名称 | 优先级 | 依赖 |
|---|---|---|---|
| 阶段 0 | 基线清理与数据真实性 | P0 | 无 |
| 阶段 1 | 首页学习驾驶舱 | P0 | 阶段 0 |
| 阶段 2 | 诊断与学习计划 | P1 | 阶段 0/1 |
| 阶段 3 | 练习与答案解析（三模式 + 错因 8 类） | P0 | 阶段 0 |
| 阶段 4 | 错题与复测闭环 | P0 | 阶段 3 |
| 阶段 5 | 报告与掌握度（结论先行 + 趋势 + 预测） | P1 | 阶段 1/3 |
| 阶段 6 | 移动端与边界状态 | P1 | 阶段 0/1 |
| 阶段 7 | AI 答疑与智能推荐 | P1 | 阶段 3/4 |

---

## 阶段 0：基线清理与数据真实性（P0）

**目标**：消除生产环境假数据与重复入口，建立可验证基线。

**改动范围**：
1. `apps/web/src/features/onboarding/StudentLaunchpad.tsx`：删除 `kpiCards/subjectCards/focusPoints/recentMistakes/weekSchedule` 硬编码常量与 hero"70% · 7/10"文案；改为真实数据源（`todayPlan.summary`、`masteryMap`、`overview.report`、`learningCalendar`）驱动，空数据展示空状态。
2. `apps/web/src/App.tsx`：收敛重复 section——`dashboard` 与 `plan` 只保留一处渲染；"学习日历"块移除错误 `id="wrong-book"` 并只在 `plan` 段渲染；`report` 段不再渲染 `StudentProgressOverview/DiagnosticSummary` 等首页内容。
3. `apps/web/src/features/diagnostic/DiagnosticSummary.tsx`：按钮文案"提交演示诊断"改为"提交诊断"。
4. `apps/web/src/components/ExamSession.tsx`：`handleSubmit` 的 `catch {}` 改为显示错误（`setSubmitError`）。
5. `apps/web/src/features/practice/PracticePanel.tsx`：单题提交增加"提交中"禁用与防重复。

**验收标准**：
- 生产环境（`isProduction()`）首页不再出现任何硬编码百分比/题量/趋势值。
- 学生 `dashboard` 与 `plan` 不渲染重复内容；`document.getElementById('wrong-book')` 唯一。
- 交卷失败/单题提交重复点击有可见错误提示。
- 回归：`npm run build:web`、`npm run build:api`、`npm test` 通过。

---

## 阶段 1：首页学习驾驶舱（P0）

**目标**：首页回答"今天做什么 / 哪里最薄弱 / 最近是否进步"，主行动为"继续今日学习"。

**改动范围**：
1. `StudentLaunchpad.tsx`（或新组件 `LearningDashboard.tsx`）：
   - 首屏：今日任务卡（来自 `todayPlan.priorityTasks`，含 `reason/minutes`）、进度（`summary.completedTasks/totalTasks`）、预计剩余时间（`priorityTasks` 未完成 `minutes` 之和）、主按钮"继续今日学习"（跳转第一个未完成任务 → 对应练习/题组）。
   - 二屏：薄弱 TOP3（`masteryMap.weakestPoints`）、预测分数（见阶段 5，先展示 `report.estimatedGain` 区间 + "仅为估算"）、掌握度趋势（`learningCalendar` + `masteryMap` 真实值）、错题复习提醒（`todayPlan.reviewDue` 或 `getDueReviews`）。
2. `apps/web/src/api/endpoints/dashboard.ts`：确认 `dashboard/overview` 返回字段覆盖上述数据（`report/plan/masteryMap` 已有；如缺 `dueReviews` 用现有 `GET /review/due`）。
3. `RoleNavigation.tsx`：`plan` 项可保留，但首页即驾驶舱，避免重复。

**验收标准**：
- 首页首屏只有一个主按钮，且指向"继续今日学习"而非"开始模拟考试"。
- 首页所有数字来自 API（生产），空数据有明确空状态。
- 掌握度趋势为真实数据（`learningCalendar`/`masteryMap`），非硬编码 `[38,42,...]`。
- 冒烟：学生登录后进入首页可看到今日任务并一键进入练习。

---

## 阶段 2：诊断与学习计划（P1）

**目标**：诊断结果可行动；计划支持逾期后的"重新安排/减负/只留高优先级"。

**改动范围**：
1. 诊断输入扩展：`OnboardingWizard.tsx` 增加"当前复习阶段 / 四科基础（`subjectBaselines`）/ 历史成绩导入（写入 `AssessmentHistoryItem`，title 标记来源）"。
2. 诊断结果页：新组件（复用 `DiagnosticSummary` 改版）展示预计水平、TOP 3~5 薄弱点（`getOverviewReport`）、推荐任务及原因（`getTodayPlan.priorityTasks`）、建议顺序（按 `priority` 排序）。
3. 动态计划：
   - 后端：`postponeTask` 基础上新增 `POST /tasks/:id/reschedule`（改 `scheduledDate`）、`POST /tasks/rebalance`（按完成率降低本周题量/只保留高优先级），复用 `onboarding-plan.repository.ts` 的 advisory lock 事务。
   - `createTaskCompletionAdjustment` 的 `intensity` 结果落库到次日 `StudyTask.questionCount/minutes`（现在是纯展示）。
4. `TodayPlan.tsx`：逾期任务增加操作菜单（重新安排 / 降低本周任务量 / 只保留高优先级）。

**验收标准**：
- 诊断后可看到 ≥3 个带原因与预计时间的推荐任务。
- 逾期任务可重新安排到指定日期；"降低本周任务量"后 `StudyTask` 实际变化并可查询。
- 历史成绩导入后出现在 `GET /assessment-history`。
- 回归：`npm test`（含 `postponement-scheduling.test.js`）、集成测试通过。

---

## 阶段 3：练习与答案解析（P0）

**目标**：三模式练习 + 错因 8 类 + 答题元数据（自信度/提示/改答）。

**改动范围**：
1. 数据模型（迁移，向后兼容）：`PracticeRecord` 新增 `confidence String?`、`usedHint Boolean @default(false)`、`answerModified Boolean @default(false)`；`User.subjectBaselines Json?`。
2. `packages/shared/src/domain.ts`：`MistakeReason` 扩为 8 类（`知识点没学过/概念混淆/公式记错/计算错误/审题错误/推理过程错误/时间不足/蒙题`）；`classifyMistake` 扩展规则（如"时间不足"：超时且未答/乱选；"蒙题"：短时作答且与常规推理不符 + `confidence=完全不会`）。
3. 会话错因回填：`applySessionProgress`/`gradePracticeSessionAnswers` 提交后用 `classifyMistake` 回填，去掉 `'待复盘'` 占位。
4. 三模式：
   - 学习模式：`ExamSession` 增加 `learning` 类型或参数，每题作答后立即显示标准解析（`analysis` + 考点 + 错项说明），可"下一题"。
   - 训练模式：组内不显示解析，提交后统一展示（现有 `practice_set` 行为 + 错因选择增强）。
   - 模拟模式：现有 `paper` 行为，严格计时。
5. 答题 UI：`ExamSession.tsx` 每题增加"确定/不确定/完全不会"选择、可选"查看提示"（记录 `usedHint`）、记录改答次数；DTO（`create-practice-record.dto.ts`、`learning-session.dto.ts`）透传新字段。
6. 解析展示：新组件 `AnswerExplanation.tsx` 复用 `analysis`，若 `analysis` 未结构化（纯文本），阶段内先按"解析文本 + 考点 + 正确答案 + 错因建议"渲染，结构化解析字段（`question.analysis` 拆分）列入阶段 7。

**验收标准**：
- 学习模式答题后立即展示解析，可继续下一题。
- 会话提交后错题错因不再是 `'待复盘'`。
- `POST /practice-records` 可接收并落库 `confidence/usedHint/answerModified`。
- 蒙题（`confidence=完全不会` 且答对）在掌握度/错因统计中与正常答对区分。
- 回归：`npm run build:web/api`、`npm test`、集成测试通过。

---

## 阶段 4：错题与复测闭环（P0）

**目标**：错题可筛选、状态三态、变式题复测驱动"已掌握"判定。

**改动范围**：
1. 接口：`GET /wrong-questions` 增加可选 query：`subject/chapter/knowledgePointId/mistakeReason/minWrongCount/masteryStatus/reviewedWithinDays/importance`；`GET /wrong-questions/summary` 相应扩展。
2. 状态推导：`listWrongQuestions` 增加 `masteryStatus: '未掌握'|'复习中'|'已掌握'`（基于 `ReviewSchedule.stability + consecutiveCorrect + 变式复测结果`），不新增字段。
3. 变式复测：
   - 复用 `findSimilarQuestions`（同知识点 ≥ 2 题已具备）；错题详情提供"原题回顾 → 变式题 → 易混辨析 → 综合应用"四层入口（`WrongQuestionDetail.tsx`）。
   - 提交变式题走 `POST /practice-records`（`variantQuestionId` 标记）；`reportWrongReason` 的掌握判定纳入变式题连续答对。
4. `MistakeWorkspace.tsx`：增加筛选栏；"已掌握"不再只靠手动重做，展示系统判定依据（`masteryCriteria` 快照可选）。
5. 间隔复习动态调整：`reportWrongReason` 的 intervals 按 `consecutiveCorrect` 已实现；增加"复测正确但耗时长"时保持短间隔（阶段 3 的 `timeSpentSec` 参与判定）。

**验收标准**：
- 错题本可按 ≥4 个维度筛选并返回正确结果。
- 变式题复测连续正确可推动 `stability` 到 `mastered`，且 `mastered` 不再依赖"重做原题"。
- 前端筛选与接口测试（新增 `wrong-question-filter.test.js`）通过。
- 回归：`npm test`、集成测试通过。

---

## 阶段 5：报告与掌握度（P1）

**目标**：报告结论先行；掌握度口径统一并接入 DB 知识点；预测分数区间。

**改动范围**：
1. 掌握度统一（ROADMAP P2-2）：合并 `getMasteryMap` 与 `computeWeaknessReport` 为单一模型（`packages/shared/src/learning.ts` 提供纯函数），报告层与地图层共用。
2. 接入 DB 知识点（ROADMAP P0-1）：`StudyService` 读取 `KnowledgePointRepository`，导入的 16 个知识点参与掌握度/薄弱/推荐/计划计算；空库与导入库两种部署顺序均可启动。
3. 报告组件：`StageReportPanel.tsx`/新 `ReportSummaryPanel.tsx` 增加"结论先行"区（本周预计提升/主要进步/当前风险/下周最重要任务/长期薄弱点，全部来自 `reports/overview` + `stage-report` + `assessment-history`）。
4. 预测分数：`packages/shared` 新增 `estimatePredictedScore`（基于 accuracyRate、mastery、剩余天数、score trend），返回区间 + `disclaimer: '仅为估算'`；`StudentProgressOverview`/首页展示。
5. 掌握度趋势：`useStudentProgressData` 前端用 `learningCalendar + masteryMap` 生成 7 天真实趋势（替换硬编码）。

**验收标准**：
- 导入题库后掌握度地图显示 ≥16 个知识点，且与薄弱/推荐一致（同一知识点结论一致）。
- 报告页第一屏为"结论"，图表在结论之后。
- 预测分数带免责文案。
- 回归：`npm run build:web/api`、`npm test`、`npm run test:integration:postgres`。

---

## 阶段 6：移动端与边界状态（P1）

**目标**：底部导航 ≤5 项；全页面统一边界状态；返回状态恢复。

**改动范围**：
1. `RoleNavigation.tsx` + `styles.css`：学生端 ≤720px 底部固定导航（首页/学习/练习/错题/我的），把 `dashboard+plan→首页`、`question→练习`、`wrong-book→错题`、`report→我的（含报告与账号入口）`、`ai` 收敛进"练习/我的"；桌面保留侧边栏。
2. 边界状态补齐：`PracticePanel`（loading/error/retry）、`ExamSession`（交卷失败提示、刷新恢复提示、重复提交禁用）、`TutorPanel`（AI 超时提示 + 重试）、`OnboardingWizard`（重复提交禁用）、`MistakeWorkspace`（错误 + 重试）。
3. 错误提示规范：统一"哪里失败 / 数据是否安全 / 可采取操作"三要素（`ModuleResourceState.tsx` 扩展或约定）。
4. 状态恢复：无路由下，首页/练习用 sessionStorage 记录上次 section；刷新后 `useRoleSectionNavigation` 恢复；未提交会话继续由 `ResumeSessionBanner` 恢复。
5. 响应式验收：横向溢出、题目/公式、表格、弹窗、图表、选项点击区域逐项核对（`@media (max-width: 720px)`）。

**验收标准**：
- 移动端底部导航 ≤5 项且每项指向唯一内容。
- 主要页面在加载/空/错误/网络中断下均有正确提示与重试。
- 交卷失败不再静默；刷新后回到上次所在页面（或明确提示）。
- 视觉验收：无横向滚动，答题选项点击区域 ≥40px 高。

---

## 阶段 7：AI 答疑与智能推荐（P1）

**目标**：真实上下文 AI 答疑 + 分层提示 + 变式推荐；写 `AiTutorLog`。

**改动范围**：
1. `POST /ai/tutor-reply` 扩展入参：`level?: 1|2|3|4`、`mistakeReason?`、`relatedWrongQuestionIds?`；后端聚合"当前题目 + 用户答案 + 正确答案 + 知识点 + 错因 + 最近错题"上下文。
2. 接入真实模型（需新增 provider + 环境变量，生产禁 mock）：`AiTutorLog` 每次调用写库（`prompt/response/questionId/userId`）。
3. 前端 `App.tsx handleAskTutor`：移除硬编码 `selectedAnswer: 'A'`，携带真实答案/错因/上下文；`TutorPanel.tsx` 支持四级递进按钮（提示思路 → 部分步骤 → 完整解析）与快捷问题。
4. 结构化解析：`Question.analysis` 拆分为"考点/步骤/错项原因/误区/同类识别/关联知识点"（新字段或约定格式），AI 与标准解析共用。
5. 反馈闭环：`FeedbackPanel` 增加"题目有误/答案有误/解析不清楚/知识点分类错误/AI 回答有问题"分类；`FeedbackSubmission.scene` 复用或扩展枚举。
6. 变式题推荐增强：基于同知识点 + 错因类型选择变式（如"概念混淆"→易混辨析题）。

**验收标准**：
- AI 请求携带真实上下文（无硬编码答案），失败/超时有明确提示与重试。
- `AiTutorLog` 有写入记录，可在管理端查看/审核（复用 `review-queue` 的 `ai_reply` 类型）。
- 四级分层提示可用；每级内容递减（L1 只给考点，L4 才完整解析）。
- 生产环境无 AI mock 回退（`isMockAllowed()` 门禁保持）。

---

## 全局验收门禁

- 每阶段完成：`npm run build:api`、`npm run build:web`、`npm test` 全绿；涉及数据层时跑 `npm run test:integration:postgres`。
- 生产/预发环境禁止任何 mock（`apps/web/src/api/env.ts`）；前端静态演示模式（github.io）与本地 DEV 的 mock 回退保持设计内行为。
- 破坏性迁移（drop/rename/清表）需先说明数据迁移方案与回滚方式并经确认（根目录 `AGENTS.md` §6）。
- 每阶段不改动与阶段无关的文件；禁止在 P0 阶段引入社区/排行榜等非核心功能。

## 建议执行顺序（最小闭环优先）

1. 先做**阶段 0 + 阶段 3 的"会话错因回填 + 单题解析"**：恢复数据真实性与基础练习闭环。
2. 再做**阶段 1（首页驾驶舱）**：让用户每天进入有明确主行动。
3. 然后**阶段 4（错题筛选 + 变式复测）**：闭环中最影响提分的部分。
4. 之后按 2 → 5 → 6 → 7 推进。
