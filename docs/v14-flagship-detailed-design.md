# V14 差异化三方向 具体设计（①提分闭环 ②AI估分 ③今天做什么）

> **Status**: DESIGN GATE — 待 Owner 批准，未实施任何代码变更。
> **上游文档**: `docs/v14-differentiation-roadmap-design.md`（方向级任务书，本文为其 ①②③ 的落地级设计）。
> **审计基线**: 2026-09-27 一手读码（文件:行号见各节）；④教师轨不在本文范围。

---

# ① 可验证提分闭环（提分账本）

## 1.1 审计事实（修正任务书假设）

| 事实 | 出处 | 设计影响 |
|---|---|---|
| **处方不落库**——每次即时计算自 ErrorDiagnosis | `training-prescription.service.ts:51-123` | 差分锚点**不能**依赖处方记录表；改锚定 ScoreLossItem 本身 |
| `buildScoreRecovery` **已实现**：逐题失分↔复做配对（practice+review 双源）、`observedLossWithReattemptSuccess` / `proxyLossWithReattemptSuccess` 分列、node 级聚合 | `score-anchor/score-recovery.ts:77-94`、`score-recovery.service.ts:87-111` | ①的 80% 是把已有输出**升级为合规声明 + 证据下钻 + 展示**，不是从零建测量 |
| ScoreLossItem 带 `scoreEntryKind/Id`（账本行溯源）、`gradingMethod` | `prisma/schema.prisma:1304-1328` | 证据链下钻的数据都在 |
| prescription retest 步与 review 调度共用 `REVIEW_INTERVAL_DAYS` | `training-prescription.ts` | 时间窗参数同源，无需新约定 |

## 1.2 测量口径（本方向的核心 Owner 决策 D-V-1′）

任务书原案「同节点复测差分」审计后修正为**两层口径**（复用 recovery 已有配对，避免重写）：

```
层1（已有，直接升级声明）：同题复做成功
  loss(questionId, t0) 之后窗口内该题首次 correct 复做（practice 或 review）
  → 该题 lostScore 计入 recoveredCandidates
  证据等级 = loss 行自身的 lossKind（OBSERVED 失分被追回 → OBSERVED 挽回）

层2（新增，PROXY）：同节点同型补偿
  未同题追回、但同 (nodeId, subtype) 有后续正确作答的
  → 只进 PROXY 声明（不是同一道题，不能宣称 OBSERVED 追回）
```

**为什么不强行做"同节点差分"**：处方不落库 ⇒ 无法严格归属"这次复测是那个处方触发的"；
同题复做配对 recovery 已实现且语义最硬。同节点补偿作为 PROXY 层给出，诚实分层。

## 1.3 API 契约

**`GET /coach/score-recovery`（端点已在，仅确认暴露）** → 已有 `ScoreRecoveryResult`。
**新增 `GET /coach/recovery-evidence?nodeId=X`**（下钻，只读）：

```jsonc
{
  "nodeId": "DS-C02-S04-P05",
  "nodeName": "单链表操作",
  "window": { "days": 30, "from": "...", "to": "..." },
  "claims": [
    {
      "kind": "OBSERVED",                    // 同题追回
      "recoveredScore": 10,
      "questionId": "q-2009-42",
      "lossEntry": { "scoreEntryKind": "assessment", "scoreEntryId": "...", "recordedAt": "...", "lostScore": 15 },
      "reattempt": { "source": "practice", "occurredAt": "...", "correct": true },
      "note": "2026-09-12 模考丢 15 分 → 09-25 复做全对（按 10 分可追回口径）"
    }
  ],
  "proxyClaims": [ { "kind": "PROXY", "note": "同考点 3 题后续正确，非原题" } ],
  "insufficient": { "recoveredCandidates": 1, "minSamples": 3, "status": "insufficient_data" }
}
```

**声明门槛**（D-V-2）：`recoveredCandidates < N(建议3)` → 整页只显示 `insufficient_data` 计数，
不输出任何挽回分数字（RULE-06）。

## 1.4 纯模块（shared，TDD 先行）

```ts
// packages/shared/src/score-anchor/recovery-claim.ts（新文件）
export interface RecoveryClaimInput { /* recovery rows + loss 明细 */ }
export interface RecoveryClaim {
  kind: 'OBSERVED' | 'PROXY';
  recoveredScore: number | null;        // null = 未定价失分（只计数不定价）
  questionId: string | null;            // PROXY 层为 null
  evidenceRef: { scoreEntryId: string; questionId: string } | null;
  note: string;
}
export function buildRecoveryClaims(input: RecoveryClaimInput): {
  claims: RecoveryClaim[];
  proxyClaims: RecoveryClaim[];
  summary: { observedRecovered: number; proxyRecovered: number; insufficient: boolean };
};
```

规则钉死（测试断言）：
- 未定价失分（`lostScore=null`）追回 → 计数进 `unpricedRecovered`，**金额列 null**；
- OBSERVED 挽回只能来自 `lossKind=OBSERVED` 行 + 客观判分（`gradingMethod=exact_match`）或
  `teacher_graded`；`self_reported/rubric` 失分的追回落 PROXY；
- 时间配对：仅 `recordedAt < reattempt.occurredAt` 的首对生效（后同题重复正确不重复计数）；
- 汇总守恒：`observedRecovered + proxyRecovered + outstanding = observedLost + proxyLost`
  （复用 recovery IL-6 守恒断言模式）。

## 1.5 UI（学生端「提分账本」）

位置：学习总览新增卡片（数据不足时整卡显示"复测样本不足，继续训练即可累积"——诚实空态，
不隐藏）。达门槛后：两行大数（OBSERVED 挽回 X 分 / PROXY 挽回 Y 分）+ 每条 claim 可点开
展示 `note` 证据链。**页面顶部固定语义脚注**："挽回分 = 失分被后续正确作答追回的测量值，
不是成绩预测。"

## 1.6 门禁与工作量

- 单元：`recovery-claim` 纯模块（配对/分层/守恒/门槛 4 组断言）。
- E2E（真实 PG）：seed 失分→复做→账本声明数字逐位断言；**拒绝路径**：未定价追回不产生金额、
  样本不足不产生声明、self_reported 失分不产生 OBSERVED。
- 展示面：真实浏览器目检。
- 工作量：纯模块+服务 0.5d，下钻端点 0.5d，UI+目检 1d。**部署前可全部完成但空态上线**
  （D-V-3 建议改为：随 ③ 同批上线，空态文案即价值——告诉学生"系统在为你记账"）。

---

# ② 可解释 AI 大题估分

## 2.1 审计事实

- `GET /questions/:id/rubric`、`POST /questions/:id/subjective-attempt`（离线评分+证据留痕
  带 rubricVersion/hash）已在——`large-question.service.ts` 的证据记录模式直接复用。
- `deepseek-client.ts:91 chatCompletions`（OpenAI 兼容，默认 deepseek-v4-flash）。
- 套卷逐题 `selfScore/maxScore` 透传已在（D-S 后为真实刻度）。
- `scoreLargeQuestion`（离线关键词判定）可作 AI 判定的**结构模板**（criteria outcome 同形）。

## 2.2 数据流

```
交卷自评页（ExamSession 交卷确认弹窗）
  └─「AI 帮我估」按钮（仅综合题 + 有 rubric + 已写答案）
       ↓ POST /questions/:id/ai-estimate { answerText }
  服务端：题面 + 学生作答 + rubric(校验后) → LLM 结构化判定
       ↓ 返回（不落任何分数字段，仅建议）
  学生逐采分点看到 ✓/✗ + 理由 + 建议分 → 确认或改写 selfScore
       ↓ 既有 submitPaper 链路（学生确认值）
  落账：PracticeRecord.gradingMode='ai_assisted_self'，ScoreLossItem.gradingMethod='rubric'，
        lossKind=PROXY（结构性）；估分详情存 LearningEvidence（复用 large-question 模式，
        含 rubricVersion+rubricHash+模型名+原始响应摘要）
```

## 2.3 API 契约

**新增 `POST /questions/:questionId/ai-estimate`**（RoleGuard 全角色；限本人）：

```jsonc
// 请求 { "answerText": "..." }（≤5000 字，与 subjective-attempt 同限）
// 响应
{
  "questionId": "q-2009-41",
  "rubricVersion": 2,
  "rubricHash": "rv2-1a2b3c4d",
  "suggestedScore": 7,
  "maxScore": 10,
  "criteria": [
    { "id": "c1", "matched": true,  "points": 2, "reason": "明确给出否定结论" },
    { "id": "c2", "matched": false, "points": 4, "reason": "反例不完整：未给出边权" }
  ],
  "confidence": "medium",
  "limitations": "AI 估分仅供参考（PROXY），最终以你确认的自评分为准。",
  "basis": "ai_rubric_match",
  "evidenceKey": "ev-..."          // 估分行为留痕（无分数写方语义）
}
// 失败（超时/无key/解析失败）：503 { message: "AI 估分暂不可用，请自行评分", reason: "ai_unavailable" }
```

**提示词契约**（服务端模板，学生不可注入）：system 固定为"按给定 rubric 逐采分点判定，
只依据答案文本是否包含该采分点所述证据"；输入 = 题面摘要 + criteria(JSON) + 学生答案；
输出强制 JSON schema（`response_format` 或模板+严格解析，解析失败即 503，不重试造数）。

## 2.4 硬不变量（测试钉死）

1. `ai-estimate` 端点**无任何分数字段落库路径**——只有学生确认后的 submitPaper 写分；
2. 落账行 `lossKind=PROXY`、`gradingMethod='rubric'`，rubricVersion/hash 随行；
3. 无 `AI_API_KEY` / AI 失败 → 503 显式降级，前端保留手填自评（绝不预填 0）；
4. 每用户每日调用限额（env 可配，默认 20），超限 429 + 获取路径说明（复用 CodeBrick 的
   "拒绝给路径"模式）；限留配置位，不引入积分制（商业模式 Gate 另议）；
5. 演示模式（无 DB）→ 显式拒绝（同套卷守卫）。

## 2.5 UI

交卷确认弹窗综合题行：自评输入旁「AI 帮我估」→ 内联展开逐采分点 ✓/✗ 列表（复用
`RubricCriterionOutcome` 呈现形状）+ 建议分按钮「采用」/「自己评」。顶部固定
`limitations` 文案。

## 2.6 门禁与工作量

- 单元：提示词构造器（纯函数）+ 响应解析器（坏 JSON/超长/缺字段 → 显式失败）。
- E2E（真实 PG + mock LLM server）：估分→确认→落账 PROXY 断言；**拒绝路径**：无 key 503、
  超限 429、未写答案 400、无 rubric 404、估分端点直连不产生任何分数写。
- 目检：真题套卷 2009 Q41 估分交互全流程截图。
- 工作量：服务+提示词 1d，前端 0.5d，测试 0.5d。**依赖 D-S 先落地。**

---

# ③ 处方消费面「今天做什么」

## 3.1 审计事实

- 处方 `ladder` 形状完整：`{stage,label,status,questionCount,dueInDays,reason}`，
  `status ∈ READY/UNAVAILABLE/NO_CONTENT`（无内容不编题）。
- 三数据源端点全通：prescription（即时计算）、`GET /review/due`、
  `GET /wrong-questions/summary`。
- 前端 todayPlan/首页今日任务区已在，缺合并与原因串。

## 3.2 API 契约

**新增 `GET /coach/today-actions?limit=3`**（student；只读，零写方）：

```jsonc
{
  "generatedAt": "...",
  "storeAvailable": true,
  "actions": [
    {
      "id": "rx-1",
      "kind": "prescription_step",          // prescription_step | review_due | wrong_due
      "priority": 1,
      "title": "同型题变式训练 · 单链表操作",
      "reason": "9/20 起该考点 2 题复发（observed 失分 8），处方第 3 步",
      "reasonRefs": { "nodeId": "DS-C02-S04-P05", "findingReasonCode": "..." },
      "launch": { "type": "practice_set", "nodeId": "...", "subtype": "...", "questionCount": 4 },
      "evidenceLink": "/coach/learning-evidence?nodeId=..."   // 可溯源
    },
    { "kind": "review_due", "title": "复习到期 3 题", "reason": "按遗忘曲线今日到期",
      "launch": { "type": "due_review" } },
    { "kind": "wrong_due", "title": "错题复盘 2 题", "reason": "9/26 模考新增，黄金 48h 内",
      "launch": { "type": "wrong_book" } }
  ],
  "nothingReason": null                     // 无动作时的显式原因（如"完成入学诊断后生成"）
}
```

**合并规则（shared 纯模块 `today-actions.ts`，TDD 先行）**：
- 排序：prescription(READY) > review_due > wrong_due；`UNAVAILABLE/NO_CONTENT` 处方不产出动作；
- 每源最多 2 条，总量 ≤ limit（D-T-2 建议 3）；
- reason 串**只引用证据字段原文**（count/observedLostScore/stage），不生成新判断——
  复用处方 `reason` 与 finding 字段拼接，杜绝黑盒文案；
- 全空 → `nothingReason` 给出下一步引导（onboarding/诊断），不静默空白。

## 3.3 UI

首页今日任务区顶部：动作卡横排（主行动大卡 + 副卡），每卡 title + reason 小字 +
「开始」按钮（复用既有启动链：practice_set 显式题单 / due review / 错题本跳转——零新
会话语义，同 freePracticeContext 模式）。完成态：动作卡打勾（内存标记，D-T-1 只读投影）。

## 3.4 门禁与工作量

- 单元：合并纯模块（排序/上限/空态/reason 拼接不含派生判断）。
- 契约：首页挂载、`nothingReason` 诚实空态、启动链复用。
- E2E：seed 失分→诊断→今日动作出现且 reason 数字与账本一致；拒绝路径：无诊断用户
  `nothingReason=引导诊断`。
- 工作量：纯模块+端点 1d，UI 0.5d，测试 0.5d。

---

# 统一实施批次建议

```
批次1（立即）：D-S 刻度 → ② AI 估分（依赖链）          ~1.5d+0.5d 前端
批次2（随后）：③ today-actions + ① 账本空态上线（同批）   ~2d + 1.5d
```

共 ~6 个工作日，全部零 schema 变更、零新写方语义（②仅新增 gradingMode 枚举值 +
evidence 类型，均 additive）。每批独立走 RULE-01 全链 + 提交点。

## Owner Decision 汇总（批本文即冻结）

| # | 决策 | 建议 |
|---|---|---|
| D-V-1′ | 测量口径改两层（同题追回=OBSERVED / 同节点补偿=PROXY） | 按修正案 |
| D-V-2 | OBSERVED 声明最小样本 | 3 |
| D-V-3 | ①随批次2 空态上线（文案即价值） | 是 |
| D-A-1..3 | 沿用路线任务书建议（拆列入卷面/必须确认/进 ledger） | 按建议 |
| D-T-1..2 | 只读投影 + 内存完成态 / 上限 3 条 | 按建议 |
| 新 D-X-1 | ② 日限额默认 20 次/人（env 可配） | 按建议 |
