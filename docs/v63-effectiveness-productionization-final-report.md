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

## 6. 遗留风险

1. **部署未执行**：生产（Tencent Cloud 2C2G）仍运行 `v7.0.0-production-certified` 代码。上线步骤 = 服务器 `git pull` + `docker compose -f compose.production.yml --env-file .env.production up -d --build` + 冒烟 4 个端点（无迁移步骤）。2C2G 内存预算不受影响（只读有界查询，app 堆上限 512MB 不变）。
2. **单用户数据稀疏**：生产当前仅 1 个活跃学习账号，outcomes 大概率落在 `insufficient_data` 分支——这是诚实行为，需要真实用户积累后才出现 gate PASS。
3. **knowledgePointId→nodeId 覆盖率依赖 NodeMap 种子**：未建映射的历史记录不参与 outcome（设计如此）；提升覆盖率需内容侧补映射，不在本轮范围。
4. **22 项 UI 测试债**与 V6 staging 部署仍按原计划归属后续工作线。

## 7. Git 状态

未提交（遵守 AGENTS.md 第 9 条）。提交时按 `docs/current-sprint.md` §4 的 V6.3 清单精确 `git add`，禁用 `git add -A`。
