# Score Improvement Gap Report（提分有效性差距审计）

> 日期：2026-09-11 ｜ 性质：READ-ONLY 产品级审计（零代码改动、零数据库写入、零迁移）
> 分支：`feature/v3-product-refactor`（HEAD `a72f711`）｜ 审计基线：当前工作区实际代码
> 前序审计：`docs/v12-0-score-improvement-audit.md`（2026-09-10）。本报告独立重审，并覆盖 V12 上线后的新事实。

---

## 1. Executive Summary

**一句话回答：这个系统仍然不能令人信服地证明"它真的能帮 408 学生提高最终考试分数"，因为在整条提分因果链上，它把工程闭环做到了很高完成度（练习→掌握度→推荐→任务全部真实运转、2324 项测试全绿），但链路的两端——"为什么丢分"的起点和"分数真的变了吗"的终点——都还没有可度量的产品事实：起点上错误诊断是时间代理加自报兜底的粗分类且不驱动干预选择，终点上既没有考试日期与真实成绩的录入通道（全库不存在真实考研分字段），也没有任何"干预→复测→迁移→分数"的对照测量；中间的"预计可恢复分数"模型只以 teacher/admin 影子端点存在，从未进入生产排序。**

换言之：系统今天能证明"学生练了"（CONFIRMED）、部分证明"学生会了"（PARTIAL），完全不能证明"分数因此提高"（UNPROVABLE）。V12 把证据台账、复习→掌握度接线（生产已验证）、推荐曝光漏斗补上了，三个内部断环已闭合；但**"学习有效性"与"分数有效性"之间仍隔着一道未架桥的鸿沟：迁移不可观测（无新题/旧题区分）、主观 70 分靠自评、预计提分不参与排序、真实分数无处落库**。

用三句话说清"看起来有效、实际未必提分"的结构性风险：

1. **Activity ≠ Learning 已被系统自己承认**（完成任务的标记被宪法级测试钉死"永不构成证据"），但产品结算货币仍是任务完成率与掌握度数字——学生与运营看到的"进步"绝大部分是活动与代理指标。
2. **Mastery ≠ Exam Ability**：掌握度由"练习题二值正确率"驱动，其中主观综合题的"正确"由学生自评分 ≥0.6 推导（study.service.ts:3342-3344），约 70/150 的卷面主权建立在自评上；且 EMA 方向瞬态（低分区答错反升、高分区答对反降）经真实库证实仍在生产路径可观测。
3. **Score 无锚**：预测分（estimatePredictedScore）是目标插值启发式且从未与真实成绩对照（MAE 因样本不足拒绝给出——第一次真实对照的 error 是 70 分）；模考分是"客观题精确匹配×80 + 主观自评"，AssessmentHistoryItem 混装系统判分与自报导入且无来源字段。

---

## 2. 审计范围与方法

- 阅读：`packages/shared/src/score-center/` 全部引擎与影子模块、`apps/api/src/score-center/`、`apps/api/src/study/`（推荐/诊断/测评/证据/校准/数据质量）、`apps/api/src/agent|rag|effectiveness|ai-metrics`、`prisma/schema.prisma`、`docs/current-sprint.md`、`docs/v12-0-score-improvement-audit.md` 及相关里程碑报告。
- 验证执行（只读）：
  - `npm test` → **2324 tests / 2322 pass / 0 fail / 2 skipped，exit 0**（与账本基线一致——工程正确性成立）。
  - 离线计算（直接 require 编译产物 `packages/shared/dist`，未修改任何源码）：用生产同款 `calculatePriority`/`classifyAction`/`estimatePredictedScore` 复算四组对照案例（见 §8/§14），所有数字可复现。
- 生产侧事实引用自账本记录的生产部署验证与浏览器走查（本机无 SSH，未直接连生产库；均标注出处）。

---

## 3. L0：最终目标审计

### Q1 系统当前优化的最终目标是什么？

**生产目标函数是"学习行动优先级"，不是 Expected Exam Score Improvement。**

- 唯一生产排序函数 `calculatePriority`（`packages/shared/src/score-center/priority.ts:11-93`）：六个加性分量 `examValue 0.37 / weakness 0.32 / forgetting 0.16 / difficulty 0.07 / trend 0.05 / pinned 0.03`。它回答的是"现在先学哪个"，不是"做哪个能多考几分"。
- 任务书要求的乘性失分模型 `ExamImportance × OccurrenceProbability × ErrorProbability × ScoreWeight × Recoverability × EvidenceConfidence` 在生产**不存在**。最接近的是 V12-M4 影子模块 `score-opportunity.ts`（六因子加权、缺必需因子拒绝出分、`authoritative: false`），但它：(a) 只对 teacher/admin 开放（学生 403）；(b) 不参与生产排序（文件头自述 shadow，引擎零触碰）；(c) `expectedBenefit = weakness × examImportance × 6~14 分`（score-opportunity.ts:318-325）是未标定的凭空区间。
- roadmap §0 的"四问门禁"（学习效率/知识保持/大题得分/模考恢复效率）说明**意图**已是提分，但生产**实现**尚未把"分"作为排序货币。方向正确、货币未切换。

### Q2 能否计算 Current Expected Score / Expected Score Ceiling / Recoverable Score？

| 量 | 状态 | 依据 |
|---|---|---|
| Current Expected Score | **PARTIAL** | `estimatePredictedScore`（learning.ts:714-738）：`progress = 0.5×mastery + 0.3×accuracy + 0.2×(remainingDays/240)`，`best = current + (target−current)×progress×0.5`。目标插值启发式，未经任何真实分标定；唯一消费方是 teacher/admin 影子校准端点。另有单场模考的 `score150Estimate`（exam-diagnosis.ts:138-149，客观正确率×80+主观自评）。 |
| Expected Score Ceiling | **MISSING** | 无全谱系"节点→分值→状态"的合成模型，算不出满分可达上限。 |
| Recoverable Score | **MISSING（生产）/ PARTIAL（影子）** | 影子机会模型给出"估算提分区间"，但 teacher-only、非 150 制标定、不进排序。 |

### Q3 系统是否知道"学生现在丢多少分"？

**PARTIAL，且是"事后描述"而非"事前预计"。**
- 已考模考内：`nodeLoss` 把失分题归因到节点、按丢题数×考频排序（exam-diagnosis.ts + F2），生产已验证（jackchou 8/15 场：诚实 0 分、nodeLoss 命中 Cache基本原理/线性表定义）。
- 全谱系：没有一张"408 全卷 150 分 × 1296 节点 × 我的状态"的丢分地图。未模考过的新学生（初始掌握度=中性 0.5，无入学摸底测）在系统眼里"每个没练过的考点都是中等薄弱"，丢失分数量未知。
- `recoverable`（能捞回多少）：影子代理（曾做对过+前置就绪），系统自评最高置信 low（score-opportunity.ts:69-71）。

---

## 4. L1：Student Diagnosis Audit（错误分类学）

### 4.1 现有分类

自动推断 `classifyMistake`（learning.ts:122-143）+ 自报 8 类错因（`MISTAKE_REASONS`，learning.ts:22-31）：知识点没学过/概念混淆/公式记错/计算错误/审题错误/推理过程错误/时间不足/蒙题。

自动推断规则（对错题）：

| 观测 | 判定 | 可信度 |
|---|---|---|
| 未作答 | 时间不足 | 高（客观） |
| 答题时间 < 0.65×预期 | 审题错误 | 低（时间代理：快≠没审题，可能是会做） |
| 答题时间 > 1.45×预期 | 概念混淆 | 低（慢≠概念混淆，可能是计算慢/表达慢） |
| 自报信心"完全不会" | 知识点没学过 | 中（依赖学生自报） |
| 用过提示 | 推理过程错误 | 低（提示≠推理错） |
| 其余一切 | **概念混淆（兜底）** | 低（默认桶） |
| 答对但自报"完全不会" | 蒙题 | 高（真实信号） |

**对照任务书要求的 9 类**：

| 目标类别 | 现状 | 数据来源 | 可信度 | 影响 |
|---|---|---|---|---|
| concept gap | ≈"知识点没学过"（自报信心） | 自报 | 中 | 干预应为新学——当前不区分 |
| confusion | "概念混淆"（兜底桶） | 时间代理/默认 | 低 | 概念混淆被大量误报，统计失真 |
| method gap | ≈"推理过程错误"（usedHint 代理） | 是否用过提示 | 低 | 无解题步骤数据（大题无 rubric 内容） |
| calculation error | **仅自报**（自动不可判——客观题无过程可查） | 学生自填 | 低 | 408 客观题 80 分中计算失分不可见 |
| careless error | **无此类别**（最近似"审题错误"=答太快） | 时间代理 | 低 | "粗心"是最常见失分类别，系统系统性盲视 |
| boundary omission | **无** | — | — | 完全缺失 |
| expression problem | **无** | — | — | 大题采分点 rubric 已建表但生产 0 行内容（B-F4） |
| time pressure | "时间不足"（未作答） | 客观 | 高 | 唯一自动可信类 |
| transfer failure | **无**（无"首次见/重做"标记，无法定义迁移失败） | — | — | Case C 不可观测 |

### 4.2 关键结构性缺陷：错因不驱动干预

- 错因被采集、统计、展示（错题本错因统计、复习 attempt 的 `reportedReason/inferredReason`、Tutor 误区检测），**但 `classifyAction`（plan.ts:36-43）只消费 wrongCount/forgetting/mastery/recentAccuracy 四个数值——错误"类型"完全不参与行动选择**。"概念混淆"和"计算错误"的同一个节点会得到同一种任务（练习/错题重做）。`MISTAKE_SUGGESTIONS`（learning.ts:33-42）只在答题瞬间的前端提示出现（ExamSession.tsx），不进入推荐与计划。
- 结论：诊断层"知道一点为什么错"，但**"为什么错"到"怎么办"的映射在推荐层断开**。这是 L1 最贵的一处断链。

---

## 5. L2：Score Loss Model Audit

**判定：P0 产品缺口——生产不存在 Expected Score Loss 模型。**

- 现状盘点：①描述性失分（nodeLoss，事后）；②加性优先级（priority，事前但非分值）；③影子机会分（score-opportunity，事前、分值近似、teacher-only、未接线）；④估算提分区间（weakness×importance×6~14，未标定）。
- 乘性六因子逐项核对：

| 因子 | 数据是否存在 | 生产是否消费 | 置信 |
|---|---|---|---|
| ExamImportance | ✅ KnowledgeFrequencySnapshot（1149 条，recent3/5 频次+primaryScore5y） | ✅ examValue 分量（0.37 权重内） | high |
| OccurrenceProbability | ⚠️ 频次÷5 是粗代理（节点粒度非考点粒度） | 隐含在 examValue | medium |
| ErrorProbability | ⚠️ 1−mastery（EMA，含自评污染与方向瞬态） | ✅ weakness 分量 | low-medium |
| ScoreWeight | ✅ primaryScore5y（真题分值） | 仅 0.06 次权重（priority.ts:49） | high |
| Recoverability | ❌ 无直接测量（代理：曾做对+前置就绪，最高置信 low） | ❌ 生产不消费 | low |
| EvidenceConfidence | ✅ 快照字段 | 仅 reason code（LOW_EVIDENCE），不进公式 | high |

- **当前 Recommendation 是否按"预计可恢复分数"排序？否。** 加性与乘性的差别不是修辞：
  - 离线复算（生产同款代码）：低频但极薄弱节点（examValue 18.6 / weakness 98.3）priority=56，会挤占预算位排到许多"中频中弱"节点（examValue≈59/weakness≈75，priority=58）附近——两者的真实期望提分可以差 3-5 倍（occurrence×scoreWeight 量级差异），priority 却只差 2 分。**priority 分数簇拥在 45-70 区间，而真实 ROI 跨越一个数量级——排序压缩导致预算错配。**
  - 另一端：高频已掌握节点（examValue 100/weakness 11.4）priority=47，仍高于大量中低频未知节点——"名师考点打磨"效应存在但被 weakness 分量部分抑制（此次复算未构成实际倒挂；倒挂风险集中在 forgetting+trend+pinned 叠加时）。
- 30 分钟问题（§7 Q3）：引擎会把任务按 priority 填进 30 分钟预算（composeDailyPlan 贪心装填），**但"哪件事单位时间期望提分最大"无模型可答**——estimateMinutes 是静态动作表（15/20/30/35 分钟，plan.ts:45-51），与缺口大小无关：把 0.05 掌握度的 5 分考频节点学到能对，和把 0.7 掌握度的 40 分考频节点错题重做一遍，都是 35/20 分钟。

---

## 6. L3：Mastery Validity Audit（掌握度究竟预测什么）

### 6.1 掌握度是什么

- 唯一写方 `ScoreCenterService`（score-center/service.ts:134-170，OCC 乐观锁）：对题目解析到的每个节点做 EMA——答对向 `0.72+0.055×难度` 靠（α=0.18 PRIMARY / 0.07 SECONDARY），答错向 `0.38−0.045×(难度−1)` 靠（mastery.ts:19-22）。每日快照落 `UserMasterySnapshot`。
- **它预测的是"这类练习题的二值正确率"，不是考试表现。** 效度威胁逐项：

| 威胁 | 实证 |
|---|---|
| false mastery | ①主观综合题 `correct = selfScore/maxScore ≥ 0.6`（study.service.ts:3342-3344）——自评 60 分就算"会"，直接喂进掌握度，覆盖约 70/150 卷面；②`confidence` 字段是纯样本量函数 `1−exp(−(attempts+1)/12)`（mastery.ts:44），attempts≈8 就到 0.5+，与"预测可靠度"无关，UI/读者易误读为校准置信；③neutral 先验 0.5：从未练过的节点 weakness=0.43，与"练过且 55 分"几乎同档——未知与半会不会被混淆。 |
| unstable mastery | EMA 方向瞬态（生产路径可观测，cohort 实测）：低分区连答错 3 次掌握度反升 0.22→0.2488；高分区连答对 3 次反降 0.95→0.8715（`docs/current-sprint.md` 2026-09-11 两条；C1 候选已批准但所有者决定 OFF——"无可观测收益，属防御性"）。 |
| insufficient evidence | B13：332 道题库题 **0 行**直接节点标注，全靠 16 条 PRIMARY 桥接（≈1 条映射对 20 题）——节点粒度与题目内容之间的对齐是推导不是核实（`docs/current-sprint.md:79/81`）；错题→节点归因因此带 ±20 题模糊。 |
| decay | retention 在复习路径曾硬编码 1（"刚复习完保持率完美"），V12.1 后练习观测走真实 EMA，但复习排程字段的 retention=1 仍在（applyReview，score-center/service.ts:195）；FSRS 影子已建未接线（UNTRAINED 权重）。 |
| recoverability | 无测量（见 §5）。 |
| 校准 | mastery-calibration 影子（V11-M4.2）对比"存储掌握度 vs 实际做题正确率"（±15pt 阈值，30 天窗，最常练 20 节点）——**但对照的是同类练习题，不是新题/考题**：它校准的是 EMA 对练习正确率的追踪，不是掌握度对考试的预测。 |

### 6.2 真实案例

1. **生产走查（jackchou，2026-09-08）**：一场 8/15 模考 5 题全错 → score150Estimate 诚实 0 分、nodeLoss 归因两个节点、recoveryClosure 0/3（上次暴露 3 个缺口 0 个闭环）。诊断链路真实工作；但"恢复任务完成了没有用"这一步——闭环率之所以能算，靠的是任务完成标记，不是复测成绩。
2. **生产 effectiveness 冒烟（2026-09-07）**：节点 CO-C03-S05-P01 以 161 样本通过证据门（masteryGain 0.3418）；4 节点评估 1 过 3 被诚实拦截。这是全仓最接近"干预→能力"的真实数字——但它是**掌握度增益**，不是任何考试口径的增益。
3. **校准首对照（score-loop E2E，2026-09-10）**：`predicted=26 actual=96 error=70`，MAE 因样本 <5 拒绝给出。无论该 case 的量纲混用（见 §10），第一次预测 vs 实测的误差是 70/150 量级——校准不是"已校准"而是"刚知道没校准"。
4. **迁移盲区（结构性）**：PracticeRecord 无 firstSeen/source 字段（schema.prisma:590-621），复习重做走 ReviewAttempt 独立链——"这道题是第几次见"全库不可回答 → 练习正确率↑里有多少是重做旧题的记忆效应，永远无法从准确率中剥离。

**L3 结论：mastery 对"同源练习正确率"有真实追踪力（PARTIAL），对"新题/考题正确率"的预测力未测（Transfer Gap 不可计算），对"考试分数"的映射未经校准。**

---

## 7. L4：Recommendation Audit（INPUT → SCORE → RANK → ACTION）

- **INPUT**：学生事实 = UserKnowledgeMastery 全表 + User 自报目标 + ReviewSchedule 计数；内容事实 = 1296 节点 + 考频快照 + 33 条前置关系；候选宇宙 = 全节点（无快照节点按中性证据进入，V11-M3 诚实化）（recommendation.service.ts:103-166）。
- **SCORE**：加性 priority（§5）；reason codes 来自阈值规则，**不足两条时从 genericPool 按 breakdown 分值凑足两条**（priority.ts:111-121）——理由码可能是凑数而非真实主因。
- **RANK**：score 降序 + nodeId 字典序 tie-break；复习意图去重；KNOWLEDGE/REVIEW/QUESTION_SET/TASK_DRAFT 四类合并输出。
- **ACTION**：classifyAction 五分支（错≥2→错题重做、遗忘→复习、薄弱→新学、低正确率→练习、临近+高掌握→模考）+ 静态分钟表 + 预算贪心装填 + 科目配额。

### Q1 为什么推荐这个知识点？
可解释（scoreBreakdown 持久化到 StudyTask、reasonCodes 下发、任务行展示）——**工程上 CONFIRMED**。但解释的是"为什么它优先级高"，不是"它能换几分"。

### Q2 是否考虑 weakness/exam importance/score loss/recoverability/urgency/training cost/confidence？
weakness ✅、examImportance ✅（examValue）、urgency ✅（daysToExam 相位乘数 + forgetting）、score loss ❌（无分值货币）、recoverability ❌、training cost ⚠️（静态分钟，进入预算但不进排序）、confidence ⚠️（mastery confidence 只做展示，排序不分置信度——低样本节点与高样本节点同权重竞争预算）。**7 项中 2 项半。**

### Q3 能否回答"只有 30 分钟，做哪个任务收益最大"？
**不能。** 能回答"哪个任务优先级最高且装得进 30 分钟"；不能回答"哪个任务单位时间期望提分最大"（无乘性收益、无实测成本）。影子机会模型含 trainingCost 因子（权重 0.18）但 teacher-only 且 confidence 有限。

### Q4 推荐是否经 outcome feedback 修正？
**否——这是 L4 最重的一处缺口。** outcome 基础设施其实已建成：ActionOutcomeAudit 聚合 action 后续作答 → ActionLearningSignal 判 SUCCESS/PARTIAL/FAILED → 写 USER_ACTION_FEEDBACK；outcome-tracking 做 14 天前后对照（improved/no_change）。但 grep 证实：**priority.ts/plan.ts/recommendation.service.ts 零消费这些信号**——`recommendation.created/accepted/completed/failed` 四个事件类型是保留字常量且全仓无发射点。一个连续 FAILED 的推荐动作不会降低同类推荐优先级；系统会日复一日推荐同样的东西并同样失败。产品上这直接制造 Case D（§13）。

---

## 8. L5：Intervention Audit（Activity vs Learning）

- 干预链机制真实：RecommendationAction（幂等 creationKey）→ StudyTask 绑定 → 曝光遥测（V12-M2a，前端 exposed/viewed，null≠0 诚实语义）→ 完成标记。
- **完成任务 ≠ 学习成功——系统自己已用测试钉死这个事实**：`completeStudyTask` 只写 StudyTaskCompletion；V11-M2 task-evidence 投影以"任务知识点 ±3 天的练习事实 + 掌握度 Δ"判定 improved/practiced/practiced_no_gain/insufficient_data，**完成标记单独永不构成证据**（task-evidence.ts 头注释）。V12-M1 证据台账把 strong/weak/none 三类证据落库（EVIDENCE_RECORDED）并上生产。
- 但注意不对称：**干预生效的前提是学生自发在任务知识点上做判分练习**——任务完成行为本身对能力零贡献，"去练习"按钮之后做不做、做多少、做对多少，全部取决于学生。系统不安排干预后的强制复测（review 排程只覆盖错题），所以"干预→能力"的因果在大多数任务上只能事后碰运气式观测。
- 复习→掌握度：V12.1 已接线并生产验证（q-003 → mastery 0.9259、毫秒级 lastLearnedAt 对齐、幂等重放 Δ=0）——**EB-5 正式关闭**，这是本审计窗口内最重要的因果链修复。
- 证据链当前状态：31 attempts → 31 occurrence-keyed receipts（1:1）已实测；历史按天去重回执仍在（16/31 观测在旧台账不可分辨，管线以 attempt 行驱动对账规避）。

**Intervention Outcome 证据链：结构已建成（activity→evidence→ability 的观测与投影），生产样本极少（effectiveness 仅 1 节点过门），且止步于掌握度口径。**

---

## 9. L6：Assessment Audit（Transfer Gap）

- 测评资产：阶段测评（两通路）、整卷模考（会话提交、报告、考后复习任务、成绩趋势）、复习重做（SM-2 排程）。
- **闭环真实存在但方向单一**：模考/测评的逐题作答会更新掌握度（submitPracticeSession 事务内 applyAttempts，study.service.ts:4598）→ 影响后续推荐。即"测评→能力估计"通；"练习→测评"的反向验证通吗？
- **practice accuracy ↑ → exam-like accuracy ↑ 无法证明**：
  1. 无新题/旧题区分 → 练习准确率无法换算为"首次面对陌生题的能力"；
  2. review-shadow 测的是**同一批题**的保持率（17 天观察窗），不是迁移；
  3. mastery-calibration 对照的是**最常练题**的正确率，不是考题；
  4. 模考是唯一"考试形态"的测量，但频率取决于学生自觉，且主观题自评（正确率口径被自评污染）；
  5. 阶段测评独立通路的分数只进内存数组（stageAssessmentResults，study.service.ts:540/3797），**重启即失**，不进 AssessmentHistoryItem。
- **Transfer Gap 判定：MISSING（不可观测）**。这不是测量精度问题，是测量对象不存在——系统没有一道"专门用来验证迁移的新题探针"。

---

## 10. L7：Score Validation Audit（prediction / assessment / outcome 严格分账）

| 概念 | 系统中对应物 | 口径 | 状态 |
|---|---|---|---|
| **prediction** | estimatePredictedScore（报告页）；score150Estimate（单场诊断） | 启发式插值 / 客观×80+主观自评 | 有，均明示"估算"；未与真实分对照 |
| **assessment** | score-history（type='paper' 会话正确率）；AssessmentHistoryItem | **注意两套口径**：score-history 是正确率百分比；AssessmentHistoryItem 的 paper 写入是 `score=accuracyRate, totalScore=100`（study.service.ts:4727-4728），另有用户手工导入通道（study.service.ts:1868-1901）——**两者无来源字段区分，只能靠 id 前缀约定** | 有，口径混杂 |
| **outcome（真实考研分）** | **不存在**。User 无 examDate（schema 148-157；remainingDays 是手填 Int），全库无 RealExamScore 类模型，currentScore 永不被系统自动更新 | — | **MISSING（external-input gap，本审计确认 V12-M5 结论仍然成立）** |

**已发现的真实校准缺陷**：score-calibration 把 0-150 尺度的预测与 AssessmentHistoryItem 的 actual 直接配对求 MAE——而 paper 场次的 actual 是 0-100 正确率折算分（score-calibration.service.ts 重建预测用 DEFAULT_TOTAL_SCORE=150，actual 却来自 4727 行的 totalScore:100 写入）。**量纲错配使 MAE/bias 数字本身不可解释。** 这是影子端点内部问题，不影响学生，但意味着"校准基建已就绪"的说法要打折扣：就绪的是管道，不是可解释的数字。

**Mock ≠ Real 的边界系统自己守住了**（PREDICTION_IS_NOT_ACTUAL 免责、calibration 的 authoritative:false）——诚实性合格；但产品层面"分数有没有提高"这个问题，今天只能用"模考正确率"部分代理，且该代理被主观自评污染、被重做效应污染、被题目粒度（1:20 桥接）污染。

---

## 11. 提分因果链五段判定

```text
Recommendation → Intervention → Ability Change → Assessment Improvement → Score Improvement
```

| 段 | 判定 | 依据 |
|---|---|---|
| Recommendation → Intervention | **CONFIRMED** | Action 幂等脊柱、StudyTask 绑定、曝光/查看遥测、任务行理由。生产走查验证。 |
| Intervention → Ability Change | **PARTIAL** | 机制通：作答→EMA（V12.1 后复习也通，生产验证）。但①依赖学生自发做判分练习，任务完成零贡献；②无干预后强制复测，观测靠事后窗口；③生产样本极少（effectiveness 1 节点过门）。 |
| Ability Change → Assessment Improvement | **PARTIAL（偏 MISSING）** | 测评存在且回写掌握度，但"掌握度变化预测测评变化"从未被测量；无节点级复测；Transfer 不可观测（§9）。 |
| Assessment Improvement → Score Improvement | **PARTIAL（模考）/ MISSING（真实分数）** | score150Estimate 是估算（客观精确匹配×80+主观自评）；真实考研分无录入通道，外部输入缺口。 |
| Score Improvement ← 归因给系统 | **UNPROVABLE** | 无对照、无实验测量（A/B 只打标）、效果分析全部 teacher/admin 影子且零生产消费样本、学生端看不到任何因果陈述。 |

**上游数据存在不能推断下游成立——本表每一段都是独立判定的结果，不做链式放大。**

---

## 12. Learning Effectiveness Matrix

| Layer | 问题 | 证据 | Status |
|---|---|---|---|
| Activity | 是否学习（发生动作） | 遥测 allowlist 21 类、StudyTaskCompletion、PracticeRecord/ReviewAttempt、曝光漏斗 | **CONFIRMED** |
| Evidence | 学了什么（可解释表现） | V12 证据台账（强/弱/仅活动三分类，上生产）、task-evidence、outcome-tracking；但历史回执按天去重、复习身份历史行 NULL、AiTutorLog 只写不读 | **PARTIAL** |
| Ability | 会不会了 | EMA 唯一写方+快照；二值正确率驱动、主观自评污染、方向瞬态、neutral 0.5 先验、confidence=样本量 | **PARTIAL** |
| Transfer | 新题会不会 | 无 firstSeen/source 字段、无新题探针、review-shadow 只测同题保持 | **MISSING** |
| Assessment | 模考有没有变好 | 模考报告/趋势/诊断书存在；主观自评污染、模考频率靠自觉、阶段测评分数仅内存 | **PARTIAL** |
| Score | 分数有没有提高 | score150Estimate+score-history（代理）；无真实分通道、currentScore 永不更新 | **PARTIAL（代理）/ MISSING（真实）** |
| Attribution | 能否归因给系统 | 影子仪器齐备（effectiveness/calibration/outcome）但 teacher/admin only、生产消费样本≈0、A/B 只打标不测量、学生不可见 | **MISSING** |

---

## 13. "看起来有效，实际上没提分"的五类路径

| Case | 系统中的现实对应 | 判定 |
|---|---|---|
| **A. mastery ↑ 而 score 不变** | 结构性可发生且不可证伪：①主观题自评抬高掌握度但真实阅卷不给分；②EMA 追踪的是练习题；③模考稀疏导致 score 序列噪声大于信号；④方向瞬态让 mastery 数字本身失真。生产 161 样本 masteryGain 0.3418 是唯一大样本"mastery ↑"证据，其 score 端无对照。 | **现实存在，不可检测** |
| **B. activity ↑ 而 mastery 不变** | 系统已诚实标注（完成标记永不构成证据；streak/quest/进度叙事各有证据门），但产品仍以任务完成率、连击、进度叙事呈现"进步"——学生对"我努力了"的感知与"我会了"的验证脱节。 | **现实存在，已部分披露** |
| **C. practice accuracy ↑ 而 exam accuracy 不变** | 重做效应不可剥离（无 firstSeen）+ 题目-节点映射粗（1:20）+ 时间压力/题型差异不建模。Transfer Gap 无测量。 | **现实存在，不可检测（最危险）** |
| **D. recommendation score ↑ 而实际 outcome ↓** | outcome 信号（SUCCESS/PARTIAL/FAILED）已计算但不回流排序（§7 Q4）；失败推荐永不降权，同类任务重复下发。 | **机制性存在，已可观测但未接线** |
| **E. 完成大量任务而预计分数不提升** | estimatePredictedScore 的 progress 含 0.2×timeFactor（remainingDays/240）：能力不变时，离考试越近预测分越低（离线复算：240 天→94 分，30 天→90 分）——预计分随时间机械下滑，完成任务带来的 mastery/accuracy 微增与该下滑互相抵消的方向不可控；且该预测从未对照真实分。 | **预测端 artifact 现实存在** |

---

## 14. Recommendation ROI（当前 vs Score-Optimal 离线基线）

**当前不存在按 ROI 排序的推荐**（§5/§7）。按任务书要求构造只读离线 baseline（未改任何线上代码，全部用编译产物计算）：

```text
ScoreOptimal(node) = OccurrenceProb(node) × ScoreWeight(node) × ErrorProb(node) × TransferFactor
                     ───────────────────────────────────────────────────── / ExpectedTrainingMinutes(node)
```

- OccurrenceProb ≈ recent3Y.frequency / 5（有快照数据）
- ScoreWeight ≈ primaryScore5y / 45 归一（有快照数据）
- ErrorProb ≈ 1 − mastery（EMA，含已知效度威胁）
- TransferFactor：**无数据**——这是本公式第一个诚实缺口（首版取 1 并声明，待 E2 实验 §19 补）
- ExpectedTrainingMinutes：**无实测**——静态 estimateMinutes 是第二个缺口（成本端）

用它复算 §5 的对照案例：高频中弱节点（A）期望收益 ≈ 0.8×0.89×0.65 ≈ 0.46 档；低频极弱节点（B）≈ 0.2×0.13×0.95 ≈ 0.025 档——**真实 ROI 相差 ~18 倍，而 priority 只差 11 分（67 vs 56）**。排序压缩定量成立。当前引擎在"高频×薄弱"的主象限方向大体正确（examValue 权重最高），系统性错配发生在：①低频高薄弱 vs 中频中弱的预算竞争；②已掌握高频节点的打磨惯性；③同优先级内完全无分值分辨率。

---

## 15. AI Coach 审计

**证据注入真实、执行边界诚实、但 AI 层与学习结果之间没有任何可度量连线。**

- Context（真实）：ContextAssembler 注入 goal/掌握度摘要/前 3 薄弱点/今日任务（contextual-coach-context-assembler.service.ts:151-188）；分场景注入题目、错因史、考频、RAG 检索节点；V2 个性化注入近 7 天正确率/到期复习/连击。
- Intervention（不执行）：系统 prompt 明令"你不能修改学习计划/任务/掌握度"（contextual-coach.prompt.ts:9）；nextActions 是非执行性文案；唯一落库是会话摘要。**AI Coach 是"会说"的教练，不是"会做"的教练。**
- Follow-up（缺失）：AI 建议无 actionId、无法接入推荐 outcome 链；`AiTutorLog` 只写不读；`recordLearningOutcomeDelta`（ai-metrics.service.ts:131）全仓零调用——**AI 建议后学生是否变好，系统既不追踪也不反馈**。判定：**GAP（AI 目前无法证明其建议改变任何学习结果）**。
- 半装饰部件：Tutor Mode 的 checkUnderstanding 是正则匹配、三层解释是模板插值掌握度数字（tutor-mode.ts:78-100）；ai-metrics 七类"学习智能"事件六类零生产者、evaluation.passRate 硬编码 0（ai-metrics.service.ts:194）。
- LLM 供给：DeepSeek 真实客户端存在且生产走查出现过 mode=llm 真实对话；但部署脚手架 `.env.production.example` 无 AI_API_KEY 条目（默认空）——**生产默认是模板 fallback**，真实 AI 是否启用取决于运维手工注入。

## 16. RAG / Agent 审计

- **Retrieval Quality ≠ Learning Effectiveness**：生产运行时指标只有 hitRate（"结果数>0 的比例"）/avgTopScore/延迟/缓存命中（knowledge-search.service.ts:118-124）——**没有任何 precision/recall/golden 集评测在生产运行**（历史 91.7% top3Hit 是一次离线评测）；更关键的是所有 RAG/Agent/Coach 事件**不含 userId、内存 60 分钟滑窗、重启清零**（ai-metrics.service.ts:2-40）——**"用过 RAG 的学生 vs 没用的学生"的对比在数据结构上不可能**。判定：RAG 的学习有效性 UNPROVABLE，且当前架构下不可测量。
- Agent 纪律良好：Study Agent 的 plan/createTask 走生产同一 canonical writer（agent-tools.ts:11-12，generationKey=AGENT:*），LLM 写工具需显式授权、引用节点必须在工具返回集合内（防幻觉）——**不是第二套 SoT**。但注意：Web 前端根本不调用 /agent/study/plan 与 /agent/daily/plan（仅精灵调 supervisor）——Agent 计划能力实际未进入学生主路径。

---

## 17. Data Quality Audit（哪些缺口直接阻止提分闭环）

| # | 缺口 | 证据 | 对提分闭环的影响 |
|---|---|---|---|
| 1 | 无考试日期、无真实成绩表、currentScore 永不自动更新 | schema.prisma:148-157；全库 grep 无 RealExamScore | **阻断 Score 层与 Attribution 层的一切证明**（P0） |
| 2 | B13：332 题 0 直接节点标注（16 条桥接 1:20 推导） | /admin/data-quality 在册；current-sprint:79 | 错题归因、考频映射、掌握度对齐全部带粗粒度误差（P0 级内容债） |
| 3 | PracticeRecord 无 firstSeen/source（新题 vs 重做不可分） | schema.prisma:590-621 | Transfer 不可观测（P0 级测量债） |
| 4 | 主观题 selfScore 自评 ≥0.6 记对并喂掌握度 | study.service.ts:3342-3368 | 70/150 卷面主权建立在自评上；rubric 表已建但生产 0 行内容 |
| 5 | AssessmentHistoryItem 混来源无 provenance 字段 | schema.prisma:807-825；写入点 1898/2101/4736 | 校准 MAE 量纲错配、成绩序列不可解释 |
| 6 | B4：147 节点无考频快照；B6：1296 节点仅 33+21 条关系边 | /admin/data-quality；current-sprint:21/59 | examValue 覆盖不全；前置推导（recoverability/prerequisite 替换）近乎失效 |
| 7 | recommendation.created/accepted/completed/failed 零发射点 | canonical-event-writer.service.ts:32-56 | 漏斗靠 Action 行状态+曝光遥测拼合，生命周期事件缺失 |
| 8 | 阶段测评独立通路结果仅存内存数组 | study.service.ts:540/3797 | 测评历史不完整 |
| 9 | 快照缺 accuracy/recentAccuracy | schema.prisma:1027-1043 | 影子对照只能用近似（已在账本声明） |
| 10 | ReviewAttempt 排程属性历史行 NULL（31/31 unknown→新迁移后新行有值） | 迁移 20260912000000 注释 | 历史复习不可审计（新数据已修） |
| 11 | AI 指标无 userId、内存 60 分钟 | ai-metrics.service.ts:2-40 | AI 有效性在数据结构上不可测量 |

**daily dedup / missing review identity 两个历史问题**：前者已由 occurrence 键对新事件修复（31→31 实测），旧回执保持日聚合；后者已由四列迁移对新 attempt 修复，历史行诚实 NULL。两项均已在册（docs/v12-m3-review-mastery-*-report.md），本审计确认现状与账本一致。

---

## 18. Current Capability Map

```text
Activity    ██████████  CONFIRMED   行为采集全链真实（作答/任务/曝光/遥测）
Evidence    ██████░░░░  PARTIAL     证据台账上生产；历史保真缺口在册；只写不读件存在
Ability     █████░░░░░  PARTIAL     EMA 追踪练习正确率；自评污染+方向瞬态+粒度粗
Transfer    ░░░░░░░░░░  MISSING     新题/旧题不可分，迁移不可观测
Assessment  █████░░░░░  PARTIAL     模考/测评存在并回写；自评污染；频率靠自觉
Score       ███░░░░░░░  PARTIAL     估算分存在；真实分通道缺失（external-input gap）
Attribution ░░░░░░░░░░  MISSING     影子仪器齐备但 teacher-only、零消费、无实验
```

## 19. Top 10 Gaps（按提分价值排序）

1. **真实分数回流通道缺失**（无 examDate/实考分表/currentScore 死值）——没有终点货币，一切证明不可能。
2. **迁移测量缺失**（无 firstSeen/source、无干预后新题复测）——Case C 不可检测，掌握度效度无法外部校准。
3. **主观大题 70 分主权缺失**（selfScore 自评喂掌握度；rubric 生产 0 行内容；大题训练 MISSING）。
4. **生产无失分模型**（乘性 ROI 不存在；score-opportunity 影子未转正；预计提分区间未标定）。
5. **错因→干预断裂**（错因类型不参与 action 选择；计算/粗心/表达类不可自动识别）。
6. **outcome→推荐零反馈**（SUCCESS/FAILED 信号已算但不回流排序；失败推荐永不降权）。
7. **掌握度效度威胁束**（自评污染+EMA 瞬态+neutral 0.5+confidence 误读风险）。
8. **内容-节点映射精度**（B13 1:20 桥接 + B4 147 节点无考频 + B6 关系稀疏）。
9. **校准管道量纲错配**（150 预测 vs 100 actual 直接配对；AssessmentHistory 无 provenance）。
10. **AI/RAG 有效性不可测量**（无 userId 归因、内存滑窗、evaluation=0 硬编码、AiTutorLog 只写）。

## 20. P0 Product Blockers（没有它就无法证明系统提分）

- **P0-1 真实分数闭环**：考试日期字段 + 成绩录入通道（模考分/机构分/实考分，带 provenance）+ 校准投影学生可见。Schema 增量需所有者批准。
- **P0-2 迁移探针**：题目首见标记 + 干预后自动下发 1 道同构新题的复测事件。最小 schema 增量（source/firstSeen）+ 复测任务生成器。
- **P0-3 主观题采分点落地**：rubric 内容生产（教研任务）+ 教师/AI 辅助判分替代纯自评——否则 70/150 的"能力"与"分数"永远隔着一层自评噪声。
- **P0-4 失分模型最小版转正**：OccurrenceProb×ScoreWeight×ErrorProb（×TransferFactor 待测）进入排序对照影子 → 预注册阈值 → 学生可见"练它能捞几分"。

## 21. P1 Opportunities（存在提分机会，不阻断基本闭环）

- 错因驱动的干预分化（概念混淆→对比学习任务；计算错误→限时计算组；时间不足→限时套题）。
- outcome 反馈降权（FAILED≥N 的推荐模式降低同类优先级——信号已在库）。
- 复习 retention 与 FSRS 影子收口（数据在积累，预注册阈值已在册）。
- 干预后 48h 自动复测调度（复用 review 排程基建）。
- AI Coach 的 nextActions 结构化为可执行 actionId 并接入 outcome 链。
- B13/B4 内容批处理（独立内容任务，dry-run+provenance，已在册流程）。
- 阶段测评结果落正式表；AI 指标加 userId 与持久化。

## 22. False Confidence Findings（"测试很漂亮"但提分证据不足的地方）

1. **2324/2322/0 全绿 ≠ 提分成立**：全绿覆盖的是工程契约；上表 10 个 gap 没有一个能被现有测试套件的红绿反映。
2. **"校准已建成"**：管道在、数字错——MAE 配对存在 150 vs 100 量纲错配；且生产消费样本≈0。
3. **"masteryGain 0.3418 通过证据门"**：这是掌握度增益，报告与 UI 的措辞容易被读成"提分 0.34"量级的证据。
4. **"推荐引擎可解释"**：reasonCodes 在不足时从池子里凑两条（priority.ts:111-121），解释力有上限。
5. **"RAG top3Hit 91.7%"**：离线评测数字，生产运行时只测"是否有结果"，且无用户归因。
6. **"AI 生产实测真实 LLM 对话"**：部署脚手架默认无 key；"演示过真模型"与"生产默认启用真模型"是两件事。
7. **"预计分 94 分"**：estimatePredictedScore 是目标插值（含 timeFactor artifact），从未对照真实分；它给出的安慰大于信息。
8. **"学生隔离/幂等/指纹断言全过"**：这些是写路径安全证据，不是学习有效性证据——审计期间多份里程碑报告把这二者并列陈述，读者易混淆。
9. **confidence 字段**：样本量函数被命名为 confidence，在 UI/文档语境会被读成"系统有多确定"，实际与预测质量无关。

## 23. 十问十答（每问一个判定）

| # | 问题 | 判定 | 一句话依据 |
|---|---|---|---|
| 1 | 学生为什么会丢分？ | **PARTIAL** | 8 类错因存在但自动推断靠时间代理+兜底桶；计算/粗心/边界/表达/迁移不可识别 |
| 2 | 能否准确定位丢分？ | **PARTIAL** | 模考内可归因到节点（生产验证）；受 1:20 桥接限制；全谱系丢分地图无 |
| 3 | 丢分→能力缺口映射？ | **PARTIAL** | 节点→mastery 通路存在；错因类型与缺口类型不连接（§4.2） |
| 4 | 每个缺口值多少考试分？ | **MISSING（生产）** | 影子区间未标定、teacher-only、不进排序 |
| 5 | 修复缺口要多少训练成本？ | **PARTIAL** | 静态分钟表（15-35），非实测、不随缺口大小变化 |
| 6 | 能否选最高 ROI 下一动作？ | **MISSING（生产）** | 加性优先级 + 预算贪心；30 分钟问题无分值答案（§14：ROI 差 18 倍时 priority 差 2 分） |
| 7 | 动作改变了能力？ | **PARTIAL** | 作答→EMA 因果真实（V12.1 后复习也通）；任务完成零贡献；无强制复测；生产样本极少 |
| 8 | 能力迁移到考试题？ | **MISSING** | 无 firstSeen、无新题探针、同题保持≠迁移 |
| 9 | 考试表现转化为分数？ | **PARTIAL** | 客观×80+主观自评的估算；量纲错配在册；真实分无通道 |
| 10 | 分数变化归因于系统？ | **UNPROVABLE** | 无对照、无实验测量、归因仪器 teacher-only 零消费 |

---

## 24. Experiment Design（最小可行实验，全部可设计为只读或最小增量）

| 实验 | 问题 | 设计 | 成本 | 产出 |
|---|---|---|---|---|
| **E1 分数锚定**（最优先） | 预测分到底准不准 | 招 5-10 名真实学生：①补录 examDate；②2 周内做 1 次全真模考（教师用 rubric 判主观题）；③经既有 import 通道录入 1 次外部成绩（机构模考/真题自测）；④跑 score-calibration（先修量纲错配） | 零 schema（import 通道已在）；教研判分人力 | 第一批真实 MAE/bias；error 分布决定估算分能不能见学生 |
| **E2 迁移探针** | mastery 预测新题吗 | 抽 30 个高频节点 × 2 道同构新题；学生完成节点干预后 48h 自动下发 1 道新题；对比练习准确率 vs 新题准确率 | 最小 schema（source='transfer_probe'）+ 复测调度器 | Transfer Gap 首个数字；TransferFactor 进入 ROI 公式 |
| **E3 推荐对照** | score-ROI 排序优于 priority 排序吗 | 复用 assignExperimentArm 确定性分流：A 组 priority 排序周计划 vs B 组 score-opportunity 排序；4 周后比模考 score150Estimate 变化 | 零 schema（分流器已在）；依赖 E1 的测量端 | 排序货币切换的预注册证据 |
| **E4 归因回溯**（只读） | 推荐干预与模考失分变化有相关吗 | 对 outcome-tracking 判 improved/no_change 的 action 与 30 天内模考 nodeLoss 做 join（只读 SQL/脚本） | 零 schema | 第一张"推荐→模考表现"样本表；决定 Attribution 层能否对学生开放 |

---

## 25. Product Reconstruction（下一阶段真正应重构的产品能力——只提方向，不写代码）

1. **把"分"变成一等公民**：引入 ScoreLedger 概念（每一分都有来源：哪场考试、哪个节点、哪种错因、可恢复多少），替换当前"掌握度+正确率+任务完成"的代理结算体系。所有学生可见的"进步"叙事逐步迁移到分数口径。
2. **把"测"从学生自觉变成系统编排**：诊断性入学测（冷启动解决 neutral 0.5 问题）、干预后强制复测、周期性迷你模考——测评从"功能"升格为"测量协议"。
3. **把"诊断→干预"接通**：错因类型→干预类型→复测验证的映射表产品化，让"为什么错"真正决定"做什么"。
4. **把影子仪器学生化**：effectiveness/calibration/outcome 的诚实语义不变，受众从 teacher/admin 扩展到学生本人——"这个任务做完你的能力证据是什么"应当是学生看到的，而不是只有教师能看到。
5. **内容主权收复**：B13 标注批处理 + rubric 内容生产是教研侧任务，工程侧提供 dry-run/provenance/回滚（流程已在册），但不属于工程重构主线。

---

## 26. 如果只能做 3 件事

### 第 1 件：建立真实分数闭环（Score Ledger）

- **WHY**：提分产品的结算货币是分数。没有 examDate 与成绩录入，所有下游投资（ROI 模型、迁移测量、归因）都没有对照终点；这是全链唯一"缺了它其他都白做"的节点。
- **EXPECTED IMPACT**：把"提分"从 UNPROVABLE 变为可度量；估算分获得校准；学生第一次看到可信的"你离目标还差几分、差在哪"。
- **EVIDENCE NEEDED**：每生 ≥2 次教师判分模考 + ≥1 次外部成绩锚（E1）。
- **IMPLEMENTATION SCOPE**：`User.examDate`（替换手填 remainingDays）+ 成绩表（score/totalScore/source/examType/provenance）+ 录入 UI + 校准量纲修复 + 学生可见校准卡。Schema 增量需所有者批准；纯增量可回滚。
- **MEASUREMENT**：MAE/bias 随样本收敛曲线；预测区间覆盖率；学生端"预计分 vs 实考分"偏差展示。

### 第 2 件：迁移探针 + 首见标记（让 Transfer 可测量）

- **WHY**：Case C（练习对、考试错）是自适应学习产品的头号失效模式，当前系统对它完全盲视；同时迁移因子是失分模型（ROI）公式里唯一无数据的项。
- **EXPECTED IMPACT**：Transfer Gap 从 MISSING 变为数字；mastery 获得第一个外部效度校准；为第 3 件提供 TransferFactor。
- **EVIDENCE NEEDED**：30 节点×2 新题的探针响应（E2）；练习准确率 vs 新题准确率差。
- **IMPLEMENTATION SCOPE**：PracticeRecord 增加 source/firstSeen（或独立 AttemptSource 字段）+ 干预后 48h 复测调度器（复用 review 排程基建）+ 迁移率投影。最小 schema 增量。
- **MEASUREMENT**：per-node transfer rate（新题正确率 / 同源练习正确率）；低迁移节点清单直接反哺内容与推荐。

### 第 3 件：失分模型最小版转正（预计可恢复分数进入排序）

- **WHY**：系统的核心承诺是"把有限时间换成最多分数"，当前排序加性启发式无法兑现（§14：真实 ROI 差 18 倍时 priority 差 2 分）；机会模型的零件已在（考频/分值/EMA/成本估算），缺的是组装、标定与转正决策。
- **EXPECTED IMPACT**：同样时间预算下期望分数收益提高（可用 E3 对照验证）；"练它能捞几分"成为学生可见理由。
- **EVIDENCE NEEDED**：排序分歧分布（影子跑 2 周）+ E3 模考对照 + 预注册阈值（方向一致率、排名位移上限——仓库已有同类预注册实践）。
- **IMPLEMENTATION SCOPE**：score-opportunity 从影子转正为排序输入之一（不动引擎公式结构，走输入注入）；expectedBenefit 区间按 E1 校准替换；TransferFactor 先取保守常数并声明。纯共享层增量，零迁移。
- **MEASUREMENT**：Δranking 分布、新旧排序的期望分差、4 周模考变化对照、失败推荐降权后的 outcome 改善。

---

## 27. 停止声明

本审计为 READ-ONLY 任务，已按约定完成：**零代码改动、零数据库写入、零迁移、零部署、零功能实现**。本文件是唯一产物。所有工程判断以当前工作区代码为准，所有生产事实标注出处（current-sprint 账本及各里程碑报告）。审计到此停止——不开始 V13，不自行修问题，不自行决定产品架构；"3 件事"的取舍与排期由所有者决策。
