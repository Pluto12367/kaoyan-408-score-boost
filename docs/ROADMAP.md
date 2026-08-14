# 开发路线图（ROADMAP）

> 说明：任务按 P0 / P1 / P2 排列，围绕 408 提分核心闭环；每个任务包含 问题 / 目标 / 涉及模块 / 验收标准 / 风险 / 当前状态。不加入与核心目标无关的功能。状态取值：未开始 / 进行中 / 待验证 / 已完成 / 待确认。

## 闭环环节映射

登录 → 诊断 → 计划 → 做题 → 答题记录 → 解析 → 错题 → 掌握度 → 薄弱 → 推荐 → 阶段报告

每个任务标注其对应的闭环环节，优先打通"做题 → 记录 → 错题 → 掌握度 → 薄弱 → 推荐 → 报告"。

## P0

### P0-1 知识点目录接入学习引擎

- 闭环环节：掌握度 / 薄弱 / 推荐 / 计划
- 问题：`StudyService` 只持有 4 个内置知识点；导入的 16 个知识点（`scripts/import-questions.mjs` 内置）不参与掌握度、薄弱、推荐与计划计算；`createKnowledgePoint` 只改内存、不落库，新建知识点重启即丢失。
- 目标：学习引擎以数据库知识点目录为准，全部题目都能关联到真实知识点并参与闭环。
- 涉及模块：`apps/api/src/study/study.service.ts`、`knowledge-point.repository.ts`（已实现但未接入）、`study.module.ts`、`practice-record.repository.ts`；`scripts/import-questions.mjs`。
- 验收标准：
  1. 导入 320 题后 `GET /knowledge-points` 返回 16 个以上知识点；
  2. 对任意导入题答错后，错题详情、掌握度地图、薄弱报告、推荐题组均以该知识点正确命名展示；
  3. `POST /knowledge-points` 新建知识点后重启 API 仍存在；
  4. 空库与已导入库两种顺序部署 API 均能正常启动。
- 风险：内存与 DB 一致性；既有 `PracticeRecord` 对缺失知识点的兜底显示。
- 当前状态：已完成（2026-08-05，`KnowledgePointRepository` 接入 StudyService，导入知识点参与掌握度/薄弱/推荐/计划；`POST /knowledge-points` 持久化；空库/已导入库两种启动顺序均已覆盖）。

### P0-2 知识目录全量接入经典学习闭环

- 闭环环节：掌握度 / 薄弱 / 推荐 / 计划 / 错题命名
- 问题：经典闭环以 16 个粗粒度 `KnowledgePoint` 计算，而 408 知识目录（`KnowledgeNode`，1149 原子点）只被知识图谱与“今日提分”引擎使用；两套掌握度口径并存，图谱与闭环数据割裂。
- 目标：让经典闭环以全量目录为准（或与今日提分引擎统一口径）。
- 涉及模块：`apps/api/src/study/study.service.ts`、`knowledge-point.repository.ts`、`KnowledgePointNodeMap`/`KnowledgeNode` 表、`packages/shared`（命名解析纯函数）、前端掌握度地图/报告。
- 验收标准：见 `docs/superpowers/specs/2026-08-14-knowledge-catalog-engine-design.md` 第 5 节。
- 风险：16 粗粒度点 → 1149 原子点映射需教研确认；历史 `PracticeRecord` 归因兜底；统一口径（方案 C）影响面大。
- 当前状态：进行中（2026-08-14 方案 B 的映射/命名/接线已完成并部署；计算层面口径统一走方案 C：Phase 1 历史 `PracticeRecord` 回填 `UserKnowledgeMastery` 脚本与题库清重已完成（阶段 0，未提交），知识图谱页掌握度着色（阶段 1，`GET /knowledge/mastery` + 节点状态徽章 + 详情抽屉“我的掌握度/去练习”）已完成并通过全量测试与集成测试；待提交部署并浏览器验证；后续阶段 2 起将图谱掌握度接入推荐/计划（只读切换，可回滚））。

## P1

### P1-1 会话模式考试写入评估历史

- 闭环环节：阶段报告
- 问题：前端考试走 `ExamSession` 会话流（`submitPracticeSession`），提交后 `GET /assessment-history` 不更新；只有旧 `submitPaper` 路径写 `assessmentHistoryItems`。
- 目标：每次会话提交（考试/阶段测验/题组）幂等生成评估历史，报告趋势有真实数据。
- 涉及模块：`apps/api/src/study/study.service.ts`（submitPracticeSession / getAssessmentHistory）、评估历史存储（RuntimeState JSON 或新表，方案待确认）。
- 验收标准：UI 完成一次模拟考试后历史面板出现该次记录；重复提交不产生重复项。
- 风险：历史去重；既有 RuntimeState JSON 历史迁移。
- 当前状态：已完成（2026-08-05，P1-1 会话提交幂等写评估历史；P2-1 转正式表）。

### P1-2 全新库"先导入后启动"启动崩溃修复

- 闭环环节：部署可靠性（影响做题/记录可用性）
- 问题：空库先执行 `npm run questions:import` 再启动 API 时，`PracticeRecordRepository.initialize` 的 3 条演示记录引用内置 q-001，而 `QuestionsService.refreshFromDatabase` 已用导入题替换内存题库 → 外键失败 → Nest 启动失败（代码路径推断，待实测确认）。
- 目标：任意部署顺序均可启动。
- 涉及模块：`apps/api/src/questions/questions.service.ts`、`apps/api/src/study/practice-record.repository.ts`。
- 验收标准：空库 → import → 启动成功；空库 → 启动 → import 也成功。
- 风险：低。
- 当前状态：已完成（2026-08-05，A1/P1-2 修复：seed 记录按题库目录过滤，`test:integration:import-first` 验证两种启动顺序）。

### P1-3 AI 答疑降级或真实化

- 闭环环节：解析
- 问题：`createTutorReply` / `createAiFollowUp` 为模板规则实现，无真实模型调用；前端 `handleAskTutor` 硬编码 `selectedAnswer: 'A'`；`AiTutorLog` 表从未写入。
- 目标：明确"规则解析助手"定位并移除硬编码，或接入真实模型并落审计日志。
- 涉及模块：`apps/api/src/study/study.service.ts`、`apps/web/src/App.tsx`、`AiTutorLog` 表。
- 验收标准：答疑请求不再依赖硬编码答案；每次答疑可审计（表或日志）。
- 风险：若接入模型需外部依赖与成本确认，范围易膨胀。
- 当前状态：已完成（2026-08-06，阶段 7：DeepSeek 真实调用 + 四层提示 + 上下文携带 + `AiTutorLog` 写库；未配置 Key 时降级标准解析模板并明确标识）。

### P1-4 题库内容正式入库与推荐体验

- 闭环环节：做题 / 推荐
- 问题：内置仅 2 道题；320 道自编题 CSV 靠手动脚本导入，流程未固化，推荐题组/阶段测验在未导入时近乎为空。
- 目标：形成可重复、幂等、文档化的内容入库流程，推荐与测验有真实题量。
- 涉及模块：`scripts/import-questions.mjs`、`kaoyan-408-content-starter/`、部署文档（`docs/deployment-checklist.md` 等）。
- 验收标准：导入可重复执行（指纹去重幂等）；推荐题组与阶段测验非空；导入后学习闭环（错题/掌握度/推荐）可用。
- 风险：内容质量需教研复核（`docs/content-guideline.md`、`docs/review-checklist.md`）。
- 当前状态：已完成（2026-08-05，A2/P1-4：`content-import` 幂等入库 + 操作手册 + 集成验证；腾讯云已导入 320 题）。

## P2

### P2-1 评估历史 / 试卷 / 系统配置转正式表（已完成）

- 闭环环节：阶段报告
- 问题：`papers`、`assessmentHistoryItems`、`systemConfig` 存 `RuntimeState` JSON，不可查询、无审计、多实例不一致。
- 目标：核心历史数据建模为正式表（如 `AssessmentHistory`、`Paper`），RuntimeState 只保留真正的运行时状态。
- 涉及模块：`prisma/schema.prisma`（迁移）、`apps/api/src/study/study.service.ts`、`runtime-state.repository.ts`。
- 验收标准：历史记录可 SQL 查询；旧 JSON 数据可迁移；API 响应兼容。
- 风险：需要迁移与兼容层；与 P1-1 存在依赖，建议先做 P1-1 再评估。
- 当前状态：已完成（2026-08-05，迁移 `20260805100000_reporting_tables` + 三个 repository + 回填与持久化断言）。

### P2-2 掌握度口径统一

- 闭环环节：掌握度 / 薄弱
- 问题：`getMasteryMap`（正确率×0.7 + 覆盖度×0.3）与 `computeWeaknessReport`（错误率×100 + 重要性×8 + 频率×6）两套口径并存，同一知识点结论可能不一致。
- 目标：统一为单一掌握度模型，报告层口径一致。
- 涉及模块：`packages/shared/src/learning.ts`、`apps/api/src/study/study.service.ts`。
- 验收标准：同一数据集下 mastery-map 与 weakness 报告结论一致；既有前端展示无破坏。
- 风险：算法变更影响推荐与计划输出。
- 当前状态：已完成（2026-08-06，阶段 5：`computeMasteryReport` 统一口径，mastery-map 与薄弱报告同一结论）。

### P2-3 StudyService / App.tsx 拆分

- 闭环环节：整体可维护性
- 问题：`StudyService` 3655 行、`App.tsx` 1300+ 行，单文件过大，迭代风险高。
- 目标：按职责拆分为可独立测试的服务/组件，不改变对外行为。
- 涉及模块：`apps/api/src/study/`、`apps/web/src/App.tsx`。
- 验收标准：重构后 `npm test`、集成测试、UI 冒烟全绿；端点响应逐字节兼容（或至少语义兼容）。
- 风险：纯重构也需完整回归；禁止与功能开发混在同一提交。
- 当前状态：进行中（2026-08-07 用户已确认实施；已完成行为不变的安全抽取：`App.tsx` 导航工具抽到 `features/navigation/useRoleSectionNavigation.ts`（含 withTimeout），`StudyService` 日期工具抽到 `study-date.ts`、评估历史摘要抽到 shared `assessmentHistorySummary.ts`，另有 `accumulateTaskProgress`/`rebalanceTaskLoad`/`isSlowAnswer`/多知识点归因等纯函数入 shared；`App.tsx` 1458 行、`StudyService` 3850 行，继续按模块抽取有状态逻辑）。

### P2-4 多知识点题目记录优化

- 闭环环节：答题记录 / 薄弱
- 问题：`PracticeRecord.knowledgePointId` 只取题目 `knowledgePointIds[0]`，多知识点题目的薄弱归因可能偏差。
- 目标：记录全部关联知识点（分拆记录或加快照字段）。
- 涉及模块：`prisma/schema.prisma`（迁移，待确认）、`apps/api/src/study/study.service.ts`、`practice-record.repository.ts`。
- 验收标准：多知识点题答错后各关联知识点均能体现掌握度变化。
- 风险：记录量增长；统计口径变化。
- 当前状态：已完成（2026-08-06，迁移 `20260806120000_practice_record_knowledge_points`：`PracticeRecord.knowledgePointIds TEXT[]` 快照全部关联知识点，掌握度归因计入每个关联点；集成测试通过）。

### P2-5 演示模式标识与本地开发体验

- 闭环环节：整体体验
- 问题：无 `DATABASE_URL` 时全站为内存演示数据，本地开发容易误认为真实产品数据。
- 目标：演示模式更醒目（UI 标识 + 文档提示），降低误判。
- 涉及模块：`apps/web/src/components/ApiStateIndicator.tsx`、`apps/web/src/api/env.ts`、`docs/`。
- 验收标准：演示模式下界面明确标注数据来源；生产环境无任何演示标识。
- 风险：低。
- 当前状态：已完成（2026-08-06，演示模式横幅 + API pill 提示「演示数据/未连接真实后端」，生产禁 mock 门禁保持）。

### P3-1 教师端学情报告与 AI 辅助页面（占位导航待实现）

- 闭环环节：整体体验（教师侧，非核心闭环）
- 问题：教师端导航含"学情报告""AI 辅助"两项，但 `TeacherWorkspace` 不按 section 切换内容，点击仅切换高亮、无页面内容（2026-08-05 线上确认）。
- 目标：保留占位入口，后续为核心闭环完成后实现教师端学情报告（复用班级学情/学生画像数据）与 AI 辅助页面；在此之前不误导为可用功能。
- 涉及模块：`apps/web/src/layouts/RoleNavigation.tsx`（teacherItems）、`apps/web/src/features/teacher/TeacherWorkspace.tsx`
- 验收标准：点击两项导航能进入对应页面并有真实数据（或明确标注"建设中"）。
- 风险：范围膨胀；实现需在核心闭环稳定后进行。
- 当前状态：已完成（2026-08-06，教师端按导航分页：学情报告独立页复用班级学情数据，AI 辅助为诚实「建设中」占位，不展示假功能）。

## 2026-08-06 追加项

- 错题筛选服务端化：`MistakeWorkspace` 改调 `GET /wrong-questions` 服务端筛选（8 维），演示模式保留客户端兜底；状态：已完成。
- 行为埋点：`UserEvent` 表（迁移 `20260806130000_user_events`）+ `POST /events` + 核心闭环动作（practice.submit / session.submit / task.complete / wrong.review / assessment.import）best-effort 落库；状态：已完成。
- AI 变式题入库：已完成（2026-08-07，`POST /questions/:id/ai-variant` 生成 + `POST /questions/:id/ai-variant/confirm` 教师确认入库，未配 `AI_API_KEY` 明确报错不静默回退；AiTutorLog 审计；教师端「AI 变式」按钮 + 预览确认；`test/ai-variant.test.js`）。生成题进入既有待审核队列，遵循教研复核门禁。
- 前端细粒度埋点：已完成（2026-08-07，`api/events.ts` best-effort 上报，App/TodayPlan 关键 UI 动作埋点：nav.continue_today、practice.*、wrong.open_review、tutor.ask、assessment.generate、task.* 等）。

## 明确不做（避免范围膨胀）

- 多 Agent 协作功能。
- 复杂知识图谱可视化。
- 3D 页面、过度动画。
- 无真实数据支持的 AI 功能。
- 数学/英语/政治等非 408 学科扩展。
- 与核心提分闭环无关的管理功能。
