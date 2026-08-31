# Current Sprint

> 本文件是所有 Agent 接管项目的**唯一常青状态入口**。开工先读本文件 + AGENTS.md。
> 维护规则：每换阶段/每完成一个 Sprint 由当值 Agent 更新本文件；历史细节去 `docs/DEVELOPMENT_LOG.md` 与 `docs/handoff/` 查。
> 最后更新：2026-08-31（Sprint 4 formal closeout）

---

## 1. 当前阶段与目标

- **分支**：`feature/v3-product-refactor`
- **HEAD**：`19a15ed` feat(web): add reusable design system primitives
- **当前 Sprint**：Sprint 4 AI Training Room Formal Closeout
- **状态**：Sprint 4 已完成并通过 Release Re-Verification；Phase 5 尚未开始
- **一句话目标**：完成 Sprint 4 状态封板，保留其他工作线供后续独立处理。

---

## 2. 已完成

| Sprint | 状态 | Commit |
|---|---|---|
| Sprint 0（V3 基线冻结）+ Sprint 1（导航 8→5 / StudentHome / TestSection 接线） | Done | `ed9f80e` → `180cc8b` |
| Phase R（修复收口：重建投影 / DI 修复 / compat 契约恢复 / 边界清理） | Done | `60d5cb3` → `e62b304` |
| Sprint 2（Student State 统一消费：mastery-map 前端切换 / trial-progress / reminders / sprint-plan 全部 Adapter→SoT / R1 streak 修复） | Done | `69cc57f` → `f95601d` |
| Sprint 3.0（Recommendation Engine 契约冻结） | Done | 契约随 `25b205e` 入库 |
| Sprint 3.1（Recommendation Core，12 契约测试） | Done | `25b205e` |
| Sprint 3.2（Daily Plan Integration，generateDailyPlan 委托引擎，18 字段 parity） | Done | `3528d75` |
| Sprint 3.3（Legacy 推荐迁移：practice-sets / review-resources → 引擎+adapter，ID 契约修正） | Done | `8512895` |
| Sprint 3.4（Learning Loop Integration：任务完成/阶段测验触发次日计划、幂等事件、Today/Tomorrow 语义修复） | Done | `09ab2f4` |
| Sprint 3.5.3（Contextual AI Coach：后端统一上下文 + 前端四场景接入） | Done | `1287007` |
| Sprint 3.5.4（Contextual Coach Stabilization） | Done（文档待提交） | — |
| Sprint 3.6（Contextual AI Coach quality and observability） | Completed | `0613efe` |
| Phase 1（408 OS Design System primitives） | Done | `19a15ed` |
| Sprint 4（AI Training Room） | Completed / Release Ready | `b493438` → `19a15ed` |

---

## 3. 当前进行中

**当前：Sprint 4 已完成 Formal Closeout；Phase 5 尚未开始。**

Sprint 4 Release Re-Verification 已完成：

1. Training Room 实现提交为 `b493438`；随后 `19a15ed` 独立提交 Design System primitives，使当前 HEAD 的 Training Room 依赖闭包完整。实际 Git 历史为 `b493438` → `19a15ed` → `HEAD`。
2. Clean checkout source closure：PASS；Training Room 所需的 `GlassCard`、`SurfaceCard`、`ProgressRing`、`EmptyState` 及其入口文件均已进入 Git 历史。
3. TypeScript：PASS；此前 `components/ui` 缺失导致的 TS2307 已解决。
4. Training Room UI：6/6 PASS；Design System UI：4/4 PASS。
5. `git show --check`：PASS。
6. Vite/esbuild full bundle 在当前 Windows 环境因 `spawn EPERM` 受阻；这是子进程环境限制，不是 source/module-resolution 失败。

Sprint 4 Formal Closeout 状态：

- Implementation：COMPLETE
- Design System Dependency Closure：COMPLETE
- Git Boundary：COMPLETE
- Clean Checkout Source Closure：PASS
- Targeted Tests：PASS
- Documentation：SYNCED
- Release Status：READY
- Phase 5：NOT STARTED

已知 V2 → V3 migration debt，单独清理，不属于 Sprint 4：

- `student-learning-console-ui.test.js`
- `today-score-center-ui.test.js`
- `v3-section-wiring.test.js`
- `wrong-question-evidence.test.js`

已完成内容：

1. 任务完成与 `stage_assessment` session 完成后的事务后触发链。
2. `RecommendationService.generateDailyPlanFromState()` 支持注入 `scheduledDate`，生成次日 `StudyPlan`/`StudyTask`。
3. 写入 `plan.generated` UserEvent，并按 `learning-loop:{userId}:{scheduledDate}` 幂等。
4. AnswerReceipt 成功重放不进入进度、任务完成或 Learning Loop 触发链。
5. 触发失败仅记录 warning，不影响答题事务、PracticeRecord 或 StudyTaskCompletion。

Sprint 3.5.3 Contextual AI Coach 已完成：

1. 新增 `/ai/contextual-coach`，ContextAssembler 只读组装 Student State 和场景上下文。
2. 支持 `question`、`wrong_question`、`knowledge_node`、`assessment` 四类 context。
3. 前端通过统一 `ContextualCoach` 接入错题、知识节点、测评和答题结果外围。
4. 保留 `/ai/tutor-reply`、`/ai/follow-up` 与 `TutorPanel` 兼容路径。

Sprint 3.5.4 Stabilization 验证：

- `contextual-coach-integration.test.js`：6/6。
- `contextual-coach-context.test.js`：5/5。
- `contextual-coach-api.test.js`：5/5。
- `contextual-coach-ui.test.js`：4/4。
- `npm run build:api`：通过。
- `npm run build:web`：TypeScript 通过；Vite/esbuild 因本机 `spawn EPERM` 失败，未修改构建配置。

当前未解决的环境问题不属于业务代码失败；Sprint 3.6 不自动开始。

Sprint 3.6 已完成内容：

1. Contextual Coach response normalization：JSON 解析、字段校验、默认值补全、多余字段剔除和 fallback。
2. Prompt Guardrail：限制 AI 仅解释、提醒和建议，不得声称修改计划、任务、掌握度或复习安排。
3. Evaluation Tests：覆盖正常输出、缺失字段、类型错误、非法 JSON、多余字段、unsafe content 和四类 Context。
4. Observability：记录 source、fallbackReason、errorType、durationMs，并保留 provider fallback。
5. Frontend fallback 展示：直接展示后端 source/fallbackReason，网络错误使用用户友好提示。

---

## 4. 未提交文件归属

⚠️ **当前工作区存在主题在途文件，以下清单归项目所有者的前端主题优化工作：**

- `apps/web/src/components/ExamSession.tsx`
- `apps/web/src/features/practice/PracticePanel.tsx`
- `apps/web/src/styles.css`
- `apps/web/src/theme-optimizations.css`
- `apps/web/src/theme/themePreference.ts`（默认主题 = A 深色）
- `test/mobile-nav-ui.test.js`
- `test/theme-preference.test.js`

规则：**Sprint Agent 禁止修改、禁止提交、禁止格式化、禁止删除**这些文件；提交时一律按清单精确 `git add`，不使用 `git add -A`。

Sprint 4 已提交；当前 working tree 中仍有其他未提交工作线，均不属于 Sprint 4，包括 Knowledge Galaxy、Review Center/Smart Review、`StudentSections.tsx` 的后续修改、其他前端组件、测试、文档及上述主题文件。它们必须保持各自归属，后续单独审查和提交。

另：文档类未提交新增允许随文档任务提交：`docs/handoff/2026-08-30-v3-sprint3-handoff.md`、`docs/current-sprint.md`（本文件）。

---

## 5. First Next Task

**下一步需单独确认 Phase 5 规划；在用户确认前不开始实现。**

已完成验收：

1. 任务完成与 `stage_assessment` session 完成可触发；普通 `practice_set`/paper session 不直接触发。
2. AnswerReceipt replay 路径已隔离，不重复生成计划或事件。
3. Today/Tomorrow 查询语义已验证，今日完成后可提前生成明日计划。

验收完成：Sprint 3.6 commit `0613efe` 已落库；验证结果和剩余技术债务见 `docs/handoff/2026-08-30-v3-sprint3.6-handoff.md`。

---

## 6. 必读文档

1. `AGENTS.md` —— 硬规则（事实来源 / 小步修改 / 禁止静默 mock / 不自动 commit / 验证门禁）
2. `docs/current-sprint.md` —— 本文件（状态唯一入口）
3. `docs/sprint3-recommendation-contract.md` —— 引擎冻结契约（改引擎前必读）

历史背景（按需）：`docs/handoff/2026-08-30-v3-sprint3-handoff.md`（Sprint 0-3.3 全程交接 + 地雷清单）。

---

## 7. 项目关键架构冻结

### Recommendation Engine（`packages/shared/src/score-center`）

- 唯一 ID = **`knowledgeNodeId`**；`knowledgePointId` 禁止进入引擎（桥接只在 adapter）。
- 禁止 `Date.now()` / `Math.random()`；时间一律注入（`composeDailyPlan` 已支持 `now` 参数）。
- 业务层禁止重写 priority / classifyAction / composeDailyPlan——一律复用导出的引擎构件。
- 修改引擎前先读契约 §10 修订记录政策（只允许向后兼容增量）。

### Sprint 3.4 Technical Debt

- **P1**：多实例下 UserEvent triggerKey 查询、计划创建与 `plan.generated` 写入不是同一数据库原子操作，理论上可能重复生成同一日期计划。本阶段已登记，未扩大范围修复。

### Student State（Source of Truth）

- `PracticeRecord`（行为）/ `UserKnowledgeMastery`（掌握度）/ `WrongQuestionReview`（错题）/ `ReviewSchedule`（复习排期）/ `StudyPlan`+`StudyTask`（计划任务）/ `AnswerReceipt`（提交幂等台账）。
- 禁止新增第二套状态模型；禁止从旧 projection 反推事实；掌握度唯一写入方 = `ScoreCenterService.applyAttempts / applyReview`（OCC version）。

### Legacy 回退

- `!DATABASE_URL` 内存演示分支 + `@Optional` 服务缺省守卫**一律保留**（迁移模式 = Legacy API → Adapter → 引擎 → SoT）。
- 迁移必须带 parity 测试（legacy 转录 vs 新链 deepEqual，允许差异仅 generatedAt）；legacy 实现禁止删除。

---

## 8. 已知地雷

### Docker PostgreSQL

- 测试库连接用 **`127.0.0.1:55432`**，不要用 `localhost`（Windows 下 Node 解析到 IPv6 导致 P1001）。
- Docker Desktop 可能被关闭：先启动并轮询 `docker info` 就绪。

### 构造器注入（Nest Service）

- **新增依赖必须追加到构造器参数列表末尾**（加 @Optional 更稳）。原因：大量测试使用位置参数构造 StudyService 等服务，中部插参会整体错位（Sprint 3.3 实测 12 个测试连锁失败）。
- 模块循环规避：跨模块服务放入 `ScoreCenterModule` 并 exports（参照 RecommendationService 注册方式）。

### 测试 loader

- **禁止写回源码文件**（历史事故：写回式 loader 毁掉 today-plan-projection.service.ts 全部类型）。
- 统一使用 CommonJS Function 沙箱（参照 `test/stage-assessment-projection.test.js`）；依赖 stub 清单随被测服务导入演进（新增 import 要补 stub）。

### ID 陷阱

- `/practice-sets/recommended` 的 **`knowledgePointIds` 字段实际承载 `knowledgeNodeId`**（节点口径契约，集成脚本 :2653 断言钉死）。
- 题目匹配主路径 = `nodeQuestionIdsByNode`（QuestionKnowledgeNodeTag 节点标签）；`knowledgePointIds.includes` 仅作内容耗尽 fallback。不要重新引入 KP 替换逻辑。

---

## 9. 验证门禁

开发完成必须依次通过（先验证，后报告；禁止未验证宣布完成）：

```bash
npm test                              # 全量 node:test（基线：1038 项 / 1037 过 / 0 失败 / 1 跳过）
npm run build:shared
npm run build:api
npm run db:test:up && npm run test:integration:postgres && npm run db:test:down
# 触碰前端时加：npm run build:web
```

任何失败：先定位（输入契约 / candidate 映射 / task 富化），禁止改断言凑绿，禁止直接改 shared 引擎。
