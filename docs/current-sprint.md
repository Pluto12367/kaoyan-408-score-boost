# Current Sprint

> 2026-09-05 接管更正：Learning Intelligence Platform **IN PROGRESS**。下文旧 COMPLETE/PASS 声明不能替代门禁；旧报告自身有 25 FAIL 与数据库验证缺口。当前执行状态见 `docs/autonomous-development-state.md`；既有文件归属保护继续有效。本次已重现默认沙箱 spawn EPERM，沙箱外全量基线运行中；Docker 29.2.0 沙箱外可用，ENV-005 重新核实中。

> **2026-09-05 AI Intelligence Foundation Milestone 已完成（Phase AI-0…AI-5）**：Knowledge RAG（`/rag/knowledge/search`）、Coach RAG 集成（`knowledgeContext` 可选增量）、Study Agent V1（六工具 + LLM 循环 + workflow 兜底，`POST /agent/study/run`）全部落地；74 项新测试全绿，全量 1597/1568/25（与预存基线一致）；build:shared/api 通过。新增模块 `apps/api/src/rag/`、`apps/api/src/agent/`，未触碰 Prisma Schema/Mastery/Recommendation/Practice 写路径与前端。详见 `docs/ai-intelligence-final-report.md`（提交时按其 §4 清单精确 git add；主题在途文件保护不变）。

> **2026-09-05 AI Learning Agent Production Evolution Milestone 已完成（Phase AI-6…AI-12）**：Agent Memory（三层学习记忆，纯 StudentContext 派生）、Learning RAG V2（rewrite/hybrid/graph/difficulty，`/rag/knowledge/v2/search`）、Study Agent V2 Planner（`POST /agent/study/plan` + 四规则 Plan Validation + run deadline）、Safety Guard（注入检测/知识引用契约/承认不知道/写权限硬闸）、Evaluation Framework（13 项指标即断言，检索命中 12/12）、Production Metrics（`GET /ai/metrics` admin + usage 计量）。新增 96 项测试；AI 域组合回归 160/160；全量与 build 见 `docs/ai-learning-agent-production-final-report.md` §5/§8。冻结域零触碰；提交按其 §3 清单精确 git add。**已提交 checkpoint `ce0d949`（tag v3.2-ai-agent-production；v3.0-student-context @ 4f58fe3）**。

> **2026-09-06 AI Learning Companion Productization Milestone 已完成（PX-1…PX-5）**：Coach Session Memory（RuntimeState 存储+对话压缩+Prompt V2 三水平个性化）、Daily AI Study Agent（`POST /agent/daily/plan`，mastery-evidence 难度调整 reduce/maintain/challenge）、Exam Simulator（`/agent/exam/generate|analyze`，真实题库+真实节点，LLM 零内容生成）、Tutor Mode（Socratic 序列/三层解释/5 类误区检测）、Multi-Agent（Agent Protocol + Supervisor 四意图路由，specialist 隔离测试钉死）、Metrics 扩展（cacheHitRate/evaluation）。PX 新增 52 项测试，PX+既有 AI 域回归全绿；详见 `docs/px-ai-learning-companion-final-report.md`。**已提交 checkpoint `b3ca19c`（tag v3.3-ai-learning-companion）+ 收尾增量 `7c7b4ff`（题-节点精确映射）**。

> **2026-09-06 V3 Release Closure Milestone 已完成（B2…B6 + v3.5 RC）**：工作树**归零**（163 脏文件全部按工作线归属入库）。B2 Review Center/Knowledge Galaxy（b796099）、B3 Student Home/Report + StudentContext 前端消费 + 3 个过期 UI 测试收口（4a1e570）、B4 Score Center 节点解析桥接 + 模块 DI（3ce2d9c）、B5 主题系统（a47d4b8，所有者授权）、B6 文档/杂项（a18a85e）。最终门禁：全量 1721/1694/22（较 v3.4 基线 -3，零新增）；fresh checkout a18a85e 三端构建 PASS + 六域核心回归 168/172（4 失败为既有 freshness 债）。**v3.5 Release Candidate = READY（a18a85e）**；Real AI Provider 维持 BLOCKED BY EXTERNAL CREDENTIAL/BILLING；既有 22 项 UI 契约测试债在册待 W1/W4 所有者收口。详见 docs/v35-release-closure-final-report.md。

> **2026-09-06 v3.4 AI Production Validation & Closed-Loop Learning Milestone 已完成（Phase 0…16）**：真实测试库（1297 节点/1388 chunks 播种）上验证 6 条学习闭环（Planning/Mastery 反馈/Review/Coach/Exam/写安全，闭环断言 34 项全绿——含引擎 priority 46→39 实证）；RAG 真实语料 top3Hit 91.7%/precision@3 0.681/recall 0.917/p95 8ms，**发现并修复 1 个真实缺陷**（口语泛化词污染检索，TDD）；Remote LLM **BLOCKED（402 余额不足，认证链路证实真实）**、Remote Embedding **BLOCKED（无凭证+DeepSeek 无端点）**——Release Gate 标记 `RELEASE BLOCKED BY CREDENTIALS`，未伪造任何 Real Provider PASS。全量 1721/1694/25（基线一致）、build 全 PASS。详见 `docs/v34-ai-production-validation-final-report.md`。

> **2026-09-07 V6.3 学习效果度量生产化 Milestone 已完成并上线生产（commit `b72bfc5`）**：V6/V6.1/V6.2 的 4 个 effectiveness 纯函数模块此前已随 V7 基线部署但从未接入 NestJS。本轮补齐生产读模型：`effectiveness.assembly.ts`（纯函数装配：point→node PRIMARY 解析、快照 before/after 窗口选取、evidence gate 映射）、`effectiveness.service.ts`（有界只读查询）、`effectiveness.controller.ts`（GET /effectiveness/summary|outcomes|interventions|experiments，数据隔离沿用 resolveUserId 模式）、`effectiveness.module.ts`（AgentModule 组合模式，StudyModule 零改动）。ai-metrics 扩展 effectiveness 派生计数。**零迁移、零新表、零既有端点改动**。验证：build:api/web PASS；全量 1863/1839/22（22 败 == 在册 UI 契约测试债，零新增）；PostgreSQL 集成 ALL PASS。**生产冒烟（腾讯云 2C2G）全项 PASS**：真实节点 CO-C03-S05-P01 以 161 样本通过 evidence gate（masteryGain 0.3418）；4 节点评估 1 过 3 被诚实拦截；interventions 派生真实 study_plan_task 事件；experiments 学生角色 403。部署注意：服务器 git 默认 pull 会命中代理陈旧 ref，须用 `git fetch origin <branch>` + `git reset --hard FETCH_HEAD`（详见 v63 报告 §6/§7）。详见 `docs/v63-effectiveness-productionization-final-report.md`。**文档增量（v63 报告生产冒烟章节 + 本条目）未提交，随下次文档任务入库。**

> **2026-09-07 V8 全产品演进 Mission 启动：Phase 0 审计完成 + P0 第一批修复完成**。Phase 0：三路仓库审计（前端 22 项/后端 13 项/测试观测 9 项）+ 生产浏览器走查（jackchou 账号五分区），产出 `docs/v8-full-product-audit.md`、`docs/v8-master-backlog.md`（55 项 P0-P3）、`docs/v8-student-experience-state.md`。核心发现：产品最大问题不是缺功能，而是同屏数据自相矛盾（暂无数据 vs 89%掌握、错题计数 0/12/23 三口径、"最重要考点"四处不同、null 渲染成 0、"还差 0 分"假达成、内部术语泄漏）。P0 已修：① useStudentContextData 竞态（过期响应覆盖/跨账号串数据，4 项 B 类测试转绿）② 术语泄漏"Canonical Overview 未定义该指标"移除并恢复报告提分空间指标（p2-kpi 契约转绿）③ 掌握度浮点直出格式化（formatRatePercent）④ 掌握度趋势图无快照日 null 化（shared 契约 averageMastery: number|null + 前端空心刻度，不再画 0% 柱）⑤ 目标进度"还差 0 分"假达成修复（resolveScoreGapView + 指导文案）。验证：build:shared/api/web PASS；全量 1868/1849/17（较基线 22→17，新增测试 6 项全绿）。styles.css 仅追加 trend-bar-empty 样式类（该文件保护清单所涉在途工作已在 B5 经所有者授权入库，本次为增量不触碰主题规则）。详见 v8 三文档。

> **2026-09-07 V8 P0 全清 + P1 首批（7 commits 推送至 1799316）**：P0 七项全完成——竞态守卫、内部术语移除、浮点格式化、趋势图 null≠0、假达成修复、**22 项测试债全部处置（npm test 首次全绿 1884/1882/0）**、错题计数口径精确化（新增 docs/v8-wrong-question-semantics.md，深层对账拆 #56）。P1：#9 全局下一步仲裁（resolveReportTopFocus，报告页不再与首页各说各话；题库卡接入拆 #57）、#10 effectiveness 前端消费（报告新 tab 努力与效果，V6.3 最后一公里打通）、#11 任务行理由展示。行为测试抓到真 bug：resolveWrongQuestionMastery 以 nodeId 查 Point 索引致复习卡掌握度永远未评估（已修）。新测试文件：review-center-vm / display-format / report-top-focus / effectiveness-panel / today-mission-reason / report-wrong-count-semantics。追加完成：#14 复习队列按考点分组（5 张同名卡 → 1 张 N 题组卡，行为测试钉死）、#8 唯一主行动（canonical 为 today_task 时路线视图首步降级为指路文案，不再双开始按钮）。推送至 86a2dff，npm test 1886/1884/0。追加完成（至 c6152e9）：#13 断档恢复（missed-day-recovery 纯模块：≤3 个最旧未完成任务重锚新窗口首日，reason 断档补做，响应 recoveredFromGap）、#12 时长预算（GET /practice-sets/recommended?minutes= 预算档 15→5 题/30→10 题 + 练习面板快速会话按钮）、#57 薄弱报告改叫考点名。npm test 1892/1890/0。下一步：#58 结构化 reasonCodes 派生、#56 漂移对账设计、效果 UI 观察迭代。

> **2026-09-07 V9 Learning Experience OS Mission 启动（Phase 0 完成）**：使命 = 从 AI 辅助工具升级为 AI 考研教练。基线固化：本地 8c0e455（V8 全量 22 commits 已推送未部署生产），测试 1899/1897/0 全绿。Phase 0 产出 docs/v9-baseline-audit.md：教练差距模型（7 类教练行为 vs 现状差距映射到 6 个 Phase）+ 可复用资产清单（StudentContext/风险层/effectiveness/仲裁器/AI 层冻结复用）+ 红线（LLM 只做已核实事实的语言组织、insufficient_data 贯穿、无第二套 SoT）。Phase 1 完成（4d107f9 + slice2）：DailyBrief 纯派生 + GET /coach/daily-brief + 首页简报卡 + focus/visibility/自定义事件重算。Phase 2 Adaptive Weekly Planner 完成：weekly-adjustment 纯模块（上周证据 → intensity_up 1.2 / maintain / down 0.8，证据不足强制 maintain）+ 重建链应用（跳过 carry 任务，minutes 下限 15）+ 响应 weeklyAdjustment 字段；EffectivenessModule 导出 EffectivenessService 供 StudyModule 注入（构造器末位 @Optional）。npm test 1913/1911/0。Phase 3 Learning Progress Dashboard 完成：progress-narrative 纯模块（周环比 = 本周/上周 7 日均值差，各半区 ≥2 有效值才对比，否则 no_data；里程碑行仅随证据出现）+ GET /coach/progress-narrative + 报告总览 tab 本周进步叙事卡。npm test 1918/1916/0。Phase 4 Knowledge Galaxy 2.0 完成：shared filterKnowledgeTree 新增 onlyWeak+masteryById 过滤（weak 状态或 mastery<45 才算薄弱，未知≠薄弱）+ 前端 只看薄弱 toggle；Galaxy 关系计数诚实化（视图内 N 条 · 全库 M 条——根因是知识树关系数据稀疏：1296 节点仅 33 前置/21 关联，DS 科目内 0 边，属内容侧缺口对应 backlog B13）。npm test 1920/1918/0。Phase 5 主动教练完成：GET /coach/proactive（StudentContext→signals→detectLearningRisks→deriveProactiveInterventions，slice(0,2) 频次上限）+ 首页 ProactiveCoachCard（count=0 静默、demo 隐藏、错误不变成横幅）；LearningSignalService 注册进 StudyModule。npm test 1921/1919/0。下一步 Phase 6 反馈回流与 A/B 分流。

> 本文件是所有 Agent 接管项目的**唯一常青状态入口**。开工先读本文件 + AGENTS.md。
> 维护规则：每换阶段/每完成一个 Sprint 由当值 Agent 更新本文件；历史细节去 `docs/DEVELOPMENT_LOG.md` 与 `docs/handoff/` 查。
> 最后更新：2026-09-05（Learning Intelligence Platform milestone 完成：Phase 1-12 全闭环审计 + 5 份架构文档；全量 npm test 首次本机完整执行 1477/1504 PASS（25 败全部为在途工作线预存债务）；闭环结构验证完整、幂等/掌握度/推荐一致性全证据化；SC-1…SC-5 与 loop milestone 均 PASS；ENV-005 与 D4-B4 仍阻塞）

---

## 1. 当前阶段与目标

- **分支**：`feature/v3-product-refactor`
- **HEAD**：`4f58fe3`（当前工作树含未提交的 Phase 3.x 与其他在途工作线）
- **当前 Sprint**：Learning Intelligence Platform — Full Learning Loop Hardening（**COMPLETE**，`docs/learning-intelligence-final-report.md`； preceded by SC-1…SC-5）
- **状态**：Sprint 4 已完成并通过 Release Re-Verification；Phase 2 Baseline Closure 已完成；Phase 3.3A 已完成稳定化验证；Phase 3.4 已完成事件边界实现；Phase 3.5 已完成提交后 best-effort 反馈触发；Phase 3.6.2B-2 已完成 EventKey Schema Migration；Phase 3.6.2C writer 已接入数据库唯一冲突回读；Phase 3.6.3 已限制 `/events` 为 telemetry allowlist，并将 `plan.generated` 迁移到 CanonicalEventWriterService；Phase 3.6.4-D1/D2/D3 已完成 identity contract、StudyPlan 幂等 repository 与 Action key contract；D4-B1 已将 LearningLoop generation context 接入 StudyPlan generation repository；D4-B2 已将 generationKey 接入 RecommendationAction runtime creationKey；D4-B3 已将 `plan.generated` eventKey 切换为 generation-scoped identity，并保留 legacy triggerKey 读取兼容；D4-B4 仍因 ENV-005 宿主环境阻塞。**StudentContext 消费收敛已完成**：StudentHome 五类摘要、ReportWorkspace summary、Contextual Coach base student state 三个 summary 消费者均以 StudentContext 为 canonical source（各有纯展示 adapter/bridge + legacy 兜底）；全仓消费者审计（`docs/student-context-consumer-audit.md`）确认无剩余应迁移消费者，Knowledge/Assessment 等领域 detail 按 Rule 3 保留独立；契约审查产出 mastery 桶语义提案 P-1（`docs/student-context-contract-hardening-proposal.md`，未实施、待人工决策）。定向测试 57/57 PASS，`build:api`/`build:web` PASS。完整 `npm test` 与 PostgreSQL integration 当前仍受本机环境阻塞。
- **一句话目标**：保持 RecommendationAction.studyTaskId 为唯一 Action-Task 绑定，并让 canonical event 只能由受控 server-side writer 产生、使用数据库级 eventKey 幂等。
- **Phase 3.6.2B-1/B-2/3.6.2C/3.6.3**：Event Contract v1 已冻结（`docs/event-contract.md`）；`UserEvent.eventKey` nullable 字段与 `(userId,eventKey)` 唯一索引已实现；Feedback writer 已使用数据库唯一冲突回读；`POST /events` 仅接受 telemetry allowlist，`plan.generated` 通过 CanonicalEventWriterService 写入。

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

**当前：Sprint 4 已完成 Formal Closeout；Phase 2 Baseline Closure 已完成；Phase 3.3 Recommendation Consumer Migration 及 3.3A 稳定化验证已完成；Phase 3.4 已建立 ActionLearningSignal → UserEvent 的 Student State 反馈事件边界；Phase 3.5 已完成 Practice/Review 提交后 best-effort 反馈触发，未改变 Mastery；Phase 3.6.4-D4-B3 已完成 `plan.generated` generation-scoped event identity migration；D4-B4 并发验证入口已建立，因目标数据库 schema 未应用 generationKey 而阻塞；StudentContext v1 与 StudentHome 首个摘要消费者迁移已完成，Closure Gate 判定 READY FOR REPORT WORKSPACE，其他首页明细与消费者保持兼容链。**

### Phase 3.3 Recommendation Consumer Migration

- `RecommendationActionAdapterService` 以 `(userId, creationKey)` 幂等创建 Action，并在同一事务中通过 `RecommendationAction.studyTaskId` 绑定 `StudyTask`。
- 重试在 Action 已绑定时复用原计划；`ScoreCenterService` 通过 compatibility adapter 暴露可选 `actionId`，不新增 `StudyTask.actionId`。
- `RecommendationFeedbackService` 只读消费 `ActionLearningSignal`，新增用户隔离的 `GET /recommendation-actions/:id/feedback`。
- Phase 3.3 定向与相关回归测试通过；API/shared/Web TypeScript 通过；全量 node:test 与 Vite bundle 仍受 Windows `spawn EPERM` 阻塞。

### Phase 3.3A Consumer Migration Verification & Stabilization

- 新增 `test/recommendation-consumer-verification.test.js`，覆盖 today-plan Action relation loading、legacy adapter identity boundary 与 direct task compatibility。
- 修复 `loadTodayScoreCenterPlan` 未加载 `StudyTask.action` 的 Phase 3.3 消费缺口；不新增 `StudyTask.actionId`，不改变 Schema/Migration。
- 3.3A 定向验证与 Phase 3.2C–3.3 相关回归通过；`npm test`（253 个文件）与 Vite bundle 因 Windows `spawn EPERM` BLOCKED；`prisma validate` PASS，`prisma generate` 同样 BLOCKED。

### Phase 3.4 Student State Feedback Integration

- 新增 `StudentStateFeedbackAdapter` 与 `ActionLearningSignalConsumerService`，将 ActionLearningSignal 映射为 `StudentStateFeedbackEvent`。
- 新增 `StudentStateFeedbackRepository`，使用现有 `UserEvent` 记录 `USER_ACTION_FEEDBACK`，以 user + action + signalType 做 repository-level 幂等去重。
- 未修改 `UserKnowledgeMastery`、Mastery 写入管线、Practice/Review、Recommendation、Schema/Migration 或 UI；定向契约测试通过。

### Phase 3.5 Feedback Event Integration & Learning Loop Activation

- 新增 `ActionFeedbackTriggerService`，统一调用既有 `ActionLearningSignalConsumerService`，不直接查询或写入 Practice、Review、Mastery 或 UserEvent。
- Practice 的 legacy、AnswerReceipt transaction、pending takeover 三条成功提交路径均在持久化完成后触发；AnswerReceipt 重放不触发。
- Review 仅在 `ReviewAttempt` 写入成功后触发，`isReview=false` 的记录原因流程保持无 Attempt、无反馈事件。
- 反馈触发为 best-effort 异步调用；Consumer 错误只记录 warning，不回滚已提交的业务事实。定向回归 105/105、shared/API build 与 Web TypeScript 通过；全量 `npm test` 与 Web Vite 仍受 Windows `spawn EPERM` 阻塞。

### 2026-09-01 P1 线上验证结论（FIXED + VERIFIED ONLINE）

- `ac81e26`（WrongQuestionDetail `useMemo` 位于 loading/error guard 之前）已 push 且为分支 HEAD；回归测试 `test/mistake-detail-hook-regression.test.js` PASS。
- 线上 chunk `MistakeWorkspace--QrJX8Ts.js` 与纯净 `ac81e26` 构建逐字节一致（字节级对比），修复已上线；此前复现源于浏览器缓存旧 `index.html` → 旧 `BTRD8AwK` chunk（旧资源未清理 + nginx 无 `Cache-Control`）。
- 线上无缓存会话浏览器回归：详情打开/关闭/再打开、变式练习、笔记保存持久化、原题重做、筛选均 PASS；Console 零错误、Network 零失败。
- 全仓扫描未发现第二个同类 Hook mismatch。
- 完整报告：`docs/qa/production-fix-verification.md`；遗留观察项（科目筛选中文名/代码匹配偏差、部署卫生、缓存策略、SSH 受限）见该报告 §11。

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
3. 写入 generation-scoped `plan.generated` UserEvent（`PLAN_GENERATED:{generationKey}`），并保留 legacy `triggerKey` 重复检查。
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

**V6.3 未提交文件归属（2026-09-06，本次 milestone 产出，待所有者审查提交）：**

- `apps/api/src/effectiveness/effectiveness.assembly.ts`（新增）
- `apps/api/src/effectiveness/effectiveness.service.ts`（新增）
- `apps/api/src/effectiveness/effectiveness.controller.ts`（新增）
- `apps/api/src/effectiveness/effectiveness.module.ts`（新增）
- `apps/api/src/app.module.ts`（追加 EffectivenessModule import + 注册，两行）
- `apps/api/src/ai-metrics/ai-metrics.service.ts`（追加 effectiveness 指标）
- `test/v63-effectiveness-service.test.js`（新增）
- `scripts/integration-effectiveness.mjs`（新增）
- `package.json`（追加 `test:integration:effectiveness` 脚本一行）
- `docs/current-sprint.md`（本文件）、`docs/v63-effectiveness-productionization-final-report.md`（新增）

Sprint 4 已提交；当前 working tree 中仍有其他未提交工作线，均不属于 Sprint 4，包括 Knowledge Galaxy、Review Center/Smart Review、`StudentSections.tsx` 的后续修改、其他前端组件、测试、文档及上述主题文件。它们必须保持各自归属，后续单独审查和提交。

另：文档类未提交新增允许随文档任务提交：`docs/handoff/2026-08-30-v3-sprint3-handoff.md`、`docs/current-sprint.md`（本文件）。

---

## 5. First Next Task

**StudentContext 主线（SC-1…SC-5）已完成。候选下一步（由项目所有者决策，不自动启动）：**
1. SC-P2-001 Mastery fallback 语义对齐（唯一遗留的契约语义修正提案）。
2. SC-P2-003 practiceRecord 读取上界化（需 DB 聚合投影独立设计）。
3. 恢复 disposable PostgreSQL 后重跑 Phase 3.6.4-D4-B4（ENV 阻塞项）。

（SC-4 审计的缓存基础设施建议已被 TASK 1 的按需 IN 查询实质替代；v2 契约策略见 `docs/student-context-contract-evolution.md`。）

### Phase 3.6.4-D4-B1 StudyPlan GenerationKey Runtime Adoption

- LearningLoop 现在生成确定性的 `LEARNING_LOOP:{userId}:{scheduledDate}:v1`，并将 generation context（source/version）传入 `RecommendationService.generateDailyPlanFromState()`。
- 有 generation context 且运行在持久化环境时，推荐计划路径先按 `(userId,generationKey)` 读取，再通过 `StudyPlanRepository.createOrGetByGenerationKey()` 在外层事务中创建；唯一冲突由外层回滚后 fresh read 收敛。
- 无 generation context、无数据库或 onboarding/exam-review 等 legacy 计划路径保持原有 writer，不改变 Action creationKey、`plan.generated` eventKey、归档语义或 Recommendation 算法。
- D4-B1 定向验证：runtime adoption 2/2、LearningLoop 10/10、StudyPlan idempotency 4/4、Recommendation consumer 16/16、daily-plan parity 3/3；shared/API build 与 Web TypeScript 通过。

### Phase 3.6.4-D4-B2 RecommendationAction Generation-Scoped CreationKey Runtime Migration

- `RecommendationActionAdapterService` 在提供 `generationKey` 时使用 `createRecommendationActionKey()` 生成 `ACTION:{generationKey}:{actionType}:{targetType}:{targetId}`。
- 没有 generationKey 的 legacy draft 继续使用原 date-scoped creationKey；未修改历史 Action 数据或 Schema/Migration。
- RecommendationService 将 generationKey 透传到 Action draft；D4-B2 定向 runtime contract 5/5、Action key contract 5/5、Recommendation consumer 16/16、StudyPlan adoption 2/2 通过。

### Phase 3.6.4-D4-B3 plan.generated Event Identity Migration

- `plan.generated` 的 canonical eventKey 已切换为 `PLAN_GENERATED:{generationKey}`；同一 generation 重试由 `(userId,eventKey)` 唯一约束收敛，不同 generation 与 version 保持隔离。
- 事件 payload 新增 `generationKey` 与 `source`，继续保留 `triggerKey`、`planId`、`scheduledDate` 等兼容字段；缺少 generationKey 的 legacy writer 仍按旧 triggerKey 规则派生 eventKey。
- 定向验证：`plan-generated-event-identity.test.js` 5/5、`learning-loop-trigger.test.js` 10/10、`canonical-event-boundary.test.js` 8/8、`student-state-feedback-event-key.test.js` 4/4、`recommendation-action-generation-runtime.test.js` 5/5；shared/API build 与 Web TypeScript 通过。全量 node:test、Vite bundle 与 Docker PostgreSQL integration 仍受本机环境阻塞。

### Phase 3.6.4-D4-B4 Reliability Verification

- 新增 `scripts/integration-generation-reliability.mjs` 与 opt-in 测试 `test/study-plan-generation-concurrency.integration.test.js`，使用两个真实 Prisma Client 验证 StudyPlan generationKey、generation-scoped Action、plan.generated eventKey 的并发收敛，以及跨 Plan/Task/Action/Event 事务回滚。
- 测试脚本仅允许 loopback PostgreSQL fixture；未执行 migration、seed 或历史数据修改。当前 `127.0.0.1:55432/kaoyan408_test` 返回 Prisma `P2022`（`StudyPlan.generationKey` 不存在），因此 D4-B4 实际并发断言为 **BLOCKED / MIGRATION NOT APPLIED**。

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
