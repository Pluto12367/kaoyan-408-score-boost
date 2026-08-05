# UX 改进规格（ux-improvement-spec）

> 维护约定：本文档描述"目标体验 + 差距 + 数据模型建议"，与 `docs/ux-audit.md`（现状）配套；验收标准见 `docs/ux-implementation-roadmap.md`。基线 commit：`eceb7a2`（2026-08-05）。本轮不修改业务代码。

## 1. 核心原则

1. 首页回答三问：今天做什么 / 哪里最薄弱 / 最近是否进步。
2. 减少决策成本：每次进入只给 1 个主行动（继续今日学习）+ 3~5 个核心任务。
3. 蒙对不等于掌握：记录自信度、耗时、是否看提示、是否改答案、错因。
4. 错题状态必须由系统判定（连续变式答对 + 合理时间 + 高自信 + 间隔后复测），不能只靠手动标记。
5. 所有推荐必须带原因，所有预测必须带免责说明。
6. 复用现有表与组件，优先字段扩展，禁止为美观重写全部组件。

## 2. 用户核心流程与断点

```
注册 → 初始化 → 诊断 → 生成计划 → 开始学习 → 做题 → 查看解析 → 错题复习 → 复测 → 查看报告
```

| 步骤 | 当前实现 | 断点/问题 |
|---|---|---|
| 注册 | 邀请码注册（`InvitationService`） | 无 |
| 初始化 | `OnboardingWizard`：年份/目标分/当前分/天数/每日小时/最弱科 | 缺四科基础、缺"导入已有成绩"入口；完成即跳过，无"开始快速诊断"入口 |
| 诊断 | `applyDiagnosticProfile` + `DiagnosticSummary` | 无结果页（预计水平/TOP 3~5/推荐任务/原因/时间/顺序）；"提交演示诊断"文案错误 |
| 生成计划 | `completeOnboarding` → `buildSevenDayPlan` + `StudyTask` | 计划为一次性 7 天；后续任务量调整未落库 |
| 开始学习 | 首页"继续刷题"→ 直接开模拟考 | 与"继续今日学习"目标不符；无任务→练习的衔接 |
| 做题 | `PracticePanel`（单题）/ `ExamSession`（组题/测评/考试） | 无三模式；无自信度/提示/改答记录；单题答后无解析 |
| 查看解析 | `PracticePanel.status` 文本；错题详情/考试报告有解析 | 学习模式缺"即答即析"；解析无"考点/步骤/错项原因/误区/同类识别/关联知识点"结构 |
| 错题复习 | `MistakeWorkspace` + `WrongQuestionDetail` | 无筛选；"已掌握"靠手动重做 3 次；无变式题复测流程 |
| 复测 | `reportWrongReason` 重做同题 | 无"同知识点变式题"复测；无易混辨析/综合应用题 |
| 查看报告 | `StageReportPanel`/`ExamReport`/`LearningProfilePanel` | 无结论先行；无预测分数/长期薄弱点 |

## 3. 模块目标规格

### 3.1 新用户引导
- 信息收集：考研年份、目标分、当前复习阶段、每日可学习时间、四科基础、历史成绩（可选）。
- 两个入口：`开始快速诊断` / `导入已有成绩`。
- 不展示复杂功能；完成后进入"诊断结果页"而非直接跳首页。

### 3.2 首页学习驾驶舱（P0）
首屏（单一主行动）：
- 今日任务卡片（3~5 个，含推荐原因、预计分钟、剩余时间）。
- 完成进度 + 预计剩余时间。
- 主按钮：`继续今日学习`（回到第一个未完成任务 → 对应练习）。
二屏（数据驱动）：
- 最薄弱知识点 TOP3（正确率 + 原因）。
- 预测分数区间（含"仅为估算"说明）。
- 最近掌握度趋势（7 天柱/线图，真实数据）。
- 错题复习提醒（到期复习数 + 入口）。

### 3.3 诊断结果页
- 当前预计水平（阶段 + 估分区间）。
- 最影响提分的 3~5 个问题（知识点 + 错因 + 影响分）。
- 各科/知识点掌握度（真实记录聚合）。
- 推荐优先任务（原因、预计学习时间、建议顺序）。

### 3.4 学习计划（动态调整）
- 输入：剩余天数、实际学习时间、历史完成率、掌握度、考点重要性、近期练习/模考、错题复测。
- 逾期任务操作：`重新安排` / `降低本周任务量` / `只保留高优先级`。
- 每个任务必须有 `reason`；每日默认 3~5 个核心任务（`StudyTask` 已支持 `priority/reason/postponeCount`）。

### 3.5 练习页面（三模式）
- 学习模式：每题作答后立即展示解析（考点/步骤/错项原因/误区）。
- 训练模式：一组完成后统一展示解析与错因选择。
- 模拟模式：严格计时、不提前给答案、交卷后统一报告。
- 答题时可选：确定 / 不确定 / 完全不会；记录耗时、是否改答案、是否看提示。
- 错因 8 类：知识点没学过 / 概念混淆 / 公式记错 / 计算错误 / 审题错误 / 推理过程错误 / 时间不足 / 蒙题。每个错因对应不同学习建议。

### 3.6 答案解析与 AI 答疑
- 标准解析结构：正确答案 / 核心考点 / 解题步骤 / 其他选项错误原因 / 常见误区 / 同类题识别 / 关联知识点。
- AI 上下文自动携带：当前题目、用户答案、正确答案、当前知识点、用户错因、最近相关错题。
- 快捷问题：更简单解释 / 为什么此选项错 / 给我一道类似题 / 只提示思路 / 对比易混概念。
- 分层提示：L1 考点 → L2 思路 → L3 部分步骤 → L4 完整解析（`tutor-reply` 增加 `level` 参数或独立端点）。
- AI 内容必须标识"AI 生成，以标准解析为准"，并支持反馈。

### 3.7 错题复习
- 筛选：科目 / 章节 / 知识点 / 错误类型 / 错误次数 / 掌握状态 / 最近复习时间 / 重要程度。
- 状态：未掌握 / 复习中 / 已掌握（系统判定）。
- 掌握判定：同知识点变式题连续答对 N 次 + 时间合理 + 自信度高 + 间隔后复测正确。
- 复习内容：原题回顾 → 同知识点变式题 → 易混概念辨析 → 综合应用。
- 间隔复习动态调整（`ReviewSchedule.nextReviewAt` 已支持）。

### 3.8 提分报告
- 结论先行：本周预计提升 / 主要进步 / 当前风险 / 下周最重要任务 / 长期未解决薄弱点。
- 再展示图表：成绩趋势、掌握度、错题处理、学习量。

### 3.9 移动端
- 底部导航 ≤5 项：首页 / 学习 / 练习 / 错题 / 我的（合并 dashboard+plan、question、wrong-book、report、账号）。
- 检查项：横向溢出、题目/公式展示、表格响应式、弹窗尺寸、图表可读性、选项点击区域、返回状态恢复。

### 3.10 边界状态
- 加载 / 空 / 错误 / 网络中断 / 重试 / 自动保存 / 刷新恢复 / 重复提交 / AI 超时 / 模拟考试异常恢复。
- 错误提示三要素：哪里失败、数据是否安全、用户可做什么。

### 3.11 用户信任
- 说明：掌握度如何计算、为什么推荐此任务、预测分数仅为估算、哪些内容由 AI 生成、AI 可能出错。
- 反馈分类：题目有误 / 答案有误 / 解析不清楚 / 知识点分类错误 / AI 回答有问题。

## 4. 差距分析表

| 维度 | 当前情况 | 目标情况 | 差距 | 影响 | 优先级 | 涉及文件 | 难度 |
|---|---|---|---|---|---|---|---|
| 首页数据真实性 | 硬编码 KPI/科目/趋势 | 全部来自 API | 生产展示假数据 | 信任崩塌、数据误导 | P0 | `StudentLaunchpad.tsx`、`App.tsx` | 低 |
| 信息架构 | dashboard=plan=report 混叠 | 首页=驾驶舱，单入口 | section 重复渲染 | 决策成本高 | P0 | `App.tsx`、`RoleNavigation.tsx` | 中 |
| 首页主行动 | "继续刷题"=开模拟考 | "继续今日学习" | 行为与目标不符 | 用户迷失 | P0 | `StudentLaunchpad.tsx` | 低 |
| 练习三模式 | 单题无解析/组题无学习模式 | 学习/训练/模拟 | 无即时解析与自信度 | 蒙对当掌握 | P0 | `PracticePanel.tsx`、`ExamSession.tsx`、`learning-session.dto.ts` | 中 |
| 错因 8 类 | 5 类 + 会话"待复盘" | 8 类 + 差异建议 | 错因不完整、不落库 | 建议不精准 | P0 | `shared/learning.ts`、`domain.ts`、`study.service.ts`、DTO | 中 |
| 答题元数据 | 无自信度/提示/改答 | 记录 6 项 | 无法识别蒙对 | 掌握度失真 | P0 | `PracticeRecord` 模型、DTO、`ExamSession.tsx` | 中 |
| 错题筛选/状态 | 无筛选，两态 | 8 维筛选 + 三态 | 复习效率低 | 错题堆积 | P0 | `study.controller.ts`、`study.service.ts`、`MistakeWorkspace.tsx` | 中 |
| 变式复测 | 仅同题重做 | 变式题 + 掌握判定 | 无真实复测 | "已掌握"不可信 | P0 | `study.service.ts`、`review-schedule.repository.ts`、题库内容 | 高 |
| 诊断结果页 | 4 个数字 | 水平/TOP/任务/顺序 | 无行动指引 | 诊断后迷茫 | P1 | `DiagnosticSummary.tsx`、`study.service.ts` | 中 |
| 动态计划 | 7 天一次性 | 按表现调整并落库 | 无长期调整 | 计划失真 | P1 | `onboarding-plan.repository.ts`、`study.service.ts` | 高 |
| 预测分数 | 无 | 区间 + 免责 | 缺激励反馈 | 无法感知进步 | P1 | 共享纯函数、报告组件 | 中 |
| 掌握度趋势 | 硬编码柱 | 真实 7 天趋势 | 无真实趋势 | 无法判断进步 | P1 | `StudentLaunchpad.tsx`、`useStudentProgressData.ts` | 中 |
| AI 分层/上下文 | 模板 + 硬编码 'A' | 分层 + 真实上下文 | 无真实答疑 | 答疑价值低 | P1 | `study.service.ts`、`tutor.ts`、`TutorPanel.tsx` | 中 |
| 报告结论先行 | 数字开头 | 结论→图表 | 无行动建议 | 报告不落地 | P1 | `StageReportPanel.tsx`、`WeaknessReportPanel.tsx` | 低 |
| 移动底部导航 | 无 | ≤5 项底栏 | 移动端导航差 | 移动体验差 | P1 | `RoleNavigation.tsx`、`styles.css`、`App.tsx` | 中 |
| 边界状态 | 部分页面有 | 全页面统一 | 交卷静默失败等 | 数据安全感知差 | P0 | `ExamSession.tsx`、`PracticePanel.tsx`、`ModuleResourceState.tsx` | 低 |
| 信任说明/反馈分类 | 无 | 说明 + 5 类反馈 | 缺信任建设 | 使用顾虑 | P1 | `FeedbackPanel.tsx`、`shared/domain.ts` | 低 |
| 行为埋点 | 无 | 事件表/接口 | 无法度量 | 优化无据 | P2 | 新表 + 新接口 | 中 |

## 5. 数据模型建议（优先复用，最小新增）

### 5.1 可直接复用
- 学习任务推荐原因：`StudyTask.reason / priority / nextAction / postponeCount / nextAvailableAt` 已具备。
- 间隔复习：`ReviewSchedule.nextReviewAt / consecutiveCorrect / stability / reviewCount / ReviewAttempt` 已具备。
- 评估历史：`AssessmentHistoryItem`（含 score/totalScore/accuracyRate）可承接"导入已有成绩"（title 标记来源）。
- 错题笔记：`ReviewSchedule.note` 已具备。
- 系统说明文案：`SystemConfig` 或前端常量。

### 5.2 建议新增字段（向后兼容，加字段不破坏现有 API/迁移）

| 表 | 新增字段 | 用途 |
|---|---|---|
| `PracticeRecord` | `confidence String?`（`确定/不确定/完全不会`） | 识别蒙对 |
| `PracticeRecord` | `usedHint Boolean @default(false)` | 是否查看提示 |
| `PracticeRecord` | `answerModified Boolean @default(false)` | 是否修改答案 |
| `PracticeRecord` | `variantQuestionId String?`（或 `isVariant Boolean`） | 变式复测标记 |
| `User` | `subjectBaselines Json?` | 四科基础（`{ds,co,os,net}` 水平） |
| `User` | `hasHistoryScore Boolean @default(false)`、`historyScore Int?` | 历史成绩导入标记 |
| `ReviewSchedule` | `masteryCriteria Json?` | 掌握判定依据快照（连续答对/时间/自信度/复测） |

> 说明：`mistakeReason` 是 `String?` 字段，扩展 8 类错因**不需要迁移**，只需同步 `packages/shared/src/domain.ts` 类型、`classifyMistake` 规则与 UI 选项。
> `confidence/usedHint/answerModified` 可直接并入现有 `PracticeRecord` 表；若担心迁移，可先用 `session.answers` 的 Json 快照过渡（`LearningSession.answers` 已存每题答案，可扩展存元数据），正式字段延后。

### 5.3 建议新增表（仅当确有需要）

| 表 | 字段要点 | 理由 |
|---|---|---|
| `UserEvent`（行为埋点） | `id/userId/type/payload Json/createdAt` | 现有 `OperationLog` 只记录 API 访问，不能表达"点击了推荐任务/查看了解析/切换了模式"等产品事件 |
| `VariantQuestion`（可选） | `questionId/sourceQuestionId/variantType` | 若需显式维护"同知识点变式题组"关系；否则可用 `QuestionKnowledgePoint` + `findSimilarQuestions` 替代，**建议先用替代方案不加表** |

### 5.4 明确不加表/不加字段的项
- 预测分数：用共享纯函数（`packages/shared`）基于 `accuracyRate + mastery + remainingDays + score trend` 估算，返回区间 + 免责文案，不落库。
- 错题状态（未掌握/复习中/已掌握）：由 `ReviewSchedule.stability + consecutiveCorrect + 变式复测结果` 推导，不新增字段。
- 掌握度：维持实时计算，但统一口径（合并 `getMasteryMap` 与 `computeWeaknessReport`，P2-2）并接入 DB 知识点（P0-1）。

## 6. 冲突与替代方案说明

- **需求冲突：新增字段 vs 迁移成本**。方案：所有新增字段可空/带默认值，先部署迁移再上线新前端；`confidence` 等可先用会话快照过渡。
- **需求冲突：变式题闭环 vs 题库内容量**。现状 320 题、16 知识点，同知识点多题足够支撑变式；若某知识点题量不足，推荐"同章节/易混考点"题作为降级，并在 UI 标注。
- **需求冲突：AI 答疑 vs 生产禁 mock**。真实模型调用需新增 provider + 环境变量（如 `OPENAI_API_KEY`/网关），且 `AiTutorLog` 必须写库；在接入前保持"标准解析辅助"定位并明确标识，禁止伪 AI。
- **需求冲突：移动底栏 vs 现有 section 结构**。先收敛重复 section（§4 P0 信息架构），再改导航为 ≤5 项，避免底栏指向重复内容。
