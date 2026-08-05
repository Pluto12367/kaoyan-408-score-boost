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

## 历史记录

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
