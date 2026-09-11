# Score Improvement Reconstruction — Architecture & Product Design

> 日期：2026-09-11 ｜ 性质：READ-ONLY 架构与产品设计（零代码、零 schema、零迁移、零部署、零 commit）
> 最高优先级输入：`docs/score-improvement-gap-report.md`（2026-09-11 提分有效性差距审计）
> 设计立场：不推翻 V12 沉淀——EMA 唯一写方、OCC、证据台账、canonical writer、投影文化全部保留；本设计补的是**货币、测量与闭环**，不是第二套引擎。

---

## A. Executive Summary

### 为什么现有产品提分能力不足

审计（gap report §1/§11/§23）已经定量给出：因果链五段中仅第一段（推荐→干预）CONFIRMED，能力→测评、测评→分数两段为 PARTIAL 偏弱，归因 UNPROVABLE。结构性根因是四个：

1. **没有结算货币**。生产排序货币是加性"学习优先级"（priority.ts 六分量），不含任何分数量纲；真实分数无处落库（User 无 examDate、无成绩表、currentScore 永不自动更新）。一个不能回答"这值几分"的系统，无法证明"提分"。
2. **没有测量协议**。干预后无强制复测，迁移不可观测（PracticeRecord 无首见/来源字段），主观 70/150 分依赖自评 ≥0.6。"任务完成"与"学习成功"之间没有强制测量点。
3. **没有回流回路**。SUCCESS/PARTIAL/FAILED 信号已计算但不进排序（grep 证实 priority/plan/recommendation.service 零消费）；推荐失败永不降权。
4. **模型未被现实校准**。预测分从未与真实成绩对照（首对照 error=70）；校准管道存在 150 vs 100 量纲错配；score-opportunity 影子的收益区间（weakness×importance×6~14）无经验标定。

### 本设计做什么

把系统从"学习管理系统"重构为"考试分数优化系统"，靠四件事：**Score Ledger（分数成为一等公民的账本）→ Transfer Probe（迁移成为可测对象）→ Opportunity Engine（预计可恢复分数÷训练成本成为排序货币）→ Closed Loop（复测、outcome 反馈、归因图）**。每一步都设计为影子先行、预注册阈值、可回滚，延续仓库既有工程纪律。

### 目标因果链（本设计的主语）

```text
Real Score → Score Loss → Ability Gap → Recoverable Score → Training Cost
→ Expected ROI → Recommendation → Intervention → Transfer Probe
→ Assessment → Real Outcome → Calibration →（回到模型，闭环）
```

---

## B. Current → Target Architecture

### CURRENT（现状，2026-09-11）

```text
┌─────────────────────────── 学生侧 ───────────────────────────┐
│ 自报画像(targetScore/currentScore/remainingDays)               │
│        ↓                                                       │
│ 练习/模考/复习 ──作答──▶ EMA 掌握度(唯一写方+OCC) ──▶ 每日快照  │
│        │                    │                                  │
│        │                    ▼                                  │
│        │         calculatePriority(加性:考频/薄弱/遗忘/难度)     │
│        │                    ▼                                  │
│        └──────▶ composeDailyPlan(预算贪心) ──▶ StudyTask       │
│                     │完成任务(仅活动标记)                       │
│                     ▼                                          │
│              证据台账(strong/weak/none) ──▶ 只读投影            │
│                                                                │
│ 模考 ──▶ 正确率×80+自评 ──▶ AssessmentHistory(混来源,无量纲)    │
│ AI Coach ──▶ 纯文本建议(不执行/不追踪)                          │
└────────────────────────────────────────────────────────────────┘
影子层(teacher/admin only,零生产消费):
  score-opportunity / effectiveness / outcome-tracking
  mastery-calibration(150vs100量纲错配) / review-shadow / FSRS(UNTRAINED)
缺失: 真实分数入口 · 首见标记 · 复测调度 · outcome→排序 · 归因
```

### TARGET（目标态）

```text
┌────────────────────────── 数据底座 ───────────────────────────┐
│ Score Ledger(append-only):                                     │
│   ScorePrediction | ScoreAssessment | ScoreOutcome(实考)       │
│   + ScoreLossItem(逐题失分:nodeId/errorType/lostScore)         │
│   统一 150 制 + provenance + 量纲声明                           │
└────────────────────────────────────────────────────────────────┘
┌────────────────────────── 测量协议 ───────────────────────────┐
│ 入学诊断测(冷启动) → 干预后48h Transfer Probe → 周期迷你模考     │
│ AttemptSource: practice|review|transfer_probe|exam|diagnostic  │
│ + Question.firstSeen + 探针隔离题池                             │
└────────────────────────────────────────────────────────────────┘
┌────────────────────────── 决策层 ─────────────────────────────┐
│ OccurrenceProb × ScoreWeight × ErrorProb ──▶ ExpectedScoreLoss │
│   × Recoverability × TransferFactor ──▶ ExpectedScoreGain      │
│   ÷ TrainingCost(measured) ──▶ ROI ────────────▶ 排序主货币     │
│   × OutcomeFeedback(衰减聚合,置信门) ──▶ 修正                   │
│ 错因Taxonomy ──▶ 干预模板 ──▶ 探针类型(映射表,非第二引擎)        │
│ (priority 保留为冷启动回退+tie-breaker; 契约只做向后兼容增量)    │
└────────────────────────────────────────────────────────────────┘
┌────────────────────────── 闭环与归因 ─────────────────────────┐
│ AttributionGraph: Action→Exposure→Task→Attempt→Probe           │
│   →Assessment→ScoreDelta (每边: user/node/时间/证据/置信)       │
│ 校准: 分层 MAE/bias/区间覆盖率 → 模型可信度随证据升级            │
│ AI Coach: 建议→typed actionId→执行→outcome→回流AI上下文         │
│ North Star: Verified Score Gain / 30d（锚定模考,教师/rubric判分）│
└────────────────────────────────────────────────────────────────┘
```

**不变项（明确保留）**：`UserKnowledgeMastery` 唯一写方 + OCC、`applyMasterySemantics` 单点开关、LearningSession/AnswerReceipt 幂等脊柱、证据台账 EVIDENCE_RECORDED、canonical event writer、投影（Selector/纯函数）文化、legacy 回退双模式。

---

## C. Product Model（产品货币定义）

| 货币 | 定义 | 单位/域 | 数据来源 | 在闭环中的角色 |
|---|---|---|---|---|
| **Mastery** | 潜在能力代理：节点级 EMA（对二值正确率的追踪），含已知效度威胁（自评污染、方向瞬态） | [0,1] / (student,node) | UserKnowledgeMastery | 误差概率的**输入**，不是产品结论 |
| **Accuracy** | 观测频率：作答正确占比，按 attempt source 分层（practice/review/probe/exam） | [0,1] | PracticeRecord/ReviewAttempt/探针 | 描述性；**分层后**才可用于校准 |
| **Priority** | 现行排序值：加性启发式 | 0-100 | priority.ts | 降级为**冷启动回退 + tie-breaker** |
| **Expected Score Loss (ESL)** | 期末考试上，因该节点当前状态预计丢的分：`OccurrenceProb × ScoreWeight × ErrorProb` | 分（150 制） | 考频快照+真题分值+EMA | 失分地图的原子量 |
| **Recoverable Score (RS)** | ESL 中可被训练消除的部分：`ESL × Recoverability × TransferFactor` | 分 | Recoverability 模型（§H）+ 探针实测迁移率 | "值得修"的判断 |
| **Expected Score Gain (ESG)** | 单位干预周期的期望提分：本轮计划内该节点 RS 的可实现部分 | 分 | RS × 计划覆盖假设 | 排序分子 |
| **Training Cost** | 预计把该节点修到目标水平所需分钟数：缺口大小 × 历史学习速度（实测），静态表仅作冷启动回退 | 分钟 | 用时遥测（需新增记录）+ estimateMinutes 回退 | 排序分母 |
| **ROI** | `ESG / TrainingCost` = **每小时预计可恢复分数** | 分/小时 | 上述合成 | **最终排序货币（经 §I 方案比较后确认）** |
| **Outcome** | 已发生的分数事实（判分/实考），与 prediction 严格分账 | 分 | Score Ledger outcome 层 | 校准与归因的锚 |

**排序货币的分析与决定**：默认候选 `Expected Recoverable Score / Training Cost`（即 ROI，分/小时）**经分析后采纳，但加三条约束**：

1. **最低收益门槛**：纯比率会偏爱"小缺口低成本"节点（捞 0.5 分只花 5 分钟 ROI 反而最高）。排序要求 `ESG ≥ 1 分`（可配置）才进入 ROI 主序，低于门槛的节点退回 ESL 序。
2. **预算语义**：排序货币是 ROI，但计划合成（composeDailyPlan 预算贪心）的目标函数语义是"时间预算下总 ESG 最大化"——按 ROI 排序装入正是该背包问题的经典贪心近似，两者在数学上一致，不需要第二套装填算法。
3. **置信门**：必需因子缺失时不出 ROI（沿用 score-opportunity 的 blockedBy 诚实缺席语义），退回 priority——**绝不伪造分值**。

被否决的候选：`ESG` 绝对值（忽略成本，偏向大节点刷时长）、`priority`（无量纲，现状的问题就是它）、`TransferRate`（是 leading indicator，不是分值，见 §Q）。

---

## D. Score Ledger（分数账本，schema 级概念设计）

> 以下为**概念模型**，非 Prisma 代码；所有 schema 变更走独立批准门。设计原则：append-only、三类记录构造性隔离、统一量纲、provenance 强制。

### D.1 三类记录，构造性不混淆

```text
ScorePrediction   —— "系统预测你会考多少"（模型输出,可错）
ScoreAssessment   —— "一次被测量的表现"（判分事实,有噪声）
ScoreOutcome      —— "已发生的最终成绩"（实考/教师终判,最高置信）
```

每条记录必须携带 `kind ∈ {prediction, assessment, outcome}`——不是字段约定，而是**三张独立的表/三个独立写入 API**，从结构上禁止用 mock 分冒充实考分（审计确认的 external-input gap 的根治方式）。

### D.2 概念 schema

```text
ScoreEntry（账本主表,append-only,禁止 UPDATE 历史）
  id, userId, kind(prediction|assessment|outcome)
  examType   : mock_in_app | mock_external | teacher_graded | institution | real_exam | diagnostic
  source     : system_graded | self_reported | teacher_graded | rubric_graded | imported
  provenance : { originId(会话/试卷/外部凭证引用), enteredBy, enteredAt, evidenceRefs[] }
  rawScore, rawTotalScore, rawScale(100|150|其他)
  normalizedScore  ← normalizeScore(raw, rawScale→150)   ← 量纲错配的根治点
  examDate    : 考试发生日（非录入日）
  confidence  : 按 provenance 分级（teacher_graded > system_graded > self_reported）
  modelVersion: prediction 行必填（可复现）

ScorePrediction  extends ScoreEntry
  minScore, maxScore, basis[], inputsSnapshot(mastery/accuracy/remainingDays)

ScoreLossItem（逐题失分行,挂在 assessment/outcome 下）
  scoreEntryId, questionId, nodeIds[](经既有三层题-节点解析)
  errorType  : 九类错因 taxonomy（§G）
  lostScore, maxScore, questionType(单选|计算|算法|综合)
  recoverableAtRecording: 记录时刻的 RS 快照（供事后归因对照）

CalibrationPair（派生,可重建）
  predictionId ↔ outcome/assessmentId（时间窗+examType 分层配对）
  error, absError, withinPredictionInterval, scalePair(150↔150 强制)
```

### D.3 关键规则

- **量纲**：`normalizedScore` 一律 150 制；校准配对**只在等量纲间进行**（修复 score-calibration.service 现行 150 预测 vs 100 actual 直接相减的错配——gap report §10）。
- **不可变**：录错分 = 追加 correction 行并引用原行，永不改写（延续 V12.1 "历史事实不因回滚改写"的先例）。
- **来源分层校准**：MAE/bias 按 provenance 分层计算（in-app mock 一层、教师判分一层、机构分一层、实考一层）；混合层校准数字不可解释，禁止输出单一混合 MAE。
- **与现有资产的映射**：in-app 模考从 LearningSession(paper) 派生 assessment 行；既有 import 通道（study.service.ts:1868-1901）升级为 assessment/institution 写入口并补 provenance；AssessmentHistoryItem 保留兼容读路径，新账本为 SoT。现状"无来源字段、只能靠 id 前缀区分"（schema.prisma:807-825）被构造性修复。

---

## E. Transfer Probe（迁移探针，完整实验协议）

### E.1 协议

```text
干预完成（节点 N 上有判分练习证据）
   ↓ 调度器（复用 review 排程基建,不走 SM-2）
+48h ± 6h 探针窗口
   ↓ 选题器
1 道同构新题（N 节点、题型匹配、从未被该学生见过）
   ↓ 作答（计时,期望时长对齐 exam 口径）
TransferResult → PracticeRecord(source='transfer_probe') + 证据台账
   ↓ 聚合（证据门:样本≥5 才出结论,沿用 EVIDENCE_GATE 纪律）
TransferRate(node) = 探针正确率
TransferGap(node)  = 练习准确率(排除 review/probe) − TransferRate
```

### E.2 必需的字段与设施（概念清单）

- `AttemptSource`：`practice | review | transfer_probe | exam | diagnostic`（PracticeRecord 增量可空列，历史行 NULL=未知，与 ReviewAttempt 四列迁移同一先例）。
- `Question.firstSeen` 维度：不需要新列——由"该用户对该 questionId 的最早 attempt"派生（但**选题器必须查询它**，这是探针反污染的核心查询）。
- 探针隔离题池：题目打 `probe_pool` 标签（内容治理任务），**不出现在日常练习面**；或对已用作探针的题延迟 N 周释放进练习池。
- `ProbeTask`：以 StudyTask（recommendationAction 绑定）落库，复用 canonical writer，不建第二套任务系统。

### E.3 四类污染的规避设计

| 污染 | 规避机制 |
|---|---|
| 重做记忆效应 | 选题器强制 `该学生对该题零历史 attempt`（含会话快照内未提交题）；无可用新题时**诚实跳过**（`no_probe_available`），绝不降级用旧题冒充 |
| 题目泄漏 | 探针池与练习池物理分离（标签+前端过滤）；探针作答不展示解析直至窗口结束 |
| 同题复现 | 排除该用户全量 attempt 历史 + 最近 N 天所有 surfaces 展示过的题（按 LearningSession 快照反查） |
| 难度不一致 | 分层匹配：探针难度 = 该节点练习难度分布的中位桶；同节点交替发放"练习难度探针"与"考试难度探针"，分别报告 TransferGap，绝不混合后报一个数 |

### E.4 统计纪律

- 单学生单节点样本极少：**探针结论只按节点聚合**（跨学生），个人报告只显示个人事件不显示聚合结论——延续"无证据不出结论"的诚实条款。
- TransferFactor 进 ROI 公式：`TransferRate(node) 加权（按样本数）`，无数据节点取保守常数 0.6 并在 basis 声明（禁止 1.0 默认乐观）。

---

## F. Error → Intervention（错误→干预映射体系）

### F.1 九类错因的完整定义与数据来源

| 错因 | 判定来源 | 自动可信度 | 现状 |
|---|---|---|---|
| concept gap | 自报信心"完全不会"+诊断测 | 中 | ≈"知识点没学过" |
| confusion | 对比题错误模式 + 自报 | 中 | 现为兜底桶，需收窄 |
| method gap | 解题步骤（大题 rubric）/ 提示依赖 | 中（大题）/低（MC） | ≈"推理过程错误" |
| calculation | 计算步 rubric 采分点 / 自报 | 中（大题）/低（MC） | 仅自报 |
| careless | "会做但错"：同题 review 重做对 + 探针对 + 时间正常 | 高（需复测数据） | 无此类别 |
| boundary omission | 边界陷阱题错误模式 / rubric | 中 | 无 |
| expression | rubric 表达采分点失分 | 高（大题） | 无 |
| time pressure | 未作答/严重超时 | 高 | ≈"时间不足" |
| transfer failure | **由探针定义**：练习对、同构新题错 | 高（S2 后） | 无 |

设计要点：careless/transfer failure 两类**只有复测/探针数据存在后才能定义**——错误分类学的完备性与测量协议（§E）是耦合的，这是本设计与"再加几个枚举值"式方案的本质区别。

### F.2 映射表（错误类型决定干预模板与探针类型）

```text
ErrorType          → InterventionTemplate                → ExpectedOutcome          → Retest
concept gap        → 教材补学 + 基础题组(LEARN)           → mastery↑ 且探针过         → 新题探针
confusion          → 对比辨析题组(相邻节点成对出题)        → 辨析题正确率↑             → 对比型探针
method gap         → 例题精讲 + 分步跟练 + 变式梯度        → 变式题正确率↑             → 方法型探针
calculation        → 限时计算组 + 草稿步骤保留习惯         → 计算题正确率↑ 且用时↓     → 计算型探针(限时)
careless           → 查验协议训练(条件圈画/提交前复核)     → 同难度正确率↑             → 陷阱条件探针
boundary omission  → 条件枚举清单训练                     → 边界陷阱题正确率↑         → 边界陷阱探针
expression         → rubric 分步训练(采分点自查)           → rubric 采分点命中↑        → rubric 评分复测
time pressure      → 限时套题 + 节奏策略                   → expectedTimeSec 内完成率↑ → 限时探针
transfer failure   → 交错练习 + 变式轮换                   → TransferGap↓              → 探针本身
```

### F.3 接线方式（不建第二引擎）

- `classifyAction` 的输入（PriorityCandidate）**增量扩展**一个可选 `dominantErrorType` 字段——契约允许向后兼容增量（新增可选字段；契约文档 §6/§10 明文）。动作选择的优先序变为：错误类型映射（§F.2）→ 现行计数规则（wrongCount/forgetting/mastery）作回退。
- `MISTAKE_SUGGESTIONS` 从答题瞬间的前端文案升级为上述映射表的 SoT（shared 纯函数，前后端同源）。
- 关键验收：**任何错误类型都不再"被记录但无人消费"**——每类错误必须映射到至少一个可执行干预模板与一种复测手段，否则该类别不进 taxonomy（防止装饰性枚举）。

---

## G. Opportunity Engine（公式与数据要求）

### G.1 公式（每因子声明数据来源与置信，延续 score-opportunity 反黑箱模式）

```text
ESL(node,s)   = OccurrenceProb(node) × ScoreWeight(node) × ErrorProb(node,s)
RS(node,s)    = ESL × Recoverability(node,s) × TransferFactor(node)
ESG(node,s)   = RS × SessionCover(plan)            ← 本轮预算内可实现份额
ROI(node,s)   = ESG / TrainingCost(node,s)
```

| 因子 | 公式 | 数据 | 置信上限 |
|---|---|---|---|
| OccurrenceProb | recent3Y.frequency/5 为主，allTime 修正；题型分桶修正（§P 408 特化） | KnowledgeFrequencySnapshot（已有，1149 条） | high |
| ScoreWeight | primaryScore5y / 45；无快照节点 = 缺失不出分（不按 0） | 同上 | high |
| ErrorProb | 1 − mastery（分层：按 attempt source；主观题错误概率单独建模待 rubric） | UserKnowledgeMastery（已有） | medium |
| Recoverability | 见 §H | 多源 | low→medium（随 S2/S3 证据升级） |
| TransferFactor | 节点级 TransferRate 加权；无数据 = 0.6 常数+声明 | S2 探针 | low→high |
| TrainingCost | `缺口小时数 = f(Δmastery, 节点题量) × 学习速度系数`；学习速度 = 学生实测分钟/掌握度增益（需新增用时记录）；回退 = estimateMinutes | 用时遥测（新增）+ estimateMinutes（已有） | medium |

### G.2 数据要求（相对现状的增量）

已有（直接复用）：考频快照、真题分值、EMA、OCC、前置关系（B6 稀疏已声明）、estimateMinutes。
**新增数据**：①学生逐任务用时（TrainingCost 从估算升级为实测的前提）；②探针结果（TransferFactor）；③锚定考试分（校准整个 150 制映射）；④题型×节点分值分布（408 特化，见 §P）。

---

## H. Recoverability（可恢复性模型）

回答："这个知识点虽然薄弱，但到底值不值得现在花时间修？" 定义为 `P(训练成功 | 该生该节点)` ∈ [0,1]，**可解释、逐因子带置信声明**（扩展现有 score-opportunity 的 factor catalog，而非另起炉灶）：

```text
Recoverability = w1×Historical + w2×Prereq + w3×TransferEvidence + w4×ErrorFit
                （权重公开常量；缺因子→排除+降置信+重归一，缺必需→不出分）
```

- **Historical**（w1, high）：曾做对（correctCount>0）、最好连对纪录、正确率轨迹斜率（上升中的缺口比下坠中的缺口更可恢复）。
- **Prereq**（w2, low，B6 稀疏限制如实声明）：前置节点就绪度均值；无边→排除不猜。
- **TransferEvidence**（w3, low→high 随 S2）：该节点历史 TransferRate——探针数据是"可恢复"最直接的经验证据。
- **ErrorFit**（w4, medium）：主导错因类型是否有对应干预内容（expression 类在无 rubric 内容时 ErrorFit 强制下调——诚实地承认"现在修不了"）。

**防呆规则**（继承 V12-M4 被测试钉死的那条教训）：`everSucceeded=false` 且无前置证据时 Recoverability 封顶 0.45——不给"没有任何切入点"的知识点开高恢复预期。
**反双重计数**：exam importance **不进** Recoverability（它已在 ESL 分子中）——Recoverability 只回答"能不能修好"，不回答"值多少分"。

---

## I. Recommendation（排序方案比较与决定）

### 方案 A：priority 为基座，注入 score opportunity

机会分作为 calculatePriority 的新增分量/乘子（或同级 tie-break），契约向后兼容增量。
✅ 稳定性高（EMA 抖动被加性结构稀释）、冷启动可用（缺数据退回原公式）、回滚容易（单分量摘除）、风险低。
❌ 仍是混合量纲（分与 0-100 相加），解释力弱（"为什么推荐"回答不了"值几分"），机会分实际影响被 0.37 的 examValue 等既有权重稀释。

### 方案 B：ROI 为主排序，priority 回退

`ROI = ESG/Cost` 主序 + ESG≥1 分门槛 + 缺必需因子退回 priority + priority 作 tie-break。
✅ 货币诚实（直接回答学生唯一关心的问题）、ROI 分辨率跨数量级（离线复算：真实 ROI 差 18 倍时 priority 只差 2 分）、与预算背包语义一致。
❌ 稳定性风险（mastery 微变 → ROI 跳变，需滞回/平滑）、冷启动依赖多（无快照/无成本模型即失效）、全量切换回归风险大、学生理解成本**反而最低**（"练它能捞几分"）。

### 逐维比较

| 维度 | A | B |
|---|---|---|
| 稳定性 | 高 | 中（需平滑） |
| 可解释性 | 中 | 高 |
| 冷启动 | 好 | 差（需回退分支） |
| 数据不足 | 优雅降级 | 构造性拒绝出分（诚实但覆盖低） |
| 计算成本 | 低 | 低-中（成本模型） |
| 风险 | 低 | 中（排序面全变） |
| 回滚 | 容易 | 容易（flag）但影响面大 |
| 学生理解 | 中 | 优 |

### 决定：**A→B 两阶段，B 为终点**

- **S3 阶段用 A**：机会分以影子对照 2 周（排序分歧分布、预注册阈值）→ 以 tie-break 注入优先级带内。理由：风险可控、立即产生真实对照数据。
- **S4 阶段切 B**：ROI 主序 + ESG 门槛 + 置信门回退 + 滞回平滑（节点 ROI 变化 <15% 不触发重排，防抖动）+ 影子→canary→全量。理由：提分产品的排序货币必须可结算到分；A 只是过渡脚手架。
- 契约纪律：B 的排序变更属语义变更，按契约 §10 升版 `recommendation_engine_v2` 并重审，不偷偷增量。

---

## J. Intervention（执行与复测）

```text
Recommendation（ROI 排序产出）
 → Exposed（既有曝光遥测）
 → Accepted/Started（Action 状态机,已有）
 → Training Executed（判分练习,已有）
 → Probe Scheduled【新增,强制】── 干预完成事件触发 48h 探针任务
 → Probe Result（source='transfer_probe'）
 → Evidence Verdict（improved / practiced_no_gain / insufficient_data,复用 task-evidence 语义）
 → Outcome Signal（SUCCESS/PARTIAL/FAILED,已有 ActionLearningSignal）
 → Feedback（§K）→ Assessment（模考）→ Score Ledger
```

**"任务完成"语义二分（本节核心）**：
- `completed` = 活动标记（现状保留,继续"永不构成能力证据"）；
- `intervention_closed` = 新增终态：探针已交付**且**有 verdict。任务列表 UI 将两者分开呈现；`intervention_closed` 是 outcome 信号的唯一合格来源——**"完成"与"学习成功"之间的强制测量点由此建立**。
- 探针过期（学生不做）：如实记 `probe_expired`，verdict=insufficient_data，**不计为失败**（不惩罚），但影响该节点证据新鲜度。

---

## K. Outcome Feedback（推荐如何学习）

### K.1 机制

```text
Outcome(action) ──已有──▶ SUCCESS/PARTIAL/FAILED
聚合层【新增】PatternOutcome = group_by(nodeId, actionType, dominantErrorType)
   成功率 = Σ(权重×结果) / Σ权重，权重 = exp(−Δt/30d)   ← 30 天半衰期衰减
   样本 <5 → 不影响排序（仅记录）
排序层【新增】ROI_adj = ROI × f(成功率)
   f: [0,1]→[0.5, 1.1] 有界映射,成功率 0.5 映射 1.0（中性点）
   探索项：低样本节点 +ε 小幅加成（保持数据流入,防冷节点永沉）
```

### K.2 防"一次失败永久降级"

四重保险：①**有界**（f 最低 0.5，永不归零）；②**衰减**（30 天半衰期，旧失败自动失效）；③**模式级聚合**（按 node×actionType×errorType 聚合，非单 action；单次偶然失败被样本稀释）；④**样本门**（<5 次不出信号）。反向同样成立：连续 SUCCESS 最多放大 1.1 倍，防正反馈失控。

### K.3 交付纪律

Shadow 先行（`/coach/pattern-outcome` teacher/admin 只读）→ 预注册阈值（f 介入后排序位移分布、方向一致率）→ owner 批准 → canary。全部落在 shared 纯函数 + 只读装配，零权威写路径扩散。

---

## L. AI Coach（从"会说"到"可验证行动"）

```text
AI Diagnosis（结构化:引用 nodeId/errorType/证据台账,禁虚构——复用 Study Agent collectKnownNodeIds 反幻觉模式）
 → AI Explanation（RAG grounded,内容不改状态）
 → AI Action（typed proposal: {kind: start_task|schedule_probe|request_teacher_grading|add_to_review, targetId}）
 → actionId（映射到 canonical 动作面,经既有授权门）
 → Intervention → Probe → Outcome
 → Feedback（AI 上下文注入"你上次的建议 outcome 如何"——Coach Memory 扩展,非新表）
```

- **Human-in-the-loop 边界（硬约束）**：AI 永不直接写 mastery/计划/排程（现行 prompt 禁令保留并升级为源码级断言）；AI 可执行的动作仅限上述四类 proposal，经 canonical writer；**大题 rubric 判分 AI 只能作为候选评分器对照离线基线，终判权在教师**（V12-M6 已建立的边界原样保留）；AI 建议的内容补录走既有导入审核队列。
- **可验证性**：coach_suggestion.{exposed, accepted, completed} 遥测（带 userId）→ 与 outcome 链 join → AI 建议的接受率/成功率成为一等指标。AI 从"文案生成器"变成"有账可查的教练"。

---

## M. RAG / Agent（服务学习结果，不服务"AI 感"）

- **定位**：RAG = 解释质量基础设施（Coach/错题解析的内容供给）；Agent = canonical 动作面的自然语言入口。二者都不产生独立的学习状态（Agent 已守此纪律，审计确认非第二 SoT）。
- **测量升级（Architecture Gap 补口）**：现行 ai-metrics 无 userId、内存 60 分钟滑窗（ai-metrics.service.ts:2-40）——RAG 的学习有效性在数据结构上不可测。设计要求最小遥测：`rag.used{userId, surface, nodeIds, query}` 持久化（UserEvent 通道即可）+ `rag.helpful` 显式反馈。链路：RAG 解释 → 学生是否开始该节点任务 → 探针 outcome → **RAG→学习结果的弱归因**。
- **不做清单**：不为"AI 感"新增模块——不做多 Agent 编排扩展、不做 3D/可视化 Agent、不做无 outcome 挂钩的 AI 报告生成。每项 AI 投入必须声明它改善哪段因果链。

---

## N. Cold Start（初始能力与失分地图）

### N.1 诊断性入学测（Diagnostic Assessment）

- **蓝图**：408 结构分层抽样 30-45 题（4 科 × 难度桶 × 题型：单选必含 + 每科 1 道综合题），时长 45-60 分钟，计入 Score Ledger（examType=diagnostic）。
- **产出**：①已测节点的初始 mastery（真实作答驱动，替换 neutral 0.5）；②未测节点的**分层先验**（科目先验 + 节点考频加权 + 前置传播），并携带宽置信区间；③首张 Score Loss Map（逐节点 ESL）；④第一个校准锚（诊断预测 vs 诊断实绩）。
- **为什么优于 neutral 0.5**：0.5 把"未知"与"半会不会"混同（weakness 0.43 vs 练过 55 分的 0.39 几乎同档，gap report §6.1）；诊断测把未知变成"已测量"或"有来源的先验+宽区间"，且让失分地图从第一天就存在——ROI 公式因此不依赖"先练一阵子才有分值感"。

### N.2 拒测回退

跳过诊断的学生：保留 neutral 值但 `evidence=none` 强制标注；产品呈现"未测"而非"43% 薄弱"（修复现状把先验当测量的展示语义）；排序用先验但置信门压低。

---

## O. Measurement Plan（E1-E4，承袭 gap report §24 并对齐里程碑）

| 实验 | 验证问题 | 里程碑 | 设计要点 | 门槛（预注册） |
|---|---|---|---|---|
| **E1 分数锚定** | 预测分准不准 | S1 | 5-10 名真实学生：录入 examDate → 1 次教师/rubric 判分全真模考 → 1 次外部成绩 import → 修复量纲后跑校准 | 每层 provenance n≥5 才出 MAE；error 中位数 <15 分才允许估算分见学生 |
| **E2 迁移探针** | mastery 预测新题吗 | S2 | 30 高频节点 × 2 道同构新题，干预后 48h 下发，按 §E 协议 | 节点聚合 n≥5；TransferGap 首个数字 + TransferFactor 上线 |
| **E3 排序对照** | ROI 排序优于 priority 吗 | S4 | assignExperimentArm 分流：A 组 priority / B 组 ROI 周计划 ×4 周，锚定模考结算 | B 组 Verified Score Gain 中位数 ≥ A 组 +3 分且无回退信号 |
| **E4 归因回溯** | 干预与失分变化相关吗 | S7 | outcome verdict 集合 × 30 天内模考 ScoreLossItem join（只读） | 相关性显著才开放学生侧归因卡，否则保持 teacher-only |

---

## P. Data Requirements（四类数据盘点）

| 类别 | 已有（复用） | 需新增（schema 需批准） | 需教研/内容 | 需学生/运营 |
|---|---|---|---|---|
| 分数 | LearningSession(paper)、import 通道、AssessmentHistoryItem(兼容) | **Score Ledger 三表 + examDate** | 大题 rubric 内容（B-F4，0 行→生产） | 外部成绩录入（机构分/实考分） |
| 迁移 | PracticeRecord、题目难度标签 | **AttemptSource 列 + 探针任务类型** | **探针隔离题池**（每高频节点 ≥3 道同构新题储备） | 48h 内完成探针 |
| 机会 | 考频快照(1149)、真题分值、EMA、estimateMinutes | **逐任务用时记录**（TrainingCost 实测化） | 题型×节点分值分布表（408 真题结构维护） | — |
| 反馈/归因 | ActionLearningSignal、UserEvent、证据台账、曝光遥测 | PatternOutcome 聚合投影（纯派生） | — | rag.helpful 显式反馈、诊断测参与 |

**408 特化数据**（§P 专列）：题型分值权重表——单选 40×2=80 分（careless/calculation/time 主导，自动判分，探针=新单选）；综合应用题 70 分按科分布（DS 45/CO 45/OS 35/CN 25 的科内大题：算法题、计算题、分析题），expression/boundary/method 主导，**判分依赖 rubric**，探针=变式大题+rubric 复评。两路径的 ESL/RS/Transfer 分别建模、分别报告，禁止合并成单一"掌握度"。题型先验（各科大题中考点出现形态）是教研侧新增数据需求，直接影响 OccurrenceProb 的题型分桶修正。

---

## Q. Migration Strategy（从 V12 演进）

1. **零破坏增量**：所有 schema 变更均为追加（新表 ScoreEntry 系、新可空列 attemptSource/examDate），历史行 NULL=未知，沿用 review_attempt 迁移先例；不回填、不改写既有行（EMA 语义、OCC、canonical writer 零触碰）。
2. **契约纪律**：排序货币切换（§I 方案 B）按契约 §10 升版 `recommendation_engine_v2` 重审；schema/契约两项各设独立 owner 批准门（沿用 Question.rubric 与 M3-C1 的先例流程）。
3. **影子先行序列**：每个能力先以纯函数+只读装配上线（Score Ledger 派生读模型 → 探针影子 → ROI 影子对照 → outcome 聚合影子），复用 score-opportunity/effectiveness 已验证的装配模式。
4. **双读兼容**：AssessmentHistoryItem / estimatePredictedScore / priority 排序在新货币稳定前保留为兼容读路径（legacy 回退双模式是仓库宪法级实践）。
5. **每个里程碑独立可发布**：S1 不依赖 S2；S3 可在 S2 无数据时以保守 TransferFactor 运行——不存在"必须八步全做完才有价值"的串行依赖。

---

## R. Rollback Strategy

- **开关**：每阶段一个环境开关（复用 `MASTERY_SEMANTICS` 式单点解析惯例：未设置=旧行为，未知值回落旧路径，拼写错误不静默启用）；排序开关 `RANKING_CURRENCY=legacy|hybrid|roi` 三档。
- **影子优先**：影子阶段回滚 = 删环境变量；带内行为逐字节不变（M3 Phase C 已验证过该验证方法学）。
- **数据不可变保护**：Score Ledger append-only + correction 行——错误数据永不污染历史；回滚只停写入/停消费，已落账本的事实保留（历史事实不因回滚改写）。
- **排序回退**：`legacy` 档 = 现行 priority 逐字节路径，保留 parity 测试（新引擎输出与 legacy 在退化输入上 deepEqual 的边界用例，延续 daily-plan-parity 文化）。
- **明确不做**：不删除旧列/旧表、不回填掌握度、不为变绿放宽断言（v12-failure-classification 维护规则延续）。

---

## S. Milestone Plan

| 里程碑 | 交付 | 依赖 | 批准门 |
|---|---|---|---|
| **S1 Score Anchor** | Score Ledger 概念落地（三表+量纲归一+provenance）、examDate、校准分层修复、E1 | 无 | Schema 批准 |
| **S2 Transfer** | AttemptSource、探针题池治理、探针调度器、TransferRate/Gap 投影、E2 | S1（账本记探针事件可后置,弱依赖） | Schema 批准 + 内容任务 |
| **S3 Opportunity** | ESL/RS/ESG/TrainingCost 实测化、Recoverability 模型、机会影子对照（方案 A 注入） | S1（分数校准 ESL 量纲）、S2（TransferFactor,无则保守常数） | 预注册阈值 |
| **S4 Recommendation** | ROI 主序（方案 B）+ ESG 门槛 + 滞回平滑 + 置信门回退、契约 v2、E3 | S3 | 契约 v2 重审 + canary |
| **S5 Intervention** | probe scheduling 进任务面、intervention_closed 终态、verdict 接线 | S2 | — |
| **S6 Outcome Feedback** | PatternOutcome 聚合 + f 映射 + 探索项、影子→canary | S5（verdict 源） | 预注册阈值 |
| **S7 Attribution** | AttributionGraph 读模型 + E4 + 学生侧归因卡（置信标注） | S1-S5 | E4 相关性门 |
| **S8 AI Effectiveness** | coach_suggestion 遥测、typed AI action、rag userId 持久化、AI outcome 上下文回流 | S5（action 面） | — |

---

## T. Top 3 Priorities（未来 3 个最高价值工程任务）

1. **S1 Score Ledger + Score Anchor + 量纲修复**——结算货币。没有它，S3-S8 全部无法对照现实；它是 gap report "3 件事"第 1 位的工程化落地。验收：E1 产出首个分层 MAE。
2. **S2 Transfer Probe 端到端**——效度校准器。迁移可测后，mastery 第一次获得外部校准、Recoverability 获得经验证据、Error taxonomy 补齐 careless/transfer failure 两类。验收：E2 产出 TransferGap 分布。
3. **S3+S4 Opportunity Engine → ROI 排序（分两步走）**——产品货币切换。把"学习优先级"换成"每小时预计可恢复分数"，并用 E3 证明它真的更好。验收：影子对照 + canary 后 Verified Score Gain 改善。

（S5-S8 在前三项产生真实数据后启动，避免在无测量地基上先建反馈/归因的空中楼阁。）

---

## U. Architecture Gap 登记簿（发现但不自行修复）

| # | Gap | 影响 | 归属 |
|---|---|---|---|
| AG-1 | User 无 examDate、无真实成绩表 | S1 必须 schema 增量 | Owner 批准 |
| AG-2 | ai-metrics 无 userId、内存 60 分钟滑窗 | AI/RAG 有效性当前不可测（S8 前置） | S8 工程 |
| AG-3 | B13：332 题 0 直接节点标注（1:20 桥接） | 节点级失分归因精度上限 | 内容任务（流程已在册） |
| AG-4 | estimateMinutes 静态、无逐任务用时记录 | TrainingCost 置信上限 medium | S3 工程+遥测 |
| AG-5 | 阶段测评独立通路结果仅存内存数组 | 评估历史不完整 | 独立小任务 |
| AG-6 | AssessmentHistoryItem 无 provenance 字段 | 分层校准不可行（S1 账本接管后消除） | S1 |
| AG-7 | 引擎契约 v1 冻结 | ROI 主序必须升 v2 重审（非缺陷,是纪律） | S4 流程 |
| AG-8 | 题库无探针隔离机制（练习面暴露全库） | 泄漏防护依赖内容治理 | S2 内容任务 |
| AG-9 | rubric 生产 0 行内容 | 70/150 主观分精确测量缺位 | 教研任务 |
| AG-10 | 考频快照为节点级近似，题型×科目出现形态未建模 | OccurrenceProb 精度上限 | 教研+内容 |

---

## V. 停止声明

本设计为 READ-ONLY 任务产物：**零代码、零数据库变更、零迁移、零部署、零功能实现、零 commit**。本文件是唯一产物。所有"现状"陈述以 `docs/score-improvement-gap-report.md`（2026-09-11）与其引用的代码事实为准；所有 schema/契约变更均为**提案**，须经所有者按 §Q 的批准门逐项决策。设计到此停止。
