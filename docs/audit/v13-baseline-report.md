# V13 提分能力审计 · 基线评分报告

> **GENERATED FILE** — 由 `scripts/audit-v13-scorecard.mjs` 生成，勿手改。评级变化请改 `docs/audit/v13-evidence.json` 后重跑 `npm run audit:v13`。

- 审计日期：2026-09-14　分支：`feature/v3-product-refactor`　HEAD：`56e3fe11e6d3b75b575836943b164b5c97018946`
- 评级人/方式：ZCode V13 审计会话（5 路只读代码取证 + current-sprint 账本交叉核对）
- 评分口径：`docs/audit/v13-rubric.json` v13.0.0（anchor：A=1 / B=0.6 / C=0.25 / D=0；层内等权；层权重 data 0.15 / diagnosis 0.25 / decision 0.25 / training 0.25 / validation 0.1）
- 免责（RULE-11）：本评级评估的是『系统的提分能力主张』，不是学生分数增益。按 AGENTS.md RULE-11，Verified Score Gain / 30d 未实现（校准样本=0），任何评级不得被引用为已验证提分数字。

## 1. 结论

- **V13 加权总分 = 0.5579 / 1.00**（平均分会掩盖短板，以下闭环判定优先于总分）
- **提分闭环完整度 = FAIL** —— **不具备**。层门禁（诊断/决策/训练/验证每层 ≥ B）：PASS；P0 门禁（闭环层内任意 P0 项 < B 即失败）：FAIL（10 项 P0 低于 B）。

| 层 | 权重 | 层分 | 等级 | P0 达标（≥B / 总） | 在闭环内 |
|---|---:|---:|:---:|:---:|:---:|
| L1 数据 Data | 0.15 | 0.6375 | **B** | 9 / 10 | 否（供数层） |
| L2 诊断 Diagnosis | 0.25 | 0.55 | **B** | 6 / 8 | 是 |
| L3 决策 Decision | 0.25 | 0.525 | **B** | 6 / 9 | 是 |
| L4 训练 Training | 0.25 | 0.5708 | **B** | 9 / 10 | 是 |
| L5 验证 Validation | 0.1 | 0.5083 | **B** | 7 / 11 | 是 |

**闭环 P0 短板清单（评级 < B 的 P0 项，即『提分闭环 = FAIL』的直接原因）**：

| 审计项 | 层 | 等级 | 路线图归属 |
|---|---|:---:|:---:|
| G4 题型能力诊断 | diagnosis | D | D2 |
| G9 跨题模式诊断 | diagnosis | C | A2 |
| R5 难度调节 | decision | C | B1 |
| R8 大题策略 | decision | C | B2 |
| R10 策略自适应 | decision | D | B3 |
| T2 刻意训练 | training | C | B1 |
| V3 题型增益 | validation | D | D2 |
| V8 学习效率 | validation | D | D3 |
| V9 推荐效果 | validation | C | D4 |
| V10 策略效果 | validation | C | D4 |

### 与 Owner 初始假设的差异

假设：Data B+/A- / Diagnosis B / Decision B / Training C / Validation D/C。实测：Data B / Diagnosis B（低位） / Decision B（低位） / Training B / Validation B（低位）。

差异解释：Training/Validation 的字母档比假设高，是因为大量『工具/管线已建成』满足 B 档下限（B = 底层能力存在但闭环/证据不足）；但按 P0 门禁看，验证层 11 个 P0 项中 4 项 < B、训练层 T2 刻意训练 = C——『结构在、证据无、处方缺』的实质与 Owner 直觉一致。字母总分不应掩盖这一点。

## 2. 逐层明细

### L1 数据 Data（权重 0.15，层分 0.6375，等级 B）

> 核心问题：系统有没有记录『影响得分』的信息？数据是否足以解释失分

| # | 审计项 | 优先级 | 等级 | 评级依据（摘要） |
|---|---|:---:|:---:|---|
| D1 | 作答事件 | P0 | B | 单题提交路径有完整幂等回执（AnswerReceipt：idempotencyKey+requestHash+responseSnapshot，PENDING→SUCCEEDED，hash 不符 409），记录不可变（全仓无 update/delete），字段足以重放；但会话提交路径只做恰好一次无逐题回执，练习集 legacy 路径（study.service.ts:3071）无幂等。 |
| D2 | 正误数据 | P0 | B | correct + timeSpentSec + expectedTimeSec + confidence + usedHint + answerModified 全部落 PracticeRecord；但 answerModified 只是布尔（无修改次数/犹豫轨迹），无 attemptCount 列（查询时聚合）。 |
| D3 | 知识点映射 | P0 | B | 题→知识点多对多（QuestionKnowledgePoint）+ 全量 knowledgePointIds 落库；但节点归因 resolvePrimaryNodeByQuestion 每题只返回一个 PRIMARY 节点，ScoreLossItem 丢分归因严格单点（INV-9），多节点只作标签不进求和。 |
| D4 | 题型数据 | P0 | C | 题型仅 3 档粗枚举（SINGLE_CHOICE/COMPREHENSIVE/JUDGEMENT），无多选/算法设计/计算/综合应用等 408 真实子类型；组卷不使用题型字段，选择题无法区分单选/多选。 |
| D5 | 错因数据 | P0 | B | 8 类错因枚举 + 规则推断（classifyMistake，行为代理：时长×置信×提示）+ 复习时自报错因入口；但规则只能产出其中 6 类（公式记错/计算错误永不可达），自报与作答时刻分离，无粗心/迁移失败类。 |
| D6 | 难度数据 | P1 | B | 三档静态难度标签（教师录入/导入）+ 节点难度 1-5（仅用于 mastery 转移与探针分桶）；全仓无基于真实作答回写难度的校准代码。 |
| D7 | 时间行为 | P1 | B | 逐题 timeSpentSec/expectedTimeSec + 会话 totalActiveMs + answerModified 布尔 + 慢答可推导（1.45×阈值）；模考超时只是布尔判断不落字段，无犹豫轨迹。 |
| D8 | 大题得分 | P0 | B | selfScore 管线完整（自评→0.6 阈值判对→落库）+ ScoreLossItem 逐题丢分（OBSERVED/PROXY 分列、未定价 null 不伪造 0）+ rubric 评分证据含逐采分点 payload；但 PracticeRecord 无分项得分字段，Question.maxScore/rubric 内容标注=0（Owner 09-13 已确认 coverage=0）。 |
| D9 | Review 数据 | P0 | A | ReviewAttempt 为独立事件行：redoCorrect/timeSpentSec/reportedReason/inferredReason/nextIntervalDays/isReview/scheduleDriven/source/dueAt 全记录，逐次幂等（scheduleId+idempotencyKey 唯一），与 REVIEW_MASTERY_APPLIED 证据回执、mastery 投影同事务。 |
| D10 | 模考数据 | P0 | B | Paper 保存整卷题目 JSON 快照（含答案/解析/知识点）+ AssessmentHistoryItem（score/elapsedSec/unansweredCount/weakPointTitle）+ 双写 ScoreAssessment（accuracy_rate 语义隔离）；但分科/逐题得分是读时派生非持久数据，history score=正确率口径非 150 分制。 |
| D11 | 状态历史 | P0 | B | UserMasterySnapshot 每用户×节点×UTC 天一行，可跨天前后对比（effectiveness/task-evidence 即按此读）；但字段仅 mastery/attempts/correct/wrong，无 retention/stability 历史，同日多次作答 upsert 覆盖丢失日内演化。 |
| D12 | 干预记录 | P0 | A | RecommendationAction 记录干预全生命周期（创建/开始/完成/取消 + reason + evidenceRefs + creationKey 幂等）；UserEvent 双层（客户端遥测曝光漏斗 + 服务端 canonical 事件 eventKey 恰好一次）；学习证据 append-only。已知限制：曝光依赖客户端上报。 |

证据引用与差距（gap = 距 A 档的缺口；roadmapRef = 路线图 `docs/audit/v13-p0-closed-loop-roadmap.md` 中的工作项）：
- **D1 作答事件（B）** gap：会话/练习集两条路径补齐逐题回执后可达 A。｜roadmapRef：—｜证据：prisma/schema.prisma:194-210；apps/api/src/study/study.controller.ts:393-417；apps/api/src/study/study.service.ts:3114-3124；apps/api/src/study/learning-session.repository.ts:94-116
- **D2 正误数据（B）** gap：逐次答案修改轨迹与尝试次数字段缺失。｜roadmapRef：—｜证据：prisma/schema.prisma:610-621；apps/api/src/study/learning-session.repository.ts:19
- **D3 知识点映射（B）** gap：多节点归因语义（丢分如何分摊到多节点）未定义。｜roadmapRef：—｜证据：prisma/schema.prisma:594-601；apps/api/src/study/question-node-resolution.ts:42-70；apps/api/src/study/study.service.ts:3394；prisma/schema.prisma:1196-1201
- **D4 题型数据（C）** gap：题型子类型 taxonomy（schema + 内容标注）整体缺失。｜roadmapRef：D2｜证据：prisma/schema.prisma:41-45；packages/shared/src/domain.ts:9；packages/shared/src/questionImport.ts:141-150
- **D5 错因数据（B）** gap：内容级错因识别（计算错误/公式记错的实际触达）与自报闭环覆盖率。｜roadmapRef：A1｜证据：packages/shared/src/learning.ts:22-31；packages/shared/src/learning.ts:122-143；prisma/schema.prisma:757-758；apps/api/src/study/study.controller.ts:583-601
- **D6 难度数据（B）** gap：难度校准机制（正确率/IRT 回写）缺失。｜roadmapRef：—｜证据：prisma/schema.prisma:35-39；apps/api/src/study/practice-record.repository.ts:238-242；apps/api/src/agent/adaptive-difficulty.ts:1-14
- **D7 时间行为（B）** gap：超时字段与修改轨迹缺失。｜roadmapRef：—｜证据：prisma/schema.prisma:610-611；prisma/schema.prisma:356；packages/shared/src/learning.ts:58-60
- **D8 大题得分（B）** gap：分项得分的结构化入库 + maxScore/rubric 内容回填（内容轨，Phase 0 已在排）。｜roadmapRef：R0.2｜证据：prisma/schema.prisma:416-422；apps/api/src/study/study.service.ts:3373-3403；apps/api/src/study/large-question.service.ts:49-50；prisma/schema.prisma:1190-1228
- **D9 Review 数据（A）** gap：—｜roadmapRef：—｜证据：prisma/schema.prisma:778-802；apps/api/src/study/review-schedule.repository.ts:126-175
- **D10 模考数据（B）** gap：分科/分题得分的持久化与 150 分制口径。｜roadmapRef：—｜证据：prisma/schema.prisma:840-852；prisma/schema.prisma:820-838；apps/api/src/study/study.service.ts:4758-4781
- **D11 状态历史（B）** gap：stability/retention 历史与日内版本化。｜roadmapRef：—｜证据：prisma/schema.prisma:1040-1056；apps/api/src/score-center/repository.ts:222-249；apps/api/src/effectiveness/effectiveness.service.ts:424-427
- **D12 干预记录（A）** gap：—｜roadmapRef：—｜证据：prisma/schema.prisma:225-251；prisma/schema.prisma:212-223；apps/api/src/study/canonical-event-writer.service.ts:5-67；apps/api/src/study/learning-evidence.service.ts:1-40

### L2 诊断 Diagnosis（权重 0.25，层分 0.55，等级 B）

> 核心问题：系统知道学生为什么丢分吗？能否定位到知识/题型/能力/错因

| # | 审计项 | 优先级 | 等级 | 评级依据（摘要） |
|---|---|:---:|:---:|---|
| G1 | 知识掌握诊断 | P0 | A | 节点粒度 EMA（PRIMARY α=0.18/SECONDARY α=0.07，target 随对错+难度）+ recentAccuracy 独立 EMA + confidence=1−exp(−(n+1)/12) + 乐观锁重试；练习与复习观察双输入路径（复习观察经 applyReviewObservation，开关控制）；mastery-calibration 影子在持续对照 EMA vs 真实正确率。 |
| G2 | 遗忘诊断 | P0 | B | FSRS 预测器（reviewPriority=1−R）、decay-defense selector（峰值≥0.7 且 14 天跌≥0.15）、review-shadow（7/14 天窗观测保持率，n<30 拦截）三件全建；但三者均未接入任何生产决策——legacy applyReview 把 retention 无条件写 1，生产 forgetting 分量实际失效，FSRS 权重 UNTRAINED。 |
| G3 | 错因诊断 | P0 | B | 8 类错因枚举、规则推断覆盖 6 类（行为代理：时长/置信/提示/未作答），另有复习自报；但公式记错/计算错误在规则中不可达，粗心/迁移失败/遗忘无对应类，识别的是行为特征而非失分认知原因，且从未被标注数据验证。 |
| G4 | 题型能力诊断 | P0 | D | 全仓不存在按题型分组的掌握度/正确率诊断（grep 无命中）；exam-diagnosis 粒度是科目+节点，transfer-probe 的题型匹配只用于选题约束。『会知识点但不会该题型』无从判断。 |
| G5 | 迁移能力诊断 | P0 | B | buildTransferProjection 按 node×kind×bucket×isomorphism 分层永不合并，n≥5 门禁 + sampleConfidence，代码完备且有 14 步集成验证；但生产 TRANSFER_PROBE_ENABLED=false（compose.production.yml:86）、探针池 0 题 → 生产样本 0；且测的是练习→探针的水平差（TransferGap），非基础→变式→真题的梯度断层。 |
| G6 | 大题能力诊断 | P0 | B | selfScore 单一总分 + 0.6 阈值二值化（丢掉丢分点信息）；F4 V1 rubric 路径有逐采分点分项（awarded/matched/criticalMiss，rubricVersion+hash 入证据），但 basis=offline_keyword_match、authoritative:false、未进训练流、采分点无标准化四分类，内容=0。 |
| G7 | 低级错误诊断 | P1 | B | 可规则推断的低级错误仅审题错误（过快代理）与时间不足（未作答代理）两类；计算错误在枚举中但规则永不可达，粗心/符号无类别；G1.6 七类检测器聚合的是练习行为模式而非失分性质。 |
| G8 | 前置知识诊断 | P1 | B | 前置边被推荐主链消费：弱前置（mastery<0.45）触发候选替换 + PREREQUISITE_GAP 推断码（inferred 档可见）；但不存在 prerequisite failure 的诊断记录/回路（『节点 X 反复失败归因于前置 Y』无输出），边稀疏（33 前置/21 关联）。 |
| G9 | 跨题模式诊断 | P0 | C | 存在跨题计数聚合（countReasons 全历史计数、wrongStreakRatio 节点级全历史错误比、G1.6 的 14 天窗口行为检测器），但不存在『时间窗 × 错误类型/题型 → 技能缺口』的错误模式聚合器——错误类型维度的窗口化聚合与模式→缺口推断均缺失。 |
| G10 | 置信度 | P1 | B | confidence/insufficient_data 语义覆盖面广且纪律统一（迁移/复习影子/掌握校准/掌握度本体/结果追踪），缺失≠0 全系统一致；盲区：classifyMistake 输出无置信、exam-diagnosis 的 nodeLoss/perSubject 无样本量标注、学习信号无置信字段。 |
| G11 | 诊断准确性 | P0 | B | 影子自校准在线（mastery-calibration：EMA vs 30 天实测正确率，±15pt 方向建议，只读；review-shadow：调度保持率实测）；但 labeled benchmark/专家标注验证集不存在，FSRS 权重自标 UNTRAINED，classifyMistake/nodeLoss 归因/rubric 评分均无与真实结果的对照验证。 |

证据引用与差距（gap = 距 A 档的缺口；roadmapRef = 路线图 `docs/audit/v13-p0-closed-loop-roadmap.md` 中的工作项）：
- **G1 知识掌握诊断（A）** gap：校准影子的生产样本薄（属 G11 范畴）。｜roadmapRef：—｜证据：packages/shared/src/score-center/mastery.ts:3-73；apps/api/src/score-center/service.ts:134-170；apps/api/src/score-center/service.ts:233-296
- **G2 遗忘诊断（B）** gap：遗忘信号接入决策链 + retention 写实。｜roadmapRef：B3｜证据：packages/shared/src/score-center/fsrs-scheduler.ts:43-46；packages/shared/src/score-center/decay-defense.selector.ts:43-80；packages/shared/src/score-center/review-shadow.ts:63-73；apps/api/src/score-center/service.ts:191-196
- **G3 错因诊断（B）** gap：内容级错因触达 + taxonomy 补全 + 稳定性验证。｜roadmapRef：A1｜证据：packages/shared/src/learning.ts:122-143；packages/shared/src/domain.ts:12-20
- **G4 题型能力诊断（D）** gap：题型维度诊断整体缺失，前置依赖题型子类型数据（D4）。｜roadmapRef：D2｜证据：apps/api/src/study/exam-diagnosis.ts:42-49；apps/api/src/transfer-probe/transfer-probe.service.ts:489-511
- **G5 迁移能力诊断（B）** gap：生产开启 + 池题内容（C1）+ 梯度化断层设计。｜roadmapRef：C1｜证据：packages/shared/src/transfer-probe/transfer-probe.ts:228-288；apps/api/src/transfer-probe/transfer-probe.service.ts:573-696；compose.production.yml:86
- **G6 大题能力诊断（B）** gap：rubric 内容批次 + 维度标准化 + 人工复核链。｜roadmapRef：B2｜证据：packages/shared/src/learning.ts:338-399；packages/shared/src/score-center/large-question-rubric.ts:144-208；apps/api/src/study/large-question.service.ts:104-173
- **G7 低级错误诊断（B）** gap：非知识性失分的分类与识别机制。｜roadmapRef：A1｜证据：packages/shared/src/learning.ts:131-143；apps/api/src/study/practice-pattern.service.ts:70-219
- **G8 前置知识诊断（B）** gap：前置失败追踪诊断输出 + 关系数据补录。｜roadmapRef：—｜证据：apps/api/src/study/recommendation.service.ts:171-218；packages/shared/src/score-center/plan.ts:101-113；apps/api/src/study/admin-data-quality.ts:99
- **G9 跨题模式诊断（C）** gap：Error Pattern Engine（A2 的核心交付）。｜roadmapRef：A2｜证据：apps/api/src/adaptive/learning-signals.ts:149-165；packages/shared/src/learning.ts:319-332；packages/shared/src/guidance/behavior-signals.ts:273-295
- **G10 置信度（B）** gap：错因诊断与节点失分归因的置信标注。｜roadmapRef：A2｜证据：packages/shared/src/score-center/mastery.ts:44；packages/shared/src/transfer-probe/transfer-probe.ts:257-280；packages/shared/src/score-center/review-shadow.ts:55
- **G11 诊断准确性（B）** gap：标注基准与预注册准确率门禁。｜roadmapRef：D1｜证据：apps/api/src/study/learning-impact.service.ts:40-103；packages/shared/src/score-center/mastery-calibration.ts:73-78；packages/shared/src/score-center/fsrs-scheduler.ts:27-31

### L3 决策 Decision（权重 0.25，层分 0.525，等级 B）

> 核心问题：系统知道下一步最应该练什么吗？推荐是否因人而异且可解释

| # | 审计项 | 优先级 | 等级 | 评级依据（摘要） |
|---|---|:---:|:---:|---|
| R1 | 下一任务选择 | P0 | B | 六因子加权（examValue 0.37/weakness 0.32/forgetting 0.16/difficulty 0.07/trend 0.05/pinned 0.03）+ 考期三档阶段乘数，可手工复算；学生侧输入（mastery/recentAccuracy/wrongCount/retention/pinned）约占一半权重。缺：题型因子、错因标签因子、targetScore 因子（goal 只用于 stage）。 |
| R2 | 优先级计算 | P0 | B | 理由链诚实且分层：reason 附 basis+statement，学生只见 EVIDENCED_REASON 四种，无证据显式『证据不足』文案，INFERRED/CONTEXTUAL 分区展示；『为什么是现在』的时机性理由仅 REVIEW_DUE 一项支撑（EXAM_NEAR 是上下文事实不进主 WHY）。 |
| R3 | 个体化 | P0 | B | 结构上个体化成立（排序输入全部按 userId 加载，学生自身数据约半权重，不同 mastery 分布必产生不同草稿）；但测试套件只覆盖同输入确定性与 legacy parity，无『学生A/学生B → 路径分叉』回归测试——个体化是被实现的属性而非被验证的属性。 |
| R4 | 训练策略选择 | P0 | B | 动作维度存在（classifyAction 五种：WRONG_QUESTION/REVIEW/LEARN/PRACTICE/MOCK，阈值触发）+ QUESTION_SET 三档 + exam_aligned 只读重排；agent 层有考前加成/复习债优先但 examDaysRemaining 传 null 未启用。无变式/限时策略选择器，无显式策略决策器。 |
| R5 | 难度调节 | P0 | C | 主推荐路径无难度自适应：difficulty 只以 0.07 静态权重进排序，recommendation.service.ts 的 clampDifficulty 定义后未被调用（死代码）；仅 agent 侧有 reduce/maintain/challenge 规则且调整的是学习负载/预算档而非题目难度。 |
| R6 | 间隔策略 | P0 | B | 生产调度=固定 1/3/7/14 阶梯 + 连对推进 + slowReview 降档（个体化仅两维）；FSRS reviewPriority/建议间隔完整实现但只驱动影子与测试，不影响任何生产 nextReviewAt；retention 被写死 1 使遗忘风险个体化失效。 |
| R7 | 前置知识决策 | P1 | A | 前置失败不是提示而是路径替换：resolve() 在前置 mastery<0.45 时用前置节点替换当前候选，PREREQUISITE_GAP 进 machine-readable reasonCodes；覆盖面受关系边稀疏限制（33 前置边），但机制本身完整。 |
| R8 | 大题策略 | P0 | C | 考后能按节点归因生成复盘任务（3 天复盘/专项/限时），但那是知识点级；rubric 采分点维度不进推荐引擎，不存在『大题丢分维度→对应训练题型』的映射链路。 |
| R9 | 推荐反馈 | P0 | B | outcome-tracking 已上线（±14 天同节点对照，verdict improved/no_change/insufficient_data，<3 次不给结论）+ action 级 SUCCESS/PARTIAL/FAILED 信号 + 曝光漏斗；但 verdict 不回流：runRecommendationForUser 的输入不含任何 outcome 判断，『推荐无效』不改变下一次推荐。 |
| R10 | 策略自适应 | P0 | D | 无策略切换机制：weekly-adjustment 只调强度（1.2/0.8）且仅作用于 onboarding 七日计划；effectiveness 的策略提案 requiresApproval:true 是建议系统；全库无『连续 N 轮无提升→换策略』计数或臂切换写回。 |
| R11 | 目标约束 | P1 | B | 时间约束全链路落地（唯一 resolver、阶段乘数、≤45 天 MOCK 触发、>150 天 LEARN 上限、scoreAtStake 影子 0.28 权重置信门控）；targetScore 完全不进排序（只用于文案与计划默认 115）。 |
| R12 | 时间预算 | P1 | B | minutes 预算实现完整且诚实（15→5 题/30→10 题只缩不放、容量档向上对齐、≥60 分钟才有科目多样性保护）；但差异是同一排序下的截断，非『15 分钟→快测/120 分钟→深度』的形态级差异，预算需调用方显式传入。 |

证据引用与差距（gap = 距 A 档的缺口；roadmapRef = 路线图 `docs/audit/v13-p0-closed-loop-roadmap.md` 中的工作项）：
- **R1 下一任务选择（B）** gap：题型/错因/目标分进入排序输入。｜roadmapRef：A2｜证据：packages/shared/src/score-center/priority.ts:12-104；apps/api/src/study/recommendation.service.ts:147-235
- **R2 优先级计算（B）** gap：时机性理由（考期×遗忘风险×预算的联合解释）。｜roadmapRef：—｜证据：packages/shared/src/score-center/priority.ts:115-166；packages/shared/src/score-center/reason-integrity.ts:205-227；apps/api/src/study/recommendation.service.ts:54-64
- **R3 个体化（B）** gap：双学生分叉回归测试。｜roadmapRef：—｜证据：apps/api/src/study/recommendation.service.ts:147-156；test/recommendation-core.test.js；test/recommendation-daily-plan-parity.test.js:52-53
- **R4 训练策略选择（B）** gap：学习/回忆/变式/真题/限时的显式策略选择。｜roadmapRef：B1｜证据：packages/shared/src/score-center/plan.ts:36-43；packages/shared/src/score-center/recommendation.ts:187-203；apps/api/src/agent/daily-planning.service.ts:146
- **R5 难度调节（C）** gap：表现驱动的题目难度升降（Phase B1 处方层）。｜roadmapRef：B1｜证据：apps/api/src/agent/adaptive-difficulty.ts:46-72；apps/api/src/study/recommendation.service.ts:106-108；packages/shared/src/score-center/plan.ts:45-51
- **R6 间隔策略（B）** gap：recall risk 驱动调度（影子验证后切换，需 Owner）。｜roadmapRef：B3｜证据：packages/shared/src/learning.ts:489-501；apps/api/src/study/study.service.ts:2358-2361；packages/shared/src/score-center/fsrs-scheduler.ts:139-154
- **R7 前置知识决策（A）** gap：关系数据补录扩大覆盖（内容轨）。｜roadmapRef：—｜证据：packages/shared/src/score-center/plan.ts:101-113；apps/api/src/study/recommendation.service.ts:171-218
- **R8 大题策略（C）** gap：rubric 维度→训练处方映射（B2）+ 大题内容批次。｜roadmapRef：B2｜证据：apps/api/src/study/study.service.ts:5036-5119；apps/api/src/study/large-question.service.ts:1-30
- **R9 推荐反馈（B）** gap：outcome→排序参数写回（B3，人在环）。｜roadmapRef：B3｜证据：packages/shared/src/score-center/outcome-tracking.ts:70-175；apps/api/src/study/daily-brief.controller.ts:453-466；apps/api/src/study/action-learning-signal.service.ts
- **R10 策略自适应（D）** gap：策略自适应闭环（B3 核心交付，需 Owner 批准写回语义）。｜roadmapRef：B3｜证据：apps/api/src/study/weekly-adjustment.ts:33-76；apps/api/src/effectiveness/learning-effectiveness.ts:123-142
- **R11 目标约束（B）** gap：targetScore/scoreAtStake 并入主排序（S3/ROI 方向，Owner 锁定）。｜roadmapRef：—｜证据：packages/shared/src/score-center/exam-timeline.ts:63-97；packages/shared/src/score-center/priority.ts:32-36；packages/shared/src/score-center/score-opportunity.ts:106-160
- **R12 时间预算（B）** gap：预算→路径形态（策略维度，归 B1 处方层）。｜roadmapRef：B1｜证据：apps/api/src/study/quick-session.ts:11-30；apps/api/src/study/study.service.ts:2830-2832；packages/shared/src/score-center/plan.ts:125-132

### L4 训练 Training（权重 0.25，层分 0.5708，等级 B）

> 核心问题：推荐之后真的能让学生变强吗？是否形成刻意训练闭环

| # | 审计项 | 优先级 | 等级 | 评级依据（摘要） |
|---|---|:---:|:---:|---|
| T1 | 诊断→训练闭环 | P0 | B | 薄弱节点→任务、遗忘→REVIEW 是真实任务生成闭环（阈值触发+持久化）；错因诊断只产出文案建议与导师话术（MISTAKE_SUGGESTIONS 八类文本、Socratic 提问），没有任何『错因→训练任务/练习组』生成器；考后任务是知识点级不按错因分型。 |
| T2 | 刻意训练 | P0 | C | 无可执行、可判定的微技能训练模块（全仓无 drill/微技能模块）；最接近的是 Socratic 追问链与错因检查清单，但均为提示物/资源卡，不是针对能力缺陷的刻意训练。 |
| T3 | 分层训练 | P0 | B | 错题详情显式四层（original/variants 同考点/confusingConcepts 同章异点/comprehensive 综合题+困难）+ exam_aligned 真题层排序；但主练习路径选题无难度序列，分层考卷生成器 adaptive-exam.ts（四模式难度配比+波浪排序）已写全仓无调用（未接线）。 |
| T4 | 即时纠错 | P0 | B | 反馈链完整（学习模式逐题即时判题→正误+答案+核心考点+解析+错因建议同屏）且有变式复测路径（答错推进原错题 schedule）；但『错误后立即同能力再测』是可选入口而非机制强制，会话内无自动再注入。 |
| T5 | 错题再练 | P0 | B | 双入口：原题重做（判题结果作 redoCorrect 上报，非纯自报）+ 变式复测（applyVariantRetest 真实推进/重置原错题连对与 schedule，答错清零连对）；但变式=同知识点匹配的近似，非同族（QuestionFamily）保证，重做默认原题有答案记忆风险。 |
| T6 | 变式训练 | P0 | B | 同一能力不同题面验证以知识点标签近似实现（findSimilarQuestions 同考点、reviewLayers.variants）；QuestionFamily 在普通训练路径零使用（仅导入版本管理与探针零同族排除），AI 变式题 confirm 时创建新 family 与源题无族关联，同构性无保证。 |
| T7 | 回忆训练 | P1 | B | 复习是重做原题并服务端判题（主动回忆而非看解析），有错因自评环节；但回忆对象固定为原题（答案记忆风险靠变式缓解），无遮盖答案/提示递减/自由回忆等回忆训练形态。 |
| T8 | 间隔复习 | P0 | B | 固定阶梯 + 表现微调（连对推进、slowReview 降档）+ 影子 FSRS；复习间隔不由个体遗忘风险驱动（retention 写实缺失），影子对照已达 n<30 门禁但未到切换。 |
| T9 | 大题训练 | P0 | B | selfScore 自评主管线（0.6 阈值）+ F4 V1 rubric 后端（离线关键词评分、逐采分点入证据、显式不写掌握度）；前端零 rubric 调用（训练流仍走自评），rubric 内容=0（v12-m6 设计自认被教研内容批次阻塞）。 |
| T10 | 限时训练 | P1 | B | 模考有倒计时+超时标记（elapsed→remainingSec/isOvertime badge）；超时不强制收卷（无 autoSubmit），练习无 timed 模式（quick-session 只有题量缩放，LearningSession 无 deadline 字段，计时纯前端），限时信号只进建议文案。 |
| T11 | 迁移训练 | P0 | B | 探针=训练后新题验证：任务完成触发排程（36h 下限/日上限 3/14 天间距），投递经 canonical 提交路径回流掌握（测量与 mastery 边界分离）；但生产 OFF、池题 0、探针结果 terminal 不回流策略（§21 显式声明），过期只 EXPIRED 不计失败。 |
| T12 | 训练闭环 | P0 | B | 练习→掌握→次日计划的基本闭环真实运转；断点：任务完成本身零能力更新（evidence 是事后只读投影）、探针结果不入 ranking、错因不改变任务处方、次日计划生成要求今日任务全量完成（天粒度粗）。 |

证据引用与差距（gap = 距 A 档的缺口；roadmapRef = 路线图 `docs/audit/v13-p0-closed-loop-roadmap.md` 中的工作项）：
- **T1 诊断→训练闭环（B）** gap：错因→训练处方（A2 诊断输出 + B1 处方输入）。｜roadmapRef：A2｜证据：packages/shared/src/score-center/plan.ts:36-43；apps/api/src/study/study.service.ts:5036-5119；packages/shared/src/learning.ts:33-42
- **T2 刻意训练（C）** gap：微技能训练模块 + 训练目标生成（B1 核心交付）。｜roadmapRef：B1｜证据：apps/api/src/study/study.service.ts:2960-3000；apps/api/src/agent/tutor-mode.ts:22-100
- **T3 分层训练（B）** gap：主路径难度序列 + 接线已建分层生成器。｜roadmapRef：B1｜证据：apps/api/src/study/study.service.ts:2628-2665；apps/api/src/adaptive/adaptive-exam.ts:44-110；apps/api/src/study/study.service.ts:2863-2873
- **T4 即时纠错（B）** gap：错误后的机制性再验证。｜roadmapRef：—｜证据：apps/web/src/components/ExamSession.tsx:195-227；apps/web/src/components/ExamSession.tsx:448-465；apps/api/src/study/study.service.ts:3410-3470
- **T5 错题再练（B）** gap：同族变式保证（T6 同源问题）。｜roadmapRef：B1｜证据：apps/web/src/features/student/actions/adapters/reviewActionAdapter.ts:32-45；apps/api/src/study/study.service.ts:3157-3158；apps/api/src/study/study.service.ts:3444-3469
- **T6 变式训练（B）** gap：变式族语义进入普通训练路径。｜roadmapRef：B1｜证据：apps/api/src/study/study.service.ts:4132-4145；apps/api/src/transfer-probe/transfer-probe.service.ts:450-465；apps/api/src/questions/ai-variant.service.ts:33-87
- **T7 回忆训练（B）** gap：回忆训练形态多样化。｜roadmapRef：—｜证据：apps/web/src/features/student/actions/adapters/reviewActionAdapter.ts:19-29；prisma/schema.prisma:778-801
- **T8 间隔复习（B）** gap：recall risk 驱动的个体化间隔。｜roadmapRef：B3｜证据：packages/shared/src/learning.ts:489-501；apps/api/src/study/review-shadow.service.ts:1-40
- **T9 大题训练（B）** gap：rubric 内容批次 + 前端训练流接入。｜roadmapRef：B2｜证据：apps/api/src/study/large-question.controller.ts:24-31；packages/shared/src/score-center/large-question-rubric.ts:144-189；docs/v12-m6-f4-large-question-design.md:4
- **T10 限时训练（B）** gap：限时训练模式（练习级时限+强制收卷）。｜roadmapRef：B1｜证据：apps/web/src/components/ExamSession.tsx:69-79；apps/web/src/components/ExamSession.tsx:318-322；apps/api/src/study/quick-session.ts:28-38
- **T11 迁移训练（B）** gap：生产开启（C1 内容）+ 探针结果→策略回流。｜roadmapRef：C1｜证据：apps/api/src/transfer-probe/transfer-probe.service.ts:116-209；apps/api/src/transfer-probe/transfer-probe.service.ts:336-401；apps/api/src/study/study.service.ts:4808-4813
- **T12 训练闭环（B）** gap：三处断点收口（分别对应 B1/B3/A2）。｜roadmapRef：B3｜证据：apps/api/src/study/study.service.ts:3549-3567；apps/api/src/study/learning-loop-trigger.service.ts:47-70；apps/api/src/study/task-evidence.service.ts:1-60

### L5 验证 Validation（权重 0.1，层分 0.5083，等级 B）

> 核心问题：怎么证明学生真的提高了？是否有学习增益/真题/模考证据

| # | 审计项 | 优先级 | 等级 | 评级依据（摘要） |
|---|---|:---:|:---:|---|
| V1 | 前后测 | P0 | B | 存在干预前后的简单对照（task-evidence ±3 天窗口、outcome-tracking ±14 天窗口、探针 post-test），诚实门禁齐全；但无等价能力 pre/post-test 设计——全库无 pretest/posttest，入门诊断无配对复测，探针只有 post 无 pre 基线。 |
| V2 | 知识增益 | P0 | A | mastery 前后 Δ 可量化且口径诚实：UserMasterySnapshot 前后界选取，无 before 快照则 gain=null 不编造；/effectiveness/outcomes 与 /coach/task-evidence 端点齐备，报告页有消费；生产冒烟 4 节点 1 过门 3 诚实拦截（结构在、样本薄如实呈现）。 |
| V3 | 题型增益 | P0 | D | 全库无按题型的增益聚合（grep byType/typeAccuracy 零命中）；ScoreLossItem 是逐题×节点粒度，exam-diagnosis 按节点归因。前置依赖题型子类型数据（D4）。 |
| V4 | 迁移增益 | P0 | B | 探针结构完备（新题/隔离计划/独立 session/分层投影），测的是『同节点新题 vs 日常练习』的水平差；无干预前基线探针（增益无从对照），生产 OFF、池题 0、样本 0。 |
| V5 | 大题增益 | P0 | B | 单次 rubric 采分点评分入证据台账（含每条 criteria awarded/matched）+ selfScore 管线；无『同一学生采分点命中率随时间提升』的趋势度量，Question.maxScore/rubric 内容=0 整链路数据为零。 |
| V6 | 遗忘控制 | P0 | B | review-shadow 测当前调度算法的实测保持率（7/14 天窗、间隔分桶、missing≠遗忘、n<30 拦截）；FSRS 对照侧未接线（文件头自认『将来输出同形状结果』），『相同间隔下 recall rate 提升』的比较结构不存在。 |
| V7 | 模考增益 | P0 | B | 真实模考正确率趋势存在（score-history，仅 paper session 事实）；估算分 vs 真实分对照=score-calibration 代码完整（Ledger 优先、provenance 分层、legacy 回退），但生产预测-成绩配对=0、E1 未执行，一切输出停留在 insufficient_data。 |
| V8 | 学习效率 | P0 | D | 无 gain/hour 指标：effectiveness 的 practiceEfficiency 唯一赋值处恒为 null；观测型时间数据存在（totalActiveMs/minutesSpent）但没有任何代码把它除进增益；score-opportunity 的单位时间收益是估算非观测。 |
| V9 | 推荐效果 | P0 | C | 确定性 A/B 分流器存在（sha256 无持久化）但无任何 feature 按 arm 分叉——只有标签没有实验；experiments 端点是观察性队列（注释自认 NOT a controlled experiment）；曝光漏斗是漏斗非效果对照。无『推荐组 vs 基线』的对照实验运行。 |
| V10 | 策略效果 | P0 | C | 离线四策略比较器存在（weakness_first/exam_frequency_first/balanced/adaptive 纯函数 + 证据门禁四检查）但 api src 内无生产调用方；策略优化器 proposal-only（requiresApproval:true 永不改生产）；无任何两种训练策略的真实效果比较数据。 |
| V11 | 长期趋势 | P0 | A | mastery-trend 支持 1-90 天窗口（快照按日序列）+ score-history 真实模考序列 + progress-narrative 周环比叙事（|Δ|<1=flat，快照不足=no_data）；数据层 7/14/30 天趋势可解释，学生侧解释叙事只有周环比一档。 |
| V12 | 分数预测 | P1 | B | 预测有显式公式+置信区间+『仅为估算』免责；校准机器完整（三概念结构分离、量纲强制、预注册 E1 门禁 n≥5 且 median<15）；但 recordPrediction 只有手工端点无产品流自动写、E1 未执行、生产配对 0——预测准确度从未被验证。 |

证据引用与差距（gap = 距 A 档的缺口；roadmapRef = 路线图 `docs/audit/v13-p0-closed-loop-roadmap.md` 中的工作项）：
- **V1 前后测（B）** gap：等价能力前后测设计（C2 pre-probe 是最接近的实现路径）。｜roadmapRef：C2｜证据：apps/api/src/study/task-evidence.service.ts:15-94；apps/api/src/study/learning-impact.service.ts:106-185
- **V2 知识增益（A）** gap：—｜roadmapRef：—｜证据：apps/api/src/effectiveness/outcome-pipeline.ts:46-80；apps/api/src/effectiveness/effectiveness.service.ts:395-446；prisma/schema.prisma:1040-1057
- **V3 题型增益（D）** gap：题型维度度量整体缺失。｜roadmapRef：D2｜证据：apps/api/src/score-anchor/score-loss.service.ts:214-263；apps/api/src/study/exam-diagnosis.service.ts
- **V4 迁移增益（B）** gap：pre-probe 基线（C2）+ 生产样本（C1）。｜roadmapRef：C2｜证据：apps/api/src/transfer-probe/transfer-probe.service.ts:666-695；packages/shared/src/transfer-probe/transfer-probe.ts:40-41
- **V5 大题增益（B）** gap：rubric 内容回填 + 命中率趋势度量。｜roadmapRef：B2｜证据：apps/api/src/study/large-question.service.ts:104-173；apps/api/src/score-anchor/score-loss.service.ts:100-126
- **V6 遗忘控制（B）** gap：算法间/前后对照侧接线。｜roadmapRef：B3｜证据：packages/shared/src/score-center/review-shadow.ts:119-165；apps/api/src/study/review-shadow.service.ts:27-75
- **V7 模考增益（B）** gap：E1 校准实验执行（D1）+ 真实样本积累。｜roadmapRef：D1｜证据：apps/api/src/study/exam-score-history.projection.service.ts:31-57；apps/api/src/study/score-calibration.service.ts:107-308；packages/shared/src/score-center/score-calibration.ts:60
- **V8 学习效率（D）** gap：观测时间÷增益的指标定义与产出（D3）。｜roadmapRef：D3｜证据：apps/api/src/effectiveness/effectiveness.service.ts:461-473；packages/shared/src/score-center/score-opportunity.ts:25-26
- **V9 推荐效果（C）** gap：按 arm 分叉的功能 + 预注册实验定义（D4，需 Owner 批准生产行为）。｜roadmapRef：D4｜证据：apps/api/src/study/coach-experiments.ts:15-22；apps/api/src/effectiveness/effectiveness.service.ts:302-379；apps/api/src/study/daily-brief.controller.ts:127-139
- **V10 策略效果（C）** gap：策略比较接线生产或离线回放研究（D4）。｜roadmapRef：D4｜证据：apps/api/src/effectiveness/outcome-pipeline.ts:84-142；apps/api/src/effectiveness/learning-effectiveness.ts:123-142
- **V11 长期趋势（A）** gap：学生侧 30 天级叙事（非阻塞）。｜roadmapRef：D5｜证据：apps/api/src/score-center/service.ts:544-578；apps/api/src/study/progress-narrative.ts:40-73
- **V12 分数预测（B）** gap：E1 执行后校准置信升级（D1）。｜roadmapRef：D1｜证据：packages/shared/src/learning.ts:751-779；packages/shared/src/score-center/score-calibration.ts:37-60；apps/api/src/score-anchor/score-anchor.service.ts:140-193

## 3. 判定规则（与 rubric 一致）

- 项分：A=1.0 / B=0.6 / C=0.25 / D=0；层分 = 项分均值；层等级 = 距 anchor 最近者（等距向下取，保守）。
- V13 总分 = Σ(层权重 × 层分) = 0.15×0.6375 + 0.25×0.55 + 0.25×0.525 + 0.25×0.5708 + 0.1×0.5083 = 0.5579。
- 提分闭环 = 诊断→决策→训练→验证四层链路：层门禁（每层 ≥ B）与 P0 门禁（闭环层内任意 P0 项 < B 即 FAIL）须同时满足。
- 诚实规则：『代码存在但生产样本=0/开关 OFF』按 B 上限评；证据不足按低档评；本报告不构成任何 Verified Score Gain 声明（RULE-11）。
