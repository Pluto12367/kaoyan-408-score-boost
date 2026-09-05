# V3.5 Release Readiness Report — Worktree Ownership Audit & Release Baseline

> 日期：2026-09-06。HEAD `893a433`（v3.4）。分支 `feature/v3-product-refactor`。
> 任务：不开发新功能；将 v3.4 从"技术完成"推进到"可发布基线"——checkpoint 回溯验证、164 文件归属审计、Real Provider 状态确认、发布状态判定。

## 1. Checkpoint 验证 ✅

| Tag/Commit | 可回溯 | 内容 |
|---|---|---|
| `v3.0-student-context` → `4f58fe3` | ✅ | StudentContext 主线基线 |
| `v3.2-ai-agent-production` → `ce0d949` | ✅ | AI-0…AI-12 |
| `v3.3-ai-learning-companion` → `b3ca19c` | ✅ | PX-1…PX-5 |
| `893a433`（v3.4，未打 tag） | ✅ | Production Validation & Closed-Loop |

工作树 163 个脏文件（`.worktrees/` 已被 gitignore 排除）。

## 2. AI Credentials 状态

| 项 | 状态 |
|---|---|
| `AI_API_KEY`（`.env.development`，35 字符） | 认证有效，**402 Insufficient Balance**（497ms 实测） |
| `EMBEDDING_API_KEY` | **不存在**；且 DeepSeek 官方 API 无 `/embeddings` 端点（provider 硬限制） |

**Real Provider PASS：BLOCKED（billing + embedding provider）。** 解除前所有 Real Provider 层验证维持 v3.4 的 BLOCKED 结论（`docs/v34-remote-llm-blocker.md`、`docs/v34-remote-embedding-blocker.md`），无伪造。

## 3. Worktree Ownership Matrix（163 文件全量归属）

### W1 — Learning Intelligence / Action Spine（前序工作线，体量最大，**含闭包缺口**）

| 类别 | 文件 | 状态 |
|---|---|---|
| 未跟踪后端（22） | `action-*.ts`(7)、`canonical-event-writer.service.ts`、`generation-key.ts`、`learning-session-action.service.ts`、`practice-action-attribution.ts`、`recommendation-action*.ts`(4)、`review-action-attribution.ts`、`student-state-feedback*.ts`(2)、**`student-context.contract/query.service/selector.ts`、`study-plan.repository.ts`** | **completed（功能绿）** |
| 修改后端（14） | `learning-loop-trigger.service.ts`、`recommendation.service.ts`(+158)、`study.service.ts`(+171)、`study.controller.ts`(+95)、`user-event.repository.ts`、wrong-question 系(3)、mastery-summary-projection、practice-record.repository、practice-set-recommendation.adapter、student-state-query、learning-session.repository | completed（多数为接线） |
| Schema/Migration（4） | `prisma/schema.prisma`（RecommendationAction 模型 + UserEvent.eventKey + generationKey 字段）+ 3 个未跟踪 migrations（event_key/generation_key/action_spine） | completed，**必须与 W1 后端同批提交** |
| shared（3+1 未跟踪） | `domain.ts`、`index.ts`、`nodeMastery.ts` + `packages/shared/src` 未跟踪 1 | completed |
| 测试（约 28 未跟踪 + 2 修改） | action-*(10)、canonical-event-boundary、student-context-*(7)、plan-generated、generation-key、learning-intelligence-*(3)、recommendation-*(3)、study-plan-*(4) 等 | **多数绿**；`student-action-ui`(12 失败)、`student-context-freshness`(4 失败) 为该线未完成 UI 契约 |
| 文档（约 30） | `docs/student-context-*`(17)、`docs/event-contract.md`、`docs/learning-intelligence-*`(5)、`docs/product/*`(4)、`docs/superpowers/*`(4)、`docs/recommendation-consistency-audit.md`、`docs/autonomous-development-state.md`、`docs/learning-event-state-transition-matrix.md` | completed（文档） |
| 前端钩子/适配器 | `useStudentContextData.ts`、`studentHomeContextAdapter.ts` | completed |

**⚠️ 关键发现（R1，高风险）**：`student-context.query.service.ts` / `student-context.contract.ts` / `student-context.selector.ts` / `study-plan.repository.ts` / `recommendation-action*.ts` / `action-*.ts` 均**不在 HEAD**，而已提交的 `apps/api/src/agent/`、`apps/api/src/study/study.module.ts` 直接 import 它们 → **独立 checkout `893a433`（及 ce0d949/b3ca19c）无法通过 `build:api`**。checkpoint 的历史锚点有效，但源闭包不完整。修复方式见 §4 提交边界 B1。

### W2 — Review Center / Knowledge Galaxy / Mistakes 前端线

| 类别 | 文件 | 状态 |
|---|---|---|
| 未跟踪（9） | `KnowledgeGalaxy.tsx`+css、`RecentMistakes/ReviewHero/WeakKnowledgeList.tsx`、`review-center.css`、`reviewCenterViewModel.ts`、`docs/qa/`、docs 前端审计 | completed（配套测试 `knowledge-galaxy-ui`、`review-center-ui`、`knowledge-identity-*` 全绿） |
| 修改（4） | `KnowledgeCatalog.tsx`、`MistakeWorkspace.tsx`、`PriorityReviewCard.tsx`、`ReviewQueue.tsx` | completed（同上） |

### W3 — 前端主题优化线（**保护清单：禁止提交**）

| 文件 | 状态 |
|---|---|
| `ExamSession.tsx`、`PracticePanel.tsx`、`styles.css`、`theme-optimizations.css`、`theme/themePreference.ts`、`test/mobile-nav-ui.test.js`(M)、`test/theme-preference.test.js`(M) | 归属项目所有者，**本线内 complete 但提交需所有者授权**；v3.4 失败基线不含其测试 |

### W4 — Student Home/Report/Dashboard 前端线

| 类别 | 文件 | 状态 |
|---|---|---|
| 修改（13） | `App.tsx`、`dashboard.ts/types.ts`、`StudentHome*`(4)、`ReportSummaryPanel/ReportWorkspace`、`StudentSections.tsx`、`TestSection.tsx`、`student/report/`(未跟踪) | **incomplete**：`goal-progress-insight-ui`、`student-learning-console-ui`、`today-score-center-ui` 3 个测试失败（v3.4 基线内） |
| 测试 | `report-workspace-context-adapter.test.js`(未跟踪，绿)、`node-mastery-map.test.js`(M) | — |

### W5 — Score Center 在途线

| 文件 | 状态 |
|---|---|
| `score-center/repository.ts / service.ts / score-center.module.ts`（3 修改） | **incomplete（归属所有者）**：修改内容未审计，且 W1 的 `RecommendationService` 依赖其 repository 导出——提交顺序需在 B1 之后单独评审 |

### W6 — 文档 / 流程杂项（低风险）

| 文件 | 状态 |
|---|---|
| `AGENTS.md`(+4：新增 §10 状态入口条款)、`package.json`(+1)、`docs/frontend-refactor-audit.md`、`docs/qa/*` | completed，可随任一边界提交 |
| `test/study-agent.test.js`(M) | **我方 PX-5 漏提交项**：exports 断言更新（`893a433` 内为旧断言，fresh checkout 该测试会 FAIL）——随 B3 修复提交 |

## 4. 建议 Commit Boundary（按依赖序；**执行需用户逐条批准**）

| 边界 | 内容 | 理由 | 修复 |
|---|---|---|---|
| **B1** | W1 后端 22 未跟踪 + 14 修改 + schema/migrations(4) + shared(4) + W1 测试 28 未跟踪/2 修改 + W1 文档 | **修复 R1 源闭包缺口**——使 HEAD 后继可构建；不可与前端拆开（同一功能闭包） | 提交后 12+4 个 UI 失败测试仍在（属该线未完成 UI 契约，如实保留） |
| **B2** | W2 全部（9 未跟踪 + 4 修改 + 5 测试） | Review Center/Galaxy 独立前端功能，测试全绿 | — |
| **B3** | W4 + `test/study-agent.test.js` | 前端 Home/Report 线；**注意含 3 个失败测试**——建议先修复或所有者确认后提交 | incomplete→需一次收口 |
| **B4** | W5（所有者评审后） | 未审计修改 | — |
| **B5** | W3（所有者授权后） | 保护清单 | — |
| **B6** | W6 文档杂项 | 随时可提交 | — |

B1 已执行（commit `8aa1a84` + B1.2 补充 `3a1fbc9`，tag `v3.4.1-closure` 已创建）——**v3.2+ 全链 fresh checkout 可构建已实证**。B1.2 细节与剩余 6 个回归失败的分类见 `docs/v34-closure-verification-report.md`。剩余边界：B2（Review Center/Galaxy，绿）→ B3（Student Home/Report，含 3 失败测试需收口）→ B4（Score Center 剩余 2 文件）→ B5（主题，所有者授权）→ B6（文档杂项）。

## 5. Tests / Build 现状

- 全量 `npm test`：**1721 / 1694 / 25 fail**（25 失败全部为 W1 UI 契约 16 + W4 前端 3 + 前序遗留 6，非 AI 域）。
- AI 域 240/240；`build:shared`/`build:api`/`build:web` 全 PASS（工作树态）。
- **fresh-checkout HEAD 构建态：B1.2 后 ✅ PASS**（v3412-verify worktree 实证：shared/api/web 全绿；3a1fbc9 检出）。

## 6. Release 状态判定

```
[v3.4] 可回溯 ............ ✅（tag/commit 完整；但源闭包缺口见 R1）
[worktree] 归属审计 ...... ✅（本报告 §3，6 条工作线全分类）
[AI] Real Provider ....... ❌ BLOCKED（402 billing + embedding provider 缺失；无伪造）
[tests] .................. ✅ PASS/BLOCKED 边界明确（25 失败全部定位到工作线）
[build]（工作树）......... ✅ PASS
[build]（fresh HEAD）.... ❌ 依赖 B1
[release] ............... **BLOCKED**：B1 闭包提交（硬前置）→ Real Provider 解除（v3.5）
```

## 7. V3.5 路径建议

1. **立即**：批准 B1 提交边界 → 修复源闭包 → `v3.4.1-closure` tag → fresh-checkout 构建验证。
2. **随后**：B2/B3/B4/B5/B6 逐边界清理（每条需所有者批准），工作树归零。
3. **凭证**：DeepSeek 充值 + embeddings provider 配置 → 按 v3.4 blocker 清单执行 Real Provider 验证（`Contract/Integration PASS` → `Real Provider PASS`）。
4. **然后**：v3.5 Production Release（部署/监控/Release Gate 全绿）→ V4 Product Intelligence。
