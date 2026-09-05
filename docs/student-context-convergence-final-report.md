# StudentContext Consumer Convergence Report

日期：2026-09-05
Milestone：StudentContext Consumer Convergence
分支：`feature/v3-product-refactor`（未 commit / 未 push）
环境：`ENV-005 = BLOCKED`；`D4-B4 = BLOCKED BY ENVIRONMENT`（保持，未重试）

---

## 1. Executive Summary

Milestone 完成。StudentContext v1 现在是全部 student-facing **summary** 消费者的唯一 canonical read boundary：

- **StudentHome**：五类摘要（mastery/practice/review/plan/momentum）经 `studentHomeContextAdapter` 消费 StudentContext。
- **Contextual Coach**：base student state（goal/mastery/weakPoints/currentTasks）经 Step 1 base bridge 消费 StudentContext；四场景 focus loader 保持领域独立。
- **ReportWorkspace**：summary 域经 `reportWorkspaceContextAdapter` 消费 StudentContext；分析/明细域保留 report 投影。

Phase 1 全仓审计（`docs/student-context-consumer-audit.md`）确认：**无剩余 Category B 消费者**。Knowledge / Assessment / 错题 / 趋势 / 专属面板经证据审计分类为 Category C（领域专属，Rule 3 边界内），不迁移、不扩契约。Phase 3 契约审查产出 1 项已记录提案（mastery 桶语义 P-1），行为未变。

## 2. Final Architecture

```
                Source Facts (Prisma SoT + projections)
                            |
                            ↓
              StudentContextQueryService.getContext(userId, asOf)
                            |
                    buildStudentContext()
                            |
                   StudentContext v1 (read-only, derived)
                            |
        +-------------------+---------------------+
        |                   |                     |
  StudentHome         Contextual Coach         ReportWorkspace
  (summary UI)        (base student state      (summary domain)
        |              + scenario focus)             |
        ↓                    ↓                       ↓
 studentHomeContextAdapter  Coach prompt (unchanged) reportWorkspaceContextAdapter
        |                                            |
  DashboardViewModel                           ReportSummaryPanel
```

依赖方向（强制）：`Consumer → StudentContextQueryService → StudentContext`；禁止 `StudentContextQueryService → 具体消费者`、禁止 `StudentContext → AI write path`（审计确认均未出现）。

## 3. Migrated Consumers

| Consumer | Status | Migration Result |
|---|---|---|
| StudentHome | **PASS**（既有门禁） | 五类摘要 canonical = StudentContext；loading/error/insufficient_data 保留 legacy 兜底；任务对象与启动回调保留 legacy |
| Contextual Coach（backend base） | **PASS**（本轮 Step 1 bridge） | goal/masterySummary/weakPoints/currentTasks 来自 StudentContext；dailyHours/task.mode 保留 legacy 缺口读；四场景 focus loader 逐字段不变；6 参位置构造兼容（@Optional 末位追加） |
| ReportWorkspace（summary） | **PASS**（既有门禁） | mastery/practice/review(due,overdue)/plan/momentum 摘要接管；WeaknessReport/StageReport/Assessment/Trend/Profile/Resources/trial/reminders/sprint 保留 |
| Knowledge Workspace | **C — 不迁移** | 浏览 UI 需全量节点掌握度（含 untouched/review）；StudentContext 为 summary 契约；读取走 mastery SoT 自身端点（`/knowledge/mastery`），键为 knowledgeNodeId |
| Assessment Workspace | **C — 不迁移** | exam analytics 属 Assessment 领域（Rule 3）；StudentContext 无考试执行/结果明细（assessment facts 在装配层被有意丢弃） |
| Mistake / Trend / Profile / trial / reminders / sprint / 推荐面板 | **C — 不迁移** | 领域 detail 与专属数据，多次 Gate 一致判定 |

## 4. StudentContext Usage Map

```
StudentHome          → StudentContext → studentHomeContextAdapter → DashboardViewModel
ReportWorkspace      → StudentContext → reportWorkspaceContextAdapter → ReportSummaryPanel（summary 优先，legacy 兜底）
ContextualCoach Asm  → StudentContext → toStudentContextBase() → Coach prompt 的 student/currentTasks 块
（其余消费者 → 各自领域投影/端点，不经过 StudentContext —— 见审计文档 §3）
```

前端统一加载入口：`useStudentContextData`（单 hook，无 mock 替换，错误显式暴露）。

## 5. Remaining Legacy Consumers

全部为**required legacy**（详见 `docs/student-context-consumer-audit.md` §6）：

- `/dashboard/overview` + `dashboard-projection.service`：复杂明细（questions/report/learningCalendar/写路径上下文）供给。未来清理候选。
- `/mastery-map`、`/student-state`、`/reports/overview`：legacy 契约端点，前端兜底与 detail 仍依赖。
- 四个 specialized student-state-*-query services（reminder/sprint/trial/calendar）：投影层本体，是 StudentContext 的同类 facts 来源而非消费者。
- Coach 的 StudentState 缺口读：仅 dailyHours/task.mode 两字段（契约红线禁止扩入），远期收敛候选。
- `study.service` / `beta-metrics` / `task-progress-consistency-checker` / `score-center`：legacy 服务宿主、admin 指标、内部一致性工具、Mastery SoT 服务——非 student summary 消费者。
- 未发现可证明安全的死代码，无删除动作。

## 6. Identity Audit — PASS

- `knowledgeNodeId`：三个 A 类消费者的 mastery 表达全部使用 Node ID；`weakPoints`（Point 行为）不进 mastery 摘要。
- `knowledgePointId`：Point 行为弱点/错题/题目关联保持 Point 空间；legacy StageReport Node-as-Point 字段零消费。
- `actionId` ≠ `studyTaskId`：契约分离、Coach currentTasks 键集不含 actionId（测试钉死）、adapter 不合并。
- `getKnowledgeDetail` 参数命名风险（名 Point 实 Node 查询）：行为未改，代码注释 + 设计文档已记录。

## 7. Freshness Audit — PASS

- `StudentContext.asOf`：query boundary 单点解析，selector 无 `Date.now()`（测试钉死）。
- 前端 adapter 无 `new Date()`（测试钉死）；asOf/window/sampleSize 原样透传。
- Coach：base asOf 由 query boundary 默认策略解析（assembler 不自行造时，测试钉死）；focus loader 保留实时行为（设计内差异，已文档化）；`assembledAt` 为响应元数据。
- 未实现 global snapshot/cache（按 milestone 约束）。

## 8. Contract Changes

**无。** 契约、selector、QueryService、Prisma、Migration 零修改。

Phase 3 产出 1 项**提案**（未实施）：`docs/student-context-contract-hardening-proposal.md` P-1 —— `improvingPoints` 桶过滤与 `deriveMasteryStatus` 状态词表不一致，review 阶段节点（0.45–0.75）不在任何桶中，导致 `reviewCount` 恒 0、`averageMastery` 遗漏 review 节点（影响三个已迁移消费者的语义精度，基线即存在）。提案给出 P-1a/P-1b/P-1c 三选项，**需人工批准后单独批次实施**（行为变更 + 消费者回归）。

## 9. Tests

| 测试文件 | 结果 |
|---|---|
| `student-context-contract.test.js` | 3/3 PASS |
| `student-context-selector.test.js` | 5/5 PASS |
| `student-context-query.test.js` | 3/3 PASS |
| `student-context-controller-wiring.test.js` | 1/1 PASS |
| `student-home-context-adapter.test.js` | 11/11 PASS |
| `contextual-coach-context.test.js` | 5/5 PASS |
| `contextual-coach-base-context.test.js`（本轮新增，RED→GREEN） | 9/9 PASS |
| `contextual-coach-integration.test.js`（dist 基） | 6/6 PASS |
| `report-workspace-context-adapter.test.js` | 14/14 PASS |

合计 57/57，0 失败。工作树中另有 5 个预先存在的失败测试（`student-action-ui` 等，源于其他在途工作线），与本 milestone 无关且基线验证过。

## 10. Build

```
build:api  PASS（exit 0，shared tsc + nest build）
build:web  PASS（exit 0，tsc + vite build，25.26s）
```

全量 `npm test` 与 PostgreSQL integration 维持 `ENV-005` 阻塞状态，未绕过、未伪造。

## 11. Remaining Risks

1. **P-1 mastery 桶语义**（见 §8）：三个消费者的 review 计数/均值存在已知偏差，待人工决策。
2. **并行兼容读**：`/overview/canonical`、`/dashboard/overview`、`/mastery-map` 仍与 `/student-context` 并行（迁移期兜底成本），summary 数值以 StudentContext 为准。
3. **Coach base/focus 时间基点差异**：base asOf 与 focus loader 实时时间未对齐（设计内，已文档化）。
4. **pendingWrongQuestionCount 无统一 canonical 消费**：canonical 在 `/overview/canonical.reviewStatus`，StudentHome 摘要置 null、Report 读 canonical —— 合法但不统一，远期清理候选。

## 12. Future Cleanup Plan

1. P-1 提案人工决策 → 契约 §10 修订 + 三消费者回归批次。
2. ReportWorkspace 分析域向 StudentContext 的进一步收敛评估（在 P-1 解决后更有意义）。
3. `/dashboard/overview` 明细拆分：detail 与 summary 分离后降级/裁剪 legacy summary 字段。
4. Coach dailyHours/task.mode 收敛（若契约未来向后兼容增量覆盖）。
5. request-level asOf/cache 设计（跨模块同快照需求出现时）。
6. Knowledge 全量 mastery 与 StudentContext 的关系再评估（若浏览产品需要 summary 级指标）。

---

**Milestone Status: COMPLETE**（summary 域收敛完成、无 Category B 剩余、身份/freshness/insufficient_data 审计 PASS、测试与构建 PASS、零契约/写路径/禁止域修改）
