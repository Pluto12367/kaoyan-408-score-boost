# V14 记忆卡功能设计任务书（Design Gate）

> **Status**: DESIGN GATE — 待 Owner 批准，未实施任何代码/Schema/数据变更。
> **任务来源**: `docs/current-sprint.md` 顶部「待启动任务②记忆卡（已批方向，尚无任务书）」。
> **Owner 已批约束（原文摘录）**:
> 1. 复用共享 `estimateRetention`（与 forgetting-risk/priority 同源，**零第二套记忆公式**）；
> 2. 结论/公式卡按考点挂接 + 三档自评（记住/模糊/没记住）映射到受控复习语义；
> 3. 「距考越近排得越密」复用 `deriveExamDateState`；
> 4. 卡片复习若写掌握度必须走 canonical 唯一写方（contract §20），不建第二套 SoT；
> 5. **先写任务书过 Design Gate 再实施**（涉及新表/表结构属 Owner Gate）。
> **任务类别**: `SCHEMA`（新表）→ 按开发协议 `CODE-BEHAVIOR` 全链 + §3 Owner Gate + §12。
> **本文档是唯一新文件；零代码 / 零迁移 / 零数据 / 零 Git 写变更。**

---

## 1. 只读审计事实（全部一手，`path:line` 为证）

### 1.1 复用面：共享记忆公式与复习语义（已存在，直接复用）

| 事实 | 证据 |
|---|---|
| `estimateRetention(lastReviewedAt, stabilityDays, now) = exp(−elapsed/stability)`，clamp01，是唯一共享保持率公式 | `packages/shared/src/score-center/mastery.ts:48-56` |
| `updateStabilityAfterReview(prevStability, quality)` × `STABILITY_MULTIPLIERS[0..5]`（0→×0.6、2→×1.0、4→×1.7）是唯一稳定性更新公式 | `packages/shared/src/score-center/mastery.ts:6-13, 58-64` |
| `ReviewQuality = 0..5` 受控类型 | `packages/shared/src/score-center/types.ts:19` |
| 上述公式已被 forgetting-risk / prescription(reviewEmphasis) / priority 同源消费（"与 forgetting-risk/priority 同源"约束成立） | `apps/api/src/study/training-prescription.service.ts`、`apps/api/src/study/forgetting-risk.service.ts`、`apps/api/src/score-center/service.ts:17-22`（imports） |
| canonical 掌握度唯一写方 = `ScoreCenterService.applyAttempts / applyReview / applyReviewObservation`；**`applyReview` 只写 stabilityDays/retention/nextReviewAt，绝不写 mastery** | `apps/api/src/score-center/service.ts:126-211`；契约权威文本 `docs/development/score-mastery-evidence-semantics.md` §3 |
| 复习证据→掌握度的唯一投影 = `applyReviewObservation`，且必须持 evidence receipt 才可调用 | `apps/api/src/score-center/service.ts:213-296` |
| 自报类证据 = weak，**结构性不可影响掌握度**（`canInfluenceMastery=false`）；但自报可改排程（先例：`review.reason_reported` = changesSchedule:true / changesMastery:false） | `docs/development/score-mastery-evidence-semantics.md` §2.2、§3；`packages/shared/src/score-center/review-semantics.ts:57-121` |

### 1.2 考试日期体系（已存在，直接复用）

| 事实 | 证据 |
|---|---|
| `deriveExamDateState`：`User.examDate` 是唯一事实，`remainingDays` 由它派生；unset/非法/过去日期全部诚实报 unset，绝不猜日期 | `packages/shared/src/guidance/exam-date.ts:57-125` |
| `User.examDate` 唯一写方 = `ScoreAnchorService.setExamDate`（写入时同源校验并同步派生 remainingDays） | `apps/api/src/score-anchor/score-anchor.service.ts:95-135` |
| **决策面 canonical 解析器** = `resolveDaysToExam`（S1-I0 INV-3/4）：`examDate(FACT) > remainingDays(LEGACY CACHE) > unknown(null)`；unknown 需要数值时必须走 `applyExamTimelineFallback`（96 天，basis=`fallback_constant`，显式带标签） | `packages/shared/src/score-center/exam-timeline.ts:1-106` |
| 该模块存在的目的就是消灭五处各自为政的日期推导（含 web 端曾自造 `${year}-12-20`） | `packages/shared/src/score-center/exam-timeline.ts:6-15` |

### 1.3 边界面：FSRS 与既有调度域

| 事实 | 证据 |
|---|---|
| FSRS-4.5 在仓库中是**未训练的纯预测器/影子**（LE/V11-M4，"explicitly UNTRAINED"，权重为 fsrs4anki 默认值），非权威；其生产接线 = P1-7 Owner Gate，本任务**不接线** | `packages/shared/src/score-center/fsrs-scheduler.ts:1-31` |
| 错题复习调度（`ReviewSchedule` 1/3/7/14 阶梯 + `stability:"learning"` 字符串档）是**题目域**，与卡片域分离；记忆卡不触碰该表 | `prisma/schema.prisma:779-802` |
| 卡片调度需要的状态字段（stabilityDays/lastReviewedAt/nextReviewAt）在节点掌握度行上存在，但那是 canonical 能力行的字段，卡片自评无权写入（见 §3.2 决策） | `prisma/schema.prisma:1038-1064` |

### 1.4 挂接面与呈现面

| 事实 | 证据 |
|---|---|
| `KnowledgeNode` 全量目录（当前 1296 节点）是卡片挂接点；节点有 `subject/nodeType/name/importance/difficulty/isActive` | `prisma/schema.prisma:889-918` |
| 学生导航定义于 `RoleNavigation.tsx`（V14-R4 已扩到 7 项：新增「真题」先例，含 `mobile-nav-ui.test.js` 有理由断言更新先例） | `apps/web/src/layouts/RoleNavigation.tsx`；`docs/current-sprint.md` 2026-09-25 R4-A 条目 |
| 前端 feature 目录先例：`apps/web/src/features/real-exam/`（R4-A 模式：Workspace+纯视图助手+API 层+token CSS） | `apps/web/src/features/` 目录清单 |
| 演示模式显式拒绝先例（内容不可伪造，不设 mock 回退）：真题套卷 | `docs/current-sprint.md` R4-B 条目；`apps/web/src/App.tsx:1339-1344` |

### 1.5 空白面（全仓 grep 证实）

- 记忆卡/flashcard 相关代码：`apps/`、`packages/`、`prisma/` 全目录 grep **零命中** → 全新功能，无隐藏既有实现。
- 内容库中无任何卡片内容资产 → v1 上线时卡片目录为空，**必须诚实空态**，内容生产属内容轨（D5）。

### 1.6 记录在案的文档差异（AGENTS §1）

1. **"contract §20" 出处**：current-sprint 引用的 Long-Horizon Contract v2.0 在仓库中**无对应文件**（`docs/**` 全文检索仅 current-sprint 自引用）。canonical 唯一写方规则的权威文本实为 `docs/development/score-mastery-evidence-semantics.md` §3（Mastery: single writer）。本任务书以该权威文本为准，语义与 "contract §20" 引用一致。
2. **"复用 deriveExamDateState" 的落点**：审计显示考试日期体系有两个互补入口——写侧/展示侧 `deriveExamDateState`（exam-date.ts）与**决策侧** `resolveDaysToExam`（exam-timeline.ts，S1-I0 立的唯一解析器，专为消灭多处各自推导而生）。卡片调度属于决策面，本设计**建议密度档位消费 `resolveDaysToExam`、展示文案消费 `deriveExamDateState` 的 daysLabel**，两者同属一套考试日期体系、零第二套日期推导。此为对 Owner 约束的落地解释，请 Owner 在 Design Gate 一并确认（D6b）。

---

## 2. 产品问题回答（开发协议 §2 必答）

**这移动四把 score lever 中的哪一把？如何测量？**

如实回答：**不移动任何已验证的提分杠杆**（Gate V9 不存在，`Verified Score Gain` 未实现，RULE-11）。记忆卡服务的是提分闭环第 6 环「识别薄弱 → 推荐复习」的**低摩擦执行面**：遗忘风险与处方面（forgetting-risk / training-prescription）目前只能通过整题重做消费，卡片提供更轻的日常保持动作。可测量与不可测量如实分列：

| 输出 | 量级类别 | 说明 |
|---|---|---|
| 卡片自评事件（记住/模糊/没记住） | `OBSERVED` | 学生直接报告的动作事实 |
| 卡片保持率（retention）/下次复习时间 | `DERIVED` | 由 OBSERVED 事件经共享公式确定性推导 |
| 「记忆卡提升了考试成绩/掌握度」 | `UNAVAILABLE` | v1 无任何成绩样本，禁止声明（RULE-11） |

---

## 3. 方案总设计（v1 范围）

### 3.1 数据流

```
内容轨（独立任务，D5）:  CSV 草稿 → import-memory-cards.mjs（硬校验 + --reviewed-by + --rights-confirmed）
                         → MemoryCard 目录表（RULE-10 留痕；未过审内容不入库）

学生面（本任务）:       GET /memory-cards/session
                         → 读 MemoryCard(目录) × UserMemoryCardState(卡片状态) × User.examDate
                         → resolveDaysToExam → 密度档位 → due 队列（estimateRetention 排序）
        学生翻卡自评 → POST /memory-cards/:id/review {rating, idempotencyKey}
                         → updateStabilityAfterReview（共享乘数表）× 密度因子 → nextReviewAt
                         → 写 UserMemoryCardState + MemoryCardReviewLog（append-only）
                         → 【明确不写】UserKnowledgeMastery / ReviewSchedule / Evidence Ledger
```

### 3.2 核心语义决策：卡片自评**不写掌握度**（契约强制推导，非可选项）

- 三档自评是 `self_reported` 证据（weak），契约 §2.2 规定 weak 证据 `canInfluenceMastery=false`——**结构性禁入能力层**。
- 因此 `applyReviewObservation`（复习→mastery 唯一投影）对卡片自评**不可调用**；Owner 约束「若写掌握度必须走 canonical 唯一写方」在 v1 的落地 = **不写掌握度，条件分支不存在**。
- 卡片状态（stabilityDays/nextReviewAt）是**卡片域排程事实**，与 `UserKnowledgeMastery`（能力层）、`ReviewSchedule`（题目域）三者完全分离；卡片面展示节点掌握度时只**只读**引用 canonical 行。
- 该隔离必须被 E2E 负断言钉死：卡片复习后 `UserKnowledgeMastery` 行逐字段不变（见 §8）。
- 若未来要把「卡片复测=真实重做挂接题」升级为强证据回流通路，属 Score/Mastery 语义变更 → 独立 Owner Gate，不在本任务。

### 3.3 三档自评 → 受控复习语义映射（零新记忆公式）

复用 `updateStabilityAfterReview` + `STABILITY_MULTIPLIERS`，映射（D3，建议如下）：

| 自评 | 语义 | ReviewQuality | 稳定性乘数 |
|---|---|---|---|
| 记住 | 成功回忆 | `4` | ×1.7 |
| 模糊 | 提示后想起/不确定 | `2` | ×1.0（不增长，按当前间隔重现） |
| 没记住 | 想不起 | `0` | ×0.6（收缩，尽快重现） |

- 与既有 `applyReview` 的 redoCorrect→4/2 映射同族（`apps/api/src/score-center/service.ts:191-194`），自评比真实重做证据弱，**不取 5/3 档**，乘数表零改动。
- 首次自评的基线稳定性 = `previousStabilityDays ?? 1`（与共享函数现行为一致，`mastery.ts:62`）。

### 3.4 考试日期感知密度（复用考试日期体系，档位为产品策略）

- 输入：`User.examDate + User.remainingDays` → `resolveDaysToExamTracked`（exam-timeline.ts，canonical 决策解析器，drift 可观测）。
- unknown 时走 `applyExamTimelineFallback`（96 天，basis=`fallback_constant` 显式带标签；UI 标注「考试日期未设置，按默认节奏」）——与计划引擎同款兜底，96 天落在 D2 档位表的 >60 宽松档 ×1.25，默认节奏轻微放宽而非压缩（D6）。
- 密度因子 = **产品排程策略，不是记忆公式**，UI/文档明示（开源检查证实无现成先例，见 §9）。建议档位（D2）：

| 距考天数 | 因子 | 档位 |
|---|---|---|
| > 60 | ×1.25 | 远期放宽 |
| 31–60 | ×1.0 | 标准 |
| 8–30 | ×0.7 | 加密 |
| ≤ 7 | ×0.5 | 冲刺加密 |

- 下次复习间隔 = `clamp(stabilityDays × 因子, 0.5, 365)` 天；`nextReviewAt = reviewedAt + 间隔`。
- 密度因子**只影响排程间隔，不参与 retention 数值**——retention 恒由 `estimateRetention(lastReviewedAt, stabilityDays, now)` 计算，公式面零第二实现。

### 3.5 Due 队列与诚实空态

- 到期卡：`nextReviewAt ≤ now`，按卡片 retention 升序（`estimateRetention`，输入缺失→该卡 retention=null 排后，**绝不当 0.5**——沿用 forgetting-risk 的 unknown≠risk 先例，`docs/current-sprint.md` PHASE 7 条目）。
- 新卡引入：无状态卡片按节点顺序补入队列，每次会话上限（建议 10，D2）；当日新卡配额耗尽显式提示。
- 会话卡量上限（建议 20，D2）。
- 卡片目录为空 / 无到期卡：诚实空态文案，不伪造内容（目录空态 + 「内容生产轨」说明，与轨迹屏空态同风格）。

### 3.6 明确不做（Non-goals）

- ❌ 不写 `UserKnowledgeMastery`（§3.2）、不触碰 `applyReview`/`applyReviewObservation`/`ReviewSchedule`/Evidence Ledger。
- ❌ 不接 FSRS 生产调度（P1-7 Owner Gate 独立；本任务与其零交集）。
- ❌ 不做卡片编辑器 / 学生自建卡 / AI 自动生成入库（RULE-10：无任何 generated→verified 自动升级路径）。
- ❌ 不做卡片间交叉复习、图片/公式渲染特化（公式以纯文本 v1，KaTeX 属后续）。
- ❌ 不产生任何「提分」声明或卡片域的掌握度标签（卡片 retention ≠ 掌握度 ≠ 分数）。
- ❌ 不动 recommendation priority、MASTERY_SEMANTICS、既有判题链。

---

## 4. 数据契约（Migration 提案 → Owner Gate D1）

### 4.1 新增表（additive，零回填，零既有表改动）

```prisma
model MemoryCard {                 // 全局内容目录（非用户维度）
  id              String   @id @default(cuid())
  knowledgeNodeId String
  cardType        String            // 受控字典: CONCLUSION | FORMULA
  front           String            // 提示面（问题/线索）
  back            String            // 结论/公式面
  reviewedBy      String?           // RULE-10: 具名评审人
  rightsConfirmed Boolean?          // RULE-10: 版权确认
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  knowledgeNode   KnowledgeNode @relation(fields: [knowledgeNodeId], references: [id])
  userStates      UserMemoryCardState[]
  @@index([knowledgeNodeId, isActive])
}

model UserMemoryCardState {        // 每用户每卡的排程状态（卡片域事实）
  id             String    @id @default(cuid())
  userId         String
  cardId         String
  stabilityDays  Float?
  lastReviewedAt DateTime?
  nextReviewAt   DateTime?
  lastRating     Int?              // 受控子集: 0 | 2 | 4
  reviewCount    Int       @default(0)
  version        Int       @default(0)   // OCC，与掌握度行同款并发防护
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  card           MemoryCard @relation(fields: [cardId], references: [id], onDelete: Cascade)
  reviews        MemoryCardReviewLog[]
  @@unique([userId, cardId])
  @@index([userId, nextReviewAt])
}

model MemoryCardReviewLog {        // append-only 自评事实（对齐 ReviewSchedule+ReviewAttempt 先例）
  id             String   @id @default(cuid())
  userId         String
  cardId         String
  rating         Int              // 0 | 2 | 4
  stabilityBefore Float?
  stabilityAfter  Float?
  densityFactor   Float           // 留痕：本次排程使用的距考因子与 basis
  densityBasis    String          // exam_date | legacy_remaining_days | fallback_constant
  reviewedAt     DateTime @default(now())
  idempotencyKey String   @unique
  user           UserMemoryCardState @relation(fields: [userId, cardId], references: [??])
}
```

> 实施细节以 TDD 阶段定稿为准：ReviewLog 若不便建立复合外键，则改为独立 `userId+cardId` 列 + 索引（对齐 `ReviewAttempt.scheduleId` 模式）。

### 4.2 迁移影响与回滚

- **变更类型**：1 条 additive migration（编号 41，`2026xxxx_memory_card_foundation`，以实施时 migrations 目录为准）；`CREATE TYPE` 无需（cardType/rating 用应用层受控字典，与 QuestionSubtype 的 ENUM 方案相比零类型锁定）。新增 3 表 + 2 索引；53→56 models。
- **数据迁移方案**：无回填（全新空表）。
- **对现有数据影响**：零（不改任何既有表/列；`User`/`KnowledgeNode` 仅增关系字段）。
- **回滚方式**：`DROP TABLE` ×3（全空表，零数据损失）。
- **测试库验证**：migrate deploy 实测 + `migrate diff` 零漂移（迁移 40 同款门禁）。

---

## 5. API 契约（挂 `StudyController`，复用 resolveUserId/assertAccess 隔离）

```
GET  /memory-cards/session?limit=
  → 200 {
      examContext: { basis, daysToExam|null, isFallback, label },   // label 来自 deriveExamDateState 语义
      queue: [{ cardId, knowledgeNodeId, nodeName, subject, cardType,
                front, back, phase: 'new'|'due',
                retention: number|null,        // null=未复习，绝不 0.5
                lastRating: 0|2|4|null }],
      summary: { dueCount, newCount, returned, newCardCap, sessionCap }
    }
  → 401 未认证；503 显式 store_unavailable（无 DATABASE_URL，不设内存 mock）

POST /memory-cards/:cardId/review   { rating: 'remembered'|'fuzzy'|'forgot', idempotencyKey }
  → 200 { state: { stabilityDays, nextReviewAt, retention, reviewCount },
          applied: { quality: 0|2|4, stabilityBefore, stabilityAfter, densityFactor, densityBasis } }
  → 400 rating 非法 / 缺 idempotencyKey；401；404 卡片不存在或 isActive=false
  → 幂等：同 idempotencyKey 重放返回首次结果，零重复写入
```

- **数据来源声明（AGENTS §4）**：全部持久化于 PostgreSQL；无 RuntimeState、无内存模式；静态演示模式与无 API 场景**显式拒绝**（对齐真题套卷先例，卡片内容不可伪造）。
- 卡片内容 `front/back` 随会话下发（自评制无防剧透需求，与练习题剥离逻辑无关）。

## 6. 前端契约（R4-A 模式）

- 导航：学生导航 7→8 新增「记忆卡」section（`apps/web/src/layouts/RoleNavigation.tsx` studentItems + bottomNav + compatSections），`mobile-nav-ui.test.js` 断言随批准变更更新（RULE-02 有理由更新，单列申报，D4）。
- `apps/web/src/features/memory-card/`：`MemoryCardWorkspace`（队列→翻卡→三档自评按钮→下一张）+ 纯视图助手 `memoryCardView.ts`（零本地阈值、空态诚实、retention null 显式「未复习」）+ API 层 `api/endpoints/memoryCard.ts` + token 化 CSS。
- 考试日期上下文行：「距考试 N 天 · 冲刺加密节奏」/「考试日期未设置 · 按默认节奏」。
- 失败显式展示、无演示回退；复习完成摘要（今日已评 X 张、到期清零与否）。

## 7. 测试策略（RED 先行）

1. **shared 契约测试**（`test/memory-card-*.test.js`，node:test）：三档映射乘数逐位断言（4→1.7×、2→1.0×、0→0.6×、基线 ??1）；密度档位边界（60/30/7 天切点、fallback basis 标签、null≠0）；retention 诚实 null（从未复习→null 不是 0.5）；due 排序确定性（retention asc null 最后→cardId）；队列上限。RED 证据=模块缺失导入失败。
2. **真实 PG+HTTP E2E**（`scripts/integration-memory-card.mjs` → `test:integration:memory-card`）：
   - 导入脚本 seed 节点+卡片 → 学生注册 → session 拉新卡 → 三档自评各一次（断言 stability/nextReviewAt 精确值=乘数×因子数学）→ **负断言：`UserKnowledgeMastery` 与 `ReviewSchedule` 零写入（逐字段比对）** → 幂等重放零重复 → rating 非法 400 → 401 → 未授权学生隔离 → examDate 未设置走 fallback_constant 标签。
   - 拒绝路径 ≥1 条（RULE-03）：400/401/404/幂等四类全覆盖。
3. **前端源码契约测试**（对齐 R4 模式）：导航项、演示模式显式拒绝、无 mock、空态文案。
4. **回归**：`npm test` 对基线 **2664/2662/0/2 exit 0**（`docs/current-sprint.md` 2026-09-26）；build 三端 exit 0；迁移 migrate deploy + `migrate diff` 零漂移；真实浏览器目检（§16）。

## 8. 里程碑分解（PROXY 估时，供排期参考）

| 里程碑 | 内容 | 估时 |
|---|---|---|
| M1 | shared 纯模块 `score-center/memory-card.ts` + 契约测试（RED→GREEN） | 3–4h |
| M2 | 迁移 41 + repository + service + 三端点 + 导入脚本（含 --dry-run）+ E2E harness | 6–8h |
| M3 | 前端 section + 会话 UI + 源码契约测试 | 5–7h |
| M4 | 全门禁（V1/V2/V4/V5）+ 真实浏览器目检 + 账本更新 | 2–3h |

M2/M3 可跨会话拆分；每里程碑独立可验证。**内容生产（卡片目录填充）不在任何里程碑内**——D5 批准后另立内容轨任务（同真题内容生产模式）。

## 9. 开源参考检查（AGENTS 必做，CODE/SCHEMA 类）

检索与结论（2026-09-26）：

1. **Anki / SM-2**（repetrax.com、smartrecallai.com 对 SM-2 的公开梳理）：质量分 0–5、低分缩短间隔、按卡独立状态——本仓 `ReviewQuality 0..5` + `STABILITY_MULTIPLIERS` 已是该模式；三档自评→质量分子集映射是标准做法（Anki 四键同样映射到 0–5 子集）。
2. **FSRS / open-spaced-repetition 家族**（py/ts/rs-fsrs）：现代调度标准，17–21 参数需真实数据训练——本仓已 vendored 未训练 shadow（fsrs-scheduler.ts）；在 PRIMARY 校准样本=0 的现状下引入 FSRS 生产调度既违反 Owner 约束也无数据支撑。
3. **考试日期压缩调度**：未找到开源先例（最接近的是 Anki filtered-deck 硬塞/FSRS desired-retention 手调）→ **密度档位必须标注为产品排程策略**（非记忆科学结论），参数走 Owner 决策并留痕于 ReviewLog。
4. 实现方式：不复制任何源码；复用本仓共享纯函数（`updateStabilityAfterReview`/`estimateRetention`）+ 本仓先例（ReviewSchedule+ReviewAttempt 双表、OCC version、导入 --reviewed-by 链、R4 前端分区模式）。

## 10. Owner Decision 清单（STOP 项，未批准不实施）

| # | 决策 | 建议 |
|---|---|---|
| **D1** | **Schema Gate**：新增 3 表（§4.1），additive 零回填，回滚=DROP×3 | 按提案批准 |
| D2 | 密度档位数值（1.25/1.0/0.7/0.5 @ 60/30/7）、新卡配额 10、会话上限 20 | 按建议值，Owner 可改 |
| D3 | 三档自评→质量映射：记住→4 / 模糊→2 / 没记住→0 | 按建议（乘数 1.7/1.0/0.6） |
| D4 | 前端入口=学生导航 7→8 新 section「记忆卡」（含 mobile-nav 断言有理由更新） | 新 section（对齐 R4 先例）；备选：折入既有复习区 |
| D5 | 内容链：`scripts/import-memory-cards.mjs` 硬校验 + `--reviewed-by --rights-confirmed` 留痕（RULE-10）；v1 目录空态诚实，内容生产另立任务 | 按提案 |
| D6 | examDate 未设置：走 `applyExamTimelineFallback`（96 天，带标签）+ UI 标注（96 天落在 D2 档位表的 >60 宽松档 ×1.25，即默认节奏轻微放宽而非压缩） | 按建议 |
| D6b | Owner 约束「复用 deriveExamDateState」的落地解释：决策面消费 `resolveDaysToExam`（同体系零第二推导），展示面用 `deriveExamDateState` 语义 | 请确认（§1.6-2） |

**按契约推导、非 Owner 决策项（Owner 可否决）**：卡片自评不写掌握度（§3.2，self_reported 弱证据结构性禁入）。

---

## 11. 风险登记

| 风险 | 缓解 |
|---|---|
| 卡片状态被误读为能力/掌握度 | 命名（UserMemoryCardState）+ UI 文案 + E2E 负断言三层钉死 |
| 密度档位被当成「记忆科学」 | 文档/UI 标注产品策略；ReviewLog 留痕 factor+basis |
| 目录空态被误判为功能缺陷 | 空态文案显式说明内容轨独立（同轨迹屏先例） |
| 与 P1-7 FSRS Gate 将来撞车 | 卡片调度只依赖 stabilityDays+estimateRetention；FSRS 若日后接线，替换点收敛在 shared 纯模块一层 |
| 未定价/未审内容混入 | 导入器强制 reviewedBy+rightsConfirmed，缺任一整批拒绝（RULE-10） |

---

**STOP. Awaiting implementation approval.**（D1–D6b 批准后按 M1→M4 实施；任一决策修改请批注，任务书将按批准版本冻结为实施规范。）
