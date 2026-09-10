# V12 失败分层归档（Failure Classification Ledger）

> 日期：2026-09-10 · 分支 `feature/v3-product-refactor`
> 目的：**不把所有东西包装成绿色**。仓库里每一个非绿色项都必须有类型、有证据、有属主动作。
> 硬约束（所有者下达）：**禁止为追求 `npm test = 2200/2200` 而篡改既有失败。**

---

## 0. 结论速览

```
NEW REGRESSION            0 项   ← 本文件最重要的一行
PRE-EXISTING FAILURE      3 项
ENVIRONMENT BLOCKER       2 项
FIXTURE / DATA GAP        2 项
INTENTIONAL SHADOW        1 项
PENDING DEPLOYMENT        1 项
PRE-EXISTING DEBT (未授权) 2 项
```

**"零新增回归"的举证**（不是宣称，是可核验的）：

| 证据 | 结果 |
|---|---|
| V12 全部提交对 `prisma/` 的改动 | 仅 1 处**已批准的纯增量可空字段**（`Question.rubric Json?`，另有独立迁移与回滚说明）；无删除、无重命名、无回填 |
| V12 对 `scripts/` 既有脚本的改动 | **0**（只新增脚本，未修改任何既有集成脚本的断言） |
| 全量单测 | `npm test` **2214 / 2212 / 0 fail / 2 skip**，exit 0 |
| 三端类型检查 + 构建 | `tsc --noEmit`（shared/api/web）exit 0；`build:api`、`build:web` exit 0 |
| 真实 PostgreSQL 集成 | `score-loop`（16 环节）、`effectiveness`、`event-key`、`content-import` 均 exit 0 |
| 既有非绿项 | 全部**在 V12 之前就已登记**（见下表"首次登记"列）或为环境/夹具缺口 |

---

## 1. PRE-EXISTING FAILURE（既有失败，非 V12 引入）

### P-1 `test:integration:postgres` 失败

| 项 | 内容 |
|---|---|
| 表现 | `Error: review scheduler regression requires three target-date tasks` |
| 位置 | `scripts/integration-postgres.mjs:1254` `assert(protectedTaskIds.length === 3, ...)` |
| 类型 | **PRE-EXISTING FAILURE** |
| 判定证据 | ① V12 对 `scripts/` 改动 **0** 个文件；② V12 对 `prisma/` 仅新增可空列；③ V12 对 `study.service.ts` review 路径的改动是**被 try/catch 包裹的附加证据记录**，不可能改变计划生成的任务数；④ **该债务在 V12 之前已登记**：`docs/v11-architecture-final.md:110` §7「已知债：集成脚本 review-scheduler 断言（所有者定的稍后项）」、`docs/v12-0-score-improvement-audit.md` §2「已知环境债」 |
| 根因（推断） | V8 #13 结转重锚 / V9 周强度改计划管线后，该场景不再产出 3 个目标日任务（与 `docs/v10-1-sprite-core-final-report.md` 的既有归因一致） |
| 失败点之前 | 全部通过（API 启动、并发提交幂等、快照时间保留、报告一致性、dashboard 等） |
| 属主动作 | **需改计划生成逻辑 = 生产行为变更 → 需所有者批准**。本轮不修（修它才有可能引入真正回归） |

### P-2 `npm test` 的 2 个 skip

| 项 | 内容 |
|---|---|
| 表现 | `tests 2214 / pass 2212 / fail 0 / skipped 2` |
| 类型 | **PRE-EXISTING（有意跳过）** |
| 判定证据 | V12 之前即为 2 skip（基线 run 记录：2049/2047/0/**2**）；V12 未触碰任何 `test.skip` |
| 属主动作 | 无需动作；如需归零需先确认这两个 skip 的原始意图（在册） |

### P-3 已知死代码与既有缺陷（未清理）

| 项 | 内容 |
|---|---|
| 内容 | ① `task-progress-consistency-checker.service.ts`（674 行，生产零引用但有 19 项测试锁定，属**故意保留的审计工具**）；② `features/teacher/useTeacherActions.ts`（324 行，含测试在内零引用）；③ `RuntimeStateRepository`（零消费）；④ `saveMastery`（仅测试引用）；⑤ `adaptive/adaptive-review.ts`、`adaptive/adaptive-exam.ts`（各 ~120 行零引用） |
| 类型 | **PRE-EXISTING DEBT（未授权清理）** |
| 判定证据 | 全部在 V12-0 审计 §5/§8 登记；V12 未新增死代码 |
| 属主动作 | 清理属 P2 工程收敛；**删除代码属未获授权的改动范围**，本轮不动。注意 ①② 中的测试锁定项**删不得**（删了会破坏既有契约测试） |
| 另一项 | `study.service.ts:3424` 的 `correctCount ?? Math.round(questionCount*0.75)` **合成默认值**会经 `taskCompletionMetricsByUser` 流入 `computeMasteryReport`。V12 已用测试**锁死它不得进入证据层**，但**未修改该既有行为**（修改会变更计划调整逻辑）。类型：**PRE-EXISTING DEFECT，已记录未修** |

---

## 2. ENVIRONMENT BLOCKER（环境阻塞，非代码）

### E-1 生产部署未执行

| 项 | 内容 |
|---|---|
| 表现 | 生产仍运行 `43b715e` 前后构建；V11-M2/M3/M4 与 V12 的 5+2 个端点未上线 |
| 类型 | **ENVIRONMENT BLOCKER** |
| 判定证据 | 本会话**无服务器 SSH 凭据**。按任务 §5「不得伪造部署」，只准备部署包与确切命令 |
| 属主动作 | 所有者执行 `deploy/tencent-ip/deploy.sh` 或 runbook 中的显式 refspec 流程（见最终报告 §15） |

### E-2 连续运行集成套件时的瞬时崩溃

| 项 | 内容 |
|---|---|
| 表现 | 4 套集成测试**在同一 shell 连续**运行时，`content-import` 出现一次 `0xC0000409`（STATUS_STACK_BUFFER_OVERRUN） |
| 类型 | **ENVIRONMENT（资源/端口争用）** |
| 判定证据 | **单独复跑 exit 0**；事后检查 3200/3202/3210/5173/3110 **无残留监听**；同一脚本在更早的单次运行中亦 exit 0 |
| 属主动作 | 无需代码改动；建议 CI 中每套使用独立端口并串行隔离（**建议，非缺陷**） |

---

## 3. FIXTURE / DATA GAP（夹具与数据缺口，非代码）

### F-1 `test:integration:exam-aligned` 失败

| 项 | 内容 |
|---|---|
| 表现 | `[exam-aligned] integration validation FAILED: seeded database must contain at least one question`（首轮为 `at least 3 frequency snapshots`，播种后推进到下一断言） |
| 类型 | **FIXTURE / DATA GAP** |
| 判定证据 | 该脚本要求 `Question` 题库；`npm run seed:408` 只灌真题层（`ExamPaper`/`ExamQuestion`/`KnowledgeFrequencySnapshot`），`questions:generate-starter` **仅生成 CSV 不导入**。断言前先要求快照、再要求题目，说明它假设的是一个**已完整播种**的库 |
| 属主动作 | 补"生成 CSV → 导入题库"的播种链，或让该脚本自带夹具（与 `integration-effectiveness.mjs` 的做法一致）。**属测试夹具完善，非产品缺陷** |

### F-2 `npm run seed:knowledge-map` 失败

| 项 | 内容 |
|---|---|
| 表现 | `[seed-knowledge-point-map] FAIL: knowledge points missing in DB: ds-list, ds-tree, ...` |
| 类型 | **FIXTURE / DATA GAP** |
| 判定证据 | 该脚本要求 legacy `KnowledgePoint` 行；`seed:408` 不创建它们。属播种链依赖顺序问题 |
| 属主动作 | 明确播种顺序或在脚本内自建前置数据 |

---

## 4. INTENTIONAL SHADOW（刻意保持影子，**禁止切换**）

### S-1 M3 复习语义统一 —— Phase C 未实施

| 项 | 内容 |
|---|---|
| 表现 | 生产语义**未变更**：`applyReview` 仍不改 `mastery`，`retention` 仍恒为 1 |
| 类型 | **INTENTIONAL SHADOW**（所有者明确指令：不得擅自切换） |
| 判定证据 | 代码层面 `apps/api/src/score-center/service.ts` 的 `applyReview` 在 V12 中**零改动**（`git diff 8abff36..HEAD -- apps/api/src/score-center/service.ts` 为空）；影子端点只读 |
| **切换就绪度** | **NOT READY — 保持 Shadow**（见 §5） |
| 属主动作 | 继续积累真实数据；达到预注册阈值且人工复核后由所有者批准 |

---

## 5. M3 切换就绪度评估（队列证据）

`npm run test:integration:review-shadow-cohort` —— 15 名学生（5 个掌握度区间 × 3 种复习结果，复习次数 1–3、间隔 1/3/7 天），经真实 API 读取影子：

| 掌握度区间 | n | 平均 Δ | unified_higher | 其他 |
|---|---|---|---|---|
| 0.00–0.30 | 3 | **+0.1177** | 3 | 0 |
| 0.30–0.45 | 3 | **+0.0667** | 2 | 1 |
| 0.45–0.60 | 3 | **+0.0221** | 2 | 1 |
| 0.60–0.75 | 3 | **−0.0289** | 1 | 2 |
| 0.75–1.00 | 3 | **−0.0735** | 1 | 2 |

```
evaluated=15  insufficient=0
unified_higher=9  unified_lower=5  converged=1
方向一致率 = 64.3%（14 个有方向样本中）
预注册阈值：方向一致率 ≥ 70% 且 观测数 ≥ 30
判定：NOT READY — 保持 Shadow
原因：① 观测数 15 < 30；② 统一语义在队列上**不指向同一方向**
```

### 5.1 为什么这个结果比"看起来合理"重要

早期端到端测试只有**一个**数据点（`0.4622 → 0.5383`，+0.0761），表面上像是"统一语义更好"。**队列推翻了这个直觉**：

> 统一语义的效果**随掌握度区间变号**——低分区系统性**上调**（+0.118 → +0.022 递减），高分区系统性**下调**（−0.029 → −0.074 递减）。

这意味着切换会**压缩掌握度分布**，并且对 `calculatePriority` 的 weakness 分量产生**非均匀**影响：弱学生被推高（可能降低其训练优先级）、强学生被推低（可能提高其优先级）。**这正是"看起来合理就切换"会踩的坑**：单点证据支持的结论，在队列上不成立。

真实结论：**切换需要先回答"这种压缩是否是我们想要的"。** 这是一个**产品判断**，不是工程判断——因此它必须由所有者决定，工程侧只能给出如上分布。

---

## 6. PENDING DEPLOYMENT（待部署）

### D-1 V11-M2/M3/M4 + V12 端点未上线

| 项 | 内容 |
|---|---|
| 端点 | V11：`/coach/task-evidence`、`/coach/mastery-calibration`、`/coach/outcome-tracking`、`/admin/data-quality`；V12：`/coach/learning-evidence`、`/coach/recommendation-funnel`、`/coach/review-semantics-shadow`、`/coach/score-opportunity`、`/coach/score-calibration`、`/questions/:id/rubric`、`/questions/:id/subjective-attempt` |
| 类型 | **PENDING DEPLOYMENT（所有者门控）** |
| 判定证据 | V12-0 路由探测实证 V11-M2+ 端点返回 404；本会话无 SSH 凭据 |
| 属主动作 | 部署后须验证：上述端点返回 **401（未认证）而非 404**（证明已注册） |

---

## 7. 维护规则

- 任何新增的非绿色项**必须**在本文件登记类型 + 证据 + 属主动作。
- **禁止**通过删除测试、放宽断言、`skip` 或修改既有失败来使汇总变绿。
- 若某项从"既有失败"变为"已验证修复"，必须给出**修复提交 + 复跑证据**，并从本文件移出（保留历史记录）。
