# StudentContext Production Readiness Audit

审计日期：2026-09-05
Milestone：Phase SC-4 — StudentContext Production Readiness Audit
性质：**只读审计 + 设计（Design Gate）** — 不实施任何变更；按指示在 Design Gate 后停止
前置：SC-1 Foundation PASS / SC-2 Consumer Convergence PASS / SC-3 Contract Hardening P-1 PASS
环境：`ENV-005 = BLOCKED`；`D4-B4 = BLOCKED BY ENVIRONMENT`（保持，未重试）

核心结论：StudentContext 的**架构与语义层已达到生产级**（61/61 回归、身份/时序/insufficient_data 语义钉死、消费边界无绕过）；**性能层存在 1 个高优先与 4 个中优先风险**（全部为"无界读取/无界序列化"，无 N+1），缓存为可选优化而非必需。本审计产出 5 个带编号的后续提案（SC-P2-001…005），均**不实施**。

---

## 1. Current Architecture

```text
Prisma SoT (User / UserKnowledgeMastery / PracticeRecord / WrongQuestionReview
            / ReviewSchedule / StudyPlan+StudyTask / LearningSession / RecommendationAction)
        ↓ 6 个并行投影/快照读取 + 1 个 supplemental 批量读取（Promise.all）
StudentContextQueryService.getContext(userId, asOf)
        ↓  纯函数
buildStudentContext(sourceFacts)  → StudentContext v1
        ↓
GET /student-context（RoleGuard 认证读）
        ↓
StudentHome / ReportWorkspace / Contextual Coach（3 个 summary 消费者，各有纯展示 adapter）
```

只读、派生、可重建、无写副作用；`asOf` 单点解析；selector 无时钟（测试钉死）。

## 2. Query Flow（每次 `GET /student-context` 的实际成本）

| 步骤 | 查询 | 边界 |
|---|---|---|
| 1 | StudentStateProjection.getSnapshot | 单用户（内部多查询） |
| 2 | PracticeProjection.getFacts | `practiceRecord.findMany`（userId + submittedAt ≤ asOf）**无 take → 全历史**；`learningSession.findMany` 同样无 take |
| 3 | WrongQuestionProjection.getSnapshot | 单用户聚合 |
| 4 | TodayPlanProjection.getSnapshot | 单用户计划/任务 |
| 5 | AssessmentProjection.getFacts | 单用户测评事实（selector 中 `void assessment` — 已装配但未入契约，见 §8 改进项） |
| 6 | Supplemental（仅 DB 模式） | `user.findUnique`；`userKnowledgeMastery.findMany`（用户全部行，规模 ≤ 目录节点数，可接受）；`learningSession.findMany` **无 take**；`studyTaskCompletion.findMany` **无 take（全历史）**；`recommendationAction.findMany` **无 take（全历史）**；`knowledgePoint.findMany` **无 where 无 take = 整表加载** |
| 7 | buildStudentContext（纯 CPU） | 实测 ~18ms（§4 fixture） |

查询形态健康：全部批量 `select` 投影、无 N+1、顶层 `Promise.all` 并行。

## 3. Consumer Map

| 消费者 | 通道 | 绕过检查 |
|---|---|---|
| StudentHome（前端） | `useStudentContextData` → `GET /student-context` → `studentHomeContextAdapter` | ✅ 唯一 fetch 点，无旁路 |
| ReportWorkspace summary（前端） | 同上 hook → `reportWorkspaceContextAdapter` | ✅ |
| Contextual Coach（后端） | 构造器注入 `StudentContextQueryService.getContext` | ✅ |
| 其他所有前端读取 | 各自领域端点（convergence audit §3 分类 C） | ✅ 无偷偷消费 student state |

后端 grep 确认 `StudentContextQueryService` 的消费者仅 Coach assembler；前端 grep 确认 `/student-context` 仅存在于 `endpoints/dashboard.ts` + `useStudentContextData.ts`。**无边界绕过。**

## 4. Payload Analysis（实测）

合成典型"成熟学生"负载（200 mastery 节点 / 1000 练习记录（一年）/ 100 sessions / 6 today tasks / 50 actions × 3 evidenceRefs），经真实 selector 构建并序列化：

| 指标 | 值 | 评估 |
|---|---|---|
| **总 payload** | **~80 KB** | 偏大但可接受（单用户 summary；GZip 后预计 ~10-15 KB） |
| selector CPU | ~18 ms | 健康 |
| `mastery` 段 | **48.6 KB（60%）** | 四桶全量行（weak 66 + improving 67 + mastered 67 + Point weakPoints 50）。随目录规模线性、有上界（≤ 目录节点数 + 练习过的 Point 数） |
| `recommendationEvidence` 段 | **28.2 KB（35%）** | 200 行；**随 action 历史无界增长**（每 action 至少 1 行 + 每条 evidenceRef 1 行） |
| `momentum` / `plan` / 其余 | < 4 KB | 健康（recentSessions 已被 selector 截断为 10） |
| practice/review 段 | 小（聚合 + 有界列表） | 健康 |

结论：**payload 不是当下的阻断问题，但 `recommendationEvidence` 是唯一的无界序列化向量**；`mastery` 在目录扩张（如 408 全目录 ~1500 节点）时会增长到 ~300 KB 级，需要关注。

## 5. Performance Risks（按优先级）

| # | 风险 | 证据 | 级别 |
|---|---|---|---|
| R1 | **`knowledgePoint.findMany` 整表加载**：每次 /student-context 请求把全目录 Point 表读入内存 Map（仅用于 Point→subject/chapter/title 标注） | `student-context.query.service.ts:134`（无 where/take） | **高**（随目录增长线性恶化所有请求；目录为静态权威树，天然可进程级缓存） |
| R2 | **practiceRecord 全历史读取**：无界行数 × 9 列，随用户练习量线性增长；仅部分用于 last7d 聚合 + Point 弱点聚合 | `practice-projection.service.ts:16`（无 take） | 中 |
| R3 | **recommendationAction / studyTaskCompletion / learningSession 全历史读取**：无 take；action 行数同时驱动 evidence 无界序列化（§4） | `student-context.query.service.ts:131-133` | 中 |
| R4 | **payload 无分页/裁剪策略**：`mastery` 四桶全量行、`recommendationEvidence` 全量行随时间无界（§4） | 实测 | 中 |
| R5 | **normalizeEvidence 对缺 `source` 行崩溃**：`(left.source).localeCompare` 在 evidence 行缺 source 时抛 TypeError。现网由 `buildRecommendationEvidence` 兜底（恒写 source），但 evidenceRefs 是 JSON 列，防御深度为零 | `student-context.selector.ts:413` | 低（管线内受保护，防御性缺口） |

无 N+1、无逐行 await、无循环内查询。

## 6. Cache Opportunities（只设计，不实施）

前提事实：`buildStudentContext(sourceFacts, userId, asOf)` 是**确定性纯函数**（测试钉死），输出可由 (userId, asOf) + source facts 完全重建。

| 方案 | 适用层 | 评估 | 建议 |
|---|---|---|---|
| **进程级静态目录缓存**（R1 专用） | `knowledgePoint` 标注 Map | 目录为静态权威树，变更频率极低；一次加载进程内复用即可消除 R1，且不涉及用户数据、无失效难题 | **SC-P2 提案中最优先**（若实施，仅需 query service 内模块级 lazy Map + 显式失效点说明） |
| 请求级 asOf 固定（request-scoped memoization） | 同一请求内多次 getContext | 当前只有 Coach 单次调用，无收益 | 暂不需要 |
| **短 TTL 快照缓存**（如 30-60s，per-user） | QueryService 之上 | 收益 = 削峰重复读；代价 = freshness 语义复杂化（需区分 asOf 与 cachedAt，契约 freshness 已预留 sources.observedAt 但语义要扩展） | **暂缓**——当前 3 个消费者调用频率低（页面加载/刷新），80 KB/18ms 不构成瓶颈；等真实流量数据说话 |
| Redis / StudentContextSnapshot 持久化表 | 跨实例共享 | 引入新基础设施/Schema，违反本阶段所有限制；且与"StudentContext 是派生可重建视图、不是第二事实源"的架构原则有张力（持久化快照需要明确的生命周期管理） | **不采用**（除非出现多实例 + 高频读的实际瓶颈；届时优先 Redis 只读缓存而非新表，避免第二状态模型） |

**结论：不建议现在引入任何缓存基础设施。** 唯一值得近期做的是 R1 的进程级目录缓存（改动小、零语义风险）；其余等生产流量证据。

## 7. Contract Version Strategy（只设计，不升级）

现状：`version: 'student-context-v1'`，单一字符串版本，无字段级版本。

设计原则（与已验证的演进实践一致——P-1 证明了"保持形状、修正语义"路径可行）：

1. **v1 内 = 只做向后兼容增量**：
   - 允许：新增可选字段、新增只读桶/节、注释澄清语义、值域修正（如 P-1）。
   - 禁止：重命名/删除字段、改变现有字段语义、收紧类型。
   - 每次增量：契约文档修订记录 + 消费者回归批次（61 项测试即回归基线）。
2. **v2 触发条件**（出现任一才升版）：字段重命名/删除、现有字段语义破坏性变化、窗口/趋势语义重构。
3. **v2 迁移策略**：
   - 双写期：`version: 'student-context-v2'` 与 v1 并行（同一响应携带 `v1Mirror` 或短期双端点），adapter 按 version 分支；
   - 契约测试双版本 parity（deepEqual 允许差异清单显式化）；
   - 消费者逐个切换 → 下线 v1；
   - 前端 `api/types.ts` mirror 与后端契约同步批次提交。
4. **字段级演进优于大版本**：优先用新增可选字段 + 弃用注释（`@deprecated`）承载演进，避免过早 v2。

## 8. Recommended Future Improvements（全部不实施，供决策）

| 编号 | 内容 | 来源 | 优先级 |
|---|---|---|---|
| **SC-P2-001** | **Mastery fallback semantic alignment**：`toMasteryNodeFact` 回退路径硬编码 `status:'weak'`，DB 无 mastery 行时可能把节点错误归类 | P-1 实施报告 Risk 2（用户已登记该编号） | 中 |
| SC-P2-002 | **knowledgePoint 标注缓存**：进程级 lazy Map 消除整表加载（§6） | 本审计 R1 | 高 |
| SC-P2-003 | **读取上界化**：sessions/taskCompletions/actions/practiceRecords 增加 take 或时间窗下推（配合契约窗口语义） | 本审计 R2/R3 | 中 |
| SC-P2-004 | **evidence 裁剪策略**：recommendationEvidence 设行数上限/时间窗（payload 无界向量）；同时 normalizeEvidence 对缺 source 行容错（R5） | 本审计 R4/R5 | 中 |
| SC-P2-005 | **assessment facts 处置决策**：QueryService 装配 assessment facts 后 `void assessment` 丢弃——要么正式纳入契约（增量），要么停止装配以省一次查询 | Convergence Gate + 本审计 §2 | 低 |

## 9. Restrictions Compliance

本审计未修改任何生产代码；无 Prisma/Migration/写路径/Recommendation/AI/RAG/ENV-005/D4-B4 触碰。审计用的两个临时脚本（P-1 复核与 payload 测量）已即用即删。所有结论均有代码行号或实测数据支撑。

## 10. Gate Decision

**DESIGN GATE COMPLETE — PRODUCTION READINESS: CONDITIONALLY READY**

- **语义/架构/消费边界：READY**（61/61 回归、身份与时序钉死、无边界绕过、P-1 修复闭环）。
- **性能/规模：CONDITIONAL**——当前用户规模与调用频率下可上生产；随目录与用户历史增长，R1（整表加载）是第一个必须解决的点，R3/R4（无界历史）次之。
- 缓存：设计完成，**不实施**（唯一例外候选 = SC-P2-002 进程级目录缓存，改动小、待批准）。
- 版本策略：设计完成，**不升级**。

**按指示在此停止。** 后续任一 SC-P2 提案的实施需单独批准与独立批次。
