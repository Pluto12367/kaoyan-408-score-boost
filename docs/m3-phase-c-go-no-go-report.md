# M3 Phase C — Final Go/No-Go Report

> 日期：2026-09-11 · 分支 `feature/v3-product-refactor` · HEAD `205708c`
> 所有者决定：**C1 = APPROVED** · **C2 = REJECTED FOR NOW** · **禁止直接切换生产**
> 本轮范围：把 C1 提升为 production-ready / reversible / auditable 的**迁移候选**（**未启用**）

---

## 0. 一句话结论

**C1 已成为可切换、可回滚、可审计的迁移候选，且开关未被启用。** 逐项验证七项全 PASS（§7）。但迁移验证同时得到一个**必须交给你的事实**：**启用 C1 今天不会产生任何可观测变化**——因为生产系统目前**无法到达**会触发该缺陷的状态（§3）。这使切换为零风险，也意味着**单独切换 C1 并不等于交付 M3 语义统一**。

---

## 1. 交付物

| 项 | 内容 |
|---|---|
| 开关 | `packages/shared/src/score-center/mastery-semantics-switch.ts` |
| 切换变量 | `MASTERY_SEMANTICS`；**未设置 / 任何其他值 → legacy**；`c1` → 已批准候选 |
| 生产调用点 | `apps/api/src/score-center/service.ts` 的 **唯一** mastery transition 点（`applySingleAttempt`）改为经 `applyMasterySemantics` |
| 可审计性 | 启动日志新增一行 `Mastery semantics: legacy — …（未设置，使用默认）`，与既有 `Demo auth: enabled/disabled` 同风格 |
| 迁移验证脚本 | `scripts/integration-mastery-semantics-migration.mjs`（真实 PostgreSQL + 真实 HTTP + 真实写路径） |
| 测试 | 13 项新增（12 开关契约 + 1 带内逐位相同网格） |
| 迁移 | **零 schema 变更**、**零 API 契约变更**、**零数据迁移** |
| 回滚 | 取消该环境变量即可；无需改代码、无需改数据 |

**复用而非另造**：项目既有 flag 约定是 `process.env.X === 'true'`（`ALLOW_DEMO_AUTH`、`ALLOW_FAKE_DOCUMENT_PROVIDER`、`USE_KNODE_MASTERY`），本开关沿用同一形状，**未引入第二套 flag 机制**。未知值一律回落 legacy，**拼写错误不会静默启用语义变更**。

---

## 2. 迁移验证结果（A–E）

```
A. Reachable path         legacy 0.5518  vs  C1 0.5518   delta = 0        → IDENTICAL
B. Switch is live         legacy 0.2488  vs  C1 0.22     delta = −0.0288   → DIFFERENT
C. Read-only replay       authoritative fingerprint unchanged = true
                          divergent states = 4, 其中 in-band = 0
D. Rollback               C1 后 0.22 → 取消开关后 0.2488   → legacy 即时恢复
E. Aggregates             reachable impact = ZERO ; flag effective = YES ;
                          authoritative writes = 0 ; production switch enabled = NO
```

**A（可达路径）**：用**真实 API 写路径**（`POST /practice-records`）在同一节点上跑同一串复习序列（4 错 → 3 对 → 5 错 → 2 对，难度 3），legacy 与 C1 得到**完全相同**的 `0.5518`。

**B（开关确实生效）**：用一个**带外**夹具状态（掌握度 0.22、节点难度 1、一次错误）证明开关不是"接了但没生效"：legacy 把 0.22 **抬到** 0.2488，C1 保持 0.22。

**C（只读历史 replay，不变量 G）**：对库中真实节点状态在内存中跑两套语义，**五张权威表指纹前后一致**；4 个分歧状态**全部为带外**（来自 B/D 夹具），**带内分歧为 0**。

**D（回滚）**：同一夹具，先以 `MASTERY_SEMANTICS=c1` 写入 → 0.22；再**移除环境变量**重启 → 下一次转换恢复 legacy 行为（0.2488）。**无代码改动、无数据改写**。

---

## 3. 决定性的迁移安全发现（必须明示）

### 3.1 EMA 不会跨过自己的目标值

`m' = (1−α)·m + α·T` 是 `m` 与 `T` 的**凸组合**，因此：

> **若 `m` 在 `T` 的一侧，则 `m'` 仍在同侧，永不跨过 `T`。**

而生产初始值 `NEUTRAL_MASTERY = 0.5`，对**每一个难度**都落在 `[T_wrong(d), T_correct(d)]` 内（下界 0.38/0.20，上界 0.775/0.995）。

**实测**（每难度 2000 次随机交替 + 5000 次确定性）：

| 难度 | T_wrong | T_correct | 实测区间 | 违反 A | 违反 B | 跨过目标值 |
|---|---|---|---|---|---|---|
| 1 | 0.380 | 0.775 | [0.4132, 0.7479] | 0 | 0 | 0 |
| 3 | 0.290 | 0.885 | [0.3386, 0.8473] | 0 | 0 | 0 |
| 5 | 0.200 | 0.995 | [0.2548, 0.9730] | 0 | 0 | 0 |

### 3.2 没有任何生产/运维路径能产生带外掌握度

`UserKnowledgeMastery` 的全部写入点均经同一 EMA 从 0.5 出发：

| 写入点 | 是否可能带外 |
|---|---|
| `applySingleAttempt`（生产练习路径） | 否（从 `neutralMastery()`=0.5 起，经 EMA） |
| `scripts/backfill-user-mastery.mjs`（离线回填） | 否（同样从 `neutralMastery()` 起，经 `updateMasteryAfterAttempt`） |
| `Prisma` 字段默认 | 0.5（带内） |
| 测试夹具（`integration-*.mjs`） | **是**，但**仅测试数据** |

### 3.3 结论及其两面

> **公式违反不变量（已证）；但系统当前无法到达暴露它的状态（也已证）。**

- **好的一面**：启用 C1 **零风险**——在可达状态上**逐位相同**（由网格测试 `Object.is` 证明，>1000 个检查点）。
- **必须明示的一面**：因此**单独启用 C1 不会产生任何可观测变化**，它是对未来写入者的**防御性保证**（新回填、新导入、手工订正，或未来模型改动若引入带外初值）。

**并且**：M3 语义统一中**"复习结果回流掌握度"**是**另一个**改动（`applyReview` 目前不改 mastery），**不是** C1 开关的一部分。上一轮已量化其影响面（median mastery Δ +0.0229、p90 +0.1387、median \|Δpriority\| 3 / max 9、median \|Δrank\| 2 / max 3、11/15 出现排名变化）。**切换 C1 不会带来这部分收益。**

---

## 4. 生产影响模拟（Phase 6）

| 维度 | C1（本轮验证对象） | M3「复习流量回流」（另一组件，未实施） |
|---|---|---|
| 受影响学生 | **0** | 15/15（cohort） |
| 受影响 mastery 节点 | **0**（可达状态） | 15/15 |
| mastery delta 分布 | **全 0** | median +0.0229 / p90 +0.1387 |
| priority delta 分布 | **全 0** | median 3 / max 9 |
| opportunity delta 分布 | **全 0** | median ≈ −0.021 / max 0.059 |
| ranking delta 分布 | **全 0** | median 2 / max 3；11/15 有位移 |
| top changed recommendation | **无** | 见上一轮报告 §F |
| ranking churn | **0** | 有界（无爆炸、无震荡） |
| priority explosion | **无** | 无（阈值 25，最大 9） |
| low-mastery 行为 | 不变 | 由上一轮报告 §C.1 描述 |
| high-mastery 行为 | 不变 | 同上 |

**为什么 C1 全 0**：C1 只在 `m` 位于目标值**反向一侧**时改变结果，而 3.1/3.2 证明生产写路径**无法停在那一侧**。

**C1 在带外状态上的差异幅度**（仅供理解量级）：`0.22 / d1 / 错误`：legacy `0.2488` → C1 `0.22`（−0.0288）。

---

## 5. 不变量 A–G（Phase 4）

| 不变量 | 判定 | 证据 |
|---|---|---|
| **A** incorrect 不得提升 mastery | ✅ PASS | C1 下 5 区间 × 5 难度全部 `mastery' ≤ mastery`（测试）；真实库 `all_wrong` 旧 1/5 提升 → C1 **0/5** |
| **B** correct 不得降低 mastery | ✅ PASS | C1 下全带 `mastery' ≥ mastery`（测试）；真实库 `all_correct` 0/5 |
| **C** weakness 不因 incorrect 被降低 | ✅ PASS | 与 A 同域，C1 下成立 |
| **D** 无 uncontrolled priority explosion | ✅ PASS | C1 可达影响 0；带外场景 max \|Δpriority\| 仍在阈值 25 内（实测量级 9） |
| **E** 无 uncontrolled recommendation churn | ✅ PASS | C1 可达影响 0（排名 delta 全 0）；带外场景有界 |
| **F** 同事件 + 同状态 → 确定性 | ✅ PASS | 开关契约测试与链的重复调用断言；`Object.is` 网格 |
| **G** replay 不修改权威数据 | ✅ PASS | 五表指纹前后 **deep-equal**（`fingerprintUnchanged = true`） |

---

## 6. 迁移安全（Phase 5）

| 要求 | 结果 | 证据 |
|---|---|---|
| 无数据破坏 | ✅ | 零 schema/迁移；验证期间只操作一次性测试用户 |
| 无历史记录重写 | ✅ | 回滚**只影响下一次转换**，不改写已写入的 mastery（这正是 SoT 的要求，已在报告与代码注释中明示） |
| 无 student leakage | ✅ | 每个验证用户独立节点与唯一邮箱；清理阶段全部删除 |
| 无 duplicate events | ✅ | 每次 `POST /practice-records` 使用唯一 `Idempotency-Key` |
| 无 recommendation corruption | ✅ | C1 可达影响 0，推荐面不变 |
| Legacy → C1 → Rollback | ✅ | 取消环境变量即恢复 legacy 行为（D 段实测） |

---

## 7. 最终七项判定

```
C1 semantic invariants       PASS   （A/B/C 由测试与真实库双证；D 有界；F 确定性；G 无写入）
Historical replay            PASS   （真实库状态只读重放；4 个分歧全为带外，带内 0）
PostgreSQL E2E               PASS   （真实库 + 真实 HTTP + 真实写路径，exit 0）
Student isolation            PASS   （独立用户/节点/唯一邮箱；无跨学生污染）
Authoritative write safety   PASS   （五表指纹 deep-equal；authoritative writes = 0）
Rollback                     PASS   （取消开关即时恢复；无代码/数据改动）
Ranking stability            PASS   （C1 可达影响 0；带外场景有界，无爆炸、无震荡）
```

```
M3 PHASE C = READY TO SWITCH
```

**含义的准确界定**：以上判定的是**"C1 的迁移机制已就绪且可安全切换"**。它**不**表示"切换后会带来 M3 语义统一的收益"——那需要另一个改动（复习结果回流掌握度），本轮**未实施**、**未纳入此开关**。

---

## 8. 启用方式（**未执行**，供你决定后使用）

| 步骤 | 命令 / 动作 |
|---|---|
| 启用 | 在运行环境设置 `MASTERY_SEMANTICS=c1`，重启应用 |
| 确认已启用 | 启动日志出现 `Mastery semantics: c1 — C1 方向保持（所有者已批准）（显式启用）` |
| 回滚 | **移除** `MASTERY_SEMANTICS`（或设为任意其他值），重启 |
| 无需 | 无 schema 变更、无迁移、无代码改动、无数据订正 |

---

## 9. 本轮修复的缺陷

**在迁移验证中发现并修复**：`updateMasteryDirectionPreserving` 对结果做了 `round6`，而生产返回原始浮点。当夹取未生效（掌握度已在目标值同侧）时，这**凭空制造了一个差异**——首次迁移验证因此报出 16 个"分歧状态"，其中 **12 个是带内的**。

移除舍入后，C1 在**所有带内状态上与生产逐位相同**，并有网格测试用 `Object.is` 在 mastery 0→1（步长 0.005）× 难度 1–5 × 两种结果上断言（>1000 个检查点）。修复后同一次运行的分歧数从 16 降到 **4**，且**带内为 0**。

> 这条正是"逐位相同"这一迁移安全基石的守卫；若不修，报告会声称 C1 改变了它其实从未触及的行为。

---

## 10. 回归（Phase 7）

| 项 | 结果 |
|---|---|
| `npm test` | **2270 / 2268 / 0 fail / 2 skip**，exit 0 |
| `npm run build:api` | exit 0 |
| `npm run build:web` | exit 0 |
| `test:integration:score-loop` | exit 0 |
| `test:integration:effectiveness` | exit 0 |
| `test:integration:event-key` | exit 0 |
| `test:integration:content-import` | exit 0 |
| `test:integration:review-shadow-cohort` | exit 0 |
| `test:integration:mastery-semantics-migration`（本轮新增） | exit 0 |

既有失败分类**未变、未伪造**：`integration-postgres.mjs:1254` 为 PRE-EXISTING；`exam-aligned` 与 `seed:knowledge-map` 为 FIXTURE/DATA GAP；4 套连跑瞬时 `0xC0000409` 为 ENVIRONMENT（单独复跑 exit 0）。**NEW REGRESSION = 0。**

---

## 11. 未做（遵守边界）

未启用生产开关（`MASTERY_SEMANTICS` 未设置、验证结束后也未保留）· 未部署 · 未改所有者决定 · 未实施 C2 · 未实施"复习结果回流掌握度" · 未改 F4 Ability Mapping · 未弱化任何既有断言 · 未重写任何历史 mastery 记录。
