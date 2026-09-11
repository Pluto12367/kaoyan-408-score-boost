# S1 Score Anchor — Design Gate + Implementation Plan

> 日期：2026-09-11 ｜ 性质：架构设计 + 实施计划（本文件不包含任何代码、schema、迁移、部署动作）
> 上游批准：Score Improvement Reconstruction = approved direction；S1 Score Anchor = approved as next milestone
> 本计划批准范围：**仅 S1**。S2（Transfer）/S3（Opportunity）/S4（ROI 排序）均未批准，本计划不为其设计实现细节。
> 输入：`docs/score-improvement-gap-report.md`、`docs/score-improvement-reconstruction-design.md`（§D/§5/§7/§11/§14/§15/§Q/§R/§S）

---

## 0. 最高目标与边界

把 Score / Prediction / Assessment / Outcome 从当前混合语义重构为可支撑后续提分模型的 **Score Anchor Foundation**：

```text
prediction ≠ assessment ≠ outcome      （构造性隔离，非字段约定）
150-point scale 统一 + provenance 强制 + examDate 事实化 + origin 可追溯
```

**本阶段禁止**：写代码、改 schema、执行迁移、部署、改推荐排序、改 priority、实现 ROI、实现 Transfer Probe、实现 F4 Ability、改 Mastery semantics、接入生产机会排序。允许：read / audit / design / dependency analysis / implementation planning。

---

## 1. Reality Check（以当前代码为准）

### 1.1 分数数据全链路地图（来源 → 存储 → API → UI → 使用者）

| # | 来源 | 存储位置 | API | UI | 使用者 | 量纲/语义 |
|---|---|---|---|---|---|---|
| 1 | **In-app 整卷模考**（系统判分） | `LearningSession(type='paper')` + `PracticeRecord`；`AssessmentHistoryItem`（study.service.ts:2092 写入 `score=result.score, totalScore:100`）；score-history 投影（exam-score-history.projection.service.ts:35-50，只取 type='paper'） | `GET /exam/score-history`、`GET /exam/report/:sessionId`、`GET /assessment-history` | `ExamReport.tsx`、测评历史列表（dashboard.ts:166） | 学生（自己）、教师/管理员（报告视图） | **score=accuracyRate（0-100 正确率百分比）被当作"成绩/100 分"存储**——是"做对题数占比"，不是考试分 |
| 2 | **外部/机构成绩**（学生自报导入） | 同一张 `AssessmentHistoryItem`，id 前缀 `imported-`（study.service.ts:1866-1901），任意 totalScore | `POST /assessment-history/import`（controller:549） | 同一测评历史列表 + 导入对话框 | 学生（自己） | 任意总分；**与 #1 同表同形状，无来源字段，仅靠 id 前缀约定区分** |
| 3 | **阶段测评**（系统判分） | 独立通路仅内存数组 `stageAssessmentResults`（study.service.ts:540/3797）；session 通路另有掌握度写入 | `GET/POST /assessments/stage*` | 测评面板 | 学生 | 分数=正确率（study.service.ts:3761），**重启即失，不入成绩历史** |
| 4 | **主观题自评分** | `PracticeRecord.selfScore/maxScore`（gradingMode='self_assessed'，correct = 比值≥0.6，study.service.ts:3342-3368） | 会话提交 | 考试报告（主观得分段） | 学生 | **自评污染客观正确率并进一步污染掌握度**（gap report §6.1） |
| 5 | **Rubric 判分大题** | 仅证据台账（`rubric_scored_attempt`，不回写 PracticeRecord/AssessmentHistoryItem） | `POST /questions/:id/subjective-attempt` | Training Room | 学生 | **生产 rubric 行=0，端点诚实返回 no_rubric** |
| 6 | **预测分（进度外推）** | **不落库**——前端即时计算 | 无（shared 直调） | `ReportSummaryPanel.tsx:64`、`StudentProgressOverview.tsx:62/71`（estimatePredictedScore） | 学生 | 0-150 clamp；`progress=0.5×mastery+0.3×accuracy+0.2×timeFactor` 的插值启发式；**从未持久化（无 inputsSnapshot 可考古）** |
| 7 | **预测分（单场诊断）** | 不落库（getExamReport 响应内派生） | `GET /exam/diagnosis/:sessionId` | `ExamDiagnosisPanel.tsx` | 学生 | score150Estimate = 客观正确率×80 + 主观自评（exam-diagnosis.ts:138-149） |
| 8 | **校准影子** | 无存储，读时重建预测 | `GET /coach/score-calibration`（teacher/admin） | 无学生 UI | 教师/管理员 | **150 制预测 vs 100 制 actual 直接相减**（score-calibration.ts:117 `error = actualScore − predictedBest`；actual 对 paper 行是 0-100 正确率，见 #1） |
| 9 | **目标/现状自报** | `User.targetScore/currentScore/remainingDays/examYear`（schema.prisma:148-157；onboarding/诊断 profile 写入） | `POST /study/onboarding/complete`、`/study/diagnostics/profile` | GoalProgressInsight / resolveScoreGapView（V8 #5 修复） | 学生 | currentScore **永不被系统更新**；无 examDate 字段；examYear 仅年份整数 |
| 10 | **闯关里程碑** | `UserNodeQuest`（accuracy 门槛） | quest 端点 | 图谱徽章 | 学生 | 非分数，不计入 |

### 1.2 逐项判定：已存在 / 混在一起 / 不能安全解释

| 类别 | 判定 |
|---|---|
| in-app mock（system graded） | **存在**，但"成绩"语义被正确率冒名（#1） |
| external mock / institution（self reported） | **存在**（import 通道），**与 #1 混在同一表且不可靠区分** |
| teacher graded | **不存在**（无任何教师录分端点） |
| real exam | **不存在**（全库无实考分字段/表） |
| diagnostic | **不存在**（无入学测；applyDiagnosticProfile 是纯规则推导，不产生成绩） |
| self reported | 存在（import + selfScore），无 provenance 标注 |
| system graded | 存在（paper 客观题精确匹配），语义混入正确率 |
| rubric graded | 管道存在、**数据为空**、不进成绩体系 |
| **不能安全解释** | ①AssessmentHistoryItem 无 provenance 列——两类写入只能靠 id 前缀区分；②paper 行 score 是百分比却顶着"score/100"的名字；③校准 error 跨量纲（E2E 实证 predicted=26 vs actual=96/100，error=70）；④预测从不落库——无法事后回答"当时预测的是什么" |

**结论**：S1 的地基事实与两份设计文档一致，且新增确认——预测分**完全无持久化**（比 gap report 记载更进一步：连影子都不存），calibration 的配对输入 `totalScore` 虽随行携带但 error 计算未消费它。

---

## 2. Score Ledger Schema Design（schema 级概念设计）

> 以下为概念模型与约束定义，非 Prisma 代码；实际 schema 变更在 S1.1 任务中经所有者批准后执行。物理形状：**四张独立表 + 一列**（`ScorePrediction` / `ScoreAssessment` / `ScoreOutcome` / `ScoreLossItem` + `User.examDate`）。`CalibrationPair` **不建表**——它是纯函数投影（读时配对），理由见 2.6。

### 2.0 为什么必须结构隔离，而不能只加一个 kind 字段

1. **写路径授权不同，且必须不同**。prediction 只能由系统（服务内部）生成；assessment 可由学生自报（self-only）或教师录入；outcome 需要最高信任入口（教师/管理员验证）。三张表 = 三个 repository + 三个 service + 各自的 guard——**一张表里的 bug 不可能把行写进另一张表**；单表 + kind 时，授权只是同一个端点里的代码约定，`kind` 写错一行代码就是一次污染（先例：E2E 夹具"比生产更干净的数据形状"曾掩盖过第二套口径缺陷）。
2. **字段级不变量不同**。prediction 必须有 modelVersion+inputsSnapshot+区间；assessment 必须有 examDate+gradingMethod；outcome 必须有 verificationStatus+凭证引用。单表意味着这些字段全部可空 → "可空丛林"，每行 60% 列为 null，不变量只活在注释里。仓库自己的先例就是反例教材：`ReviewAttempt` 四列排程属性可空后，迁移注释被迫写明"历史行 genuinely unknown"——一张表服务多种形状，代价就是永久性的 NULL 语义负担。
3. **跨类查询语义不同**。校准配对只应发生在 prediction × assessment/outcome 之间——跨表 join 使"混量纲配对"成为**类型错误**而非运行时过滤条件；单表下 `WHERE kind='prediction'` 写漏一行就是静默混算（现状 score-calibration 的量纲错配正是这种静默的实例）。
4. **修正语义不同**。correction 永远追加到**同类表**内引用原行；"把预测改成成绩"这种跨类修正被构造性禁止——而这是正确语义：预测错了不变成成绩，只能新增一条成绩。
5. **数据质量规则不同**。"prediction after outcome"这类检查需要比较两张表的行——结构隔离使该检查定义明确。
6. **保留与审计策略不同**。prediction 便宜可重算（丢弃无害）；outcome 是永久事实。单表强制同一保留策略。

### 2.1 ScorePrediction

| 维度 | 设计 |
|---|---|
| identity | `id`(cuid)；`predictionKey`（生成方提供的确定性键，如 `{reportSnapshotId}` 或 `{userId}:{generatedAt-day}:{model}`） |
| ownership | userId；**写方仅限系统服务**（无学生/教师创建 API） |
| lifecycle | append-only；可重算产生新行（旧行保留——预测历史是校准的原料，不可删） |
| provenance | 固定 `provenance=model_output`（见 §4 taxonomy），不参与信任分层 |
| scale | normalizedScore 150 制（复用 §3 normalize）；interval min/max 同制 |
| immutable fields | 全部字段写入后不可变 |
| correction | 不允许 correction（预测没有"错"可言，只有被后续 outcome 校验）；修正方式 = 生成新预测行 |
| 必填字段 | modelVersion、inputsSnapshot（JSON：accuracyRate/averageMastery/remainingDays/targetScore/currentScore——**修复"预测从未落库、无法考古"**）、minScore/maxScore/bestEstimate、generatedFor（'report'\|'diagnosis'\|'calibration'）、createdAt |
| 索引/唯一 | `@@unique([userId, predictionKey])`；`@@index([userId, createdAt])` |
| 查询模式 | 校准配对（按 createdAt 时间窗）；预测历史曲线 |

### 2.2 ScoreAssessment

| 维度 | 设计 |
|---|---|
| identity | `id`；`originType`（paper_session \| external_import \| teacher_entry \| diagnostic）+ `originId`（会话 id / 导入指纹 / 教师录入批次） |
| ownership | userId；写方 = 系统（paper 提交事务内）、学生（self-only 导入）、教师（授权学生） |
| lifecycle | append-only |
| provenance | 按 §4 taxonomy（system_graded / self_reported / teacher_graded / rubric_graded / institution / imported / unknown） |
| scale | rawScore + rawTotalScore（**必填，缺失即拒绝**）+ rawScale 声明 + normalizedScore；`semantic`：`exam_points` \| `accuracy_rate`（paper 历史行的诚实名字） |
| immutable fields | raw*、normalizedScore、provenance、examDate、origin* |
| correction | 追加 correction 行（supersedesId 指向原行），原行保留；读模型解析最新未 superseded 行 |
| 必填字段 | gradingMethod（exact_match \| self_report \| teacher_graded \| rubric）、examDate（**考试发生日**；未知则 null+warning，禁止用录入日冒充）、source/provenance |
| 索引/唯一 | `@@unique([userId, originType, originId])`（一会话一成绩；导入指纹防重复）；`@@index([userId, examDate])` |
| 查询模式 | 学生成绩时间线；按 provenance 分层取数（校准）；与 origin 会话 join（报告联动） |

### 2.3 ScoreOutcome

| 维度 | 设计 |
|---|---|
| identity | `id`；examType（real_exam \| institution_verified \| teacher_verified_mock） |
| ownership | userId；**学生可提交但默认 unverified**，教师/管理员验证后 verified |
| lifecycle | append-only；verificationStatus 可由 `unverified → verified`（唯一允许的状态更新，仅教师/管理员，留 OperationLog 审计） |
| provenance | real_exam / institution / teacher_graded（§4） |
| scale | 同 2.2 |
| immutable fields | raw*、normalizedScore、examDate、examYear、evidenceRefs |
| correction | 追加 correction 行 |
| 必填字段 | examDate（**必须为过去**——写入时校验，blocking）、verificationStatus、verifiedBy/verifiedAt（verified 时） |
| 索引/唯一 | `@@unique([userId, examType, examYear])`（实考一年一次；机构/教师认证卷按指纹）；`@@index([userId, examDate])` |
| 查询模式 | 锚定成绩（最高置信层）；校准 primary 层的唯一 outcome 来源 |

### 2.4 ScoreLossItem（逐题失分行）

| 维度 | 设计 |
|---|---|
| identity | `id`；`scoreEntryId` + `questionId` |
| ownership | 随父行（assessment/outcome） |
| lifecycle | append-only，随父行不可变 |
| provenance | 继承父行 |
| 必填字段 | nodeIds[]（经既有三层题-节点解析；解析失败 → nodeIds=[] + `nodeResolution='unresolved'`，**不伪造归因**——B13 缺口的诚实承接）、errorType（九类 taxonomy；S1 阶段允许 null=未归因）、lostScore、maxScore、questionType（single_choice \| calculation \| algorithm \| comprehensive） |
| 索引/唯一 | `@@unique([scoreEntryId, questionId])`；`@@index([knowledgeNodeId])`（为 S3 ESL 聚合预留——仅索引，不建读 API） |
| 查询模式 | S1：按 entry 取失分明细（诊断书复用）；S3（未批准）：按节点聚合失分 |

### 2.5 User.examDate（一列增量）

`User.examDate DateTime?`——考试日**事实**。remainingDays 降级为派生量（§5）。

### 2.6 CalibrationPair——刻意不建表

配对是**纯函数投影**：`(prediction, assessment|outcome) → pair`，读时按 `(userId, 时间窗, scalePair, semanticPair, provenanceLayer)` 计算。理由：①配对规则在 E1 后还会演进（分层细化），存储化会造成第二 SoT；②仓库投影文化（selector/assembly 纯函数 + 只读装配）已验证此模式；③配对完全可重算，无持久化价值。唯一要求：配对函数**强制等量纲 + 等语义 + 同 provenance 层**才能产出 pair（§6）。

---

## 3. 150 分量纲（normalize 规则与拒绝条件）

纯函数（shared 包，前后端同源），**所有写入口强制经过**：

```text
normalizeScore(rawScore, rawTotalScore) → { normalized: number | null, reject: string | null }
  normalized = round1(rawScore × 150 / rawTotalScore)     ← 保留 1 位小数（失分可为 0.5 的倍数）
```

| 输入情形 | 处理 | 判定 |
|---|---|---|
| rawTotalScore = 150 | normalized = rawScore（原样） | 接受 |
| rawTotalScore = 100（含 paper 正确率行） | normalized = raw × 1.5，semantic=accuracy_rate | 接受，**只能进 proxy 校准层** |
| 非标准总分（如 120） | 按比例归一 | 接受 |
| rawTotalScore 缺失/null | **拒绝**（`missing_total_score`）——禁止沿用 V12-M5 的 `|| DEFAULT_TOTAL_SCORE` 回退习惯（score-calibration.service.ts:46 的教训：回退制造了错配） | **blocking** |
| rawTotalScore ≤ 0 | 拒绝（`invalid_total_score`） | **blocking** |
| rawScore null | normalized = null（合法状态：仅失分明细、无总分）；参与配对时该行被排除 | 接受（非配对行） |
| rawScore < 0 或 > rawTotalScore | 拒绝（`invalid_score_range`） | **blocking** |
| rawScore = 0 且 rawTotalScore = 0（0/0） | 拒绝（`invalid_total_score`，被 ≤0 覆盖） | **blocking** |
| rawScore 非有限数（NaN/∞） | 拒绝（`invalid_score_value`） | **blocking** |
| rawTotalScore = 150 且 rawScore 有 2 位小数 | round1 + basis 声明 | 接受 |

拒绝 = 写入口抛 400（API 路径）或跳过+计数（投影路径），绝不静默回退默认值。

---

## 4. Provenance Taxonomy

```text
provenance        语义                                     信任层   校准层
system_graded     系统客观判分（精确匹配/自动折算）          medium   proxy（accuracy_rate 行）/ primary（exam_points 行）
self_reported     学生自报（import 默认、selfScore）         low      proxy
teacher_graded    教师账号录入或判定（须 enteredBy 教师）     high     primary
rubric_graded     rubric 结构化判分（携 rubricVersion+hash） high     primary（内容可信前提下）
institution       机构成绩（学生录入 + evidenceRefs 凭证引用）medium-high primary（verified 后）
imported          从旧表迁移、原始来源不可考                 —        proxy
real_exam         真实考研成绩（examYear + 凭证/管理员确认）  highest  primary
unknown           【显式枚举值】系统不声称知道来源           —        proxy only
```

**unknown 的三条例外语义（不是含糊的兜底）**：①构造上只能进入 proxy 校准层，永不进入 primary MAE；②UI 显示"来源未记录"，不渲染任何信任徽标；③计入 `/admin/data-quality` 计数（§11），成为运营清理队列。`imported` 与 `unknown` 的区别：imported 有**可考的迁移出处**（来自 AssessmentHistoryItem 的具体行/通道），unknown 连出处都不声称。
**provenanceDetail JSON**：enteredBy、evidenceRefs[]（凭证图片/链接/会话 id）、notes——trust 徽标的判定依据，防止"自称 teacher_graded 的自报"。

---

## 5. examDate 与 remainingDays

- **examDate = 事实**（考试发生的日期，录入时校验）；**remainingDays = 派生量**（`daysToExam = ceil((examDate − now)/day)`，读时计算）。
- `User.examDate` 新增后，daysToExam 解析序：显式 targetExamDate（计划入参）→ `User.examDate` → `User.remainingDays`（**legacy 缓存，读时标记 stale**）→ 96 常量回退（现状）。该解析序**仅在 S1 文档化，不改代码**（改 daysToExam 消费方属 S3+，未批准）。
- 兼容规则：`User.remainingDays` 列保留、行为不变（不破坏现有 API）；data-quality 增加旗标：`examDate missing && remainingDays set` → "事实缺失，仅有过期手工派生值"（§11 warning）。手动 remainingDays 与 examDate 并存时以 examDate 为准，报告层展示"由考试日推导"。
- **不回填 examDate**：历史 remainingDays 是手工整数，无考试日事实可考——推断即伪造。

---

## 6. Prediction / Assessment / Outcome 定义

### Prediction（系统预测，可错、可弃、可重算）
- 必存：modelVersion、inputsSnapshot（当时 accuracyRate/averageMastery/remainingDays/targetScore/currentScore 快照）、predictionInterval（min/best/max）、createdAt、generatedFor。
- 语义禁令：预测行**永远**不得进入成绩时间线的"成绩"段；interval 是统计声明不是承诺。
- S1 行为变更：把今天"前端即时算完即丢"的预测（ReportSummaryPanel/StudentProgressOverview、诊断书）在生成时**同时落一行 ScorePrediction**——不改变计算公式（estimatePredictedScore 与 score150Estimate 原样），只增加持久化。前端计算路径保留（离线可用），落库为影子记录。

### Assessment（被测量的表现，有噪声）
- 必存：assessmentType（mock_in_app/external/teacher_mock/diagnostic）、provenance、gradingMethod、examDate、raw 三元组 + normalizedScore、semantic。
- 语义禁令：assessment ≠ outcome——即使 provenance=teacher_graded，它仍是一次模考表现，不是最终成绩。

### Outcome（已发生的最终成绩，最高 provenance）
- 三类：real_exam（真实考研分）、teacher_verified（教师认证的模考终判）、institution_verified（机构成绩经验证）。
- verificationStatus 双态：unverified（学生自录，进 proxy 层）→ verified（教师/管理员确认，进 primary 层）。**unverified outcome 不冒充 verified**。
- 语义禁令：outcome 行不得由 prediction/assessment 升类产生（§2.0 第 4 条）。

---

## 7. Score Ledger API 设计

| 操作 | 路由（建议） | 认证/授权 | 幂等 | 不可变行为 |
|---|---|---|---|---|
| create prediction | 无公开路由（服务内部，报告/诊断生成时写） | 内部调用 | predictionKey 唯一约束，冲突=读回 | append-only |
| record assessment | `POST /scores/assessments` | 学生 self-only（provenance 强制 self_reported，角色守卫防伪造 teacher_graded）；教师经授权关系录入（teacher_graded）；admin 全量 | 客户端 `Idempotency-Key` 头 或 originType+originId 唯一约束；冲突→200 读回已有行 + `duplicate:true` | append-only |
| record outcome | `POST /scores/outcomes` | 学生可提交（→unverified）；教师/管理员提交或验证（→verified） | `(userId,examType,examYear)` / 指纹唯一 | append-only；唯一可变字段 verificationStatus（单向 unverified→verified） |
| record correction | `POST /scores/{kind}/{id}/corrections` | 学生仅可修正 self_reported 自己的行；教师/管理员按授权 | correction 幂等键 | **原行永不 UPDATE**；correction 行 supersedesId 指回 |
| query score history | `GET /scores/history` | self-only（resolveUserId 模式）；教师需授权记录；admin 全量 | 读接口 | 时间线投影（三表 union），游标分页 `(examDate,id)`，过滤 kind/examType/provenance/dateRange |
| query calibration | `GET /scores/calibration` | **teacher/admin（S1 维持影子位）**；学生开放与否 = E1 gate 后的所有者决策 | 读接口 | 分层输出（每 provenance 层独立 MAE/bias/coverage） |

- **审计**：全部写入经既有 OperationLog 中间件；新增 canonical 事件 `score.assessment.recorded / score.outcome.recorded / score.correction.recorded / score.outcome.verified`（RESERVED_CANONICAL_EVENT_TYPES **纯增量**，非契约变更）。
- **分页/过滤**：游标分页；过滤参数白名单校验（既有 ValidationPipe）。
- **错误语义**：normalization 拒绝 → 400 带 reject 码；越权 → 403；不存在/非本人 → 404（沿用 resolveUserId 惯例）。

---

## 8. UI（学生端最小可用信息）

`ScoreAnchorPanel`（报告页新面板，紧邻 ExamDiagnosisPanel）：

1. **当前可信成绩锚**：最高置信行（verified outcome > teacher/institution > unverified）+ 来源徽标 + examDate。
2. **预测成绩**：区间呈现（min–best–max）+ modelVersion + "预测"徽标 + inputsSnapshot 摘要（"基于 65% 正确率、60% 掌握度、剩 120 天"）。
3. **最近测评**：近 5 条 assessment（类型/日期/normalized 分）。
4. **与目标分差**：锚（或预测，标注）→ targetScore 的差值；复用 resolveScoreGapView 防假达成。
5. **数据来源/置信说明**：每行 provenance 徽标；unknown → "来源未记录"。
6. **无锚态**：没有任何 assessment/outcome 时显示"还没有可信成绩记录——做一次全真模考或导入成绩以建立锚点"，**不显示 0 分**。

**视觉禁令**：预测与成绩在时间线上分色分段；预测行必须带"预测"徽标且不参与"成绩趋势"连线——严禁把 prediction 渲染成 actual（gap report False Confidence #7 的 UI 端免疫）。静态演示模式 return null（无真实学生不渲染伪锚）。

---

## 9. Cold Start

```text
新学生 → 入学诊断测（S1 只设计,不实现;实现属诊断里程碑）
       → 逐题 ScoreLossItem + 整卷 ScoreAssessment(examType=diagnostic, provenance=system_graded)
       → Initial Score Anchor（第一枚锚 + 首个校准对）
无诊断测 → 无任何 Score 行 → UI"无锚态"
```

- **禁止用 neutral 0.5 伪造成绩**：0.5 是掌握度先验，永远不得折算成 Score 行（"mastery 0.5 = 75 分"这类折算被本计划明确禁止——它就是把模型输出冒充 measurement）。
- 诊断测的蓝图设计（4 科 × 难度 × 题型分层抽样 30-45 题）属诊断里程碑范围，S1 仅预留 `examType='diagnostic'` 与 originType 约定。

---

## 10. E1 实验（Score Anchor 标定实验）

| 项 | 设计 |
|---|---|
| Sample | 5-10 名真实学生（生产账号）；每人：①1 次教师/rubric 判分全真模考（150 制 exam_points，teacher_graded）→ ②1 次外部成绩导入（institution，附凭证）→ ③（可选）1 次实考分录入（real_exam） |
| Inclusion | normalizedScore 有效（§3 全过）；provenance ∈ {teacher_graded, rubric_graded, institution(verified), real_exam}；examDate 存在且为过去；semantic=exam_points |
| Exclusion | semantic=accuracy_rate 行（paper 正确率——进 proxy 层单独报告）；provenance ∈ {self_reported, unknown, imported}；verificationStatus=unverified；配对时间窗内无可重建预测（evidence 不足，进 exclusions 不按零误差计——沿用 V12-M5 规则）；prediction.createdAt > outcome.examDate |
| Metrics | **分层**（每 provenance 层独立）：n、MAE、bias（actual−predicted）、median abs error、prediction interval coverage（落在 [min,max] 内比率）、按误差分位分布 |
| Threshold（建议 gate，预注册） | 每层 n ≥ 5 **且** median abs error < 15 分（150 制）→ 才允许：①估算分从影子对学生可见；②unverified 层并入校准参考。任一不满足 → 预测维持"仅为估算"现状，扩大样本后复测 |
| 禁令 | **不输出混合 provenance 的单一 MAE**；不把 proxy 层数字与 primary 层平均 |
| 执行 | 采集用既有 import 通道 + 新 outcome API（S1.9）；分析用只读脚本（S1.11） |

---

## 11. Data Quality Checks（S1 专属，扩展 /admin/data-quality）

| 检查 | 级别 | 处置 |
|---|---|---|
| rawScore > rawTotalScore | **Blocking** | 写入口拒绝（400 + invalid_score_range） |
| rawScore < 0 / NaN | **Blocking** | 写入口拒绝 |
| rawTotalScore 缺失/≤0 | **Blocking** | 写入口拒绝（禁止默认 150 回退） |
| 非法 scale 声明 | **Blocking** | 拒绝 |
| outcome.examDate 非过去 | **Blocking** | 写入口拒绝 |
| provenance 与角色不符（学生行自称 teacher_graded） | **Blocking** | 写入口拒绝（角色守卫） |
| assessment.examDate 缺失（历史/旧通道行） | Warning | 计数 + "examDate 未记录"；UI 显示"日期未知" |
| provenance=unknown / imported 计数 | Warning | 数据质量清单（清理队列） |
| 重复 outcome（同 user+examType+examYear 已有 verified 行再录） | Warning | 幂等读回 + 计数；教师可 correction |
| prediction.createdAt > outcome.examDate | Warning | 配对时排除 + 计数（预测晚于考试=模型时间穿越） |
| accuracy_rate 行试图进入 primary 配对 | Warning | 配对函数构造性排除 + 计数 |
| unverified outcome 计数 / 超 30 天未验证 | Warning | 教师验证队列 |
| User.examDate 缺失但 remainingDays 有值 | Warning | "事实缺失，仅有派生缓存"旗标 |

Blocking=写不进去；Warning=写进去但可见、可统计、进清理队列。两者都不阻塞既有链路。

---

## 12. Tests（测试矩阵）

| 层 | 覆盖 |
|---|---|
| Unit（shared 纯函数） | normalizeScore 全分支（150/100/非标/缺 total/非法/0/0/null/NaN + round1 边界）；provenance→校准层映射（unknown/imported 永不进 primary）；配对函数**同 scale+同 semantic+同层**强制（构造混合输入断言拒绝）；correction 解析（supersede 链）；cold-start 无锚规则 |
| Schema | 干净库迁移应用；列可空性（历史行 NULL 语义）；唯一约束触发（重复 origin、重复 examYear outcome、predictionKey 冲突）；索引存在性 |
| Service | append-only（断言无 update/delete 路径，复用 v12 源码断言风格）；correction 追加不改原行；幂等读回（duplicate:true）；角色越权（学生伪造 teacher_graded → 403）；学生隔离（跨学生 404）；outcome verification 单向流转 |
| Contract | API 形状（ValidationPipe）；新 canonical 事件注册与发射；401/403 语义；分页/过滤参数白名单 |
| Integration（PostgreSQL，脚本 `integration-score-anchor.mjs`） | 全链：paper 提交 → ledger assessment 行 + AssessmentHistoryItem **双写并存且可对账** → import 幂等 → outcome 验证 → 校准投影分层输出 → data-quality 旗标 → 五新表指纹（影子写零权威表） |
| Migration | preflight 行数对账；**零回填验证**（imported 旧行不出现在新表，除非 opt-in backfill 且逐行 provenance=imported）；回滚 = DROP 四表 + DROP COLUMN 后既有行为逐字节不变 |
| E2E | 学生旅程：导入成绩 → UI 锚点带来源徽标；教师验证 → verified；校准页面分层；预测徽标不进成绩连线 |

复用仓库既有纪律：先 RED 后 GREEN、源码级断言（无写原语出现在只读层）、不弱化既有断言、失败分层归档（v12-failure-classification 维护规则延续）。

---

## 13. Migration Safety

```text
preflight（只读）
  ├─ AssessmentHistoryItem 行数 / 按 id 前缀分布（imported-* vs assessment-history-*）
  ├─ LearningSession(type='paper') 行数（未来双写对账基线）
  └─ User.examDate/remainingDays 现状统计
migration（additive-only，单事务）
  ├─ CREATE TABLE ScorePrediction / ScoreAssessment / ScoreOutcome / ScoreLossItem（全部新表）
  ├─ ALTER TABLE User ADD COLUMN examDate DateTime?      ← 唯一列增量
  └─ 全部索引/唯一约束随建
backfill
  ├─ S1 默认 ZERO-BACKFILL：旧数据留在 AssessmentHistoryItem（双读兼容），新表只接新写入
  └─ opt-in backfill（独立批准、独立脚本、S1 完成后另行决策）：
      仅迁移【可证据化】的行——
        paper 行（sessionId 可回链）→ provenance=system_graded, semantic=accuracy_rate, examDate=null
        imported-* 前缀行（id 前缀是记录在案的事实，非推断）→ provenance=imported, examDate=null
      禁止：为 totalScore 缺失行补 150；为 examDate 缺失行用 submittedAt 冒充（submittedAt 是录入日，
            不是考试日——用录入日冒充考试日即"为完整而推断历史来源"，明确禁止）
      每步 dry-run 输出逐行 before/after + 可回滚（backfill 目标表是新增表，DROP 即回滚）
validation
  ├─ 双读对账：AssessmentHistoryItem ↔ ledger（paper 会话）分数一致
  ├─ 六表指纹（四新表 + AssessmentHistoryItem + User）迁移前后 deep-equal（.authoritative write=0 惯例）
  └─ 全量 npm test / build:api / build:web / 集成套件 exit 0
rollback
  ├─ 代码回滚：旧代码不引用新表 → 逐字节回到部署前（V12.1 先例）
  ├─ 数据回滚：DROP 四表 + DROP COLUMN User.examDate；AssessmentHistoryItem 全程未动 → 零数据损失
  └─ 禁止项：不回填掌握度、不改写历史行、不为变绿放宽断言
```

---

## 14. 实现任务拆分（S1.1-S1.12）

> 每项含 goal / files / dependencies / tests / acceptance criteria / rollback。执行前提：S1.1/S1.2 须所有者批准 schema 增量后才开始。

### S1.1 Schema
- **Goal**：Prisma 增量四表一列（§2 概念模型落地），零既有列改动。
- **Files**：`prisma/schema.prisma`；`packages/shared/src/score-anchor/types.ts`（契约类型 + provenance/taxonomy 枚举 SoT）。
- **Dependencies**：所有者 schema 批准。
- **Tests**：`prisma validate`；schema 快照测试（新增模型字段清单钉死，防漂移）。
- **Acceptance**：四表 + User.examDate 全部 additive nullable/带默认安全；无任何既有模型删改。
- **Rollback**：revert schema（未迁移前零成本）。

### S1.2 Migration
- **Goal**： additive 迁移 + preflight/validation 脚本（§13 流程）。
- **Files**：`prisma/migrations/<ts>_score_anchor_foundation/migration.sql`；`scripts/preflight-score-anchor.mjs`（只读）。
- **Dependencies**：S1.1。
- **Tests**：干净库 up/down；既有库演练（备份门禁沿用 deploy.sh 惯例）；六表指纹 deep-equal。
- **Acceptance**：迁移可重复执行（幂等）；回滚后六表指纹与迁移前一致。
- **Rollback**：DROP 四表 + DROP COLUMN（无数据损失，AssessmentHistoryItem 未动）。

### S1.3 Normalization
- **Goal**：`normalizeScore` 纯函数（§3 全规则）+ semantic 语义。
- **Files**：`packages/shared/src/score-anchor/normalization.ts`（新）+ `index.ts` 导出。
- **Dependencies**：无（可最先做，纯函数）。
- **Tests**：unit 全分支表驱动（§3 表格逐行）；RED→GREEN。
- **Acceptance**：所有拒绝路径有码可查；无任何默认值回退（grep 断言无 `|| 150`）。
- **Rollback**：纯新增文件，删除即回滚。

### S1.4 Provenance
- **Goal**：taxonomy 枚举 + 信任层映射 + 校准层归属（§4）+ unknown 三条例外语义。
- **Files**：`packages/shared/src/score-anchor/provenance.ts`（新）。
- **Dependencies**：S1.1 类型。
- **Tests**：unit（每 provenance → 校准层映射表钉死；unknown 永不 primary）。
- **Acceptance**：校准层归属由函数决定而非调用方自行判断。
- **Rollback**：纯新增。

### S1.5 Prediction writer
- **Goal**：预测落库——报告/诊断生成路径在响应同时写 ScorePrediction（公式零改动，仅持久化）。
- **Files**：`apps/api/src/score-anchor/score-anchor.service.ts`（新模块）、`apps/api/src/score-anchor/score-anchor.module.ts`、`study.service.ts`（报告/诊断路径 +3-5 行调用）、`ReportSummaryPanel` 对应后端（如选择后端化，可选）。
- **Dependencies**：S1.1-S1.4。
- **Tests**：service（inputsSnapshot 完整性、predictionKey 幂等、公式输出与前端一致）。
- **Acceptance**：同一输入重算 → 同一预测行（不重复）；estimatePredictedScore 函数体零改动（源码断言）。
- **Rollback**：摘除调用行即可；预测行无害留存。

### S1.6 Assessment writer
- **Goal**：三写入口——①paper 提交事务内双写 ledger（semantic=accuracy_rate）；②import 通道升级（幂等指纹 + provenance=self_reported + raw 三元组校验）；③教师录分入口（teacher_graded）。
- **Files**：`score-anchor.service.ts`、`study.service.ts`（paper 提交 +import 路径改造）、`study.controller.ts` 或新 controller、DTO。
- **Dependencies**：S1.1-S1.4。
- **Tests**：service+contract（双写对账、导入幂等 duplicate:true、学生伪造 provenance 403、normalization 拒绝路径 400）。
- **Acceptance**：AssessmentHistoryItem 行为逐字节不变（双写，不替换）；每条 ledger 行可追溯到 origin。
- **Rollback**：双写摘除；AssessmentHistoryItem 仍是完整事实源。

### S1.7 Outcome writer
- **Goal**：实考/机构/教师认证成绩录入 + verificationStatus 单向流转。
- **Files**：`score-anchor.service.ts`、controller、DTO、角色守卫。
- **Dependencies**：S1.1-S1.4。
- **Tests**：examDate 过去校验（blocking）、examYear 唯一、unverified→verified 单向（不可逆断言）、学生提交默认 unverified。
- **Acceptance**：无 verified 路径绕过教师/管理员；凭证引用可空但 unverified 状态如实。
- **Rollback**：新端点摘除。

### S1.8 Calibration fix
- **Goal**：分层配对修复 150/100 错配——重写 `buildScoreCalibration` 输入约定：配对函数强制同 scale+同 semantic+同 provenance 层；score-calibration.service 改从 ledger 读数（prediction 不再重建、直接读 ScorePrediction 行）；MAE/bias/coverage 按层输出。
- **Files**：`packages/shared/src/score-center/score-calibration.ts`（扩层，保持向后兼容输出）、`apps/api/src/study/score-calibration.service.ts`、`score-anchor` 投影。
- **Dependencies**：S1.5-S1.7。
- **Tests**：unit（混合量纲输入 → 拒绝配对 + 计数；E2E 的 26/96 case 复现为"proxy 层配对"而非混合 error）；regression（既有 V12-M5 20 项测试全部保持或按加强更新）。
- **Acceptance**：任何单一混合层 MAE 不再可能输出（构造性证明）；exclusions 语义保留。
- **Rollback**：服务改读旧路径（保留一版）。

### S1.9 APIs
- **Goal**：§7 六操作全量暴露（除 prediction 无公开创建）+ canonical 事件 + 审计。
- **Files**：`score-anchor.controller.ts`（新）、`canonical-event-writer.service.ts`（+4 类型，纯增量）、guards。
- **Dependencies**：S1.5-S1.8。
- **Tests**：contract（认证矩阵：401/403/404；幂等头；分页过滤）；事件发射断言。
- **Acceptance**：未认证全 401（部署后 401≠404 验证惯例）；学生无法触碰他人数据。
- **Rollback**：路由摘除。

### S1.10 UI
- **Goal**：ScoreAnchorPanel（§8 六要素）+ ExamDiagnosisPanel 来源标注增量。
- **Files**：`apps/web/src/features/report/ScoreAnchorPanel.tsx`（新）+ css（纯 token）+ `api/endpoints/scores.ts` + 报告页挂载。
- **Dependencies**：S1.9。
- **Tests**：组件行为测试（预测徽标不进成绩连线；无锚态文案；unknown 徽标）；build:web。
- **Acceptance**：静态演示模式 return null；预测/成绩视觉隔离被测试钉死。
- **Rollback**：摘除挂载。

### S1.11 E1
- **Goal**：§10 实验执行手册 + 只读分析脚本。
- **Files**：`docs/s1-e1-experiment-runbook.md`（新）；`scripts/analyze-score-anchor-e1.mjs`（只读 SQL/HTTP）。
- **Dependencies**：S1.9（录入通道）+ 教研判分人力（外部依赖）。
- **Tests**：脚本对夹具库的干跑（分层输出正确、混合层拒绝）。
- **Acceptance**：产出首份分层 MAE/bias/coverage 报告；gate 判定（n≥5 且 median<15）如实记录（不过即不过，禁止凑）。
- **Rollback**：只读，无。

### S1.12 Regression
- **Goal**：全量门禁 + 文档收口。
- **Files**：`docs/s1-final-report.md`（新）；`docs/current-sprint.md` 账本条目。
- **Dependencies**：S1.1-S1.11。
- **Tests**：`npm test`（基线 2324 + 新增零回归）、`build:api/web`、`test:integration:postgres` 及新 `test:integration:score-anchor`、失败分层归档。
- **Acceptance**：NEW REGRESSION=0；既有断言只加强不弱化。
- **Rollback**：文档回滚无生产影响。

**依赖图**：S1.3/S1.4（纯函数）→ S1.1 → S1.2 → {S1.5, S1.6, S1.7} → S1.8 → S1.9 → {S1.10, S1.11} → S1.12。

---

## 15. Design Gate Q1-Q8

**Q1 Score Ledger 能否成为未来 Score 的 SoT？**
**能（有条件）**。结构上：三写入口收敛、append-only、provenance 强制、量纲统一，均满足 SoT 资格。条件：过渡期与 AssessmentHistoryItem 双读并存（ledger 为新写入 SoT，旧表为兼容读路径），双读对账由集成测试钉死；S1 完成后旧表不再产生新写入语义。

**Q2 历史 AssessmentHistoryItem 怎么兼容？**
双读兼容 + 零回填为默认。可证据化迁移的行（paper 行经 sessionId 回链 → system_graded；`imported-` 前缀 → imported，id 前缀是记录在案的事实）走 opt-in backfill（独立批准、dry-run、可回滚）；examDate 缺失行保持 null+warning，**禁止用 submittedAt（录入日）冒充考试日**；无法证据化的行 provenance=imported/unknown，进 proxy 层与清理队列，不伪造。

**Q3 能否保证 prediction 不冒充 outcome？**
**能（构造性）**。三张独立表 + 三个写 API + 各自 guard——prediction 写路径在物理上不可达 outcome 表；跨类"升格"被禁止（correction 只在同类内）；时间线投影按 kind 分段渲染（UI 测试钉死）；data-quality 增加 prediction-after-outcome 与混层配对告警。现状的风险（校准影子把两者相减、前端把预测渲染进成绩语境）被 S1.8 与 S1.10 分别关闭。

**Q4 能否保证 150/100 不再混算？**
**能（构造性）**。normalizeScore 为所有写入口必经（缺 rawTotalScore 即拒绝，废除 `|| DEFAULT_TOTAL_SCORE` 回退）；`semantic` 字段区分 exam_points/accuracy_rate；配对函数以 (scale, semantic, provenance layer) 三元组相等为前置条件，混合输入被拒绝并计数——混合 MAE 从"可能的错误"变成"不可能的表达式"。

**Q5 能否支持未来 Score Loss / ROI？**
**能（ substrate 就绪，模型不在本阶段）**。ScoreLossItem 提供逐题失分 × nodeIds × errorType × questionType，正是 S3 ESL = OccurrenceProb×ScoreWeight×ErrorProb 所需的经验校准原料；normalizedScore 150 制给 ROI 提供分值货币；B13 未解析题以 `nodeResolution='unresolved'` 如实记录而非伪造归因。S1 本身不实现任何 ROI 计算。

**Q6 能否支持真实考试成绩？**
**能**。ScoreOutcome(real_exam) + examYear 唯一 + verificationStatus + evidenceRefs 凭证引用 + examDate 过去校验；User.examDate 使"距离考试天数"从手工整数变为事实派生。实考分录入属低频敏感操作，unverified→verified 的人员边界已定义（教师/管理员）。

**Q7 是否需要修改现有 contract？**
**不需要破坏性修改**。推荐引擎契约（sprint3-recommendation-contract）零触碰（S1 不改 priority/排序）；`estimatePredictedScore` 与 `score150Estimate` 公式零改动（仅持久化其输出）；canonical 事件 allowlist/RESERVED 为纯增量类型（既有惯例内）；score-calibration shared 函数的输出向后兼容（新增分层字段，既有字段语义不变）。无 `recommendation_engine_v2` 需求。

**Q8 schema 增量是否最小？**
**是**。四张新表 + 一列（User.examDate）+ 若干索引；全部 additive；无既有列类型/可空性改动；无数据迁移（默认零回填）；回滚 = DROP，AssessmentHistoryItem 等既有表零接触。对比替代方案（在 AssessmentHistoryItem 上加 provenance/kind 列） schema 更小但被 §2.0 六条论证否决——最小 schema 不等于最小风险，结构隔离购买的正是"写路径不可混淆"的不变量。

---

## 16. 判定

```text
S1 Design Gate = READY
```

依据：§15 八问全部可答且均为肯定；地基事实经本轮 Reality Check 重新核实（新增确认：预测分完全无持久化、paper 行 score=accuracyRate 语义、calibration error 未消费 totalScore）；schema 增量最小且可回滚；不触碰未批准的 S2/S3/S4；迁移兼容策略遵守"不为完整而推断历史来源"。

**前置条件（执行前必须满足，非本 Gate 缺陷）**：
1. S1.1/S1.2 的 schema 增量（四表一列）须所有者逐项批准（沿用 Question.rubric / review_attempt 迁移的先例门）。
2. E1 需要教研判分人力与真实学生样本（外部依赖，不阻塞 S1.1-S1.10 开发）。
3. 上线顺序维持仓库惯例：本地门禁全绿 → 所有者批准部署 → 生产 401≠404 硬门禁 → E1 采集。

**明确不在本阶段**：Transfer Probe（S2）、Recoverability/机会模型（S3）、排序货币切换（S4）、F4 Ability、Mastery 语义任何变更。

---

*本文件为 READ-ONLY 设计产物：零代码、零 schema、零迁移、零部署。完成后停止，不进入 S2/S3。*
