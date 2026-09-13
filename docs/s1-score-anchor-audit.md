# S1 Score Anchor — 事实基线审计（READ-ONLY AUDIT）

> 日期：2026-09-12 ｜ 性质：**READ-ONLY AUDIT + GAP CLASSIFICATION + FORMAL DESIGN**（零代码、零迁移、零写入、零部署）
> 基线：`feature/v3-product-refactor`，HEAD **`35f95b76`**，与 `origin` 同步（`git ls-remote` 核实）
> G1 代码目标 commit = `066e4eac`；`066e4eac` 之后的提交均为 ledger / documentation / audit tooling
> 事实来源：**当前仓库代码 / Prisma Schema / 迁移 / 测试 / 实测输出**（AGENTS.md §1）。文档与代码冲突时以代码为准，并在 §12 登记 drift。
> 本文件是本阶段**唯一产物**。

---

## 0. 关键前置发现：S1 已经存在（不是新阶段）

**本任务把 S1 描述为"下一阶段"，但 S1 已经实现、已合并、且已进入生产。** 这是本次审计最重要的发现，必须先讲清楚，否则后续所有"是否需要新增"的判断都会错。

**证据（全部可复现）**：

```text
git log --oneline | grep -i score
  5e810833  feat(score): establish score anchor evidence ledger        ← S1 实现提交
  fd866b08  docs(score): score improvement audit, reconstruction design, and S1 implementation plan

文件存在性（Test-Path）：
  prisma/migrations/20260912120000_score_anchor_foundation   → True  （迁移已入库，115 行）
  apps/api/src/score-anchor/                                 → True  （service / controller / dto）
  packages/shared/src/score-anchor/score-anchor.ts           → True  （纯函数契约，385 行）
  apps/web/src/features/report/ScoreAnchorPanel.tsx          → True  （学生可见面）
  scripts/integration-score-anchor.mjs                       → True
  test/score-anchor.test.js + test/score-anchor-service.test.js → True（26 + 21 项）
  docs/score-anchor-design.md / score-ledger.md / score-calibration.md / s1-score-anchor-implementation-plan.md → 全部 True
```

**生产侧**：账本记录 S1+S2 生产部署已完成，`migrate status` 为 **37 up to date**，其中唯一新迁移即 `20260912120000_score_anchor_foundation`；四表 + `User.examDate` 列经 psql 实证（`docs/current-sprint.md` 账本条目）。

**因此本审计的定位**：不是"从零设计 S1"，而是
1. **对公司自称已完成的 S1 逐条核验**（代码是否真的具备所声称的不变量）；
2. 把 S1 建成的事实基线与本任务书要求的字段/语义**逐项比对**，找出**仍未满足的部分**；
3. 登记 drift、给出 S1 STATUS。

**一处必须记录的 drift**：任务书写 `S2 Probe Content = BLOCKED BY CONTENT`、`verified probe questions = 0/60`——这与仓库实测一致（见 `docs/transfer-probe-content-readiness-report.md`）。但任务书**未记录 S1 已存在**，属上游编排层的状态漂移，非代码缺陷。

**一处必须记录的下游 stale**：`docs/audit/sp-guidance-infra-audit.md:148,219,260` 声称 `User.examDate` 的 writer = `NOT FOUND`。**该结论已过期**：`bde54521`（G1）新增了 `POST /coach/exam-date`，`apps/api/src/score-anchor/score-anchor.service.ts:111-118` 是唯一写入点（同时写 `examDate` 与派生 `remainingDays`）。以代码为准。

---

## 1. 审计范围与方法

| 项 | 内容 |
|---|---|
| 阅读 | `prisma/schema.prisma`、`prisma/migrations/20260912120000_*`、`apps/api/src/score-anchor/**`、`apps/api/src/study/score-*.ts`、`apps/api/src/score-center/**`、`apps/api/src/effectiveness/**`、`packages/shared/src/score-anchor/**`、`packages/shared/src/score-center/**`、`packages/shared/src/learning.ts`、`apps/web/src/features/report/**`、`apps/web/src/api/endpoints/*`、`test/score-*.test.js`、`scripts/integration-score-*.mjs`、`docs/*.md` |
| 实测（只读） | `git rev-parse` / `git ls-remote` / `Test-Path` / `Select-String` / `docker exec psql` 只读查询（仅测试库）/ `docker compose config`（渲染校验） |
| **未做** | 未连生产库、未登录生产 API、未运行任何写操作、未修改任何文件（本报告除外）、未部署 |
| 人格 | 审计者：不接受"文档说已实现"，只接受"代码与实测"。凡无法从仓库证明者标 `UNVERIFIED` |

---

## 2. §一 的 20 个问题（逐条回答 + 证据）

**图例**：`OBSERVED` = 系统直接观测到的事实；`DERIVED` = 由观测值确定性推导；`PROXY` = 代理量（不是测量对象本身）；`UNAVAILABLE` = 不存在/不可得。

| # | 问题 | 判定 | 证据与说明 |
|---|---|---|---|
| 1 | 是否已存在真实考试成绩 / 模考成绩 / Assessment Score？ | **部分 OBSERVED** | **表结构已就绪**：`ScoreAssessment`（`schema.prisma:1108`）、`ScoreOutcome`（`:1136`）可存三类成绩，`semantic` 区分 `exam_total`/`accuracy_rate`。**但生产行数为 UNVERIFIED**（本机无生产库访问）。**真实考研成绩的"自动"来源不存在**——只能靠学生/教师手工录入（`POST /coach/score-evidence/assessments|outcomes`） |
| 2 | `User` 是否有 examDate / targetExam 锚点？ | **`examDate` 有；`targetExam` 无** | `examDate`：迁移 `20260912120000/migration.sql:2` `ALTER TABLE "User" ADD COLUMN "examDate" TIMESTAMP(3)`（可空）。`targetExam`（目标考试实体）**NOT FOUND**（`grep 'targetExam'` 零命中）；只有 `User.targetScore`（自报目标分，非锚点） |
| 3 | 哪些 score 数据是**真实观测值**？ | 见 §3 | `ScoreAssessment`（教师/采分点判分、外部导入）、`ScoreOutcome`（实考）为**观测**；`ScorePrediction` 为**模型输出**，非观测 |
| 4 | 哪些只是 proxy？ | 见 §3 | `mastery`（EMA）、`accuracy`（练习正确率）、`selfScore`（主观题自评 ≥0.6 记对）、`priority`（0-100 无量纲）、`estimatePredictedScore`（目标插值）、`score150Estimate`（客观×80+主观自评）**全部是 PROXY**。三个已核实的输入伪影：①`averageMastery` 为空时**回落到 `report.accuracyRate`**，使 accuracy 在 `progress` 中被双重计权（0.3 + 0.5 = 0.8）；②`remainingDays` 在 Web 端 `?? 0`（`ReportSummaryPanel.tsx:71` → `timeFactor=0`），在校准端 `DAYS_FALLBACK = 240`（`score-calibration.service.ts:47,376,444` → `timeFactor=1`）——**同一个估计器在两侧取到相反极值**；③`estimatePredictedScore` 另有 `trendBoost = round(scoreTrend×0.4)`（±6 截断），使"分数"随近期趋势抖动 |
| 5 | 是否存在 150 分制归一化逻辑？ | **OBSERVED 存在** | `packages/shared/src/score-anchor/score-anchor.ts:21` `SCORE_NORMALIZED_TOTAL_SCALE = 150`；`:103-113` `normalizeScore` 归一为 150 并**拒绝**缺 totalScale（`missing_total_score`），无 `\|\| 150` 回退。注意 `validateScoreEvidence` 是**非对称**的：`rawScore` 允许为 null，`rawTotalScale` 永不（`:162`）——这与 §15 D-1 的表级 NOT NULL 一并构成一个"文档说可空、代码不可空"的边界 |
| 6 | ScoreCenter / Assessment / Test 数据能否构建 Score Ledger？ | **已经构建（S1）** | 四表已建（`ScorePrediction` `:1082` / `ScoreAssessment` `:1108` / `ScoreOutcome` `:1136` / `ScoreCorrection` `:1165`）+ 迁移已应用（37 up to date）。**但见 §4 的字段缺口**：`subjectScores` 不存在 |
| 7 | Score 是否有 provenance / source / timestamp？ | **OBSERVED 存在** | 三表均有 `source`（枚举见 §3.2）；时间字段分工明确：`ScoreAssessment.recordedAt`（记录时刻）与 `ScoreAssessment.examDate`（考试发生时刻，可空，注释明言"recordedAt must never impersonate it"，`schema.prisma:1119-1121`）；`ScoreOutcome.occurredAt`（必填，写入时必须过去） |
| 8 | 能否区分 practice / review / assessment / mock / real exam？ | **PARTIAL** | **assessment / mock / real exam 可区分**：`ScoreAssessment.originType`（`paper_session \| external_import \| teacher_entry \| diagnostic`）+ `source`；`ScoreOutcome.examType`（`real_exam \| institution_verified \| teacher_verified_mock`）。**practice / review 不进 ledger**（它们是 Activity/Evidence 层，不产生 Score 记录）；`PracticeRecord` 与 `ReviewAttempt` 是两条独立链 |
| 9 | 能否区分 predicted / assessed / actual outcome？ | **OBSERVED 可区分，且是构造性的** | D1 决策：**三张表、三个写路径、三套守卫**（`docs/score-anchor-design.md:15-23`）。代码事实：三个独立 `@Post` 入口（`score-anchor.controller.ts:33,46,61`），无任何单一方法可写多类。表隔离使"把预测升格为成绩"在 schema 层不可表达 |
| 10 | Score 是否会反向修改 Mastery？ | **NO（已核实）** | `grep 'userKnowledgeMastery\.(create\|update\|upsert\|delete)' apps/api/src` → **仅 2 处**，均在 `apps/api/src/score-center/repository.ts:153,171`（OCC 保存助手）。`apps/api/src/score-anchor/*` 与 `score-calibration.service.ts` **零 mastery 写**（只有 `score-opportunity.service.ts:81` 一次 `findMany` **读**）。**Score 层不能写 mastery，结构性成立** |
| 11 | 是否存在 Score → Knowledge Node 的映射？ | **PARTIAL** | `apps/api/src/study/exam-diagnosis.ts:100-200` 的 `nodeLoss` 把**失分题**经节点解析归因到 `knowledgeNodeId`（`:175-182`），但归因单位是 **丢题数**，不是分值。**ScoreAssessment / ScoreOutcome 本身没有节点维度**（无 `nodeId` 列、无逐题行） |
| 12 | 能否建立 Score Loss → Ability Gap？ | **NO（当前不可）** | `ScoreLossItem`（逐题失分行）**NOT FOUND**（`grep -r 'ScoreLossItem\|scoreLoss' prisma/ packages/shared/src apps/api/src` 零命中）——与设计文档 §5.1「ScoreLossItem 延后」一致。没有逐题失分，就没有"哪一分丢在哪个考点"，`nodeLoss` 只是题数代理。**见 §4** |
| 13 | 能否计算 Recoverable Score？ | **NO（影子层只有代理因子）** | `RecoverableScore` / `ExpectedScoreLoss` 符号 **NOT FOUND**。最接近的是 `score-opportunity.ts` 的 `recoverability` 因子，其自述为 **PROXY**：`score-opportunity.ts:68-72` "系统没有'可恢复性'的直接测量"，`maxConfidence: 'low'` |
| 14 | 哪些数据可以直接使用？ | 见 §3「可直接复用」 | 考频快照（`KnowledgeFrequencySnapshot`，测试库实测 1154 条）、真题分值 `primaryScore5y`、`UserKnowledgeMastery`、`examDate`、四张 ledger 表、`normalizeScore` / `isCalibrationCompatible` / `evaluateCalibrationGate` 纯函数 |
| 15 | 哪些数据缺失？ | 见 §3「UNAVAILABLE」 | 逐题失分（ScoreLossItem）、`subjectScores`（分科分）、`targetExam` 实体、真实考试成绩的自动来源、Recoverability 的直接测量、TrainingCost 实测用时、probe 内容（0/60） |
| 16 | 哪些数据存在但**语义不可信**？ | 见 §3「不可信」 | ①`AssessmentHistoryItem` 混装系统判分与自报导入且**无来源字段**（只能靠 id 前缀约定）；②`estimatePredictedScore` 的输入含**自报** `currentScore/targetScore`；③`remainingDays` 手填却被决策层当作 `daysToExam`；④主观题 `selfScore ≥ 0.6` 记对 |
| 17 | 哪些只有 proxy、没有真实证据？ | 见 §3「PROXY 清单」 | mastery / accuracy / priority / predicted score / score150Estimate / recoverability / trainingCost |
| 18 | 推荐用的 `priority` 是否已隐含 score value？ | **部分 YES（弱）** | `packages/shared/src/score-center/priority.ts:44-50`：`examValue = 0.38×(recent3Y/5) + 0.30×(recent5Y/5) + 0.16×(allTime/5) + 0.10×(importance/5) + 0.06×(primaryScore5y/45)`——即 **examValue 内已同时含「考试频次」与「真题分值（ScoreWeight）」以及「重要度」**；`weakness`（`:55-58`）的主项是 `0.52×(1−mastery)`。因此 **Priority / Importance / Frequency / Mastery 四者早已在 priority 内部被编码**，只是整个 priority 是无量纲 0-100，**不回答"值几分"**。这一点是 §7.4 双重计数分析的直接前提 |
| 19 | Score Opportunity Shadow 能否复用？ | **可复用（零件齐、未转正），但有三个已核实的缺陷** | `packages/shared/src/score-center/score-opportunity.ts`（361 行，纯函数，"Pure: zero imports" `:28`）+ `apps/api/src/study/score-opportunity.service.ts`。**可复用面**：逐因子 `source` 声明 + `maxConfidence` 上限 + 必需因子（`weakness`/`examImportance`/`trainingCost`）缺失即 `score=null` 并给 blocker（拒绝伪造）。**三个缺陷**：①**三套量纲同处一个对象**——opportunity `score` ∈ [0,1]、priority `score` ∈ [0,100]、`expectedBenefit` ∈ 0–14 **分**；②`expectedBenefit`（`:318-325`）用 `weakness×importance×6~14` **直接给出"估算提分 X–Y 分"的考试分主张**，其自述为 "A band, deliberately wide: this is an estimate, not a measurement"，**从未被任何真实分数校准**；③**两个入口对同一字段用了不同归一**：`score-opportunity.service.ts:129,146-147` 用 `primaryScore5y / maxPrimaryScore`（**相对**该数据集最大值），而 `shadow-decision-chain.ts:229-230,243-244` 用 `Math.min(1, primaryScore5y/45)`（**绝对**）→ **两个端点输出的 opportunity 分数不可比** |
| 20 | 是否有 score calibration？量纲不一致问题是否仍在？ | **有；主路径已结构性修复，但共享 legacy 函数仍留一个洞** | **已修复的两条**：①严格路径 `score-calibration.ts:176-206` 走 `isCalibrationCompatible`，输出 `scalePair: '150/150'`；②API 层在配对前按语义排除非 `exam_total` 行（`score-calibration.service.ts:200-206`）。**残留洞（已核实）**：`score-calibration.ts:212` 的守卫是 `if (pair.totalScore != null && pair.totalScore !== 150)`——**`totalScore == null` 时守卫不触发**，`:220` 仍执行 `round2(pair.actualScore - pair.predictedBest)`。因此一个 `actualScore=96, totalScore=null, predictedBest=26` 的调用**仍会得到 error=70**，正是文档头描述的"毫无意义的数字"。**共享纯函数仍允许该配对；只有 API 层通过派生 `semantic='accuracy_rate'` 把它挡住**。另有一处同源问题：`score-anchor.service.ts:612` 在构造 `evidenceRef` 时**硬编码** `normalizedTotalScale: SCORE_NORMALIZED_TOTAL_SCALE`，而非读该行的真实值（`:549-570` 的映射丢掉了该字段）→ **该路径上的 scale 检查是同义反复**，真正设防的是写入时盖章 + 语义门 |

---

## 3. 六类概念严格分离（Activity / Evidence / Ability / Assessment / Score / Outcome）

### 3.1 分层表

| 层 | 系统载体 | 类型 | 说明 |
|---|---|---|---|
| **Activity** | `PracticeRecord` / `ReviewAttempt` / `LearningSession` / `StudyTaskCompletion` / `UserEvent` | **OBSERVED** | "发生了动作"。V12 已用测试钉死：**活动标记永不构成能力证据**（`learning-evidence.ts:17`） |
| **Evidence** | `UserEvent(type='EVIDENCE_RECORDED')`，强度 `none \| weak \| strong`（`learning-evidence.ts:41-43`） | **OBSERVED** | "观测到了什么表现"。只有 `objective_performance` / `recall_outcome` 可影响 mastery |
| **Ability** | `UserKnowledgeMastery`（唯一写方 `ScoreCenterService`，OCC） | **PROXY** | 对**练习题二值正确率**的 EMA 追踪，**不是**考试能力。效度威胁：自评污染、方向瞬态、neutral 0.5 先验、confidence=样本量函数 |
| **Assessment** | `ScoreAssessment`（ledger）/ `AssessmentHistoryItem`（legacy）/ `LearningSession(type='paper')` | **OBSERVED（ledger）/ 不可信（legacy）** | "一次被测量的表现"。ledger 行有 provenance；legacy 行无来源字段 |
| **Score** | `ScorePrediction`（模型输出）、`estimatePredictedScore`、`score150Estimate` | **PROXY** | "系统认为你会考多少"。启发式插值，从未与真实分对照（校准样本 = 0） |
| **Outcome** | `ScoreOutcome`（`occurredAt` 必填、`verificationStatus` 单向 unverified→verified） | **OBSERVED（但生产样本 UNVERIFIED）** | "已发生的最终成绩"。**外部输入 depend**：只能靠录入 |

### 3.2 Provenance 枚举（`score-anchor.ts:24-43`）

```text
MOCK           系统客观判分（in-app 整卷）      → proxy 层
DIAGNOSTIC     入学诊断测                      → proxy 层
TEACHER_GRADED 教师录入/判定                   → primary 层
RUBRIC_GRADED  采分点评分                      → primary 层
REAL_EXAM      真实考研成绩                    → primary 层
IMPORTED       外部成绩（学生录入/机构）        → proxy 层
UNKNOWN        显式未知（遗留迁移等）           → null（永不进 primary）
MODEL_OUTPUT   预测行专用
```

分层由 `calibrationLayerOf()`（`score-anchor.ts:67-71`）实现：`PRIMARY_SOURCES = {TEACHER_GRADED, RUBRIC_GRADED, REAL_EXAM}`（`:56-60`），`PROXY_SOURCES = {MOCK, DIAGNOSTIC, IMPORTED}`（`:61-65`），其余返回 `null`。

### 3.3 严禁的替代（明确写入本审计）

以下**不得**被描述为 `score gain`：

| 量 | 实际是什么 | 判定 |
|---|---|---|
| `mastery gain`（如 effectiveness 的 `masteryGain 0.3418`） | 掌握度 EMA 增益 | **Ability 层 PROXY**，不是分数 |
| `accuracy gain` | 练习/复习正确率变化 | **Evidence 层**，不是分数 |
| `learning activity`（任务完成、打卡、连击） | 活动标记 | **Activity 层**，宪法级"永不构成证据" |
| `RAG retrieval hit`（top3Hit 91.7%） | 检索质量 | **基础设施指标**，与学习无关 |
| `recommendation priority`（0-100） | 无量纲排序值 | **决策层 PROXY**，不回答"值几分" |

### 3.4 四态分类总表

| 数据 | 态 |
|---|---|
| `ScoreAssessment`（教师/采分点/导入） | **OBSERVED** |
| `ScoreOutcome`（实考/机构/教师验证） | **OBSERVED**（生产样本 `UNVERIFIED`） |
| 归一化分 `normalizedScore` | **DERIVED**（`normalizeScore`，确定性） |
| 校准 MAE / bias / median / withinRange | **DERIVED**（由 OBSERVED 配对算出） |
| `ScoreOutcome.verificationStatus` | **DERIVED**（状态机） |
| `UserKnowledgeMastery.mastery` | **PROXY** |
| `PracticeRecord.correct` → accuracy | **PROXY**（对"能力"而言） |
| `Question.selfScore ≥ 0.6 → correct` | **PROXY（污染源）** |
| `estimatePredictedScore` | **PROXY** |
| `score150Estimate` | **PROXY** |
| `priority` | **PROXY** |
| `exposure / examValue / weakness / forgetting` 分量 | **PROXY** |
| `recoverability`（opportunity 因子） | **PROXY**（自述 low confidence） |
| `trainingCost`（opportunity 因子） | **PROXY**（`estimateMinutes` 估算，非实测） |
| `nodeLoss` | **PROXY**（丢题数 × 考频，非分值） |
| 逐题失分 `ScoreLossItem` | **UNAVAILABLE** |
| `subjectScores`（分科分） | **UNAVAILABLE** |
| Recoverable Score / Expected Score Loss | **UNAVAILABLE** |
| 真实考试成绩的自动来源 | **UNAVAILABLE**（只能录入） |
| Recoverability 的直接测量 | **UNAVAILABLE** |
| 实测 TrainingCost（用时遥测） | **UNAVAILABLE** |
| `effectiveness` 的 `examScorePercent` / `examScoreDelta` | **UNAVAILABLE（结构上恒 null）**：`effectiveness.service.ts:461-462,474` 声明但**从未填充** |
| probe 内容 | **UNAVAILABLE**（0/60，见内容就绪度报告） |
| `CALIBRATION_MAX_ATTEMPTS = 20` | **DEAD CODE**：声明于 `mastery-calibration.ts` 但全仓无使用点（grep 仅命中定义） |

---

## 4. §三 Score Ledger：最小概念模型 vs 现状

### 4.1 三张表是否需要独立 persistence

**需要，且已经实现。** 理由（`docs/score-anchor-design.md:15-23` 的 D1，代码已落实）：写路径授权不同、字段级不变量不同、跨类配对成为类型层约束、修正语义不同、保留策略不同（prediction 可弃，outcome 永久）。代码事实：三个独立 `@Post` 入口（`score-anchor.controller.ts:33` predictions / `:46` assessments / `:61` outcomes）。

### 4.2 字段清单核对（任务书要求 vs 实际）

| 要求字段 | 现状 | 位置 | 判定 |
|---|---|---|---|
| `source` | ✅ 三表均有 | `schema.prisma:1094,1113,1146` | 满足 |
| `timestamp` | ✅ `generatedAt` / `recordedAt` / `occurredAt` / `correctedAt` | `:1099,1124,1149,1173` | 满足（且 `recordedAt` 与 `examDate`/`occurredAt` **语义分离**） |
| `provenance` | ✅ `source` + `originType`/`originId`/`dedupKey`/`predictionKey` | `:1109-1110,1139,1085` | 满足 |
| `normalizedScore` | ✅ 三表均有（`Float?`，150 制） | `:1112,1140,1166`… | 满足 |
| `rawScore` / `scale` | ✅ `rawScore` + `rawTotalScale`（原始量纲永不丢失） | `:1111,1113` | 满足 |
| `assessmentType` | ⚠️ 拆成 `originType`（assessment）/`examType`（outcome）/`semantic`（口径）/`gradingMethod`（判分方式） | `:1109,1138,1114,1115` | **满足但非单字段**；四字段语义清晰，不建议合并 |
| `examDate` | ✅ `ScoreAssessment.examDate`（可空）；`User.examDate`（可空） | `:1122`；迁移 `:2` | 满足 |
| **`subjectScores`（分科分）** | ❌ **不存在** | `grep 'subjectScores' prisma/ packages/shared/src apps/api/src` → 零命中 | **GAP** |
| **`targetExam`（目标考试实体）** | ❌ **不存在**（只有 `User.targetScore` 自报目标分） | `grep 'targetExam'` → 零命中 | **GAP** |

**其他已核实的字段级事实**（写入审计基线）：

| 事实 | 证据 | 意义 |
|---|---|---|
| 四表**均无 `updatedAt`** | `schema.prisma:1084-1183`（无任何 `@updatedAt`） | 结构上支持 append-only：没有"最后修改时间"可被误改 |
| `ScorePrediction.source` 默认 `'MODEL_OUTPUT'`，**不在 `SCORE_SOURCES` 枚举内** | `schema.prisma:1098`；`score-anchor.ts:33-41` | 预测行的 provenance 用了枚举外的值；`calibrationLayerOf('MODEL_OUTPUT')` 返回 `null`——**语义上安全（预测本就不该进校准分母），但枚举一致性有缺口** |
| `ScoreOutcome.dedupKey` 可空 + `@@unique([userId, dedupKey])` | `schema.prisma:1142,1163`；`score-anchor.service.ts:339-347` | 依赖 Postgres 的 NULL-distinct 语义：**无 key 的行永不去重**（与注释一致，属有意设计，但会静默累积重复 outcome） |
| `ScorePrediction` 的 0–150 边界只在 DTO | `dto/score-evidence.dto.ts:37-52`（`@Min(0) @Max(150)`）；服务只校验区间顺序 `:145-150` | 绕过 HTTP 直接调用服务层可写入越界预测（如 `predictedScore=999`） |
| 模块内仅 2 个 `.update(` | `score-anchor.service.ts:111,410` | append-only 的精确范围见 §4.4 |

### 4.3 必须支持 mock / assessment / real exam

> **注意（已核实并修正）**：`ScoreAssessment.originType` 在代码中**只可能取两个值** —— `apps/api/src/score-anchor/score-anchor.service.ts:217` `const originType = actor.role === 'student' ? 'external_import' : 'teacher_entry'`。Schema 注释（`schema.prisma:1113`）列出的 `paper_session | diagnostic` **在代码中永不产生**（`grep 'paper_session'` 在 `apps/api/src` 只命中注释）→ **vocabulary drift，见 §15 D-4**。

| 类型 | 支持方式 | 证据 |
|---|---|---|
| mock（in-app 整卷） | 走内部 `recordPaperAssessment`（`role:'admin'`）→ **`originType='teacher_entry'` + `source='MOCK'` + `semantic='accuracy_rate'` + `rawTotalScale: 100`** | `score-anchor.service.ts:274-299`；调用点 `study.service.ts:2119,4763` |
| assessment（教师/导入） | `originType='external_import'`（学生）/ `'teacher_entry'`（教师） | `:217`，来源随角色强制 |
| real exam | `ScoreOutcome.examType='real_exam'` + `source='REAL_EXAM'` + `verificationStatus` | `:336-337`，`recordOutcome` |

### 4.4 append-only 与 correction

| 要求 | 实现 | 证据 |
|---|---|---|
| 证据行**永不 UPDATE** | ✅ | `ScoreCorrection` 追加；`resolveCorrectedEvidence`（`score-anchor.ts:370`）按 `correctedAt` 升序折叠，晚者胜 |
| correction = new record | ✅ | `ScoreCorrection` 表（`:1165`）；无 `@@unique([targetKind,targetId])` → 允许多条修正链 |
| 禁止静默覆盖 | ✅ | 可修正字段**白名单** `rawScore/rawTotalScale/normalizedScore/semantic/gradingMethod/examDate/occurredAt/title`；`source` 与 `verificationStatus` **不可修正**（防来源洗白） |
| 唯一例外 | ✅ 且是单向的 | `ScoreOutcome.verificationStatus` 仅 `unverified → verified`，仅经 teacher/admin 端点（`score-anchor.service.ts:385,410-414`；学生 403 于 `:393-395`；teacher 需授权记录 `:396-406`） |
| **append-only 的精确范围** | ⚠️ 需精确表述 | 模块内**只有两个 `.update(`**：`:111`（User.examDate）与 `:410`（ScoreOutcome 验证列）。`grep 'scoreAssessment\.update\|scorePrediction\.update\|scoreCorrection\.update'` → **NOT FOUND**。因此精确说法是：**append-only，唯一例外是 outcome 的三个验证列**（`verificationStatus/verifiedBy/verifiedAt`），无 `updatedAt` 列可被误改（四表均无 `@updatedAt`） |
| **修正链的校验缺口** | ⚠️ **GAP（已核实）** | `recordCorrection`（`:424-481`）只在**未显式提供** `normalizedScore` 时才重算（`:449-458`）；调用方若显式给出 `normalizedScore`，**完全绕过 `normalizeScore` 的范围/量纲校验**，仅剩 `:459-461` 的类型检查。`correctedFields` 的 DTO 只有 `@IsObject()`（`dto/score-evidence.dto.ts:159-160`）→ `semantic` / `gradingMethod` / `title` / `examDate` 在修正路径上**无枚举/格式校验**。且 `targetId` **无外键**，引用完整性仅靠应用层。另：`targetKind` 的 DTO 只允许 `assessment \| outcome`（`:152`），而 schema 注释写 `prediction \| assessment \| outcome` → **prediction 实际不可修正**（见 §15 D-4） |

### 4.5 迁移是纯增量（已核实）

`prisma/migrations/20260912120000_score_anchor_foundation/migration.sql`（115 行）：**1 × `ALTER TABLE ADD COLUMN`（可空）+ 4 × `CREATE TABLE` + 8 × `CREATE INDEX` + 4 × `ADD FOREIGN KEY`**。**零 DROP、零 RENAME、零数据改写** → 回滚 = DROP，零既有表接触。

### 4.6 概念的 `subjectScores` 缺口（设计提案，不实现）

任务书要求 `subjectScores`。**当前不存在**。最小增量设计（**本阶段不实现**）：

```text
方案 A（推荐）：ScoreAssessment.subjectScores Json?  +  ScoreOutcome.subjectScores Json?
  形状：{ DS: number, CO: number, OS: number, CN: number }（各科归一化到该科满分的 150 制可比值）
  来源：in-app 整卷提交时按科聚合（已在 getExamReport 有分科统计）；外部导入可选填
  理由：不新增表、单行列内聚、与 raw/normalized 同生命周期；缺失 = null（诚实缺席，非 0）
方案 B：独立 ScoreSubjectScore 行表（scoreId, subject, rawScore, rawTotalScale, normalizedScore）
  理由：可逐科 provenance/时间；代价：多一张表 + 多一条 join
裁决建议：先 A；只有出现"分科成绩来自不同来源/不同时间"的真实需求时才升 B
```

---

## 5. §四 Score Anchor：Real Score → Score Loss → Ability Gap（设计）

### 5.1 Score Loss 如何定义

**分层定义，诚实标注哪一层存在、哪一层不存在**：

```text
L0  观测失分（OBSERVED）     ：某场 assessment/outcome 的 actual 与满分之差 = rawTotalScale − rawScore
                              今天可得（每场一个标量）。但**无逐题粒度**。
L1  逐题失分（UNAVAILABLE）  ：每一道错题的 lostScore = question.maxScore × (1 − earned)
                              今天**不存在**（ScoreLossItem 缺失）。这是 ScoreAnchor 的**头号数据缺口**。
L2  节点归因失分（PROXY）     ：把 L1 按 PRIMARY 节点聚合 = Σ lostScore(node)
                              今天只有**题数版**：exam-diagnosis.ts:175-200 的 nodeLoss = lostCount × recent5Frequency
                              → 排序用"丢题数 × 考频"，**不是分值**
L3  分科失分（UNAVAILABLE）   ：Σ lostScore(subject)，依赖 subjectScores（§4.6）
L4  期望失分 ESL（DERIVED）   ：OccurrenceProb × ScoreWeight × ErrorProb —— **属 S3，本阶段不实现**
```

**定义（本审计提出的最小可信定义）**：

```text
observedLoss(assessment) = rawTotalScale − rawScore            （L0，OBSERVED，今天可得）
nodeLoss(node, assessment) = Σ_{q ∈ lostQuestions(node)} lostScore(q)   （L2，需要 L1 才成立）
```

**关键约束**：L2 在没有 L1 时**不得**用 `lostCount × examFrequency` 冒充分值——今天 `nodeLoss` 就是这么排的，它是**排序代理**，不是失分。审计要求在任何面向"分数"的呈现中把它标为 `PROXY（题数代理）`。

### 5.2 Ability Gap 如何从已有数据推导

**只有一条诚实的路径**，且它产生的是 **PROXY 的能力缺口**，不是分数缺口：

```text
Ability Gap(node) ≈ 1 − normalizedMastery(node)          （PROXY，来源：UserKnowledgeMastery.mastery）
```

**禁止**把 `Ability Gap × ScoreWeight` 当成"可恢复分数"直接呈现给学生——它同时依赖两个 PROXY（mastery 的效度威胁 + ScoreWeight 的粒度），且没有任何真实分数对照过它。这正是任务书禁止的 `Expected Recoverable Score = North Star`。

**唯一能让 Ability Gap 变成 OBSERVED 的东西**：逐题失分（L1）+ 节点归因（已有解析器）+ 真实的 `ScoreWeight`（已有 `primaryScore5y`）。即：**L1 是解锁点**。

### 5.3 哪些分数损失是可解释的

| 可解释（有事实链） | 不可解释（模型估计） |
|---|---|
| 某场考试丢了多少分（L0，raw 可查） | 某个节点"应该"丢多少分（ESL） |
| 哪几道题错了（`lostQuestionIds`，`getExamReport` 已透出） | 这些题"值多少分"（today: 无 maxScore 逐题） |
| 错题归因到哪些节点（`nodeLoss`，已有） | 节点"可恢复多少"（recoverability = PROXY，low） |
| 该学生的考频/分值事实（`primaryScore5y`，OBSERVED） | 训练"要花多少分钟"（`estimateMinutes` 估算） |
| 分科正确率（`getExamReport` 有分科统计） | 分科**分值**（无 `subjectScores`） |

### 5.4 如何防止 mastery → score 的循环论证

**循环论证的两种形态，必须分别封堵**：

```text
形态 1（直接回流）：分数去改 mastery，mastery 再去"解释"分数。
  → 已被结构性封堵：mastery 唯一写方 = apps/api/src/score-center/repository.ts:153,171；
    score-anchor 模块零 mastery 写（实测 grep）。**保持这条不变量是硬要求。**

形态 2（间接自证）：用 mastery 推出"期望分数"，再用该期望分数去验证 mastery。
  → 这是真正的风险，今天**尚未发生但极易发生**（§6 双重计数）。
  → 封堵规则（本审计提出，交 Design Gate 裁决）：
     R1  任何"期望/可恢复分数"必须标注其推导链上的每个 PROXY 与置信上限；
     R2  期望分数**不得**与预测分做校准配对（预测 × 预测 = 无信息）；
     R3  校准的分母只允许 PRIMARY 层（TEACHER_GRADED / RUBRIC_GRADED / REAL_EXAM）；
     R4  期望分数不得进入任何"已验证"叙事（North Star 不变，见 §5.5）。
```

### 5.5 North Star 声明（不可被替换）

```text
North Star = Verified Score Gain / 30d
```

**代码现状核实**：`grep 'Verified Score Gain'` 只命中 **docs**（`score-improvement-reconstruction-design.md:88,422`、`s2-*`、`current-sprint.md`），**代码中不存在**该指标的任何实现。因此：

- North Star 目前是**声明的目标**，不是被测量的量 → 需要一个"Verified Score Gain"的只读投影（**属后续阶段，本阶段不实现**）。
- `Expected Recoverable Score` **只能作为内部决策变量**（可用于排序输入/影子对照），**不得**成为 North Star，**不得**对学生展示为"你能提多少分"。
- **本审计自我约束**：报告内不出现任何"预计可提高 X 分"的表述。

---

## 6. §五 Student / Exam Anchor

| 问题 | 判定 | 证据 |
|---|---|---|
| 当前是否存在 `examDate` | **存在**（`User.examDate`，可空） | 迁移 `20260912120000/migration.sql:2` |
| 是否需要新增 | **不需要**（列已存在） | 同上 |
| 如何进入 Student State | **已进入**：`GET /coach/score-evidence` 透出 `examDate`（`score-anchor.service.ts:726` `examDate: user?.examDate?.toISOString() ?? null`） | 同上 |
| 如何支持距离考试天数 | **不通过 examDate**：`ScoreAnchorPanel`/`ExamDateCard` 由 G1 新增的 `deriveExamDateState` 从 `examDate` 派生显示 | `packages/shared/src/guidance/exam-date.ts` |
| **是否会影响推荐** | **NO（关键缺口）** | 决策层读的是 **`remainingDays`**，不是 `examDate`：`apps/api/src/study/score-opportunity.service.ts:249-257` `resolveDaysToExam(user)` → `user?.remainingDays ?? 96`；推荐引擎同源自 `recommendation.service.ts:117`。**`examDate` 未进入决策层** |
| 是否会污染 canonical mastery state | **NO** | mastery 唯一写方 `score-center/repository.ts:153,171`；`examDate` 无任何路径通向它 |

### 6.1 发现的三个语义风险（必须登记）

**R-1 `remainingDays` 双写者，可能漂移。**
`remainingDays` 有两条写入路径：① onboarding/diagnostic 表单（自报天数）；② G1 新增 `POST /coach/exam-date`（由 `examDate` **派生**写入，方向正确、不违反 D6 的"禁止从 remainingDays 回填 examDate"）。
**但**：学生若先设 `examDate` 再走 onboarding（或反之），两值可分歧，而**决策层只读 `remainingDays`** → 考试临近度可能与事实不符。
**风险级别：中（会改变排序输入）。** 处置建议：**不在本阶段改**（会动排序输入），登记为 Design Gate 议题。

**R-2 D6 的意图尚未落地。**
`docs/score-anchor-design.md:41-43` D6 声明"`remainingDays` 降级为遗留派生缓存（本阶段不改其消费方）"——措辞诚实（承认未改消费方）。但结果是：**S1 建立了 `examDate` 事实，决策层却仍活在旧缓存上**。审计结论：**S1 的锚点目前只服务展示与校准，不服务决策**。

**R-3 `UNVERIFIED` 声明。**
生产库中 `ScoreAssessment` / `ScoreOutcome` / `ScorePrediction` 的**行数无法从本机核实**（无生产库访问、无学生 token）。部署记录证明**表存在、迁移已应用**，但"生产是否已有真实成绩数据"= **UNVERIFIED**。任何"生产已有 N 条成绩"的说法都不得写入下游文档。

---

## 7. §六 与现有 Score Opportunity 的关系

### 7.1 它在哪里、用什么字段

| 项 | 位置 |
|---|---|
| 纯模型 | `packages/shared/src/score-center/score-opportunity.ts`（361 行，零依赖） |
| 因子目录（公开常量） | `SCORE_OPPORTUNITY_FACTORS`（`:54-91`）：`weakness`(0.28) / `examImportance`(0.22) / `recoverability`(0.12) / `evidenceConfidence`(0.08) / `urgency`(0.12) / `trainingCost`(0.18) |
| 装配 | `apps/api/src/study/score-opportunity.service.ts` |
| 暴露 | `GET /coach/score-opportunity`（teacher/admin） |
| 是否真实可观测 | **部分**：`weakness`/`examImportance`/`evidenceConfidence` 来自真实表；`recoverability` 自述 **PROXY（maxConfidence: low）**；`trainingCost` 为 `estimateMinutes` **估算（maxConfidence: medium）** |

### 7.2 是否可复用

**可以，且应当复用**——它已经具备本任务书要求的诚实性纪律：逐因子 `source` + `maxConfidence` + 必需因子缺失即返回 `null` 并给出 blocker（拒绝用替代值估算）。**不要另起一套模型。**

### 7.3 是否存在自引用

**未发现**：`score-opportunity.ts` 零 import（`:28` "Pure: zero imports"），不读推荐排序输出、不读自身结果。**无循环**。

### 7.4 **Double counting 分析（本节核心）**

任务书要求逐项核对 `Expected Score / Expected Recoverable Score / Priority / Importance / Frequency / Mastery` 是否重复计数。实测结论：

| opportunity 因子 | 其数据来源（`score-opportunity.ts`） | priority 中已编码同一量的分量（`priority.ts:44-66`） | 判定 |
|---|---|---|---|
| `weakness` 0.28 | `UserKnowledgeMastery.mastery` → 1−mastery（`:56-59`） | `weakness = 0.52×(1−mastery) + 0.38×(1−recentAccuracy) + 0.10×min(1,wrongCount/8)`（`:55-58`） | **DUPLICATE**（同一输入 `1−mastery`，opportunity 版还更弱） |
| `examImportance` 0.22 | `recent3Frequency / recent5Frequency / allTimeEvidence / primaryScore5y`（`:62-65`） | `examValue = 0.38×(recent3Y/5) + 0.30×(recent5Y/5) + 0.16×(allTime/5) + 0.10×(importance/5) + 0.06×(primaryScore5y/45)`（`:44-50`） | **DUPLICATE**（同一组输入；**Frequency 与 ScoreWeight 都已在 `examValue` 内**） |
| `urgency` 0.12 | `daysToExam` + `retention/stabilityDays`（`:80-83`） | `forgetting = forgetting ?? (1−retention)`（`:61-63`） | **PARTIAL OVERLAP**（retention 一侧重复；daysToExam 一侧 priority 以 `phaseMultipliers(daysToExam)` 乘子形式也已编码，见 `:31-35`） |
| `evidenceConfidence` 0.08 | `KnowledgeFrequencySnapshot.evidenceConfidence`（`:74-78`） | priority **公式内不含**；仅作为 `LOW_EVIDENCE` 理由码出现（`priority.ts:109`） | **INDEPENDENT**（无重复） |
| `recoverability` 0.12 | 代理（曾做对 + 前置就绪）（`:68-72`） | 无对应分量 | **INDEPENDENT** |
| `trainingCost` 0.18 | `estimateMinutes(action, difficulty)`（`:86-89`） | `estimateMinutes` 只用于预算装填（`plan.ts:129`），**不进 score** | **INDEPENDENT**（角色不同，无重复） |

**结论**：**6 个因子中 2 个完全重复（`weakness` 0.28、`examImportance` 0.22）、2 个部分重复（`urgency` 0.12、`trainingCost` 0.18），合计权重约 0.80。** 若 S3 把 opportunity 与 priority 组合使用（例如"opportunity 作为 priority 的新分量"），**约 0.80 的权重会与既有权重双重计数同一批底层输入**（`examValue` 已含频次+分值+重要度；`weakness` 主项即 `1−mastery`；`forgetting` 即 `1−retention`；`difficulty` 与 `estimateMinutes` 同源）。

补充两处让重复计数更严重的实现细节（已核实）：
- `score-opportunity.service.ts:153` 把 `recentWrongCount: 0` **硬编码**，因此 opportunity 内部的 `classifyAction` **永远不可能返回 `WRONG_QUESTION`** —— 它复用了 priority 的动作分类器，却在输入上丢了错题数。
- `trainingCost` 调用 `classifyAction(mastery, recentAccuracy, forgetting, days)` + `estimateMinutes`，而这三个输入**同时**被 `weakness`/`urgency` 计过一次 → 属"同一输入被两个因子分别计权"的形态。

**必须交给 Design Gate 的处置建议（本阶段不实现）**：

```text
DC-1  不得把 opportunity 分数直接加进 priority 公式（会造成 0.62 权重的双重计数）。
DC-2  若必须组合，选择其一：
      (a) 替换：用 opportunity 的 6 因子**取代** priority 的同名分量（examValue/weakness/forgetting），
          只保留 priority 独有的 difficulty/trend/pinned；
      (b) 正交化：从 opportunity 中**移除** weakness / examImportance / urgency 的重复部分，
          只保留 recoverability / trainingCost / evidenceConfidence，作为"修正乘子"而非新增加项。
DC-3  无论选哪条，必须先做**排序分歧对照**（离线只读），证明新排序与旧排序的差异方向合理，
      再谈任何转正；且必须预注册阈值。
DC-4  Frequency 与 ScoreWeight **已在 `examValue` 内**这一事实必须写进任何"引入分值为排序货币"的提案，
      否则会把 repetition 当成新信息（"重复计数"的典型来源）。
DC-5  Expected Score（`estimatePredictedScore`）**不得**同时进入 opportunity 与 priority ——
      它本身是 PROXY 且以自报 `currentScore` 为锚（§3.4），再组合只会放大自报噪声。
```

---

## 8. §七 S1 STATUS

```text
READY FOR DESIGN
```

**理由（三句）**：

1. 任务书所描述的 "S1 Score Anchor Foundation" **已经实现、已验证、已进入生产**——三类证据结构隔离、raw 量纲永不丢失、provenance 枚举、append-only + correction 链、150 制归一化、量纲混算结构性排除、mastery 零回流，**全部经代码与测试核实为真**（§2 Q5/Q7/Q9/Q10/Q20、§4）。
2. S1 建成的事实基线**足以支撑下一步设计**：`Real Score`（ledger）与 `Score Weight / Frequency`（考频快照）都是 OBSERVED，`Ability Gap` 有唯一诚实的 PROXY 通道，且 opportunity 影子零件齐备、无自引用。
3. **不是 BLOCKED BY DATA**：缺的是**逐题失分（ScoreLossItem）与 `subjectScores`**，它们是"Score Loss 精确化"的前置，但**不阻断 Score Anchor 本身的设计**（L0 观测失分今天已经可得）。它们的缺失应在设计中被显式建模为"L2/L3 暂不可用 + 降级路径"，而不是等数据。

**若 Design Gate 要求把 L2（逐题失分）纳入 S1 范围**，则状态应转为 **BLOCKED BY DATA**（因为 `ScoreLossItem` 与逐题 `maxScore` 均不存在，需要 schema 增量 + 内容侧 `Question.rubric`/分值数据）。

---

## 9. Critical Data Gaps

| # | 缺口 | 证据 | 影响 | 解锁条件 |
|---|---|---|---|---|
| **G1** | **逐题失分（`ScoreLossItem`）不存在** | `grep -r 'ScoreLossItem\|scoreLoss'` → 零命中；设计文档 §5.1 自述"延后" | Score Loss 只能到 L0（每场一个标量），无法回答"哪一分丢在哪个考点"→ **直接阻断 L2/L3 与任何节点级分值归因** | schema 增量（逐题行：questionId / nodeIds / lostScore / maxScore / errorType） |
| **G2** | **逐题 `maxScore`/分值权重不存在** | `Question` 无 `maxScore`；只有节点级 `primaryScore5y` | 即使有逐题失分行，也无法把"错一道题"换算成分 | 内容侧：题型分值表 + 逐题分值标注 |
| **G3** | **`subjectScores` 不存在** | §4.2 | 无法给出分科失分/分科锚点 | §4.6 方案 A 或 B |
| **G4** | **`targetExam` 实体不存在**（只有 `User.targetScore` 自报目标分） | `grep 'targetExam'` → 零命中 | 目标口径是自报数字，不是"某场考试"；无法做"目标 vs 实测"的可追溯对照 | 设计决策：是否需要目标考试实体，或沿用 targetScore + examDate |
| **G5** | **真实考试成绩无自动来源** | 只有 `POST /coach/score-evidence/outcomes`（手工/教师） | Outcome 层的样本永远 depend on 录入意愿 → 校准样本 = 0 | E1 实验（真实学生 + 教研判分），非工程可自解 |
| **G6** | **真实校准数字 = 0** | `docs/score-anchor-design.md:67`；`CALIBRATION_MIN_SAMPLE=5`（`score-anchor.ts:49-52`） | 预测分**未经任何真实分对照** | E1 执行 |
| **G7** | **Recoverability 无直接测量** | `score-opportunity.ts:68-72`（`maxConfidence: 'low'`） | 任何"值得修"的判断建立在代理上 | 需要"S2 迁移证据"或"历史学习速度"实测 |
| **G8** | **TrainingCost 无实测用时** | `score-opportunity.ts:86-89`（`estimateMinutes`，medium） | ROI 分母是估算 | 逐任务用时遥测 |
| **G9** | **probe 内容 0/60** | `docs/transfer-probe-content-readiness-report.md` | TransferFactor 无数据（属 S3） | 内容任务 |
| **G10** | **`AssessmentHistoryItem` 无 provenance 字段** | `schema.prisma:815+`；`docs/score-anchor-design.md:60` 自述靠 id 前缀解释 | 遗留路径只能靠 id 前缀解释语义，**分层校准依赖约定而非字段** | S1 账本接管后逐步废弃（零回填原则保留） |
| **G11** | **`originType` 受控词表只产出 2 个值**（`external_import`/`teacher_entry`），schema 注释列的 `paper_session`/`diagnostic` 永不产生 | `score-anchor.service.ts:217`；`grep 'paper_session' apps/api/src` 只命中注释 | in-app 模考与外部导入在 `originType` 上**不可区分**，只能靠 `source`（MOCK vs IMPORTED）区分；"入学诊断测"这一来源**没有载体** | 词表收敛或补齐写路径（属 schema/契约决策） |
| **G12** | **修正链缺校验**（显式 `normalizedScore` 绕过 `normalizeScore`；`semantic` 等无枚举校验；`targetId` 无 FK） | `score-anchor.service.ts:449-461`；`dto:159-160` | 一条修正可写入越界/错量纲的 normalized 值并污染读模型 | 在 `recordCorrection` 内对任何显式 `normalizedScore` 强制走 `normalizeScore` 复检；补 `targetKind` 词表与枚举校验 |

---

## 10. Critical Semantic Risks

| # | 风险 | 证据 | 严重度 | 建议 |
|---|---|---|---|---|
| **S1** | **`remainingDays` 是决策层的考试临近度来源，而它不是事实** | `score-opportunity.service.ts:249-257`（`remainingDays ?? 96`）；`recommendation.service.ts:117`（同为 `?? 96`） | **高**（改它就是改排序输入） | Design Gate 决定"是否把决策层切到 examDate 派生"；**本阶段不动** |
| **S2** | **`remainingDays` 双写者可能漂移**（onboarding 自报 vs exam-date 派生） | 两条写路径（§6.1 R-1） | 中 | 登记；若切换，需定义"哪个是权威"与冲突规则 |
| **S3** | **`estimatePredictedScore` 以自报 `currentScore/targetScore` 为锚** | `learning.ts:742-764`：`rawGain = (targetScore − currentScore) × progress × 0.5`；两输入均来自 onboarding 自报 | **高** | 任何"预测 vs 实测"的校准结论必须声明该锚是自报；建议 E1 时同步修正锚 |
| **S4** | **`estimatePredictedScore` 含时间伪影**：能力不变时随考试临近而机械下滑 | `learning.ts:752-753` `timeFactor = clamp01(remainingDays/240)` 进入 `progress` | 中 | 设计时分离"能力项"与"时间项"，或在展示层明示 |
| **S5** | **Opportunity ↔ Priority 双重计数 0.62 权重** | §7.4 表 | **高（若组合）** | DC-1..DC-5（§7.4） |
| **S6** | **`nodeLoss` 是题数代理，容易被读成分值** | `exam-diagnosis.ts:185-199`（`lostCount × recent5Frequency`） | 中 | 任何面向"分数"的呈现必须标 `PROXY（题数代理）` |
| **S7** | **主观题 `selfScore ≥ 0.6` 记对** 污染 accuracy/mastery，而 mastery 又被当作 Ability Gap 的 proxy | `study.service.ts:3342-3344`；`Question.rubric` 生产 0 行内容 | **高** | 已在册（B-F4/content-blocked）；设计不得假设主观题分值可信 |
| **S8** | **`UNKNOWN` provenance 必须永不进 primary 层** | `score-anchor.ts:67-71`（返回 null） | 中 | 保持；任何新增 provenance 值必须显式归层，否则默认 null |
| **S9** | **预测持久化"同日首值优先"** | `docs/score-anchor-design.md:68`；`predictionKey` 幂等键 | 低 | 已知并接受；设计时不要让"日内漂移"承担信息 |
| **S10** | **North Star 未被测量** | `Verified Score Gain` 仅存在于 docs（§5.5） | 中 | 需要一个只读的 Verified Score Gain 投影（后续阶段） |
| **S11** | **共享 `buildScoreCalibration` 的 legacy 守卫留洞**：`totalScore == null` 时不做量纲检查即相减 | `score-calibration.ts:212`（守卫条件）+ `:220`（相减）；仅 API 层以 `semantic='accuracy_rate'` 挡住 | **高** | 在共享函数内改为"没有可证明的等价量纲就拒绝出 error"（`null` + reason），使洞在纯函数层闭合 |
| **S12** | **同一字段两套归一，两个端点不可比**：`primaryScore5y / maxPrimaryScore`（相对）vs `min(1, primaryScore5y/45)`（绝对） | `score-opportunity.service.ts:129,146-147` vs `shadow-decision-chain.ts:229-230,243-244` | **高** | 统一到**绝对**归一（45 分全卷口径），并加跨端点一致性测试 |
| **S13** | **`expectedBenefit` 用 mastery×frequency 直接给出"估算提分 0–14 分"** | `score-opportunity.ts:318-325`（自述 "an estimate, not a measurement"） | **高** | 若保留，必须：①标 `PROXY` 与置信上限；②**不得**进入任何学生可见叙事；③在 Design Gate 明确它是否允许出现在内部决策里 |
| **S14** | **`effectiveness` 的分数口径是空壳**：`examScorePercent`/`examScoreDelta` 声明但恒 null | `effectiveness.service.ts:461-462,474` | 中 | 不要在"提分"叙事中引用 effectiveness 的分数字段 |

---

## 11. Reusable Existing Infrastructure

| 资产 | 位置 | 复用方式 |
|---|---|---|
| **Score Ledger 四表 + 迁移** | `schema.prisma:1082-1180`；`migrations/20260912120000_*` | **直接复用**（append-only、correction 链、provenance 已就绪） |
| `normalizeScore`（严格 150 归一） | `score-anchor.ts:103-135` | 直接复用；新分值来源一律走它 |
| `isCalibrationCompatible` + `calculateCalibrationError` | `score-anchor.ts:207-257` | 直接复用（新增配对类型必须过它） |
| `evaluateCalibrationGate` + `deriveCalibrationEvidenceStatus` | `score-anchor.ts:289-350`（门禁 5/15，四态） | 直接复用（任何新指标的门禁沿用同一形态） |
| `resolveCorrectedEvidence` | `score-anchor.ts:370` | 直接复用（新表若需修正，走同一折叠逻辑） |
| `calibrationLayerOf`（primary/proxy 分层） | `score-anchor.ts:56-71` | 直接复用；**新 provenance 必须在此登记** |
| `SCORE_OPPORTUNITY_FACTORS` 因子目录 + 权重 | `score-opportunity.ts:54-103` | **直接复用**（不要另起模型；只需按 DC-2 正交化） |
| 考频快照 `KnowledgeFrequencySnapshot` | `schema.prisma`；测试库实测 **1154 条** | 直接复用（`primaryScore5y` = 真题分值，OBSERVED） |
| 节点解析器 `resolveKnowledgeNodesForQuestion` / `resolvePrimaryNodeByQuestion` | `apps/api/src/score-center/repository.ts:59-115`；`apps/api/src/study/question-node-resolution.ts:42` | 直接复用（逐题失分归因必须走它，避免重犯"直查 tag 表在生产全盲"） |
| 失分题清单 `lostQuestionIds` + `nodeLoss` | `exam-diagnosis.ts:100-200`；`getExamReport` 透出 | 复用其**归因骨架**，把"题数"升级为"分值"（需 G1/G2） |
| 分科统计（正确率口径） | `getExamReport`（分科统计） | 复用作 `subjectScores` 的数据源（正确率 → 分值的换算需 G2） |
| 证据层三分类 + 强度 | `learning-evidence.ts:41-43` | 复用于"这条失分是否有观测支撑"的判定 |
| 只读集成测试范式 | `scripts/integration-score-anchor.mjs`（10 步）、`integration-score-improvement-loop.mjs`（16 环） | 新设计的验收按同一范式（真实 HTTP + 真实 PostgreSQL + 每步断言） |
| 内容审计工具范式 | `scripts/audit-transfer-probe-content.mjs` + `packages/shared/src/transfer-probe/probe-content.ts` | 若需"分值/失分数据就绪度"审计，复用该"纯校验 + 只读脚本"形态 |

---

## 12. Required Schema Changes（提案，**本阶段不实施**）

| # | 变更 | 类型 | 目的 | 回滚 | 前置批准 |
|---|---|---|---|---|---|
| **SC-1** | `ScoreLossItem`（新表）：`scoreEntryKind` / `scoreEntryId` / `questionId` / `nodeIds[]` / `maxScore` / `lostScore` / `errorType?` / `recordedAt` | additive 新表 | 解锁 L1/L2 逐题失分与节点级分值归因 | DROP TABLE | **需要**（Owner + schema gate） |
| **SC-2** | `ScoreAssessment.subjectScores Json?` + `ScoreOutcome.subjectScores Json?` | additive 可空列 | 解锁 L3 分科失分（§4.6 方案 A） | DROP COLUMN | **需要** |
| **SC-3** | `Question.maxScore Int?`（或题型分值表） | additive 可空列 | 把"错一道题"换算成分 | DROP COLUMN | **需要**（与内容侧联动） |
| SC-4 | `targetExam` 实体 | **不建议现在做** | 目标锚点当前可用 `targetScore + examDate` 表达；先由 Design Gate 判定是否真需要 | — | 待定 |
| SC-5 | 决策层切到 `examDate` 派生 | **不是 schema 变更**，但是**排序输入变更** | 消除 S1/S2 风险 | 环境开关 | **需要**（契约重审） |

**明确不做**：任何对既有列的重命名/删除/回填；任何对 `UserKnowledgeMastery` 的改动；任何对 `priority` 公式的改动。

---

## 13. Required API Changes（提案，**本阶段不实施**）

| # | 变更 | 性质 | 目的 | 备注 |
|---|---|---|---|---|
| **API-1** | `GET /coach/score-loss`（只读，self；teacher 需授权） | 新增只读投影 | 输出 observedLoss（L0）+ 可用的 nodeLoss 归因，**每项带 `kind: OBSERVED \| PROXY` 与 `basis`** | 依赖 SC-1 才能给分值 |
| **API-2** | `GET /coach/score-anchor-summary`（只读，self） | 新增只读投影 | 汇总 anchors（verified outcome / latest assessment / prediction）+ 各层可得性 | 可先只用现有四表 |
| API-3 | `POST /coach/score-loss/items` | **不做** | 逐题失分应由系统在 assessment 写入时**自动派生**，不应让学生手填 | 记录为设计约束 |
| API-4 | 复用既有写入端点 | 复用 | 不新增成绩写入口 | 已有 5 个写入端点足够 |
| API-5 | 任何新投影端点必须 `@Roles` + `resolveUserId` self-only 纪律 | 约束 | 与既有 `/coach/*` 一致 | 集成测试须含越权断言 |

---

## 14. Required Test Coverage（提案）

| # | 必须覆盖 | 形态 | 说明 |
|---|---|---|---|
| **T1** | `ScoreLossItem` 与 assessment/outcome 的**归属一致性**（同一场考试的行必须同 `scoreEntryId`） | 单测 + 集成 | 防止逐题失分挂错考试 |
| **T2** | 逐题 `lostScore` 之和 ≤ 该场 `rawTotalScale − rawScore`（**不得超发**） | 单测（纯函数） | 分值守恒不变量 |
| **T3** | 节点归因走 `resolvePrimaryNodeByQuestion`（**不得直查 tag 表**） | 源码断言 + 集成 | V12.1 教训：直查 tag 表在生产全盲 |
| **T4** | `subjectScores` 各科之和 ≤ 总分；缺失为 `null` 而非 0 | 单测 | 诚实缺席 |
| **T5** | 任何"期望/可恢复分数"投影在必需因子缺失时必须**拒绝出数**（`null` + blocker），不得用替代值 | 单测 | 沿用 score-opportunity 反黑箱纪律 |
| **T6** | 期望分**不得**出现在 `isCalibrationCompatible` 的 prediction 侧 | 源码断言 | 防 R2（预测 × 预测） |
| **T7** | 校准分母只允许 PRIMARY 层；`UNKNOWN` 永不进 primary | 单测（已有，保持）+ 新指标同规则 | `score-anchor.test.js` 已覆盖，扩展时保持 |
| **T8** | `examDate` 与 `remainingDays` 的一致性规则（若 DC 决定切换，需测派生与冲突） | 单测 | §6.1 R-1 |
| **T9** | mastery **零写入**来自 score/score-loss 路径 | 源码级断言（grep 形态） | 防形态 1 循环论证 |
| **T10** | 新投影端点的角色与越权（401/403 + 零写入） | 集成（真实 HTTP） | 沿用 `integration-score-anchor.mjs` 范式 |
| **T11** | North Star（Verified Score Gain）一旦实现，必须**只从 PRIMARY 层校准结果**计算 | 单测 + 集成 | §5.5 |
| **T12** | 未测数据一律 `null`/`insufficient`，**不得渲染为 0** | 前端行为测试 | 已有 10 处 `?? 0` 历史债（G1 报告 §13），新面不得新增 |

---

## 15. Doc Drift 登记（代码为准）

| # | 文档声称 | 代码事实 | 判定 |
|---|---|---|---|
| **D-1** | `docs/score-ledger.md:41`「`rawScore=null` 合法（只有元数据的证据行）」 | `ScoreAssessment.rawScore` 与 `ScoreOutcome.rawScore` 均为 **NOT NULL**（`schema.prisma:1111,1138`；迁移 `:29,:50`） | **DRIFT**：纯元数据行在 DB 层不可表达。建议改文档措辞为"`normalizedScore` 可空；raw 必须有值" |
| **D-2** | 任务书把 S1 列为"下一阶段" | S1 已实现（`5e810833`）且已生产部署 | **上游状态漂移**（非代码问题），已在 §0 记录 |
| **D-3** | `docs/score-anchor-design.md:41-43` D6「`remainingDays` 降级为遗留派生缓存」 | 决策层**仍读** `remainingDays`（`score-opportunity.service.ts:249-257`） | **部分 DRIFT**：文档自述"本阶段不改其消费方"，措辞诚实；但"降级"一词易被读成已切换。建议改为"仍为决策层输入，切换待批准" |
| **D-4** | `schema.prisma:1113` 注释列 `originType` 4 值（含 `paper_session`/`diagnostic`）；`schema.prisma:1170` 注释列 `targetKind` 3 值（含 `prediction`） | 代码只产出 2 个 `originType`（`score-anchor.service.ts:217`）；DTO 只允许 2 个 `targetKind`（`dto:152`） | **DRIFT**：注释把"设计意图"写成了"现状"。建议注释改为"当前产出的值"，并把未实现值标为 `NOT PRODUCED` |
| **D-5** | `docs/score-improvement-gap-report.md:47`「`estimatePredictedScore` … 唯一消费方是 teacher/admin 影子校准端点」 | 代码有 **4 个消费点**，其中 **2 个是学生可见的 Web 面**：`ReportSummaryPanel.tsx:66`、`StudentProgressOverview.tsx:62,71`（另有 `score-calibration.service.ts:371,439`） | **DRIFT（方向严重）**：该句低估了预测分的学生可见面，会让人误判"预测分对学生不可见" |
| **D-6** | `docs/audit/sp-guidance-infra-audit.md:148,219,260`「`User.examDate` writer = NOT FOUND」 | `bde54521`（G1）新增写入点 `score-anchor.service.ts:111-118` | **DRIFT（已过期）**：文档未随 G1 更新 |
| **D-7** | 任务书隐含"S1 尚未开始" | S1 已于 `5e810833` 实现并进入生产 | **上游状态漂移**（§0） |

---

## 16. 审计方法与一个诚实的边界

**本审计的一手核验**（全部由本次会话直接执行、可复现）：四表字段与索引逐行读取；迁移逐行读取（确认纯增量）；`normalizeScore` / `isCalibrationCompatible` / 门禁常量源码阅读；`priority` 六分量与 `score-opportunity` 六因子源码阅读与逐项对照；mastery 写点 grep 穷举；`nodeLoss` / `ScoreLossItem` / `RecoverableScore` / `targetExam` / `subjectScores` 的存在性 grep；`daysToExam` 来源追溯至 `remainingDays`；测试文件清单与用例名清单；生产基线外部 HTTP（health / 路由状态码 / bundle hash）。

**边界（诚实声明）**：

- **生产数据行数 UNVERIFIED**：本机无生产库访问、无学生 token，因此"生产是否已有真实成绩"无法核实。仅能证明**表与迁移存在**（部署记录 + 迁移文件）。
- **三个并行只读副审的执行情况**：①Score Ledger 持久化 —— **已完成，其结论已由本审计逐条一手复核后并入**（四表字段/索引、append-only 精确范围、修正链校验缺口、provenance 角色强制、量纲守卫、`originType` 词表漂移、迁移纯增量、测试清单与集成步骤名）；②代理与双重计数 —— **已完成并已复核并入**（`estimatePredictedScore` 输入伪影、legacy 校准洞、约 0.80 双重计数、两套 `primaryScore5y` 归一、`expectedBenefit` 的考试分主张、`effectiveness` 分数字段空壳）；③数据流与测试覆盖（API 面 / 前端消费 / 六类数据载体 / doc-drift 穷尽）——**未完成即中止**（为保持本轮边界而主动停止；其只读，未产生任何结论）。**其结论一律未被引用。**
- 因此：**§2 的 20 问、§3 的四态分类、§4 的字段核对、§7.4 的双重计数已由一手证据支撑**。**§15 的 doc-drift 登记明确不声称穷尽**（副审 ③ 的 doc-drift 穷尽扫描未完成）；若后续补充审计返回新 drift，应以**补充条目**并入，并以代码为准。
- 若副审结论与本报告冲突：**以代码为准**，本报告的错误应以补充条目更正，而不是让"报告一致"优先。
- 本报告**未**修改任何生产代码、未做 Prisma 迁移、未改 Mastery / Recommendation / Score Engine / Transfer Probe runtime、未开 `TRANSFER_PROBE_ENABLED`、未开 `MASTERY_SEMANTICS`、未进入 S3、未生成 probe content、未部署。

---

## 17. 停止声明

```text
S1 STATUS = READY FOR DESIGN
```

本阶段按约定完成：**只读审计 + Gap 分类 + 形式化设计 + Design Gate 输入**。本文件是唯一产物。

**未做**：未编码、未迁移、未改 Mastery / Recommendation / Score Engine / Transfer Probe、未开任何开关、未进 S3、未部署、未为让 audit "PASS" 修改任何实现。

**等待 Design Gate。** 不自行进入下一阶段。
