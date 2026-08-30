# 408 提分系统 V3 — Sprint 3 交接文档（2026-08-30）

> 交接范围：V3 产品重构 Sprint 0-3.4 全部成果。
> 交接基线：分支 `feature/v3-product-refactor`，HEAD = `09ab2f4`（未推送）。
> 本文档以代码为唯一事实来源；与旧文档冲突时以本文档 + 代码为准。

---

## 1. 项目一句话

面向计算机考研 408 的 AI 驱动学习闭环系统（非题库网站）：诊断 → 计划 → 训练 → 错题恢复 → 掌握度更新 → 推荐 → 测验 → 报告全闭环；同时作为 AI 全栈工程师求职核心展示项目。

## 2. 仓库结构与技术栈

```
monorepo（npm workspaces，root package.json "type":"module"）
├── apps/web        React 18.3 + Vite 5（ESM，无路由库——hash section 切换，无状态库）
├── apps/api        NestJS 10（CJS）+ 自研 HMAC-SHA256 JWT + scrypt
├── packages/shared 前后端共享域逻辑（判题/EWMA 掌握度/优先级/推荐引擎）
├── prisma          PostgreSQL 16 + Prisma 5.18（45 model / 34 migration）
├── test/           node:test（1038 项）
├── scripts/        集成测试（integration-postgres.mjs 等）+ verify-* 冒烟
└── docs/           本文档所在；权威计划见 v3-*.md 三件套
```

## 3. 核心架构（V3 目标态，已基本落地）

```
答题（Idempotency-Key 收据事务）
  → PracticeRecord（行为事实 SoT）
  → MasteryEngine（shared/score-center/mastery.ts，EWMA α=0.18/0.07 + OCC version 重试）
  → UserKnowledgeMastery（掌握度 SoT）+ UserMasterySnapshot（每日趋势）
  → 错题联动（WrongQuestionReview + ReviewSchedule/ReviewAttempt）
  → StudyTaskProgress 累计 → 达标自动 completeStudyTask
  → [Sprint 3.4 已完成] RecommendationService 生成次日 StudyPlan(source='score-center') + plan.generated 事件

读路径（CQRS）：Projection → Snapshot → Selector → Adapter → QueryService → Controller
推荐引擎（Sprint 3.1 冻结契约）：runRecommendation(input) → {KNOWLEDGE|REVIEW|QUESTION_SET|TASK_DRAFT}
```

## 4. 关键文件地图（接管必读）

| 文件 | 职责 |
|---|---|
| `packages/shared/src/score-center/recommendation.ts` | **推荐引擎 v1（3.1 冻结）**：runRecommendation 纯函数 |
| `packages/shared/src/score-center/priority.ts` / `plan.ts` | 六维优先级 + composeDailyPlan（预算/科目配额/前置替换/LEARN 上限）；plan.ts 已注入确定性时钟 `now` |
| `apps/api/src/study/recommendation.service.ts` | **RecommendationService**：SoT 组装 → 引擎 → StudyPlan 持久化；`runRecommendationForUser`（3.3/3.4 复用入口，返回 result/nodeById/accuracyRateByNode/overallAccuracyRate） |
| `apps/api/src/study/study.service.ts` | ~5100 行单体（写路径+遗留读）；推荐两方法已拆 Legacy/FromState 双分支 |
| `apps/api/src/study/practice-set-recommendation.adapter.ts` / `review-resources-recommendation.adapter.ts` | 3.3 纯函数 adapter（文案/桥接，无算法） |
| `apps/api/src/score-center/service.ts` | applyAttempts/applyReview（掌握度唯一写入方）；generateDailyPlan 已委托 RecommendationService |
| `docs/sprint3-recommendation-contract.md` | **引擎契约（冻结）**：ID 规范/确定性/输入输出/reasonCode 清单/§10 修订记录 |
| `apps/api/src/study/study.service.ts` `applyPracticeProgressToTasks`（~:1250） | 3.4 闭环接线点：答题→进度→达标自动完成 |

## 5. V3 迁移状态

| 阶段 | 状态 | commit |
|---|---|---|
| Sprint 0 基线冻结 / Sprint 1 导航 8→5 + StudentHome/TestSection 接线 | ✅ | ed9f80e…180cc8b |
| Phase R（修复收口：重建被测试毁坏的投影、DI 修复、契约恢复） | ✅ | 60d5cb3…e62b304 |
| Sprint 2 Student State 统一消费（mastery-map 前端切换 / trial-progress / reminders / sprint-plan 全部 Adapter→SoT；R1 streak 修复） | ✅ | 69cc57f…f95601d |
| Sprint 3.0 契约冻结 | ✅ | docs/sprint3-recommendation-contract.md |
| Sprint 3.1 引擎 Core（+确定性修复+12 契约测试） | ✅ | 25b205e |
| Sprint 3.2 Daily Plan 接入（generateDailyPlan 委托引擎，parity 18 字段） | ✅ | 3528d75 |
| Sprint 3.3 Legacy 推荐迁移（practice-sets/review-resources → 引擎+adapter） | ✅ | 8512895 |
| **Sprint 3.4 Learning Loop Integration** | ✅ 已完成 | `09ab2f4` |
| Sprint 4 Contextual AI Coach（ContextualCoach 嵌四页） | ❌ 未开始 | — |

仍委托 legacy 的 compat 端点（@Optional 委托模式，等投影 parity）：`/dashboard/overview`、`/mastery-map`（后端；前端已不调用）、`/assessments/stage`、`/today/plan`。`/trial-progress` 已回切引擎链（f95601d）。

## 6. ⚠️ 工作区在途文件（接管者禁止触碰/提交）

```
 M apps/web/src/components/ExamSession.tsx
 M apps/web/src/features/practice/PracticePanel.tsx
 M apps/web/src/styles.css
 M apps/web/src/theme-optimizations.css
 M apps/web/src/theme/themePreference.ts
 M test/mobile-nav-ui.test.js
 M test/theme-preference.test.js
```
= 项目所有者的**前端主题优化在途工作**（默认主题改 A 深色等）。与 Sprint 3.4 后端提交无冲突；本次 closeout 仅更新状态文档，文档仍未提交。

## 7. Sprint 3.4 目标与已完成事实

**目标**：`submitPracticeSession → Student State 更新 → 任务完成检测 → RecommendationService 生成次日计划 → plan.generated 事件` 闭环（v3-plan §5.3）。

已探查（只读）确认的接线点与现状：
- `applyPracticeProgressToTasks(userId, record)`（study.service.ts ~:1250）已存在：单题/会话提交后逐题累计 `StudyTaskProgress`（原子 increment），达标自动 `completeStudyTask`（失败仅 warn）。
- PracticeRecord **不携带 taskId**（代码注释自认），归因靠"当日任务+knowledgePointId+任务状态"启发式——精确归因是已知延后债务。
- 事件基础设施 `trackUserEvent` 已有：practice.submit / session.submit / task.complete / wrong.review / assessment.import（UserEvent.type 为自由字符串）。
- Sprint 3.4 已完成：当日任务完成与 `stage_assessment` session 完成在事务提交后触发 Learning Loop；`RecommendationService.generateDailyPlanFromState` 支持注入 `scheduledDate`；生成 `plan.generated` 事件并按 `learning-loop:{userId}:{scheduledDate}` 幂等；AnswerReceipt replay 不重复触发；失败仅记录 warning，不影响主事务。
- 依赖方向：`StudyService → RecommendationService`（构造器末尾 @Optional 注入已就位）；**禁止反向**。

验收记录：`learning-loop-trigger.test.js` 8/8、task progress 12/12、AnswerReceipt 13/13、recommendation parity 3/3，`npm run build:api` 通过。`npm test` 在 Node test worker 启动阶段统一失败 `spawn EPERM`，未修改测试，判定为本机环境问题。

Sprint 3.4 Technical Debt：多实例下 UserEvent triggerKey 查询、计划创建与 `plan.generated` 写入不是数据库原子操作，理论上可能重复生成同一日期计划；本阶段只登记，不在 Sprint 3.4 范围内修复。

## 8. 硬规则（违反即返工）

1. **AGENTS.md 全部条款**（事实来源=代码；小步修改；禁止静默 mock 回退；DB 变更先说明；不自动 commit/push——每轮用户确认后才提交）。
2. **引擎冻结**：`packages/shared/src/score-center/*`（3.1 提交后）只允许契约 §10 式向后兼容增量；修改前核对 `docs/sprint3-recommendation-contract.md`。
3. **ID 契约**：引擎与 V3 链路唯一 ID = `knowledgeNodeId`；`knowledgePointId` 禁入引擎。注意历史怪癖：`/practice-sets/recommended` 的 `knowledgePointIds` 字段**承载 nodeId**（节点口径，题目匹配走 `nodeQuestionIdsByNode` 节点标签，KP includes 仅内容耗尽 fallback）——集成脚本 :2653 断言钉死此行为。
4. **legacy 保留**：所有迁移保留 legacy 私有实现作为 `!DATABASE_URL` 内存演示回退 + @Optional 缺省守卫，禁止删除（Sprint 2 稳定后才进入废弃清单）。
5. **API/DTO/前端零变更**：3.x 各阶段 Controller、DTO 形状、前端一律不动（迁移模式 = Legacy API → Adapter → 引擎 → SoT）。
6. **验证门禁**：每阶段完成必须 `npm test`（当前基线 1038 项 / 1037 过 / 0 失败 / 1 跳过）+ `build:api`；触碰 Prisma 相关再跑 `npm run test:integration:postgres`（需 Docker Desktop；测试库 `compose.test.yml` 端口 55432，**用 127.0.0.1 不用 localhost**——Windows IPv6 解析坑）。
7. **测试纪律**：禁止改断言凑绿；沙箱测试 loader 一律用 CommonJS Function 沙箱（参照 `test/stage-assessment-projection.test.js`），**绝不写回源文件路径**（历史事故：写回式 loader 曾毁掉 today-plan-projection.service.ts 全部类型）。

## 9. 已知债务 / 风险（按优先级）

- **P1**：会话/阶段/考试提交无幂等收据（仅单题端点有 AnswerReceipt）；前端幂等键按调用生成，页面刷新重交不受保护。
- **P1**：StudyService 内存镜像（this.records 等）与 DB 双读并存——多实例会分歧（当前单实例部署）。
- **P2**：`USE_KNODE_MASTERY` 灰度开关默认 off（服务器部署时开启后才算掌握度口径正式统一）。
- **P2**：前端 mock 未删（`mockData.ts`/`api/mocks/dashboard.ts`）——删除前需决策 GitHub Pages 静态演示去留（deploy-pages CI 依赖 mock）。
- **P2**：`/trial-progress` `/study-reminders` `/sprint-plan` 端点保留（前端已不直接依赖后已切 Student State 的语义，正式废弃待前端清理）。
- **P3**：Dashboard/StageAssessment/TodayPlan 投影 parity 缺口 = QuestionCatalogQueryService 未建（前人 phase 文档已登记）；`bridgeKnowledgePointIds` 与 `getKpIdsByNodeId` 目前无服务侧消费者（契约工具保留）。
- **P3**：错题重做 4 段非原子事务；每次答错重置 nextReviewAt 到明天的语义待产品确认。

## 10. 验证命令速查

```bash
npm test                      # 全量（先 build:shared 再 node --test）
npm run build:shared && npm run build:api && npm run build:web
npm run db:test:up && npm run test:integration:postgres && npm run db:test:down
node --test test/<file>       # 单套件
# 无 DB 冒烟：node apps/api/dist/main.js（内存模式，/health 200 + dataSource=memory-api）
```

## 11. 文档地图

| 文档 | 内容 |
|---|---|
| `AGENTS.md` | 代理硬规则（先读） |
| `docs/sprint3-recommendation-contract.md` | 引擎契约（冻结） |
| `docs/v3-product-refactor-plan.md` / `v3-migration-map.md` / `v3-acceptance.md` | V3 三件套（计划/映射/验收 52 项） |
| `docs/handoff/`（phase-status / architecture-state / decisions / known-risks） | CQRS 读迁移交接（部分描述已滞后，冲突以代码为准） |
| `docs/DEVELOPMENT_LOG.md` | 开发日志（Phase R 条目；3.1-3.3 未记，接手后可补） |
| `docs/project-learning/07-V3-Sprint-2-*.md` | Sprint 2 架构分析 |

## 12. 接管建议的第一步

1. 读 AGENTS.md → 本文档 → `git log --oneline -20` 对照第 5 节。
2. 跑一遍 `npm test` + `build:api` 确认基线（1038/1037/0/1）。
3. Sprint 3.4 已完成；先阅读 commit `09ab2f4` 与本节技术债务，不要重复实现 Learning Loop。
4. 等待项目所有者确认状态文档提交后再开始下一阶段；Sprint 3.5 不自动开始，不 push。

## 13. Sprint 3.5.4 Stabilization 最新状态

当前 HEAD：`1287007`（`feat(ai): integrate contextual coach across learning scenarios`）。

Sprint 3.5.3 Contextual AI Coach 已完成并提交，包含：

- `ContextualCoachContextAssembler`、`ContextualCoachService` 和 `/ai/contextual-coach`。
- `question`、`wrong_question`、`knowledge_node`、`assessment` 四类上下文。
- 前端统一 `ContextualCoach` 组件及四个业务场景接入。
- 旧 `/ai/tutor-reply`、`/ai/follow-up` 和 `TutorPanel` 保持兼容。

Sprint 3.5.4 稳定性验证结果：

- `contextual-coach-integration.test.js`：6/6 通过。
- `contextual-coach-context.test.js`：5/5 通过。
- `contextual-coach-api.test.js`：5/5 通过。
- `contextual-coach-ui.test.js`：4/4 通过。
- `npm run build:api`：通过。
- `npm run build:web`：TypeScript 检查通过；Vite/esbuild 阶段因本机 `spawn EPERM` 失败，未修改 vite/esbuild 配置。
- `git diff --check`：通过。

本轮新增稳定性测试：`test/contextual-coach-integration.test.js`。测试通过实际 Controller → ContextualCoachService → ContextualCoachContextAssembler → AiTutorService 链路验证认证用户、四类上下文、assessment fallback、无记录状态和模板 fallback；未涉及 StudyPlan、StudyTask、mastery 或 ReviewSchedule 写入。

架构结论：Contextual Coach 仍是只读解释层，不调用 RecommendationService，不修改 Student State；旧 AI Tutor API 保持可用。

当前 Sprint：Sprint 3.5.4 Stabilization 已完成，文档提交待确认。Sprint 3.6 尚未开始。

已知风险：`build:web` 的 Windows Node/esbuild `spawn EPERM` 环境问题；AI 真实 Key 路径尚未在本地稳定性测试中覆盖。Sprint 3.4 的多实例 Learning Loop 幂等技术债务继续保留，不在本阶段修复。
