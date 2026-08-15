# 架构说明（ARCHITECTURE）

> 维护约定：所有路径以仓库根为基准；信息以代码为准，不确定处标注"待确认"。

## 1. 总览

Monorepo（npm workspaces，见根目录 `package.json`）：

- `apps/web`：React 18 + Vite 前端（ESM）。
- `apps/api`：NestJS 10 后端（CommonJS）。
- `packages/shared`：前后端共享的领域类型与纯函数。
- `prisma`：Schema 与 20 个迁移。
- `scripts` / `test` / `docs` / `deploy` / `kaoyan-408-content-starter`：运维脚本、测试、文档、部署文件、内容资产库。

## 2. 前端架构

- 入口：`apps/web/src/main.tsx` → `App.tsx` 单页应用；无路由库（section 状态切换），无状态库（React hooks + localStorage）。
- API 层：`apps/web/src/api/client.ts`（`authenticatedFetch` 自动注入 Bearer、401 用 refresh token 轮换重试；`isStaticDemoMode` / `isMockAllowed` / `isProduction` 定义 mock 门禁）；`api/endpoints/` 按业务拆分（auth、dashboard、practice、review、sessions、exam、onboarding、teacher、tutor、question-import）。
- 数据 hooks：`apps/web/src/hooks/` 统一 `ModuleResource` 状态（loading / ready / error / mock），生产环境失败进入 error 并显式展示。
- 会话答题：`ExamSession` → `usePracticeSession`（8 秒自动保存、revision 乐观并发、localStorage 断点）。
- 关键文件：`apps/web/src/App.tsx`（主容器，1300+ 行）、`apps/web/src/api/env.ts`、`apps/web/src/studentSessionPolicy.ts`、`apps/web/src/components/ExamSession.tsx`。

## 3. 后端架构

模块装配见 `apps/api/src/app.module.ts`：`PrismaModule`（global）→ `OperationsModule`（global）→ `AuthModule` → `QuestionsModule` → `StudyModule`；全局 `ThrottlerGuard` + `ValidationPipe`；请求中间件记录 `OperationLog`。

### Auth 模块（apps/api/src/auth/）

- 自定义 HMAC-SHA256 JWT（15 分钟）+ 一次性 refresh token（30 天，哈希存 `RefreshToken` 表）。
- 密码 scrypt（`password.ts`）；邀请码注册（`InvitationService` + `InvitationCode`/`InvitationRedemption`）。
- `RoleGuard` + `@Roles(...)` + `@CurrentUser()`；数据隔离在 `StudyController.resolveUserId/assertAccess`（学生只能看自己，教师需授权记录，管理员全量）。
- `demo-login` 仅在 `ALLOW_DEMO_AUTH=true` 时可用（生产关闭）。

### Questions 模块（apps/api/src/questions/）

- `QuestionsService`：内存题目列表 + 启动时 `refreshFromDatabase()` 从 `Question` 表刷新；学生视图经 `question-view.ts` 剥掉答案/解析。
- 导入管道：batch/job/candidate/asset/confirmation 五类表；provider 支持 MinerU、腾讯 OCR、fake（`import/providers/`）；PDF 受 `MINERU_API_TOKEN` / `TENCENTCLOUD_SECRET_ID` 等环境变量门控。

### Study 模块（apps/api/src/study/）

- `StudyController`：50+ 个端点；`StudyService`：3655 行单文件业务编排（已知维护性风险，P2-3）。
- 12 个 repository 类 + `BetaMetricsService`；所有 repository 都有 `.enabled = Boolean(process.env.DATABASE_URL)` 双模式开关。

| Repository | 持久化目标 |
|---|---|
| PracticeRecordRepository | `PracticeRecord` 表（无库时内存） |
| LearningSessionRepository | `LearningSession` 表（会话进度/快照/提交事务） |
| LearningProgressRepository | `StudyTaskCompletion`、`WrongQuestionReview` 表 |
| LearningProfileRepository | `User` 表的诊断字段 |
| OnboardingPlanRepository | `StudyPlan`、`StudyTask` 表（advisory lock 事务） |
| AssessmentHistoryRepository | `AssessmentHistoryItem` 表（评估历史，P2-1） |
| PaperRepository | `Paper` 表（试卷快照，P2-1） |
| SystemConfigRepository | `SystemConfig` 表（单行系统配置，P2-1） |
| ReviewScheduleRepository | `ReviewSchedule`、`ReviewAttempt` 表 |
| ExamReviewPlanRepository | `ExamReviewPlan` 表 + 合并考后任务进 `StudyTask` |
| RuntimeStateRepository | `RuntimeState` 表（questionReviewItems；papers/评估历史/系统配置已迁移至正式表） |
| FeedbackRepository | `FeedbackSubmission` 表 |
| TeacherStudentAuthorizationRepository | `TeacherStudentAuthorization` 表 |
| AdminUserRepository | 只读聚合 `User` + `OperationLog` + `PracticeRecord` |
| KnowledgePointRepository | 已接入 StudyService（P0-1 完成）：启动时从 DB 加载知识点目录，替换内置兜底数组；`POST /knowledge-points` 持久化；`listNodeMaps()` 读取 `KnowledgePointNodeMap` → `KnowledgeNode` 目录命名（P0-2 方案 B） |

## 4. 数据库实体关系

核心关系（`prisma/schema.prisma`）：

- `User` 1-N：`PracticeRecord`、`StudyPlan`、`LearningSession`、`ReviewSchedule`、`WrongQuestionReview`、`StudyTaskCompletion`、`RefreshToken`、`OperationLog`、`FeedbackSubmission`、`ExamReviewPlan`、`InvitationCode`(创建)、`InvitationRedemption`、`UserKnowledgeMastery`、`UserMasterySnapshot`、`UserNodeQuest`（闯关里程碑：userId+knowledgeNodeId 唯一，attempts/bestAccuracy/passed/passedAt）。
- `Question` N-M `KnowledgePoint` 经 `QuestionKnowledgePoint`（复合主键）。
- `KnowledgePoint` N-M `KnowledgeNode` 经 `KnowledgePointNodeMap`（P0-2 方案 B：经典闭环命名/章节经目录解析）。
- `Question` N-1 `QuestionFamily`（版本化：familyId + versionNumber + isCurrent）。
- `PracticeRecord` N-1 `Question` / `KnowledgePoint`（每题只记第一个知识点）；N-1 `LearningSession`（sessionId 可空）。
- `LearningSession` 1-1 `ExamReviewPlan`（sessionId 唯一）。
- `ReviewSchedule` 1-N `ReviewAttempt`；`ReviewSchedule` 与 `WrongQuestionReview` 均对 (userId, questionId) 唯一。
- `StudyPlan` 1-N `StudyTask`；`StudyTaskCompletion` 对 (userId, taskId, completedDate) 唯一。
- 导入体系：`QuestionImportBatch` 1-N Job/Candidate/Asset/Confirmation；`QuestionImportCandidate` 可关联 `QuestionFamily`/`Question`。
- 未使用表：`AiTutorLog`（零写入）。

数据落库矩阵：

- 正式表：User、Question 系、KnowledgePoint、PracticeRecord、LearningSession、WrongQuestionReview、StudyTaskCompletion、StudyPlan、StudyTask、ReviewSchedule、ReviewAttempt、ExamReviewPlan、RefreshToken、InvitationCode、InvitationRedemption、OperationLog、AuditEvent、FeedbackSubmission、TeacherStudentAuthorization。
- 正式表（P2-1 后）：`AssessmentHistoryItem`、`Paper`、`SystemConfig`（原存 RuntimeState JSON，已由迁移 `20260805100000_reporting_tables` 回填）。
- RuntimeState JSON：仅剩 `questionReviewItems`（题库审核队列）。
- 纯内存实时计算：掌握度、薄弱报告、推荐题组、冲刺计划（无表，重启后可回放自 PracticeRecord）。

## 5. API 调用关系

核心端点（方法 / 路径 / 角色 / 说明）：

| 端点 | 角色 | 说明 |
|---|---|---|
| POST /auth/register、login、refresh、logout、change-password | 公开/登录用户 | 认证 |
| POST /auth/demo-login | 公开（env 门控） | 演示登录 |
| GET/POST /questions；PATCH/DELETE /questions/:id | teacher/admin | 题库 CRUD |
| GET /dashboard/overview | student/teacher/admin | 学生总览聚合 |
| GET /knowledge-points、/mastery-map、/sprint-plan、/study-reminders、/trial-progress | student/teacher/admin | 诊断与进度 |
| POST /practice-records | student/teacher/admin | 单题提交 |
| GET /knowledge/mastery、`GET /knowledge/:id`（详情含关联题库题 + 真题命中）、`GET /mastery-trend`（每日快照趋势） | student/teacher/admin | 图谱节点掌握度聚合 + 题库/真题接入 + 报告图谱化（阶段 1/3/4） |
| GET /practice-sets/recommended、POST /practice-sets/:id/submit | student/teacher/admin | 推荐题组 |
| POST /sessions/practice/start、/:id/save、/:id/submit | student/teacher/admin | 会话答题 |
| GET/POST /wrong-questions/...、/review/due、/wrong-questions/:id/reason | student/teacher/admin | 错题与复习 |
| GET /assessments/stage、POST /assessments/stage/submit | student/teacher/admin | 阶段小测 |
| POST /onboarding/complete、GET /onboarding/status、GET /today/plan、POST /tasks/:id/... | student/teacher/admin | 引导与计划 |
| POST /exam/papers/prepare、GET /exam/report/:sessionId、POST /exam/review-tasks/:sessionId、GET /exam/score-history | student/teacher/admin | 模拟考试 |
| GET /assessment-history、/reports/overview、/students/:userId/profile | student/teacher/admin | 报告数据 |
| GET/POST /admin/* | admin | 运营 |
| GET /teacher/class-analytics | teacher/admin | 班级分析 |
| POST /admin/question-imports（及子路径） | admin | 文档导入 |

前端调用映射：`useAuth` → auth；`useDashboardOverviewData` → dashboard/overview；`useStudentProgressData` → trial-progress/study-reminders/sprint-plan/mastery-map/learning-profile；`useStudentLearningData` → practice-sets/review-resources/wrong-questions/summary/assessment-history；`usePracticeSession` → sessions/*；`ExamReport` → exam/*。

## 6. 用户答题到掌握度更新的数据流

1. 提交：单题走 `POST /practice-records`；会话走 `POST /sessions/practice/:id/submit`（`StudyController` → `StudyService`）。
2. 判题：`buildPracticeRecord`（`study.service.ts`）用 `packages/shared/src/learning.ts` 的 `classifyMistake` 判定正误并归类错因（概念不清/知识点混淆/审题问题/计算失误/速度偏慢）。
3. 落库：`PracticeRecordRepository.save`（DB 存在时写 `PracticeRecord` 表），同时 push 进内存 `this.records`。
4. 错题联动：`ensureReviewSchedule` 对错题创建次日 `ReviewSchedule`；`listWrongQuestions` 由 `this.records` 实时推导错题本。
5. 掌握度/薄弱：`getMasteryMap` 与 `computeWeaknessReport` 基于内存 records + 知识点目录实时计算；DB 存在时目录来自 `KnowledgePoint` 表（P0-1 完成，导入的 16 个粗粒度点参与闭环），无库时回退内置 4 个兜底点。
6. 推荐与计划：`getRecommendedPracticeSet`、`getRecommendedReviewResources`、`generatePlan` 消费薄弱报告；`completeStudyTask`/`generatePostExamReviewTasks` 调整 `StudyTask`。
7. 报告：`getExamReport` 由会话快照 + records 计算；`getAssessmentHistory` 读内存/`AssessmentHistoryItem` 表（P1-1 已修复会话提交写历史；P2-1 已转正式表）。

## 7. 认证流程

- 注册：邀请码 → `InvitationService.registerStudent` → 创建 `User(STUDENT)` + `InvitationRedemption` → `createSession`。
- 登录：email + scrypt 校验 → `createSession`（签发 access + 落 refresh）。
- 刷新：refresh token 一次性轮换（`refresh` 接口校验 tokenHash/过期/未吊销）。
- 登出：吊销 refresh token。
- 改密：验证旧密码 → 更新 hash、吊销全部 refresh、写 `AuditEvent`。
- 前端：localStorage 保存会话；`auth-session-updated`/`auth-session-expired` 事件；`authenticatedFetch` 401 自动刷新。

## 8. 部署结构

- 生产：`compose.production.yml`（postgres:16 + app:3000 + nginx 网关:80 + backup profile）；API 容器启动先执行 `prisma migrate deploy`；数据卷 `postgres_data`、`question_import_data`。
- GitHub Pages：静态演示（无后端 → mock 模式）；`.github/workflows/deploy-pages.yml` 在推送 `codex/deployment-ready` 时运行单元测试、PostgreSQL 集成测试、备份校验、构建后发布。
- 其他：`railway.toml`（Dockerfile + /health）、`vercel.json`、`netlify.toml`、`deploy/tencent-ip/`（nginx + backup.sh）。
- 环境安全：`apps/api/src/main.ts` 在 production/staging 执行 `validatePublicEnvironment`（强制 HTTPS、JWT 长度、`ALLOW_DEMO_AUTH=false` 等）。

## 9. 关键设计决策

1. 自定义 JWT（零第三方依赖）。
2. 双模式数据源：无 `DATABASE_URL` 时内存演示数据，便于离线开发与静态演示。
3. 共享纯逻辑（`packages/shared`）：判题、错因、薄弱、计划在前端与后端共用同一套规则。
4. 会话 revision 乐观锁 + 8 秒自动保存 + 题目快照，支持断点恢复与并发安全。
5. 计划变更使用 PostgreSQL advisory lock，保证同一用户计划串行化；考后任务幂等合并。
6. 导入管道：内容指纹去重、候选人工审核、资产留存、provider 可插拔。
7. 评估历史/试卷/系统配置已从 `RuntimeState` 迁移至正式表（P2-1 完成），`RuntimeState` 仅保留审核队列等运行时状态。
8. 内容审核流水线：teacher/AI 内容 pending → approved / needs_recheck。

## 10. 已知架构风险（详见 docs/ROADMAP.md）

- 经典闭环（`KnowledgePoint`，粗粒度 16 点）与“今日提分”引擎（`KnowledgeNode` 全量目录 + `UserKnowledgeMastery`）两套掌握度口径并存（P2-2），目录接入经典闭环的方案见 `docs/superpowers/specs/2026-08-14-knowledge-catalog-engine-design.md`。
- 评估历史双路径不一致（P1-1 已修复）；评估历史/试卷/系统配置已转正式表（P2-1 完成）。
- 内存缓存 + 多实例一致性（当前部署为单实例，多实例方案待确认）。
- StudyService / App.tsx 巨型单文件（P2-3）。
- 掌握度两套口径并存（P2-2）。
