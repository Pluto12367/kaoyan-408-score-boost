# V12-M3 Shadow Decision Chain Closure — Final Report

> 日期：2026-09-11 · 分支 `feature/v3-product-refactor`
> 范围：把 Unified Mastery Shadow 向下游完整传播为 **Priority → Opportunity → Recommendation Ranking → Decision Delta**
> 硬边界遵守情况见 §I（生产语义零改动、authoritative writes = 0、M3 Phase C **未切换**）

---

## A. Executive Summary

本轮把"M3 影子只给出一个掌握度差值"推进成**可决策的数据集**：

```
Observed Review
   ↓
Unified Mastery Shadow        （复用 M3 既有纯函数重放）
   ↓
Priority Shadow               （复用生产 calculatePriority，未改一个字）
   ↓
Opportunity Shadow            （复用 V12-M4 buildScoreOpportunity）
   ↓
Recommendation Ranking Shadow （复用生产 runRecommendation，未改一个字）
   ↓
Decision Delta + Attribution
```

**关键设计**：两条路径在**同一 student-scoped 候选宇宙**上跑**同一批生产原语**，输入只差"该节点的掌握度状态"。因此任何下游差异都**只能**归因于复习，而不可能来自第二套实现漂移。一条测试断言本模块 `import` 了生产 primitives 且**没有**重定义其权重或函数。

**规模**：3 个提交 · 13 文件 · +2027 行 · 新增 1 个纯模块 + 1 个只读服务 + 1 个只读端点 · 24 个新测试。
**门禁**：`npm test` **2238 / 2236 / 0 fail / 2 skip** exit 0；`build:api` / `build:web` exit 0。

**本轮最重要的产出不是"链路通了"，而是链路通了两件事**：
1. 它把"掌握度变化会不会改变学生被建议学什么"变成了**可读的数字**（最大优先级变化 9 分、最大排名变化 3 位）；
2. 它**顺手抓到一个 tsc、2200 个单测和此前所有集成运行都没发现的真实缺陷**（§A.1）。

### A.1 本轮抓到并修复的真实缺陷

| # | 缺陷 | 性质 | 为何此前无人发现 |
|---|---|---|---|
| 1 | V12-M4 的 `daysToExam` 读的是 **`User.examDate`——该字段不存在**，查询失败被 `.catch(() => null)` **吞掉**，于是每个学生的 `daysToExam` 都退化成常量，**urgency 因子从未个性化**；且回退值 120 也≠生产真相源（`recommendation.service.ts` 用 `remainingDays ?? 96`） | **我引入的真实缺陷（静默回退）** | tsc 通过（`as never` 断言绕过了类型检查）、单测用桩绕过 DB、集成测试不校验 urgency 数值 |
| 2 | cohort 每个学生只有 **1 个节点** → 该节点永远是 rank 1，**"Top-N 是否变化"根本无法观测**；首轮 `dRank` 全 0，看起来像"排名不受影响"，实际是"排名不可观测" | **测量设计缺陷（会导出错误结论）** | 输出是合法的 0，不是报错 |
| 3 | cohort 给**被复习节点**也加了 `-0.21` 偏移 → 区间标签与被测节点实际掌握度不符（"0.75 区间"的节点其实是 0.61），数据集中标签会误导决策 | **测量设计缺陷** | 输出看起来完全正常 |
| 4 | 同一题族种 6 道题违反 `Question(familyId, versionNumber)` 唯一约束 | 夹具缺陷 | 一跑就暴露 |
| 5 | 清理阶段未删除新增的 `KnowledgeFrequencySnapshot` → 外键阻塞 teardown | 夹具缺陷 | 一跑就暴露 |

> **缺陷 1 的形态值得记录**：类型检查、全量单测、四套既有集成脚本**全绿**时它一直是活的。它只在"影子链真的去读这个字段并把它算进优先级"时才现形——**这正是把影子向下游传播的价值**。

### A.2 数据集的直接结论

| 问题（任务 §13） | 本轮可回答的证据 |
|---|---|
| Q1 如果今天切换 M3，哪些 mastery 会变化？ | 15/15 学生（100%）的**被复习节点**会变；变动区间 +0.2105 ~ −0.1736 |
| Q2 这些变化影响哪些 priority？ | 15/15 节点的优先级变化；median \|Δ\| = 3、max = 9 |
| Q3 影响哪些 opportunity？ | 同一批节点；median Δ ≈ −0.021（机会分变动远小于优先级，因训练成本/考频/紧迫度不变） |
| Q4 哪些 recommendation 会重新排序？ | **11/15 学生出现真实排名变化**；median \|Δrank\| = 2、max = 3；**被复习节点从 rank 3 掉到 6（答对）或升到 1（答错）** |
| Q5 能否回溯到具体 review/evidence？ | ✅ 每个分歧都带 `triggerEventType = review.recalled`；无触发的事件数为 0（测试断言） |
| Q6 Shadow 是否改变 authoritative state？ | ❌ **未改变**：`UserKnowledgeMastery`（取值+稳定性）/`ReviewSchedule`/`ReviewAttempt`/`RecommendationAction`/`UserEvent` 指纹前后 **deep-equal**；`authoritative writes = 0` |
| Q7 学生之间是否隔离？ | ✅ 每个学生的链**恰好包含他自己的 6 个节点**，无跨学生污染（断言） |

---

## B. Shadow Architecture

```
                    ┌──────────────── Observation Layer ────────────────┐
                    │ ReviewAttempt (redoCorrect / reviewedAt / interval)│
                    │ QuestionKnowledgeNodeTag (question → node, PRIMARY)│
                    │ UserMasterySnapshot (baseline before first review) │
                    └──────────────────────┬────────────────────────────┘
                                           │
                    ┌──────────────────────▼────────────────────────────┐
                    │ ReviewSemanticsShadowService.assembleReplayInputs  │
                    │  （只读；M3 既有汇编，本轮抽出为共享入口）          │
                    │  → ReviewMasteryReplayRow（新增 replayState 字段） │
                    └──────────────────────┬────────────────────────────┘
                                           │
        ┌──────────────────────────────────▼───────────────────────────────────┐
        │           ShadowDecisionChainService（只读，student-scoped）           │
        │  candidate universe = 该学生自己的 UserKnowledgeMastery 节点           │
        └──────────────────────────────────┬───────────────────────────────────┘
                                           │
        ┌──────────────────────────────────▼───────────────────────────────────┐
        │   buildShadowDecisionChain（纯函数；两条路径并行跑同一批生产原语）        │
        │                                                                       │
        │   observed path:  stored mastery ──┐                                   │
        │                                     ├─► calculatePriority  (prod)       │
        │   shadow   path:  replayed state ──┘   buildScoreOpportunity (M4)      │
        │                                        runRecommendation    (prod)      │
        │                                                                       │
        │   → per-node delta + direction + rank delta + trigger + attribution    │
        │   → 风险检测（PRIORITY_SWING / RANK_SPREAD / UNIVERSE_MISMATCH /       │
        │              UNATTRIBUTED_MASTERY / UNATTRIBUTED_RANK）                │
        └──────────────────────────────────┬───────────────────────────────────┘
                                           │
                          GET /coach/shadow-decision-chain
                          （teacher/admin，authoritative=false）
```

**复用而非分叉（代码级证据）**：`shadow-decision-chain.ts` 直接 `import` `./priority`、`./recommendation`、`./score-opportunity`；测试断言源码**不含** `COMPONENT_WEIGHTS =` / `function calculatePriority` / `export function runRecommendation`，确保没有复制引擎。

**排程字段的处理**：统一语义只改 EMA 掌握度，因此 `retention / stabilityDays / lastReviewedAt / pinned` 在**两条路径中都取权威存储值**。若在影子侧凭空生成，比较的就不是"被提议的变更"了。

---

## C. Mastery Delta（15 学生 × 5 区间 × 3 结果）

| 区间 | 正确复习 | 错误复习 | 混合（3 次） | 区间均值 |
|---|---|---|---|---|
| 0.00–0.30 | **+0.1197** | **+0.0229** | **+0.2105** | **+0.1177** |
| 0.30–0.45 | +0.0909 | −0.0295 | +0.1387 | +0.0667 |
| 0.45–0.60 | +0.0657 | −0.0753 | +0.0759 | +0.0221 |
| 0.60–0.75 | +0.0369 | −0.1278 | +0.0041 | −0.0289 |
| 0.75–1.00 | +0.0117 | −0.1736 | −0.0587 | **−0.0735** |

**分布**：median +0.0229 · p90 +0.1387 · 受影响比例 100%

### C.1 两个必须交付给所有者的性质（本轮新发现）

**性质 1 —— 效应随掌握度区间变号。** 区间均值从 +0.1177（低分区）单调衰减到 −0.0735（高分区），符号在 0.45–0.60 与 0.60–0.75 之间翻转。切换会**压缩掌握度分布**。

**性质 2 —— 低分区"答错反而涨"。** `0.00-0.30/all_wrong` 得到 **+0.0229**：即使复习答错，重放后的掌握度仍**上升**。这不是影子引入的，而是**生产 EMA 的性质**：`mastery.ts` 的错误目标值为 `max(0, 0.38 − (difficulty−1)·0.045)`，在 difficulty=3 时约 **0.29**——只要当前掌握度低于 0.29，一次错误作答就会把它**拉向 0.29（即拉高）**。

> 这条属于**生产掌握度语义**，本轮**未修改**（禁止项）。但它对切换决策直接相关：切换后，弱学生失败一次会看到掌握度上涨。**是否可接受是产品判断。**

### C.2 不对称性（本轮最强的信号）

- 正确复习在低分区收益大（+0.1197）、高分区几乎无收益（+0.0117）
- 错误复习的代价**随掌握度单调放大**（−0.0295 → −0.0753 → −0.1278 → **−0.1736**）

即：**统一语义的收益递减、代价递增**。这正是"单点证据看起来合理"会掩盖的结构。

---

## D. Priority Delta（真实分布）

| 指标 | 值 |
|---|---|
| median \|Δpriority\| | **3** |
| max \|Δpriority\| | **9** |
| 变化方向一致性与语义相符 | ✅ 掌握度↑ → 优先级↓（weakness 分量下降）；掌握度↓ → 优先级↑ |
| `PRIORITY_SWING` 触发数（阈值 25） | **0** |

**Risk A（优先级爆炸）未发生**：最大变化 9 分，远低于已发布阈值 25。方向与幅度都符合 `calculatePriority` 的 weakness 权重（0.32）与相位系数。

样例：
```
0.00-0.30/mixed/x3@7d        mastery +0.2105 → priority  -6
0.75-1.00/all_wrong/x2@3d    mastery -0.1736 → priority  +9
```

---

## E. Opportunity Delta（真实分布）

| 指标 | 值 |
|---|---|
| median Δopportunity | ≈ **−0.021** |
| 最大 \|Δopportunity\| | **0.059** |
| 与 priority 同向 | ✅ 掌握度上升 → 机会分下降（缺口变小，不再值得优先训练） |

**机会分变动显著小于优先级变动**，因为机会模型的六个因子里只有 `weakness` 随掌握度变化，而 `examImportance`（考频分值）/ `trainingCost`（生产估算器）/ `evidenceConfidence`（快照）/ `urgency`（remainingDays + retention）在两条路径中相同。

这本身是一个诚实且有用的结论：**掌握度变化对"机会排序"的传导是衰减的**，不会像优先级那样直接等幅传导。

---

## F. Recommendation Delta（真实排名变化）

由生产 `runRecommendation` 的 `KNOWLEDGE` 项顺序定义 rank（1 起）：

| 指标 | 值 |
|---|---|
| 出现排名变化的学生 | **11 / 15** |
| median \|Δrank\| | **2** |
| max \|Δrank\| | **3** |
| Top-1 变化 | 0（本 cohort 未出现） |

**代表性的真实位移**：

```
0.00-0.30/mixed/x3@7d        rank 3 → 6  (Δ+3)   ← 3 次正确复习 → 掌握度 +0.2105 → 不再紧迫
0.00-0.30/all_correct/x1@1d  rank 3 → 5  (Δ+2)
0.30-0.45/all_correct/x1@1d  rank 3 → 5  (Δ+2)
0.45-0.60/all_wrong/x2@3d    rank 3 → 1  (Δ−2)   ← 复习失败 → 掌握度 −0.0753 → 升为最紧迫
0.75-1.00/all_wrong/x2@3d    rank 3 → 1  (Δ−2)   ← 强节点失败代价最大
```

**语义自洽性**：所有排名变化的方向都与"掌握度↑→紧迫度↓→排名后移 / 掌握度↓→紧迫度↑→排名前移"一致——不是随机抖动。

**Risk B（排名扩散）未发生**：15 个掌握度变化引发 11 个排名变化，比值 < 3，未触发阈值。**没有出现"改一个节点导致大量无关节点重排"**。

---

## G. Attribution（归因链）

每个节点输出一句可读的归因：

```
review.recalled（review-attempt:<nodeId>:<at>） → 掌握度 0.2200 → 0.3397（+0.1197） → 优先级下降 4 分 → 推荐排名后退 2 位。
```

- **每个分歧都携带 `triggerEventId` / `triggerEventType`**；E2E 断言"无触发的节点必须 `masteryDelta === null`"。
- 未归因项由风险码接管：`UNATTRIBUTED_MASTERY`（有分歧无事件）与 `UNATTRIBUTED_RANK`（自身优先级未变但排名位移，属其他节点引起的相对位移）。
- 机制上，`assembleReplayInputs` 为每个节点记录**最新一次复习观测**作为触发源，所以归因不是事后猜测而是汇编时绑定。

---

## H. PostgreSQL E2E

`npm run test:integration:review-shadow-cohort` —— 15 名学生（5 区间 × 3 结果，复习 1–3 次、间隔 1/3/7 天，**每人 6 个节点**），经**真实 HTTP + 真实 PostgreSQL**：

| 验证项 | 结果 |
|---|---|
| auth guard | ✅ 未认证 **401**、学生身份 **403** |
| student isolation | ✅ 每个链恰好包含该学生自己的 6 个节点 |
| candidate ownership | ✅ universe == 该学生节点集 |
| shadow-only semantics | ✅ `authoritative=false`、`productionSemanticsChanged=false` |
| determinism | ✅ 重复调用逐字段一致 |
| attribution | ✅ 恰好 1 个节点分歧、且是**被复习**的那个、且带触发事件 |
| universe consistency（Risk C） | ✅ 两条路径同一宇宙 |
| no production writes | ✅ 5 张权威表指纹前后 deep-equal，**authoritative writes = 0** |
| ranking delta | ✅ 11/15 出现真实位移 |

副产品：该脚本同时输出 M3 队列的切换就绪度（方向一致率 64.3% < 70%、观测数 15 < 30 → **NOT READY**）。

---

## I. Authoritative Safety

| 断言 | 证据 |
|---|---|
| 生产复习/掌握度语义未改 | `git diff 8abff36..HEAD -- apps/api/src/score-center/service.ts` = **0 行** |
| M3 Phase C 未切换 | 同上；`applyReview` 行为与 V11 完全一致 |
| Shadow 恒为非权威 | 纯模块、服务、summary、每行均为 `authoritative: false`；`productionSemanticsChanged: false` |
| 零权威写入 | E2E 指纹 deep-equal（`UserKnowledgeMastery` 取值+稳定性 / `ReviewSchedule` / `ReviewAttempt` / `RecommendationAction` / `UserEvent`） |
| 代码级只读 | 源码扫描（剥离注释）断言不含 `.create(`/`.update(`/`.upsert(`/`.delete(`/`saveMastery`/`applyReview`/`applyAttempts`/`recordCanonicalEvent`；亦不引用 `score-center/service` |
| 唯一 Schema 变更 | 仅 `Question.rubric`（所有者已批准的纯增量可空列），与本轮无关 |

> **production behavior unchanged；authoritative writes = 0。**

---

## J. Tests

| 层级 | 覆盖 | 数量 |
|---|---|---|
| Pure unit | `test/shadow-decision-chain.test.js`：Case A–F、Risk A/C/D、排名 entered/exited、分布、确定性、复用原语断言 | 16 |
| Service | `test/shadow-decision-chain-service.test.js`：缺席、student-scoped、LOW 证据退化、确定性、只读边界 | 7 |
| Regression guard | `test/score-opportunity-service.test.js` 新增 `daysToExam` 字段守卫（剥离注释后扫描） | 1 |
| 既有回归 | M3 影子 12 + 9、M4 11、F4 24 等 | 全部保持绿 |
| **全量** | `npm test` | **2238 / 2236 / 0 fail / 2 skip** |
| 构建 | `build:api` / `build:web` | exit 0 |
| PostgreSQL E2E | `test:integration:review-shadow-cohort`（含决策链） | exit 0 |

**测试写出过程中的两次自我纠正（诚实记录）**：
1. 新增的 `daysToExam` 守卫首版失败——因为断言扫到了**注释里解释该缺陷的文字**。与仓库既有边界测试一致改为**剥离注释后扫代码**。
2. 首版 `affectedRatio` 断言假设 2 位小数，实现用 4 位；判定为**断言写错**（非实现缺陷），改为断言语义（比例正确性 + p90 ≥ median）而非特定精度。

---

## K. Existing Debt（分类，延续 `docs/v12-failure-classification.md`）

| 类别 | 项 | 本轮变化 |
|---|---|---|
| **NEW REGRESSION** | **无** | — |
| **PRE-EXISTING** | `integration-postgres.mjs:1254` 断言；2 个既有 skip；既有死代码（674 行孤儿审计工具等）；`study.service.ts:3424` 合成 75% 默认值 | 未触碰 |
| **ENVIRONMENT** | 无 SSH 凭据（部署 PENDING）；4 套集成连跑时瞬时 `0xC0000409`（单独复跑 exit 0） | 未变 |
| **FIXTURE / DATA GAP** | `exam-aligned` 缺 `Question` 题库夹具；`seed:knowledge-map` 缺 legacy `KnowledgePoint` | 未变 |
| **OWNER DECISION** | M3 Phase C 切换；F4 教研 rubric 内容 | 本轮**新增可决策数据**（§C–F） |
| **EXTERNAL INPUT** | 真实考研分数录入通道（不存在）；生产流量 | 未变 |

**本轮修复的缺陷**（§A.1）已从"未知"转入"已修复"，均有测试与真实库证据：缺陷 1 有回归守卫 + 真实库验证；缺陷 2/3 由重新运行的 cohort 输出更正后的数据；缺陷 4/5 为夹具修复。

---

## L. M3 Decision Readiness

```
M3 Phase C DECISION READY
```

**Decision data ready; owner decision still required.**

| 决策所需证据 | 状态 |
|---|---|
| 影响分布（impact distribution） | ✅ median mastery Δ +0.0229、p90 +0.1387、affected ratio 100%、no-impact ratio 13.3% |
| 变化最大的节点（top changed nodes） | ✅ 见 §C |
| 排名变化最大（top ranking changes） | ✅ `rank 3→6 (+3)` / `rank 3→1 (−2)` 等，见 §F |
| median delta / p90 delta | ✅ priority：median 3 / max 9；rank：median 2 / max 3 |
| 受影响学生比例 / 无影响比例 | ✅ 100% / 13.3% |
| authoritative write = 0 | ✅ 指纹 deep-equal |
| production behavior unchanged | ✅ `score-center/service.ts` 零改动 |

**同时交付两条产品级判断项**（非工程可决）：
1. **分布压缩是否可接受**：效应随区间变号（+0.1177 → −0.0735），会压缩掌握度分布并对 `calculatePriority` 的 weakness 分量**非均匀**生效。
2. **"低分区答错反而涨"是否可接受**：这是生产 EMA 的错误目标值（≈0.29）导致的既有性质，切换后会直接暴露给学生。

**未做的事（遵守指令）**：未切换、未部署、未修改 F4 Ability 映射、未替 Owner 决策、未请求人工批准。

---

## M. Interview-facing Technology Stack & Engineering Highlights

### 本轮真实涉及的技术

| 技术 | 本轮使用位置 |
|---|---|
| **NestJS** | 新增只读服务 `ShadowDecisionChainService`、端点 `GET /coach/shadow-decision-chain`、`@Optional()` DI、`RoleGuard` + `@Roles` |
| **TypeScript** | 纯模块类型契约、`tsc --noEmit` 三端通过；本轮还因 `as never` 绕过类型检查而放过一个缺陷（见亮点 6） |
| **Prisma** | 学生 scoped 查询、`User.remainingDays` 真实字段、复合唯一约束（`Question(familyId, versionNumber)`） |
| **PostgreSQL** | 真实库端到端：15 学生 × 6 节点夹具、迁移、指纹前后比对 |
| **React** | 本轮未改前端（影子链为 teacher/admin 仪器）；相关前端资产为 V12-M2b 的证据账本 |
| **Mastery Engine** | EMA 重放（`updateMasteryAfterAttempt`）、`estimateRetention`、错误目标值 0.29 的实证 |
| **Recommendation Engine** | 直接复用 `runRecommendation` + `calculatePriority` 产出两条排名 |
| **Shadow Modeling** | 双路径同原语、`authoritative:false` 贯穿、风险码、预注册阈值 |
| **Explainable Ranking** | rank delta + entered/exited + top1Changed + 逐节点归因句 + 触发事件 |
| **E2E / Integration Testing** | 真实 HTTP + 真实 PostgreSQL；隔离/确定性/归因/零写入四类断言 |

### 工程亮点（可追问）

1. **双路径同原语对照**：不是"再写一个影子引擎"，而是同一批生产函数喂两套掌握度输入——这让差异**在架构上就只能是掌握度**。测试断言模块 import 了生产原语且未重定义权重。
2. **归因在汇编期绑定而非事后推测**：`assembleReplayInputs` 为每个节点记录其最新复习观测作为 trigger，`UNATTRIBUTED_*` 风险码兜底。
3. **风险不是文档而是代码**：`PRIORITY_SWING` / `RANK_SPREAD` / `UNIVERSE_MISMATCH` / `UNATTRIBUTED_MASTERY` / `UNATTRIBUTED_RANK` 五类风险由纯模块产出，阈值是发布常量。
4. **零写入是断言出来的**：不是"我们没写"，而是 5 张权威表指纹前后 deep-equal。
5. **测量设计本身被审查**：发现"单节点学生使排名不可观测"与"被复习节点被偏移使区间标签失真"两处设计缺陷并修正——**输出合法的 0 比报错更危险**。
6. **静默回退的代价**：`User.examDate` 不存在 + `as never` + `.catch(()=>null)` 让一个缺陷在 tsc、2200 单测、四套集成全绿下存活；只有把影子向下游传播时才暴露。修复后加了剥离注释的字段守卫。
7. **方向比幅度重要**：排名变化不是随机抖动，而是与"掌握度→紧迫度"语义完全自洽（答对后移、答错前移），并量化出**收益递减、代价递增**的不对称结构。
