# S1 Score Anchor — Formal Design（Design Gate 产物）

> 日期：2026-09-12 ｜ 性质：**FORMAL DESIGN ONLY**（零代码、零 schema、零迁移、零部署、零开关变更）
> 上游：`docs/s1-score-anchor-audit.md`（READ-ONLY AUDIT，S1 STATUS = READY FOR DESIGN）
> 基线：`feature/v3-product-refactor`，HEAD `35f95b76`，与 origin 同步
> 已确认事实（本设计不再论证，直接采用）：`5e810833` 已建立 Score Anchor evidence ledger；迁移 `20260912120000_score_anchor_foundation` 已应用；四表与 `User.examDate` 已存在；raw 量纲保持；provenance / correction / append-only 已存在；150 制 `normalizeScore` 已存在；**mastery → score 零回流已验证**；North Star = `Verified Score Gain / 30d`；`TRANSFER_PROBE_ENABLED=false`；`MASTERY_SEMANTICS=OFF`；不进入 S3；不做 `TransferGap → TransferFactor → ROI → Recommendation`。
> 本文件是本阶段**唯一产物**。未修改任何代码、schema、迁移、测试、开关。

---

## 一、S1 的正式目标（重新定义）

S1 **不再**定义为"建立 Score Anchor"（那已经完成）。S1 定义为：

> **把已有的 Score Anchor 变成 Score Improvement 闭环可以信任的测量基础。**

即建立并**强制**一条可审计的推导链：

```text
Real / Assessment Score   （OBSERVED，已在 ledger）
        ↓
Score Loss                （分层：L0 可观测 / L1 逐题 / L2 节点归因）
        ↓
Ability Gap               （PROXY，唯一诚实通道 = 1 − mastery）
```

**同时明确一条本阶段不得跨越的界线**：

```text
Score Loss → Verified Score Gain        ✗ 本阶段不做、不实现、不宣称
```

理由：`Verified Score Gain` 需要"干预前分数 → 干预 → 干预后分数"的**真实配对**，而当前 PRIMARY 层校准样本 = 0，且 `ScoreOutcome` 无自动来源（只有手工/教师录入）。任何在此条件下算出的 "gain" 都是伪的。**本设计明确拒绝实现伪 Verified Score Gain**（§九）。

---

## 二、P0 / P1 / DEFER 三层范围

```
P0  = 必须修复，否则 Score / Opportunity 不可信（零 schema，纯代码 + 纯函数）
P1  = Score Loss Evidence（需要 schema 增量 + 内容侧标注；设计完成，实现待 schema 批准）
DEFER = 有想法但当前无消费者 / 会引入无谓面积
```

### 2.1 P0 逐项裁定

#### P0-1 Calibration compatibility 漏洞 — **必须修复（严格 invariant）**

**现状（已核实）**：`packages/shared/src/score-center/score-calibration.ts:212` 守卫为 `if (pair.totalScore != null && pair.totalScore !== 150)`；`:220` 随后执行 `round2(pair.actualScore - pair.predictedBest)`。因此 `actualScore=96, totalScore=null, predictedBest=26` **仍然产出 error=70**。只有 API 层通过派生 `semantic='accuracy_rate'`（`score-calibration.service.ts:200-206,343-355`）把它挡住 —— **共享纯函数本身留洞**。

**裁定**：把"能否相减"从"调用方是否传了 totalScore"改为**显式证明量纲等价**。定义严格 invariant（§十 INV-1/INV-2）：

```text
error 只在以下全部成立时才产生；否则 ok=false + reason（并计入 exclusions，永不平均）：
  E1 evidence.normalizedTotalScale === 150       且该值来自「行」而非常量
  E2 evidence.semantic === 'exam_total' 且 prediction.semantic === 'exam_total'
  E3 evidence.source 属于 SCORE_SOURCES 且 calibrationLayerOf(source) !== null
  E4 evidence.occurredAt != null 且 evidence.occurredAt >= prediction.generatedAt
  E5 evidence 的 150 制归一化可被证明（normalizedScore 存在，或 rawScore+rawTotalScale 存在）
```

**必须新增的负例测试**：`{actualScore: 96, totalScore: null, predictedBest: 26}` → **`ok=false`**，`reason` 含 `scale_unproven`（或等价码），**`error === null`**。

**同时修复同源问题**：`score-anchor.service.ts:612` 构造 `evidenceRef` 时**硬编码** `normalizedTotalScale: SCORE_NORMALIZED_TOTAL_SCALE`，而 `:549-570` 的映射丢掉了该行真实值 → 该路径上的 scale 检查**同义反复**。改为读行值（INV-2）。

#### P0-2 Opportunity 两套 normalization — **必须统一**

**现状（已核实）**：

| 位置 | 归一 | 性质 |
|---|---|---|
| `score-opportunity.service.ts:129,146-147` | `snapshot.primaryScore5y / maxPrimaryScore`（`maxPrimaryScore = max(1, …所有节点)`） | **相对**（依赖数据集里还有哪些节点） |
| `shadow-decision-chain.ts:229-230,243-244` | `Math.min(1, primaryScore5y / 45)` | **绝对**（45 = 408 全卷分值口径） |

**裁定**：**绝对归一为 canonical**：`scoreWeightFactor = clamp01(primaryScore5y / 45)`。

理由（三条，全部可检验）：
1. **相对归一不是关于这个节点的事实** —— 同一节点在两次不同候选集里得到不同 `examImportance`，因此两个端点的 opportunity 分数**不可比**，也无法跨学生/跨时间聚合。
2. 它已经与 `priority.ts:49`（`0.06 × clamp01(primaryScore5y / 45)`）**同口径**，统一后 `priority` 与 opportunity 对同一事实的读法一致，是消除 double counting 的前提。
3. 45 分是 408 全卷真题分值的可解释上界（`primaryScore5y` 最大值实测为 39，见审计 §A.4），分母有物理含义而非数据集偶然。

**必须新增的测试**：同一节点在"只有它"和"与 30 个高分节点同池"两种输入下，`examImportance` **必须相同**（相对归一必然失败此测试）。

#### P0-3 examDate → decision layer 的唯一数据流 — **必须建立**

**现状（已核实）**：`User.examDate` 已写入（唯一写点 `score-anchor.service.ts:111-118`），但**没有任何 `daysToExam` resolver 读它**。实测 `daysToExam` 当前有 **五个平行来源**：

| # | 来源 | 位置 | 取证 |
|---|---|---|---|
| 1 | `User.remainingDays ?? 96` | `recommendation.service.ts:152`；`study.service.ts:4314,4380,4384` | 决策层主路径 |
| 2 | `DAYS_FALLBACK = 96` | `score-opportunity.service.ts:32,258`；`shadow-decision-chain.service.ts:33,288` | 影子层 |
| 3 | `DAYS_FALLBACK = 240` | `score-calibration.service.ts:47,376,444` | **与 #2 语义相反**（`timeFactor` 取到 1 而非 0） |
| 4 | `examYear → Date.UTC(examYear,11,20)`，否则 `remainingDays ?? 96` | `learning-loop-trigger.service.ts:115-120` | **硬编码 12 月 20 日** |
| 5 | **客户端伪造** `defaultTargetExamDate()` = `${year}-12-20` | `apps/web/src/features/today-score-center/TodaysScoreCenter.tsx:12-16,52` → `generateScoreCenterPlan({targetExamDate})` | **浏览器自己发明考试日** |

外加 Web 端 `remainingDays ?? 0`（`ReportSummaryPanel.tsx:71`；`StudentProgressOverview.tsx:67,76,118,191`）与阈值判定 `?? 0`（`study.service.ts:861`、`student-state-sprint-plan.adapter.ts:120`）—— 同一个概念在同一个系统里有 **96 / 240 / 0 / 90(仅 mock) / 12-20** 五种语义。

**裁定**：`User.examDate` **是** canonical exam timeline source。建立**唯一 resolver**：

```text
resolveDaysToExam(user, now) -> { days: number|null, basis: 'exam_date' | 'legacy_remaining_days' | 'none' }
  1. user.examDate 非空  → days = max(0, ceil((startOfDay(examDate) − now)/day))   basis='exam_date'      （FACT）
  2. 否则 remainingDays 为有限数 → days = max(0, remainingDays)                     basis='legacy_remaining_days'（LEGACY CACHE）
  3. 否则 → days = null，由调用方决定其自身语义（见下）
```

**关键设计点（这条使它可安全落在 P0）**：

- **唯一 fallback 常量**：`EXAM_TIMELINE_FALLBACK_DAYS`（建议 `96`，与今天决策层多数路径一致），并且**只在"调用方确实需要一个数"时**由调用方显式取用；resolver 自身返回 `null` 而**不替调用方兜底**。`null` 的语义 = "未知"，与 `0`（"考试就在今天"）严格区分。
- **消除 `240`**：校准侧不再有独立的 `DAYS_FALLBACK=240`；它要么拿到真实 `daysToExam`，要么显式声明该预测的 `inputsSnapshot.remainingDays = null` 并**按 `null` 语义**记录（预测行已支持 `inputsSnapshot`）。
- **消除客户端伪造**：`TodaysScoreCenter` 不再发送 `targetExamDate`；`generateScoreCenterPlan` 的 exam date 一律由**服务端**从 canonical resolver 取得。若为兼容必须保留该入参，则服务端**忽略**客户端值并记录一次 `client_exam_date_ignored` 计数（不得静默采用）。
- **消除 `?? 0`**：Web 侧一律显示 `--`/`未设置` 而非 0（已有前置事实：G1 的 `deriveExamDateState` 已提供"未设置"诚实文案，可复用）。
- **兼容层级必须命名**：`basis='legacy_remaining_days'` 的路径在 payload 中**显式标注为 legacy**，不得与 `basis='exam_date'` 同样被称为"当前考试日"。

**行为影响（这是它能进 P0 的理由）**：由于 `User.examDate` 的**唯一写点**同时写入派生 `remainingDays`（`score-anchor.service.ts:111-118`），而 onboarding/诊断路径只写 `remainingDays`、**不写 `examDate`**（子审计已穷举 `User.examDate` 写入点 = 1），因此：

```text
今天所有存量学生：
  examDate 已设置者  → resolver 走 (1)，派生值与已写入的 remainingDays 相同 ⇒ daysToExam 不变
  examDate 未设置者  → resolver 走 (2)，读 remainingDays ⇒ daysToExam 不变
⇒ P0-3 在今天的数据上是「排序不变」的 canonicalization
```

**必须用 parity 测试证明这一点**（§十 Required E2E / T-3）：对 `(examDate, remainingDays)` 全组合夹具，**旧式 `remainingDays ?? 96` 与新 resolver 的输出必须逐值相同**。任一不等即在评审前暴露。

#### P0-4 remainingDays 双写与 fallback 冲突 — **必须裁定 canonical source**

**现状（已核实）**：`remainingDays` 有三个写点 —— `score-anchor.service.ts:116`（由 `examDate` 派生）、`learning-profile.repository.ts:48`（onboarding/诊断/阶段变更，**自报**）、`practice-record.repository.ts:47,55`（demo/seed）。三个读语义：96 / 240 / 0。

**裁定**：

```text
canonical source = User.examDate（FACT）
remainingDays    = 派生缓存（DERIVED CACHE），降级为「legacy 兼容字段」
  • 保留写入（不改 schema、不停写），但写入内容必须由 examDate 派生
  • 自报来源（onboarding/诊断）的 remainingDays 视为 legacy：它表达"学生估计还剩多少天"，
    不是"考试日期"，因此当 examDate 为空时它仍可作为兜底，但必须带 basis='legacy_remaining_days'
  • 冲突规则：examDate 优先；若 remainingDays 与 examDate 派生值不一致 → 以 examDate 为准，
    并递增 drift 计数器（可观测），禁止静默取平均或取"较大者"
```

**必须新增的测试**：`examDate` 与 `remainingDays` 冲突夹具 → resolver 返回 examDate 派生值；drift 计数 +1；且 `basis='exam_date'`。

**明确禁止（写成源码级断言）**：不得存在第二个 `DAYS_FALLBACK` 语义常量；不得存在 `remainingDays ?? <数字>` 形式的直接读取（除 canonical resolver 内部）；不得有客户端提供的 exam date 被采用。

#### P0-5 expectedBenefit 的语义 — **必须降级标注，禁止称 score gain**

**现状（已核实）**：`score-opportunity.ts:318-325` `expectedBenefit` = `weakness × importance × 6 ~ 14` → 直接产出"**估算提分 X–Y 分**"。其自述为 "A band, deliberately wide: this is an estimate, not a measurement"；**从未被任何真实分数校准**。

**裁定**：字段保留（它是内部决策变量的一部分），但语义被**结构性降级**：

| 项 | 要求 |
|---|---|
| `kind` | 必须标 `PROXY`（**不是** `DERIVED`：DERIVED 指由观测值确定性推导，而这里是"未标定的启发式区间"） |
| `calibrated` | 必须为 `false`，且字段名/负载中显式出现 |
| 措辞 | **禁止** `提分 / gain / 预计能提高` 等无修饰表述。允许的内部标签：`未标定的估算区间（内部决策变量，非分数增益）` |
| 可见性 | **保持 teacher/admin only**（现状即如此）；**不得**进入任何学生可见叙事 |
| 排序 | 不得进入生产排序（现状即如此：`authoritative:false`，零排序消费） |
| North Star | 明确排除（§九 INV-13） |

**新增测试**：负载断言 —— `expectedBenefit` 存在时其包裹对象必须含 `kind:'PROXY'` 与 `calibrated:false`；源码断言 —— 该字段不得出现在任何 `apps/web` 学生面组件中。

#### P0-6 priority ↔ opportunity double counting — **必须做语义分区**

**现状（已核实）**：opportunity 六因子中 `weakness`(.28) 与 `examImportance`(.22) 是对 priority 输入的**完全重复**，`urgency`(.12) 与 `trainingCost`(.18) 为**部分重复**，合计约 **0.80 权重**在同一批底层事实上二次计权（审计 §7.4）。

**裁定**：采用**正交化 + 唯一语义分区**（审计 DC-2 的 (b) 方案，并加一条跨模型规则）：

```text
跨模型硬规则（DC-1）：
  opportunity 的分数【不得】作为新增加项进入 priority 公式。
  只允许两种关系之一：
    (R) 替换：opportunity 取代 priority 中它已分区的分量（examValue/weakness/forgetting）
    (A) 备选：opportunity 作为与 priority 并列的另一种排序货币（用于影子/对照），二者不叠加
```

新因子目录见 §六；**每个底层事实只能进入一个因子**（§六的分区矩阵是验收对象）。

### 2.2 P1（Score Loss Evidence）

见 §三。**设计完成；实现需要 schema 增量（SC-1/SC-2/SC-3）+ 内容侧逐题分值标注**。P1 不阻断 P0，P0 也不依赖 P1。

### 2.3 DEFER

| # | 项 | 为什么 DEFER |
|---|---|---|
| D-1 | `targetExam` 实体 | 消费者 = 0；`examDate + targetScore` 已覆盖"目标 vs 测量"所需语义（§八） |
| D-2 | `subjectScores` | 当前无消费者需要分科**分值**（分科**正确率**已有，`getExamReport`）；等 L1/L2 落地后按需求再做（保留 §三 的设计位） |
| D-3 | 逐任务用时遥测（TrainingCost 实测化） | 属 S3 前置；S1 不引入遥测面积 |
| D-4 | `Verified Score Gain` 投影 | 数据条件不满足（§九）；本阶段只锁定义 |
| D-5 | 修正链的枚举/格式校验强化 | 属 G12（审计登记的独立缺口），列 P1 边界外的独立小任务，不混入 S1 主线 |
| D-6 | `effectiveness` 的分数字段（恒 null） | 要么删除要么实现，属独立小任务；S1 不引用它 |

---

## 三、P1：Score Loss Evidence（形式化设计）

### 3.1 推导链

```text
ScoreAssessment / ScoreOutcome（某场考试）
   ↓ 逐题作答事实（PracticeRecord / 会话快照，已有）
Question
   ↓ maxScore（SC-3，逐题分值）
QuestionLoss = maxScore − earnedScore
   ↓ canonical node resolver（resolvePrimaryNodeByQuestion，唯一）
NodeAttributedLoss = Σ QuestionLoss over 该节点的「独占归属」题
```

### 3.2 十二个必答问题

| # | 问题 | 裁定 |
|---|---|---|
| 1 | 是否所有考试题都应支持 `maxScore`？ | **是，且可空**。408 三类题型（单选/综合/判断）都有分值语义；`maxScore` 作为**可空**列，缺失即 `null`。**不强制回填**（回填 = 伪造） |
| 2 | 分值来源是什么？ | 三级优先：①`Question.maxScore`（内容侧标注，**OBSERVED**）；②该场试卷的题型分值表（`ExamQuestion`/paper 结构，若可得）；③**未知 → `null`**。**禁止**用"平均分值""频次""难度"推一个分值来凑 |
| 3 | 如何保证分值守恒？ | INV-8：`Σ questionLoss ≤ totalAssessmentLoss` 且 `Σ nodeAttributedLoss ≤ Σ questionLoss`。**可不等**（允许未定价题、未归因题）；**永不可超**。超发即数据缺陷，写入 data-quality 计数 |
| 4 | 如何处理没有逐题分值的数据？ | 该题计入 `unpricedLostQuestions`，**贡献 0 分但被计数**；整场 `pricedCoverage = pricedLost / lostQuestions` 必须输出。**禁止**把未定价题按 0 分静默吞掉（那会伪装成"这场没丢分"） |
| 5 | 缺失应为 null 而非 0 | INV-10。`maxScore` / `lostScore` / 节点失分 / 覆盖率全部遵守 `null ≠ 0` |
| 6 | `lostQuestionIds` / `nodeLoss` 归因骨架如何正式接入？ | 复用 `exam-diagnosis.ts:100-200` 的骨架，但**把"题数"升级为"分值"**：现有 `nodeLoss` 保留为 `lostCount`（**PROXY，题数代理**），新增 `lostScore`（**OBSERVED，仅当题已定价**）。两者**分列**，禁止合并成单一"失分"数字 |
| 7 | 归因必须用 canonical resolver | INV：逐题归因**只允许**调用 `resolvePrimaryNodeByQuestion`（`apps/api/src/study/question-node-resolution.ts:42`，它走生产三层：直标 → 桥接 → legacy map）。**源码级断言**禁止在 loss 模块内直接查 `QuestionKnowledgeNodeTag`（V12.1 教训：直查 tag 表在生产 332 题上全盲） |
| 8 | 一题关联多节点时如何避免重复计总失分？ | **独占归属**：一道题的 `lostScore` **只计入一个节点** —— 其 PRIMARY 节点（`resolvePrimaryNodeByQuestion` 已按 PRIMARY 优先返回单一节点）。多节点成员关系保留为**标签**（供覆盖/搜索），**永不参与分值求和**。→ 这使 `Σ nodeAttributedLoss ≤ Σ questionLoss` **结构性成立** |
| 9 | 如何避免 `nodeLoss` 总和超过 assessment loss？ | 结构性保证 + 运行时断言：①独占归属（#8）；②每题 `lostScore = min(maxScore, max(0, maxScore − earnedScore))`（单题不可能超发）；③聚合后断言 INV-8，违反则**拒绝出该聚合值**并记 data-quality（不裁剪、不四舍五入掩盖） |
| 10 | 如何处理主观题自评？ | 分两种，**必须可区分**：<br>• `gradingMethod='rubric'` 且有 rubric 评分 → **OBSERVED**<br>• `gradingMethod='self_report'`（现状：`selfScore`，≥0.6 记"对"）→ 该题的 `lostScore` 标 **PROXY**，且该场的 `lossKind` 降级为 `mixed`；**聚合时必须分别给 `observedLoss` 与 `proxyLoss`，禁止合并** |
| 11 | 哪些 loss 可以标 OBSERVED？ | 客观题（`SINGLE_CHOICE`/`JUDGEMENT`）且 `maxScore` 已知且为精确匹配判分 → **OBSERVED**；主观题有 rubric 评分且 `maxScore` 已知 → **OBSERVED** |
| 12 | 哪些只能标 PROXY？ | 主观题走 `selfScore` 的部分（**PROXY**）；未定价题的"应该有失分"推断（**UNAVAILABLE，不出数**）；`lostCount × examFrequency` 式的节点排序（**PROXY，题数代理**） |

### 3.3 形式化 invariant（P1）

```text
IL-1  Σ over lost questions of lostScore  ≤  totalAssessmentLoss
      （totalAssessmentLoss = rawTotalScale − rawScore，来自 ledger 行，OBSERVED）
IL-2  Σ over nodes of nodeAttributedLoss  ≤  Σ over questions of lostScore
IL-3  每题归属节点数（用于求和的）恒为 1（独占 PRIMARY）；多节点仅作标签
IL-4  0 ≤ lostScore ≤ maxScore，且 lostScore ≠ 0 时 maxScore 必须已知
IL-5  未定价题不计分，但必须出现在 unpricedLostQuestions；pricedCoverage 必须输出
IL-6  observedLoss 与 proxyLoss 分列，禁止合并为一个数字
IL-7  所有 loss 输出携带 kind ∈ {OBSERVED, PROXY} + basis + 来源 id 链
IL-8  归因只经 canonical resolver（源码级断言）
IL-9  无 pricing 数据时返回 coverage=0 / loss=null，而不是 0 分
```

**"不得伪造完整覆盖"的落点**：若 `pricedCoverage < 1`，输出必须同时包含 `coverageGap`（未定价题数与它们所属节点），而不是把已定价部分按比例放大到全场。**禁止**任何形式的 proportional allocation（那是伪造）。

---

## 四、Score Ledger 语义（确认 + 新增禁令）

**确认现状正确**（审计已逐条核实，无需改动）：

| 概念 | 表 | 语义 | 写路径 |
|---|---|---|---|
| ScoreAssessment | `ScoreAssessment` | 一次被测量的表现（mock / 外部导入 / 教师录入） | 独立 `@Post`（controller `:46`），来源随角色强制 |
| ScorePrediction | `ScorePrediction` | 系统预测值（模型输出） | 独立 `@Post`（`:33`） |
| ScoreOutcome | `ScoreOutcome` | 真实考试/最终成绩（单向 verified） | 独立 `@Post`（`:61`）+ `:74` 验证 |

**新增禁令（写成源码级断言）**：

```text
L-1  禁止 prediction → outcome 自动写入。
     任何创建 ScoreOutcome 的代码路径都不得读取 ScorePrediction
     （今天事实：无此路径；断言把它钉死）
L-2  禁止 mastery → actual score 反向污染。
     任何写 ScoreAssessment/ScoreOutcome 的路径都不得读 UserKnowledgeMastery
     （今天事实：score-anchor 模块 grep 'mastery' = 0 hits；断言保持）
L-3  禁止 ScoreOutcome 由任何 score-like proxy 派生
     （opportunity / expectedBenefit / estimatePredictedScore / score150Estimate 均不得作为 outcome 的来源）
L-4  append-only 的精确范围固定为：唯一例外是 outcome 的三个验证列
     （verificationStatus/verifiedBy/verifiedAt）；四表均无 updatedAt 可被误改
```

**术语澄清（写入设计以便后续不再混淆）**：`Verified Score Gain` 里的 "Verified" 指**测量来源已核验**（PRIMARY 层 provenance），**不是**指"系统已验证它提分了"。

---

## 五、examDate：canonical exam timeline（正式决定）

```text
决定：User.examDate 是 canonical exam timeline source。        （YES）
```

### 5.1 唯一数据流

```text
User.examDate (FACT, 唯一写点 score-anchor.service.ts:111-118)
      ↓  resolveDaysToExam()  ← 唯一 resolver
      ↓  { days, basis: 'exam_date' | 'legacy_remaining_days' }
      ├─→ priority.phaseMultipliers(daysToExam)        （既有消费方，输入改源不改式）
      ├─→ opportunity.urgency                          （仅 days 一项，见 §六）
      ├─→ recommendation 的 daysToExam
      ├─→ calibration 的预测 inputsSnapshot.remainingDays
      └─→ UI「距离考试 X 天」                            （G1 的 deriveExamDateState 已是此形态）
```

### 5.2 必查清单（迁移时逐项处理，本阶段只列）

| 项 | 位置 | 处理 |
|---|---|---|
| `remainingDays ?? 96` | `recommendation.service.ts:152`；`study.service.ts:4314,4380,4384` | 改走 resolver |
| `DAYS_FALLBACK = 96` | `score-opportunity.service.ts:32,258`；`shadow-decision-chain.service.ts:33,288` | 删局部常量，改走 resolver |
| `DAYS_FALLBACK = 240` | `score-calibration.service.ts:47,376,444` | **删除**；改为 `null` 语义 + `inputsSnapshot` 记录 |
| `examYear → 12-20` 硬编码 | `learning-loop-trigger.service.ts:115-120` | 改走 resolver |
| 客户端伪造 exam date | `TodaysScoreCenter.tsx:12-16,52` | 停止发送；服务端忽略并计数 |
| `remainingDays ?? 0` | `ReportSummaryPanel.tsx:71`；`StudentProgressOverview.tsx:67,76,118,191` | 显示 `--`/未设置 |
| 阈值 `?? 0` | `study.service.ts:861`；`student-state-sprint-plan.adapter.ts:120` | 改走 resolver 的 `null` 语义（未知 ≠ 0 天） |
| `?? 90`（仅 mock） | `api/mocks/dashboard.ts:42` | 静态演示模式内保留，标注为 mock |

### 5.3 legacy vs canonical 的命名纪律

```text
canonical  : basis='exam_date'            → 可称「考试日期」，可作决策输入
legacy     : basis='legacy_remaining_days' → 必须标 legacy，不得称为「当前考试日」
unknown    : days === null                → 必须显式为「未知」；调用方各自决定是否兜底，
                                            但兜底值必须由调用方命名并计入可观测计数
```

**不得两个都被称为"当前事实"。**

---

## 六、Opportunity 语义：新因子目录（消除 double counting）

### 6.1 新目录（每个因子只承担一种语义）

| 因子 | 唯一语义 | 数据来源 | 归一 | 置信上限 | 与 priority 的关系 |
|---|---|---|---|---|---|
| `scoreAtStake` | **这个考点值多少分 × 出现得多频繁**（"分值风险"） | `primaryScore5y` + `recent3Frequency`/`recent5Frequency` | `clamp01(primaryScore5y/45) × clamp01(recent3Frequency/5)` — **绝对归一** | high | **与被替换的 `priority.examValue` 分区相同**：二者**只能取其一**（见 6.3 R-rule） |
| `learnerWeakness` | **离掌握有多远** | `UserKnowledgeMastery.mastery` | `1 − mastery` | medium（mastery 自身有效度威胁） | 与 `priority.weakness` 分区相同；**只能取其一** |
| `urgency` | **时间压力**（只此一项） | `resolveDaysToExam()` 的 `days` | `1/(1 + days/60)`（或等价单调递减） | high（但当 `basis≠'exam_date'` 时降为 medium） | priority 以 `phaseMultipliers(daysToExam)` 表达同一事实；**同一策略只能有一处使用** |
| `trainingCost` | **把该节点修到目标要多久** | `estimateMinutes(action, difficulty)`（估算） | 分钟数（作分母/取负向） | medium（非实测） | **INDEPENDENT**（priority 只用它做预算装填，不进 score） |
| `recoverability` | **修得好的概率** | 代理：`correctCount > 0` + 前置就绪（保留现值 `everSucceeded→0.7/0.3`、无成功过封顶 0.45） | `[0,1]` | low | **INDEPENDENT** |
| `evidenceConfidence` | — | `KnowledgeFrequencySnapshot.evidenceConfidence` | — | — | **改为 gate/乘子，不再是加权因子** |

**两处结构性修正**：

1. **`evidenceConfidence` 从加权因子降为 confidence gate**：它描述"我们对数据的信心"，不是一个"价值"。把它当 0.08 权重会把置信度与价值混算。新形态：不满足最低置信 → 降级或拒绝出分（沿用现有"必需因子缺失即拒绝"的纪律）。
2. **`importance` 从 opportunity 中移除**：它与频次高度共线，且已进 `priority.examValue`；留三个共线输入只会放大同一事实。

### 6.2 底层事实分区矩阵（验收对象）

| 底层事实 | 进入 `priority` 的因子 | 进入 `opportunity` 的因子 | 是否重复 |
|---|---|---|---|
| `recent3Frequency` / `recent5Frequency` / `allTimeEvidence` | `examValue` | `scoreAtStake` | ⚠️ **分区相同 → 取其一** |
| `primaryScore5y`（真题分值） | `examValue`（权重 0.06） | `scoreAtStake` | ⚠️ **分区相同 → 取其一** |
| `importance` | `examValue` | **不进入**（本次移除） | ✅ 消除 |
| `mastery` | `weakness`（主项 0.52） | `learnerWeakness` | ⚠️ **分区相同 → 取其一** |
| `recentAccuracy` / `wrongCount` | `weakness` | **不进入**（合并进 `learnerWeakness` 或整体留给 priority） | ⚠️ 需在实现时二选一，不得两边都算 |
| `retention` / `stabilityDays` | `forgetting` | **不进入**（原本在 `urgency` 里，本次移除） | ✅ 消除 |
| `daysToExam` | `phaseMultipliers`（乘子） | `urgency` | ⚠️ **同一策略只允许一处**（实现时二选一） |
| `difficulty` | `difficulty`（0.07） + `estimateMinutes` | `trainingCost` | ✅ 角色不同（priority 进 score，opportunity 只作分母） |
| `evidenceConfidence` | 仅 `LOW_EVIDENCE` 理由码 | confidence **gate** | ✅ 无加权重复 |
| `correctCount>0` / 前置就绪 | **不进入** | `recoverability` | ✅ INDEPENDENT |

### 6.3 跨模型规则（写进契约）

```text
R-rule（替换） 若 opportunity 与 priority 同时存在，则对每一个「分区相同」的事实，
              必须由 opportunity 版本【替换】priority 版本的对应分量，而不是叠加。
A-rule（备选）或把 opportunity 作为与 priority 并列的另一种排序货币（影子/对照用），
              两者永不叠加成同一个 score。
禁止          任何形式的 priority_score + w × opportunity_score（这会把 0.80 权重翻倍计权）。
```

### 6.4 当前状态声明（不得升级措辞）

```text
Score Opportunity = DERIVED / SHADOW / MODEL OUTPUT
  • authoritative: false
  • 不参与生产排序
  • 不得写成 OBSERVED SCORE GAIN
  • expectedBenefit = PROXY, calibrated:false（§P0-5）
```

---

## 七、Calibration：严格 compatibility（正式定义）

### 7.1 严格 invariant

见 §十 **INV-1 / INV-2**。核心变更：`isCalibrationCompatible` 不再接受"调用方没给量纲所以跳过检查"，而是要求**量纲可被证明**；`error` 只在证明成立时产生。

### 7.2 必测负例（本设计指定）

```text
输入：{ prediction: { predictedScore: 26, semantic: 'exam_total' },
        evidence:   { normalizedScore: 96, normalizedTotalScale: ??? , semantic: ???,
                      source: 'MOCK', occurredAt: <past> } }
情形 A（任务书指定）：actualScore=96, totalScore=null, predictedBest=26
  → 必须 ok=false，error === null，reason 含「量纲未证明」类码
  → 必须进入 exclusions（带原因），不得被平均、不得静默丢弃

情形 B（历史 150/100 错配）：totalScore=100
  → 必须 ok=false（scale_mismatch），error === null

情形 C（合法）：totalScore=150, semantic='exam_total', source='TEACHER_GRADED'
  → ok=true，error = 96 − 26 = 70（此时 70 是**合法**数字，因为两侧都是 150 制）
```

**关键区分**：情形 A/B 是"不可表达的配对"，情形 C 是"可表达但误差很大"。**只有 A/B 必须被拒。**

### 7.3 同源修复

`score-anchor.service.ts:612` 的硬编码 `normalizedTotalScale` 改为读行值（INV-2），否则该路径上的 scale 检查是同义反复（审计已核实）。

### 7.4 150 vs 100 复检结论

主路径（ledger 直连 + API 预排除）已堵死；**legacy 纯函数路径经 P0-1 后也堵死**。修复后：**任何 150 制预测都不可能与非 150 制证据配对**——这是本次 P0 的验收句。

---

## 八、Target Exam：**DEFER**

**裁定：现在不需要 `targetExam` 实体，DEFER。**

| 判据 | 结果 |
|---|---|
| 消费者数量 | **0**（`grep 'targetExam'` 在 `prisma/`、`packages/shared/src`、`apps/api/src` 零命中；只有 `User.targetScore` 自报目标分） |
| 现有表达力是否足够 | **够**：`User.examDate`（考试日事实）+ `User.targetScore`（目标分）+ `ScoreOutcome`（实际结果）已能表达"目标 vs 实测"，且 `Score-calibration` 的 gap 分解已在使用 |
| 提前加字段的代价 | 无消费者的 schema 面积 + 迁移面 + 需要定义"多次目标考试"的语义（现在没有这个需求） |
| 触发条件（何时再评估） | 出现以下任一：①需要区分"目标这次考试 vs 下次考试"；②需要多场目标考试并存；③教研要求按考试场次管理目标 |

**明确不做**：为了 schema 完整性提前添加 `targetExam`。若未来需要，设计位保留在本文档，属独立批准门。

---

## 九、North Star

### 9.1 锁定

```text
North Star = Verified Score Gain / 30d        （正式锁定，不可替换）
Expected Recoverable Score = 内部决策变量       （不得成为 North Star）
```

### 9.2 本阶段禁止实现伪 Verified Score Gain

**禁止**：用 `mastery gain` / `accuracy gain` / `opportunity` / `expectedBenefit` / `predicted score` 的任何组合去近似 Verified Score Gain。**当前 PRIMARY 层校准样本 = 0**，任何"gain"数字都是伪的。

### 9.3 未来形成 Verified Score Gain 所需**真实数据**（本设计明确列出）

| # | 数据 | 现状 | 要求 |
|---|---|---|---|
| V-1 | **baseline score**（干预前的一个 150 制认知锚） | `ScoreAssessment`/`ScoreOutcome` 可存，但**生产样本 0**；`User.currentScore` 是**自报**，不可作锚 | 一次教师判分或采分点评分的整卷（`source ∈ PRIMARY`），带 `examDate` |
| V-2 | **intervention**（被评估的干预） | `RecommendationAction` / `StudyTask` 已有，且与证据链已有连接 | 干预必须有可识别的起止（`actionId` + `completedAt`），且**至少一条强证据**（判分作答） |
| V-3 | **post-intervention score**（干预后的第二个 150 制锚） | 同 V-1 | 与 V-1 **同量纲、同语义**（`semantic='exam_total'`、`normalizedTotalScale=150`） |
| V-4 | **time window**（30d） | 无 | 明确的窗口定义：`windowStart = baseline.examDate`，`windowEnd = post.examDate`，且 `windowEnd − windowStart ∈ [1,30]` 天；窗口外配对**不算** |
| V-5 | **assessment provenance**（两侧都必须可归层） | 已有 `source` + `calibrationLayerOf` | **两侧都必须在 PRIMARY 层**（TEACHER_GRADED / RUBRIC_GRADED / REAL_EXAM）；`MOCK`/`IMPORTED`/`UNKNOWN` **不得**参与 Verified Score Gain |
| V-6 | 归因边界 | 无 | `post − baseline` 是**观测到的差值**，不是"归因给系统"。**系统归因**（Attribution）在此之上仍是独立问题（审计 §Attribution = MISSING） |

**由此得出 North Star 的最小可信定义（仅供未来实现，本阶段不实现）**：

```text
VerifiedScoreGain(student, window) =
    normalizedScore(post)  −  normalizedScore(baseline)
  其中 baseline 与 post 均为 PRIMARY 层、semantic='exam_total'、归一 150、
  且 windowEnd − windowStart ≤ 30 天
  样本不足（任一侧缺失或非 PRIMARY）→ 返回 null + reason，绝不出数
```

---

## 十、最终输出

### 10.1 S1 DESIGN STATUS

```text
S1 DESIGN STATUS = READY FOR IMPLEMENTATION
```

**理由**：P0 的六项全部是**代码层/纯函数层**变更，**零 schema、零迁移**；其中三项（P0-1/P0-2/P0-3）是**收窄或等价改写**（P0-3 已证明在当前数据上排序不变），另三项（P0-4/P0-5/P0-6）是语义标注与分区裁定。设计不依赖任何未知数据。

**P1（Score Loss Evidence）** 需要 schema 增量与内容侧逐题分值，但**其设计已完成且不被数据阻断**：缺少 pricing 数据时系统输出 `coverage=0 / loss=null`（诚实缺席），而不是无法实现。**P1 的实现门是 schema 批准，不是数据**。

**非 BLOCKED BY SEMANTICS**：全部语义分歧已在本文档内裁定（六项 P0 + 分区矩阵 + 严格 compatibility + North Star 边界）。

### 10.2 P0 implementation scope

| # | 交付 | 变更面 | 行为影响 |
|---|---|---|---|
| P0-1 | `isCalibrationCompatible` 严格化 + `buildScoreCalibration` legacy 守卫收紧 + `evidenceRef` 读行值 | `packages/shared/src/score-anchor/score-anchor.ts`、`score-center/score-calibration.ts`、`apps/api/src/study/score-calibration.service.ts`、`apps/api/src/score-anchor/score-anchor.service.ts` | **收窄**：不可证明量纲的配对从"算出无意义 error"变为"rejected + exclusion"。可能使既有校准样本数下降（正确结果） |
| P0-2 | 统一 `primaryScore5y` 归一为 `clamp01(/45)` | `apps/api/src/study/score-opportunity.service.ts` | 影子分变化（**非生产排序**）；两入口变得可比 |
| P0-3 | 唯一 `resolveDaysToExam()`；删 5 处平行来源；客户端停止伪造 exam date | 新增 shared 纯函数 + 6 个调用点 + 1 个前端组件 | **在当前数据上排序不变**（parity 测试证明） |
| P0-4 | `remainingDays` 降级为派生缓存 + 冲突规则 + drift 计数 | 同 P0-3 | 同上 |
| P0-5 | `expectedBenefit` 降级为 `PROXY / calibrated:false` + 措辞与可见性约束 | `score-opportunity.ts`、`score-opportunity.service.ts` | 字段语义更诚实；**数值不变** |
| P0-6 | 新因子目录 + 分区矩阵 + `evidenceConfidence` 改 gate + 移除 `importance`/`retention` | `score-opportunity.ts` | 影子分变化；**消除约 0.80 双重计数** |

**P0 明确不做**：不改 `priority` 公式结构（只可能改其 `daysToExam` 的**来源**，且等价）；不接 opportunity 进排序；不改 mastery。

### 10.3 P1 implementation scope

| # | 交付 | 依赖 |
|---|---|---|
| P1-1 | SC-1 `ScoreLossItem` + 派生逻辑（从 session 提交时自动派生） | schema 批准 |
| P1-2 | SC-3 `Question.maxScore`（可空）+ 内容侧标注流程（**独立内容任务**） | schema 批准 + 内容 |
| P1-3 | 逐题 × 节点**独占归因**（复用 canonical resolver）+ IL-1..IL-9 全部断言 | P1-1 |
| P1-4 | 只读投影 `observedLoss / proxyLoss / nodeAttributedLoss / pricedCoverage / coverageGap` | P1-1 |
| P1-5 | `subjectScores`（**DEFER**，位保留） | 需求出现时 |

**P1 明确不做**：不做 proportional allocation；不把未定价题按 0 计；不把 `selfScore` 的 loss 标 OBSERVED；不引入第二套节点解析。

### 10.4 DEFERRED scope

`targetExam`（§八）· `subjectScores` · 用时遥测 · Verified Score Gain 投影 · 修正链枚举校验强化（独立小任务）· `effectiveness` 分数字段（删除或实现，独立）

### 10.5 Schema changes

| # | 变更 | 类型 | 阶段 | 回滚 |
|---|---|---|---|---|
| SC-1 | 新表 `ScoreLossItem(scoreEntryKind, scoreEntryId, questionId, nodeId, maxScore, earnedScore, lostScore, lossKind('OBSERVED'\|'PROXY'), gradingMethod, recordedAt)` + `@@unique([scoreEntryKind, scoreEntryId, questionId])` + `@@index([nodeId])` | additive 新表 | P1 | `DROP TABLE` |
| SC-3 | `Question.maxScore Float?` | additive 可空列 | P1 | `DROP COLUMN` |
| SC-2 | `ScoreAssessment.subjectScores Json?` / `ScoreOutcome.subjectScores Json?` | **DEFER** | D-2 | — |

**P0 的 schema 变更 = 0。** 本设计**不修改** `prisma/schema.prisma`。

### 10.6 API changes

| # | 变更 | 性质 | 阶段 | 纪律 |
|---|---|---|---|---|
| API-1 | `GET /coach/score-loss`（只读；self；teacher 需授权） | 新增只读投影 | P1 | `@Roles` + `resolveUserId`；每项带 `kind` + `basis` + 来源 id 链 |
| API-2 | `GET /coach/score-anchor-summary`（只读；self） | 新增只读投影 | P1 | 同上 |
| API-3 | `GET /coach/exam-timeline`（只读；self）→ `{ examDate, days, basis }` | **P0 可选**（若前端需要单一来源） | P0 | 同上 |
| API-4 | `POST /coach/score-loss/items` | **不做**（逐题失分必须系统自动派生） | — | 设计约束 |
| API-5 | `generateScoreCenterPlan` 的 `targetExamDate` 入参 | **服务端忽略客户端值**并计数 | P0 | 兼容保留字段，语义改为"被忽略" |

**不新增任何成绩写入口**；不修改既有写入端点语义。

### 10.7 Invariant list（完整，全部为可测断言）

```text
INV-1  error 只在量纲等价被证明时产生（E1–E5 全满足）；否则 ok=false + reason + exclusion
INV-2  任何参与比较的 normalized 值必须读「行」，不得硬编码常量
INV-3  daysToExam 只有唯一 resolver；只有唯一 fallback 常量；无客户端伪造考试日
INV-4  examDate 优先于 remainingDays；冲突时以 examDate 为准并计 drift，禁止静默折中
INV-5  exam-point 量纲的归一唯一：clamp01(primaryScore5y / 45)（绝对，与数据集无关）
INV-6  每个底层事实只进入一个因子；分区矩阵是验收对象；跨模型只允许替换或备选，禁止叠加
INV-7  每个 score-like 输出携带 kind ∈ {OBSERVED, DERIVED, PROXY} + calibrated:boolean + basis
INV-8  Σ questionLoss ≤ totalAssessmentLoss；Σ nodeAttributedLoss ≤ Σ questionLoss
INV-9  失分题的求点归属恒为单一节点（独占 PRIMARY）；多节点仅作标签
INV-10 缺失一律 null（+ 计入 unpriced/unknown 桶），永不渲染为 0
INV-11 无任何 score/loss 路径写 mastery（源码级断言）
INV-12 无任何路径由 prediction 自动生成 outcome
INV-13 Verified Score Gain 只允许由 PRIMARY 层、同 semantic、30 天窗内的配对计算
INV-14 opportunity 保持 DERIVED/SHADOW/authoritative:false；不得称 OBSERVED SCORE GAIN
INV-15 expectedBenefit = PROXY / calibrated:false；不得进入学生可见面；不得进排序
INV-16 逐题归因只经 canonical resolver（禁止直查 QuestionKnowledgeNodeTag）
INV-17 append-only 的唯一例外是 outcome 的三个验证列
```

### 10.8 Required E2E tests

| # | 测试 | 阶段 | 断言要点 |
|---|---|---|---|
| T-1 | **校准负例**（真实 HTTP + PG） | P0 | `{actualScore:96, totalScore:null, predictedBest:26}` → `ok=false`、`error=null`、进 `exclusions`；`totalScore=100` 同样被拒；`totalScore=150 + TEACHER_GRADED` → error=70 **合法** |
| T-2 | **归一一致性** | P0 | 同一节点在"独处"与"与 30 个高分节点同池"两种输入下 `examImportance` 相同 |
| T-3 | **考试时间线 parity** | P0 | `(examDate, remainingDays)` 全组合矩阵下，新 `resolveDaysToExam` 与旧 `remainingDays ?? 96` 逐值相同（证明排序不变）；`examDate` 与 `remainingDays` 冲突时取 `examDate` 且 drift+1 |
| T-4 | **无平行来源**（源码级） | P0 | 全仓断言：不存在第二个 `DAYS_FALLBACK` 语义常量；除 resolver 外无 `remainingDays ?? <数字>`；`apps/web` 无 exam date 伪造函数 |
| T-5 | **expectedBenefit 标注** | P0 | 负载含 `kind:'PROXY'` + `calibrated:false`；`apps/web` 无该字段引用；无 `提分/gain` 无修饰措辞 |
| T-6 | **分区矩阵** | P0 | 对矩阵每一行，断言该底层事实只出现在一个因子里（纯函数输入审计） |
| T-7 | **禁止叠加** | P0 | 断言不存在 `priority + w*opportunity` 形式的组合（源码级） |
| T-8 | **mastery 零回流** | P0 | score/loss/calibration/opportunity 四个模块 grep `mastery` 写入 = 0（源码级） |
| T-9 | **prediction ≠ outcome** | P0 | 源码级：创建 `ScoreOutcome` 的路径不引用 `ScorePrediction` |
| T-10 | **P1 分值守恒** | P1 | `Σ questionLoss ≤ totalAssessmentLoss`；`Σ nodeAttributedLoss ≤ Σ questionLoss`；构造超发夹具必须**拒绝出数** |
| T-11 | **P1 覆盖诚实** | P1 | 无 `maxScore` 的题 → 计入 `unpriced`、贡献不计分、`pricedCoverage<1`、返回 `coverageGap`；**不得**按比例放大 |
| T-12 | **P1 归因独占** | P1 | 一题多节点 → 分值只计一次；`Σ nodes == Σ priced question loss` |
| T-13 | **P1 主观题分层** | P1 | `selfScore` 题的 loss 标 `PROXY`；`rubric` 题标 `OBSERVED`；两者**分列不合并** |
| T-14 | **P1 归因走 canonical resolver** | P1 | 源码级断言 + 集成（桥接题也能归因；直查 tag 表会漏） |
| T-15 | **North Star 边界** | 未来 | PRIMARY-only、同 semantic、≤30 天窗；**本阶段只写测试占位，不实现投影** |

### 10.9 Migration impact

```text
P0 : 零迁移。不新增/修改任何 Prisma schema 或 migration。
P1 : 一条 additive 迁移（SC-1 新表 + SC-3 可空列）。
     形式：CREATE TABLE + ADD COLUMN（nullable）+ 索引；零 DROP / 零 RENAME / 零回填
     （沿用 20260912120000 的纯增量先例）。
     影响：无需停服；历史行 maxScore/loss 为 NULL = 未知（诚实）。
DEFER : SC-2 无迁移。
```

### 10.10 Rollback impact

| 层 | 回滚方式 | 数据影响 |
|---|---|---|
| P0-1 | 恢复旧守卫（若有开关则 flag 回退；无开关则 revert commit） | 无（纯读路径；exclusions 是运行时计算，不落库） |
| P0-2/P0-6 | revert | 无（影子层零写入） |
| P0-3/P0-4 | revert（或 flag 回退到 `remainingDays` 直读） | 无（`examDate`/`remainingDays` 两列都保留，无数据改写） |
| P0-5 | revert | 无（字段与数值不变，只改包裹语义） |
| P1 | `DROP TABLE ScoreLossItem` + `DROP COLUMN Question.maxScore` | **派生数据可弃**（loss 是派生投影，不是历史事实源）；ledger 四表**不受影响**；`Question.maxScore` 若已由内容标注则丢失（回滚前需备份标注） |
| **历史事实保护** | 任何回滚都**不改写** `ScoreAssessment`/`ScorePrediction`/`ScoreOutcome`/`ScoreCorrection` 既有行 | 延续"历史事实不因回滚改写"的既有纪律 |

---

## DOC DRIFT TO UPDATE（只列出，不修改）

| # | 文档 | 现状 | 应改为 |
|---|---|---|---|
| DD-1 | `docs/score-ledger.md:41` | 「`rawScore=null` 合法（只有元数据的证据行）」 | 「`normalizedScore` 可空；`rawScore` 在表级 NOT NULL（`schema.prisma:1111,1138`）」 |
| DD-2 | `docs/score-improvement-gap-report.md:47` | 「`estimatePredictedScore` … 唯一消费方是 teacher/admin 影子校准端点」 | 列出 4 个消费点，其中 2 个学生可见（`ReportSummaryPanel.tsx:66`、`StudentProgressOverview.tsx:62,71`） |
| DD-3 | `docs/audit/sp-guidance-infra-audit.md:148,219,260` | 「`User.examDate` writer = NOT FOUND」 | 已由 `bde54521` 补齐：`score-anchor.service.ts:111-118` |
| DD-4 | `docs/score-anchor-design.md:41-43`（D6） | 「`remainingDays` 降级为遗留派生缓存」易被读成"已切换" | 加一句「**决策层仍读 remainingDays；切换见 S1 Formal Design §五**」 |
| DD-5 | `prisma/schema.prisma:1113`（`originType` 注释） | 列 4 值（含 `paper_session`/`diagnostic`） | 注释改为「当前产出值：`external_import`（学生）/ `teacher_entry`（教师）」；未产出值标 `NOT PRODUCED` |
| DD-6 | `prisma/schema.prisma:1170`（`targetKind` 注释） | 列 3 值（含 `prediction`） | 注释改为「当前可修正：`assessment` / `outcome`」（DTO `:152` 为准） |
| DD-7 | `docs/s1-score-anchor-audit.md` §2 Q20 / §10 | 「150 vs 100 已是不可表达的配对」——**主路径成立，legacy 纯函数路径仍有洞** | 补「legacy 路径在 `totalScore == null` 时洞仍存在，见 Formal Design §七 / INV-1」 |
| DD-8 | `docs/current-sprint.md` | 未记录 S1 已存在与本次 Design Gate | 追加 Design Gate 条目（由当值 Agent 在实现阶段更新） |

---

## 停止声明

```text
S1 DESIGN STATUS = READY FOR IMPLEMENTATION
```

本阶段按约定完成：**Audit findings → Scope decision（P0/P1/DEFER）→ Formal Design → Design Gate**。本文件是唯一产物。

**未做**：未修改生产代码、未修改 Prisma schema、未创建 migration、未修改 Mastery / Recommendation / Transfer Probe / ROI / Score Engine、未打开任何 production feature flag、未部署、未生成 probe questions、未进入 S3、未实现伪 Verified Score Gain、未开始任何实现。

**STOP。等待实施批准。**
