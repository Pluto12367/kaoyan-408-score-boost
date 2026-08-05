# 项目上下文（PROJECT_CONTEXT）

> 维护约定：本文档是 AI 代理与开发者的共享上下文。信息一律以代码为准；发现不一致时更新本文档，并在 `docs/DEVELOPMENT_LOG.md` 记录。最后核对基线：commit `333ec3c`（分支 `codex/deployment-ready`），日期 2026-08-05。

## 1. 产品目标

本项目是面向计算机考研 408 的个性化提分系统，而不是普通题库。系统最终要帮助用户回答 5 个问题：

1. 我当前哪些知识点薄弱？
2. 为什么会做错？
3. 下一步应该学习什么？
4. 应该练习哪些题？
5. 一段时间后是否真正提高？

## 2. 目标用户

- 学生：408 备考者，需要诊断、学习计划、刷题、错题复盘、阶段测验与报告。
- 教师：维护题库与知识点、查看授权学生的学情（班级分析）。
- 管理员：邀请码/账号管理、内容审核、文档导入队列、运营指标。

当前只聚焦 408 四科（数据结构、计算机组成原理、操作系统、计算机网络），不提前扩展数学、英语、政治。

## 3. 408 提分核心闭环

登录 → 初始诊断 → 生成学习计划 → 章节练习或专项训练 → 提交答案 → 查看解析 → 关联知识点 → 更新掌握度 → 记录错题和错误原因 → 识别薄弱知识点 → 推荐复习与变式训练 → 阶段测试 → 生成学习报告。

## 4. 当前真实技术栈

| 层 | 技术 | 依据 |
|---|---|---|
| 前端 | React 18.3 + TypeScript 5.5 + Vite 5.4；无路由库、无状态管理库（单页 + hooks + localStorage） | `apps/web/package.json`、`apps/web/src/App.tsx` |
| 后端 | NestJS 10.4 + TypeScript（CommonJS）；自研 HMAC-SHA256 JWT + scrypt 密码 | `apps/api/package.json`、`apps/api/src/auth/auth.service.ts` |
| 数据库/ORM | PostgreSQL 16 + Prisma 5.18，28 个 model、20 个迁移 | `prisma/schema.prisma`、`prisma/migrations/` |
| 共享域逻辑 | `packages/shared`：类型 + 判题/薄弱/计划纯函数 | `packages/shared/src/learning.ts`、`domain.ts` |
| 测试 | Node 内置 `node:test`（35 个测试文件）；PostgreSQL 集成脚本 | `test/`、`scripts/integration-postgres.mjs` |
| 部署 | Docker Compose（API+nginx+PostgreSQL+备份）、Railway、Vercel、Netlify、GitHub Pages、腾讯云脚本 | `compose.production.yml`、`Dockerfile`、`.github/workflows/deploy-pages.yml`、`deploy/tencent-ip/` |

## 5. 已实现模块

| 模块 | 状态 | 关键文件 |
|---|---|---|
| 登录/邀请注册/刷新/登出/改密 | 完整可用 | `apps/api/src/auth/`、`apps/web/src/hooks/useAuth.ts` |
| 管理员账号与邀请码管理 | 完整可用 | `apps/api/src/auth/account-admin.service.ts`、`invitation.service.ts` |
| 角色权限与数据隔离 | 完整可用 | `apps/api/src/auth/role.guard.ts`、`apps/api/src/study/study.controller.ts`（resolveUserId/assertAccess） |
| 题库 CRUD + 审核队列 | 完整可用（内置仅 2 题，内容依赖导入） | `apps/api/src/questions/questions.service.ts` |
| 文档导入（CSV/XLSX/PDF、候选审核、去重） | 完整可用（PDF 依赖外部 token） | `apps/api/src/questions/import/` |
| 320 道自编题内容库 | 完整可用（质量需教研复核） | `kaoyan-408-content-starter/imports/starter-320-questions.csv`、`scripts/import-questions.mjs` |
| 初始诊断 | 完整可用 | `apps/api/src/study/study.service.ts`（applyDiagnosticProfile） |
| 七天学习计划 + 今日任务 + 完成度调整 | 完整可用 | `apps/api/src/study/onboarding-plan.repository.ts` |
| 单题练习、判题、错因分类 | 完整可用 | `study.service.ts`（createPracticeRecord/buildPracticeRecord） |
| 推荐题组、阶段小测 | 完整可用（依赖题库内容量） | `study.service.ts`（getRecommendedPracticeSet/getStageAssessment） |
| 练习会话（快照、自动保存、断点恢复） | 完整可用 | `apps/api/src/study/learning-session.repository.ts`、`apps/web/src/hooks/usePracticeSession.ts` |
| 错题本（聚合、错因统计、重做） | 完整可用 | `study.service.ts`（listWrongQuestions/getWrongQuestionSummary） |
| 间隔复习（1/3/7/14 天） | 完整可用 | `apps/api/src/study/review-schedule.repository.ts` |
| 模拟考试 + 考试报告 + 考后复习任务 + 成绩趋势 | 完整可用（历史写入有缺口，见 P1-1） | `study.service.ts`（submitPracticeSession/getExamReport/generatePostExamReviewTasks） |
| 学习日历/连击、提醒、冲刺计划 | 完整可用 | `study.service.ts`（getLearningCalendar/getStudyReminders/getSprintPlan） |
| 学习画像/时间线 | 完整可用 | `study.service.ts`（getStudentLearningProfile） |
| 管理看板（运营指标、用户、审核、反馈） | 完整可用 | `apps/api/src/study/beta-metrics.service.ts`、`admin-user.repository.ts` |
| 教师班级分析 | 完整可用 | `study.service.ts`（getTeacherClassAnalytics） |

## 6. 未实现/不完整模块

- 学习报告：无独立报告页/接口，由 `dashboard/overview`、`students/:id/profile`、`mastery-map`、`assessment-history`、`exam/report/:sessionId` 组合。
- 掌握度：无持久化表，实时计算，且只覆盖内置 4 个知识点（P0-1）。
- AI 答疑：模板规则实现、无真实模型调用；`AiTutorLog` 表存在但从未写入（P1-3）。
- 评估历史：非正式表（存于 `RuntimeState` JSON），会话模式考试不写入（P1-1）。

## 7. Mock 与硬编码位置

- `apps/web/src/mockData.ts` + `apps/web/src/api/mocks/dashboard.ts`：静态演示模式（github.io 且无 `VITE_API_BASE_URL`）与本地 DEV 的 mock 工厂。
- `apps/api/src/study/study.service.ts`：无 `DATABASE_URL` 时的内存数组（演示学生 u-001、4 个知识点、2 道内置题、3 条演示答题记录、1 条演示评估历史、演示教师-学生授权）。
- 内置题目 q-001/q-002 与 4 个内置知识点：`apps/api/src/questions/questions.service.ts`、`apps/api/src/study/study.service.ts`。
- 前端 AI 答疑入口硬编码 `selectedAnswer: 'A'`：`apps/web/src/App.tsx`（handleAskTutor）。
- 生产环境 `isMockAllowed() === false`，API 失败显式报错（`apps/web/src/api/env.ts`）。

## 8. 当前主要问题（详见 ROADMAP）

- P0：知识点目录未接入学习引擎，核心闭环只对 4 个内置知识点真实生效。
- P1：会话模式考试不写评估历史；全新库"先导入后启动"有启动崩溃风险；AI 答疑模板化 + 硬编码；题库内容正式入库流程待固化。
- P2：评估历史/试卷/系统配置存 RuntimeState JSON；掌握度两套口径；StudyService/App.tsx 单文件过大；多知识点题目只记首点；演示模式标识不醒目。

## 9. 项目范围与暂不开发事项

- 不开发：多 Agent、复杂知识图谱可视化、3D 页面、过度动画、无真实数据支持的 AI 功能、与核心提分闭环无关的功能。
- 不提前扩展数学、英语、政治。
- 禁止未经确认的大规模重构、框架迁移、目录重写。
- 保留现有可用的 API、路由、数据库结构与业务逻辑。

## 10. 关键事实核对记录

- 数据库：PostgreSQL + Prisma，28 个 model，20 个迁移（`prisma/migrations/`）。
- 内容库：`starter-320-questions.csv` 共 320 行，16 个知识点（ds-list/ds-tree/ds-graph/ds-sort、co-data/co-cache/co-instruction/co-cpu、os-process/os-sync/os-memory/os-file、net-link/net-ip/net-tcp/net-app）。
- 测试：`test/` 35 个文件；`CLAUDE.md` 中"8 文件 46 测试 / 19 models"的描述已过时，以本文件与代码为准。
