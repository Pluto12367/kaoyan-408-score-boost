# M3 Review → Unified Mastery Shadow Integration — Final Report

- 日期：2026-09-11
- 范围：V12-M3「复习结果回流掌握度」的**影子管线**（Review → Unified Mastery → Priority → Opportunity → Recommendation）
- 最终判定：**`M3 REVIEW-MASTERY SHADOW = READY`**（含义见 §M：管线已就绪且证据完整；**不等于**批准切换生产语义，也不等于已交付 M3 的产品收益）
- 生产语义改动：**0 行**；`MASTERY_SEMANTICS`：**未设置**；权威写入：**0**
- 门禁：`npm test` **2305 / 2303 通过 / 0 失败 / 2 跳过**（exit 0）；`build:api` exit 0；`build:web` exit 0；新增集成套件 exit 0；既有集成套件全部 exit 0

---

## A. 本轮定位：为什么不是"再做一个影子"

上一轮（M3 Phase C Migration Preparation）的结论是：**`MASTERY_SEMANTICS=c1` 单独切换零收益**。原因是可证的——

- EMA 是 `m` 与 `T` 的凸组合，`m' = (1−α)m + αT` **永不跨过自己的 target**；
- 生产初值 `NEUTRAL_MASTERY = 0.5` 对每个难度都落在 `[T_wrong(d), T_correct(d)]` 内；
- 全部权威写入点（`applySingleAttempt` 与离线回填）都经同一 EMA 从 0.5 出发。

→ **没有任何生产路径能产生带外掌握度**，因此 C1 的"方向保持"分支在生产可达状态里从不触发。C1 是**防御性**改动，不是收益性改动。

而真正的 M3 产品缺口是另一件事，本轮开工前用代码复核确认：

> `applyReview`（`apps/api/src/score-center/service.ts:161-176`）以 `...current` **原样展开掌握度**，只写 `retention`（硬编码 `1`）/`stabilityDays`/`lastReviewedAt`/`nextReviewAt`。也就是说，一次**已观测的重做结果**——V12-M1 分类学里明确的**强证据**（`review.recalled` → `recall_outcome` / `canInfluenceMastery: true`）——对能力估计**贡献为零**。

本轮的目标因此被重新定义为：**把这个缺失的链路作为影子完整建起来**，让所有者在真实数据上看到"接通复习→掌握度"到底会改变什么，然后再决定是否接线。**不切换 C1、不改生产行为、不写权威状态。**

---

## B. Phase 1–2：Reality Check 与 Review Semantics Trace（实测，非记忆）

| 问题 | 实测答案 | 证据 |
|---|---|---|
| review 事实在哪张表？ | `ReviewAttempt`（每次重做一行，含 `redoCorrect`/`timeSpentSec`/`nextIntervalDays`/`reviewedAt`/`idempotencyKey`），父表 `ReviewSchedule` | `prisma/schema.prisma`；`review-schedule.repository.ts:125-171` |
| observation 由谁代表？ | 三处并存且不同粒度：① `ReviewAttempt.redoCorrect`（逐次，最完整）② `EVIDENCE_RECORDED` 台账的 `review.recalled` 回执（**按天去重**）③ `ReviewSchedule.redoCorrect`（仅最近一次） | `learning-evidence.service.ts:129-158`；`learning-evidence.ts:294-304` |
| 为什么当前无 mastery effect？ | `applyReview` 展开 `...current`，只写排程/保持率字段；`applyAttempts` 只写 EMA 状态 → **两条路径更新不相交字段集** | `score-center/service.ts:106-142` vs `:144-183` |
| 如何在不改生产行为下构建 shadow？ | 只读装配 `ReviewAttempt` + 台账回执 → 纯函数投影 → 复用**同一个** `applyMasteryModel` 重放；下游复用既有决策链影子 | 本轮新增模块（§C/§D） |
| 复习是否走到了权威写方？ | **系统不记录**。`applyReview` 仅在调用方传 `isReview === true` 时执行（`study.service.ts:2354`），而 `ReviewAttempt` 行上**没有这个字段** → 逐次不可审计 | 本轮实测 `scheduleUnknown = 31/31` |

**本轮 Phase 2 的两个附带发现（均为生产数据保真度问题，本轮只记录不改动）：**

1. **证据台账按天去重**：`learningEvidenceKey` = `LEARNING_EVIDENCE:{userId}:{action}:{questionId}:{scope}`，`scope` 默认为 `recordedAt.slice(0,10)`。同一天对同一题的多次复习**共用一条回执**。真实 E2E 实测：**31 次复习落库，只产生 15 条回执**（16 次观测在台账上不可分辨）。
2. **`PracticeRecord.knowledgePointId` 是真实外键**（`PracticeRecord_knowledgePointId_fkey`）→ 任何驱动真实复习的夹具都必须先建 legacy `KnowledgePoint`；这是仓库里"节点口径 vs 考点口径"双轨留下的实际约束。

---

## C. Phase 3：统一的 Evidence Boundary（本轮硬约束）

实现并测试钉死的边界：

```
Review Event → Evidence Receipt → Evidence Projection → Mastery Shadow Engine
```

**禁止路径 `Review → 直接 UPDATE UserKnowledgeMastery` 在代码里不存在**：

- 新增纯模块 `packages/shared/src/score-center/review-mastery-pipeline.ts`：`projectReviewEvidence()` 是唯一的入口，**没有回执的事件 `eligibleForMastery = false`**，不进入掌握度影子；
- 新增只读装配服务 `apps/api/src/study/review-mastery-shadow.service.ts`：**不导入任何写仓库**（测试断言 import 列表中只有 `./review-schedule.repository`）、不出现 `applyReview`/`applyAttempts`/`$transaction`、不出现对任何表的 `update`/`upsert`/`create`/`delete`；
- 结构断言测试同时扫描 `apps/api/src/score-center/service.ts` 中 `applyReview` 的函数体，钉死它**仍然**展开 `...current`、**仍然**只写 `retention = 1`/`updateStabilityAfterReview`、**没有**被接入 `applyMasterySemantics`、**没有**写掌握度。

**业务规则以代码形式复用，不重述**：回执资格直接调用 `classifyLearningAction({action:'review.recalled', recallObserved:true})`，即 V12-M1 已发布的 `LEARNING_ACTION_TAXONOMY`。`review.marked` 只获得"仅活动"判决（测试断言它不构成回忆回执的替代品）。

**证据合并被显式处理而非掩盖**（因为台账按天去重）：

- 两条匹配通道：① `recordedAt` 精确匹配（一对一）② 同题同日 `scope` 匹配（可一对多）；
- 一对多时**每条事件仍携带同一 `receiptId`**（记为 `coalesced_day_scope`），并在 `reconciliation.coalescedReceipts` / `maxEventsPerReceipt` 中计数；
- 设计理由：**丢弃重复复习会低估历史，伪造回执会伪造边界**，因此选择"回执证明当天有观测、重数由 attempt 行承载"并**如实计数**。

`reconciliation` 还区分 `observedNotScheduled`（已知未走排程复习）与 `scheduleUnknown`（系统不记录）——**未知绝不读作 0**。

---

## D. Phase 3/4：Review→Mastery Shadow（逐事件可回溯）

`buildReviewMasteryShadow()` 逐事件产出（Phase 4 要求的字段全在）：

| 字段 | 含义 |
|---|---|
| `reviewEventId` | 事件身份（`review-attempt:{attemptId}`，无 id 时退化为确定性复合键） |
| `nodeId` / `questionId` | 知识节点（PRIMARY 优先）与题目 |
| `reviewedAt` / `observedResult` / `difficulty` | 观测事实 |
| `masteryBefore` / `shadowMastery` | 该事件前后的影子掌握度 |
| `masteryStepDelta` | **本次事件自身的贡献** |
| `masteryDelta` | 该事件后的**累计**与权威值之差 |
| `canonicalTarget` / `direction` / `model` / `basis` | 统一语义的目标值、方向、模型与中文依据 |

**没有第二套口径（关键测试）**：`buildReviewMasteryShadow` 的节点终值与既有 `replayUnifiedReviewMastery` 在**同一输入**上逐节点 `assert.equal`——两条独立编写的代码路径必须给出同一个数。

**审计用未舍入轨迹**：公开行按 4 位小数呈现，但保留 `trace`（`beforeRaw`/`afterRaw`）供不变量检查做**位级比较**。否则第二步骤的输入是第一步的舍入值，会把浮点噪声报成"公式不一致"（这正是上一轮 `round6` 制造假差异的同类陷阱）。

---

## E. Phase 5：下游传播与归因

新增 `joinReviewIntegrationDataset()`，把逐事件掌握度轨迹与**既有决策链影子**的节点级下游结果连接：

- 下游数字**直接复用** `ShadowDecisionChainService.getChain()`（同一候选宇宙、同一批生产原语），本模块**不重算** priority/opportunity/rank——两个影子因此不可能漂移；
- 链未覆盖该节点时，`attributionBasis = null` 且该行被计为**归因不完整**，而不是假定"未变化"；
- 机器可校验的归因链由 delta **结构化推导**（不抄散文）：

```
review.recalled:{reviewEventId} → mastery? → priority? → opportunity? → recommendation?
```

→ Phase 7 的"每个 mastery delta 可回溯到 review event"因此是**结构性事实**，不是声明。

---

## F. Phase 6：真实 PostgreSQL + 真实 HTTP 队列

脚本 `scripts/integration-review-mastery-cohort.mjs`（`npm run test:integration:review-mastery-cohort`，端口 3240）。

**关键方法学**：复习**不**由脚本直接写 `ReviewAttempt`，而是经 `POST /wrong-questions/:questionId/reason`（`isReview: true`）驱动——**生产代码自己**写排程、写 attempt、发证据回执。这才是"Review Event → Evidence Receipt"作为**生产事实**被验证。

**设计**：15 名学生 × 6 节点（排名需要多节点才可观测）；复习节点恰好落在区间掌握度上，其余 5 个为上下文节点（importance/difficulty 一致，使掌握度成为唯一变量）。覆盖：3 区间 × {全对, 全错, 交替} × 难度 {1,3,5} × 复习 {1,3} 次。

**逐步结果（复习节点）**：

| 区间 | 难度 | 结果 | 次数 | 步数 | 基线 | 影子 | 权威 | Δ掌握度 | Δpriority | Δopportunity | Δrank |
|---|---|---|---|---|---|---|---|---|---|---|---|
| low | 1 | 全对 | 1 | 1 | 0.2200 | 0.3199 | 0.2200 | **+0.0999** | −4 | −0.0280 | +2 |
| low | 3 | 全错 | 1 | 1 | 0.2200 | 0.2326 | 0.2200 | +0.0126 | +1 | −0.0040 | 0 |
| low | 5 | 全错 | 3 | 3 | 0.2200 | 0.2110 | 0.2200 | −0.0090 | +3 | +0.0030 | −1 |
| mid | 1 | 全对 | 1 | 1 | 0.6000 | 0.6315 | 0.6000 | +0.0315 | −1 | −0.0090 | +1 |
| mid | 3 | 全对 | 3 | 3 | 0.6000 | 0.7279 | 0.6000 | **+0.1279** | −5 | −0.0360 | +2 |
| mid | 5 | 全错 | 1 | 1 | 0.6000 | 0.5280 | 0.6000 | −0.0720 | +5 | +0.0200 | −1 |
| high | 1 | 全对 | 3 | 3 | 0.9500 | 0.8715 | 0.9500 | **−0.0785** | +1 | +0.0220 | 0 |
| high | 3 | 全错 | 3 | 3 | 0.9500 | 0.6539 | 0.9500 | **−0.2961** | +12 | +0.0830 | −5 |
| high | 5 | 全对 | 1 | 1 | 0.9500 | 0.9581 | 0.9500 | +0.0081 | −1 | −0.0030 | 0 |
| low | 5 | 交替 | 3 | 3 | 0.2200 | 0.4503 | 0.2200 | **+0.2303** | −6 | −0.0640 | +3 |
| mid | 1 | 交替 | 3 | 3 | 0.6000 | 0.6202 | 0.6000 | +0.0202 | 0 | −0.0060 | 0 |
| high | 3 | 交替 | 3 | 3 | 0.9500 | 0.8330 | 0.9500 | −0.1170 | +4 | +0.0320 | −4 |
| low | 1 | 全错 | 1 | 1 | 0.2200 | 0.2488 | 0.2200 | **+0.0288** | 0 | −0.0080 | 0 |
| mid | 5 | 全对 | 3 | 3 | 0.6000 | 0.7772 | 0.6000 | +0.1772 | −5 | −0.0500 | +2 |
| high | 1 | 全错 | 1 | 1 | 0.9500 | 0.8474 | 0.9500 | −0.1026 | +4 | +0.0290 | −3 |

**队列聚合**：15/15 学生的复习节点掌握度发生变化（100%）；31 个复习事件；22 处事件级排名变化（**10/15 个复习节点排名位移**，最大 |Δrank| = 5）；max |Δpriority| = **12**（阈值 25 未触发）。

**方向自洽**（这是本管线最重要的语义性质）：全对复习 → 掌握度↑ → 优先级↓ → 排名**后移**（low d1: rank +2 表示位次数字增大）；全错复习 → 掌握度↓ → 优先级↑ → 排名**前移**（high d3: rank −5）。

---

## G. Phase 7：产品不变量（7 项 + 队列断言）

`auditReviewMasteryIntegration()` 产出可独立证伪的检查项，**每一项都有注入缺陷的正向对照测试**：

| ID | 不变量 | 结果 | 对照测试 |
|---|---|---|---|
| A1 | 每个带回执的复习事件恰好产生一次步进；无回执事件不得进入影子 | PASS | 删一步 → A1 红 |
| A2 | 每一步都是统一掌握度语义本身（**位级**重算一致，且公开行 == 未舍入轨迹的舍入值） | PASS | 篡改公开行 → A2 红 |
| A3 | 节点变化 == 其步进之和；轨迹首尾与基线/终值严格衔接 | PASS | 破坏链式衔接 → A3 红 |
| A4 | 每一步朝自身语义目标移动（不反向） | PASS | 与 A2 耦合，见下 |
| A5 | 学生隔离：数据集只含被请求学生自己的节点与事件 | PASS | 混入第二名学生的行 → A5 红 |
| A6 | `authoritative writes = 0` | PASS | 传入 writes=1 → A6 红 |
| A7 | 证据边界：无回执事件不得进入影子（计数漂移即失败） | PASS | 篡改 skipped 计数 → A7 红 |

**队列级附加断言**（真实库，非单测）：`audit.passed === true` ×15；`model === 'production'`（候选绝不默认）；每个事件的 `afterRaw` 与独立调用的 `updateMasteryAfterAttempt` **`Object.is` 一致**；每节点步进和与总量 `|Σ − Δ| < 1e-12`；`reviewEventId` 全局无跨学生重复；`attribution[0]` 必为 `review.recalled:`。

**关于 A4 的诚实说明**：A4 与 A2 在内部一致性上耦合（若 A2 成立，则方向不可能反向）。A4 的独立价值在于它把**现行语义的固有瞬态**变成可见计数，而不是让管线显得完美：

- `correctLowered`（答对却被下压）**4 次**——全部来自高分区（如 `high d1 全对 ×3`：0.95 → 0.8715），根因是正确目标值 `0.72+0.055d` 低于当前估计；
- `incorrectRaised`（答错却被上抬）**2 次**——全部来自低分区（如 `low d1 全错`：0.22 → 0.2488），根因是错误目标值 `0.38−(d−1)·0.045` 高于当前估计。

两者都用**独立重算**证明是 `updateMasteryAfterAttempt` 自身的行为（测试显式断言此时 canonical target 位于估计的另一侧），**不是本轮接线引入**。这与上一轮迁移验证中同一状态的数值（legacy `0.2488` vs C1 `0.22`）完全吻合——两条独立路径得到同一个数。

---

## H. Phase 8/9：M3 Review Integration Decision Dataset

**字段**（逐行，`authoritative: false`）：`studentId, nodeId, reviewEventId, reviewedAt, observedResult, observedMastery, reviewShadowMastery, masteryStepDelta, masteryDelta, masteryDirection, observedPriority, shadowPriority, priorityDelta, observedOpportunity, shadowOpportunity, opportunityDelta, observedRank, shadowRank, rankDelta, confidence, attribution[], attributionBasis`。

**分布（本次队列，节点级 Δ掌握度 / Δpriority / Δopportunity）**：

| 指标 | Δ掌握度 | Δpriority | Δopportunity |
|---|---|---|---|
| count | 15 | 15 | 15 |
| min | −0.2961 | −6.0 | −0.0640 |
| max | +0.2303 | +12.0 | +0.0830 |
| mean | +0.0041 | +0.533 | −0.0013 |
| median | +0.0126 | 0.0 | −0.0040 |
| p90 | +0.1575 | +4.6 | +0.0308 |
| absMean | 0.0941 | 3.933 | 0.0241 |
| non-zero | 15 | 13 | 15 |

**受影响比例**：学生 **15/15 = 100.0%**；节点 **15/15 = 100.0%**（口径：**有复习事件**的节点；每名学生另有 5 个无复习历史的上下文节点，其权威值不变，但**参与排名比较集**——排名位移正是在这个 6 节点宇宙里测得的）。

**Top 变化推荐（按 |Δrank|）**：high d3 全错 −5；high d3 交替 −4；high d1 全错 −3；low d5 交替 +3；low d1 全对 +2；mid d3 全对 +2；mid d5 全对 +2。

**归因完整性**：31/31 事件 = **100%**（`attributionComplete: true` ×15）。

**与上一轮路线的对照意义**：所有者判定 C1"无可观测收益"是正确的——C1 单独切换在可达状态上 **delta = 0**；而**复习接线**在本次队列上让 **100% 学生的复习节点**发生变化（Δ掌握度最大 −0.2961/+0.2303，Δpriority 最大 12，排名最大位移 5）。**M3 的真实收益在接线，不在 C1。**

---

## I. 本轮发现的缺陷 / 限制（如实记录，未擅自修复）

1. **台账按天去重**：31 次复习 → 15 条回执。影响：**若把证据台账当作唯一事件来源，16/31 次观测将不可见**。本管线的应对是从 attempt 行驱动、与回执对账，并把合并计数暴露出来。**根治需要改动事件键设计（生产语义），未获授权，未做。**
2. **排程属性不可审计**：`ReviewAttempt` 不记录 `isReview` → 31/31 记录为 `scheduleUnknown`。影响：无法逐次回答"这次复习是否走到了权威写方"。**需要 schema 增量，未获授权，未做。**
3. **回执高度合并导致"缺回执"可能被误读**：`eventsWithoutReceipt` 与 `coalescedReceipts` 必须一起看，报告中已并列输出。
4. **`retention` 仍硬编码为 1**：`applyReview` 无条件宣称刚复习完保持率完美（与 `estimateRetention` 的指数衰减不同口径）。本轮**未触碰**（属生产语义），仅由既有 `reviewRetentionShadow` 继续量化。
5. **基线近似**：`UserMasterySnapshot` 不含 `accuracy`/`recentAccuracy`，`recentAccuracy` 用可恢复的 `accuracy` 近似。对掌握度**无效**（EMA 的掌握度只依赖 `state.mastery` 与信号），但已在 basis 中声明。
6. **登录节流是真实生产防护**：`POST /auth/login` 为 10 次/60 秒（`auth.controller.ts:22`）。队列需要 16 次登录，脚本选择**等待窗口**而不是放宽限制（有 62 秒等待）。
7. **端点返回形状一度不一致**（成功分支展平、失败分支带 `result`），本轮已统一为 `{ userId, result }`；该端点为新增、未发布，无兼容性影响。

---

## J. 硬边界逐条核对

| 禁止项 | 结果 |
|---|---|
| 启用 `MASTERY_SEMANTICS=c1` | ✅ 未做。环境变量未设置；测试断言 `.env*` 中不存在该键，且 `parseMasterySemantics(undefined) === 'legacy'` |
| 把 C1 切到生产 | ✅ 未做。`applyReview` 未被接入开关（结构断言） |
| 修改 `applyReview` 生产行为 | ✅ **0 行改动**（其函数体逐条断言仍展开 `...current`、仍写 `retention = 1`/`updateStabilityAfterReview`、无掌握度赋值） |
| 在 `applyReview` 内写 `UserKnowledgeMastery` | ✅ 未做 |
| 修改权威掌握度 | ✅ 未做。真实 E2E：复核前后 `userKnowledgeMastery` 逐行 deep-equal（含 `retention`） |
| 修改 `score-center/service.ts` 生产语义 | ✅ **0 行改动**（该文件本轮未被编辑） |
| 把 review 影子写入权威表 | ✅ 未做。**6 张表指纹**在"读影子前 vs 读影子后"deep-equal：`userKnowledgeMastery`（**90 行逐行 mastery + retention**）、`userMasterySnapshot`（105）、`reviewSchedule`（15）、`reviewAttempt`（31）、`userEvent`（15）、`recommendationAction`（0）。指纹**特意包含** `UserMasterySnapshot` 与 `RecommendationAction`——即影子最可能误写的两张表（初版指纹漏了这两张，等于让声明比证据宽，已收紧并复跑） |
| 修改 F4 Evidence → Ability | ✅ 未做（F4 文件未触碰） |
| 部署 | ✅ 未做 |
| 修改验收标准 / 弱化既有断言 | ✅ 未做。既有 2270 项基线全部保留；新增 35 项；既有集成套件全部 exit 0 |

---

## K. 回归证据

- `npm test`：**2305 / 2303 通过 / 0 失败 / 2 跳过**，exit 0（基线 2270/2268/0/2；**+35 新增，零新增失败**）
- `npm run build:api`：exit 0
- `npm run build:web`：exit 0
- `npm run test:integration:review-mastery-cohort`（本轮新增）：exit 0（真实 E2E 实测两次，输出**逐行一致**——管线确定性）
- 既有集成套件：`score-loop`、`review-shadow-cohort`、`event-key`、`mastery-semantics-migration`、`effectiveness` 全部 exit 0
- 既有失败分类未变（`docs/v12-failure-classification.md`）：**NEW REGRESSION = 0**；`integration-postgres:1254`（PRE-EXISTING）、`exam-aligned` 缺题库夹具（FIXTURE/DATA GAP）、生产部署（PENDING，无 SSH 凭据）均如实保留，**未被包装成绿色**。

**指纹计数的一个附带观察**：`userMasterySnapshot` 为 **105 = 90（夹具）+ 15（生产 `applyReview` 自己写的）**。即复习路径确实会写快照（写的是**未改变的**掌握度），这是生产既有行为；因此该表必须在指纹内，否则"零权威写入"会漏掉生产本来就在写的那张表。

**新增文件**：`packages/shared/src/score-center/review-mastery-pipeline.ts`（纯模块）、`apps/api/src/study/review-mastery-shadow.service.ts`（只读装配）、`scripts/integration-review-mastery-cohort.mjs`、`test/review-mastery-pipeline.test.js`（24 项）、`test/review-mastery-shadow-service.test.js`（11 项）。
**改动文件**：`daily-brief.controller.ts`（+1 端点 `GET /coach/review-mastery-shadow`，teacher/admin）、`study.module.ts`（+1 provider）、`review-schedule.repository.ts`（`listAttemptsByUser` 只读返回增补 `attemptId`/`scheduleId`/`idempotencyKey`，纯增量）、`packages/shared/src/score-center/index.ts`（+1 export）、`package.json`（+1 脚本）。

---

## L. 交给所有者的判断（工程不代答）

1. **是否接线 `Review Result → Mastery`**：本轮证明它在真实数据上对 **100% 有复习历史的学生**产生变化（掌握度最大 ±0.30、优先级最大 12、排名最大 5 位）。这是**产品判断**：复习观测进入能力估计在语义上正确（V12-M1 已将其定为强证据），但会显著改变薄弱度排序。
2. **接线时是否同时启用 C1**：不启用时，接线后仍会出现 4 次"答对下压"、2 次"答错上抬"（本队列实测，相位与区间相关）；启用 C1 会消除这两类瞬态，代价是**极端区地板/天花板黏滞**（已在上一轮披露）。
3. **是否修台账按天去重**：当前 31 次复习只有 15 条回执。若未来要以证据台账做逐次能力推断或审计，需要改动事件键（生产行为）。
4. **是否让 `ReviewAttempt` 记录排程属性**：当前无法逐次回答"这次复习是否到达权威写方"。

---

## M. 最终判定

```
M3 REVIEW-MASTERY SHADOW = READY
```

**READY 的含义（严格界定）**：

- ✅ 管线**可计算**：Review Event → Evidence Receipt → Projection → Mastery Shadow → Priority → Opportunity → Recommendation，在真实 PostgreSQL + 真实 HTTP + 真实生产写路径上跑通；
- ✅ **可解释 / 可归因 / 可审计**：31/31 事件归因完整，每一步可回溯到具体 `reviewEventId`，每一步可位级复现自统一语义；
- ✅ **不写权威状态**：`authoritative writes = 0`（五表指纹 deep-equal），全部产物 `authoritative: false`；
- ✅ **不破坏学生隔离**：全局 `reviewEventId` 无跨学生重复，数据集只含本学生节点；
- ✅ **不切换 C1、不改生产语义、未部署**。

**READY 不含义**：

- ❌ 不表示 M3 的产品收益已交付（接线本身仍待批准）；
- ❌ 不表示修复了生产 EMA 的方向瞬态（那是 C1 的职责，仍未启用）；
- ❌ 不表示台账去重 / 排程属性不可审计这两个数据保真度问题已解决（§I，需 schema 或事件键变更授权）。
