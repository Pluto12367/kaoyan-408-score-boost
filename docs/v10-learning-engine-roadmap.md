# V10 Learning Engine Upgrade — Implementation Roadmap

> 状态：Phase 0 Repository Audit 完成 + 本 Roadmap 待所有者 Review（通过后进入 Feature 1 实施）。
> 日期：2026-09-07。
> 纪律：非破坏性原则（§0）全程适用；所有 Feature 走 Phase 0→5 门禁；每个 Feature 完成输出 Completion Report。
>
> **命名说明**：仓库中 V10 编号已被「AI Learning Sprite」（已完成并部署生产）占用。本 Mission 按接管指令命名 **V10 Learning Engine Upgrade**，账本中以「Learning Engine Upgrade（LE 线）」区分；若所有者希望改编号为 V11，本文档与账本同步调整，文件路径按指令保持不变。

---

## Phase 0 Repository Audit 摘要（本 Roadmap 的事实依据）

| 审计项 | 事实（以代码为准） | 对 Feature 的意义 |
|---|---|---|
| 考频数据 | `KnowledgeFrequencySnapshot`：`recent3Frequency / recent5Frequency / allTimeEvidence / primaryScore5y / trendDirection / trendDelta / evidenceConfidence`（1149 条已播种） | F1 无需新建频率表——**数据已齐且超预期** |
| 推荐引擎频率契约 | `packages/shared/src/score-center/types.ts` 已含 `recent3Y/recent5Y/allTime frequency` 输入与 `HIGH_RECENT_FREQUENCY` 优先级理由码 | F1 = 接线 + 展示层，引擎算法面基本就位 |
| 真题映射 | `ExamPaper`（5 套，totalScore）→ `ExamQuestion`（235 题，subject/questionType/score）→ `ExamQuestionKnowledgeTag`（756 条原子标签，含 role/confidence/precision） | F1/F2 的真题对标与失分归因有精确节点级映射 |
| 考试报告现状 | `getExamReport`（study.service.ts:4658）：**已有**主观题 selfScore/maxScore 处理、**已有**分科统计（subjectStats：答题数/正确数/用时） | F2 是诊断深化（150 分制标准化/差距分解/节点失分），非从零建 |
| 考后恢复 | `generatePostExamReviewTasks`（考后复习任务管线）+ `ExamReviewPlan` 表已存在 | F2 的"自动生成恢复计划"复用此链 |
| 目标差距 | `StudentContext.exam.targetScore/currentScore` + V8 `resolveScoreGapView`（displayFormat.ts，已修假达成） | F2 差距分析直接复用 |
| 复习基线算法 | `updateStabilityAfterReview`（shared/mastery.ts:58）：`stability × STABILITY_MULTIPLIERS[quality]`（SM-2 近亲）；`ReviewAttempt.nextIntervalDays` **每次复习已落库** | F3 影子实验的旧算法侧数据在持续积累 |
| 掌握度快照 | `UserMasterySnapshot`：每日 (user,node) mastery/attempts 快照 | F3 遗忘防线的衰减检测源；F1 提升空间估算源 |
| 大题主观判分 | `Question.type='综合题'`；selfScore/maxScore 全链路（提交校验:3200、报告聚合:4678+）已存在 | F4 Rubric 是自评的**结构化升级**，判分管线不动 |
| 错题字段 | `WrongQuestionReview.note / selfReportedReason`（自报告原因）已存在 | F5 自我解释可复用 note 字段，零迁移 |
| 练习预算 | `GET /practice-sets/recommended?minutes=`（15/30/60 档）已存在 | F5 Mixed Practice 作为该端点的 mode 增量 |
| 复习写路径红线 | ReviewSchedule (userId,questionId) 唯一、由错题驱动；canonical writer = `ScoreCenterService.applyReview` | F3 保温复习**不得**写入 ReviewSchedule——走推荐层 |

---

## 0. 唯一评价标准（2026-09-07 所有者指令，最高约束）

**系统升级的唯一评价标准：是否帮助学生获得更多 408 考试分数。**

每个 Feature / 技术决策必须在设计文档中正面回答**四问门禁**：

| # | 问题 | 度量方向 |
|---|---|---|
| Q1 | 这个变化如何提高**学习效率**？ | 单位练习时间的分值密度（考频×缺口投放）、完成一题的摩擦成本 |
| Q2 | 这个变化如何提高**知识保持**？ | 已获得能力的流失拦截（保持率/衰减防线） |
| Q3 | 这个变化如何提高**大题得分**？ | 70 分大题主权的结构化训练与诊断 |
| Q4 | 这个变化如何提高**模考恢复效率**？ | 模考暴露缺口 → 恢复动作的转化速度与执行追踪 |

**门禁规则**：不能正面回答至少一问的变更，默认不做（纯后台清理/技术债类任务除外，须单独声明）。四问不必全中——但"中了哪问、如何度量"必须写进该 Feature 的 Acceptance Criteria。

### 四问 × 五 Feature 映射（既有规划与新标准的对齐审计）

| Feature | Q1 学习效率 | Q2 知识保持 | Q3 大题得分 | Q4 模考恢复 |
|---|---|---|---|---|
| F1 真题对标练习 | ✅ 核心（考频×缺口=分值密度投放） | 间接（高频优先=遗忘前加固） | 部分（大题考点同入对标） | 部分（模考暴露点进入练习排序） |
| F2 模考诊断增强 | 间接（归因即下一步投入） | 部分（失分节点回流复习） | ✅ 核心（大题失分归因，见 §F2 增强） | ✅ 核心（差距分解→自动恢复计划→**执行追踪**） |
| F3 遗忘防线+FSRS | 部分（保温复习省重学时间） | ✅ 核心（保持率是唯一指标） | 部分（大题考点同等防护） | — |
| F4 大题采分点训练 | 部分（采分点=大题的微粒度练习） | 部分（逐点画像定位弱环节） | ✅ 核心 | — |
| F5 交错练习+自我解释 | ✅ 核心（交错=保持率更高的练习组织） | ✅ 核心（交错与自我解释均为记忆科学保持手段） | 部分（大题陷阱自我解释） | — |

**新标准暴露的增量点（已并入对应 Feature）**：
- **F2 增强：恢复计划执行追踪**——恢复效率的瓶颈不止"生成计划"，而在"执行了没"。恢复任务天然是 StudyTask（既有管线），执行事实已在 `StudyTaskCompletion`——诊断视图须显示"上次模考暴露 N 个缺口，已修复 M 个"，让 Q4 从"生成"度量深化为"闭环"度量。（已写回 §Feature 2 技术方案。）
- **诚实地基声明**：四问的天花板是内容质量（解析准确度、采分点拆分、先修关系密度）——内容侧投入无法被任何架构替代，F4 内容生产批次是 Q3 的真实约束。

---

## 0.1 提分指标操作契约（2026-09-07 所有者指令，长期负责人执行版）

四问门禁细化为**六项提分指标**，每项绑定度量定义与数据源（所有指标从既有数据派生，零新事实源）：

| # | 指标 | 度量定义（口径） | 数据源 | 承载 Feature |
|---|---|---|---|---|
| M1 | 学习方向准确率 | 练习题中"考频≥3星 且 节点非已掌握"的占比 | examAlignment 投影（F1） | F1 |
| M2 | 高频考点覆盖率 | 学生近 14 天练习覆盖的 ★≥3 节点数 / 全目录 ★≥3 节点数 | examAlignment.summary + PracticeRecord | F1 |
| M3 | 知识保持率 | 复习后 7/14 日同源题正确率（双算法影子对比） | ReviewAttempt + 后续 PracticeRecord（F3） | F3 |
| M4 | 大题采分能力 | 逐采分点自评得分率（按点/按题型聚合） | rubric 遥测（F4） | F4 |
| M5 | 模考恢复效率 | 模考暴露缺口 → 恢复任务闭环率（exposed vs completed） | ExamDiagnosis + StudyTaskCompletion（F2） | F2 |
| M6 | 单位学习时间收益 | 每练习分钟的 mastery 增量（窗口化） | effectiveness 管线（既有） | 全局 |

**门禁规则更新**：新功能立项必须指明"主指标 + 次指标"；实施完成的 Acceptance 必须包含对应指标的度量埋点/查询落地（没有度量的功能视为未完成）。四问（效率/保持/大题/恢复）保留为定性审查框架，六指标为定量口径。

---

# 1. 项目目标

## 1.1 为什么现有系统需要升级

系统已完成「智能刷题工具」的完整闭环并稳定运行于生产。但从**提分结果**视角审计，闭环各环节存在"最后一公里"缺口——学生练了很多题，但闭环没有把「练的东西」最大化兑换成「考场上的分」：

```
诊断 ──→ 练习 ──→ 掌握 ──→ 推荐 ──→ 复习 ──→ 测评
  │        │        │        │        │        │
  ▼        ▼        ▼        ▼        ▼        ▼
缺口分析（按环节）
```

| 环节 | 现状 | 缺口（升级动机） |
|---|---|---|
| 诊断 | 初始诊断 + 掌握度地图完备 | 诊断结果未与**真题考频**对齐——学生不知道"我的薄弱"在真题里值多少分 |
| 练习 | 推荐引擎 + 时长预算 + 变式练习 | 练习与真题的**感知脱节**（"为什么练这道"不可见）；大题（70/150 分）无结构化训练；练习分科分块，缺交错 |
| 掌握 | EWMA + OCC + 每日快照，唯一写方 | 掌握度是"快照"不是"轨迹"——**正在衰减的已掌握知识无防线** |
| 推荐 | 纯函数引擎，reasonCodes 已有 | 频率信号在引擎契约里存在但未充分兑现为用户可读的**推荐理由**；无混合练习模式 |
| 复习 | 错题驱动的间隔复习（SM-2 近亲） | 只防"错过的题"，不防"忘掉的知识"；算法未与 SOTA（FSRS）对标验证 |
| 测评 | 模拟考 + 报告 + 分科统计 + 考后任务 | 报告是"成绩单"不是**诊断书**：无 150 分制标准化对标、无目标差距分解、无节点级失分归因 |

## 1.2 升级定义

从「智能刷题工具」升级为「围绕 408 提分结果优化的 AI 自适应学习系统」= 让闭环的每个环节都以**考试分数**为最终货币结算：练的每道题连回真题考频、每次模考输出可执行的归因、每条复习调度被保持率指标验证、大题训练补齐 70 分主权、练习组织方式符合记忆科学。

---

# 2. 五大 Feature 总规划

## Feature 1：真题对标练习模式

### 产品目标
解决「为什么现在练这道题？」的感知断裂。让学生看到每道推荐题与真题的量化关联，把练习从"系统安排"变成"真题指挥"。

### 用户价值
- 动机：练的题有真题背书，练习意愿与坚持度提升。
- 决策：薄弱点优先级由"考频 × 掌握度"排序，时间投放到分值密度最高的地方——直接影响分数效率。

### 当前已有能力复用
- **数据**：`KnowledgeFrequencySnapshot`（recent5Frequency/primaryScore5y/trendDirection，1149 条）；`ExamQuestionKnowledgeTag`（节点级真题映射）。
- **引擎**：`packages/shared/src/score-center` 优先级契约已含 `recent3Y/recent5Y frequency` 输入与 `HIGH_RECENT_FREQUENCY` 理由码；`reasonCodes/scoreBreakdown` 已随 StudyTask 下发。
- **API**：`GET /practice-sets/recommended`（含 minutes 预算档）。
- **前端**：任务行理由展示（V8 #11）、推荐依据面板（错题页最佳实践）。

### 技术方案
- **Backend**：①核对/接通 adapter 把 `KnowledgeFrequencySnapshot` 真实值灌入引擎 frequency 输入（若已接通则确认覆盖率与兜底）；②新增只读投影 `exam-aligned.selector.ts`：输入=推荐结果+考频+UserKnowledgeMastery，输出=每题的 `{ recent5Frequency, primaryScore5y, trendDirection, mastery, predictedGain }`；③端点增量：`GET /practice-sets/recommended?mode=exam_aligned`（同响应形状增量字段，向后兼容）。
- **Frontend**：练习卡片"真题对标"徽标 + 理由卡（示例见下）；会话结束页"本次覆盖真题考点 N 个"汇总。
- **Database**：**零迁移零新表**（纯读投影）。
- **Algorithm**：`predictedGain = primaryScore5y × (1 − mastery) × 折算系数`——诚实公式，标注"估算，随证据更新"（insufficient_data 贯穿：无频次数据的题不显示该行）。

> 推荐理由示例输出（用户指定格式）：
> **推荐原因**：该知识点近 5 年出现 6 次 · 你的当前掌握度 62% · 预测提升空间 8 分（估算）

### 风险
- 频次数据覆盖不全（1149/1296 节点）→ 无数据节点诚实隐藏徽标，不伪造。
- predictedGain 被误读为承诺 → 文案强制"估算"前缀 + 点击展开公式与依据。

### 预计 Sprint
2 个 Sprint（投影+接线 / 前端+验收）。

### 验收标准
1. `mode=exam_aligned` 返回的每题附频率/掌握度/提升空间，无数据字段为 null 且前端隐藏对应行。
2. 理由卡数字 100% 可溯源（frequency←快照，mastery←UserKnowledgeMastery，gain←公式展开可见）。
3. 全量 `npm test` 零新增失败；投影纯函数测试（含 insufficient 分支）全绿。

---

## Feature 2：全真模考诊断增强

### 产品目标
把模考报告从「成绩单」升级为「诊断书」：每次模考回答三个问题——差在哪科、丢在哪些知识点、怎么补。

### 用户价值
模考是备考中信息量最大的事件（全真压力下的真实暴露）。诊断深度直接决定模考价值兑现率：从"沮丧的分数"变成"可执行的差距清单 + 自动恢复计划"。

### 当前已有能力复用
- **已有**：`getExamReport` 分科统计（答题/正确/用时）与主观题聚合；`generatePostExamReviewTasks` + `ExamReviewPlan`（考后任务自动生成）；`StudentContext.exam.targetScore` + `resolveScoreGapView`（V8 诚实差距）；`ExamSession` 计时（timeLimitMin）；`mastery-trend`。
- **数据**：`Paper/ExamPaper`（totalScore）、`ExamQuestionKnowledgeTag`（失分归因到节点）、`AssessmentHistoryItem`（趋势）。

### 技术方案
- **Backend**：新增只读投影 `exam-diagnosis.ts`（纯函数）：输入=会话记录+题→节点映射+目标分，输出=`{ score150, timeUsage, perSubject: [...], nodeLoss: [{node, lostScore, freq}] , gapDecomposition: [{subject, gapToTarget}], recoveryPlanRef }`；端点 `GET /exam/diagnosis/:sessionId`（不改既有 getExamReport 响应形状）。
- **恢复计划执行追踪（§0 Q4 增强项）**：诊断视图聚合该次模考生成的恢复任务（StudyTask，既有管线）的 `StudyTaskCompletion` 执行事实，输出 `recoveryClosure: { exposedGaps, completedGaps, closureRate }`——把 Q4 从"生成了计划"度量深化为"缺口闭环率"度量；后续模考的诊断页自动对比上次暴露缺口的重考表现。
- **Frontend**：报告页新增"诊断"视图：150 分制仪表 + 分科雷达 + **节点失分热力列表**（失分×考频排序）+ 目标差距分解条 + "生成恢复计划"入口（调既有考后任务端点）+ **缺口闭环率卡**（"上次暴露 5 个缺口，已修复 3 个"）。
- **Database**：零迁移。
- **Algorithm**：失分归因 = 错题经 `ExamQuestionKnowledgeTag`/`QuestionKnowledgeNodeTag` 映射到节点，按 `primaryScore5y` 加权聚合并按考频排序；差距分解 = targetScore − 预测分（复用 currentScore 口径），逐科拆分；时间诊断 = 用时 vs 180min 预算的分科偏离。

### 风险
- 综合题自评分噪声 → 诊断页明示"含自评题，X 分来自自评"（诚实标注）。
- 与既有报告口径矛盾（V8 红线）→ 诊断视图与旧报告共用同一投影源，禁止第二套事实。

### 预计 Sprint
2 个 Sprint。

### 验收标准
1. 一次真实模考后：分科得分率、Top 失分节点（含考频）、目标差距分解、恢复计划链接全部正确且互相无矛盾。
2. 无目标分用户 → 差距区诚实显示"未设置目标"（不伪造基线）。
3. 全量测试零新增失败；诊断纯函数测试（含自评标注/缺目标分分支）全绿。

---

## Feature 3：遗忘防线 + FSRS Shadow Experiment

### 产品目标
双线：①**防线**——已掌握知识滑向遗忘时主动拦截（当前复习只覆盖错题）；②**对标**——用影子实验验证现有间隔算法 vs FSRS，用数据而非信仰决定是否升级。

### 用户价值
"复习了就忘"是备考第一大抱怨。保温复习防止 60 分的能力 quietly 翻车；FSRS 若胜出，同样复习时间换更高保持率。

### 当前已有能力复用
- **数据**：`UserMasterySnapshot`（衰减检测：14 日快照趋势 vs 当前 mastery）；`ReviewAttempt.nextIntervalDays + redoCorrect + reviewedAt`（影子实验的旧算法实测记录**已在积累**）；`PracticeRecord`（复习后正确率验证源）。
- **算法位**：`packages/shared/src/score-center/mastery.ts`（`updateStabilityAfterReview` = 基线，供对照）；复习 canonical writer = `ScoreCenterService.applyReview`（**不动**）。
- **实验基建**：`/coach/experiment-assignment`（确定性分流）+ effectiveness 管线（干预→结果相关性）。

### 技术方案
- **Backend**：
  - `packages/shared/src/score-center/fsrs-scheduler.ts`：FSRS 核心（DSR 三分量 + 最优间隔公式）纯函数重实现，**不引 npm 依赖**（对齐 shared 纪律；ts-fsrs 仅作测试对照基准）。
  - 影子评估器 `fsrs-shadow.ts`（纯）：输入=某用户全部 ReviewAttempt + 后续 PracticeRecord，输出=双算法指标对比：`{ postReviewAccuracy, retention7d, retention14d, intervalEfficiency }`。
  - `GET /coach/fsrs-shadow`（admin/teacher 只读）：聚合全站对比 + 样本量 + 置信标注（样本不足明示）。
  - **遗忘防线**：`decay-defense.selector.ts`（纯）——mastered 节点 14 日快照均值较峰值回落 ≥ 阈值 → 生成"保温复习"候选（轻量：1 题/节点/周上限），**以推荐层投放（推荐理由=FORGETTING_DEFENSE），绝不写 ReviewSchedule**（红线：错题复习的 SoT 不被污染）。
- **Frontend**：首页/精灵台词新增保温复习卡（复用推荐理由展示模式）；admin 影子对比页。
- **Database**：零迁移（影子结果每次按需计算，不落新表；后续若需持久化走 RuntimeState 先例）。
- **Algorithm**：FSRS 参数用开源默认值起步（不训练），影子切换条件预注册：**7 日保持率差 ≥5 个百分点且样本 ≥N（预注册时定）才提议切换**，切换本身走 Human-in-the-Loop（optimizer proposal 模式）。

### 风险
- 影子样本量不足（现网复习量小）→ 指标页强制样本量门槛，不足只展示"数据积累中"。
- 保温复习打扰感 → 每日 ≤2 条 + 精灵宪法文案纪律管辖。
- FSRS 重实现偏差 → 与 ts-fsrs 官方实现做同输入对照测试（golden 用例）。

### 预计 Sprint
3 个 Sprint（FSRS 纯模块+对照测试 / 影子评估器+admin 页 / 防线选择器+前端）。

### 验收标准
1. fsrs-scheduler 与官方实现在 ≥50 组 golden 用例上间隔输出一致（容差内）。
2. 影子端点输出双算法三指标 + 样本量；样本不足时无结论输出。
3. 保温复习候选全部携带衰减证据（快照差值），且零 ReviewSchedule 写入（测试断言）。
4. 全量测试零新增失败。

---

## Feature 4：大题采分点训练系统

### 产品目标
补齐 408 大题（70/150 分）训练闭环：把"对答案自评总分"升级为"逐采分点自评"，让大题练习可诊断、可训练。

### 用户价值
大题是分差的主战场且最难自评——学生最常见的自欺是"思路对了就给自己满分"。Rubric 自评把模糊的自我感觉变成结构化能力记录。

### 当前已有能力复用
- **判分管线**：`Question.type='综合题'` + `selfScore/maxScore` 全链路（提交校验、6 分及格线判定:3205、报告聚合）——**不动**。
- **会话**：LearningSession 快照/恢复/提交；综合题在 session 中已有 selfScore 路径。
- **遥测**：UserEvent allowlist（增量一行即可记录逐点明细）。
- **内容**：QuestionFamily（版本化）；变式题管线。

### 技术方案
- **第一阶段（无 LLM，用户指定）**：
  - **Database**：⚠️ 本升级计划**唯一**提议的 Schema 变更——`Question` 增 `rubric Json?`（可空、纯增量、旧行 null；回滚=置 null）。**须所有者单独批准后才建迁移**；未批准的零迁移备选：rubric 以内容侧 JSON 挂现有字段（降级方案，含混度更高，不推荐）。
  - Rubric 结构：`[{ point: "算法思想", score: 3 }, { point: "步骤描述", score: 3 }, { point: "复杂度分析", score: 2 }, { point: "边界处理", score: 2 }]`。
  - **Backend**：提交端点增量接受 `rubricSelfScores: number[]`（校验：长度/分值匹配）→ 折算为既有 `selfScore`（管线零改动）→ 逐点明细以 `question.rubric_graded` UserEvent 落遥测（allowlist 增一行）。
  - **Frontend**：综合题作答界面把单一分数框替换为采分点清单勾选（每点滑杆/数字），实时合计；报告页显示逐点得分率（能力画像素材）。
  - **Algorithm**：逐点数据积累后（第二阶段），节点级"大题能力向量"进推荐理由（如"你的复杂度分析采分率 41%"）。
- **未来（LLM 解锁后）**：DeepSeek 按 rubric 对照学生作答逐点评分建议（学生可改判）——AiTutorLog 审计 + 评分建议与自评分差提示。本阶段不实现。

### 风险
- Rubric 内容生产是主要成本（320 题中综合题逐题拆点）→ 分批：先高频真题节点，内容侧任务独立跟踪。
- 自评仍可撒谎 → 逐点粒度 + 后续 LLM 对照双约束；诚实标注"自评数据"。
- Schema 变更是红线敏感项 → 单独批准门 + 兼容性分析（旧行为完全不变）。

### 预计 Sprint
3 个 Sprint（迁移+后端 / 前端清单 / 高频题 rubric 内容首批+验收）。

### 验收标准
1. 无 rubric 的综合题行为与现在逐字节一致（回归断言）。
2. 有 rubric 的题：逐点校验、合计分进入既有 selfScore 管线（掌握度/报告/错题联动零改动验证）。
3. 逐点明细事件入 allowlist 且 admin 可查样本。
4. 全量测试零新增失败。

---

## Feature 5：交错练习 + 自我解释增强

### 产品目标
两个学习科学增强打包：①Mixed Practice（跨科混合练习对抗分块练习的自欺）；②Self Explanation（答题后用自己的话标注陷阱，对抗"看懂≠会做"）。

### 用户价值
交错练习在保持率上显著优于分块（尽管主观更难——恰是有效练习的标志）；自我解释是把"做对了"深化为"懂为什么"的最低成本手段。

### 当前已有能力复用
- **推荐引擎**：候选生成/priority/composeDailyPlan 纯函数（加 mode=交错选择器）；`GET /practice-sets/recommended`（mode 增量，同 F1 模式）。
- **字段**：`WrongQuestionReview.note / selfReportedReason`（自我解释落点，零迁移）；错因上报流程（错误原因选择弹层）。
- **前端**：PracticePanel 快速会话按钮组（V8 #12）。

### 技术方案
- **Backend**：①`interleaved.selector.ts`（纯）：输入=薄弱节点集，输出=按"科目不相邻 + 考点轮转"约束的题序（每连续 3 题不同科目为默认约束）；端点 `?mode=mixed`。②自我解释：错题提交流程增量可选字段 `trapExplanation`（≤120 字）→ 写入 `WrongQuestionReview.note` 前缀标记（`[陷阱]`）——零迁移；正确题的陷阱标注 v1 不做（字段属错题域，扩展需契约演进，后置）。
- **Frontend**：①练习面板"混合模式"开关（徽标显示本次覆盖科目数）；②提交后弹层追加一步（仅错题）："这道题最大的陷阱是什么？"——输入框 + 常见陷阱快捷选项（从错因分类衍生）。
- **Database**：零迁移。
- **Algorithm**：交错约束纯函数；陷阱文本进入错题画像（后续 sprite/教练可引用："你在 TCP 上三次掉进同一个窗口陷阱"——数据从 note 聚合）。

### 风险
- 交错练习主观吃力 → 首次进入时一句诚实说明（"感觉更难=正常且有效"，附学习科学依据一句话）。
- note 字段复用可能与其他笔记混写 → 前缀标记约定 + 展示时分离渲染。

### 预计 Sprint
1 个 Sprint。

### 验收标准
1. mixed 模式题序满足交错约束（纯函数测试：无连续同科超限）。
2. 陷阱解释正确落库、错题详情页可见、与普通笔记分离渲染。
3. 全量测试零新增失败。

---

# 3. Feature 优先级排序（按指令固定顺序 + 理由）

| 序 | Feature | 理由 |
|---|---|---|
| 1 | 真题对标练习模式 | **数据 100% 就绪（零迁移零新表）+ 感知杠杆最大**：考研学生的行为锚点是真题，"为什么练这道"的可见性直接提升练习意愿；且它是 F2/F4 的展示底座（频率徽标、失分考频排序复用同一投影）。 |
| 2 | 全真模考诊断增强 | 管线已有 70%（分科统计/考后任务/差距视图），投资半程收获完整诊断书；模考是信息密度最高的提分事件。 |
| 3 | 遗忘防线 + FSRS | 学习科学核心升级，但需要数据积累周期（影子样本），**越早启动影子记录越早有结论**——排第三但影子数据采集应在 F1 期间并行开启（纯读，无依赖）。 |
| 4 | 大题采分点训练 | 天花板最高（70 分主权）但成本也最高（内容拆点 + 唯一 Schema 变更需单独批准），且部分价值被 F2 的主观题标注先行兑现。 |
| 5 | 交错练习 + 自我解释 | 单 Sprint 轻量收尾，纯推荐层与 UI 增强，零风险快赢。 |

排序的共同逻辑：**数据就绪度 × 分数杠杆 ÷ 实施风险**，且前置 Feature 为后续提供复用件（F1 投影 → F2 排序；F3 影子 → 未来算法决策）。

---

# 4. 技术价值总结

## 算法能力
- **Recommendation Algorithm**：频率信号全链路兑现（引擎输入→理由码→用户可读理由）；新增交错约束选择器与衰减防御候选生成——推荐从"薄弱优先"进化为"考频 × 掌握 × 遗忘风险 × 练习科学"四因子。
- **Mastery Modeling**：掌握度从快照进化为轨迹（衰减检测）；大题能力向量（采分点画像）为掌握度增加主观题维度。
- **Spaced Repetition**：FSRS 纯函数实现 + 影子实验框架 = 用 A/B 证据驱动算法升级（含预注册切换阈值），这是复习系统工程的完整闭环。

## 工程能力
- **Projection Architecture**：五个 Feature 全部以 Selector/Projection/ViewModel 落地（exam-aligned / exam-diagnosis / fsrs-shadow / decay-defense / interleaved），核心业务模型零污染——SoT 纪律在大规模功能扩张下的示范性实践。
- **Event Driven Learning Pipeline**：逐点遥测（rubric_graded）、保温复习推荐事件、影子指标全走既有 UserEvent/推荐层；恢复计划复用既有考后触发链。

## AI 能力
- **RAG**：F4 未来 LLM 评分以 rubric 为结构化上下文（对照评分比自由生成可靠一个量级）；F1 理由卡为 RAG 引用展示同款"透明→信任"模式。
- **AI Coach**：保温复习与陷阱画像为精灵/教练提供新的事实素材（evidenceRefs 严格指向派生源）。
- **LLM Evaluation**：F3 的影子对比方法论（预注册指标+样本门槛）直接迁移到未来 LLM 评分的评估设计；F4 的 rubric 是 LLM 评分的 golden rubric 雏形。

## 面试价值
- 一条完整的"**用学习科学 + 数据证据驱动教育产品算法迭代**"叙事：交错练习/自我解释/间隔重复的文献依据 → 工程实现 → 影子实验验证 → 人在环切换决策。
- 每个 Feature 都是"读模型演进 + 零破坏扩展"的架构案例（高频面试题：如何给运行中的系统加能力而不动核心）。
- FSRS 重实现与对照测试展示算法工程严谨性；诊断归因链展示数据建模能力。

---

## 附：执行纪律（对齐接管指令）

- 每 Feature 强制 Phase 0→5（Audit→Plan→Review→Coding→Testing→Acceptance Report），禁止直接编码/边想边改/大重构。
- 每 Feature 完成输出 **Completion Report**：修改文件/架构变化/数据变化/API 变化/前端变化/测试结果/Acceptance Checklist/下一阶段建议。
- SoT 清单（PracticeRecord/UserKnowledgeMastery/WrongQuestionReview/ReviewSchedule/StudyPlan/StudyTask/LearningSession/UserEvent）只读复用；全计划唯一 Schema 变更 = F4 的 `Question.rubric`（单独批准门）。
- 全量 `npm test` 零新增失败 + build 双端 PASS 为每个 Feature 的硬门禁。

**等待 Roadmap Review 通过后进入 Feature 1 实施。**
