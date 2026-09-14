# P1.5 并发 Mastery 提交缺陷修复 · 实施报告

> 日期：2026-09-14。任务来源：current-sprint 2026-09-13 权威块 Owner 决策 ③（独立修复任务 P1.5/HIGH）。
> 设计：docs/p15-concurrent-mastery-fix-design.md（含缺陷链路 file:line 证据、候选方案取舍、开源参考检查）。

## 1. 缺陷与修复

**缺陷**：三个批量提交路径（`submitPaper` / `submitPracticeSet` / `submitStageAssessment`）以 `Promise.all` 并发调用 `createPracticeRecord`，每个记录开独立事务写掌握度；同卷多题解析到同一知识节点时，并发事务在同一 `UserKnowledgeMastery` 行上 OCC 冲突，重试上限 3 耗尽 → `MasteryOptimisticLockConflictError` → 整卷提交 500。

**修复（方案 A，最小 diff）**：三处 `Promise.all(answers.map(...))` 改为按答卷顺序的 `for-of` 串行。OCC + 重试机制原样保留（仍是跨请求并发兜底）；mastery EMA 应用顺序从竞态不确定变为确定性（正确性改进）。

**改动文件**：
- `apps/api/src/study/study.service.ts`（3 处，仅批量提交路径）
- `scripts/integration-batch-submit-concurrency.mjs`（新增，真实 PG + HTTP E2E）
- `test/batch-submit-serialization.test.js`（新增，4 项回归钉死）
- `package.json`（+`test:integration:batch-submit-concurrency`）
- 设计/报告文档 2 份

零 schema / 零迁移 / 零 API 契约 / 零前端变化；会话提交路径（单事务批量 applyAttempts）未触碰。

## 2. 验证（全部本会话一手实跑）

| 门禁 | 结果 | 标记 |
|---|---|---|
| RED 实证（修复前） | 同节点 5 题整卷提交 → **HTTP 500**（缺陷复现，401 拒绝路径正常） | PASS（缺陷确认） |
| TDD 单测 | `batch-submit-serialization` 4/4（三方法禁止 Promise.all 扇出 + 会话路径防误改） | PASS |
| `build:api`（含 shared） | exit 0 | PASS |
| 真实 E2E（修复后） | 集成脚本 6 步全过：401 → 提交成功（无 500）→ mastery 行 attempts=5 / version=4 / 每题恰一次 → 存储掌握度 = shared EMA 按答卷顺序重放值（0.488292 逐位相等）→ 第二批量路径（阶段测评同节点 3 题）attempts=8 累积 | PASS |
| 回归 score-loss 集成（走 paper 路径） | exit 0 | PASS |
| 回归 score-loop 集成（16 环） | exit 0 | PASS |
| `npm test` 全量 | **2547 / 2545 / 0 / 2，exit 0**（基线 2543 + 4 新增，零新增失败） | PASS |
| `build:web` | 未触碰前端 | SKIPPED（无前端变更） |

**环境备注（如实记录）**：本会话沙箱间歇性拦截后台/嵌套 spawn（`node.exe 执行·拒绝`），导致 ①后台 npm test 被拦（改前台跑通）②一次 build:web 与一次 build:api 被瞬断、一次 nest build 中断留下残缺 dist（删除 `tsconfig.tsbuildinfo` 重建后完整）。最终所有门禁均在前台完整重跑通过，非替代门禁。集成脚本新增 `P15_SKIP_BUILD=1` 开关以支持"先前台构建再跑脚本"的拆分执行（默认行为不变，仍自动构建）。

## 3. 影响与风险

- **失败语义**：每题独立事务、任一失败即中断——与原 Promise.all 的部分提交语义一致，无全或无保证（两者相同）。
- **性能**：N 题串行小事务，整卷延迟上升数十~数百 ms；提交端点非热路径，正确性优先。
- **残余风险**：跨请求并发（双击/多标签同时提交同一用户同节点）仍由 OCC 重试兜底，理论上极端交错仍可能耗尽——概率远低于同批次自我并发（已消除）；多实例部署横向扩展时如需彻底消除，可评估行级锁或队列化（本修复不引入）。
- **回滚**：三处改回 `Promise.all` 即可（纯代码 revert）。

## 4. 遗留

- 本修复解锁 current-sprint 09-13 权威块第 ⑤ 项；Phase 0 剩余：S1 生产部署（Owner 人工）、maxScore 内容标注（内容轨）、⑥ 之后回 S2。
- Git：修复改动未提交（AGENTS.md §9，待 Owner 指令）。提交建议清单：`apps/api/src/study/study.service.ts`、`scripts/integration-batch-submit-concurrency.mjs`、`test/batch-submit-serialization.test.js`、`package.json`、本报告与设计文档、`docs/current-sprint.md` 账本条目。
