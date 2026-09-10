# V12-M1 — Evidence Foundation

> 里程碑：V12-M1（Evidence Foundation）
> 目标：闭合审计断点 **EB-1**（任务完成→零能力证据）与 **EB-2**（标记已复习→零证据）
> 状态：**实现 + 测试 + 回归完成**（见 §7 验证证据）
> 纪律：零 Schema 迁移 / 零掌握度写语义变更 / 单一写方不变 / 前端未改动

---

## 1. 问题陈述（审计原文）

| 断点 | 审计证据 | 本质 |
|---|---|---|
| EB-1 | `study.service.ts` `completeStudyTask` 无掌握度/证据写 | 系统记录了"学生完成了任务"，但没有记录任何**可支撑能力推断的东西** |
| EB-2 | `study.service.ts:2324` `applyReview` 仅 `isReview===true` | "标记已复习"这个动作在系统里**不留任何痕迹** |

两者共同的根因：**系统缺少"活动 / 证据 / 能力"三者的区分**。`task.complete`、`wrong.review` 作为遥测事件存在，但遥测只说"某事发生了"，不说"观察到了什么表现"。

---

## 2. 核心语义（本轮确立，代码即契约）

三层必须严格分开，且不允许跨层冒充：

| 层 | 定义 | 载体 | 能否支撑能力判断 |
|---|---|---|---|
| **Activity（活动）** | 某个动作发生了 | `UserEvent` 遥测 / `StudyTaskCompletion` / `WrongQuestionReview` | ❌ 永不 |
| **Evidence（证据）** | 系统**观测**到了可解释为学习表现的事实 | `UserEvent`（`EVIDENCE_RECORDED`，服务器专属）+ 派生投影 | 仅强证据 |
| **Ability（能力）** | 对掌握度的推断 | `UserKnowledgeMastery`（唯一写方 `ScoreCenterService`） | —— |

### 2.1 回答任务 §6.2 的十个问题

**Q1 什么是 Learning Evidence？**
一条**不可变、可审计、幂等**的记录，说明某个动作产生了什么**可观测事实**，并显式标注其强度与能否支撑能力推断。证据不是数字本身，而是"数字 + 来源 + 强度 + 理由"。

**Q2 什么是 Activity？**
动作发生的登记。它的全部含义就是"发生了"。`task.completed`（完成标记）、`review.marked`（点了已复习）都是活动。

**Q3 什么是 Review？**
本系统里 "review" 有两个不同语义，必须分开：
- `review.marked`：学生**声明**已复习 → 纯活动（无观测）
- `review.recalled`：复习时系统**观测**到重做/回忆结果（`redoCorrect`）→ 强证据

**Q4 什么是 Assessment Evidence？**
测评（阶段卷/模考）中**已判分**的作答。它与练习证据同为 `objective_performance`（强证据），但作用在测评口径上（分数维度）。本轮只建立分类，测评专用投影留待 V12-M5。

**Q5 什么行为可以影响 Mastery？**
**只有被系统观测到结果的作答**：
- 已判分的练习作答（`PracticeRecord`）
- 已观测的复习重做结果（`ReviewAttempt.redoCorrect`）
- 测评中已判分的作答

三者都经 `ScoreCenterService.applyAttempts / applyReview`——**V12-M1 未改动这条路径的任何语义**。

**Q6 什么行为不能影响 Mastery？**
- 任务完成标记（`task.completed` 本身）
- "标记已复习"（`review.marked`）
- 任何**自评**数字（`completedQuestionCount` / `correctCount` / `selfRating`）
- 页面浏览、点击等 UI 遥测

自评是**弱证据**：它进入证据账本（学生说了什么值得记录），但 `canInfluenceMastery=false`，被代码强制。

**Q7 一次任务完成是否一定意味着学习发生？**
**不一定，且系统现在必须承认这一点。** 完成是一个声明；学习是一个需要观测的假设。因此 `recordTaskCompletionEvidence` 返回两部分：
1. `selfReported`：完成标记 + 学生上报（弱证据，最弱为"活动"）
2. `observed`：系统在该任务范围（知识节点/考点 → 题目）±3 天内**实际观测到的已判分练习**——**这才是唯一可能支撑能力判断的部分**
当第 2 部分为空时，返回 `null`：**缺失本身就是结论**，绝不填充零值。

**Q8 如何防止重复提交？**
- 事件层：`(userId, eventKey)` 数据库唯一索引（`UserEvent_userId_eventKey_key`），`recordCanonical` 捕获 P2002 并返回既有行
- 证据键：`LEARNING_EVIDENCE:{userId}:{action}:{sourceId}:{scope}` 确定性生成；同一任务同一天重复完成 → 同一键 → 不产生第二条证据
- 同一天内**多次真实复习**仍是新证据（`scope` 按日期区分）

**Q9 如何保证幂等？**
幂等由**确定性键 + 唯一索引**双重保证，而非应用层去重：
- 相同事实 → 相同 `eventKey` → 数据库拒绝第二条
- `recordTaskCompletion` 重复调用返回同一 `id`

**Q10 如何保持 Student State 一致？**
- 证据是 **append-only 只读叠加**，不修改任何既有表，不新增写方
- 复习证据在**事务提交之后**才写（`Only committed attempts may become visible` 之后），因此**证据永不描述一个可能回滚的尝试**
- 证据记录失败时记 warn 并继续（与既有 `trackUserEvent` 一致）：缺失保持可见为"无证据"，而不是伪造

---

## 3. 语义矩阵（本轮落地部分）

| 动作 | Activity | Evidence | 强度 | 可影响 Mastery | 落库位置 |
|---|---|---|---|---|---|
| 打开错题 | ✅ | ❌ | none | ❌ | `wrong.open_review` 遥测 |
| 标记已复习 | ✅ | ✅（活动证据） | none | ❌ | `EVIDENCE_RECORDED` |
| 提交练习作答 | ✅ | ✅ | **strong** | ✅（既有路径） | `PracticeRecord` + `EVIDENCE_RECORDED` |
| 完成任务（有自评） | ✅ | ✅ | weak | ❌ | `StudyTaskCompletion` + `EVIDENCE_RECORDED` |
| 完成任务（无自评） | ✅ | ✅（活动证据） | none | ❌ | 同上 |
| 完成任务且范围内有观测练习 | ✅ | ✅ | **strong** | ⚠️（仅记录；回流见 §6） | 同上（第二条证据） |
| 复习且观测到重做结果 | ✅ | ✅ | **strong** | ✅（`applyReview`，既有路径） | `ReviewAttempt` + `EVIDENCE_RECORDED` |
| 测评已判分作答 | ✅ | ✅ | **strong** | ✅（既有路径） | `PracticeRecord` + `EVIDENCE_RECORDED` |

**红线（测试强制）**：`test/v12-evidence-boundary.test.js` 断言证据层源码中**不存在** `userKnowledgeMastery` / `applyAttempts(` / `applyReview(` / `saveMastery` / `userMasterySnapshot` 任何写原语。

---

## 4. 实现清单

| 文件 | 类型 | 说明 |
|---|---|---|
| `packages/shared/src/score-center/learning-evidence.ts` | 新增（纯函数，349 行） | 分类学 `LEARNING_ACTION_TAXONOMY`、`classifyLearningAction`、`buildLearningEvidence`、`learningEvidenceKey`、`summarizeLearningEvidence` |
| `packages/shared/src/score-center/index.ts` | 修改（+1 行） | 导出新模块 |
| `apps/api/src/study/learning-evidence.service.ts` | 新增 | 写路径 + 查询；`recordTaskCompletionEvidence`（含观测回查）、`recordReviewMarked`、`recordReviewRecall`、`recordObservedPerformance`、`list` |
| `apps/api/src/study/user-event.repository.ts` | 修改 | 新增 `listByType(userId, type, limit)` |
| `apps/api/src/study/canonical-event-writer.service.ts` | 修改（+1 行） | `EVIDENCE_RECORDED` 加入 `RESERVED_CANONICAL_EVENT_TYPES`（**服务器专属**） |
| `apps/api/src/study/study.service.ts` | 修改 | 三处接线 + `recordLearningEvidence` 安全辅助 + 构造器第 30 参 |
| `apps/api/src/study/daily-brief.controller.ts` | 修改 | `GET /coach/learning-evidence`（self-only） |
| `apps/api/src/study/study.module.ts` | 修改 | 注册 provider |
| `test/learning-evidence.test.js` | 新增（17 项） | 纯模块契约 |
| `test/learning-evidence-service.test.js` | 新增（10 项） | 服务写/查/幂等/诚实 |
| `test/v12-evidence-boundary.test.js` | 新增（8 项） | 接线证明 + 边界 + 防伪 + self-only |

### 4.1 为什么零迁移（任务 §20 要求）

任务要求优先 `existing schema / projection / event / JSON / derived data`。证据层选择 **`UserEvent` + JSON payload**：

| 方案 | 迁移 | 幂等 | 审计 | 风险 |
|---|---|---|---|---|
| **新表 `LearningEvidence`（未选）** | 需要 | 需自建 | 好 | 新表 + 新写方，触碰 SoT 边界 |
| **复用 `UserEvent`（已选）** | **零** | 既有 `(userId,eventKey)` 唯一索引 | append-only 天然可审计 | 零新写方；`UserEvent` 本就是事件账本 |

**回滚方式**：删除 `EVIDENCE_RECORDED` 事件行即可（`DELETE FROM "UserEvent" WHERE type='EVIDENCE_RECORDED'`），无 Schema 变更、无数据形态变更。

---

## 5. 端点

```
GET /coach/learning-evidence?limit=50
```
- 角色：`student | teacher | admin`（`RoleGuard`）
- **self-only**：不接受 `userId` 覆盖（证据是个人数据；测试强制断言）
- 存储不可用 → `{ records: [], summary: null, reason: 'store_unavailable' }`（诚实缺席，不返回空成功）
- 返回：`records[]`（含 `kind/strength/canInfluenceMastery/basis/metrics`）+ `summary`（含 `hasAbilityEvidence` 与中文口径说明）

---

## 6. 明确未做（诚实边界）

| 项 | 原因 | 归属 |
|---|---|---|
| **证据 → 掌握度的回流语义统一** | 会改变生产写语义（`applyReview` 触发条件），任务 §9.1 要求设计先行 + 批准 | **V12-M3** |
| `ReviewAttempt` 与 EMA 双算法口径统一 | 同上 | **V12-M3** |
| 前端消费（今日任务证据徽标 / 报告证据卡） | 本轮为后端地基 | **V12-M2b** |
| 推荐曝光遥测（EB-3） | 独立断点 | **V12-M2a** |
| 测评专用证据投影 | 需与真实分数对照口径一起设计 | **V12-M5** |

---

## 7. 验证证据

| 项 | 命令 | 结果 |
|---|---|---|
| shared 构建 | `node node_modules/typescript/bin/tsc -p packages/shared/tsconfig.json` | exit 0 |
| API 类型检查 | `node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit` | exit 0 |
| 纯模块 | `node test/learning-evidence.test.js` | **17/17 pass** |
| 服务层 | `node test/learning-evidence-service.test.js` | **10/10 pass** |
| 边界/接线 | `node test/v12-evidence-boundary.test.js` | **8/8 pass** |
| 全量回归 | 逐文件 `node test/*.test.js`（330+8 文件） | 见下 |

> **环境说明（诚实）**：本会话沙箱禁止子进程管道 spawn，`npm test`（`node --test` 会 spawn 每个测试文件）与 `npm run build:web`（esbuild spawn）在沙箱内**必然 EPERM**。因此本里程碑采用等价替代门禁：**逐文件 `node <file>` + 三端 `tsc --noEmit`**（已在 `docs/current-sprint.md` 地雷区登记）。该替代覆盖了全部测试文件与全部类型检查，唯一未覆盖的是 Vite 打包本身。

---

## 8. 遗留风险

| 风险 | 说明 | 处置 |
|---|---|---|
| 合成指标污染既有报告 | `study.service.ts:3424-3430` 在 `correctCount` 缺失时默认 `Math.round(questionCount*0.75)`，该值经 `taskCompletionMetricsByUser` 流入 `computeMasteryReport`（`:866-870`） | 本里程碑**未改动**（改变会动计划调整行为）。证据层已用测试锁死"不继承该值"；建议后续单独治理 |
| 观测回查成本 | 任务完成时新增一次 `questionKnowledgeNodeTag` + `practiceRecord` 查询（均已有索引） | 可接受；失败时降级为"无强证据" |
| 证据量增长 | 每次完成/复习产生 1–2 条事件 | `limit` 上限 200；如需长期归档，V12 后续可加清理策略 |
