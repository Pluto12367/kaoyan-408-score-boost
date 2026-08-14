# 开发日志（DEVELOPMENT_LOG）

> 使用说明：每完成一个可验证的任务（含文档任务）追加一条记录；按时间正序追加。字段缺失填"无"。涉及业务代码的任务必须附测试命令与结果摘要；文档任务注明"未运行测试"。

## 记录模板

```markdown
### YYYY-MM-DD 任务标题

- 日期：YYYY-MM-DD
- 任务：一句话描述
- 修改原因：
- 修改文件：
- 数据库变化：无 / 迁移名 + 影响说明
- API 变化：无 / 端点与响应变化
- 测试结果：命令 + 结果摘要
- 截图或验证证据：文件路径或说明
- 遗留问题：
- 下一步：
```

## 当前状态（下次开工先看这里）

- 分支/提交：`codex/deployment-ready`，2026-08-14“学习路径下一步入口统一强化”已提交并推送（`2de4abe`，与 origin 同步），线上部署站点已通过浏览器实测（五个学习面卡片全部出现、按钮跳转正确、移动端竖排正常）；浏览器实测发现的 aria-label 重复缺陷已修复（未提交）；新增 `verify:deployed` 部署冒烟脚本（未提交）；正在实施 P0 知识点目录接入学习引擎。
- 分支/提交：`codex/deployment-ready`，第三轮（2026-08-07）待确认项实现**尚未提交**：前端细粒度埋点、AI 变式题入库、P2-3 安全拆分（导航/日期/摘要抽取）已完成；`npm test` 321 项 320 通过、`build:api`/`build:web` 通过、`test:integration:postgres` `ok: true`。
- 分支/提交：`codex/deployment-ready`，第二轮 UX/工程收尾改动（2026-08-06）**尚未提交**；P2-01~P2-08 全部关闭，阶段2（动态计划 + 历史成绩导入）、P2-4 多知识点、P2-5 演示标识、P3-1 教师端分页、错题筛选服务端化、行为埋点已完成；全量 `npm test` 311 项 310 通过、`build:api`/`build:web` 通过、`test:integration:postgres` `ok: true`。
- 分支/提交：`codex/deployment-ready`，本轮（2026-08-06）UX 收尾改动**尚未提交**；工作区含 P1-01/P1-02/P1-03(seed)/P1-04/P1-05/P1-06/P1-07/P1-08/P2-02/P2-04/P2-07 修复与 8 个新测试文件；`npm test` 285/286 通过、`build:api`/`build:web` 通过、`test:integration:postgres` `ok: true`。
- 分支/提交：`codex/deployment-ready`，阶段 7 已提交并推送（commit `d60b1f4`，已与 origin 同步）
- 本次范围：阶段 7：DeepSeek V4-Flash 真实模型调用（`AI_API_KEY` 配置后启用，未配置回退标准解析模板）；提示词自动携带题目/选项/标准答案/解析/知识点/错因/最近错题；四层分层提示（考点→思路→部分步骤→完整解析，一次生成、前端逐层展开）；5 类快捷追问 + 自由提问；`AiTutorLog` 写库（真实调用成功/失败均记录）；`.env.development` 加入 .gitignore 防 Key 泄露
- 模型选择：DeepSeek `deepseek-v4-flash`（base `https://api.deepseek.com`，输入约 ¥1/百万、输出约 ¥2/百万，旧模型名 deepseek-chat/reasoner 已于 2026-07-24 弃用）
- 验证结果：`npm run build:api` 通过；`npx tsc -p apps/web/tsconfig.json --noEmit` 通过；`npm test` 248 项：246 通过 / 1 失败（`admin user cards show email` 沙箱 esbuild `Access denied`，与本次无关）/ 1 跳过；新增 14 项 stage 7 测试全过；`npm run build:web` 需用户本机补跑
- 遗留事项：
  1. 用户本机 `.env.development` 配置 `AI_API_KEY`（参考 `.env.development.example`）后，手动联调真实模型答疑（见 docs/DEVELOPMENT_LOG.md 手动验收）。
  2. 非沙箱环境补跑：`npm run build:web`、`npm run check:release`、集成测试（`npm run test:integration:postgres`）。
  3. 提交并推送阶段 7 后，服务器 `.env.production` 添加 `AI_API_KEY` 并按 `docs/deploy-to-tencent-ip.md` §5 升级（compose 已透传 AI 变量）。
  4. `fetchWrongQuestions(filters)` 端点已提供但 UI 暂用前端筛选，后续可切换服务端筛选。
  5. 已知限制：学习模式会留下 practice_set 草稿会话；综合题学习模式不自动判分；AI 调用失败时后端抛 503，前端显示“重试”（无静默回退）。
  6. 下一阶段建议：阶段 8（错题筛选服务端化 / 移动端验收 / AI 变式题入库），或按 roadmap 进入剩余 P1 项。
- 手动验收（阶段 7）：①首页 → 练习 → 提交答案后点“讲解当前题”，页面出现“DeepSeek 助教讲解”（未配 Key 时仍显示“基于标准解析的助教讲解”）；②四层提示逐层展开：考点→思路→部分步骤→完整解析；③5 个快捷问题可用：简化解释/选项错误/类似题/只提示思路/概念对比；④自由输入框提问；⑤追问生成回复+复习卡片；⑥数据库 `AiTutorLog` 表出现记录（真实调用成功/失败均有）；⑦请求超时出现“重试”按钮，其他学习数据不受影响。

- 服务器接通 AI 答疑检查清单（别人能用 AI 答疑的前置条件，按顺序执行）：
  1. 代码已在服务器：SSH 后 `git pull origin codex/deployment-ready`，`git log --oneline -1` 应为 `d60b1f4`（`deploy.sh` 不会自动 pull，必须先手动拉取）。
  2. 服务器 `.env.production` 必须有非空 `AI_API_KEY`（用 `grep '^AI_API_KEY=' .env.production` 验证；`compose.production.yml` 71-75 行已透传 AI_* 变量）。
  3. 执行 `./deploy/tencent-ip/deploy.sh`（会重新 build web+api 并重启容器）。
  4. 验证：`curl -fsS http://127.0.0.1/health`；`docker compose --env-file .env.production -f compose.production.yml exec app printenv AI_API_KEY` 输出非空。
  5. 浏览器线上验证：进任意题目点“讲解当前题”，标题变为“DeepSeek 助教讲解”才算接通；仍显示“基于标准解析的助教讲解”= 模板降级（Key 未生效或代码未更新）。
  6. 标题切换逻辑：前端 `apps/web/src/features/tutor/TutorPanel.tsx` 以 `source.startsWith('deepseek')` 判断；模板降级时 `source = standard-analysis-assisted`。
  7. 本地联调注意：`npm run dev:migration` 运行的是 `apps/api/dist/main.js` 编译产物，改后端代码后必须先 `npm run build:api` 再重启服务。
## 历史记录

### 2026-08-14 学习路径“下一步入口”统一强化 + 部署验证 + 冒烟脚本

- 日期：2026-08-14
- 任务：在首页学习中控台、今日任务、题目训练反馈、错题本、学习报告五处统一接入“下一步”卡片；线上实测；固化部署冒烟脚本。
- 修改原因：学生完成一个动作后不知道下一步去哪；设计文档 `docs/superpowers/specs/2026-08-14-next-learning-step-design.md` 与计划 `docs/superpowers/plans/2026-08-14-next-learning-step.md` 定义统一前端卡片与可解释优先级（未完成任务 > 待复盘错题 > 薄弱点 > 报告/继续训练）。
- 修改文件：
  - 新增：`apps/web/src/features/student/NextLearningStepCard.tsx`（卡片组件 + 5 个纯函数 resolver）、`test/next-learning-step-ui.test.js`（17 项，含 resolver 行为测试）、`scripts/verify-deployed.mjs`（部署冒烟脚本，CDP 无头 Chrome）、`test/deployed-smoke-script.test.js`
  - 接线：`StudentLearningConsole.tsx`、`TodayPlan.tsx`（新增必填 `onNavigate`）、`PracticePanel.tsx`、`MistakeWorkspace.tsx`、`ReportSummaryPanel.tsx`、`App.tsx`、`styles.css`、`package.json`（`verify:deployed`）
- 数据库变化：无
- API 变化：无（纯前端 + 脚本；按钮只跳转既有 section）
- 测试结果：`node test/next-learning-step-ui.test.js` 17/17；聚焦回归 37/37；`npx tsc -p apps/web/tsconfig.json --noEmit` 通过；`npm run build:web` 通过；`npm test` 502 项 501 通过 / 1 跳过（PDF 渲染依赖）/ 0 失败；`npm run verify:deployed` 对线上 `43.128.30.191` 13 项通过 / 1 项失败（`dashboard-card-aria`，因线上仍是旧构建，修复部署后转绿）
- 截图或验证证据：线上实测截图 `C:\Users\Lenovo\.codex\visualizations\2026\08\14\019ffe2e-cc7a-7f31-b249-0667c51084dc\next-step-browser-test\` 与 `deployed-check\`；提交 `2de4abe`
- 遗留问题：aria-label 重复修复与 `verify:deployed` 脚本尚未提交/部署；线上确认旧构建需重新部署后 `dashboard-card-aria` 转绿
- 下一步：提交本轮改动（需用户批准）并部署；随后实施 P0 知识点目录接入学习引擎

### 2026-08-14 文档事实核对 + P0-2 设计/计划

- 日期：2026-08-14
- 任务：核对 P0-1 实际完成状态并纠偏过时文档；新增 P0-2（知识目录全量接入经典闭环）设计文档与实现计划。
- 修改原因：`docs/PROJECT_CONTEXT.md`/`docs/ARCHITECTURE.md` 仍称“知识点目录未接入学习引擎/只覆盖内置 4 点”，与代码、ROADMAP、DEVELOPMENT_LOG（P0-1 于 2026-08-05 完成）矛盾；按“文档与代码冲突以代码为准”约定纠偏。
- 修改文件：`docs/PROJECT_CONTEXT.md`、`docs/ARCHITECTURE.md`、`docs/ROADMAP.md`（新增 P0-2）、`docs/superpowers/specs/2026-08-14-knowledge-catalog-engine-design.md`（新增）、`docs/superpowers/plans/2026-08-14-knowledge-catalog-engine.md`（新增）、`CODEX_HANDOFF_NEXT.md`
- 数据库变化：无
- API 变化：无
- 测试结果：未运行（纯文档改动）
- 截图或验证证据：代码核对——`StudyService.onModuleInit` 用 `knowledgePointRepository.list()` 替换内置数组；`getMasteryMap` 基于 `this.knowledgePoints` 计算；`seed-408-v2.mjs` 种入 1149 个 `KnowledgeNode`；`KnowledgePointNodeMap`/`QuestionKnowledgeNodeTag` 表已存在
- 遗留问题：P0-2 方案 A/B/C 待用户确认（推荐 B）；P2-2 两套掌握度口径在计算层面仍未合并
- 下一步：用户确认 P0-2 方案后按计划 TDD 实施；同时申请批准提交本轮全部改动

### 2026-08-07 待确认项实现：前端埋点、AI 变式题入库、P2-3 安全拆分

- 日期：2026-08-07
- 任务：按用户确认实施三项待确认项。
- 修改原因：用户要求继续做 P2-3 整体拆分、前端细粒度埋点、AI 变式题入库。
- 修改文件：
  - 前端埋点：`apps/web/src/api/events.ts`（新增，best-effort `trackEvent`）、`App.tsx`（nav.continue_today / practice.* / wrong.open_review / tutor.ask / assessment.generate）、`TodayPlan.tsx`（task.start/postpone/reschedule/rebalance/manual_complete）
  - AI 变式题：`packages/shared/src/ai-variant.ts`（提示词 + JSON 解析）、`apps/api/src/questions/ai-variant.service.ts`（新增，DeepSeek 生成 + 教师确认入库 + AiTutorLog 审计）、`dto/ai-variant.dto.ts`、`questions.controller.ts`（两个新路由）、`questions.module.ts`（注册服务与审计仓储）、`apps/web/src/api/endpoints/teacher.ts`（generateAiVariant/confirmAiVariant）、`TeacherWorkspace.tsx`（AI 变式按钮 + 预览确认）
  - P2-3 拆分：`apps/web/src/features/navigation/useRoleSectionNavigation.ts`（新增：SECTION_STORAGE_KEY/readStoredSection/useRoleSectionNavigation/withTimeout）、`App.tsx`（移除本地定义改导入）、`apps/api/src/study/study-date.ts`（todayKey/lastNDates/nextNDates/countByDate）、`packages/shared/src/assessmentHistorySummary.ts`（buildAssessmentHistorySummary 纯函数）、`study.service.ts`（移除本地定义改导入）
  - 测试：新增 `frontend-events.test.js`、`ai-variant.test.js`、`p2-split.test.js`
- 数据库变化：无（无新迁移；AI 变式题复用现有 Question 表与 AiTutorLog）
- API 变化：`POST /questions/:id/ai-variant`、`POST /questions/:id/ai-variant/confirm`（teacher/admin）
- 测试结果：`npm run build:shared`/`build:api` 通过；`npx tsc -p apps/web/tsconfig.json --noEmit` 通过；新增 3 个测试文件 12 项全过（含 shared 解析/摘要行为、前后端接线）
- 遗留问题：
  1. P2-3 有状态逻辑（练习流程 hook、StudyService 子服务化）仍是大块，本回合完成了纯函数/工具层的安全抽取；后续按模块继续。
  2. AI 变式题需在配置 `AI_API_KEY` 的环境联调真实生成（本环境未配置 Key，未执行真实调用）。
  3. 全量验证已完成：`npm test` 321 项 320 通过 / 0 失败 / 1 跳过；`build:web` 通过；`test:integration:postgres` `ok: true`（期间测试库容器已重启）。
- 下一步：提交（需用户确认）。

### 2026-08-06 第二轮收尾：P2 全清 + 阶段2 + 埋点 + 多知识点 + 教师端分页

- 日期：2026-08-06
- 任务：关闭 UX backlog 全部 P2 项；实施阶段2 动态计划（重新安排/减负/只留高优先级）与历史成绩导入；P2-4 多知识点记录；P2-5 演示模式标识；P3-1 教师端学情报告分页与 AI 占位；错题筛选服务端化；行为埋点（UserEvent）。
- 修改原因：用户要求继续清空剩余 open 项，并指定 P2-06/P2-08/P2-01/03 优先。
- 修改文件：
  - 前端：`StudentLaunchpad.tsx`（移除首页 TodayPlan 整套任务卡、KPI 口径统一）、`TodayPlan.tsx`（重新安排/降低本周任务量/只保留高优先级 + 任务进度）、`PracticePanel.tsx`/`practiceAttemptState.ts`（restartAttempt、再来一组）、`MistakeWorkspace.tsx`（服务端筛选 + 空态口径）、`ReportSummaryPanel.tsx`/`StudentProgressOverview.tsx`（预测分数/提分空间/计划时长口径）、`RoleNavigation.tsx`（已有）、`DiagnosticSummary.tsx`（历史成绩导入）、`TeacherWorkspace.tsx`（按 section 分页 + AI 占位）、`ApiStateIndicator.tsx`/`App.tsx`（演示横幅）、`styles.css`、`api/endpoints/onboarding.ts`、`api/endpoints/dashboard.ts`
  - 后端：`study.service.ts`（rescheduleTask/rebalanceTasks/importAssessmentHistory/recordUserEvent + 5 类行为事件）、`study.controller.ts`（3 个新路由）、`onboarding-plan.repository.ts`（rescheduleTask/rebalanceTasks）、`user-event.repository.ts`（新增）、`study.module.ts`、`dto/plan-adjustment.dto.ts`、`dto/user-event.dto.ts`（新增）、`practice-record.repository.ts`（knowledgePointIds 映射）
  - 共享：`learning.ts`（`isSlowAnswer`/`TaskProgress`/`accumulateTaskProgress`/`rebalanceTaskLoad`/多知识点归因）、`domain.ts`（`knowledgePointIds`）
  - 数据：迁移 `20260806120000_practice_record_knowledge_points`（`PracticeRecord.knowledgePointIds TEXT[]`）、`20260806130000_user_events`（`UserEvent` 表）
  - 测试：新增 `p2-kpi-consistency`、`practice-restart`、`p2-info-architecture`、`demo-mode-banner`、`teacher-placeholder-sections`、`practice-multi-kp`、`plan-adjustment`、`user-events`；更新 `mobile-nav-ui`、`p2-ux-cleanup`；集成脚本新增 UserEvent 断言
- 数据库变化：两个纯增量迁移（可回滚：删除迁移目录后 `migrate deploy` 不再应用；旧行默认空数组/无事件）
- API 变化：新增 `POST /tasks/:id/reschedule`、`POST /tasks/rebalance`、`POST /assessment-history/import`、`POST /events`；`GET /today/plan` 进度字段、`PracticeRecord.knowledgePointIds` 为向后兼容新增
- 测试结果：`npm test` 311 项：310 通过 / 0 失败 / 1 跳过（PDF 渲染依赖）；`npm run build:api`、`npm run build:web` 通过；`npm run test:integration:postgres` `ok: true`（含新迁移与 UserEvent 断言）
- 遗留问题：
  1. P2-3（StudyService/App.tsx 整体拆分）为大规模重构，按 AGENTS.md 需用户确认后单独实施；已先行完成行为不变的安全抽取（纯函数入 shared、多知识点归因、计划调整逻辑）。
  2. AI 变式题入库评估结论为暂缓（需教研审核流与模型成本确认），现有 `findSimilarQuestions` 变式复测继续支撑闭环。
  3. 埋点目前覆盖服务端核心动作 + `POST /events`，前端细粒度事件（如“点击推荐任务”）未接入。
  4. 测试容器 `kaoyan408-test-postgres-1` 仍在运行；Docker Desktop 已启动。
- 下一步：确认后提交；如要继续 P2-3 拆分或前端埋点、AI 变式题入库，需用户确认范围。

### 2026-08-06 UX 收尾批量修复（P1 全部 + P2 三项）

- 日期：2026-08-06
- 任务：按 `docs/ux-problem-backlog.md` 批量关闭 P1-01~P1-08 与 P2-02/P2-04/P2-07，覆盖令牌刷新并发、任务-练习联动、考后复习推荐、错题口径、练习反馈文案与移动导航。
- 修改原因：上一轮审计清单中剩余影响体验的项；用户要求“一直执行任务直到优化全部完成”。
- 修改文件：
  - `apps/web/src/api/refreshGate.ts`（新增，single-flight 刷新门控）、`apps/web/src/api/client.ts`、`apps/web/src/hooks/useAuth.ts`
  - `packages/shared/src/learning.ts`（`isSlowAnswer`、`TaskProgress`、`accumulateTaskProgress`、`classifyMistake` 答对不再返回错因）
  - `apps/api/src/study/study.service.ts`（任务进度自动累计/达标自动完成、今日计划返回 progress、考后复习按本场考点取材、周摘要 focusTitle）
  - `apps/api/src/questions/questions.service.ts`、`apps/web/src/mockData.ts`（q-001 种子题干/答案自洽）
  - `apps/web/src/api/endpoints/practice.ts`、`onboarding.ts`、`features/practice/PracticePanel.tsx`、`components/TodayPlan.tsx`、`components/ErrorReasonSelector.tsx`、`features/mistakes/MistakeWorkspace.tsx`、`features/onboarding/StudentLaunchpad.tsx`、`layouts/RoleNavigation.tsx`、`App.tsx`
  - 测试：新增 `refresh-single-flight.test.js`、`practice-slow-feedback.test.js`、`post-exam-review-source.test.js`、`task-progress-auto.test.js`、`wrong-review-metrics.test.js`、`p2-ux-cleanup.test.js`、`error-reason-default.test.js`、`seed-question-consistency.test.js`；更新 `appLogic.test.js`、`mobile-nav-ui.test.js`
- 数据库变化：无（无迁移；任务进度为内存态，自动完成沿用 `StudyTask.completed` 持久化）
- API 变化：`GET /today/plan` 的 `priorityTasks[].progress` 与 `weekProgress[].focusTitle/focusCompleted` 为新增可选字段（向后兼容）；`POST /practice-records` 响应透传 `timeSpentSec/expectedTimeSec`（原已在响应中）；`classifyMistake` 对答对题不再返回「时间不足」（值语义修正，字段结构不变）
- 测试结果：`npm test` 全量 286 项：285 通过 / 0 失败 / 1 跳过（PDF 渲染依赖）；`npm run build:api`、`npm run build:web`（tsc + vite）通过；`npx tsc -p apps/web/tsconfig.json --noEmit` 通过；`npm run test:integration:postgres` 通过（`{"ok": true, "source": "postgresql", ...}`，修复集成脚本中 q-001 的旧答案 B→C 后全绿）
- 截图或验证证据：无截图；测试输出汇总 `81 pass / 0 fail`
- 遗留问题：
  1. P1-02「开始/继续今日学习」会话化跳题未实施（roadmap 阶段 2）；任务进度为内存态（与既有 `taskCompletionMetricsByUser` 一致）。
  2. P2-01/P2-03/P2-05/P2-06/P2-08 仍 open（未在本轮范围）。
  3. 测试容器 `kaoyan408-test-postgres-1` 仍在运行（`npm run db:test:down` 可清理）；Docker Desktop 本次为跑集成测试已启动。
- 下一步：确认后提交（需用户明确要求，AGENTS.md §9 不自动提交）。

### 2026-08-06 阶段 4：错题筛选与变式复测闭环

- 日期：2026-08-06
- 任务：错题本可筛选、三态掌握状态推导、变式题复测驱动“已掌握”判定、四层复测路径、间隔复习纳入答题用时。
- 修改原因：路线图阶段 4 要求；原错题本无筛选与掌握状态，“已掌握”只能靠手动重做且无变式复测。
- 修改文件：`packages/shared/src/learning.ts`、`packages/shared/src/domain.ts`、`apps/api/src/study/study.service.ts`、`apps/api/src/study/study.controller.ts`、`apps/api/src/study/practice-record.repository.ts`、`apps/api/src/study/dto/create-practice-record.dto.ts`、`prisma/schema.prisma`、`apps/web/src/App.tsx`、`apps/web/src/api/types.ts`、`apps/web/src/api/endpoints/dashboard.ts`、`apps/web/src/api/endpoints/review.ts`、`apps/web/src/api/endpoints/practice.ts`、`apps/web/src/api/mocks/dashboard.ts`、`apps/web/src/features/mistakes/MistakeWorkspace.tsx`、`apps/web/src/components/WrongQuestionDetail.tsx`、`apps/web/src/styles.css`、`test/wrong-question-filter.test.js`、`docs/DEVELOPMENT_LOG.md`
- 数据库变化：新增迁移 `20260806100000_variant_retest`（`PracticeRecord.variantQuestionId TEXT`，可空，纯增量向后兼容）。
- API 变化：`GET /wrong-questions` 新增可选 query `subject/chapter/knowledgePointId/mistakeReason/minWrongCount/masteryStatus/reviewedWithinDays/importance`；`GET /wrong-questions/summary` 新增 `masteryStats`；`POST /practice-records` 新增可选 `variantQuestionId` 并返回 `variantProgress`；`GET /wrong-questions/:id/detail` 新增 `masteryStatus/masteryCriteria/reviewLayers`；错题列表项新增 `masteryStatus/masteryCriteria/importance`。
- 测试结果：`npm run build:api` 通过；`npx tsc -p apps/web/tsconfig.json --noEmit` 通过；`npm test` 216/218（新增 8 项 stage 4 全过；`admin-user-email-ui` 沙箱 esbuild 环境失败与本次无关；1 跳过）。
- 截图或验证证据：`npm test` 输出包含 8 项 `stage 4:` 通过。
- 遗留问题：`npm run build:web` 在沙箱内 esbuild 无法读取目录上层（`vite.config.ts` 加载失败），需非沙箱补跑；UI 筛选暂为前端过滤，`fetchWrongQuestions` 待接入。
- 下一步：提交并推送当前改动，然后进入阶段 5（报告与掌握度）。


### 2026-08-06 阶段 6：移动端与边界状态

- 日期：2026-08-06
- 任务：学生端移动底部导航 ≤5 项；刷新恢复上次所在页面；AI 答疑超时/失败重试；答题选项点击区与移动端布局修正。
- 修改原因：路线图阶段 6 要求；此前学生端无移动底部导航、刷新后回到默认 section、AI 失败只有文字提示无重试。
- 修改文件：`apps/web/src/layouts/RoleNavigation.tsx`、`apps/web/src/App.tsx`、`apps/web/src/features/tutor/TutorPanel.tsx`、`apps/web/src/styles.css`、`test/mobile-nav-ui.test.js`（新增）、`docs/DEVELOPMENT_LOG.md`
- 数据库变化：无
- API 变化：无
- 测试结果：`npm run build:api` 通过；`npx tsc -p apps/web/tsconfig.json --noEmit` 通过；`npm test` 227 通过 / 1 失败（`admin-user-email-ui` 沙箱 esbuild 环境失败，与本次无关）/ 1 跳过；新增 5 项 `stage 6:` 测试全过
- 截图或验证证据：`node --test test\mobile-nav-ui.test.js` 输出 5 项 `stage 6:` 通过
- 遗留问题：`npm run build:web` 需非沙箱补跑；底部导航“学习”tab 与 AI 答疑的映射是设计解读，需产品确认；横向溢出仅做了常见区域修正，需真机/浏览器逐页核对
- 下一步：提交并推送阶段 4 + 阶段 5 + 阶段 6 改动，然后进入阶段 7（AI 答疑与智能推荐）

### 2026-08-06 阶段 5：报告与掌握度

- 日期：2026-08-06
- 任务：掌握度口径统一并接入 DB 知识点；报告“结论先行”；预测分数区间与免责文案；首页掌握度趋势改为近 7 天真实数据。
- 修改原因：路线图阶段 5 要求；原 `getMasteryMap`（API）与 `computeWeaknessReport`（shared）两套口径，报告与地图对同一知识点可能给出不一致结论；报告页第一屏是图表而非结论；无预测分数；趋势图为当前快照而非 7 天趋势。
- 修改文件：`packages/shared/src/learning.ts`、`apps/api/src/study/study.service.ts`、`apps/web/src/App.tsx`、`apps/web/src/features/report/ReportSummaryPanel.tsx`（新增）、`apps/web/src/features/dashboard/StudentProgressOverview.tsx`、`apps/web/src/features/onboarding/StudentLaunchpad.tsx`、`apps/web/src/styles.css`、`test/mastery-report.test.js`（新增）、`docs/DEVELOPMENT_LOG.md`
- 数据库变化：无（无迁移；DB 知识点接入在阶段 0 已通过 `KnowledgePointRepository.list()` 完成）
- API 变化：无端点/响应结构变化；`GET /mastery-map` 内部改由 shared `computeMasteryReport` 计算，响应结构保持兼容
- 测试结果：`npm run build:api` 通过；`npx tsc -p apps/web/tsconfig.json --noEmit` 通过；`npm test` 222 通过 / 1 失败（`admin-user-email-ui` 沙箱 esbuild 环境失败，与本次无关）/ 1 跳过；新增 6 项 `stage 5:` 测试全过
- 截图或验证证据：`node --test test\mastery-report.test.js` 输出 6 项 `stage 5:` 通过
- 遗留问题：`npm run build:web` 需非沙箱补跑；预测分数基于正确率/平均掌握度/剩余天数的启发式估算，属明确标注的“仅为估算”
- 下一步：提交并推送阶段 4 + 阶段 5 改动，然后进入阶段 6（移动端与边界状态）

### 2026-08-05 项目接管分析与 AI 开发上下文文档建立

- 日期：2026-08-05
- 任务：只读分析全仓库并输出《项目接管分析报告》；建立 5 份长期可复用的 AI 开发上下文文档。
- 修改原因：前序对话记录丢失，需以代码为唯一事实来源固化项目上下文、架构、路线图与规则，为后续迭代建立基线。
- 修改文件：`AGENTS.md`、`docs/PROJECT_CONTEXT.md`、`docs/ARCHITECTURE.md`、`docs/ROADMAP.md`、`docs/DEVELOPMENT_LOG.md`
- 数据库变化：无
- API 变化：无
- 测试结果：未运行（纯文档改动，未修改业务代码）；分析基于只读检查（git status、Prisma Schema、源码、测试、部署配置、导入脚本）
- 截图或验证证据：无截图；基线 commit `333ec3c`（分支 `codex/deployment-ready`）；关键事实核对见 `docs/PROJECT_CONTEXT.md` 第 10 节
- 遗留问题：P0-1（知识点目录未接入学习引擎）等，详见 `docs/ROADMAP.md`
- 下一步：等待用户确认是否实施 P0-1

### 2026-08-05 P0-1 知识点目录接入学习引擎

- 日期：2026-08-05
- 任务：让学习引擎以数据库知识点目录为准；新建知识点持久化到数据库。
- 修改原因：`StudyService` 只持有 4 个内置知识点，导入的 16 个知识点（`scripts/import-questions.mjs` 内置）不参与掌握度、薄弱、推荐与计划计算；`createKnowledgePoint` 只改内存、重启即丢失。
- 修改文件：`apps/api/src/study/study.service.ts`、`scripts/integration-postgres.mjs`
- 数据库变化：无（复用已有 `KnowledgePoint` 表，无迁移）
- API 变化：无（`GET/POST /knowledge-points` 路由与响应结构不变；行为增强：返回全量目录、创建即持久化，重复 ID 返回 400）
- 测试结果：`npm run build:api` 通过；`npm test` 185 通过 / 1 跳过 / 0 失败；`npm run test:integration:postgres` 通过（`{"ok": true}`，含新增"目录暴露、API 建点、重启后仍存在"断言）；`npm run build:web` 通过（仅既有 chunk 体积/动态导入警告）
- 截图或验证证据：集成测试最终输出 `{"ok": true, "source": "postgresql", ...}`；基线 commit `333ec3c`
- 遗留问题：导入知识点仅在 API 启动时加载，运行中导入需重启生效；P1-2（全新库先导入后启动崩溃）未处理；内存目录与多实例一致性待确认
- 下一步：等待用户提供服务器公网 IP 与 SSH 接入方式，按 C 计划进行腾讯云部署

### 2026-08-05 P1-1 会话模式考试写入评估历史

- 日期：2026-08-05
- 任务：让 `submitPracticeSession` 对 paper 会话幂等生成评估历史，`/assessment-history` 与历史面板不再缺失会话模式考试记录。
- 修改原因：前端考试走会话流，提交后评估历史不更新；只有旧 `submitPaper` 路径写入历史。
- 修改文件：`apps/api/src/study/study.service.ts`（新增 `recordPaperAssessmentHistory`，`AssessmentHistoryItem` 增加可选 `sessionId`）、`scripts/integration-postgres.mjs`（新增"历史条目与考试报告结果一致"断言）
- 数据库变化：无（评估历史仍存 `RuntimeState` JSON，转正式表见 P2-1）
- API 变化：无路由变化；`GET /assessment-history` 条目新增可选 `sessionId` 字段（向后兼容）
- 测试结果：`npm run build:api` 通过；`npm test` 185 通过 / 1 跳过 / 0 失败；`npm run test:integration:postgres` 通过（`{"ok": true}`）
- 截图或验证证据：集成测试新增断言 `paper session history should match the exam report result` 通过
- 遗留问题：历史写入在会话提交事务之外（失败时记 `synchronizationWarnings`，不影响已提交考试）；阶段测验/题组仍不写评估历史（按设计，历史面板为考试向）
- 下一步：实施 A3 阶段报告聚合视图

### 2026-08-05 A3 阶段报告聚合视图

- 日期：2026-08-05
- 任务：在报告区新增"阶段报告"面板，聚合答题记录、测评历史、掌握度、错题摘要、学习日历，回答"一段时间后是否真正提高"。
- 修改原因：报告区只有分散面板，缺少"本阶段 vs 上一阶段"的趋势叙事。
- 修改文件：`packages/shared/src/stageReport.ts`（新增 `computeStageReport` 纯函数）、`packages/shared/src/index.ts`、`test/stage-report.test.js`（10 个用例）、`apps/web/src/features/report/StageReportPanel.tsx`（新增面板）、`apps/web/src/App.tsx`（接线）、`apps/web/src/styles.css`（面板样式）
- 数据库变化：无
- API 变化：无（纯前端聚合 + shared 纯函数）
- 测试结果：`npm run build:api` 通过；`npm test` 196 项：195 通过 / 1 跳过 / 0 失败（含 10 个 stage-report 用例）；`npm run build:web` 通过（仅既有 chunk 体积/动态导入警告）
- 截图或验证证据：无截图；`computeStageReport` 单测覆盖空数据、基线建立、提升/下降/持平、测评趋势、掌握度排序、错题处理率、窗口边界、窗口天数钳制
- 遗留问题：掌握度无历史快照，阶段对比的"掌握度变化"暂由答题记录窗口推导；报告按自然日窗口（默认 7 天，可配置）；阶段测验与题组不进入测评趋势（沿用 P1-1 设计）
- 下一步：等待用户选择下一个候选功能（建议 A1/P1-2 或 A2/P1-4）

### 2026-08-05 A1（P1-2）全新库"先导入后启动"启动崩溃修复

- 日期：2026-08-05
- 任务：修复空库先 `npm run questions:import` 再启动 API 时，演示 seed 记录引用缺失内置题导致外键失败、Nest 启动崩溃的问题。
- 修改原因：`PracticeRecordRepository.initialize` 无条件 upsert 演示记录（r-001..r-003 引用 q-001/q-002）；当库中已有导入题库时 `QuestionsService.refreshFromDatabase` 用导入题替换内存目录，内置题不存在 → 外键违约。
- 修改文件：`apps/api/src/study/practice-record.repository.ts`（seed 记录按题库目录过滤，缺失题目即跳过）、`scripts/integration-import-first.mjs`（新增隔离集成脚本：独立测试库 + 端口 3201，验证"先导入后启动"）、`package.json`（新增 `test:integration:import-first` 脚本）
- 数据库变化：无迁移；测试脚本会创建/删除专用测试库 `kaoyan408_test_import_first`（仅作用于 compose.test.yml 测试实例）
- API 变化：无
- 测试结果：`npm run build:api` 通过；`npm test` 196 项：195 通过 / 1 跳过 / 0 失败；`npm run test:integration:postgres` 通过（`ok: true`，无回归）；`npm run test:integration:import-first` 通过（`{"ok": true, "scenario": "import-first"}`，验证 API 可启动、导入题可见、演示 seed 记录被跳过）
- 截图或验证证据：import-first 脚本输出 `ok: true`；API 在导入后首启日志显示 health/questions 200
- 遗留问题：导入知识点/题目仅在 API 启动时加载，运行中导入需重启生效（既有设计）；多实例一致性待确认
- 下一步：等待用户选择下一个候选功能（建议 A2/P1-4 内容正式入库）

### 2026-08-05 A2（P1-4）题库内容正式入库与推荐体验

- 日期：2026-08-05
- 任务：固化 starter-320 题库的入库流程，并自动化验证"导入幂等 + 导入后推荐/测验可用"。
- 修改原因：320 题 CSV 靠手动脚本导入、流程未固化，推荐题组与阶段测验在未导入时近乎为空。
- 修改文件：`docs/operations/content-import-runbook.md`（新增操作手册：干跑/导入/重启/验证/腾讯云场景/质量门禁/回滚）、`scripts/integration-content-import.mjs`（新增隔离集成脚本：独立测试库 `kaoyan408_test_content`，真实导入两遍验证幂等 + API 闭环断言）、`package.json`（新增 `test:integration:content-import`）、`README.md`（加入库手册指引）、`docs/deployment-checklist.md`（新增可选导入检查项）
- 数据库变化：无迁移；测试脚本创建/删除专用测试库 `kaoyan408_test_content`
- API 变化：无
- 测试结果：`npm run questions:import:dry-run` 通过（320 题、16 个知识点各 20 题）；`npm run build:api` 通过；`npm test` 196 项：195 通过 / 1 跳过 / 0 失败；`npm run test:integration:content-import` 通过（`{"ok": true, "questions": 320, "knowledgePoints": 16}`，首轮 created=320、次轮 skipped=320，推荐题组与阶段测验非空）
- 截图或验证证据：content-import 脚本输出 `ok: true`；干跑输出知识点分布
- 遗留问题：starter-320 为脚本生成自编题，正式体验前需按 review-checklist 抽样复核；生产镜像未内置导入脚本（手册已注明在主机目录执行）
- 下一步：等待用户选择下一个候选功能（建议 P2-1 评估历史/试卷/系统配置转正式表，或先部署当前改动到腾讯云）

### 2026-08-05 P2-1 评估历史 / 试卷 / 系统配置转正式表

- 日期：2026-08-05
- 任务：把 `papers`、`assessmentHistoryItems`、`systemConfig` 从 `RuntimeState` JSON 迁移为正式表，支持 SQL 查询、审计与多实例一致性。
- 修改原因：RuntimeState JSON 不可查询、无审计、多实例不一致，且评估历史是"是否真正提高"的关键数据。
- 修改文件：`prisma/schema.prisma`（新增 `AssessmentHistoryItem`/`Paper`/`SystemConfig` 模型）、`prisma/migrations/20260805100000_reporting_tables/migration.sql`（建表 + RuntimeState JSON 回填）、`apps/api/src/study/assessment-history.repository.ts`、`paper.repository.ts`、`system-config.repository.ts`（新增）、`study.service.ts`（读写切换到新表，移除 RuntimeState 依赖）、`study.module.ts`（注册新 provider）、`scripts/integration-postgres.mjs`（迁移回填 fixture 与表级持久化断言）、`docs/ARCHITECTURE.md`、`docs/PROJECT_CONTEXT.md`、`docs/ROADMAP.md`
- 数据库变化：迁移 `20260805100000_reporting_tables`——新增三张表并从 `RuntimeState` 回填旧数据（幂等，`ON CONFLICT DO NOTHING`；遵循 feedback 迁移先例；不回删 RuntimeState 旧键以便回滚）
- API 变化：无（`/assessment-history`、`/papers`、`/admin/system-config` 响应结构不变；`RuntimeStateRepository` 从 StudyService 移除）
- 测试结果：`npx prisma generate` 通过；`npm run build:api` 通过；`npm test` 196 项：195 通过 / 1 跳过 / 0 失败；`npm run test:integration:postgres` 通过（`ok: true`，含"旧 JSON 回填三表""Paper/AssessmentHistoryItem/SystemConfig 落表""重启后 API 数据恢复"断言）；`npm run test:integration:content-import` 通过（新 Schema 下 320 题导入闭环无回归）
- 截图或验证证据：主集成输出 `ok: true`；迁移回填断言通过（legacy-assessment-history-fixture-001 / legacy-paper-fixture-001 / systemConfig 行）
- 遗留问题：`RuntimeState` 旧键（papers/assessmentHistoryItems/systemConfig）未删除（保留以便回滚，后续可清理）；`questionReviewItems` 仍存 RuntimeState（审核队列，暂不迁移）
- 下一步：等待用户选择下一个候选功能（建议部署当前改动到腾讯云，或 P2-2 掌握度口径统一）

### 2026-08-05 腾讯云升级部署（1515c31 + starter-320 内容导入）

- 日期：2026-08-05
- 任务：把全部已完成改动（P0-1/P1-1/P1-2/P1-4/A3/P2-1 等，提交 `1515c31`）升级部署到腾讯云服务器 `43.128.30.191`，并导入 starter-320 题库。
- 修改原因：服务器仍运行旧提交 `333ec3c`；升级后需让新功能（知识点目录、评估历史正式表、阶段报告、内容库）在线上生效。
- 修改文件：无业务代码改动（本次为部署操作 + 本日志记录）
- 数据库变化：生产库自动执行迁移 `20260805100000_reporting_tables`（21 migrations 全部应用，`migrate status` 显示 up to date；`SystemConfig` 旧配置回填 1 行，history/papers 原库无数据）；随后导入 starter-320（`created=320`，题目 326、知识点 16）
- API 变化：无
- 测试结果：`/health` 返回 `dataSource: postgresql`；`/api/questions` 返回脱敏题目；三个容器 healthy；登录页可访问；管理员账号已存在
- 截图或验证证据：服务器命令输出（`Database schema is up to date!`、`Import complete. created=320`、`{"questions":326,"knowledgePoints":16}`、`gateway_http=200`）；部署前自动备份 `/backups/kaoyan408-20260805T025841Z.dump`
- 遗留问题：内容为脚本生成自编题，正式体验前建议抽样复核；生产镜像未内置导入脚本（本次采用 docker cp 进容器执行的方式）；服务器仓库落后本日志 1 个提交（纯文档，无需重新部署）
- 下一步：等待用户在线上用管理员账号验收学生闭环（邀请码 → 注册 → 诊断 → 做题 → 错题 → 报告），或继续 P2-2 掌握度口径统一

### 2026-08-05 修复：改密请求未携带 Bearer 令牌（教师无法改密）

- 日期：2026-08-05
- 任务：修复临时密码用户（mustChangePassword=true）无法完成改密的问题。
- 修改原因：教师端线上验证发现改密页提交后报 "Bearer access token is required"。根因：前端 `changePassword` 走 `requestAuthSession`（普通 `fetch`），未携带 Authorization 头，而后端 `POST /auth/change-password` 受 RoleGuard 保护。
- 修改文件：`apps/web/src/api/endpoints/auth.ts`（改密改用 `fetchWithAuth`，自动携带 Bearer 并支持 401 刷新重试）、`test/change-password-auth.test.js`（新增源码级回归测试）
- 数据库变化：无
- API 变化：无（修复前端调用，接口契约不变）
- 测试结果：`npm run build:web` 通过；`npm test` 197 项：196 通过 / 1 跳过 / 0 失败（含新增改密回归测试；首次运行 question-import-ui 出现瞬时 spawn EPERM，重跑全绿）
- 截图或验证证据：新增测试 "change password request must carry the bearer token" 通过
- 遗留问题：需重新部署线上（重建网关镜像）后教师才能正常改密；登录页文案与报错无关联
- 下一步：重新部署到腾讯云（`./deploy/tencent-ip/deploy.sh`），管理员重置教师临时密码 → 教师改密 → 走学生闭环验收

### 2026-08-05 修复：教师无授权学生时班级学情误报 403

- 日期：2026-08-05
- 任务：修复教师端"班级学情加载失败（403）/ 右上角 API 异常"。
- 修改原因：`getTeacherClassAnalytics` 在教师**没有授权学生**时直接抛 `ForbiddenException`（403），前端把正常空状态当成错误；日志确认 `GET /teacher/class-analytics` 持续 403。
- 修改文件：`apps/api/src/study/study.service.ts`（无授权学生时返回 200 空班级视图，演示学生回退仅保留给管理员的全局概览，避免数据泄漏）、`apps/web/src/features/teacher/TeacherWorkspace.tsx`（`studentCount===0` 时显示"暂未授权学生"空态提示）、`scripts/integration-postgres.mjs`（新增"无授权学生返回空班级视图"断言）
- 数据库变化：无
- API 变化：`GET /teacher/class-analytics` 对无授权学生的教师从 403 改为 200（空数据），其余行为不变
- 测试结果：`npm run build:api` 通过；`npm run build:web` 通过；`npm test` 197 项：196 通过 / 1 跳过 / 0 失败；`npm run test:integration:postgres` 通过（`ok: true`，含新增空班级断言，授权后断言无回归）
- 截图或验证证据：集成测试新增断言 "teacher without authorized students should get an empty class view" 通过
- 遗留问题：需重新部署线上后教师端生效；教师仍需管理员在"教师授权"中配置学生后班级学情才有数据
- 下一步：重新部署到腾讯云，教师刷新教师端确认不再报 API 异常，然后走学生闭环验收
- ### 2026-08-05 部署：教师端 403 修复与学生端快捷按钮导航上线（808c632 + eceb7a2）

- 日期：2026-08-05
- 任务：把 `808c632`（教师无授权学生时班级学情返回空视图）与 `eceb7a2`（学生端"查看错题复盘/生成提分报告"快捷按钮接入导航）部署到腾讯云 `43.128.30.191`。
- 修改原因：修复教师端线上 API 异常（403）与学生端启动板快捷按钮无响应。
- 修改文件：本次部署涉及的提交为 `apps/web/src/App.tsx`、`apps/web/src/features/onboarding/StudentLaunchpad.tsx`、`docs/ROADMAP.md`；无新增业务代码。
- 数据库变化：无迁移；应用容器启动时 `prisma migrate deploy` 确认 schema up to date。
- API 变化：无（学生端为纯前端导航修复；教师端 403→200 空视图来自 `808c632`，本次随部署生效）。
- 测试结果：上轮 `npm run build:web` 通过；`npm test` 197 项：196 通过 / 1 跳过 / 0 失败；服务器部署输出显示构建成功、app/gateway/postgres 全部 healthy。
- 截图或验证证据：服务器输出 `Updating 808c632..eceb7a2`、备份 `/backups/kaoyan408-20260805T070445Z.dump`、`Nest application successfully started`。
- 遗留问题：学生端"提交错因并加入复习计划"卡在"提交中"仍未复现取证；教师班级学情需管理员先授权学生才有数据。
- 下一步：线上验证学生闭环；若错因提交仍卡住，收集 F12 Network 状态码/x-request-id 或 `docker compose logs app --tail=200`。

### 2026-08-05 实施：阶段 1 首页主行动收敛 + 阶段 3 剩余项（三模式 + 错因 8 类扩展）

- 日期：2026-08-05
- 任务：按 `docs/ux-implementation-roadmap.md` 完成阶段 1（首页"继续今日学习"主行动收敛）与阶段 3 剩余项（学习/训练/模拟三模式、答题元数据 confidence/usedHint/answerModified、错因 8 类）。
- 修改原因：首页 hero 主按钮原为"继续刷题"（指向模拟考试准备），不符合"今天做什么"驾驶舱定位；练习会话缺少学习模式、自信度/提示/改答元数据；错因仅 5 类且部分占位，无法支撑"蒙题≠掌握"与针对性复习。
- 修改文件：`packages/shared/src/domain.ts`（MistakeReason 8 类、ConfidenceLevel、PracticeRecord 元数据）、`packages/shared/src/learning.ts`（classifyMistake 新规则、normalizeMistakeReason、MISTAKE_SUGGESTIONS 8 键并导出）、`prisma/schema.prisma` + 新迁移 `20260805110000_practice_answer_metadata`、`apps/api/src/study/dto/*`、`practice-record.repository.ts`、`learning-session.repository.ts`、`study.service.ts`、`apps/web/src/components/ExamSession.tsx`（learningMode + 自信度/提示/改答）、`ErrorReasonSelector.tsx`（8 类）、`usePracticeSession.ts`、`sessions.ts`、`practice.ts`、`App.tsx`（学习模式入口与 onCheckAnswer、onContinueToday）、`StudentLaunchpad.tsx`、`TodayPlan.tsx`（focusTaskId 滚动定位）、`PracticePanel.tsx`（学习模式入口）、`styles.css`、`test/appLogic.test.js`、`test/ux-redesign-ui.test.js`、新增 `test/stage3-practice-metadata.test.js`
- 数据库变化：增量迁移（`PracticeRecord` 加 `confidence TEXT NULL`、`usedHint BOOLEAN NOT NULL DEFAULT false`、`answerModified BOOLEAN NOT NULL DEFAULT false`），向后兼容，可回滚（删除迁移目录后 `migrate deploy` 不再应用）。
- API 变化：`POST /practice-records`、`POST /sessions/practice/:id/save`、`POST /sessions/practice/:id/submit` 入参与响应 `records[]` 增加可选元数据字段（旧请求/响应兼容）；无破坏性变更。
- 测试结果：`npm run build:api` 通过；`npx tsc -p apps/web/tsconfig.json --noEmit` 通过；`npm test` 210 项：208 通过 / 1 失败（`admin-user-email-ui`，根因为沙箱内 esbuild 读取父目录被拒，与本次改动无关）/ 1 跳过；`build:web` 的 tsc 阶段通过，vite/esbuild 阶段受同一沙箱限制，需在无沙箱环境补跑。
- 遗留问题：学习模式每题即时核对复用 `POST /practice-records`（真实落库），完成后不批量提交会话，会留下一个 practice_set 草稿会话（可在"继续学习"横幅看到，属已知体验细节）；综合题在学习模式不自动判分（提示到训练/模拟模式提交自评）；错因中"公式记错/计算错误"主要靠自选，规则自动推断覆盖其余 6 类。
- 下一步：在无沙箱环境补跑 `npm run build:web` 与 `npm run test:integration:postgres`；随后进入阶段 4（错题筛选 + 变式复测）。
