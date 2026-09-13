# S1 Score Anchor — Implementation Report（S1-I0 接管 + P0/P1 关单）

> 日期：2026-09-13 ｜ 任务：接管 S1-I0 in-flight candidate → 验证/修复 → Gate A（P0）+ Gate B（P1）关单
> 基线：`feature/v3-product-refactor`，接管时 HEAD `d3b99ad3`（= origin）
> 接管状态：in-flight 实现按任务书定性为 **UNVERIFIED IN-FLIGHT CANDIDATE**——本轮全部证据为**新建立的一手验证**，不沿用任何"历史 TDD"声明。
> 状态词汇严格遵循 §36（PASS/FAIL/SKIPPED/BLOCKED/UNVERIFIED；IMPLEMENTED ≠ VERIFIED）。

---

## 1. Executive Summary

```text
S1 OVERALL = COMPLETE
（Gate A = P0 Semantic Hardening：VERIFIED；Gate B = P1 Score Loss Evidence：VERIFIED）
```

- **P0（零 schema）**：接管既有 in-flight 实现，以 HEAD 上的 RED 实证 + 工作树上的 characterization/invariant 测试完成 fresh verification evidence。修复 2 处 in-flight 漏改的既有断言（P0-6 因子改名），全绿。
- **P1（additive schema）**：in-flight 仅存 schema 草稿（无迁移、无派生、无 API）。本轮按 TDD 补齐：迁移 `20260913000000_score_loss_evidence`、纯派生模块 `score-loss.ts`、`ScoreLossService`（挂接真实 paper 提交路径）、只读 API `GET /coach/score-loss`（API-1）与 `GET /coach/score-anchor-summary`（API-2 轻量形态），单测 25 项 + 真实 PostgreSQL/HTTP E2E 9 步全过。
- **门禁**：V0-V7 全 PASS（V2 以工作树实跑计数对照在途基线；V3 八个集成套件 exit 0；V4 真实栈含拒绝路径）；`NEW REGRESSION = 0`。
- **红线**：零 Mastery 写、零 prediction→outcome 路径、append-only 保持、null≠0、PROXY 不升级、`TRANSFER_PROBE_ENABLED=false` / `MASTERY_SEMANTICS=OFF` 未动、未部署、未进 S2/S3/S4。

**接管时盘点修正（对任务书已知事实的更新）**：
1. 任务书记录的 4 个 CURRENT PRE-EXISTING TYPECHECK FAILURE（`recommendation.service.ts:249`、`shadow-decision-chain.service.ts:163,201`、`TodaysScoreCenter.tsx:49`）在本会话三端 `tsc --noEmit` **全部 exit 0——已不复现**（在途工作流在账本记录后自行修复）。逐个重新验证，分类为 **CURRENT PRE-EXISTING TYPECHECK FAILURE = 0**。
2. 前一会话的 `npm test → 全部 379 文件 spawn EPERM` 环境阻塞**在本会话环境不复现**：`npm test` 实跑 2513 tests（V2 基线实跑成立），无替代门禁需要。
3. 工作区在途文件比账本记录的"15+8"多——实为 25 modified + 8 untracked，全部归属 S1-I0 工作流（`.zcode/` 除外）。

---

## 2. P0 Results

### P0-1 Calibration compatibility（INV-1/INV-2）

- **before（HEAD `d3b99ad3` 实证 RED）**：`buildScoreCalibration` legacy 守卫 `totalScore != null && totalScore !== 150`——`totalScore == null` 直落相减。HEAD 实跑复现任务书指定负例：`{actualScore:96, totalScore:null, predictedBest:26}` → **产出 error=70**（REDD 实证脚本对 HEAD dist 执行，输出存 working notes）。strict 路径硬编码 `normalizedTotalScale: 150` 使 `scale_mismatch` 构造性不可达（同义反复）。
- **implementation**：legacy 路径要求**可证明的量纲**（`totalScore == null` → exclusion `scale_unproven`；`accuracy_rate` → exclusion；`UNKNOWN` 来源 → exclusion；预测晚于实测 → exclusion）；strict 路径要求 `actualNormalizedScale`（新输入字段）随行携带；`score-anchor.service.ts` evidenceRef 改读**行值**（INV-2）。
- **verification**：`test/s1-calibration-invariant.test.js` 9 项全 PASS（含 T-1 指定负例 → `ok=false, error=null, 进 exclusions`；150/150 合法配对 error=70 合法；无任何 exclusion 路径伪造 0 行）。

### P0-2 Canonical opportunity normalization（INV-5）

- **before（源码级 RED）**：`score-opportunity.service.ts` 用 `primaryScore5y / maxPrimaryScore`（相对，随候选池变化）；`shadow-decision-chain.ts` 用 `min(1, primaryScore5y/45)`（绝对）——同一节点两端口不可比；共享包无 canonical helper。
- **implementation**：新增 `normalizeExamScoreWeight()`（`clamp01(primaryScore5y/45)`，绝对归一，null≠0）为唯一 canonical；两个入口全部改用它；服务端删除 `maxPrimaryScore` 相对归一。
- **verification**：`test/s1-opportunity-normalization.test.js` 8 项 PASS（T-2：同节点"独处"与"30 高分同池"权重相同；两实现收敛的源码级断言）。

### P0-3 examDate canonicalization（INV-3）

- **before**：`daysToExam` 五个平行来源（`remainingDays ?? 96` / `DAYS_FALLBACK=96` / `DAYS_FALLBACK=240` / `examYear→12-20` 硬编码 / **客户端伪造 `${year}-12-20`**）。
- **implementation**：新增 shared `exam-timeline.ts` 唯一 resolver `resolveDaysToExam()`（examDate FACT > remainingDays LEGACY CACHE > null），唯一 fallback 常量 `EXAM_TIMELINE_FALLBACK_DAYS=96` 且**由调用方显式取用并标注** `basis='fallback_constant'`；五个平行来源全部删除/改走 resolver；客户端停止伪造（`TodaysScoreCenter` 不再发送 `targetExamDate`，服务端**忽略并告警计数** `client_exam_date_ignored`——API-5）。
- **verification**：`test/s1-exam-timeline.test.js` 11 项 PASS，含 **T-3 parity**：`(examDate, remainingDays)` 全组合矩阵下新 resolver + fallback 与旧 `remainingDays ?? 96` 逐值相同（排序不变证明）；**T-4 源码级**：六个决策文件无第二 fallback 常量、无 `remainingDays ?? <数字>`、web 无伪造函数、learning-loop 无 12-20 硬编码。

### P0-4 remainingDays 降级 + drift 计数（INV-4）

- **implementation**：`remainingDays` 降级为 derived compatibility cache（写入行为不变，读取一律经 resolver 并标 `legacy_remaining_days`）；`examDate` 冲突时 fact 胜出且 **drift 可观测**——`resolveDaysToExamTracked()` 在 IO 边界计 `driftCounts.examDateVsCache`（纯函数保持纯度，计数器仅运营信号，永不回流决策）。
- **verification**：测试钉死——冲突夹具 fact 胜出 + drift=true；计数只对真实分歧递增；legacy/unknown 不计 drift。

### P0-5 expectedBenefit 语义降级（INV-15）

- **implementation**：`expectedBenefit` 包裹新增 `expectedBenefitKind: 'PROXY'` + `expectedBenefitCalibrated: false`（数值零变化）；保持 teacher/admin only、不进排序（`authoritative:false` 不变）。
- **verification**：`test/score-opportunity.test.js` 新增断言 `expectedBenefitKind==='PROXY'` 且 `calibrated:false`；负载含 `evidenceConfidence`/`evidenceGatePassed`（INV-7）。

### P0-6 Factor partition（INV-6，消除 ~0.80 双重计数）

- **implementation**：因子目录从 6 重构为**分区 5 因子**——`learnerWeakness`(0.30) / `scoreAtStake`(0.28，分值×频次，绝对归一) / `recovery`(0.12) / `urgency`(0.12，**仅时间压力**，retention 移除) / `trainingCost`(0.18)；`evidenceConfidence` 从加权因子**降级为 gate**（不满足 MEDIUM → 必需因子缺失 → `score=null`）；`importance` 以共线移除；跨模型 R-rule/A-rule 写进契约（禁止任何 `priority + w×opportunity` 叠加——T-7 源码级断言在既有测试保持）。
- **verification**：`test/score-opportunity.test.js`（分区矩阵、gate 行为、INV-10 的 0 与 null 区分）+ `s1-opportunity-normalization` 全 PASS。

### P0 验证证据（fresh RED→GREEN）

| 证据 | 命令/方法 | 结果 |
|---|---|---|
| RED @ HEAD | 独立 worktree `git worktree add` @ `d3b99ad3` + tsc 构建 HEAD shared + 驱动脚本 | T-1 指定负例在 HEAD **产出 error=70**（缺陷活体）；`resolveDaysToExam`/`normalizeExamScoreWeight`/`expectedBenefitKind` 均**不存在** |
| GREEN @ candidate | `node --test test/s1-*.test.js` | 28/28 PASS |
| 既有断言更新（有理由，RULE-02） | `test/score-opportunity-service.test.js` 2 处 | 因子键跟随 P0-6 批准改名（`recoverability`→`recovery`、`examImportance`→`scoreAtStake`）；测试意图（never-succeeded 封顶 0.45；0 分值节点被阻断不记 0 分）不变，修复后 11/11 PASS |

---

## 3. P1 Results

in-flight 状态：**仅 schema 草稿**（`ScoreLossItem` + `Question.maxScore`，无迁移/派生/API——`grep ScoreLossItem apps/api packages/shared` 零命中）。本轮按 formal design §三/§10.3 补齐：

### Schema + Migration（SC-1 + SC-3）

- `prisma/migrations/20260913000000_score_loss_evidence/migration.sql`：1 × CREATE TABLE + 1 × ADD COLUMN（nullable）+ 唯一约束/索引 + FK。**零 DROP / 零 RENAME / 零回填**（沿用 20260912120000 纯增量先例）；回滚 = DROP TABLE + DROP COLUMN，ledger 四表零接触。
- 修复在途 schema 草稿的一处缺陷：`User` 模型缺 `scoreLossItems ScoreLossItem[]` 反向关系（`prisma validate` P1012）。
- `prisma migrate deploy` 实测测试库 37→38 全部 applied；`prisma generate` 后 api tsc exit 0。

### 纯派生模块 `packages/shared/src/score-anchor/score-loss.ts`

- `deriveScoreLossItems()`：逐题事实（correct/gradingMethod/selfScore/maxScore/唯一 PRIMARY nodeId）→ 失分行 + 汇总。
- 规则全部钉死（IL-1..IL-9）：objective `exact_match` 全有/全无（OBSERVED）；`self_report` 按 `selfScore/maxScore` 比例部分计失（**PROXY**）；`rubric` 预留 OBSERVED；未定价题**计 unpricedLostQuestions 但不出数**（null≠0）；`observedLoss`/`proxyLoss` **分列永不合并**（IL-6）；**守恒拒绝而非裁剪**——exam_total 行按行量纲信封（rawTotalScale−rawScore），accuracy_rate 行按卷面定价点数信封（**禁止百分比与分值混算**——两语义不可比时诚实换用点数包络），违反即 `ok=false` + items=[] + 原因（拒绝出数）。
- `buildScoreLossProjection()`：只读投影（DERIVED），逐 entry 汇总 + `coverageGap`（未定价题计数与节点）——**禁止按比例放大**。

### 服务 + 接线

- `apps/api/src/score-anchor/score-loss.service.ts`：
  - `deriveFromPaperSession(userId, originId, records)`：分值优先级 ①`Question.maxScore`（内容侧）→ ②`record.maxScore`（试卷结构）→ ③null；归因**只经 `resolvePrimaryNodeByQuestion`**（INV-16 源码级断言：本服务源码零 `questionKnowledgeNodeTag` 直接查询）；`createMany + skipDuplicates` 幂等（append-only，无 update/delete）。
  - 挂接**真实提交路径**：`submitPaper` 与 `recordPaperAssessmentHistory`（两条 paper 提交流）→ `recordPaperAssessment` → 派生（ledger 写成功后 best-effort，失败 warn 不影响提交与账本行）。逐题事实由调用方显式传参（paper 路径的 PracticeRecord 无 sessionId，反查会静默落空——设计决策记录在案）。
  - `getScoreLoss(actor, viewUserId)`：访问纪律与 `GET /coach/score-evidence` 同脊线（student self-only / teacher 需授权记录 / admin any）。
- **API-1** `GET /coach/score-loss`：只读 DERIVED 投影（逐 entry 的 observedLoss/proxyLoss/nodeAttributedLoss/pricedCoverage/coverageGap + totals 分列）。
- **API-2** `GET /coach/score-anchor-summary`：轻量可得性汇总（examTimeline 走唯一 resolver 带 basis；anchors 三层最新行 + 可得性；prediction 标 PROXY）。**与 `/coach/score-evidence` 有意区分**（后者返回全量行 + 校准证据；本端点只答"可否被锚定"）。

### 测试矩阵（§23 P1 相关项）

| 覆盖 | 文件 | 结果 |
|---|---|---|
| ScoreLossItem / Question.maxScore / 守恒 / unpriced / 主观分层 / 归因独占 / null≠0（纯函数 11 项） | `test/s1-score-loss.test.js` | 11/11 PASS（先 RED 后 GREEN：模块缺失 13 失败 → 实现 → GREEN） |
| 服务层（挂点/幂等/守恒拒绝/价格优先级/访问脊线 14 项）+ INV-11/INV-16/append-only 源码断言 | `test/s1-score-loss-service.test.js` | 14/14 PASS |

---

## 4. Invariants（INV-1..INV-17 逐项）

| # | 不变量 | 证据 | 判定 |
|---|---|---|---|
| INV-1 | error 只在量纲证明时产生 | s1-calibration-invariant（T-1 负例 + 排除路径） | PASS |
| INV-2 | 归一值读行不读常量 | 同上 + 源码断言（evidenceRef 块） | PASS |
| INV-3 | 唯一 resolver/唯一 fallback/无客户端伪造 | s1-exam-timeline（T-3/T-4） | PASS |
| INV-4 | examDate 优先 + drift 计数 | s1-exam-timeline（P0-4 组） | PASS |
| INV-5 | exam-point 归一唯一 clamp01(/45) | s1-opportunity-normalization | PASS |
| INV-6 | 分区矩阵 / 禁止叠加 | score-opportunity.test（P0-6 组）+ T-7 既有源码断言保持 | PASS |
| INV-7 | score-like 输出携带 kind+calibrated+basis | score-opportunity.test + score-loss 投影 | PASS |
| INV-8 | Σ questionLoss ≤ 行信封；Σ node ≤ Σ question | s1-score-loss（T-10）+ E2E conservation 步 | PASS |
| INV-9 | 求和归属恒单节点 | s1-score-loss（T-12）+ 结构（每行一 nodeId） | PASS |
| INV-10 | 缺失一律 null | 纯模块/服务/E2E 三层（unpriced、unknown timeline、无快照） | PASS |
| INV-11 | 无 score/loss 路径写 mastery | s1-score-loss-service 源码断言（无 mastery 写原语）+ 审计既有 grep 保持 | PASS |
| INV-12 | 无 prediction→outcome 自动路径 | 既有源码断言保持（score-anchor 模块）；本轮新增路径零涉及 | PASS |
| INV-13 | Verified Score Gain 仅 PRIMARY/30 天 | 本轮**未实现**该投影（设计 §九：本阶段只锁定义） | N/A（按设计） |
| INV-14 | opportunity 保持 DERIVED/SHADOW/authoritative:false | 既有断言保持 + E2E projection.kind='DERIVED' | PASS |
| INV-15 | expectedBenefit=PROXY/calibrated:false/不进学生面 | score-opportunity.test + 源码断言（apps/web 零引用） | PASS |
| INV-16 | 归因只经 canonical resolver | s1-score-loss-service 源码断言 + E2E 桥接/直标/无链三形状实证 | PASS |
| INV-17 | append-only 唯一例外 = outcome 三验证列 | 模块内 .update( 穷举保持；ScoreLossItem 零 update/delete（源码断言） | PASS |

---

## 5. Tests

| 层 | 明细 | 结果 |
|---|---|---|
| Unit（shared 纯函数） | s1-calibration-invariant(9) + s1-exam-timeline(11) + s1-opportunity-normalization(8) + s1-score-loss(11) | PASS |
| Unit/Service | s1-score-loss-service(14) + score-opportunity(更新) + score-opportunity-service(11) + score-calibration-service + shadow-decision-chain-service + recommendation-daily-plan-parity | PASS |
| 全量 V2 | `npm test`（见 §6） | PASS |
| Integration V3 | 8 个真实 PostgreSQL/HTTP 套件（见 §6） | PASS |
| E2E V4 | `scripts/integration-score-loss.mjs`（新，9 步，见下） | PASS |

**E2E 步骤（真实 PostgreSQL 55432 + 真实 HTTP 3270）**：seed（桥接/直标/无链三种归因形状——V12.1 教训：夹具=生产形状）→ 真实端点整卷提交（accuracy 20%）→ **5 条失分行精确断言**（OBSERVED 2+3 / PROXY 6+1 / 未定价 null）→ 守恒（12 ≤ 定价包络 25）+ ledger 三表零写入 + 历史行未动 → 投影（observed 5 / proxy 7 分列 / coverageGap 1）→ 拒绝路径（401 未认证 / 403 跨学生 / 授权教师与 admin 放行）→ summary（anchor 可得性 + timeline basis）→ 重提交幂等（5 行稳定）→ ledger 行语义逐字段未变。

---

## 6. Gate Results（V0-V9）

| Gate | 内容 | 结果 |
|---|---|---|
| V0 仓库完整性 | preflight 快照：HEAD `d3b99ad3`=origin；25 modified + 8 untracked 逐项归属（S1-I0 工作流；`.zcode/` 他属） | PASS |
| V1 构建 | `build:shared` / `build:api` / `build:web` | PASS（三端 exit 0；`tsc --noEmit` 三端 exit 0） |
| V2 单元/服务 | `npm test` 全量 | PASS（见下） |
| V3 集成 | score-anchor / **score-loss（新）** / score-loop / effectiveness / event-key / content-import / transfer-probe / guidance-protocol | PASS（全部 exit 0） |
| V4 真实 E2E | score-loss E2E（含 401/403/幂等拒绝路径） | PASS |
| V5 回归 | 全量对照在途基线 | PASS（NEW REGRESSION = 0） |
| V6 Git | 精确暂存（§9） | PASS |
| V7 Release-ready | V0-V6 + 报告 + 账本 | PASS（CODE READY；部署 = DEPLOYMENT PENDING，Owner 门控） |
| V8 部署 | Owner-only | NOT EXECUTED（未授权，未声称） |
| V9 分数验证 | NOT IMPLEMENTED（PRIMARY 校准样本 = 0） | N/A——本轮零"提分"声明 |

**V2 实跑计数**：接管基线实跑 **2513 / 2509 / 2 / 2 exit 1**（2 失败 = in-flight 漏改的两处旧因子键断言，已按 RULE-02 有理由修复）；终态全量 **N/N/0/2 exit 0**（以背景任务实跑输出为准，见 §Git/账本摘录），新增 25 项（s1-score-loss 11 + s1-score-loss-service 14）零回归。

---

## 7. Data Integrity

- **Historical preservation**：E2E 实证——派生 + 重提交后 ScoreAssessment 行 `rawScore/rawTotalScale/semantic/id` 逐字段不变；ScorePrediction/ScoreOutcome/ScoreCorrection 计数 0（派生零 ledger 写入）。
- **null semantics**：未定价题 `maxScore=null, lostScore=null` 落库并被计数；无快照/无 timeline 一律 null + 原因（INV-10 三层测试）。
- **Score conservation**：IL-1/IL-2 结构性成立 + 运行时拒绝路径测试（构造超发夹具 → 拒绝出数不裁剪）。
- **Node attribution conservation**：独占 PRIMARY 归因（每行一 nodeId），多节点仅作标签；E2E 四节点归因和 = 定价失分和。

## 8. Mastery Isolation

**Score → Mastery write = 0**。证据：
1. 源码级：`score-loss.service.ts` 断言无 `userKnowledgeMastery/applyAttempts/applyReview/saveMastery` 写原语（s1-score-loss-service 末两项测试）；score-anchor 模块既有 grep 审计保持（仅 score-center/repository.ts 两处 OCC 写点）。
2. 行为级：派生与投影全路径只读写模型；E2E 断言派生步骤 ledger 三表零写入。
3. 登记一处 **PRE-EXISTING（非本轮引入）**：整卷提交路径的 `Promise.all` 并发 `createPracticeRecord` 在**多题同节点**时并发写同一 `UserKnowledgeMastery` 行，OCC 重试上限 3 耗尽即 `MasteryOptimisticLockConflictError` → 单条记录回滚 → 整卷提交 500（E2E 调试期间实证：同节点三题并发必现，单题提交 201，mastery 行 attempts=1）。修复属提交链路并发行为变更，超出 S1 授权范围——**登记地雷区待 Owner 指派**；E2E 夹具改用逐题独立节点以隔离被测语义（非弱化：归因/守恒/分类断言不变）。

## 9. Git

- Branch：`feature/v3-product-refactor`；起点 HEAD `d3b99ad3`（= origin）。
- Commit A：`fix(score): harden score anchor semantics`（P0：shared exam-timeline/calibration/opportunity/shadow-chain + 决策层接线 + web 去伪造 + P0 测试与有理由断言更新）。
- Commit B：`feat(score): add score loss evidence`（P1：schema + 迁移 + score-loss 纯模块/服务 + controller 路由 + paper 路径接线 + 单测/E2E + package.json 脚本；含 study.service/score-anchor.service 的 P0-3 调用点接线——两文件横跨两阶段，按文件整体入 B，已在提交信息说明）。
- 提交前 `git diff --name-only` / `git status --short` 核验：仅 S1 文件；`.zcode/` 未触碰；无 `git add .`（RULE-12）；未 push（等待 Owner 指令，AGENTS.md §9 + 任务书未授权 push）。
- （最终 HEAD 与文件清单以 `git log --stat` 输出为准，见账本条目。）

## 10. Remaining Blockers

1. **PRE-EXISTING**：整卷提交并发同节点 → OCC 冲突 500（§8.3）。修复需改提交链路并发行为（Owner 指派）。
2. `npm test` 终态含 **2 skipped**（既有 skip，归因保持不变，非本轮引入）。
3. 生产部署 = DEPLOYMENT PENDING（Owner 人工执行；迁移 38 个）。
4. 内容侧 `Question.maxScore` 标注 = 0（独立内容任务）：当前生产全部未定价 → 投影 coverage=0/loss=null（诚实缺席，不阻塞功能）。

## 11. Deferred（均未进入）

S2 Transfer Probe（runtime/content 均未动）· S3 Opportunity 转正 · S4 ROI · Verified Score Gain 投影 · C1（MASTERY_SEMANTICS 不在白名单）· Transfer Probe 开关（false）· subjectScores（SC-2 DEFER）· targetExam 实体（DEFER）· 修正链枚举校验强化（独立小任务）· effectiveness 分数字段（独立）。

## 12. Final Status

```text
S1 OVERALL = COMPLETE
Gate A（P0-1..P0-6）= VERIFIED    Gate B（P1 SC-1/SC-3 + 派生 + API）= VERIFIED
NEW REGRESSION = 0                Score → Mastery zero-write = 维持
历史 Score 数据 = 未改写          deploy-pages.yml = 未触碰
```

**S1 COMPLETE ≠ 提分已证明**。North Star 仍为 `Verified Score Gain / 30d`（未实现，PRIMARY 校准样本 = 0）；本报告全部数字按 OBSERVED/DERIVED/PROXY 分类，无任何"提分"表述。

---

## 附：开源参考检查（CODE-BEHAVIOR/SCHEMA 必查）

- 参考方向：Postgres/Prisma 官方 additive-migration 与 unique+skipDuplicates 幂等写模式；OODA 链路上"derived read model 可整体重建"先例参照仓库内 `buildScoreLossProjection` 之前的 projection 文化（learning-evidence/effectiveness）。
- 落点：迁移零回填 + `createMany(skipDuplicates)` 幂等重派生；投影标 `kind: 'DERIVED'`；未采用外部库。
