# S2 Transfer Probe — Part 1/3：S1→S2 Interface Reality Check

> 日期：2026-09-12 ｜ 性质：READ-ONLY 接口审计（零代码、零 schema、零迁移、零 commit）
> 输入基线：S1 Score Anchor（commit `5e81083`，npm test 2374/2372/0/2，三端构建 PASS，score-anchor/score-loop 集成 PASS）
> 结论先行：**S2 无 DESIGN BLOCKER**；存在 3 处 DESIGN GAP（probe 标记、probe 题池、48h 调度）与 1 处内容依赖（结构同构题供题），全部有干净的插入点，不需要 workaround、不违反冻结契约。
> **文档结构**：Part 1 = §1-11（Reality Check）｜ Part 2 = §12-21（Interface Contract + Boundary）｜ Part 3 = §22-36（Design Gate + Final Audit）。25 节要求对照表见 §35，最终判定见 §36。

---

## 1. 审计范围与方法

逐项核查任务书列出的 20 个实体/能力，全部以当前工作区代码为准（file:model:line 证据）。判定四级：

- **CURRENTLY SUPPORTED** — 今天就能用，有真实调用链与测试
- **PARTIALLY SUPPORTED** — 能力部分存在，缺口明确且可命名
- **DESIGN GAP** — 能力不存在，但插入点干净，S2 设计必须补
- **DATA GAP** — 能力依赖内容/数据侧供给（非工程单方面可解）
- **DESIGN BLOCKER** — 现有架构无法支持（本审计未发现）

---

## 2. 二十项清单核查

| # | 实体/能力 | 现状 | 判定 | 证据 |
|---|---|---|---|---|
| 1 | PracticeRecord | 作答事实主表；字段全集无 source/firstSeen/attemptOrdinal；**有 `variantQuestionId`（变式重测链接）与 `gradingMode`（objective/self_assessed）** | PARTIALLY SUPPORTED | schema.prisma:590-621 |
| 2 | PracticeAttempt/Attempt | 不存在独立 Attempt 实体；作答事实 = PracticeRecord（三条写路径：`createPracticeRecord` 无回执 legacy 路径、`createPracticeRecordWithReceipt` 回执路径（study.service.ts:3137-3191）、`submitPracticeSession` 会话提交（:4536，事务内 applyAttempts :4598）） | CURRENTLY SUPPORTED（作答事实） | study.service.ts |
| 3 | ReviewAttempt | 独立复习重做链；`(scheduleId, idempotencyKey)` 唯一；V12 新增 `isReview/scheduleDriven/source/dueAt`（历史行 NULL=未记录） | CURRENTLY SUPPORTED | schema.prisma:765-789；review-schedule.repository.ts:126-185 |
| 4 | StudyTask | `scheduledDate`（**String 日粒度**）、status pending/completed/postponed、completedAt、`knowledgeNodeId`、mode（新学/复习/练习/错题重做/模拟测试）；与 Action 1:1 | CURRENTLY SUPPORTED（作 attribution 锚） | schema StudyTask model |
| 5 | Recommendation | `RecommendationAction`：状态机 CREATED/STARTED/COMPLETED/CANCELLED/EXPIRED、`creationKey` 唯一、`studyTaskId @unique`（1:1 绑定 StudyTask）、practiceRecords/reviewAttempts 反向关系 | CURRENTLY SUPPORTED | schema RecommendationAction model |
| 6 | Learning Evidence | `EVIDENCE_RECORDED`（UserEvent，`(userId,eventKey)` 唯一，occurrence 键 1:1）；分类学 `LEARNING_ACTION_TAXONOMY`：practice.answered=强客观证据（**canInfluenceMastery=true**）、task.completed=弱、review.marked=none、review.recalled=强、assessment.submitted=强 | CURRENTLY SUPPORTED（探针作答可走 practice.answered 语义） | packages/shared/src/score-center/learning-evidence.ts:147+ |
| 7 | AnswerReceipt | `(userId, idempotencyKey)` 唯一 + requestHash + PENDING→SUCCEEDED/FAILED + practiceRecordIds；重放隔离（replay 不重复触发） | CURRENTLY SUPPORTED（幂等模式样板） | schema AnswerReceipt；study.service.ts:3137-3191 |
| 8 | Question/QuestionBank | `familyId+versionNumber+isCurrent`（版本化）、`contentFingerprint`（精确去重）、difficulty BASIC/MEDIUM/HARD、type SINGLE_CHOICE/COMPREHENSIVE/JUDGEMENT、`source`（自由字符串：章节题/真题改编…）、expectedTimeSec、rubric? | PARTIALLY SUPPORTED | schema Question model |
| 9 | Question source/provenance | source 是内容出处的自由文本，**不是题目用途隔离机制**；无 probe 池标记、无同构度元数据 | DESIGN GAP | schema Question.source；questions.service.ts:29/42 |
| 10 | Assessment（旧） | AssessmentHistoryItem 混来源（S1 已审计）；阶段测评独立通路结果仅内存（study.service.ts:540/3797） | PARTIALLY SUPPORTED | S1 gap report §1.1 |
| 11 | ScoreAssessment | S1 新建：originType+originId 幂等、source 枚举含 DIAGNOSTIC、semantic 区分 exam_total/accuracy_rate | CURRENTLY SUPPORTED | apps/api/src/score-anchor/score-anchor.service.ts |
| 12 | Score Anchor | normalizeScore/validateScoreEvidence/兼容性/E1 门禁全部就绪且有测试 | CURRENTLY SUPPORTED | packages/shared/src/score-anchor/ |
| 13 | Student State | StudentContext 只读派生投影（mastery/weak/momentum/review 汇总），无写路径纠缠 | CURRENTLY SUPPORTED（读侧） | apps/api/src/study/student-context.* |
| 14 | UserKnowledgeMastery | 唯一写方 ScoreCenterService + OCC + 快照；中性初值 0.5（S2 需注意：探针节点的先验是 0.5 直到有作答） | CURRENTLY SUPPORTED | apps/api/src/score-center/service.ts:126-170 |
| 15 | Mastery Engine | `applyMasterySemantics` 单点开关（legacy/C1）；难度目标 EMA | CURRENTLY SUPPORTED（冻结，S2 不触碰） | packages/shared/src/score-center/mastery.ts |
| 16 | Review→Mastery | V12.1 生产链：ReviewAttempt→证据回执→ReviewMasteryIntegrationService→applyReviewObservation→applyMasterySemantics；三层题-节点解析（question-node-resolution.ts） | CURRENTLY SUPPORTED | apps/api/src/study/review-mastery-integration.service.ts:226 |
| 17 | Recommendation→Intervention | Action 1:1 StudyTask；PracticeRecord.actionId 经 `resolvePracticeActionId`（自 session.actionId）；LearningSession.actionId 可绑会话 | CURRENTLY SUPPORTED（独立练习 actionId=null） | recommendation.service.ts:325-376；study.service.ts |
| 18 | Scheduler | **无通用调度器**：无 cron/queue；复习排程是错题 SM-2（saveSchedule/saveReview，nextReviewAt）；StudyTask.scheduledDate 是日粒度字符串；import-cleanup 的 setInterval 与学习调度无关；agent daily-planning 注释明示"设计给外部调度器" | DESIGN GAP | review-schedule.repository.ts；apps/api/src/agent/daily-planning.service.ts:8-12 |
| 19 | Idempotency | 五套成熟模式：AnswerReceipt（PENDING 接管+重放隔离）、ReviewAttempt (scheduleId,idempotencyKey)、StudyPlan generationKey+advisory lock、Action creationKey、UserEvent eventKey；+ S1 predictionKey/originId/dedupKey；mastery OCC version | CURRENTLY SUPPORTED（模式可复用） | 各 schema/model |
| 20 | eventKey/dedup | `UserEvent (userId,eventKey)` 唯一；telemetry allowlist 与 RESERVED 分离；EVIDENCE_RECORDED 走 canonical writer | CURRENTLY SUPPORTED | canonical-event-writer.service.ts:5-56 |

---

## 3. 重点一：AttemptSource（任务书 §2）

### 3.1 已有的等价概念（不新增字段前先盘点）

| 既有字段/机制 | 承载的语义 | 差距 |
|---|---|---|
| `LearningSession.type`（'practice_set'\|'stage_assessment'\|'paper'） | 会话级用途来源；经 `PracticeRecord.sessionId` join 可派生 MOCK/练习/阶段测评 | 日粒度之外无探针类型；会话可被未提交 |
| `ReviewAttempt.isReview` + `ReviewAttempt.source`（'recommendation_action'\|'wrong_question'） | 复习重做的身份与触发来源（V12 迁移新增，历史行 NULL） | 仅覆盖复习链 |
| `PracticeRecord.gradingMode`（'objective'\|'self_assessed'） | 判分方式，不是用途来源 | 语义不同维度 |
| **`PracticeRecord.variantQuestionId`** | **变式重测链接：本次作答是新题，反哺原题的复习状态机** | 最接近 transfer 的既有先例，但仅限"存在原题复习排程"时触发（applyVariantRetest，study.service.ts:3246 起），非排程式、无首见保证 |
| `PracticeRecord.actionId` + `LearningSession.actionId` | 干预归因（哪次推荐产生的作答） | 独立练习为 null |

**结论：当前仓库不存在 `attemptSource` 一等字段；AttemptSource 是跨表 join 的派生事实。** 新增探针标记时应优先评估"沿用派生模式 + 最小标记"（如复用 variantQuestionId 机制扩展，或新增 nullable 列/证据 kind），这是 Part 2 的设计决策点。

### 3.2 五个必需值的映射

| S2 要求 | 现状 | 判定 |
|---|---|---|
| ORIGINAL_PRACTICE | PracticeRecord（sessionId 为空或 type='practice_set'） | **可派生** |
| REVIEW | ReviewAttempt（isReview）+ variantQuestionId 流 | **可派生**（独立表） |
| TRANSFER_PROBE | 无任何承载 | **DESIGN GAP** |
| MOCK | sessionId → LearningSession.type='paper' | **可派生** |
| DIAGNOSTIC | 枚举值存在于 S1 source，但**无诊断测管线**（DiagnosticSummary.tsx 是自报导入 UI；stage_assessment 最接近） | **DATA GAP**（无数据可标） |

### 3.3 首见判定（任务书问句："这道题是否作为 Transfer Probe 的新题第一次呈现？"）

- **"该生是否作答过该题"**：**可可靠判定** —— `EXISTS(PracticeRecord WHERE userId,questionId) ∨ EXISTS(ReviewAttempt 经 schedule join)`；两条链对已判分交互是完备的（幂等台账保证不重复计数）。
- **"该生是否见过（含未作答）"**：**PARTIAL** —— `LearningSession.questionIds` + `questionSnapshot` 覆盖会话内呈现的题（含未答），但 `practice.set_start` 遥测**无题目负载**（App.tsx:742 裸事件），无统一曝光台账。选题器必须三源联查（PracticeRecord ∪ ReviewAttempt ∪ LearningSession.questionIds），这是可行且完备性可论证的，但没有单一 SoT。
- **"作为 Transfer Probe 第一次呈现"**：**不可判定** —— 无探针标记。

> **判定：DESIGN GAP（非 BLOCKED）。** 首见可由三源联查证明（不猜测）；"作为探针呈现"需要 S2 增加显式标记后才有事实。Part 2 必须定义该标记的承载方式与其与 `variantQuestionId` 先例的关系。

---

## 4. 重点二：Probe Pool Isolation（任务书 §3）

四级区分的当前可判定性：

| 级别 | 判定手段 | 现状 |
|---|---|---|
| 1. 同一道题 | `questionId` 相等排除 | **可判定**（三源联查） |
| 2. 换皮同构（同族不同版本） | `Question.familyId`（版本兄弟可枚举）+ `contentFingerprint`（精确重复） | **可判定（族内）**；族外语义同构**不可检测**（无相似度/同构元数据） |
| 3. 同知识点新题 | `QuestionKnowledgeNodeTag` join（PRIMARY/SECONDARY 角色） | **可判定** |
| 4. 真正适合 transfer measurement 的新题 | 需要**人工审定的探针题池**：结构同构、难度分桶匹配（BASIC/MEDIUM/HARD 对齐干预题）、题型匹配（SINGLE_CHOICE/COMPREHENSIVE/JUDGEMENT）、未曝光保证 | **DATA GAP + DESIGN GAP**：系统侧可强制 1-3 + 难度/题型分桶 + 未曝光；级别 4 的"结构同构"只能靠内容审定（contentFingerprint 只防精确重复，不防换皮） |

**Interervention Question ≠ Transfer Probe Question 的可保证部分**：同题排除（级别 1）、同族排除（级别 2）、同点异题（级别 3）今天就能用查询表达。**不可保证部分**：跨族结构同构控制（级别 4）——必须内容侧供题（每高频节点储备 ≥N 道审定新题），系统侧只做机械排除与匹配。

> **判定：DESIGN GAP + 内容依赖（非 BLOCKER）。** 不做 workaround：系统不伪造"同构性"，级别 4 的保证写进内容任务与选题器的诚实声明（无法保证同构时 `isomorphism=unverified` 显式标注）。

---

## 5. 重点三：Intervention Attribution（任务书 §4）

**"这个探针验证哪一次干预"——复用既有身份链，不建 Intervention 表：**

```text
RecommendationAction (id, actionType, targetId=knowledgeNodeId, status, creationKey)
  ── 1:1（studyTaskId @unique）──▶ StudyTask (id, knowledgeNodeId, scheduledDate, completedAt)
  ── LearningSession.actionId ──▶ 会话内作答 PracticeRecord.actionId
  ── ActionLearningSignal（SUCCESS/PARTIAL/FAILED，现成但不回流排序）
  ── task-evidence / outcome-tracking 投影（improved/practiced/no_change）
```

- **H（StudyTask 能否作为 intervention identity）：YES，CURRENTLY SUPPORTED**——StudyTask.id 稳定、有完成时间、有知识点、与 Action 1:1。
- **I（Recommendation 能否追踪到 StudyTask）：YES**——`bindStudyTask`（recommendation.service.ts:350-376）+ `action.studyTaskId` 唯一 + 反向关系。
- **缺口（PARTIAL）**：学生自发练习的 `actionId=null`——探针归因不能依赖"作答挂在哪个 action"，而应显式记录"探针是为哪个 StudyTask/Action 而发"（探针任务自身与 Action 绑定即可，模式现成）。
- **禁止项遵守**：不需要新 Intervention 表——任务书要求优先复用，复用成立。

---

## 6. 重点四：48h Scheduling（任务书 §5）

- **无通用调度器**（§2#18）。可用原语：StudyTask.scheduledDate（**日粒度**）、ReviewSchedule.nextReviewAt（错题 SM-2，**语义不兼容**）、agent daily-planning（外部 cron 触发，生产未接）。
- **Transfer scheduling ≠ FSRS Review scheduling**（任务书红线）：探针不进复习队列、不改 ReviewSchedule 任何字段。
- **判定：DESIGN GAP。** Part 2 必须定义独立的探针队列语义（候选：独立 StudyTask 形态（mode='TRANSFER_PROBE'，scheduledDate=干预完成日+2，绑定 Action 归因）vs 新的轻量探针表——决策留 Part 2，本审计只确认"不存在可直塞的现成调度位"）。48h 的"小时级精度"现有设施不支持；日粒度（+2 天）是当前设施能表达的最近似，若需要严格 48h±窗口则需要新的 dueAt 承载。

---

## 7. 重点五：Assessment / S1 复用边界（任务书 §6）

| S1 纯函数 | S2 可否复用 | 说明 |
|---|---|---|
| normalizeScore / validateScoreEvidence | **可复用** | 探针若以 scored 形态聚合（如探针小卷），走同一归一/校验；逐题作答本身无需 |
| calibrationLayerOf / isCalibrationCompatible / calculateCalibrationError | **不适用（这是设计要求而非缺陷）** | Transfer Probe ≠ Real Exam：探针观测**不得进入成绩校准层**——即使探针被归一到 150 制，`semantic` 与 provenance 语义也不允许它冒充成绩锚。探针证据的归属是学习证据层（practice.answered 强证据 / 新增探针 action 分类），不是 Score Ledger 校准层 |
| evaluateCalibrationGate | **模式复用，需新门禁** | TransferRate/TransferGap 的预注册门禁（如：节点聚合 n≥5 才出 TransferGap）应新建纯函数，但沿用 E1 门禁的形状纪律（n 边界、诚实缺席、分层不混合） |

- **M（独立 Assessment 写入路径）：存在** —— S1 recordAssessment 与考试管线物理分离；探针作答走练习路径（PracticeRecord）即可，二者不冲突。
- **N（Assessment 能否安全承载 Transfer Probe）：NO（for ScoreAssessment-as-score）**——把逐题探针塞进 ScoreAssessment 会违反 S1 自己的 semantic 纪律。探针的 "Assessment Evidence" 环节应落在学习证据（EVIDENCE_RECORDED）与 Transfer Observation 投影，Score Ledger 不新增探针语义。
- **O（统一 evidence writer）**：**已存在** —— 探针作答若以普通 PracticeRecord 落库，会自动经 `applyAttempts` 进入掌握度（practice.answered=强证据，canInfluenceMastery=true），无需新 writer；Part 2 需决策的只是"探针作答是否/如何以 transfer 身份被识别"（标记问题，§3.3）。
- **P（Review→Mastery 接入方式）**：V12.1 生产链（§2#16），冻结不触碰。

---

## 8. 核心链逐环判定

```text
Intervention → Intervention Evidence → 48h Probe → NEW Question → Transfer Probe Attempt
→ Assessment Evidence → Transfer Observation → Transfer Gap → Unified Evidence → Mastery
```

| 环 | 判定 | 依据 |
|---|---|---|
| Intervention（身份） | **CURRENTLY SUPPORTED** | RecommendationAction 1:1 StudyTask（§5） |
| Intervention Evidence | **CURRENTLY SUPPORTED** | 证据台账（EVIDENCE_RECORDED）+ task-evidence verdicts；完成标记永不构成证据 |
| 48h Probe（调度） | **DESIGN GAP** | 无通用调度器（§6） |
| NEW Question（未见面且同构受控） | **PARTIALLY SUPPORTED** | 1-3 级排除可查询；级别 4 同构靠内容（§4） |
| Transfer Probe Attempt（带标记的作答） | **DESIGN GAP** | 无 TRANSFER_PROBE 承载（§3） |
| Assessment Evidence | **PARTIALLY SUPPORTED** | 作答→EVIDENCE_RECORDED 自动发生（practice.answered 强证据）；缺探针身份分类 |
| Transfer Observation | **DESIGN GAP（先例存在）** | applyVariantRetest 是非正式迁移测量的在产先例（新题作答反哺原题状态机），但排程耦合、无聚合投影 |
| Transfer Gap | **DESIGN GAP** | 无 TransferRate/TransferGap 投影；门禁模式可复用（§7） |
| Unified Evidence → Mastery | **CURRENTLY SUPPORTED** | 探针作答走 applyAttempts 唯一写方自动回流；无需新 writer、不触碰冻结语义 |

---

## 9. A–Q 快答汇总

- **A 直接复用**：mastery 唯一写方、S1 Score Anchor 纯函数（归一/校验/门禁形状）、Action↔StudyTask 绑定、AnswerReceipt/ReviewAttempt 幂等模式、证据台账（occurrence 键）、task-evidence/outcome-tracking 投影、三层题-节点解析、**applyVariantRetest 先例**。
- **B 部分存在**：first-seen（作答级可证、曝光级三源联查、探针级无）、AttemptSource（join 可派生五值中的四个）、调度（日粒度）、迁移观测（非正式先例）、Diagnostic（枚举无管线）。
- **C 缺失**：探针标记、探针队列、TransferRate/Gap 投影、探针题池治理、探针 action 分类。
- **D 语义不可复用**：ReviewSchedule/FSRS（红线）、ScoreOutcome/REAL_EXAM 校准层、stage_assessment 内存结果、AssessmentHistoryItem。
- **E**：见 §3.1 五个既有承载字段。
- **F/G**：作答级首见可证明（三源 EXISTS）；"作为探针首次呈现"不可证明 → DESIGN GAP。
- **H/I**：是/是（StudyTask+Action 即干预身份，不建新表）。
- **J**：池隔离系统侧可做机械排除；同构保证属内容任务 → DESIGN GAP + 内容依赖。
- **K**：无 48h 基础设施 → DESIGN GAP；日粒度是现状上限。
- **L**：同题/同族/同点排除可保证；跨族同构不可检测 → 分层诚实声明。
- **M/N**：S1 独立写入路径存在；ScoreAssessment 不承载探针（语义红线）。
- **O/P**：统一 writer 存在（探针作答自动回流 mastery）；Review→Mastery 生产链冻结复用。
- **Q**：五套幂等模式 + OCC + advisory lock，全部可复用。

## 10. 交给 Part 2/3 的设计决策清单

1. **探针标记的承载**：新 nullable 列 vs 证据 kind 扩展 vs variantQuestionId 机制泛化（需与"不直接新增 attemptSource"的指令兼容——先证明等价概念不足）。
2. **探针队列形态**：StudyTask 形态（mode 扩展）vs 独立表；日粒度 vs 严格 48h 窗口的取舍。
3. **探针作答的掌握度回流口径**：普通 practice.answered 直接回流（现状自动发生）vs 需要区分标记的加权——触碰写语义需批准。
4. **Transfer Gap 门禁预注册值**（建议沿用 E1 形状：节点聚合 n≥5 才出结论；个人只显示事件不显示聚合）。
5. **探针题池的内容任务边界**（每节点储备量、难度/题型分桶、同构审定、曝光隔离）。
6. **Diagnostic 值的归属**（S1 source 枚举已有 DIAGNOSTIC，无管线——S2 是否顺带定义入学诊断不在范围内，建议明确排除）。

## 11. 判定汇总

```text
BLOCKER          ：无
DESIGN GAP       ：探针标记（§3.3）、48h 探针队列（§6）、Transfer Observation/Gap 投影（§8）、探针 action 分类
DATA GAP         ：探针题池级别-4 同构内容（§4）、Diagnostic 管线（§3.2）
PARTIALLY SUPPORTED：first-seen 曝光级、Question source 元数据、旧 Assessment
CURRENTLY SUPPORTED：干预身份链、掌握度唯一写方、幂等五件套、证据台账、S1 纯函数（归一/校验）、applyVariantRetest 先例
```

本阶段到此为止（Part 1/3 完成）。等待 Part 2/3 指令，不开始 S2 编码。

---
---

# Part 2/3：Interface Contract + Architecture Boundary

> 延续 Part 1 的判定基线。本部分定义 S1→S2 四条核心接口的复用/新建边界、Transfer Observation→Mastery 的架构红线、Transfer Gap 语义、污染控制策略要求、统一因果链逐环判定与重复造轮子检查。仍然只读。

---

## 12. S1 → S2 四条核心接口

### Interface A：Score Contract

**S2 探针产生测评结果时必须复用 S1 Score Anchor，不得创建第二套 Score SoT。**

- S1 提供且 S2 直接复用的纯函数（packages/shared/src/score-anchor/score-anchor.ts）：`normalizeScore`（缺 totalScale 拒绝、无默认回退）、`validateScoreEvidence`（枚举+数值边界）、`resolveCorrectedEvidence`（修正折叠）。
- 探针若以 scored 形态聚合（如"探针小卷"需要总分口径），必须走 `ScoreAnchorService.recordAssessment`（originType/originId 幂等 + semantic + provenance 强制），**不得**新建分数表或绕过归一。
- **语义红线（重申并升格为接口约束）**：逐题探针观测不是考试分。探针的"Assessment Evidence"主落点是学习证据层（§16），Score Ledger 只在探针被显式设计为 scored 小卷时才介入；且任何探针行都**永不进入成绩校准层**（`calibrationLayerOf`/`isCalibrationCompatible` 对探针不适用是设计要求）。
- 现成落点（Part 1 未展开、本部分确认）：`LearningEvidenceService.recordObservedPerformance`（learning-evidence.service.ts:178-206）接受 `action: 'practice.answered' | 'assessment.submitted'` + `observedAttempts/observedCorrectCount + actionId + detail`——这是全仓**唯一的观测性能证据写入器**（当前唯一调用方：large-question.service.ts:135 rubric 评分）。探针观测 = 同一接口、`detail` 携带探针身份。**不新建 evidence writer。**

### Interface B：Attempt Identity

**要求：attemptSource = TRANSFER_PROBE 可判定；不直接新增字段，先证明等价能力不足。**

等价能力逐项裁决（Part 1 §3.1 的延伸）：

| 候选等价物 | 能否承载探针身份 | 裁决理由 |
|---|---|---|
| `PracticeRecord.variantQuestionId` + `applyVariantRetest` | **不能安全复用** | 复用会（i）触发 applyVariantRetest 副作用——把探针作答写进原题的复习状态机（违反"Review 与 Transfer 必须分离"）；（ii）强制绑定单一原题，而探针测的是节点级迁移 |
| `LearningSession.type` 扩展 | 部分可行 | 探针若是会话形态可加 type='transfer_probe'；但单题探针无会话，且 type 承载的是会话用途而非作答来源 |
| `ReviewAttempt.source` 枚举扩展 | 不适用 | 探针不是复习（红线） |
| 证据层 `detail.kind` | **可承载观测身份** | `recordObservedPerformance` 的 detail 字段逐字透传（rubric 先例：detail.kind='rubric_scored_attempt'），可写 `detail.kind='transfer_probe'` |
| `PracticeRecord` 新 nullable 标记 | 需 schema 批准 | 唯一能让"练习/探针"在作答事实层面可区分的方式 |

**裁决：DESIGN OPEN（两个候选，Part 3 定夺）**——
- **方案 α（零 schema）**：观测身份进证据层（detail.kind='transfer_probe' + actionId 归因），作答事实不标记。代价：PracticeRecord 层面探针与普通练习不可区分（mastery 回流完全一致，污染控制 §20-8 需在选题器而非数据层解决）。
- **方案 β（最小 schema）**：PracticeRecord 新增 nullable `attemptSource`（或 probeTaskId）列，历史行 NULL=未知（review_attempt 四列迁移先例）。代价：一次 additive 迁移批准门。
- 两方案都必须满足：旧键/旧行语义不变（前缀兼容或 NULL=未知），且**不引入第二套作答事实**。

### Interface C：Intervention Attribution

**复用结论（CONFIRMED，无新表）：**

```text
RecommendationAction (targetId=knowledgeNodeId, status, creationKey)
  ── studyTaskId @unique ──▶ StudyTask (id, knowledgeNodeId, completedAt)
  ── 探针任务自身绑定 Action（creationKey 模式现成）──▶ 探针归因
  ── recordObservedPerformance(actionId=Action.id) ──▶ 证据自带归因
```

- Part 1 §5 已证 Action↔StudyTask 1:1、PracticeRecord.actionId 解析链（resolvePracticeActionId 只信 session，practice-action-attribution.ts:1-5——"请求方 actionId 一律忽略"是防伪造的正确纪律，探针归因必须走同一条路：探针作答挂在探针自己的 session/task 上）。
- **接口约束**：Transfer Probe 的归因主键 = 触发它的 StudyTask.id（或其 Action.id），写入 `recordObservedPerformance.actionId` 与（若方案 β）作答标记。禁止"无归因探针"（无法归因的探针 = 无效探针，应诚实跳过）。

### Interface D：Probe Pool Isolation

Part 1 §4 判定维持，升格为接口契约：

- **系统侧可证明**（选题器强制，写进验收）：同题排除（questionId）+ 同族排除（familyId/versionNumber）+ 同点异题（node tag）+ 难度分桶（BASIC/MEDIUM/HARD 对齐干预题）+ 题型匹配 + **三源未曝光**（PracticeRecord ∪ ReviewAttempt ∪ LearningSession.questionIds 对该用户全量 EXISTS 反查）。
- **内容侧必须供给**（DATA GAP 维持）：跨族结构同构审定（级别 4）。系统对无法声明同构的探针题输出 `isomorphism=unverified`（诚实降级，不冒充）。
- **禁止猜测**：任何"看起来没见过"的软判断都不算数——只有三源 EXISTS 的硬查询结果可用。

### Interface Matrix

| Interface | S1 Provides | Current Repo | S2 Needs | Reuse/Create | Risk |
|---|---|---|---|---|---|
| A Score Contract | normalizeScore/validateScoreEvidence/ScoreAssessment writer | recordObservedPerformance（唯一观测证据写入器，rubric 在用） | 探针观测落证据层；scored 形态走 recordAssessment | **Reuse**（零新建） | 低——红线：探针不进校准层 |
| B Attempt Identity | ——（S1 不管作答来源） | variantQuestionId/type/source 等价物均不可安全承载 | 探针作答可判定为 TRANSFER_PROBE | **DESIGN OPEN**：α 证据 detail vs β nullable 列 | β 需迁移批准；α 牺牲作答层可区分性 |
| C Intervention Attribution | —— | Action 1:1 StudyTask；actionId 解析链（只信 session） | 探针→StudyTask/Action 显式绑定 | **Reuse**（creationKey/bindStudyTask 现成） | 低——禁止无归因探针 |
| D Probe Pool Isolation | —— | 三源未曝光反查 + familyId/node/difficulty 机械排除 | 同构受控的隔离题池 | **Reuse（机械排除）+ Create（内容池，DATA GAP）** | 内容不足时诚实跳过 |
| E Scheduling | —— | 无通用调度器；日粒度 StudyTask | 48h 探针队列（语义独立于 FSRS） | **Create**（形态 Part 3 定） | 塞进 FSRS = 红线违规 |
| F Evidence Writer | recordObservedPerformance（actionId+detail） | 已有，rubric 在用 | 探针观测调用 | **Reuse** | 零 |
| G Mastery Writer | —— | ScoreCenterService 唯一写方 + applyMasterySemantics | 探针作答自动回流（普通 practice 路径） | **Reuse**（禁止新 writer） | 触碰写语义需批准（见 §16-10） |
| H Idempotency | S1 三键（predictionKey/originId/dedupKey） | AnswerReceipt/(scheduleId,idempotencyKey)/creationKey/eventKey | 探针投递与作答幂等 | **Reuse**（模式照搬） | 低 |
| I Transfer Gap | evaluateCalibrationGate 形状纪律 | 无投影 | TransferRate/Gap 聚合（预注册门禁） | **Create**（只读投影） | 与成绩指标混淆的措辞风险（§14） |
| J Contamination | 诚实缺席纪律 | 三源反查 + 机械匹配 | 十项污染策略（§20） | **Reuse + Create** | 静默降级 = 伪造 |

---

## 13. Review 与 Transfer 必须分离（架构边界）

| 维度 | Review | Transfer Probe |
|---|---|---|
| 目的 | retention / 遗忘防护 | 迁移测量（未见过的新题） |
| 题目 | 已做错的旧题（WrongQuestion 链） | 未见过的新题（探针池） |
| 调度 | SM-2/FSRS 间隔（nextReviewAt） | 干预完成 + 固定延迟（48h 窗口） |
| 语义承载 | ReviewSchedule/ReviewAttempt（冻结） | 独立探针语义（Part 3 定形态） |
| 对 mastery 的意义 | 保持度证据（review.recalled 强证据） | 迁移证据（practice.answered 强证据 + 探针标记） |

**三条禁令的架构含义**：
1. `TransferProbe extends Review` 禁止 → 探针不得读写 ReviewSchedule/ReviewAttempt 任何字段；applyVariantRetest 不得被探针触发（这也是 Interface B 否决 variantQuestionId 复用的原因之一）。
2. FSRS 作探针调度语义禁止 → 复用仅限"到期时间原语"的形状（dueAt/scheduledDate 模式），间隔计算/稳定性状态机一概不共享。
3. 基础设施复用允许 → StudyTask 面、事件写入器、幂等模式、投影文化照常使用。

---

## 14. Transfer Gap 语义（只定义，不编码）

```text
Intervention Performance（干预表现）= 干预窗口内、干预题目上的已判分正确率
Transfer Performance（迁移表现）  = 48h 探针窗口内、未见过新题上的已判分正确率
Transfer Gap = Transfer Performance − Intervention Performance
例：干预 90% → 探针 65% ⇒ Transfer Gap = −25pt（正=迁移完整，负=迁移衰减）
```

**它是迁移证据指标（learning-evidence 层），明确不是：**
- Score Gain / Verified Score Gain（分数层，S1 Score Anchor 管辖，需真实/判分成绩锚）；
- masteryGain（掌握度层，EMA 增量，effectiveness 模块管辖）；
- 真实成绩提升的任何声明——UI/报告措辞必须使用"迁移衰减/迁移保持"，禁止"提分 X 分"式表述。

**聚合与门禁（预注册建议，Part 3 确认数值）**：TransferGap 只按 (node, 干预类型) 聚合、跨学生样本 n≥5 才给出结论；单学生界面只呈现事件（"探针：新题答对/答错"），不呈现个人聚合——沿用 S1 证据门禁与 V12 诚实缺席纪律。分层维度：难度桶、题型、错因类型（E2 实验需报告）。

---

## 15. First-Seen / Exposure Audit（接口化）

| 事实 | 查询 | 完备性论证 | 判定 |
|---|---|---|---|
| 作答过（judged attempts） | `PracticeRecord(userId,questionId)` ∪ `ReviewAttempt(经 schedule join)` | 两条链覆盖全部已判分交互；AnswerReceipt 幂等保证不重复计数 | CURRENTLY SUPPORTED |
| 见过未作答 | `LearningSession.questionIds` / `questionSnapshot`（会话内呈现集） | 覆盖走 start 端点的会话；无统一曝光台账（practice.set_start 无题目负载） | PARTIAL——三源联查是当前完备性上限 |
| 作为探针呈现 | 无承载 | —— | DESIGN GAP（§12-B） |

**选题器接口约束**：探针候选必须通过三源 EXISTS 反查（对全部历史，非窗口）；反查失败模式=诚实跳过 `no_probe_available`，禁止"退而求其次用见过的题"。

---

## 16. Transfer Observation → Unified Evidence → Canonical Mastery

**目标链（任务书 §2）在现有代码中的承载：**

```text
Practice Observation ──┐
Review Observation ────┤
Transfer Observation ──┴──▶ EVIDENCE_RECORDED（统一证据台账,UserEvent,occurrence 键）
                                   │（仅 strong 证据有资格）
                                   ▼
                        Canonical Mastery（ScoreCenterService 唯一写方
                        → applyMasterySemantics → OCC → 快照）
```

- **统一证据写入器已存在**：`recordObservedPerformance`（A 接口）——探针观测调用它即进入与 practice/review 同一台账；`learningEvidenceKey` 的 occurrence 段（learning-evidence.ts:316+）保证逐次身份不坍缩（V12-M3-A 修复的先例直接复用）。
- **Canonical Mastery writer 已存在且唯一**：探针作答以普通 PracticeRecord 落库 → 事务内 `applyAttempts` → `applyMasterySemantics` → OCC。**TransferProbeService 若存在，只做编排（排程/选题/落库调用/投影），永不 import 写原语**——源码级断言应锁死"探针模块不含 applyMasterySemantics/applyAttempts/userKnowledgeMastery 写调用"（复用 V12 证据层边界测试模式，test 边界断言先例）。
- **禁止项的满足方式**：`mastery += 0.1` 式直写在结构上不可达（写方唯一 + 模块边界断言）；第二套 mastery 算法不存在（冻结）。
- **一个必须由 Part 3 决策的语义点（如实登记）**：探针作答走普通练习路径会**立即拉高该节点 mastery**（新题答对 = 强证据），从而改变下一步推荐排序。这是"Unified Evidence → Mastery"链条的自然结果（任务书链路图明确包含此环），但它意味着探针同时是干预——Part 3 需确认这是期望行为（本审计判定：是，链路图如此定义；若未来要"纯测量探针"则需写语义豁免，属新批准门）。

---

## 17. Idempotency / Concurrency Audit（S2 视角）

| 环节 | 复用模式 | 证据 |
|---|---|---|
| 探针作答提交 | AnswerReceipt（PENDING 接管 + requestHash + 重放隔离） | study.service.ts:3137-3191 |
| 复习/重做幂等 | (scheduleId, idempotencyKey) 唯一 + findAttemptByIdempotencyKey | review-schedule.repository.ts:232 |
| 探针任务/Action 身份 | creationKey (userId 唯一) + generationKey + advisory lock | recommendation-action-adapter / study-plan.repository |
| 证据台账 | (userId, eventKey) 唯一 + occurrence 段 | canonical-event-writer + learning-evidence.ts:316+ |
| 并发写掌握度 | OCC version + P2002 重试（saveMasteryWithOptimisticRetry） | score-center/repository.ts:141-189 |
| S1 键族 | predictionKey / originId / dedupKey | score-anchor.service.ts |

**判定：CURRENTLY SUPPORTED**——S2 不需要发明任何新幂等机制；探针的唯一新幂等键（如 `(userId, probeTaskId)` 防重复投递/重复测量）应落在探针编排层，沿用既有键族风格。

---

## 18. 统一因果链逐环判定（任务书 §6）

```text
Recommendation → StudyTask → Intervention → Learning Evidence → 48h
→ Transfer Probe → New Question → Transfer Attempt → Assessment
→ Transfer Observation → Unified Mastery → Next Recommendation
```

| # | 段 | 判定 | 代码证据 |
|---|---|---|---|
| 1 | Recommendation → StudyTask | **CONFIRMED** | bindStudyTask（recommendation.service.ts:350-376）；studyTaskId @unique；score-loop 集成全链 PASS |
| 2 | StudyTask → Intervention（执行） | **CONFIRMED** | 三条练习写路径 + applyAttempts；PracticeRecord.actionId（session 解析）；completeStudyTask/任务完成遥测 |
| 3 | Intervention → Learning Evidence | **CONFIRMED** | EVIDENCE_RECORDED 台账（review.recalled 强/task.completed 弱，score-loop 3 记录实证）；task-evidence verdicts |
| 4 | Learning Evidence → 48h（等待窗） | **PARTIAL** | 时间戳齐备（completedAt/recordedAt）；无调度器承载窗口 |
| 5 | 48h → Transfer Probe（投递） | **MISSING** | 无探针队列（Part 1 §6） |
| 6 | Transfer Probe → New Question（未见面+同构受控） | **PARTIAL** | 三源反查可建（1-3 级排除）；同构内容 DATA GAP |
| 7 | New Question → Transfer Attempt | **PARTIAL** | 练习写路径现成；探针标记 DESIGN GAP |
| 8 | Transfer Attempt → Assessment（观测证据） | **PARTIAL** | recordObservedPerformance 接口现成；探针调用方缺失 |
| 9 | Assessment → Transfer Observation（聚合） | **MISSING** | 无 TransferRate/Gap 投影 |
| 10 | Transfer Observation → Unified Mastery | **CONFIRMED**（条件见 §16 决策点） | 探针作答走 applyAttempts 唯一写方，自动回流 |
| 11 | Unified Mastery → Next Recommendation | **CONFIRMED** | mastery → calculatePriority weakness 分量（priority.ts:52-59）；生产排序路径 |
| 12 | 闭环完整性 | **PARTIAL** | 1-3/10-11 现成；4-9 为 S2 建设面——这正是 S2 的工程范围，无一环被现有架构阻断 |

---

## 19. 重复造轮子检查（任务书 §7，逐项裁决）

| 候选实体 | 等价物存在？ | 复用？ | 不能复用的理由 / 新增职责边界 | 第二 SoT 风险 |
|---|---|---|---|---|
| **ProbeAttempt** | **是——PracticeRecord** | **复用** | 探针作答就是一次判分练习（判题/幂等/掌握度回流全免费）；零新增 | 无 |
| **TransferProbe**（排程实例） | 部分——StudyTask 可承载（mode/scheduledDate），但日粒度+计划归档语义混杂 | DESIGN OPEN | 若独立成表：职责=仅"排程与身份"（dueAt 窗口、状态、归因键），**绝不**复制作答/证据字段；若走 StudyTask：接受日粒度与计划生命周期耦合 | 形态 (b) 有轻微风险——用"只排程不记录表现"约束规避 |
| **Intervention** | **是——RecommendationAction + StudyTask** | **复用（禁止新建）** | 身份/状态机/归因全现成 | 新建即第二事实源，明确否决 |
| **AttemptSource** | 无一等字段（四值可派生） | 派生 + 最小标记 | 见 §12-B 两方案 | α 方案零风险；β 方案 additive 列，NULL=未知先例 |
| **TransferEvidence** | **是——EVIDENCE_RECORDED via recordObservedPerformance(detail.kind)** | **复用** | detail 透传先例（rubric）；occurrence 键就绪 | 无 |
| **TransferScore** | 无，且**不应存在** | **否决** | 探针不是成绩（语义红线）；150 制归一不给探针发成绩身份证 | 强制否决——建了就是第二套 Score SoT |
| **TransferResult / TransferObservation** | 无 | **Create（只读投影）** | 从（带标记作答 + 探针任务）派生 TransferRate/Gap，投影文化（selector/纯函数），不落业务表 | 投影不存表 = 无 SoT 冲突 |
| **ProbeSchedule** | 无独立物 | DESIGN OPEN（并入 TransferProbe 形态决策） | 不共享 FSRS 语义（§13 红线）；仅借 dueAt 形状 | 同 TransferProbe 行 |

**汇总：8 个候选中 4 个明确复用既有物、1 个强制否决（TransferScore）、1 个复用+投影、2 个 DESIGN OPEN（同一形态决策的两面）。无一项需要新的事实源表来记录"表现"。**

---

## 20. Contamination Control（十项污染 × 事实可得性 × 策略要求）

| # | 污染 | 现仓库能否提供事实 | 策略要求（Part 3 设计必须落实） |
|---|---|---|---|
| 1 | 同题重做 | **能**（questionId EXISTS） | 选题器硬排除 |
| 2 | 已经见过的题 | **能**（三源联查；无单一台账=PARTIAL） | 三源 EXISTS 反查全覆盖；缺源=跳过 |
| 3 | 答案泄漏 | 部分（池隔离是内容任务=**DATA GAP**） | 探针池不进练习面；解析在窗口结束前不下发 |
| 4 | 结构高度相似 | **不能**（跨族同构不可检测） | 内容审定 + `isomorphism=unverified` 诚实降级 |
| 5 | 难度不匹配 | **能**（difficulty 枚举 + expectedTimeSec） | 分桶对齐干预题；不匹配=跳过 |
| 6 | 干预与探针时间过近 | **能**（completedAt/occurredAt 时间戳） | scheduledAt − completedAt ≥ 48h 校验，硬门槛 |
| 7 | 学生从其他路径提前做 probe | **能**（三源反查在投递时刻执行） | 投递时二次反查；命中=该题作废换题或跳过 |
| 8 | probe 被当普通练习 | **不能**（无标记=不可区分）→ 依赖 §12-B | 方案 β 列 / 方案 α 证据 detail；聚合侧按标记过滤 |
| 9 | probe 重复测量 | **能**（幂等键族） | (userId, probeTaskId) 唯一；窗口内一节点一探针 |
| 10 | probe pool 不足 | 内容任务 | `no_probe_available` 诚实跳过，**禁止**旧题顶替（这是"不伪造"纪律的探针版） |

**策略总纲**：每一条污染在系统侧可检测的用硬查询；不可检测的（3/4）显式降级声明并挂内容任务；任何降级路径不得静默。

---

## 21. Part 2 新增判定汇总

```text
CONFIRMED（复用即得）  ：干预身份链 / 证据写入器（recordObservedPerformance）/ mastery 唯一写方回流 /
                         幂等五件套 / 机械排除查询（污染 1/2/5/6/7/9 的数据基础）
DESIGN OPEN            ：探针标记承载（α 证据 detail vs β nullable 列）/
                         TransferProbe 形态（StudyTask 承载 vs 独立排程表）——同一决策两面
强制否决               ：TransferScore（第二 Score SoT）/ TransferProbe extends Review /
                         复用 variantQuestionId 触发 applyVariantRetest
MISSING（S2 建设面）   ：探针队列投递 / Transfer Observation 投影
DATA GAP（维持）       ：同构内容供给 / 答案泄漏的池隔离内容面 / Diagnostic
```

Part 2/3 完成。仍然零代码、零 schema、零 commit。等待 Part 3 指令。

---

# Part 3/3：Design Gate + Final Audit

## 22. Executive Summary（终版，覆盖全文）

**S2 Transfer Probe 在当前仓库上可建、无 BLOCKER，Design Gate = READY WITH CONDITIONS。** 干预身份链（RecommendationAction 1:1 StudyTask）、掌握度唯一写方、证据台账与 `recordObservedPerformance` 观测写入器、幂等五件套全部现成可复用——S2 的工程量集中在四个新能力：探针标记（两方案待决）、探针队列（语义独立于 FSRS）、选题器（三源未曝光反查+机械排除）、Transfer Observation 只读投影（预注册门禁）。两项内容依赖（同构题供给、池隔离内容面）挂内容任务并以诚实降级声明兜底。Transfer Gap 是迁移证据指标，与 Verified Score Gain 的边界由 Score Ledger 语义红线（S1）保证。下一步：S2 Formal Design（在 §31 六项决策定案后进入实现规划）。

## 23. S1 Contract（现行契约固化——S2 不得重定义）

| S1 提供物 | 契约要点 | S2 复用方式 |
|---|---|---|
| `normalizeScore(raw, total)` | 缺 totalScale 拒绝、无默认回退、round1 | 直接调用（scored 探针形态） |
| `validateScoreEvidence` | 枚举+数值边界 | 直接调用 |
| `SCORE_SOURCES` 枚举 | MOCK/DIAGNOSTIC/TEACHER_GRADED/RUBRIC_GRADED/REAL_EXAM/IMPORTED/UNKNOWN | 探针**默认不进** Score Ledger；如需，additive 扩枚举（§31-D4） |
| `calibrationLayerOf/isCalibrationCompatible/calculateCalibrationError` | 五条件兼容 | **对探针不适用是设计要求**——探针永不进校准层 |
| `evaluateCalibrationGate` | n≥5 / median 严格边界 / 分层不混合 | 形状纪律复用，Transfer Gap 另建预注册门禁 |
| `ScoreAssessment`（S1 表） | provenance+semantic+幂等 | 仅 scored 小卷形态使用；逐题探针不落此表 |
| `User.examDate` | 事实字段 | S2 不触碰 |

## 24. "未来能力冒充当前能力"检查（十项，逐项实判）

| # | 模式 | 实判（file 证据） | 结论 |
|---|---|---|---|
| 1 | 字段存在但无生产写入路径 | **成立 ×2**：`User.examDate`（S1 新列，全库无写路径/UI，仅集成种子写入）；`Question.rubric`（列+服务在，生产 0 行）。另 `recommendation.created/accepted/completed/failed` 四事件常量零发射点 | S2 设计不得假设这两字段有数据；探针不依赖它们 |
| 2 | 可关联但无稳定 FK/eventKey | **成立**：曝光事实挂 `LearningSession.questionIds`（数组，无 FK、无逐题事件）——"见过"无逐题台账 | 三源反查是当前完备性上限（§15），不得宣称统一曝光台账已存在 |
| 3 | 理论可判首次见题但历史数据不完整 | **部分成立**：作答级完备（PracticeRecord+ReviewAttempt 全量）；曝光级依赖会话创建路径（独立单题提交=作答，即时入账；无会话的"看过没答"不落库） | 判定措辞维持 PARTIAL，不升 CONFIRMED |
| 4 | 有 question source 但不能证明学生是否见过 | **成立**：`Question.source`（章节题/真题改编…）是内容出处，与曝光无关 | 选题器只认三源反查，不认 source 字段 |
| 5 | 有 scheduler 但只有 Review/FSRS | **成立**：无通用调度器；agent daily-planning 注释自认"设计给外部调度器"且生产未接 | 探针队列必须新建（§6/§13 红线） |
| 6 | 有 Assessment 但无法保留 Transfer 语义 | **成立（by design）**：ScoreAssessment 的 semantic/provenance 语义不含探针；塞入即违反 S1 纪律 | 逐题探针走证据层；scored 形态需 §31-D4 决策 |
| 7 | 有 Evidence 但无法追溯 Intervention | **部分成立**：`recordObservedPerformance(actionId)` 接口在；但现调用方（rubric）之外，普通练习**今天根本不写证据记录**（score-loop 三记录=review×2+task） | 探针证据写入是新调用方，不是"已通"——维持 PARTIAL |
| 8 | 有 Mastery writer 但 Transfer 进不了 canonical path | **不成立（好消息）**：探针作答以普通 PracticeRecord 落库即自动进 applyAttempts 唯一写方 | 缺的是"身份识别"，不是"通道"——Part 2 §16 决策点如实登记 |
| 9 | 有 idempotency 但无法防 probe 重复测量 | **成立**：五套幂等模式无一是探针键；`(userId, probeTaskId)` 需 S2 新建 | 幂等"模式"复用 ≠ 幂等"已建立"——S2 交付物 |
| 10 | "未来可实现"被误写为 CURRENTLY SUPPORTED | **自查结论**：Part 1/2 判定表经复核无升级错误（记录性核查：§2#6 学习证据判 CURRENTLY SUPPORTED 的依据是台账+发射器对 review/task 真实存在，非"理论上可写"；探针相关环全部标注 PARTIAL/DESIGN GAP） | 本节即纠偏机制；后续审计沿用此表格式 |

## 25. Data Model Impact（要求 16）

| 方案 | Schema 变更 | 说明 |
|---|---|---|
| α（零迁移） | **无** | 探针身份走证据 detail.kind + 探针任务表形态选择（若 StudyTask 承载则也无新表） |
| β（最小迁移） | `PracticeRecord` +1 nullable 列（`attemptSource` 或 `probeTaskId`） | NULL=未知（review_attempt 四列先例）；additive、可 DROP 回滚、零回填 |
| 探针题池 | **无 schema**（内容任务） | 候选承载：`Question.source` 约定值 vs 新 tag 表——内容任务定；工程侧只消费 |
| Score Ledger | 无（探针默认不写） | 若未来 scored 探针入账：SCORE_SOURCES additive 扩值（独立批准门） |

## 26. API Impact（要求 17）

- **新增（建议面，Part 3 不实现）**：`GET /coach/transfer-probes`（到期探针列表，self-only）；探针作答提交**复用既有练习路径**（POST /practice-records 或 /sessions/practice/*，带探针标记/归因），**不新建作答端点**；`GET /coach/transfer-observations`（teacher/admin 投影，门禁后学生可见性另议）。
- **守卫**：全部走 RoleGuard+@Roles（Part 3 S1 教训：无 @Roles 即放行）；self-only 沿用 service 层授权脊柱。
- **不变**：既有端点零改动；不触碰 /coach/score-calibration 语义。

## 27. Frontend Impact（要求 18）

- 探针呈现面：今日任务/每日简报卡内嵌"新题测量"探针卡（诚实标记：这是迁移测量，不是复习也不是成绩）；探针作答复用 ExamSession/练习会话组件，**不新建答题 UI**。
- 诚实规则：无到期探针=静默；探针结果只显示事件（对/错+新题标注），不显示个人 TransferGap 聚合（n≥5 门禁后仅教师侧可见）。
- 静态演示模式 return null（S1 先例）；纯 token CSS。

## 28. Testing Impact（要求 19）

| 层 | 必测 |
|---|---|
| Unit（shared/纯函数） | 选题器三源排除（同题/同族/同点/难度/题型/未曝光）；TransferGap 数学；观察聚合门禁（n=4 不过/n=5 过；分层不混合）；探针归因不可缺失（无归因=拒绝投递） |
| 源码边界断言 | 探针模块**不含** applyMasterySemantics/applyAttempts/userKnowledgeMastery 写原语（V12 证据层边界测试模式）；不含 ReviewSchedule 写调用 |
| Service（sandbox 桩） | 探针生命周期状态机；幂等（(userId,probeTaskId)）；窗口校验（<48h 拒绝）；`no_probe_available` 诚实跳过 |
| 集成 | 新脚本 `integration-transfer-probe.mjs`（真实 HTTP+PG：干预→排程→48h 假时钟或窗口注入→投递→未曝光保证→作答→证据含 detail.kind→mastery 回流→投影）；既有 score-loop/effectiveness 回归 |
| 前端 | 探针卡诚实渲染行为测试；静态演示隐藏 |

## 29. Migration Impact（要求 20）

- α 方案：**零迁移**（与 S1 主体同风格）；β 方案：一条 additive ALTER TABLE（可空列），回滚=DROP COLUMN，零回填、零既有行改写。
- 无论 α/β：S1 四表零接触；迁移纪律（preflight/diff 零漂移/测试库先部署）沿用。
- **不做**：历史 PracticeRecord 回填探针标记（历史无探针，回填即伪造）。

## 30. BLOCKERS（要求 21）

**无。** "新题身份"可由三源 EXISTS 证明、"干预归因"可由既有 Action/StudyTask 链建立——任务书定义的两条 BLOCKED 触发线均未触发。两项内容依赖（同构题、池隔离）不是工程 BLOCKER：系统侧以硬查询+诚实降级承载，内容缺口只影响覆盖面（可测节点数），不影响机制正确性。

## 31. Design Decisions Required（要求 22——Part 3 前必须定案）

| # | 决策 | 选项 | 本审计倾向 |
|---|---|---|---|
| D1 | 探针标记承载 | α 证据 detail（零 schema）/ β PracticeRecord nullable 列 | **α 先行**（零迁移、可后补 β）；若聚合查询成为痛点再升 β |
| D2 | 探针队列形态 | StudyTask 承载（日粒度）/ 独立排程表（dueAt 小时窗） | **StudyTask 承载起步**（复用归因/状态机/任务面）；严格 48h±窗口需求证实后再演进 |
| D3 | 探针作答的 mastery 回流 | 普通练习直接回流（现状自动）/ 需豁免 | **直接回流**（链路图定义如此；探针=最强证据）；未来"纯测量探针"另立批准门 |
| D4 | 探针是否产生 ScoreAssessment | 不产生（证据层承载）/ additive 扩 SCORE_SOURCES | **M1 不产生**；保留 D4 为演进选项 |
| D5 | TransferGap 门禁预注册值 | 节点聚合 n≥5；分层维度（难度桶/题型/错因） | 沿用 E1 形状；具体阈值 E2 前预注册 |
| D6 | 探针题池内容任务边界 | 每试点节点储备量/审定流程/曝光隔离 | 内容任务独立立项（E2 前就绪 30 节点×2 题） |
| D7 | Diagnostic 归属 | 显式排除 | **排除出 S2**（S1 枚举值保留，无管线不阻塞） |

## 32. S2 Proposed Boundary（要求 23）

**In scope**：探针队列（排程/到期/投递）、选题器（三源反查+机械排除+分桶）、探针标记（D1）、探针作答落库（复用练习路径）、观测证据写入（复用 recordObservedPerformance）、Transfer Observation 只读投影+门禁、最小前端探针卡、集成脚本与 E2 实验设计、源码边界断言。

**Out of scope**：S3 Opportunity/S4 ROI、 mastery 算法任何改动、FSRS/Review 语义、真实成绩声明、Score Ledger 新语义（除 D4 演进选项）、生产部署、Diagnostic 管线。

## 33. S2 Non-Goals（要求 24，任务书 §2 逐条固化）

1. 不重新设计 Score Anchor；2. 不重新实现 score normalization；3. 不重新实现 calibration；4. 不重构 Review→Mastery；5. 不建立第二套 Mastery；6. 不建立第二套 Score SoT；7. 不证明真实考研成绩提升；8. 不把 Transfer Gap 转换成 Verified Score Gain；9. 不提前实现 S3 Score Opportunity；10. 不提前实现 S4 ROI Ranking；11. 不进行生产部署。

## 34. S2 Implementation Milestones（要求 25——建议，非本阶段承诺）

| 里程碑 | 内容 | 验收门 |
|---|---|---|
| **S2-M1 选题器+标记+证据**（TDD） | 三源反查 selector、探针标记（D1 定案）、recordObservedPerformance 接线、源码边界断言 | 纯函数/服务测试全绿；边界断言钉死 |
| **S2-M2 队列与投递** | 探针任务形态（D2 定案）、48h 窗口校验、幂等键、诚实跳过 | 集成：干预→到期→投递全链 |
| **S2-M3 Observation 投影** | TransferRate/Gap 只读投影（D5 门禁）、分层聚合 | 门禁边界测试；无 n≥5 时诚实缺席 |
| **S2-M4 前端+集成收口** | 探针卡、全量回归、integration-transfer-probe | npm test 零回归；三端 build |
| **S2-M5 E2 实验** | runbook（30 节点×2 题、教师判分、门禁评估） | 首批 TransferGap 数字（或诚实缺席记录） |

## 35. 文档完整性对照（要求 1-25 → 本文档章节）

| 要求章节 | 本文档位置 |
|---|---|
| 1 Executive Summary | §22 |
| 2 Current S1 Contract | §23（+§12-A） |
| 3 Current Repository Reality | §2（Part 1 二十项清单） |
| 4 Existing Reusable Components | §19 重复造轮子裁决（+§12/§16/§17） |
| 5 S2 Missing Capabilities | §21 判定汇总 MISSING 行（+§8 环 5/9） |
| 6 S1→S2 Interface Matrix | §12 Interface Matrix |
| 7 AttemptSource Audit | §3 + §12-B |
| 8 First-Seen / Exposure Audit | §15 |
| 9 Intervention Attribution Audit | §5 + §12-C |
| 10 Probe Pool Isolation Audit | §4 + §12-D |
| 11 Scheduling Audit | §6 + §13 |
| 12 Assessment / Score Anchor Integration Audit | §7 + §12-A + §23 |
| 13 Transfer Observation → Mastery Audit | §16 |
| 14 Idempotency / Concurrency Audit | §17 |
| 15 Contamination Control | §20 |
| 16 Data Model Impact | §25 |
| 17 API Impact | §26 |
| 18 Frontend Impact | §27 |
| 19 Testing Impact | §28 |
| 20 Migration Impact | §29 |
| 21 BLOCKERS | §30（无） |
| 22 Design Decisions Required | §31 |
| 23 S2 Proposed Boundary | §32 |
| 24 S2 Non-Goals | §33 |
| 25 S2 Implementation Milestones | §34 |

## 36. S2 Design Gate（最终判定）

七项门禁条件逐项判定：

| 条件 | 判定 | 依据 |
|---|---|---|
| S1 contract 可安全复用 | ✅ | 纯函数有测试；Score Ledger 语义红线明确 |
| Attempt identity 可建立 | ✅（D1 待选型） | α/β 两 viable 路径；variantQuestionId 否决理由充分 |
| Intervention attribution 可建立 | ✅ | Action↔StudyTask 1:1 生产链现成 |
| Probe pool isolation 可建立 | ✅机械 / ⚠️同构内容 | 机械排除可建；级别 4 = 内容任务（DATA GAP，非工程阻断） |
| Assessment integration 可建立 | ✅ | recordObservedPerformance 接口现成；ScoreAssessment 边界已划 |
| Unified evidence integration 可建立 | ✅ | 同一台账 + occurrence 键现成 |
| idempotency 可建立 | ✅（探针键新建） | 模式五件套照搬 |

```text
S2 Design Gate = READY WITH CONDITIONS

条件（进入 S2 Formal Design 前定案，均为决策/内容项，非工程阻断）：
  C1 D1 探针标记承载选型（α 建议先行；β 需 schema 批准门）
  C2 D2 探针队列形态选型（StudyTask 承载建议先行）
  C3 D3 mastery 回流语义确认（所有者：探针作答=干预，直接回流 canonical path）
  C4 D6 探针题池内容任务立项（E2 前就绪试点节点；isomorphism=unverified 允许但须显式）

Next Action: S2 Formal Design（基于本审计 §31 决策清单 + §34 里程碑骨架）
```

Part 3/3 完成。S1→S2 Interface Audit 全文（Part 1 §1-11 / Part 2 §12-21 / Part 3 §22-36）到此收口。仍然零代码、零 schema、零 commit、零 push。
