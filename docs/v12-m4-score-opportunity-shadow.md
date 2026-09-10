# V12-M4 — Score Opportunity Shadow Model

> 里程碑：V12-M4（Score Opportunity Shadow）
> 目标：回答"学生现在时间有限，哪个薄弱点最值得训练？"
> 状态：**实现 + 测试 + 门禁通过**
> 纪律：**只读影子 / 零 Schema / 零生产排序变更 / 每个因子必须标注真实数据来源**

---

## 1. 任务约束与应对

任务 §10.1 给出的候选公式：

```
Opportunity = Weakness × Exam Importance × Recoverability × Evidence Confidence × Urgency ÷ Training Cost
```

但同时明确：**"公式不是事实。必须验证每个变量是否有真实数据支撑。"** 以及 §10.2：**"禁止 Black-box score"**。

因此本模块的设计原则不是"让排名看起来合理"，而是：**每个因子必须点名它来自哪张表哪个字段，并标注置信度；缺少真实数据的因子必须被显式排除，而不是悄悄按 0 计入或用貌似合理的数字替代。**

---

## 2. 六个因子的真实数据核查（本轮核心工作）

| 因子 | 数据来源 | 类型 | 最高置信 | 诚实说明 |
|---|---|---|---|---|
| `weakness` | `UserKnowledgeMastery.mastery` | **实测** | high | 缺口 = 1 − 存储掌握度 |
| `examImportance` | `KnowledgeFrequencySnapshot.primaryScore5y` | **实测** | high | 复用快照自身的 5 年主考点分值并在候选集内归一化——**不另造第二套考频公式** |
| `recoverability` | 代理：`correctCount>0` + `KnowledgeRelation` 前置就绪度 | **代理** | **low** | 系统**没有**可恢复性的直接测量；关系数据稀疏（33 前置/21 关联）进一步限制可靠性 |
| `evidenceConfidence` | `KnowledgeFrequencySnapshot.evidenceConfidence` | **实测** | high | 不额外加工 |
| `urgency` | `User.examDate` + `UserKnowledgeMastery.retention` | **实测** | high | 考试临近度与保持率下滑的合成 |
| `trainingCost` | `estimateMinutes(action, difficulty)`（生产估算器） | **估算** | **medium** | 是估算不是实测用时 |

**权重是公开常量**（`SCORE_OPPORTUNITY_WEIGHTS`，归一化为 1），任何评审者都能手算复现任一分值——这是"反黑箱"的具体兑现。

---

## 3. 三条诚实规则（测试钉死）

| 规则 | 行为 |
|---|---|
| **必需因子缺失 → 不出分** | 必需集 = `weakness` / `examImportance` / `trainingCost`。任一缺失则 `score=null`、`blockedBy` 点名、`basis`/`reason` 用中文说明"拒绝用替代值估算" |
| **可选因子缺失 → 排除并降级** | `recoverability` / `evidenceConfidence` / `urgency` 缺失时进入 `exclusions[]`（含中文原因），权重在可用因子上**重新归一化**，整体置信度下调（≥2 项排除 → `low`） |
| **不可测即为不可测** | 考频为 0 分（`primaryScore5y=0`）→ `examImportance=null`（**不当作"重要性 0"**）；无掌握度行 → `weakness=null`（**不假设 0.5**）；无前置边 → `prerequisiteReadiness=null`（**不读作"已就绪"**） |

### 3.1 一个在 TDD 中被抓出的建模问题（诚实记录）

初版 `recoverability` 代理对"从未做对过但前置就绪"的节点给出 `0.55`（中高）。测试断言其应低于 0.5 而失败。**判定为建模缺陷而非测试缺陷**：把"从未做对过"的节点评为较高可恢复性，会导致系统推荐一个没有表现出任何切入点的知识点。

修复：`everSucceeded === false` 时代理值**封顶 0.45**，并在 `basis` 中说明该封顶依据。

---

## 4. 实现清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/shared/src/score-center/score-opportunity.ts` | 新增（纯） | 因子目录、公开权重、`buildScoreOpportunity`、排除/阻断/置信度解析、中文理由与风险文案 |
| `apps/api/src/study/score-opportunity.service.ts` | 新增（只读） | 装配：最新快照 + 掌握度 + 节点 + 前置关系 → 因子；按分排序取 Top-N |
| `apps/api/src/study/daily-brief.controller.ts` | 修改 | `GET /coach/score-opportunity`（**teacher/admin**，走 `resolveUserId`） |
| `apps/api/src/study/study.module.ts` | 修改 | 注册 provider |
| `test/score-opportunity.test.js` | 新增（14 项） | 纯模块契约 |
| `test/score-opportunity-service.test.js` | 新增（9 项） | 装配 / 阻断 / 稀疏数据 / 端点 / 只读边界 |

**零迁移**：只读 `KnowledgeFrequencySnapshot` / `UserKnowledgeMastery` / `KnowledgeNode` / `KnowledgeRelation` / `User`。

**未重造推荐引擎**：考频的完整加权混合仍是推荐引擎（`calculatePriority`）的职责，引擎保持**权威排序**；本影子只补它缺失的"可恢复性 + 单位时间收益"维度。

---

## 5. 端点

```
GET /coach/score-opportunity?userId=<可选>&top=10
```
- 角色：**teacher / admin**（模型质量仪器，非学生界面）
- 返回：`{ userId, generatedAt, authoritative:false, opportunities[], summary{candidatesEvaluated, scored, blocked, blockedByFactor, confidenceMix, basis} }`
- 每行含：`score`（可为 null）、`confidence`、六个 `factors[]`（含 `value/weight/confidence/source/basis`）、`exclusions[]`、`blockedBy[]`、`reason`、`expectedBenefit`（**区间** + `expectedBenefitIsEstimate:true`）、`risk`

## 6. 门禁证据

| 项 | 结果 |
|---|---|
| shared 构建 / API 类型检查 | exit 0 / exit 0 |
| 纯模块 | **14/14 pass** |
| 服务/端点 | **9/9 pass** |
| **`npm test`** | **2165 tests / 2163 pass / 0 fail / 2 skip，exit 0** |
| **`npm run build:api` / `build:web`** | exit 0 / exit 0 |

## 7. 明确未做 / UNKNOWN

| 项 | 原因 |
|---|---|
| 机会分与真实成绩的对照 | 属 V12-M5；本轮 `expectedBenefit` 明确标注为估算区间且需真实模考对照 |
| 用真实数据评估影子排名质量 | 需连数据库；本会话 Docker 引擎未就绪 |
| 推荐引擎消费机会分 | **刻意不做**——影子未验证前不得影响生产排序 |
| `recoverability` 的直接测量 | 系统当前无此数据；若未来引入，应从"曾做对节点在 N 天后的保持率"构造，而非继续用代理 |
