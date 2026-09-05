# v3.4.1 Closure Verification Report

> 日期：2026-09-06。tag `v3.4.1-closure` → `3a1fbc9`。前序：B1 `8aa1a84`、blocker `d585fd8`、B1.2 `3a1fbc9`。
> 本报告 = B1/B1.2 的 closure 验证记录（10 节，按任务要求）。

## 1. Root Cause

v3.2+ 的三个 checkpoint（ce0d949/b3ca19c/893a433）是在**半提交工作树**上打的：W1（Learning Intelligence / Action Spine / StudentContext 主线）的 22 个后端源文件从未入库，而已提交的 agent 模块与 study.module 直接 import 它们 → fresh checkout 无法构建。B1 提交这 111 个文件后，fresh worktree 验证暴露出第二层：B1 的 `study.service.ts` 以 4 参调用 `applyReview`（含事务参数），而该签名只存在于 W5 未提交的 `score-center/service.ts`；同时 W4 未提交的 `dashboard.ts`/`types.ts` 是 B1 已提交 `nodeMastery.ts`/StudentContext 契约的前端消费端。

## 2. B1 Source Closure Gap

见 `docs/v341-closure-blocker.md` §1-2 与 `docs/v35-release-readiness-report.md` §3 W1/R1。

## 3. B1.2 Three-File Supplement（已批准并执行）

| 文件 | diff | 内容 | 归属核验 |
|---|---|---|---|
| `apps/api/src/score-center/service.ts` | +13/-4 | applyReview 增可选 `transaction` 参数（事务化重构）+ `toRecommendationTaskCompat`（B1 文件）消费端 + actionId 兼容字段 | 逐行审查：全部为 B1 配套（Learning Loop 复审事务化 + Action 兼容），无他线内容 |
| `apps/web/src/api/endpoints/dashboard.ts` | +14/-3 | `fetchStudentContext` 消费端 + `toLegacyMasteryMap`（B1 已提交 nodeMastery.ts 的新导出）适配 | 逐行审查：全部为 StudentContext 主线前端消费端 |
| `apps/web/src/api/types.ts` | +74 | `StudentContext` 类型镜像 + `PracticeSet/WrongQuestion.knowledgeNodeIds` 契约字段（各 2 行） | 逐行审查：全部为 StudentContext 契约镜像 |
| `test/study-agent.test.js` | 1 行 | exports 断言与已提交 agent.module.ts（PX-5 五服务）对齐 | 修复 fresh-checkout 必失败项 |

（路径勘误：任务书写的 `apps/api/src/study/score-center/service.ts`、`apps/web/src/api/dashboard.ts` 实际分别为 `apps/api/src/score-center/service.ts`、`apps/web/src/api/endpoints/dashboard.ts`，已按实际文件执行。）

## 4. Exact Changed Files

B1 `8aa1a84`：111 文件（22 后端新增 + 14 后端修改 + schema + 3 migrations + shared 4 + 测试 31 + 文档 30）。B1.2 `3a1fbc9`：4 文件（+106/-8）。Blocker docs：`d585fd8`。合计 v3.4.1-closure 相对 v3.3 新增 115 文件 / +13050 行左右。

## 5. Fresh Checkout Evidence

验证方式：`git worktree add` 两个独立检出（复用主仓库 node_modules 的 junction，标准依赖不重装）：

| 检出 | commit | build:shared | build:api | build:web |
|---|---|---|---|---|
| v341-verify（B1，修复前） | `8aa1a84` | PASS | **FAIL 1 error**（4 参调用） | FAIL（类型缺字段） |
| v3412-verify（B1.2，修复后） | `3a1fbc9` | **PASS** | **PASS** | **PASS**（tsc 0 error + vite ✓ 12.44s） |

补充实证：主仓库 `nest build`/`build:web` 在 B1.2 提交后复跑同样 PASS。

## 6. Tests

- B1 定向回归（32 文件）：**207/207**（提交前）。
- B1.2 fresh worktree 核心回归（46 文件）：354 项 / 348 pass / 6 fail。
  - 6 个失败分类（无一代码缺陷）：**5 个** = `useStudentContextData.ts` ENOENT（W4 前端未跟踪文件，属 B3 边界，验证 worktree 无该文件）；**1 个** = `recommendation-consumer-verification` 需 `DATABASE_URL`（带库复跑 **5/5 PASS**，主工作树同 PASS）。
  - 基线对照：主工作树同测试集全 PASS。新增代码缺陷失败数 = **0**。

## 7. Build

主工作树：shared ✅ / api ✅ / web ✅（vite ✓ 18.64s）。Fresh worktree（3a1fbc9）：shared ✅ / api ✅ / web ✅（✓ 12.44s）。

## 8. Tag

`v3.4.1-closure` → `3a1fbc9`。在 fresh checkout 三端构建 PASS 且核心回归分类完成之后创建。**不含**构建断裂的 `8aa1a84` 单独状态。

## 9. Remaining Worktree（B1.2 后）

- **W2**（Review Center/Galaxy 前端 13 文件，测试绿）→ B2 待批准。
- **W3**（主题保护清单 7 文件）→ 所有者授权（B5）。
- **W4**（Student Home/Report 前端 13 文件 + `useStudentContextData.ts` 等，3 个失败测试）→ B3 待收口（**fresh checkout 的 6 个回归失败在其入库后消除**）。
- **W5**（score-center 剩余 `repository.ts`/`module.ts` 2 文件）→ B4 所有者评审（service.ts 已随 B1.2 入库）。
- **W6**（`AGENTS.md`+4、`package.json`+1、`docs/frontend-refactor-audit.md`、`docs/qa/`）→ B6。
- scripts/v34-*.mjs 五个验证脚本已随 v3.4 提交（893a433）。

## 10. Real AI Credential Blocker（不变）

- `AI_API_KEY`：认证真实（402 Insufficient Balance，497ms 实测）——充值后重跑 `scripts/v34-remote-llm-smoke.mjs`。
- `EMBEDDING_API_KEY`：不存在 + DeepSeek 无 embeddings 端点——需引入 embeddings provider。
- Release Gate 维持 **RELEASE BLOCKED BY CREDENTIALS**，详见 `docs/v34-ai-release-gate.md`。
