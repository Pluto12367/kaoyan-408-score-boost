# V6.3 学习效果度量生产化 — 最终报告

> 日期：2026-09-06。基线：`v7.0.0-production-certified`（869c161）之上，分支 `feature/v3-product-refactor`。
> 参考方向（开源参考检查）：学习平台的成效归因普遍采用"派生读模型 + 证据门槛 + 提案制优化"模式（如 Khan Academy 的 evidence-based mastery、Duolingo 的 A/B 证据门控）；本轮仅借鉴其"读模型按需重建 + 证据不足诚实降级"的思想，未复制任何代码，落地在本仓库既有 CQRS 架构上。

## 1. 任务背景

探查证实：V6/V6.1/V6.2 交付的 4 个 effectiveness 纯函数模块（`learning-outcome.ts`、`outcome-pipeline.ts`、`intervention-event.ts`、`learning-effectiveness.ts`）已随 V7 基线部署到生产，但**完全未接入 NestJS**——零 module、零 controller、零端点，只有单元测试在消费。本轮任务 = 补齐"真实生产数据 → 纯函数派生 → 只读端点"的装配层（用户已确认本轮不做前端消费）。

## 2. 交付内容

### 2.1 新增文件（apps/api/src/effectiveness/）

| 文件 | 职责 |
|---|---|
| `effectiveness.assembly.ts` | 纯函数装配层（无框架/DB/时钟依赖）：`resolvePointToNodeMap`（knowledgePointId→nodeId，PRIMARY 优先，未映射记录丢弃而非错误归因）、`toPracticeFacts`、`pickMasteryBounds`（before=窗口起点前最新快照，after=窗口终点前最新快照，无 after 则剔除节点）、`deriveNodeOutcomes`（接 buildOutcomeFromFacts + checkEvidenceGate，gate 阈值 minSampleSize=5 / minEffectSize=0.05 / requiredConfidence=medium）、`toProfileInput`（6 维输入映射，考试日期缺失读作 999=far） |
| `effectiveness.service.ts` | 有界只读查询 + 派生调用。`getOutcomes`（PracticeRecord 窗口行 → node 解析 → UserMasterySnapshot before/after，兜底 UserKnowledgeMastery 当前行作 after）、`getInterventions`（RecommendationAction/StudyTask/StudyTaskCompletion/ReviewSchedule → deriveInterventionEvents + correlateUserAction + correlateOutcome）、`getProfile`（StudentContext 6 维 + mastery aggregate/recent accuracy → classifyStudent，无学习数据返回 no_learning_data）、`getExperiments`（观察性 cohort 对比，统计单位=学生，minSampleSize=3，proposal-only） |
| `effectiveness.controller.ts` | 4 个 GET 端点（只读）：`/effectiveness/summary`、`/effectiveness/outcomes`、`/effectiveness/interventions`、`/effectiveness/experiments`（teacher/admin）。数据隔离：student 仅本人、teacher 需 TeacherStudentAuthorization、admin 全量；windowDays 上限 180 |
| `effectiveness.module.ts` | AgentModule 组合模式：本模块内自建读模型链（MasterySummary/StudentState/Practice/WrongQuestion/TodayPlan/Assessment projections + StudentContextQueryService），**不改 StudyModule（其零 exports）** |

### 2.2 修改文件（追加式，最小改动）

- `apps/api/src/app.module.ts`：import + 注册 `EffectivenessModule`（2 行追加）。
- `apps/api/src/ai-metrics/ai-metrics.service.ts`：新增 `EffectivenessDerivationEvent` 环与 `recordEffectivenessDerivation`；`snapshotLearningIntelligence()` 增加 `effectiveness` 段（derivations/nodesEvaluated/gatePassed/gateInsufficient/bySurface）。
- `package.json`：新增 `"test:integration:effectiveness"` 脚本。

### 2.3 测试

- `test/v63-effectiveness-service.test.js`：11 项纯函数断言（PRIMARY 解析、未映射丢弃、窗口边界、gate 强/弱样本、排序、profile 映射、metrics 计数）。
- `scripts/integration-effectiveness.mjs`：真实 PostgreSQL 端到端（compose.test.yml 测试库 127.0.0.1:55432，遵守地雷清单端口约定）：种子 user/question family+question/knowledge point+node+PRIMARY 映射/6 条练习记录（1 条故意无映射）/掌握度快照（窗口前 0.30、窗口内 0.55）/action→task→completion 链/review schedule，手动装配 dist 类后全链路断言并清理种子数据。

## 3. 验证结果（附命令）

| 命令 | 结果 |
|---|---|
| `npm run build:api` | PASS（tsc 零错误） |
| `npm run build:web` | PASS（17.89s，chunk 体积警告为既有） |
| `npm test` | 1863 tests：1839 pass / 22 fail / 2 skipped。**22 个失败与 V7 基线在册的 22 项 UI 契约测试债逐条一致（W1/W4 workstream），零新增失败**；11 项新测试全绿 |
| `node scripts/integration-effectiveness.mjs` | **ALL PASS**：masteryGain 0.25 + gate PASS（真实快照派生）；intervention 事件 completed+delivered，study_plan_task 事件经 knowledge_node 方法关联到 masteryGain 0.25；无映射练习记录未产生任何节点 outcome（诚实丢弃）；profile 分类正常；单用户 experiments 返回 `insufficient_data`、零 proposals；metrics counters 记录正确 |
| `npm run test:integration:postgres` | exit 0（新增模块注册后 API 正常启动，既有 17 端点回归通过） |

## 4. 数据来源与影响范围（AGENTS.md 第 4 条）

- 全部读取现有表：`PracticeRecord`、`KnowledgePointNodeMap`、`UserMasterySnapshot`、`UserKnowledgeMastery`、`RecommendationAction`、`StudyTask`、`StudyTaskCompletion`、`ReviewSchedule`、`User`、`TeacherStudentAuthorization`（经既有 repository）。
- **零 Prisma Schema 变更、零迁移、零新表、零写入**（除 metrics 内存环）。所有派生视图可随时按请求重建。
- 未触碰：经典闭环掌握度写路径、推荐/计划算法、既有路由与响应结构、前端全部文件、current-sprint.md 在途文件清单中的 7 个主题文件。

## 5. 诚实性契约（验收要点）

- 样本不足 → `quality: insufficient_data` / `confidence: low` / `evidenceGate.passed: false`，绝不伪造 effect size。
- 无学习数据的学生 → `profile: null, reason: 'no_learning_data'`。
- 无映射到知识节点的练习记录 → 从节点级 outcome 中剔除（计入数据质量降级，不冒充）。
- 单用户生产环境 → experiments 必然 `insufficient_data`、proposals 为空——这正是预期行为。
- experiments 标注 `design: 'observational_cohort'`（观察性队列对比，非受控实验，关联≠因果）。

## 6. 生产部署与冒烟（2026-09-07 完成）

部署：Tencent Cloud 2C2G，服务器经 `git fetch origin feature/v3-product-refactor`（显式 refspec 穿透代理陈旧缓存）更新到 `b72bfc5`，`up -d --build` 重建，三容器健康，`/health` overall ok。无迁移步骤（零 Schema 变更）。

生产冒烟（体验账号，网关 `/api` 前缀）全项 PASS：

| 端点 | 生产证据 | 判定 |
|---|---|---|
| GET /effectiveness/outcomes | 节点 `CO-C03-S05-P01`：161 次真实练习，masteryBefore 0.5504 → masteryAfter 0.8922，masteryGain 0.3418，quality ok，confidence high，**evidence gate 四项检查全部通过**（161/5、0.3418/0.05、high、ok） | PASS |
| GET /effectiveness/interventions | 真实 RecommendationAction→StudyTask 链派生 `study_plan_task` 事件（如目标 OS-C02-S04-P04，status delivered），eventKey 幂等格式正确，actionCorrelation 诚实标注 partial | PASS |
| GET /effectiveness/summary | 画像 archetype=returning（avgMastery 0.68、recentAccuracy 0.85、overdue 24）；**outcomes 汇总 4 节点评估：gatePassed 1 / gateBlocked 3** | PASS |
| GET /effectiveness/experiments | HTTP 403（学生角色被 RoleGuard 拦截）——数据隔离门禁的生产证据 | PASS |

**生产证据要点**：evidence gate 在真实数据上非全有全无——同一用户 4 个节点中 3 个因证据不足被诚实拦截、1 个以 161 样本通过，门槛精确工作；"单活跃用户必然 insufficient_data"的预估被修正为"按节点证据强度独立判定"。观测指标 `snapshotLearningIntelligence().effectiveness` 已在 `/ai/metrics` 可查（bySurface/derivations/gatePassed/gateInsufficient）。

## 7. 遗留风险（更新）

1. ~~生产部署未执行~~ **已完成**（本报告 §6）。V6.3 代码已随 `b72bfc5` 上线生产。
2. **数据覆盖**：体验账号 gate 通过节点为 1/4——更多节点通过需真实用户持续练习积累；NodeMap 映射覆盖率提升归内容侧后续工作。
3. **experiments 正向路径**生产验证仍缺 admin token 证据（集成测试已覆盖正向逻辑 + 生产 403 已证明门禁；可择机用管理员账号补一次 cohort insufficient_data 冒烟，不阻塞）。
4. **服务器 git 缓存怪象**：腾讯云到 GitHub 的代理会间歇性返回陈旧 ref 通告（默认 `git pull` 拿到旧 `a0de9ee`）；已用 `git fetch origin <branch>` 显式 refspec 穿透 + `git reset --hard FETCH_HEAD` 解决，并留置 `http.version=HTTP/1.1`。后续服务器更新若再遇 "Already up to date" 异常，直接用此流程。
5. 22 项 UI 测试债与 V6 staging 部署仍按原计划归属后续工作线。

## 8. Git 状态

**已提交并部署**：`b72bfc5`（本地 → GitHub → 生产服务器三方一致）。tag `v7.0.0-production-certified`（869c161）保持不动，V6.3 在认证基线之上增量前进。
