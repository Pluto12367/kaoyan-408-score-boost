# PROJECT_MAP — 代码导航地图

> 生成时间：2026-08-28 · 分支：`feature/v3-product-refactor`（大量 2.8 阶段改动未提交）
> 本文档为只读导航产物，基于仓库实际代码扫描生成，不含推测。

## 仓库总览

Monorepo（npm workspaces，根 `package.json` `"type": "module"`，API 子包为 CommonJS）：

```
apps/api          NestJS 10 + Prisma + PostgreSQL（CommonJS）
apps/web          React 18 + Vite（无路由库，自管 section 状态）
packages/shared   共享领域类型 + 纯函数（@kaoyan408/shared，ESM 构建）
prisma/           PostgreSQL schema 与迁移（31+ 迁移目录）
scripts/          运维/种子/验证/集成脚本（.mjs）
test/             200+ 个 node:test 用例文件（.test.js）
data/408/         知识目录、频率模型、历年真题标注等静态数据源
```

---

## 1. apps/api 核心模块关系

入口 [main.ts](apps/api/src/main.ts)：CORS（WEB_ORIGIN 白名单）、请求日志中间件（写 `OperationLog`）、ValidationPipe、Throttler 全局限流（60 次/分钟）。

### 模块树（[app.module.ts](apps/api/src/app.module.ts)）

```
AppModule
├── HealthController          @Controller('health')
├── PrismaModule              PrismaService（全局数据库访问）
├── OperationsModule          OperationLogService / AuditEventService
├── AuthModule                @Controller('auth') + @Controller('admin')（账号管理）
├── QuestionsModule           @Controller('questions') + 题目导入流水线
├── StudyModule               @Controller()（无前缀，~50 条学生/教师/管理路由）
└── ScoreCenterModule         @Controller()（knowledge/mastery 等 408 提分中心路由）
```

依赖方向：`StudyModule → AuthModule + QuestionsModule + PrismaModule + ScoreCenterModule`；`ScoreCenterModule → PrismaModule`。

### AuthModule（apps/api/src/auth/）

- `auth.service.ts`（280 行）：登录/注册/改密，RefreshToken 轮换；`ALLOW_DEMO_AUTH=true` 时启用演示登录。
- `invitation.service.ts` + `invitation-policy.ts`：邀请码注册管控。
- `account-admin.service.ts` + `admin-accounts.controller.ts`：管理员建号。
- 守卫体系：`role.guard.ts`（`@Roles()` 装饰）、`student-access.guard.ts`（教师看学生数据需 `TeacherStudentAuthorization`）。

### StudyModule（apps/api/src/study/）— 核心，正在 CQRS 迁移

- **[study.controller.ts](apps/api/src/study/study.controller.ts)**（758 行）：`@Controller()` 无全局前缀。路由按阶段分区：
  - 基础读：`GET dashboard/overview`、`student-state`、`trial-progress`、`study-reminders`、`sprint-plan`、`mastery-map`、`learning-calendar`
  - 练习：`GET practice-sets/recommended`、`POST practice-sets/:id/submit`、`POST practice-records`（强制 `Idempotency-Key`，走 `AnswerReceipt`）
  - 错题/复习：`GET wrong-questions[+summary/detail]`、`GET review/due`、`POST wrong-questions/:id/review|reason`、`PATCH .../note`
  - 计划任务：`GET today/plan`、`POST tasks/:id/start|postpone|reschedule`、`tasks/rebalance`、`study-tasks/:id/complete`
  - 测评/模考：`GET/POST assessments/stage[+submit]`、`GET assessment-history`、`GET reports/overview`（**仍是 legacy 直调**）、`GET exam/score-history`、`POST exam/papers/prepare`、`GET exam/report/:sessionId`、`POST exam/review-tasks/:sessionId`、`GET/POST papers...`
  - 会话：`sessions/practice/start|save|submit`、`sessions/active`
  - 引导：`onboarding/status|complete`、`diagnostics/profile`
  - AI：`ai/tutor-reply`、`ai/follow-up`
  - 管理：`admin/metrics|users|feedback|review-queue|system-config|teacher-authorizations`、`teacher/class-analytics`
  - 越权控制辅助：`resolveUserId()`（admin 可代查任意学生，teacher 需授权）、`assertAccess()`
- **[study.service.ts](apps/api/src/study/study.service.ts)**（4965 行）：legacy 巨型编排服务，拥有多数写路径与遗留读路径（含 `getOverviewReport()`、内存 `nodeMasteryByUser` 缓存）。**迁移只拆读路径，不动写路径。**
- **CQRS 读路径四件套**（Projection → Snapshot → Selector → Adapter → Query → Controller）：

| 读路径 | projection | snapshot | selector | adapter | query |
|---|---|---|---|---|---|
| Dashboard | ✅ | ✅ | — | ✅ | ✅ |
| AssessmentHistory | ✅ | ✅ | — | ✅ | ✅ |
| ExamScoreHistory | ✅ | ✅ | — | ✅ | ✅ |
| WrongQuestion | ✅ | ✅ | — | ✅ | ✅ |
| TodayPlan | ✅ | ✅ | — | ✅ | ✅ |
| StageAssessment | ✅ | ✅ | ✅ `stage-assessment.selector.ts`（唯一 Selector 范本） | ✅ | ✅ |
| **OverviewReport** | —（缺） | ✅ `overview-report.snapshot.ts` | ❌ **Phase 2.8.5 目标** | —（缺） | —（缺） |

- 辅助投影：`student-state-projection.service.ts`（312 行，跨域学生状态快照）、`mastery-summary-projection.service.ts`（382 行，`UserKnowledgeMastery` 汇总 + 兼容 `toReportMasteryDto`）、`activity-projection.service.ts`、`task-progress-consistency-checker.service.ts`（673 行，任务进度一致性校验）。
- Repository 层（~17 个，均注入 Prisma）：`practice-record`、`answer-receipt`、`learning-progress`、`learning-profile`、`learning-session`、`review-schedule`、`exam-review-plan`、`onboarding-plan`（449 行）、`paper`、`assessment-history`、`knowledge-point`、`admin-user`、`feedback`、`user-event`、`ai-tutor-log`、`teacher-student-authorization`、`system-config`、`runtime-state`（JSON KV）。
- AI：`ai-tutor.service.ts` + `deepseek-client.ts`（DeepSeek 接入，日志入 `AiTutorLog`）。
- 幂等：`answer-request-hash.ts` + `AnswerReceipt`（`@@unique([userId, idempotencyKey])`）。

### ScoreCenterModule（apps/api/src/score-center/）

408 提分中心，基于 `KnowledgeNode` 体系的新读路径（**未走 CQRS 四件套**）：

- [routes.ts](apps/api/src/score-center/routes.ts)：`GET knowledge/mastery`、`GET mastery-trend`、`GET knowledge/:id[+quest]`、`GET wrong-questions/:id/exam-links`、`POST knowledge/:id/quest/complete`、`POST score-center/generate`（每日计划，失败回退最近有效计划并标 `stale`）。
- `service.ts`（685 行）+ `repository.ts`（499 行，含乐观锁 `version` 字段更新 `UserKnowledgeMastery`）。

### QuestionsModule（apps/api/src/questions/）

- `questions.controller.ts`：`@Controller('questions')` 查询 + `@Controller('teacher/questions')` 教师增删改；`ai-variant.service.ts`（AI 变式题）。
- `import/`（题库文档导入流水线，约 20 个文件）：
  - 控制器：`admin/question-imports`、`admin/question-import-assets`、`admin/question-import-candidates`
  - 解析提供方：`providers/mineru.provider.ts`（MinerU OCR）、`tencent-page-ocr.provider.ts`、`fake-document.provider.ts`（测试桩）
  - 流程：上传 → `import-batch.service` → `import-worker.service`（581 行，租约式任务）→ `import-candidate.service`（386 行，候选审校）→ `import-confirmation.service`（幂等确认）→ 落库 `Question`
  - 配套：`import-storage.service`（673 行，文件/资产存储）、`import-validation`、`table-import.parser`（表格卷解析）、`pdf-document.service`

---

## 2. apps/web 页面结构

**无 react-router**。单入口 [App.tsx](apps/web/src/App.tsx)（1765 行）自管 `section` 状态 + 角色布局，重模块用 `React.lazy` 做 section 级代码分割。

### 导航结构（[RoleNavigation.tsx](apps/web/src/layouts/RoleNavigation.tsx)）

| 角色 | 一级 section | 说明 |
|---|---|---|
| student | `dashboard`（首页）/ `question`（题库）/ `knowledge-catalog`（知识）/ `wrong-book`（错题）/ `test`（测试） | 移动端有同套底部导航；兼容旧 section：`plan`/`score-center` → `dashboard`，`report` → `test` |
| teacher | `teacher`（题库与班级）/ `report`（学情报告）/ `ai`（AI 辅助） | |
| admin | `admin`（数据看板）/ `review`（内容审核）/ `config`（系统配置）/ `teacher`（教研管理）/ `question-import`（题库文档导入） | |

### 功能区映射（features/）

- **学生首页/仪表盘**：`features/student/home/StudentHome.tsx`、`StudentLearningConsole.tsx`、`NextLearningStepCard.tsx`、`GoalProgressInsight.tsx`、`StudentSections.tsx`（332 行，学生各 section 工作区宿主）；仪表盘卡：`features/dashboard/*`、`features/onboarding/StudentLaunchpad.tsx` + `TodayLearningRouteView.tsx`
- **练习/考试**：`components/ExamSession.tsx`（509 行，答题会话）、`ExamReport.tsx`、`features/practice/PracticePanel.tsx`、`features/test/TestSection.tsx`、`components/TodayPlan.tsx`、`ResumeSessionBanner.tsx`（会话续答）
- **错题**：`features/mistakes/MistakeWorkspace.tsx`、`components/WrongQuestionDetail.tsx`、`ErrorReasonSelector.tsx`
- **知识目录**：`features/knowledge-catalog/KnowledgeCatalog.tsx` + `KnowledgeTree.tsx` + `KnowledgePointDetailDrawer.tsx`
- **测评/报告**：`features/assessment/StageAssessmentPanel.tsx` + `AssessmentHistoryPanel.tsx`、`features/report/ReportWorkspace.tsx`（含 `StageReportPanel`、`MasteryTrendPanel`、`ReportSummaryPanel`、`WeaknessReportPanel`）
- **今日提分中心**：`features/today-score-center/TodaysScoreCenter.tsx` + `RecommendationCard` + `WhyRecommendedDrawer`
- **教师/管理**：`features/teacher/TeacherWorkspace.tsx` + `useTeacherActions.ts`；`features/admin/AdminWorkspace.tsx` + `question-import/*`（导入候选审校台 `CandidateReview.tsx` 331 行）
- **账号/通用**：`features/auth/AccountPanel.tsx`、`features/tutor/TutorPanel.tsx`（AI 答疑）、`features/feedback/FeedbackPanel.tsx`、`components/OnboardingWizard.tsx`、`components/RoleGate.tsx`

### API 客户端层（apps/web/src/api/）

- [env.ts](apps/web/src/api/env.ts)：**mock 策略的唯一开关**——静态演示模式（无 API）与本地 DEV 允许 mock，生产/预发禁止。
- `client.ts`：fetch 封装、token 刷新；`refreshGate.ts`：刷新并发去重。
- `endpoints/`：按域拆分 13 个端点模块（auth、dashboard、practice、sessions、review、exam、onboarding、score-center、question-import、teacher、trend、tutor）。
- `types.ts`（769 行）：前端 DTO 类型镜像；`mocks/dashboard.ts`：演示数据。

---

## 3. packages/shared 职责

**只放领域类型与纯函数，无 I/O、无框架依赖**，被 API 与 Web 双向引用（`@kaoyan408/shared`）。

| 文件 | 职责 |
|---|---|
| `domain.ts` | 基础领域类型：`UserProfile`、`UserRole`、`Subject`、`MistakeReason`、题目/练习记录等共享形状 |
| `learning.ts`（744 行） | 核心算法：`computeWeaknessReport()`（legacy Overview 报告）、掌握度/推荐相关纯计算 |
| `nodeMastery.ts` / `nodePlan.ts` | 基于 `KnowledgeNode` 的掌握度模型与计划生成纯逻辑（新体系） |
| `score-center/*` | 提分中心：`types`、`mastery`、`plan`（每日计划生成）、`priority`（优先级打分） |
| `knowledgeCatalog.ts`（645 行） | 408 知识目录树构建/过滤/搜索/首屏高亮（供前端知识地图） |
| `knowledgeEvidence.ts` / `knowledgeDisplay.ts` | 考频证据结构与目录展示映射 |
| `stageReport.ts` | `computeStageReport()` 阶段报告纯计算 |
| `learningProfile.ts` / `learningInsight.ts` | 学习画像与洞察计算 |
| `postExamScheduling.ts` | 考后复习任务调度算法 |
| `ai-tutor.ts`（371 行）/ `ai-variant.ts` | AI 家教提示词/响应契约、变式题契约 |
| `questionImport.ts` / `questionImport.server.ts` | 导入候选/批次契约（后者仅服务端） |
| `assessmentHistorySummary.ts` / `feedback.ts` | 测评历史汇总、反馈契约 |

约束（来自交接文档）：判题、掌握度、计划算法改动必须做同步影响分析；Selector/推荐文案不得进入 shared 事实层。

---

## 4. Prisma 数据模型关系

数据源：PostgreSQL。按领域分组（完整定义见 [schema.prisma](prisma/schema.prisma)，1006 行，34 个 model）：

### 账号与权限

`User`（角色/试用状态/目标画像）→ `RefreshToken`、`InvitationCode`/`InvitationRedemption`、`TeacherStudentAuthorization`（教师-学生查看授权）、`OperationLog`、`AuditEvent`、`UserEvent`、`FeedbackSubmission`

### 内容：题库

```
QuestionFamily 1─N Question（familyId+versionNumber 唯一，isCurrent 标记现行版本）
Question N─N KnowledgePoint（QuestionKnowledgePoint 中间表，legacy ID 空间）
Question 1─N PracticeRecord / WrongQuestionReview / ReviewSchedule
Question ←─ QuestionImportCandidate（导入来源追踪）
```

### 内容导入流水线

`QuestionImportBatch`（文件级，fileSha256 去重）1─N `QuestionImportJob`（分页任务，租约重试）1─N `QuestionImportCandidate`（候选，指纹去重）→ 审校后转 `Question`；`QuestionImportAsset`（OCR 图像资产，temporary→permanent 晋升）、`QuestionImportConfirmation`（幂等确认）。

### 学习行为（学生核心事实）

```
User ── PracticeRecord（答题记录：对错/耗时/错因/自评，knowledgePointId 为 legacy 外键）
     ── LearningSession（练习/模考会话，questionSnapshot 冗余、revision 乐观锁）1─1? ExamReviewPlan
     ── WrongQuestionReview（错题回顾，@@unique(userId,questionId)）
     ── ReviewSchedule（间隔复习排期：stability/nextReviewAt）1─N ReviewAttempt
     ── StudyTaskProgress（任务累计进度）/ StudyTaskCompletion（按日完成记录）
```

### 计划

`StudyPlan`（phase/targetScore/checkpoint，stale 标记）1─N `StudyTask`（同时挂 `knowledgePointId` 文本与可选 `knowledgeNodeId` 外键——**两套 ID 空间并存的关键现场**）。

### 测评与试卷

`AssessmentHistoryItem`（测评成绩快照）、`Paper`（教师卷，questions 为 Json）。

### 408 提分中心（新证据层，ScoreCenter 使用）

```
KnowledgeNode（自引用树：parentId；subject/nodeType/importance）
├── KnowledgeRelation（前置/关联/跨科/易混/取代）
├── ExamPaper 1─N ExamQuestion N─N KnowledgeNode（ExamQuestionKnowledgeTag：role/confidence/precision/tagger）
├── KnowledgeFrequencySnapshot（考频快照：近3/近5/全时段 + 趋势）
├── UserKnowledgeMastery（用户原子掌握度，@@unique(userId,knowledgeNodeId)，version 乐观锁）★ 长期权威掌握度
├── UserMasterySnapshot（掌握度历史快照）
└── UserNodeQuest（节点闯关：bestAccuracy/passed）
```

**桥接层**（新旧体系连接，也是已知风险点）：
- `KnowledgePointNodeMap`：legacy `KnowledgePoint` ↔ 新 `KnowledgeNode`
- `QuestionKnowledgeNodeTag`：题库 `Question` → `KnowledgeNode`

### 运行时与配置

`RuntimeState`（JSON KV 运行时状态）、`SystemConfig`（推荐参数）、`AiTutorLog`、`AnswerReceipt`（答题提交幂等回执，`@@unique(userId,idempotencyKey)`）。

---

## 5. 测试体系入口

测试框架：**Node.js 内置 `node:test`**（无 Jest），用例全部位于根 `test/` 目录，命名 `*.test.js`（200+ 文件，含约 90 个 2.8 阶段新增未提交文件）。

### 命令入口（根 `package.json`）

| 命令 | 作用 |
|---|---|
| `npm test` | `build:shared` + `node --test`（全量单测/契约测试） |
| `npm run check:local` | `node --test` + `verify-ui.mjs` |
| `npm run build:api` / `build:web` | 构建与类型检查门禁 |
| `npm run test:integration:postgres` | PostgreSQL 集成测试（先 `db:test:up` 起 `compose.test.yml` 测试库） |
| `npm run test:integration:import-first` / `content-import` / `question-import` | 导入链路集成测试 |
| `npm run verify:ui` | 前端静态验证脚本 |
| `npm run verify:*` | 端到端场景验证：`p0-student`（核心闭环）、`full-student`、`deep-interactions`、`node-quest`、`graph-convergence`、`deployed`、`api-build-layout`、`pdf-runtime-tools` |
| `npm run smoke:migration` / `smoke:staging` / `smoke:production-compose` | 迁移/预发/生产冒烟 |
| `npm run check:release` | 发布门禁全链：test + api 布局验证 + web 构建 + 迁移冒烟 |

### 测试命名约定（按 CQRS 层成组）

每个已迁移读路径通常有一组：`*-projection.test.js`、`*-snapshot-contract.test.js`、`*-adapter.test.js`、`*-query(-parity).test.js`、`*-legacy-parity.test.js`、`*-controller-wiring.test.js`。新增测试应遵循该分组（交接文档明确要求：先查现有 selector 测试再新增，参考 `stage-assessment-selector.test.js`）。

---

## 附：当前阶段定位（导航时的注意事项）

- 当前处于 **Phase 2.8.5 前置阶段**：`OverviewReportSnapshot` 已存在，`OverviewReportSelector` 待建（目标文件 `apps/api/src/study/overview-report.selector.ts`，范本 `stage-assessment.selector.ts`）。
- `/reports/overview` 仍直调 `StudyService.getOverviewReport()`（legacy `computeWeaknessReport()` + `UserKnowledgeMastery` 叠加的混合读模型）。
- 工作区存在大量未提交改动（27 个修改文件 + 3 个新迁移），导航/修改前先 `git status` 确认基线。
- 两套知识 ID 空间（`knowledgePointId` legacy vs `knowledgeNodeId` 新）贯穿题库、计划、掌握度与前端，改动时须显式区分（见 `docs/handoff/known-risks.md`）。
