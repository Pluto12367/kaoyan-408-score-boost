# M3 Review → Mastery Production Integration — Final Report

- 日期：2026-09-11
- 基线：`HEAD d4e4348`（工作区先核实，未信任历史报告）
- 最终判定（原）：**`M3 REVIEW → MASTERY PRODUCTION INTEGRATION = READY`**
  > ⚠️ **已被 §16 追加章节修正**：本报告的"本地验证 READY"成立，但**该结论在真实生产数据上不成立**——线上部署后的真实 smoke 抓到一处缺陷，导致复习→掌握度对 100% 的题目不生效。请看 **§16 Post-deployment addendum（V12.1）**。
- `MASTERY_SEMANTICS`：**未设置**，C1 **保持 OFF**
- 门禁（原）：`npm test` **2321 / 2319 通过 / 0 失败 / 2 跳过**（exit 0）；`build:api` exit 0；`build:web` exit 0；**7 个集成套件全部 exit 0**
- 门禁（V12.1 修复后）：`npm test` **2324 / 2322 通过 / 0 失败 / 2 跳过**；`build:api` / `build:web` exit 0；7 个集成套件全部 exit 0

---

## 1. Event fidelity — before / after

**问题（实测）**：证据台账的事件键 `LEARNING_EVIDENCE:{userId}:{action}:{sourceId}:{scope}` 以**日期**为 `scope`，因此同一天对同一题的多次复习共用一条回执。修复前实测 **31 次复习 → 15 条回执**（16 次观测在台账上不可分辨）。

**修复**：键增加可选的**逐次事件身份** `occurrence`（review 路径 = `ReviewAttempt.id`）：

```
LEARNING_EVIDENCE:{userId}:{action}:{sourceId}:{scope}[:occurrence]
```

设计保证：
- **deterministic / idempotent**：同一 attempt → 同一键；同键重复写入幂等（`UserEvent @@unique([userId, eventKey])`）；
- **唯一**：不同 attempt → 不同键；
- **backward-compatible**：旧键是新键的**严格前缀**（省略 occurrence 时逐字节复现旧键），因此历史行形状不变、新键不可能与旧键混淆；
- 空白 occurrence 视为**缺失**而非一个空段；
- **历史数据零改动**：不删除、不重写、不伪造 occurrence（缺 occurrence 一律读作"按天聚合"，不是"待补数据"）。

**修复后实测**：
| 场景 | 修复前 | 修复后 |
|---|---|---|
| 15 学生 × 6 节点队列（31 次复习） | 31 attempts → **15 receipts** | 31 attempts → **31 occurrence-keyed receipts（1:1）**、31 次掌握度投影、0 条按天遗留 |
| 生产 E2E（10 次新复习） | — | 10 attempts → **10 occurrence receipts**，attempt→receipt 映射 10:10 |
| 生产 E2E（1 条故意植入的迁移前 attempt） | — | 1 条按天回执**原样保留**、未被追溯应用 |

投影按**身份优先**三级匹配：`occurrence`（1:1）→ `recordedAt` 精确 → 同题同日（历史回执，可一对多并计数）。一个"与事件同秒的历史回执"抢匹配的场景有专门测试钉死。

---

## 2. ReviewAttempt metadata（M3-B）

**迁移** `20260912000000_review_attempt_schedule_metadata`（35 → 36），**纯增量可空、无默认值**：

| 列 | 类型 | 回答的问题 |
|---|---|---|
| `isReview` | `BOOLEAN?` | 是否是 review（调用方声明，逐字记录） |
| `scheduleDriven` | `BOOLEAN?` | 是否由已到期排程驱动（两次**已存储时间戳**的比较，非分数） |
| `source` | `TEXT?` | 来源（封闭集：`recommendation_action` / `wrong_question`） |
| `dueAt` | `TIMESTAMP(3)?` | **本次复习回答的到期时间**（本次写入前 schedule 的 `nextReviewAt`） |

"对应哪个 schedule" 由既有 `scheduleId` 外键回答，未新增冗余列。

- **historical truth unavailable → nullable**：迁移前行为 NULL，且 E2E 断言**全部为 NULL 且不被回填**；所有读取方必须把 NULL 读作"未知"而非 `false`。
- **禁止项核对**：`mastery` / `priority` / `opportunity` / `recommendationScore` **一律未写入** `ReviewAttempt`（列不存在）。
- `dueAt`/`scheduleDriven` 在**同一事务内、在 upsert 覆盖 `nextReviewAt` 之前**读取，因此描述的是本次真正回答的到期时间，不会被并发复习污染。
- E2E 实测：10/10 新 attempt 携带 `isReview=true`、`source='wrong_question'`、`scheduleDriven` 布尔值；10/10 有 `dueAt`；`scheduleDriven=true` **0/10**——这是事实而非缺陷：夹具建的排程都是新的，没有一次是在回答"已到期"的排程。

---

## 3. Review → Mastery 实现

生产链路现在是字面意义上的：

```
Review Observation → Evidence Receipt → Evidence Projection → Unified Semantics → Authoritative Mastery
```

**新增**
- `ScoreCenterService.applyReviewObservation(...)` —— **复习观测进入能力估计的唯一写点**，仍位于唯一掌握度所有者类内（"所有掌握度写入都经 `ScoreCenterService` → `saveMasteryWithOptimisticRetry`" 这一不变量继续成立）。
- `ReviewMasteryIntegrationService` —— 编排链路，**不导入任何写仓库**、不直接写掌握度；资格判定复用 V12-M1 已发布的 `classifyLearningAction`，投影复用**与影子完全相同的** `projectReviewEvidence`（生产与影子因此不可能分裂成两套口径）。

**未改动**
- `applyReview` **语义 0 行改动**：仍只写 `retention`(硬编码 1)/`stabilityDays`/`lastReviewedAt`/`nextReviewAt`，**仍然不赋值掌握度**、**仍未接入 `applyMasterySemantics`**（结构断言锁定，且切片边界改为下一个方法并加正向对照——上一轮同类断言曾因新方法插入而误判）。
- **禁止路径不存在**：`applyReview → 直接 UPDATE mastery` 没有实现；掌握度只能经"先有回执"的投影到达。

**顺序（写入事务内）**：`saveReview`（返回 attemptId + dueAt + scheduleDriven）→ **证据回执**（含耐久性检查）→ 投影 → 恰好一次认领 → 掌握度 → 错题复习记录/`resolveWrongQuestion` → `applyReview`（仅排程/稳定性）。

**一处必须明示的语义变化**：V12-M1 曾刻意把复习证据写在**事务提交之后**（"证据绝不可描述一个已回滚的 attempt"）。本轮为满足"回执必须先于掌握度决策"与原子性，把它移入事务内——这对 V12-M1 想要的性质是**更强**的保证（回执与 attempt 同生共死，掌握度也不会在回执回滚后残留）。该断言已从"文本位置"改写为"事务边界 + 原子性"，并新增一条证据层不得含掌握度写原语的断言。

---

## 4. Idempotency

| 机制 | 实现 | 证据 |
|---|---|---|
| 同一 review event 重复投递 | 既有 `(scheduleId, idempotencyKey)` 唯一约束 + 提前短路 | E2E Case D：`attempts=1 receipts=1 markers=1`，**masteryVersion 2→2**，掌握度未二次变化 |
| 掌握度"恰好一次" | `REVIEW_MASTERY_APPLIED` 认领事件的**唯一 eventKey**（`...:{userId}:{evidenceEventKey}`） | 每个回执恰好 1 条认领；认领键重复写入被唯一约束拒绝 |
| 回执幂等 | `UserEvent @@unique([userId, eventKey])` | 同键重放返回既有行 |
| **并发**竞态 | 约束保证"不会 double apply"；PostgreSQL 中事务内 P2002 会毒化事务，因此事务内改为**先读后写**，真竞态**让事务整体中止**（也是安全结果：全部回滚） | 中止后由 `replayDuplicateReview` 把败者变成幂等响应（返回已持久化的 attempt） |
| 无 idempotencyKey 的重复 | **无法去重**：与"学生真的又复习了一次"不可区分 | 明确记录为设计边界，不伪造去重 |

Markers 计数（生产 E2E）= 10，回执数 = 10，attempt 数 = 10；队列 31/31/31。

---

## 5. Real PostgreSQL E2E（六案例）

脚本 `scripts/integration-review-mastery-production.mjs`（`npm run test:integration:review-mastery-production`，端口 3250）。复习**不经脚本直写**，全部经 `POST /wrong-questions/:questionId/reason`（`isReview: true`）由**生产代码**写 attempt/metadata/回执/认领/掌握度。下游用 `GET /coach/shadow-decision-chain` **在复习前后各读一次**，因此下表是真实的端到端差值。

| 案例 | 节点掌握度 | Δmastery | Δpriority | Δopportunity | Δrank |
|---|---|---|---|---|---|
| **A** review correct | 0.6000 → **0.6513** | **+0.0513** | −2 | −0.015 | +1 |
| **B** review incorrect | 0.6000 → **0.5442** | **−0.0558** | +2 | +0.015 | 0 |
| **C** repeated (对/错/对) | 0.4000 → **0.5298** | **+0.1298** | −4 | −0.037 | +2 |
| **D** duplicate HTTP（幂等键重放） | 0.5000 → 0.5693 → **0.5693** | +0.0693 后 **0.0000** | −3 → 0 | −0.02 → 0 | +1 → 0 |
| **E1** 同节点·学生1 correct | 0.5000 → **0.5693** | **+0.0693** | −3 | −0.02 | +1 |
| **E2** 同节点·学生2 incorrect | 0.5000 → **0.4622** | **−0.0378** | +2 | +0.01 | −1 |
| **F** 同学生·节点1 correct | 0.5000 → **0.5693** | +0.0693 | −3 | −0.02 | +1 |
| **F** 同学生·节点2 incorrect | 0.5000 → **0.4622** | −0.0378 | +2 | +0.01 | −1 |

每项都验证了：**evidence**（1:1 occurrence 回执）、**mastery**（数值等于共享模型在 C1 OFF 下的结果）、**student isolation**、**idempotency**（D）、**attribution**（认领载荷携带 `evidenceEventKey` + 逐节点 before/after + `semantics`）。

**决定性的交叉验证**：E1/E2 共享同一个 `KnowledgeNode`，两个学生的掌握度按**各自方向独立**变化；F 的两个节点在一次会话中按**各自观测**独立变化——没有跨节点/跨学生串扰。

---

## 6. Mastery impact distribution

- 数值**全部等于** `updateMasteryAfterAttempt`（= legacy 生产 EMA，C1 OFF）在同一观测序列上的结果——由 E2E 与队列脚本各自独立断言。
- 队列（15 学生 × 31 次复习）实测：**每个被复习节点的权威掌握度都发生了移动**（脚本断言 15/15 行变化）。
- 方向自洽：全对复习 → 掌握度↑；全错 → ↓；对/错/对 → 净 +0.1298。
- **既有 EMA 瞬态如实披露**（非本次接线引入）：队列 31 步中 **3 次"答对反而下降"**（高分区，正确目标值 0.775–0.885 低于当前估计）、**2 次"答错反而上升"**（低分区，错误目标值 0.19–0.38 高于当前估计），每一次都由独立重算证明来自 `updateMasteryAfterAttempt` 自身。

---

## 7. Priority impact

Δpriority 与掌握度变化**符号相反且自洽**：掌握度↑ → 薄弱度下降 → 优先级**下降**（A −2、C −4、E1/F −3），掌握度↓ → 优先级**上升**（B +2、E2/F +2）。量级 |Δpriority| ≤ 4（案例层面），队列最大 |Δpriority| 7。**未出现任何"变化但无解释"的优先级位移**。

---

## 8. Opportunity impact

Δopportunity 与优先级同向：A −0.015、B +0.015、C −0.037、E2/F +0.01。机会模型读的是同一份权威掌握度，因此**先有掌握度变化，再有分值变化**，归因链完整。

---

## 9. Recommendation impact

Δrank 只在真实发生位移时报非零：A **+1**（复习答对后掌握度上升、优先级下降，被一个上下文节点反超）、C **+2**、E1/F **+1**、E2 **−1**、B **0**。队列脚本另测 **16 处事件级排名变化**。排名变化全部出现在"掌握度跨过邻近节点"的场景，符合预期。

---

## 10. Student isolation

- E1 与 E2 共享同一节点、同一道题的**不同**题目实例，各自掌握度按各自动向变化；F 的两节点互不影响（E2E 断言）。
- 回执/认领事件均以 `userId` 为唯一约束的一部分，`eventKey` 内含 `userId` → **结构上不可能跨学生**。
- 认领键 `...:{userId}:{evidenceEventKey}`：单元测试断言同一回执对不同学生产生不同键。

---

## 11. C1 state

| 检查 | 证据 |
|---|---|
| `MASTERY_SEMANTICS` 未设置 | 运行环境未设置；测试断言 `.env*` 中无该键、`parseMasterySemantics(undefined) === 'legacy'` |
| 启动日志 | E2E 捕获 `Mastery semantics: legacy — legacy（现行生产语义）（未设置，使用默认）`，并断言输出含 `Mastery semantics: legacy` |
| 每次投影记录语义 | 10/10 认领事件 `payload.semantics === 'legacy'`（E2E 断言全部） |
| 两个变量相互独立 | review evidence 参与能力估计**不依赖** C1；投影调用经 `resolveMasterySemantics()` 取当前语义，C1 打开只会改变转移函数、不会改变"复习是否参与" |
| 开关单点 | 结构测试：全 API 仅有 `score-center/service.ts` 一个模块使用 `applyMasterySemantics`，且**只有两个具名入口**（`applySingleAttempt`、`applyReviewObservation`）可应用；每个入口都必须 `resolveMasterySemantics`（不能硬编码语义）。新入口必须是有意评审的决策——该列表即审计记录 |

---

## 12. Existing debt classification（未变，未包装成绿色）

| 类别 | 项 | 状态 |
|---|---|---|
| PRE-EXISTING | `integration-postgres.mjs:1254`（"明日计划含 ≥3 目标任务"断言） | 仍在册，非本轮回归（V12 期间 `scripts/`/`prisma/` 除本轮迁移外零改动） |
| FIXTURE/DATA GAP | `exam-aligned`（缺题库种子）、`seed:knowledge-map`（缺 legacy 考点） | 仍在册 |
| ENVIRONMENT | 无 SSH 凭据 → 生产部署 | 仍未部署，未伪造 |
| INTENTIONAL | 影子端点 `authoritative: false` | 保持 |
| 已消解 | `retention` 硬编码 1 / 台账按天去重 / `ReviewAttempt` 无排程属性 | 前两项中，**台账与排程属性本轮已解决**；`retention` 仍属生产语义，**未触碰**（不在批准范围） |

---

## 13. NEW REGRESSION

**0。**

- `npm test`：2319 通过 / **0 失败**（基线 2305 → **+16 新增测试**）
- `build:api` / `build:web`：exit 0
- 7 个集成套件（score-loop、review-shadow-cohort、effectiveness、event-key、content-import、review-mastery-cohort、review-mastery-production）：**全部 exit 0**

**4 处既有断言被有意更新**（每处都改为更强，无一弱化，均附理由）：

| 测试 | 原来断言 | 现在断言 | 为什么不是弱化 |
|---|---|---|---|
| `v12-evidence-boundary` "recall evidence is recorded after the review transaction commits" | 证据调用出现在 commit 标记**之后**（文本位置） | 证据/投影在**同一事务闭包内**并接收 `tx`；旧的事后调用必须**消失**（否则会产生重复回执）；另断言证据层仍无掌握度写原语 | 把"不可能描述已回滚的 attempt"从文本位置升级为**事务原子性**；同一属性、更强保证 |
| `mastery-semantics-switch` "exactly one production call site" | `applyMasterySemantics(` 恰好出现 **1** 次 | 恰好 **2** 个具名入口且逐一必须 `resolveMasterySemantics`；全 API 仅 **1 个模块**可用 | 掌握度确实新增了第二个入口（review）；把"一个位置"换成"一个所有者 + 已知入口白名单"，新增静默入口会失败 |
| `review-mastery-shadow-service` "applyReview leaves mastery untouched" | 切片到 `getKnowledgeDetail` | 切片到**下一个方法** `applyReviewObservation`，并在测试内剥离注释 | 修复切片边界（新方法合法地写掌握度）与"匹配到注释散文"的缺陷；被断言的性质完全不变 |
| `integration-review-mastery-cohort` "the review path must not change authoritative mastery" | 复习**不得**改变权威掌握度（这是被影子化的缺口） | 复习**必须**改变，且数值等于共享模型；并新增 31:31 回执保真度断言 | 缺口已闭合，旧断言陈述的是已不成立的事实；反转后同时覆盖"生效"与"数值正确"，覆盖面更大 |

---

## 14. Rollback plan

**代码与迁移分离**（迁移已单独成文：`prisma/migrations/20260912000000_review_attempt_schedule_metadata/migration.sql`）。

**步骤（任一顺序都可，两步都做才回到旧行为）**

1. **代码回滚**：revert 本轮提交。旧代码**不引用**新列，因此可先回滚代码、后回滚迁移；在迁移仍存在时旧代码行为与部署前**逐字节相同**（新列为纯增量可空，旧查询不查询它们）。
2. **迁移回滚**：
   ```sql
   ALTER TABLE "ReviewAttempt"
     DROP COLUMN "isReview",
     DROP COLUMN "scheduleDriven",
     DROP COLUMN "source",
     DROP COLUMN "dueAt";
   ```
   然后从 `_prisma_migrations` 删除该迁移记录（或 `prisma migrate resolve --rolled-back`）。

**回滚会丢什么 / 不会丢什么**（E2E 已实测的边界）
- **会丢**：新 attempt 的排程元数据（`isReview`/`scheduleDriven`/`source`/`dueAt`）——仅此。
- **不会丢**：`ReviewAttempt`、`ReviewSchedule`、`UserKnowledgeMastery`、证据台账、`REVIEW_MASTERY_APPLIED` 认领事件**全部保留**；已写入的掌握度**不回退**（这是历史事实，不应被回滚改写——与"不重写历史掌握度"一致）。
- **旧数据语义明确**：迁移前行为 NULL（未知），回滚后仍是 NULL——**没有 backfill，因此没有"回滚后语义反转"的数据**。
- **历史证据仍可读**：按天回执的形状未变（新键是旧键的严格前缀），投影的两个降级匹配通道保留；回滚后旧代码读取同一批行不报错。

**生产安全（E2E 实测）**
- 既有用户**无需迁移即可工作**：新列全部可空无默认，旧行读取路径不涉及它们；迁移是纯 `ADD COLUMN`。
- 历史复习记录**可读**：迁移前 attempt 与按天回执被断言仍可读、且其 metadata 全为 NULL。
- 历史掌握度**不被重写**：一个只有历史复习观测、无新复习的节点，其掌握度与 `version` 被断言**完全未变**，且该按天回执**未被追溯投影**（认领数为 0）。
- 重复事件不重复应用：见 §4。

**部署仍为 PENDING**（无 SSH 凭据），**未部署、未伪造**。

---

## 15. 技术栈与面向面试的技术亮点

**技术栈**：TypeScript / Node 24 · NestJS 10（CJS）· Prisma 5 + PostgreSQL 16 · React 18 + Vite 5 · npm workspaces · `node:test` · 自研 HMAC JWT · 自研节流器。

**亮点**

1. **把"证据边界"从文档变成可执行约束**：生产链路上真实调用与影子**同一个纯函数** `projectReviewEvidence`——生产与影子不可能分裂成两套口径。没有回执就没有能力推断，且**耐久性被检查**（写到台账失败 → 不改变能力估计，因为那样没有任何后续审计能解释这次变化）。
2. **恰好一次是结构性的，不是希望**：用唯一 `eventKey` 的认领事件把"该证据已投影"变成**可重放的持久事实**；并发竞态由唯一约束裁决，且**利用 PostgreSQL "事务内语句失败即毒化事务"这一特性**让败者整体回滚——把数据库语义当成并发正确性的一部分，而不是绕开它。
3. **事件身份的分层设计**：`occurrence` 作为**追加段**而非替换，使旧键成为新键的严格前缀——向后兼容是**构造性**的，不需要迁移历史数据、不需要双写、不需要兼容分支。
4. **可审计的语义开关**：掌握度有两个入口但**只有一个所有者模块**，且每个入口都必须解析开关；测试用"具名入口白名单"锁死，新增静默入口会立刻失败。C1 与 review 接线被证明是**两个独立变量**。
5. **把回归当成规格变更来管理**：4 处断言更新逐条给出理由并**加强**，其中一条（"复习不得改变权威掌握度"）直接**反转**——因为它是缺口本身的度量，缺口关闭后它陈述的是假事实。**没有为了让汇总变绿而弱化任何断言。**
6. **诚实的可观测性**：`null` 与 `false` 严格区分（历史 NULL = 未知，不读作 false；无回执 = 不推断，不读作 0）；每个拒绝路径都有具名 reason 与中文依据；`scheduleDriven=true 0/10` 这类"不好看但真实"的数字照实输出。
7. **测试分层**：16 项新单测锁边界与幂等退化路径，10 项案例（A–F）在真实 HTTP + PostgreSQL 上锁端到端行为，另有 15×6 队列在规模上锁 31:31 保真度与 6 表零权威写入。

---

## 附：本轮必须交给所有者的新决策项（不自行调参）

1. **影子基线同日照成**：M3-C 后，生产会在复习当天写入一条**已包含本次复习**的 `UserMasterySnapshot`，而影子按"不晚于首次观测日"选取基线 → 基线与观测同日，影子会**多走一步**，使队列表里的 `delta` 变成**基线假象**而非语义分歧（脚本已就地标注）。**是否让影子基线排除同日快照**属测量口径的产品判断，本轮**未改**（未获授权）。
2. **`retention` 仍硬编码为 1**：复习路径无条件宣称"刚复习完保持率完美"，与 `estimateRetention` 的指数衰减不同口径。本轮未触碰。
3. **无 idempotencyKey 的重复请求无法去重**：与"学生真的又复习了一次"在服务端不可区分；若要更强保证需客户端契约变更。
4. **既有 EMA 瞬态**：接线后"答对可能下降 / 答错可能上升"在生产路径上**已可观测**（队列 3 次 / 2 次）。这正是已批准的 C1 候选所要消除的行为，C1 仍按指令 **OFF**。

**最终判定**

```
M3 REVIEW → MASTERY
PRODUCTION INTEGRATION = READY
```

含义：Event fidelity PASS、ReviewAttempt metadata PASS、Review → Mastery PASS、Evidence attribution PASS、Idempotency PASS、Student isolation PASS、PostgreSQL E2E PASS、Priority propagation PASS、Opportunity propagation PASS、Recommendation propagation PASS、C1 remains OFF PASS、NEW REGRESSION 0。**未自行部署、未开启 C1、未修改 F4、未替所有者决定 rollout。**

---

## 16. Post-deployment addendum（V12.1）— 真实部署暴露的一处缺陷与修复

> 本节由**生产部署后的真实 smoke** 驱动。原始报告的 READY 判定建立在本地验证之上；本节记录本地验证**漏掉了什么**、为什么漏、以及修复与复验。**任何读者以后引用本报告时，必须连读本节。**

### 16.1 症状（生产实测，非推断）

部署到 `c7d9093` 后，用真实测试账号在生产库执行一次真实复习，六环 SQL 结果：

```
attempt_id                | isReview | source         | evidence_receipt                                    | id_matches_attempt | mastery_claim | semantics
cmtx12zmv00suy3tx6svz1a37 | t        | wrong_question | LEARNING_EVIDENCE:...:q-003:2026-09-11:cmtx12zmv... | t                  |               |
```

- ✅ `evidence_receipt` 非空、`id_matches_attempt = t` → **M3-A 事件身份在生产上生效**
- ❌ **`mastery_claim` 与 `semantics` 均为空** → `REVIEW_MASTERY_APPLIED` 未写入，**掌握度未变化**

`apps/api/src/study/review-mastery-integration.service.ts` 的日志给出确定性原因：

```
[StudyService] Review mastery projection no_knowledge_node (evidence LEARNING_EVIDENCE:...)
```

### 16.2 根因：两层问题叠加

**第 1 层（既有数据缺口，非本次部署引入）**

```
QuestionKnowledgeNodeTag  全库 0 行
tagged_questions          0 / 332
QuestionKnowledgePoint    332 题全部有 legacy 关联
KnowledgePointNodeMap     16 条，全部 PRIMARY
```

- 仓库内**没有任何 seed 脚本写 `QuestionKnowledgeNodeTag`**（全仓 grep 为空）→ 该表为空是**既有状况**。
- V11-M1 的 `GET /admin/data-quality` **本来就在观测它**（`untaggedSamples = question.findMany({ where: { knowledgeNodeTags: { none: {} } } })`，即 ledger 中记录的「B13 无节点标签题」）。
- 结论：**332 道题 100% 只能通过 legacy 桥接解析节点。**

**第 2 层（本报告的实现缺陷）**

`ReviewMasteryIntegrationService.resolvePrimaryNode` 只查询了 `QuestionKnowledgeNodeTag` 单层，而生产 `score-center/repository.ts:80-114` 的 `resolveKnowledgeNodesForQuestion` 有**三层**：

| 层 | 来源 | 生产 | 原实现 |
|---|---|---|---|
| 1 | `QuestionKnowledgeNodeTag`（可信 source） | ✅ | ✅ |
| 2 | `QuestionKnowledgeNodeTag`（bridge source） | ✅ | ✅ |
| 3 | `QuestionKnowledgePoint` → `KnowledgePointNodeMap` | ✅ | ❌ **缺失** |

→ 第 3 层缺失 ⇒ 解析返回 null ⇒ 投影层按设计**安全拒绝**（`no_knowledge_node`）⇒ 回执被记录但掌握度不动。

**影响的不对称性**：练习路径（`applyAttempts`）用三层函数，**一直正常工作**；只有复习路径不动。根因是**我在本应复用同一口径的地方引入了第二套口径**。

### 16.3 为什么本地"真实 PostgreSQL + HTTP" E2E 全绿却没抓到

```
integration-review-mastery-production.mjs:580  await prisma.questionKnowledgeNodeTag.create({...})
integration-review-mastery-production.mjs:819  await prisma.questionKnowledgeNodeTag.create({...})
integration-review-mastery-cohort.mjs          await prisma.questionKnowledgeNodeTag.create({...})
integration-review-shadow-cohort.mjs:236       await prisma.questionKnowledgeNodeTag.create({...})
（共 8 处）
```

**夹具手工创建了 `QuestionKnowledgeNodeTag`** → E2E 跑在**比生产更干净的数据形状**上。

> **教训（已入册）**：*真实数据库 + 真实 HTTP ≠ 真实数据形状*。夹具的理想化会整条掩盖解析路径。这是"本地全绿"最危险的一种成因。

### 16.4 第二个同根因缺陷（由夹具修正暴露）

把夹具改为桥接形状后，cohort 脚本立即失败：

```
FAILED: rm-user-...-low-d1-correct-r1: all questions must resolve to a node  (1 !== 0)
```

原因：**两个影子服务也只查 `QuestionKnowledgeNodeTag`**（4 处）：

| 位置 | 函数 |
|---|---|
| `review-mastery-integration.service.ts` | `resolvePrimaryNode`（缺陷 1，生产写路径） |
| `review-mastery-shadow.service.ts` | `getShadow` 的节点解析 |
| `review-semantics-shadow.service.ts` | `assembleReplayInputs` |
| `review-semantics-shadow.service.ts` | `getShadow` |

→ 在 332 题 0 标注的生产库上，**两个影子端点对 100% 的真实复习都是盲的**（`eventsWithoutNode = 1`）。

### 16.5 修复（V12.1，均复用同一实现）

| 改动 | 内容 |
|---|---|
| **新增** `apps/api/src/study/question-node-resolution.ts` | `resolvePrimaryNodeByQuestion`：快路径一次批量查 tag；仅对 tag 表答不出的题回退到生产的 `resolveKnowledgeNodesForQuestion`。PRIMARY 优先规则收敛于此 |
| `review-mastery-integration.service.ts` | `resolvePrimaryNode` → 复用该助手（**根因修复**） |
| `review-mastery-shadow.service.ts` | 2 处 → 复用该助手 |
| `review-semantics-shadow.service.ts` | 2 处 → 复用该助手 |
| 测试 | +3 条：**桥接题可投影** / 直接标注题仍恰好一次 / PRIMARY 优先；"无关联题"改为断言**走完两层才放弃** |
| E2E 夹具 | 两个脚本改为**桥接形状**（真实生产形状），Case B 保留 `direct` 作对照；清理补桥接表删除 |

**未改动**：`applyReview`、`ScoreCenter` 写入语义、C1 开关、Prisma schema、迁移、F4。

### 16.6 修复后复验

| 门禁 | 结果 |
|---|---|
| `npm test` | **2324 / 2322 通过 / 0 失败 / 2 跳过**（+3 新测试，零回归） |
| `build:api` / `build:web` | exit 0 |
| **7 个集成套件** | **全部 exit 0** |

**桥接形状（= 真实生产形状）下的关键证据**：

```
生产 E2E： 10 attempts → 10 markers；六案例 A–F 全部通过；Case D 幂等 attempts=1 / receipts=1 / markers=1
           Case B（直接标注）+ 其余（桥接）→ 两条路径端到端均验证

cohort：   authoritative mastery changed on 15/15 reviewed nodes   （修复前 0/15）
           31 attempts → 31 occurrence-keyed receipts (1:1)，31 mastery applications
           authoritative writes = 0 across 6 tables
           PASS — review→mastery shadow is computable, attributable, non-authoritative
```

### 16.7 判定修正

```
原判定：M3 REVIEW → MASTERY PRODUCTION INTEGRATION = READY
修正为：READY（代码层，V12.1 修复后）  /  线上部署 = NOT VERIFIED（待重新部署复验）
```

严格说明：
- 原报告的**每一项本地结论仍成立**（事件保真、幂等、隔离、C1 OFF、零权威写入）；缺陷在于**"POSTGRESQL E2E PASS" 被夹具形状放大了覆盖面**。
- 线上生产（`c7d9093`）处于**安全状态**：投影按设计拒绝（不写错数据），C1 OFF，基础设施与迁移全部正常。但 **M3 的功能目标未达成**。
- 修复需**重新部署**（字面 SHA）并重跑六环 smoke 复验 `mastery_claim` 非空，才能宣布线上 VERIFIED。

### 16.8 本轮新增的 Owner 决策项

5. **是否补齐 `QuestionKnowledgeNodeTag` 数据（B13 缺口）**：332 题可由 16 条桥接映射 100% 推导。**本轮明确不做**——理由：① 用数据写入去修代码缺陷是错的工具；② 只补数据无法覆盖未来新增题目（代码回退层仍是必需的，现已修复）；③ 16 条映射覆盖 332 题 ≈ 平均 1 条对应 20 题，把**粗粒度推导**写进**逐题精确表**等于让启发式冒充人工标注；④ 会**抹掉** `/admin/data-quality` 的 B13 指标（用插入让指标变绿）。若所有者要做，须作为**独立内容任务**：dry-run → 写入时标注 `source='bridge_derived'` 等 provenance 使 `direct` 与 `bridge` 可区分 → 精确记录插入集以便回滚 → 表述为"推导"而非"已核实"。
