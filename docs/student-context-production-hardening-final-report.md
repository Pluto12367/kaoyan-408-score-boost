# StudentContext Production Hardening Final Report

日期：2026-09-05
Milestone：Phase SC-5 — StudentContext Production Hardening（TASK 1–5 全部完成）
环境：`ENV-005 = BLOCKED`；`D4-B4 = BLOCKED BY ENVIRONMENT`（保持，未重试、未伪造）

---

## 1. Architecture Status

```text
Source Facts（Prisma SoT，读取全部有界/受控）
    ↓ 5 并行投影 + 1 批量 supplemental（点标注按需 IN 查询）
StudentContextQueryService.getContext(userId, asOf)
    ↓ buildStudentContext（纯函数；payload 有界；malformed evidence 防御归一）
StudentContext v1（shape 不变；weakPoints ≤20；evidence ≤60 provenance window）
    ↓
StudentHome / ReportWorkspace / Contextual Coach（零改动）
```

StudentContext 仍是唯一 canonical read boundary；未引入 Snapshot 表/Redis/新事实源；**契约 shape 零变化，三个消费者零改动**。

## 2. All Changed Files

| 文件 | 变更 | Task |
|---|---|---|
| `apps/api/src/study/student-context.query.service.ts` | 4 处读取上界化：knowledgePoint 改为按 practice 点集 `IN` 查询（不再整表）；sessions `take:10`；taskCompletions 8 天窗口；actions `orderBy desc, take:200`；supplemental 移至第二批（依赖 practice 点集），内部仍并行 | 1 |
| `apps/api/src/study/student-context.selector.ts` | `normalizeEvidence`：防御归一（丢非对象行、source 缺失→'unknown'、契约字段白名单）+ ≤60 行 provenance window；`buildPracticeWeaknesses` top-20 | 2, 3 |
| `test/student-context-query-boundary.test.js` | 新增 5 项（4 界 + 输出不变性） | 1 |
| `test/student-context-selector.test.js` | 新增 6 项（2 有界 + 3 鲁棒 + 1 小上下文不变性） | 2, 3 |
| `test/student-context-performance.test.js` | 新增性能基线套件（Small/Medium/Heavy + caps + 语义保持） | 4 |
| `docs/student-context-query-boundary-analysis.md` | TASK 1 Phase A 审计 | 1 |
| `docs/student-context-payload-optimization.md` | TASK 2 分析与实测 | 2 |
| `docs/student-context-contract-evolution.md` | TASK 5 契约演进规则 | 5 |
| `docs/current-sprint.md` | 状态更新 | — |

## 3. Query Optimization Results

| 查询 | Before | After | 输出影响 |
|---|---|---|---|
| knowledgePoint | **整表** findMany | `where id IN (practice 点集)` | 无（多余行本就未使用） |
| learningSession | 无界 | `take: 10`（selector 只用最近 10） | 无 |
| studyTaskCompletion | 全历史 | `completedAt ∈ [asOf-8d, asOf]`（仅 7 天 activityDays 消费，8 天留边界余量） | 无 |
| recommendationAction | 全历史 | `orderBy createdAt desc, take: 200`（配合 selector 60 行 cap） | evidence 计数收敛为有界窗口（文档化） |
| practiceRecord | 全历史 | **保留全读** | —（totalCount/all-time weakness 为 all-time 语义，加界 = 破坏性语义变化；行数受用户行为约束，登记为已知边界） |

## 4. Payload Optimization Results（实测）

| Profile | Before | After | 预算 |
|---|---|---|---|
| Small | — | 9.3 KB | <50 KB ✅ |
| Medium | 79.9 KB | **52.9 KB（−34%）** | <100 KB ✅ |
| Heavy | 无界外推 | **131.8 KB**（evidence 恒 8.4 KB） | <200 KB ✅ |

Medium 降幅 −34% ≥ 30% 目标。payload 增长模型从"随 action 历史/错题点数无界"变为"有界 + 仅随目录规模增长"。

## 5. Test Results（77/77 PASS）

| 套件 | 项数 | 结果 |
|---|---|---|
| `student-context-selector`（5 旧 + 4 P-1 + 6 SC-5） | 15 | ✅ |
| `student-context-query-boundary`（新） | 5 | ✅ |
| `student-context-performance`（新） | 5 | ✅ |
| `student-context-contract` / `-query` / `-controller-wiring` | 3/3/1 | ✅ |
| `student-home-context-adapter` / `report-workspace-context-adapter` | 11/14 | ✅ |
| `contextual-coach-base-context` / `-context` / `-integration` | 9/5/6 | ✅ |

TDD 全程 RED→GREEN：query bounds（4 RED）、payload caps（2 RED）、malformed evidence（2 RED，其中一次真实暴露了 selector 编译错误并被测试捕获——修复 type predicate 后转 GREEN）。

## 6. Build Results

```
build:api  PASS（exit 0）
build:web  PASS（exit 0，12.34s）
```

## 7. Performance Comparison

见 §4 与 `docs/student-context-payload-optimization.md` §3；selector CPU 在 Heavy（600 节点/3000 records/150 actions）负载下仍在毫秒级（perf 套件 smoke 预算 1000ms 内，实测 ~13ms 量级）。

## 8. Remaining Risks

1. **practiceRecord 全历史读取保留**（有意的语义性保留，见 §3）；若未来重度用户出现真实性能证据，需走 DB 侧聚合投影独立设计。
2. **evidence 计数语义收敛**：StudentHome 的证据计数从"全历史"变为"最近 ≤60 行窗口"——展示性摘要，已在契约演进文档记录；如产品侧需要全历史计数需另行增量。
3. **evidence provenance window 需产品知情**：报告/首页证据来源不再含 60 行以前的 action 历史。
4. 全量 `npm test` 与 PostgreSQL integration 维持 ENV-005 阻塞；本轮所有验证均实际执行，未伪造。

## 9. Future Roadmap

| 编号 | 内容 | 状态 |
|---|---|---|
| SC-P2-001 | Mastery fallback 语义对齐（`toMasteryNodeFact` 硬编码 weak） | 待批（未混入本轮） |
| SC-P2-002 | knowledgePoint 进程级缓存 | **已被 TASK 1 的 IN 查询方案实质替代/降级**（更优：无缓存失效问题，输出不变） |
| SC-P2-003 | practiceRecord 读取上界化（需 DB 聚合投影设计） | 待批（需独立设计） |
| SC-P2-005 | assessment facts 处置（入契约 or 停止装配） | 待批 |
| SC-6（候选） | 真实流量下的缓存策略复评（TTL 快照等，先测量后决策） | 未启动 |

## 10. Acceptance

```
[x] No Source of Truth change          [x] No Prisma migration
[x] No consumer breaking change        [x] StudentContext remains canonical read boundary
[x] All tests pass（77/77）            [x] Build pass（api + web）
[x] Documentation complete（4 份新增/更新文档）
```

**Milestone Status: PRODUCTION HARDENING COMPLETE**
