# V4-1 Adaptive Learning Audit

> 日期：2026-09-06。只读审计。证据等级标注：**[实证]** = v3.4 闭环脚本/测试以真实 DB 行验证；**[链路]** = 代码+既有测试证明链路存在；**[缺失]** = 能力不存在。

## 1. 七问逐项回答

### Q1 学生表现变化能否改变 StudentContext？——**能 [实证]**

v3.4 closed-loop eval（`scripts/v34-closed-loop-eval.mjs`，真实 DB 行）：错题×2 → `UserKnowledgeMastery` 0.402；练对×2 → 0.596；StudentContext.mastery 桶随之变化（weakPoints 携带真实节点；coach 二次装配 weak 1→0、avgMastery 40→60）。路径：practice 提交 → ScoreCenter.applyAttempts → mastery 行 → StudentStateProjection → StudentContext。

### Q2 StudentContext 能否影响 Recommendation？——**语义上能，架构上是平行视图 [实证+架构事实]**

关键架构事实（本轮审计澄清）：推荐引擎**不读 StudentContext**——`RecommendationService.runRecommendationForUser` 直接消费 Source Facts（`loadMasteries` + `loadEvidenceNodes` + `loadLatestFrequencySnapshots` + `loadKnowledgeRelations`）。StudentContext 与推荐引擎是**同一事实源的两个并行只读视图**。闭环语义成立并已实证：练错→mastery 行变化→引擎 priority 46；练对→0.596→priority 39（同节点、同证据、仅 mastery 状态不同）。**对 V4 的含义**：Signal/Risk 层应作为引擎的**前置适配**（证据增强/输入权重/结果重排），而非"经 StudentContext 改写引擎输入"——引擎输入契约（`RecommendationInput`）是既定边界。

### Q3 Recommendation 能否影响 StudyPlan？——**能 [实证]**

`generateDailyPlanFromState`（引擎唯一持久化入口）：推荐 items → TASK_DRAFT → validatePlan → StudyPlan+StudyTask 落库（generationKey 幂等，v3.4 agent eval 实测 delta=0）。planner `execute:true` 走同一通道。

### Q4 StudyPlan 能否真正影响下一次学习行为？——**链路存在 [链路]，主动性缺失 [缺失]**

- StudyTask 经 StudentHome/TodayMission 呈现，完成走 `completeStudyTask` → `StudyTaskCompletion` + `task.complete` 触发（`learning-loop-trigger.service.ts`：`isTodayComplete` → 次日计划 generationKey `LEARNING_LOOP:{userId}:{date}:v1`）→ 新 StudyPlan。[链路]
- 缺口：触发是**事件响应式**（完成才生成次日），无基于风险/预测的主动前置调整；强度/难度不自适应（V4-2/3/4 补齐）。

### Q5 学习行为是否重新进入 Student State？——**能 [实证]**

练习/复习提交路径写 PracticeRecord + mastery（applyAttempts/applyReview）+ WrongQuestionReview/ReviewSchedule + StudyTaskCompletion；v3.4 P5/P6 全部以真实行验证（mastery 0.402→0.596、stability null→1.7、WrongQuestionReview 落行）。

### Q6 Agent 能否感知变化？——**能 [实证]**

`getStudentContext` 工具每次实时读 canonical 视图；Learning Memory 每请求从 StudentContext 重新派生（PX-1）；coach 装配二次对比实证（weak 1→0 体现到 knowledgeContext/weakPoints）。

### Q7 系统能否主动改变策略？——**部分，主动层缺失 [缺失] = V4 核心增量**

现有自适应点（孤立的规则，非体系）：
- `deriveDifficultyAdjustment`（DailyPlanningService）：accuracy<50%→reduce；completion≥80% 且 accuracy≥75%→challenge——仅覆盖"难度档位"单一维度、仅在日常计划入口。
- 推荐引擎内置：cooldown（36h×0.55）、prerequisite 替换、phase multipliers、LEARN 上限——被动排序，非主动干预。
- 无持续 Signal 层、无 Risk 判定、无预测、无主动干预（proactive nudge/review 安排/解释触发）。

## 2. 闭环七段成熟度总表

| 段 | 通路 | 成熟度 | V4 动作 |
|---|---|---|---|
| Observe | 行为→Source Facts→StudentContext | **实证完整** | V4-2 信号化（结构化观察输出） |
| Understand | StudentContext→Memory/摘要 | 实证完整（PX-1） | — |
| Predict | 表现→风险/预测 | **缺失** | V4-3 Risk Detector |
| Plan | 推荐→planner→StudyPlan | 实证完整 | V4-4/5 注入 signals/risks |
| Act | StudyTask/Review 呈现与执行 | 链路完整 | V4-8/9 个性化选题/考试 |
| Measure | 结果→mastery/review 状态 | 实证完整 | V4-10/12 评估与度量 |
| Adapt | 结果→策略调整 | **仅单点规则** | V4-4/6/7 自适应层 |

## 3. 信号数据源盘点（V4-2 输入映射）

| 信号 | 数据源 | StudentContext 载体 | 历史需求 |
|---|---|---|---|
| mastery change | mastery 桶 + UserMasterySnapshot（每日快照，表已存在） | mastery.weakNodes/improving/mastered | **需要基线**（快照或调用方注入） |
| accuracy trend | practice.recentAccuracy（含 baseline 对比） | practice.recentAccuracy | 无（自带） |
| wrong streak | mastery.wrongCount/attempts 比例 + review.highRiskQuestions | mastery/review | 精确 per-question streak 需契约演进（TD-V4-2） |
| review overdue | review.dueCount/overdueCount | review | 无 |
| task completion | plan.completion.rate | plan | 无 |
| study consistency | momentum.studyStreak/activityTrend | momentum | 无 |
| knowledge regression | mastery 数值 vs 历史（snapshot 基线） | mastery + 可选基线 | **需要基线** |
| exam performance | AssessmentHistoryItem（**StudentContext v1 未承载**——契约缺口，V4 审计确认） | 无 | 待契约演进或只读 repo（需 ADR） |

## 4. 结论与 V4 路线确认

- **被动闭环（Observe→State→Recommend→Plan→Act→Measure）已实证完整**，V4 不需要重建任何已有环节。
- **主动自适应（Understand→Predict→Proactive→Adapt）为零散规则**：V4-2 Signal → V4-3 Risk → V4-4 Adaptive Layer → V4-6 Proactive 逐层补齐，全部以 StudentContext/Learning Memory 为输入、经既有 canonical 写通道执行。
- 审计确定的两个契约事实（影响设计）：① 推荐引擎与 StudentContext 平行消费事实源，自适应层做**前置适配**；② assessment/精确 streak 为 StudentContext 契约缺口，V4 以"可选基线输入"参数化并在文档登记，不绕过边界直读表。
