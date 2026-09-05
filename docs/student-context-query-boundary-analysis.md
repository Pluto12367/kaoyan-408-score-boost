# StudentContext Query Boundary Analysis（SC-5 TASK 1 Phase A）

日期：2026-09-05
性质：TASK 1 审计文档（Phase A）；随后按 backward-compatible 判定直接 TDD 实施
依据：`docs/student-context-production-readiness-audit.md` R1/R2/R3

---

## 1. 当前查询清单（`GET /student-context` 单次请求）

| # | 查询（`student-context.query.service.ts`） | 现状 | 边界 |
|---|---|---|---|
| Q1 | `user.findUnique` | 单行 | ✅ |
| Q2 | `userKnowledgeMastery.findMany(userId)` | 用户全部 mastery 行 | ✅ 有界（≤ 目录节点数） |
| Q3 | `learningSession.findMany(userId, startedAt ≤ asOf, orderBy lastActiveAt desc)` | **无 take** | ❌ 无界 |
| Q4 | `studyTaskCompletion.findMany(userId, completedAt ≤ asOf)` | **无 take（全历史）** | ❌ 无界 |
| Q5 | `recommendationAction.findMany(userId)` | **无 take（全历史）** | ❌ 无界 |
| Q6 | `knowledgePoint.findMany()` | **无 where 无 take = 整表** | ❌ 无界（最严重） |
| Q7 | `practiceRecord.findMany(userId, submittedAt ≤ asOf)`（经 PracticeProjectionService） | **无 take（全历史）** | ⚠️ 见 §3.5 |

## 2. Consumer 需求分析（selector 实际消费什么）

| 查询 | Selector/装配层消费点 | 实际需要 |
|---|---|---|
| Q3 sessions | `buildMomentum` → 仅 `recentSessions`（按 lastActiveAt desc 排序后 `slice(0, 10)`）；streak/activityTrend 来自 activityDays | **最近 10 条** |
| Q4 taskCompletions | query service `buildActivityDays`（offset 6..0 共 7 天，按 completedDate 匹配） | **最近 7 天**（取 8 天窗口留日期边界余量） |
| Q5 actions | `buildRecommendationEvidence` → `normalizeEvidence` → `recommendationEvidence` 列表（无界序列化向量，SC-5 TASK 2 将在 selector 层 cap 60 行） | **最近 200 条 action**（DB 界）+ selector 行数 cap |
| Q6 knowledgePoint | 仅 `pointSubjects.get(record.knowledgePointId)` —— **只为 practice records 做 subject/chapter/title 标注** | **仅 practice records 中出现过的 distinct Point ID** |
| Q7 practiceRecords | `buildPractice`（totalCount / all-time Point weakness / latestSubmittedAt 为 all-time 语义）+ last7d/30d 趋势 | **all-time**（有界会改变 totalCount/weakness 语义 → 见 §3.5） |

## 3. 推荐策略与 backward-compatible 判定

### 3.1 Q6 knowledgePoint：整表 → `where: { id: { in: practicePointIds } }` ✅ 实施
标注集合由已加载的 practice records 决定；查询结果对任意用户的**输出完全不变**（原来整表中多余的行本来就不被使用）。需要把 supplemental 加载移到 practice facts 之后（pointIds 依赖），内部仍并行。无语义变化，纯读取收缩。**backward-compatible，直接实施。**

### 3.2 Q3 sessions：无界 → `take: 10` ✅ 实施
selector 本就只保留最近 10 条；freshness 的 `sessions.observedAt` 取最新一条（仍在窗口内）。**输出对任意用户不变。backward-compatible，直接实施。**

### 3.3 Q4 taskCompletions：全历史 → `completedAt ∈ [asOf-8d, asOf]` ✅ 实施
仅 7 天 activityDays 消费；8 天窗口覆盖 studyDateKey 的日期边界余量。超过 8 天的 completion 本来就不进入任何输出。**backward-compatible，直接实施。**

### 3.4 Q5 actions：全历史 → `orderBy createdAt desc, take: 200` ✅ 实施
DB 层界 200（内存界）；selector 层再 cap evidence 60 行（TASK 2）。count 语义从"全历史证据行数"收敛为"最近证据行数（≤60）"——契约注释同步澄清（provenance window 语义，TASK 5 文档化）。**读取收缩 backward-compatible；evidence 计数为展示性摘要，随 TASK 2 一并文档化。**

### 3.5 Q7 practiceRecords：保持 all-time ⚠️ 不加界（记录理由）
`totalCount`、all-time Point 弱点（`mastery.weakPoints` 的数据源）、`latestSubmittedAt` 均为 all-time 语义；加时间窗/take 会**改变契约语义**（非 backward-compatible）。风险本身有界：行数受用户练习行为约束（重度用户一年 ~1-3k 行 × 9 列，数 MB 内存，毫秒级）。**保留全读，登记为已知边界**；若未来出现真实性能证据，走"DB 侧聚合投影"方案（需独立设计），不属本任务。

## 4. 实施影响

- 修改文件：`apps/api/src/study/student-context.query.service.ts`（唯一）
- 依赖方向不变；Promise 并行结构微调（supplemental 移至第二批，内部仍并行）
- 输出不变性由 TDD 钉死：`test/student-context-query-boundary.test.js`（RED→GREEN）+ 既有 61 项回归
