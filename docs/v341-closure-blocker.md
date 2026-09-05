# v3.4.1-closure B1 Verification Blocker — B1 Cannot Close Within Its Current Boundary

> 日期：2026-09-06。状态：**B1 commit `8aa1a84` 已落地但构建断裂；tag `v3.4.1-closure` 未打**。
> 按指令"如果 B1 无法在当前边界内闭合：停止并输出明确 blocker"执行本文件。

## 1. Source Closure Problem（复述）

v3.2+ checkpoint（ce0d949/b3ca19c/893a433）缺少 W1 工作线后端源文件（student-context.*、action-*、study-plan.repository 等 22 个未跟踪文件），导致 fresh checkout 无法构建。B1 = 提交这 111 个文件（已执行，commit `8aa1a84`）。

## 2. Root Cause（fresh worktree 验证发现）

B1 提交的文件与**另外两条工作线的未提交修改互为依赖**，B1 边界无法单方面闭合：

| 断裂 | B1 侧（已提交） | 依赖的未提交修改（未入库） | 差异性质 |
|---|---|---|---|
| `build:api` 1 error | `study.service.ts:2286` 以 **4 参**调用 `applyReview(..., tx)` | `score-center/service.ts`（W5）+13/-4：`applyReview` 增 `transaction` 参数 + `toRecommendationTaskCompat`（B1 未跟踪文件的消费端） | **B1 配套修改**：applyReview 事务化是 Learning Loop 复审链（D4-B 系列 fixture 验证过）的一部分 |
| `build:web` 1+ error | `dashboard.ts` import `StudentContext` 类型 | `apps/web/src/api/endpoints/dashboard.ts`（W4）+14/-3：`fetchStudentContext` + 类型引用；`apps/web/src/api/types.ts`（W4）+3：`StudentContext` 类型导出 | **StudentContext 主线前端消费端** |

新鲜 worktree（`8aa1a84` 精确检出 + junction node_modules）实测：`build:shared` PASS、`build:api` **FAIL（1 error）**、`build:web` **FAIL**。主工作树构建 PASS 的原因是 W5/W4 的未提交修改在工作树中补齐了这两处——**历史提交即"半提交"状态，非本轮引入**。

## 3. 最小修复面（已在验证 worktree 中实证可闭合）

仅补 3 个配套文件（不扩入任何其他 W4/W5 内容）后，fresh worktree：

- `build:shared` PASS（8aa1a84 即 PASS）
- `build:api` **PASS**（0 error）
- `build:web` 完整构建 **PASS**（tsc 0 error + vite ✓ 9.44s）
- 核心回归：worktree 内 21 个测试文件 187 项 → 180 PASS / 7 FAIL，7 个 FAIL 全部归因于 worktree 缺 W4 前端文件（`useStudentContextData.ts` 等 B3 内容）与 `study-agent.test.js` 的 M 断言（见 §4）——主工作树同测试全绿。

## 4. 建议解法 B1.2（待批准，未执行）

**B1.2 = B1 + 3 个配套文件**：`apps/api/src/score-center/service.ts`、`apps/web/src/api/endpoints/dashboard.ts`、`apps/web/src/api/types.ts`。三个文件的未提交 diff 共 +31/-7，**内容全部为 B1 配套**（applyReview 事务化 + StudentContext 前端消费端），无其他工作线内容混入。批准后：提交 B1.2 → 在现有验证 worktree 复核三端构建 + 187 项核心回归（预期 ≤7 FAIL 且全部归因 B3 前端缺件）→ 打 `v3.4.1-closure` → 生成验证报告。

替代解法（不推荐）：从 B1 撤出 `study.service.ts/study.controller.ts/nodeMastery.ts` 等与 W4/W5 耦合文件回退 HEAD 版——级联分析复杂（W1 功能完整性破坏，learning-loop 事务化回退），且 `8aa1a84` 已存在需额外重写历史。

## 5. 当前状态

- commit `8aa1a84`（B1）保留（禁止 reset；blocker 与解法已记录）。
- tag `v3.4.1-closure` **未创建**（构建断裂的 commit 不打 release tag）。
- 验证 worktree 保留于 `C:\Users\Lenovo\AppData\Local\Temp\v341-verify`（含 +3 验证副本），B1.2 批准后直接复用复验。
- `test/study-agent.test.js`（M，exports 断言 PX-5 漏提交）已识别，随 B1.2 一并提交。
