# P1.5 并发 Mastery 提交缺陷修复 · Design Gate

> 日期：2026-09-14。任务来源：current-sprint 2026-09-13 权威块 Owner 决策 ③（独立修复任务，P1.5 / HIGH，"独立 Design Gate → TDD → E2E"）。
> 缺陷登记：docs/s1-score-anchor-implementation-report.md §8.3（PRE-EXISTING：同节点三题并发必现 OCC 耗尽 → 500）。

## 1. 缺陷链路（file:line 证据）

1. 三个批量提交路径并发扇出逐题写：
   - `submitPaper`（apps/api/src/study/study.service.ts:2026）
   - `submitPracticeSet`（:3071）
   - `submitStageAssessment`（:3779）
   均为 `Promise.all(answers.map((answer) => this.createPracticeRecord(...)))`。
2. 每个 `createPracticeRecord` 开独立 `prisma.$transaction`，内部 `scoreCenterService.applyAttempts(userId, [saved], tx)`（:3142 / :3198 / :3279）→ N 个并发事务。
3. `applySingleAttempt`（apps/api/src/score-center/service.ts:134-170）对每节点读-改-写 `saveMasteryWithOptimisticRetry`（apps/api/src/score-center/repository.ts:141-189），冲突重试上限 `MAX_MASTERY_CONFLICT_RETRIES = 3`。
4. 同卷多题解析到同一节点（按章组卷是常态）→ 并发事务同时读 version N → 仅一个胜出 → 败者重试 → 同节点 ≥3 题并发时最坏交错超过重试上限 → `MasteryOptimisticLockConflictError` → 该题事务整体回滚 → `Promise.all` reject → 整卷提交 HTTP 500。
5. 对照安全路径：会话提交 `:4633` 在**单事务内顺序** `applyAttempts(userId, records, tx)`——无并发，从不触发。

## 2. 候选方案与取舍

| 方案 | 内容 | 评价 |
|---|---|---|
| A（采纳） | 三个批量路径 `Promise.all` → 按答卷顺序 `for-of` 串行 | 零新原语、diff 极小、mastery 应用顺序从竞态不确定变为确定性（EMA 顺序敏感，确定性是正确性改进）、回滚 = 改回三行 |
| B | 批量路径改为"先建记录后单事务批量 applyAttempts"（对齐 :4633） | 牵动 receipt/review/task-progress 链路重排，范围爆炸，超出缺陷修复边界 |
| C | 进程内 per-key 异步互斥锁（async-mutex 模式） | 引入新并发原语与心智负担；多实例部署仍需 OCC 兜底；收益不优于 A |
| D | 调大重试次数/退避 | 只缓解不修复，且延长事务持锁时间 |

**开源参考检查（2026-09-14）**：Prisma 官方 OCC 指南（version 守卫 updateMany，本仓已实现，保留为跨请求兜底）；Node 并发实践共识"顺序敏感时用顺序迭代替代 Promise.all"（deverrors / plainenglish "Node.js Is Single-Threaded, Your Database Isn't"：Promise.all 在 DB 层即并发，顺序 matters 的批处理应串行）；Prisma 批量作业指南（分块+顺序避免长锁）。思想借鉴，按本仓架构落地，未复制代码。

**结论：方案 A**。OCC + 重试机制原样保留——它仍是跨请求并发（双击重复提交、多标签页）的兜底，本修复只消除"单批次内自我并发"。

## 3. 影响面与不变量

- 改动文件：仅 `apps/api/src/study/study.service.ts`（3 处）。零 schema / 零迁移 / 零 API 契约变化 / 零前端变化。
- 失败语义不变：每题独立事务，任一失败即中断（原 Promise.all 也是首个 reject 即失败、已提交题不回滚——部分提交语义两者一致）。
- 响应结构不变：records 顺序仍为答卷顺序（Promise.all 结果保序，for-of 同序）。
- 性能：N 题串行小事务，整卷提交延迟上升数十~数百 ms；提交端点非热路径，正确性优先。
- 不做：不改 `saveMasteryWithOptimisticRetry`、不聚合同节点 EMA（逐题应用 = 与逐题作答语义一致）、不碰会话/单题/复习路径。

## 4. 验证设计（TDD）

- **RED（真实 PG + HTTP）**：`scripts/integration-batch-submit-concurrency.mjs`——同节点 5 题整卷提交。修复前实证 500；修复后断言：HTTP 成功、5 条 PracticeRecord、mastery 行 attempts=5、version 与 sequential EMA 终值逐位等于 shared `updateMasteryAfterAttempt` 按答卷顺序重放结果、401 拒绝路径。
- **回归钉死（单测）**：`test/batch-submit-serialization.test.js`——源码断言三个批量方法不再对 `createPracticeRecord` 使用 `Promise.all`。
- **回归**：`npm test` 全量 + `build:api` + 受影响集成套件（score-loss 走 paper 路径、score-loop）。

## 5. 回滚

三处改回 `Promise.all` 即恢复原状（纯代码 revert，无数据迁移）。
