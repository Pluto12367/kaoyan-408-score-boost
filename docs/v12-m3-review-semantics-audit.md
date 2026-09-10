# V12-M3 — Review Semantics Audit & Unification Design

> 里程碑：V12-M3（Review Semantics Unification，EB-2 / EB-5）
> 阶段：**Phase A — 只读审计完成**（本文件），Phase B 影子对照实现，Phase C 切换设计（**需所有者批准**）
> 纪律：本审计**零代码修改**（仅新增本文档）；后续 Phase B 为**只读影子**，不改任何生产写语义

---

## 1. 三套"复习/记忆"表示法并存（实证）

系统里同时存在三套相关但**单位与语义互不兼容**的表示：

| # | 系统 | 载体 | 时间/状态单位 | 粒度 | 写入方 |
|---|---|---|---|---|---|
| **A** | SM-2 式排程 | `ReviewSchedule` / `ReviewAttempt` | `stability: String`（`learning`/`review`/`mastered` 状态机）+ `nextReviewAt` | **题目** | `StudyService.reportWrongReason` |
| **B** | EMA 掌握度 | `UserKnowledgeMastery` | `stabilityDays: Float?`（**数值天数**）+ `retention: Float?` | **知识节点** | `ScoreCenterService.applyAttempts` / `applyReview` |
| **C** | FSRS 预测器 | 纯函数，**无存储** | `(S: 天数, D: 1..10)` | 无（未接线） | 无 |

### 1.1 A 的稳定性是**字符串状态机**，不是天数

`prisma/schema.prisma:748` `stability String @default("learning")`。转移规则在 `apps/api/src/study/study.service.ts:2304-2310`：`consecutiveCorrect >= 3 → mastered`，`>= 1 → review`。间隔由 `nextReviewIntervalDays({consecutiveCorrect, slowReview})`（`packages/shared/src/learning.ts`）给出，慢复习判定 `timeSpentSec > expectedTimeSec × 1.45`。

### 1.2 B 的 `stabilityDays` 是**数值天数**，由 EMA 侧倍率更新

`packages/shared/src/score-center/mastery.ts:58-64`：
```
updateStabilityAfterReview(previousStabilityDays, quality) = clamp_min_0.5( (previousStabilityDays ?? 1) × STABILITY_MULTIPLIERS[quality] )
STABILITY_MULTIPLIERS = {0:0.6, 1:0.8, 2:1.0, 3:1.35, 4:1.7, 5:2.1}
```
调用处 `apps/api/src/score-center/service.ts:158-163` 传 `quality = redoCorrect ? 4 : 2`。

### 1.3 两套间隔算法给出的天数可以不一致

| 来源 | 公式 | 示例（连续正确 1 次、非慢） |
|---|---|---|
| A `nextReviewIntervalDays` | 表驱动 `REVIEW_INTERVAL_DAYS`（`learning.ts`） | 依表取值 |
| B `stabilityDays` | `1 × 1.7 = 1.7` 天 | 1.7 天 |

**同一次复习，A 排到 `nextReviewAt`（题目级），B 写 `stabilityDays`（节点级），两者永不对账。**

---

## 2. REVIEW SEMANTICS MATRIX（逐动作实证）

判定口径：Activity = 是否留下动作记录；Evidence = 是否产生可支撑能力推断的观测（V12-M1 语义）；Mastery = 是否改变 `UserKnowledgeMastery.mastery`；Schedule = 是否改变 `ReviewSchedule`/`nextReviewAt`。

| Action | Activity | Evidence | 是否改 Mastery | 是否改 Schedule | 证据（file:line） |
|---|---|---|---|---|---|
| 打开错题 | ✅ `wrong.open_review` | ❌ | ❌ | ❌ | `App.tsx:850` |
| **标记已复习** `reviewWrongQuestion` | ✅ `wrong.review` + M1 活动证据 | ⚠️ **仅活动**（M1 显式声明） | ❌ **无** | ❌ **无** | `study.service.ts:2181-2201`；M1 `:2201-2211` |
| **错因上报**（`isReview=false`） | ✅ | ✅ 回忆观测（strong，M1） | ❌ **无** | ✅ 安排到次日 | `study.service.ts:2278-2302`；M1 证据在 `:2365-2375` |
| **复习重做**（`isReview=true`） | ✅ | ✅ 回忆观测（strong，M1） | ❌ **无（见 §3）** | ✅ 间隔 + 稳定性 | `study.service.ts:2353-2358` → `applyReview` |
| 练习作答 | ✅ `practice.submit` | ✅ 已判分（strong） | ✅ `applyAttempts`（EMA） | ❌ | `study.service.ts:2986 / 3042 / 3123 / 4449` |
| 任务完成 | ✅ `task.complete` + M1 证据 | ⚠️ 弱（自评）/ 无 / **强（M1 在任务范围观测到练习）** | ❌ **无** | ✅ 次日计划调整 | `study.service.ts:3450-3461`；M1 接线 `:3450` 前后 |
| 测评提交 | ✅ | ✅ strong | ✅（逐题走 `createPracticeRecord`） | ❌ | `study.service.ts:3595-3601` |

---

## 3. 核心断链：`applyReview` **不改掌握度**（比 EB-5 原始描述更尖锐）

审计原文 EB-5 为"复习尝试不回流掌握度（`applyReview` 仅 `isReview=true`）"。实证发现比这更严重：

```ts
// apps/api/src/score-center/service.ts:156-171
const saved = await saveMasteryWithOptimisticRetry(tx, userId, node.id, (row) => {
  const current = row ? toMasteryState(row) : neutralMastery();
  const stabilityDays = updateStabilityAfterReview(row?.stabilityDays ?? null, input.redoCorrect ? 4 : 2);
  const retention = 1;
  const nextReviewAt = new Date(input.reviewedAt.getTime() + stabilityDays * 86_400_000);
  return {
    ...current,              // ← mastery / accuracy / recentAccuracy / attempts / correctCount 全部原样保留
    retention,
    stabilityDays,
    lastReviewedAt: input.reviewedAt,
    nextReviewAt,
  };
});
```

三条实证结论：

1. **`isReview` 不是"是否回流掌握度"的开关，而是"是否更新排程字段"的开关**。无论 `isReview` 取何值，`mastery` 都不会因复习而改变。
2. **观察到的复习结果（`redoCorrect`，强证据）对能力估计零贡献**——它只影响 `stabilityDays` 与 `nextReviewAt`。学生答对了复习题，系统不会认为他更会了。
3. **`retention` 被硬编码为 `1`**（`:162`）。这是一个**无条件宣称**"刚复习完保持率 100%"，与 `mastery.ts:48-56` 的 `estimateRetention`（按 `elapsedDays / stabilityDays` 指数衰减）不是同一个口径，也没有任何观测支撑。它同时写进 `UserKnowledgeMastery.retention` 与每日 `UserMasterySnapshot`。

> 与之对照：练习路径 `applyAttempts`（`:105-137`）会真正推进 `mastery`（EMA）。**同一名学生做同一道题的同一个正确行为，走"练习"入口会提升掌握度，走"复习"入口不会。** 这是 V12 证据链在"Evidence → Ability"上最实质的缺口。

---

## 4. 统一方案（Phase B 影子 + Phase C 切换）

### 4.1 统一语义（提议）

```
复习结果（redoCorrect，已观测） = 一次已判分作答
        ↓ 与练习走同一掌握度更新（updateMasteryAfterAttempt，role=PRIMARY）
Review Evidence → Mastery Evidence → 同一 EMA 口径
        ↓
stabilityDays / nextReviewAt 由统一口径重算（而非硬编码 retention=1）
```

要点：
- 复习与练习**共享同一套 `updateMasteryAfterAttempt`**，消除"同行为不同结果"
- `retention` 改为由 `estimateRetention(elapsedDays, stabilityDays)` 计算，而非常量 1
- A（题目级排程）保留，但其 `nextReviewAt` 与 B 的 `stabilityDays` 需建立**对账**（同一次复习只有一个权威间隔）

### 4.2 为什么必须先影子（Phase B，本轮实施）

任务 §9.1 明确：改变 `applyReview` 语义属高风险，必须先设计 `migration-free / backward-compatible / reversible`。因此本轮**只做只读影子**：

对每位学生的复习历史，**重放**：
1. 以 `UserMasterySnapshot` 取窗口起点掌握度作为基线
2. 按时间顺序对每次已观测复习应用 `updateMasteryAfterAttempt`（统一语义）
3. 与**当前存储的** `UserKnowledgeMastery.mastery` 对比，输出偏差
4. 同时用 FSRS 预测器对同一历史给出保持率预测，与 `review-shadow` 的**观测**保持率对比

影子输出全部标注 `NON-AUTHORITATIVE`，不写任何表。

### 4.3 Phase C 切换设计（**需所有者批准，本轮不实施**）

| 项 | 设计 |
|---|---|
| **变更类型** | 纯语义（无 Schema 变更）：`applyReview` 增加对 `mastery/accuracy/recentAccuracy/attempts/correctCount` 的 EMA 更新；`retention` 改为计算值 |
| **迁移** | **零迁移**。历史 `UserKnowledgeMastery` 行不回填（避免不可逆改写历史）；新语义只对切换后的复习生效 |
| **向后兼容** | 响应结构不变（`applyReview` 无返回值消费方）；`stabilityDays`/`nextReviewAt` 字段语义不变 |
| **可回滚** | 单文件回滚（`score-center/service.ts` 的 `applyReview` 函数体）；无数据形态变更，回滚后新写入的 mastery 值留在原字段（无需清理） |
| **预注册切换阈值** | 影子里程碑要求：偏差方向一致率 ≥ 70% **且** 复习样本 ≥ 30（沿用 `MIN_SHADOW_SAMPLE`）；达标前不切换 |
| **风险** | 切换后掌握度将被复习拉高，可能改变推荐排序（`calculatePriority` 消费 `mastery`）→ 需在影子期同时观测推荐排序变化幅度 |
| **人在环** | 由所有者批准后实施；实施后保留影子端点继续对照 ≥ 1 个观察窗 |

---

## 5. 本轮（Phase A）交付物

- 本审计文档（含上述矩阵与 file:line 证据）
- **零代码修改、零 Schema 触碰、零生产行为变更**

Phase B（影子）在同一里程碑内继续实施，见 `docs/v12-m3-review-shadow.md`。

---

## 6. UNKNOWN / 未能确认

| 项 | 原因 |
|---|---|
| 生产环境 `ReviewAttempt` 实际样本量与间隔分布 | 需连生产库；本会话 Docker 引擎未就绪，55432 测试库不可用 |
| `nextReviewIntervalDays` 完整表值 | 只确认函数存在与调用点；未逐值读取 `REVIEW_INTERVAL_DAYS` 全表 |
| 历史 `UserKnowledgeMastery.retention` 是否已被前端消费 | 需前端消费面审计；本轮未做 |
| A 与 B 分歧的实际分布（多少条复习的排程与 stabilityDays 不一致） | 需真实数据 |
