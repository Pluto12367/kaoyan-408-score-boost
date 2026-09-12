# G1 Release Hardening — Report

> 日期：2026-09-12 ｜ 性质：**RELEASE HARDENING（只解决发布前剩余问题，不新增功能）**
> 起点：`46a04fe4`（G1 = COMPLETE，未 push）｜ 分支：`feature/v3-product-refactor`
> 事实来源：当前仓库代码、Prisma Schema、测试与命令输出（AGENTS.md §1）。

---

## 0. 结论

```text
G1 RELEASE READY
PRODUCTION DEPLOY = NOT APPROVED
```

| 项 | 结果 |
|---|---|
| Reason Integrity | **EVIDENCED_REASON only** —— 全链单一过滤点，含 E2E 发现的两个额外生产者 |
| Transfer Probe fixture | **已修**（`test:integration:transfer-probe` **14 步 ALL PASS**，未弱化任何断言） |
| 完整回归 | `npm test` **2463 / 2461 pass / 0 fail / 2 skipped** exit 0；7 个集成套件**全部 exit 0** |
| NEW REGRESSION | **0** |
| C1 | **OFF**（`MASTERY_SEMANTICS` 不在生产白名单） |
| Production Transfer Probe | **OFF**（`TRANSFER_PROBE_ENABLED=false`；机制保留） |
| 部署 | **未部署**（Owner 明确 NO PRODUCTION DEPLOY） |

---

## A. Reason Integrity

### A.1 Owner 决定与实现

Owner 决定（G1 Release Hardening, A1）：**只有 `EVIDENCED_REASON` 可以进入学生主 WHY 文案**；`INFERRED_REASON` 可作内部排序/解释依据但不得伪装成事实证据；`CONTEXTUAL_FACT` 不进主 WHY。原则：**真实证据 > 丰富理由**；禁止重新引入 generic reason filler。

`packages/shared/src/score-center/reason-integrity.ts` 的 `resolveShownReasons()` 是**唯一**决定"哪些码能当理由读"的地方：

```text
EVIDENCED_REASON   LOW_MASTERY / LOW_ACCURACY / REPEATED_WRONG / REVIEW_DUE
   ↓  只这一档进入「为什么推荐（你的学习证据）」
INFERRED_REASON    HIGH_RECENT_FREQUENCY / RISING_TREND / PREREQUISITE_GAP
   ↓  保留为「排序参考（考试统计，不是你的学习证据）」——不伪装成事实证据
CONTEXTUAL_FACT    EXAM_NEAR / LOW_EVIDENCE
   ↓  「当前情况」
fallbackReasons    旧通用池 —— 仅诊断，任何层级都不可见
```

`filterEvidencedReasonCodes()` 把同一条规则提供给只携带裸码的路径（持久化 `reason` 字符串、legacy nodePlan、score-center 卡片）。

### A.2 四类行为（Phase 2 要求，均已测试）

| 场景 | 行为 | 测试 |
|---|---|---|
| 0 条 evidenced | 显示 `当前证据不足：…系统不会用考频或趋势来充当「为什么」。` | `G1.A1: zero evidenced reasons produce an explicit insufficiency note` |
| 1 条 evidenced | **只显示 1 条**，不补齐到 2 | `G1.A1: one evidenced reason shows exactly one entry` |
| evidenced + inferred | **只显示 evidenced**，inferred 落到排序参考 | `G1.A1: evidenced + inferred shows only the evidenced reason` |
| generic filler | **任何层级都不可见** | `G1.A1: generic filler is never visible, in any tier` |

另有三条结构性守卫（`test/g1-surface-wiring.test.js`）：凡是渲染 reason copy 的文件必须同时应用过滤；两个 reason 写入点被钉死；`为什么` 标题不得由裸码列表直接喂入。

### A.3 四个学生可见 WHY 生产者——两个由源码审计找到，两个只由 E2E 找到

| # | 生产者 | 原问题 | 处理 | 发现方式 |
|---|---|---|---|---|
| 1 | `apps/api/src/study/recommendation.service.ts` | `reasonCodes.join('、')` 泄漏裸码；空列表落 `recommendation:${action}` 机器串 | 走 `filterEvidencedReasonCodes` + `INSUFFICIENT_REASON_NOTE`；`reasonCodes` 字段保持完整 | 源码审计 |
| 2 | `packages/shared/src/nodePlan.ts` | 把**每一个** code 过 `REASON_LABELS` 后 join | 同一过滤器 | 源码审计 |
| 3 | `packages/shared/src/learning.ts` `enrichDailyTask` | 对落在第 1 位的任务断言「X 是当前最需要优先处理的章节」。学生无练习记录时 `weakIds` 为空，位次完全来自**内容统计**（考频+重要度），却以学生事实的口吻陈述 | 有 `weakIds` 证据时引述学生自己的练习记录；否则明说"没有足够的作答证据指出优先原因；顺序按考频与重要度排出" | **仅 E2E** |
| 4 | `apps/api/src/study/practice-set-recommendation.adapter.ts` | 薄弱点为空时输出「当前薄弱点较少」——而空集既可能是"没有记录"也可能是"没有突出薄弱点"，前者使该句为假 | 改为陈述证据缺失 `当前证据不足：…` | **仅 E2E** |

**#3/#4 是本轮的实质发现**：把 E2E 从"不含裸码"加强为"不含任何非 evidenced 文案"并加上"无 evidenced 理由必须显示证据不足"的断言后，立刻暴露了两个源码审计漏掉的模板生产者。这正是 Phase 7 要求重走用户路径的价值。

### A.4 排序零变化

`reasons` 是输出字段，不参与 `score` 计算；`composeDailyPlan` 只用 `candidate.score`。`reasons` 在引擎输出中**仍包含全部真实触发的码**（含 inferred/contextual），只是"学生可读的 why"被收窄，**下游不丢信息**。18 字段 daily-plan parity 断言仍严格通过。

### A.5 有理由的既有断言更新（1 处）

`test/practice-set-adapter.test.js` 原断言 `withoutPoint.reason === '当前薄弱点较少，按今日计划和高频考点生成练习题组。'` —— 该字符串**正是被 A1 判定为不可接受的无证据断言**。已替换为更严的契约检查（必须以 `当前证据不足` 开头，且**不得**出现 `薄弱点较少`），不是放宽。

其余 2400+ 测试零改动；`test/score-center-priority.test.mjs` 与 `test/recommendation-daily-plan-parity.test.js` 的更新在 G1 阶段已完成。

---

## B. Fixture Fix

### B.1 原失败原因

```text
S2 Transfer Probe integration FAILED: student A must receive a delivered probe card
```

失败**只在本地 16:00 之后**出现。根因是夹具而非调度器：

- 夹具以 `completedAt = Date.now() - 40 * HOUR` 创建"已完成干预"；
- 调度器以 `probeDayKey(completedAt) + TRANSFER_PROBE_WINDOWS.targetDaysAfter(2)`（探针时区）推导投递日；
- 40 小时在**本地 16:00 之前**跨 2 个日历日、**16:00 之后**只跨 1 个：

```text
本地 15:29 → completedAt 日 = 今天−2 → 投递日 = 今天   → DUE      ✅
本地 16:29 → completedAt 日 = 今天−1 → 投递日 = 明天   → NOT DUE  ❌
```

**这是 TEST FIXTURE BUG，不是生产业务 bug。**

### B.2 修复方式（只动 fixture）

- 新增 `anchoredInterventionCompletedAt(daysBack, now)`：把 `completedAt` 钉在**探针时区（Asia/Shanghai）日历日 `今天−daysBack` 的 00:30**，与运行时刻无关。
- 于是投递日**恒为今天**，且已过时长恒 **≥ 47.5h**，必然通过 36h 守卫。
- 12 天前的过期场景走同一锚点（同类脆弱性一并消除）。
- 新增夹具自检：断言锚点既通过 36h 守卫、又在日历上稳定。
- 干预任务自身的 `scheduledDate` 列**对调度器是惰性的**（服务只读 `completedAt`，`transfer-probe.service.ts:285-289`），原为硬编码的陈旧日期 `2026-09-10`，现由锚点派生，避免夹具自述误导。
- **`now - 2 * HOUR` 那个用于验证 36h 守卫的干预保持原样**（它本就与时刻无关，且是真实验证）。

### B.3 未改动清单（严格边界）

```text
✗ 生产调度语义      未改
✗ 36h–96h 审计窗口   未改
✗ Transfer Probe business logic  未改
✗ eligibility       未放宽
✗ no_probe_available 未改
✗ 生产语义          未改
✗ 任何断言          未弱化
```

`git show --stat` 证明该提交**只含 1 个文件**（`scripts/integration-transfer-probe.mjs`）。

### B.4 归因证据（PRE-EXISTING 的证明）

在 G1 实现完成后、本任务修改前，已用 `git stash push -u` 清空全部改动并在**干净 HEAD `7832a5b`** 上重跑该套件 → **完全相同的失败**，随后 `git stash pop` 完整还原（26 modified + 16 untracked 计数一致）。因此该失败与本轮任何改动无关。

---

## C. Regression

### C.1 单元测试

```text
npm test → 2463 tests / 2461 pass / 0 fail / 2 skipped   exit 0
```

基线对照：G1 完成时 2453/2451/0/2；本任务 +10 项（A1 加固的四个必需用例 + 结构性守卫 + 夹具/生产者守卫）。**零回归。**

### C.2 集成套件（真实 HTTP + 真实 PostgreSQL，顺序执行）

| 套件 | 结果 | 证据 |
|---|---|---|
| `test:integration:guidance-protocol` | **PASSED (13 steps)** | exit 0 |
| `test:integration:score-anchor` | **ALL PASS** | exit 0 |
| `test:integration:score-improvement-loop` | **assertions passed** | exit 0 |
| `test:integration:effectiveness` | **ALL PASS** | exit 0 |
| `test:integration:event-key` | **assertions passed** | exit 0 |
| `test:integration:content-import` | **exit 0** | 顺序执行下不再复现此前并行时的环境性失败 |
| `test:integration:transfer-probe` | **ALL PASS (14 steps)** | exit 0（夹具修复后） |

### C.3 构建

```text
npm run build:shared    exit 0
npm run build:api       exit 0
npm run build:web       exit 0（✓ built）
```

### C.4 失败分类纪律

```text
NEW REGRESSION       0
PRE-EXISTING         1 → transfer-probe 时刻相关夹具（已在本任务修复）
ENVIRONMENT BLOCKER  0（content-import 的并行偶发在顺序执行下消失，已确认非代码缺陷）
FIXTURE-DATA GAP     0
```

### C.5 E2E 加强（Phase 7）

`reason-integrity` 步骤从"不含裸码/机器串"加强为：

```text
每个任务的 reason 串必须同时满足：
  ① 不含任何裸引擎码（/[A-Z]{3,}_[A-Z_]{3,}/）
  ② 不含 recommendation: 机器串
  ③ 不含任何非 evidenced 档的中文文案（近3年高频考点 / 考频上升 /
     前置知识未掌握 / 临近考试 / 考频证据不足）
  ④ 若该任务没有任何 evidenced code，则必须包含「当前证据不足」
```

实测输出：`3 task(s): no raw code, no machine token, no non-evidenced copy; 3 with no evidenced reason correctly say 证据不足`。③④ 就是发现生产者 #3/#4 的断言。

---

## D. Configuration

| 配置 | 值 | 验证方式 |
|---|---|---|
| `MASTERY_SEMANTICS` | **不在生产白名单**（C1 OFF） | `docker compose -p g1cfg -f compose.production.yml config` 渲染结果中**不存在**该变量；`.env.production.example` 中为注释 |
| `TRANSFER_PROBE_ENABLED`（生产） | **`"false"`** | 同一渲染结果输出 `TRANSFER_PROBE_ENABLED: "false"` |
| `TRANSFER_PROBE_ENABLED`（机制） | **保留**：仍是 compose 白名单里的单一开关；未设置/未知值仍被单点解析视为 OFF | `compose.production.yml:86` |
| 测试环境 | 显式开启（两个集成脚本为自己启动的 API 进程设置 `'true'`） | `integration-guidance-protocol.mjs`、`integration-transfer-probe.mjs` |
| `USE_KNODE_MASTERY` | 未设置（OFF，legacy 读路径） | 渲染结果中不存在 |

`docker compose -p g1cfg -f compose.production.yml config` → **exit 0**（YAML 合法）。

---

## E. Deployment Readiness

```text
G1 RELEASE READY
PRODUCTION DEPLOY = NOT APPROVED
```

**为什么 READY**：G1.1–G1.10 全部落地并验证；Reason Integrity 在全链（含 E2E 发现的两个模板生产者）收窄为 evidenced-only；生产配置经渲染验证 C1 OFF、Transfer Probe OFF；完整回归 + 7 个集成套件全绿、NEW REGRESSION = 0；worktree 干净。

**为什么 NOT APPROVED**：Owner 在本任务中明确 `NO PRODUCTION DEPLOY`，理由是生产 `transfer_probe_pool = 0`——G1 的 Transfer guidance 当前无法在生产开放真实 probe flow。**本任务未部署任何东西。**

---

## F. Remaining External Dependency

```text
transfer_probe_pool = 0
```

生产探针池为 **0 题**，因此：

- `TRANSFER_PROBE_ENABLED` 在生产保持 **false**（本次加固的核心决定）。
- 探针卡对生产学生**静默**；调度器即使被打开也只会诚实记录 `no_probe_available`，**绝不降级用旧题冒充迁移测试**（S2 §17）。
- E2E 已证明这一点：`featureEnabled=true` 时 `cards` 中 **0 张带会话** = 诚实缺席，不是错误。

**解除条件（外部依赖，非工程可自解）**：

```text
30 个高频节点 × 每节点 ≥2 道审定同构新题（isomorphism = verified）
（1 道 practice-bucket + 1 道 exam-bucket，I1–I5 全满足）
```

内容就绪后：把 `TRANSFER_PROBE_ENABLED` 置 `true`（单一开关）→ 需**独立 Owner 批准**再部署。

其余 G1 能力（reason integrity / today mission / HOW / verification / NEXT / guardrails / examDate / telemetry）**不依赖该外部依赖**，可独立发布。

---

## G. Commits（本任务）

| # | Commit | 内容 |
|---|---|---|
| A1 | **`29e92b52`** | `feat(g1): restrict the student-facing why to evidenced reasons`（18 文件） |
| B | **`5bb88485`** | `chore(config): keep the production transfer probe off until the pool exists`（3 文件） |
| C | **`3004e944`** | `test(s2): stabilize the transfer-probe date fixture`（**仅 1 文件**） |

三者**逻辑独立**：fixture 修复没有混进 G1 feature commit（`git show --name-only 29e92b52` 中 `integration-transfer-probe` 出现次数 = **0**）。

> 过程记录（诚实留痕）：第一次 `git commit --amend` 误改了 HEAD（fixture 提交）而非目标提交，导致三者短暂混合。已用 `git reset --mixed 46a04fe4` 把全部改动退回工作区后按正确文件集重建三个提交，并用 `git show --stat` 逐条核验文件归属。当前历史正确。

---

## H. Push（Phase 9）

前置条件全部满足：完整回归 PASS、NEW REGRESSION = 0、worktree 干净（仅未跟踪的工具目录 `.zcode/`）。

推送对象与结果记录在 `docs/current-sprint.md` 的账本条目中（local HEAD == origin HEAD）。

---

## I. 最终停止声明

```text
G1 Release Hardening = COMPLETE
```

**未做**：未部署生产；未开始 G2；未开始 S3；未启用 C1；未启用生产 Transfer Probe；未修改 ROI；未修改 Mastery；未修改 Score Engine；未新增功能（仅修复发布前缺陷）。

G1 改变的是**学生学习引导**；它不证明分数提升，也不实现 ROI 排序。
