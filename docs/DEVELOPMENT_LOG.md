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

- 分支/提交：`feature/v3-product-refactor`，Phase R（修复与收线）已完成并分批提交：重建被测试加载器破坏的 today-plan 投影服务、修复破坏性写回加载器为安全沙箱；补齐 12 个 provider 的 @Injectable 并修复 StudyModule DI（无 DB 内存模式启动验证通过，/health 200）；裁定并修复 exam-score-history parity（9）与 assessment-history projection（1）分歧（均为测试 stub 不忠实，生产代码未改）；历史工作区已分 5 批落库；StudentHome/TestSection 已接入学生导航并清理旧 plan/score-center 分支；`npm test` 1005 通过 / 0 失败 / 1 跳过、`build:api`/`build:web` 通过。下一步：OverviewReportAdapter 与 /reports/overview 接线，或 V3 Sprint 2（前端切换 /student-state、删 mock、废弃三冗余端点）。
- 分支/提交：`codex/deployment-ready`，A/B/C 三档主题切换（深色/极简/标准）已提交推送并部署上线（`83182ad`，与 origin 同步，线上 bundle 已确认包含 `theme-switch`/`kaoyan408:theme`）；`npm test` 577 通过 / 0 失败 / 1 跳过、`build:api`/`build:web` 通过。下一步：`npm run verify:deployed` 线上全量核对；主题能力可后续扩展（跟随系统偏好、教师/管理端配色）。
- 分支/提交：`codex/deployment-ready`，节点闯关（图谱原子节点 未开始/进行中/已通关 + 闯关小测 ≥60% 通关 + `UserNodeQuest` 里程碑表）已完成 TDD 与全量验证，**尚未提交**；`npm test` 570 通过 / 1 跳过、`build:api`/`build:web` 通过、`test:integration:postgres`（含闯关断言）通过。下一步：提交推送 → 部署 → 浏览器验证闯关流程 → 错题→真题联动。
- 分支/提交：`codex/deployment-ready`，阶段 0-5 已提交推送；Phase 2b（计划语义迁移到 `knowledgeNodeId`）已完成并**尚未提交**；`npm test` 565 项 564 通过 / 1 跳过、`build:api`/`build:web` 通过、`test:integration:postgres`（含节点计划+questionIds 断言）与 `test:integration:content-import` 通过。下一步：提交推送 → 部署后浏览器验证“今日计划任务按节点启动练习”；至此方案 C 全部阶段（Phase 1/2/2b）完成，P2-2 口径统一收敛。
- 分支/提交：`codex/deployment-ready`，阶段 0-4 已提交推送（`a900a93`/`4197b0a`/`3d26900`/`8b0f6e6`）；阶段 5（收敛工程化：旧口径冻结日志、60s TTL 多实例缓存、图谱无障碍、HTTPS nginx 示例+Certbot 文档、阶段 0→5 上线运行手册）已完成并**尚未提交**；`npm test` 560 项 559 通过 / 1 跳过、`build:api`/`build:web` 通过、`test:integration:postgres` 通过。下一步：提交推送 → 按运行手册部署并执行数据脚本 → 浏览器端到端验收；阶段 0→5 全部完成后可对目标做最终验收。
- 分支/提交：`codex/deployment-ready`，阶段 0-3 已提交推送（`a900a93`/`4197b0a`/`3d26900`）；阶段 4（报告图谱化：掌握度趋势，`UserMasterySnapshot` 每日快照 + `GET /mastery-trend` + 报告趋势面板）已完成并**尚未提交**；`npm test` 556 项 555 通过 / 1 跳过、`build:api`/`build:web` 通过、`test:integration:postgres`（含快照/趋势断言）与 `test:integration:content-import` 通过。下一步：提交推送 → 部署（新迁移随容器启动自动应用）→ 生产执行回填（重建历史快照）→ 浏览器验证报告“掌握度趋势”；随后进入阶段 5（收敛工程化：旧口径冻结/多实例/性能/无障碍/HTTPS）。
- 分支/提交：`codex/deployment-ready`，阶段 0-2 已提交推送（`a900a93`、`4197b0a`）；阶段 3（题库图谱化 + 真题接入）已完成并**尚未提交**；`npm test` 551 项 550 通过 / 1 跳过、`build:api`/`build:web` 通过、`test:integration:postgres` 与 `test:integration:content-import`（含 linker 覆盖率=1 与幂等）通过。下一步：提交推送 → 部署后执行 `link-question-bank-to-nodes.mjs`（生产题库全部物化节点标签）→ 浏览器验证图谱抽屉“考点题库/真题命中”与“练习本题”；随后进入阶段 4（报告图谱化：掌握度趋势）。
- 分支/提交：`codex/deployment-ready`，阶段 0、1 已提交推送（`a900a93`）；阶段 2（图谱掌握度驱动掌握度地图/薄弱报告/推荐，`USE_KNODE_MASTERY` 只读开关）已完成并**尚未提交**；`npm test` 544 项 543 通过 / 1 跳过、`build:api`/`build:web` 通过、`test:integration:postgres`（含灰度重启断言）与 `test:integration:content-import` 通过。下一步：提交推送 → 服务器部署后以 `USE_KNODE_MASTERY=true` 灰度开启 → 浏览器验证；随后进入阶段 3（题库图谱化 + 真题接入）。
- 分支/提交：`codex/deployment-ready`，阶段 0（题库清重 + 掌握度回填）与阶段 1（知识图谱掌握度着色）已完成并**尚未提交**；`npm test` 537 项 536 通过 / 1 跳过、`build:api`/`build:web` 通过、`test:integration:postgres`（含 `GET /knowledge/mastery` 断言）与 `test:integration:content-import` 通过。下一步：申请提交/推送 → 服务器部署 → 执行 `question-bank-dedupe.mjs` 与 `backfill-user-mastery.mjs` → 浏览器验证图谱着色 → 进入阶段 2（图谱驱动推荐/计划 + 方案 C 只读切换）。
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

### 2026-08-15 节点闯关：知识图谱从“可查看”升级为“可推进”

- 日期：2026-08-15
- 任务：为 408 知识图谱原子节点增加“节点闯关”闭环：每个节点显示 未开始/进行中/已通关 状态徽章，详情抽屉可“开始闯关”（仅练该节点关联题），答完回到抽屉“完成闯关并结算”，按正确率 ≥ 60% 判定通关并持久化里程碑。
- 修改原因：图谱此前只着色掌握度、可查看题量与真题命中，学生缺少“逐节点推进”的目标感与完成反馈；这是“错题→真题联动”落地前的学习闭环强化。
- 修改文件：
  - `packages/shared/src/nodeMastery.ts`（新增 `NodeQuestStatus`、`deriveNodeQuestStatus`、`QUEST_PASS_THRESHOLD=60`、`QUEST_STATUS_LABELS`）
  - `prisma/schema.prisma` + 迁移 `20260815120000_user_node_quest`（新增 `UserNodeQuest` 表：userId+knowledgeNodeId 唯一、attempts/bestAccuracy/passed/passedAt，additive 可回滚）
  - `apps/api/src/score-center/repository.ts`（`loadNodeQuest`/`loadNodeQuests`/`saveNodeQuestAttempt`）、`service.ts`（`getNodeQuest`/`completeNodeQuest`，`getMyMastery` 增 `questStatus`）、`routes.ts`（`GET /knowledge/:id/quest`、`POST /knowledge/:id/quest/complete`）
  - `apps/web/src/api/endpoints/score-center.ts`（`fetchNodeQuest`/`completeNodeQuest` + 类型）、`KnowledgePointDetailDrawer.tsx`（节点闯关区块）、`KnowledgeTree.tsx`（闯关徽章）、`KnowledgeCatalog.tsx`（`onStartQuest`/`onCompleteQuest`/`questState` 接线）、`App.tsx`（`questContext` 状态 + 闯关题过滤 + 完成结算 + 结算后刷新徽章）
  - `scripts/integration-postgres.mjs`（闯关状态/阈值/通过不降级端到端断言）
  - 新增 `test/node-quest-status.test.js`、`test/node-quest-wiring.test.js`（TDD：先 RED 后 GREEN）
- 数据库变更：新增 `UserNodeQuest` 表（additive；回滚=移除迁移目录后不再应用，原表不受影响）
- API 变更：新增 2 个端点；`GET /knowledge/mastery` 响应 items 增加可选 `questStatus` 字段（向后兼容）
- 测试结果：`node test/node-quest-status.test.js`、`node test/node-quest-wiring.test.js` 先 RED（模块缺失）后 GREEN；`npm run build:api` 通过；`npm run build:web` 通过（仅既有 chunk 体积警告）；`npm test` 570 通过 / 1 跳过 / 0 失败；`npm run test:integration:postgres` `ok:true`（含闯关断言）
- 截图或验证证据：集成日志显示 `questBefore.status === 'in_progress'`、`questPassed.status === 'passed'`、`questRetryFailed` 不降级、`UserNodeQuest` 行落库
- 遗留问题：闯关题目复用节点关联题（`relatedQuestions` 前 20 题），尚无独立闯关题库/难度分层；结算需用户回到详情抽屉手动触发；未做服务端题目级校验（当前 accuracy 由前端上报）
- 下一步：提交推送后部署到 43.128.30.191（新迁移随 app 启动自动应用），浏览器验证闯关流程；随后实施“错题→真题联动”

### 2026-08-14 Phase 2b：计划语义迁移到 knowledgeNodeId

- 日期：2026-08-14
- 任务：`USE_KNODE_MASTERY=true` 时，Onboarding 七天计划/今日任务的生成改由节点掌握度+考频证据驱动（复用 score-center 的 `calculatePriority`/`composeDailyPlan`），任务携带原子节点 id，并通过 `questionIds` 桥接让前端能按节点归因题目启动练习。
- 修改原因：阶段 2 只切换了掌握度地图/薄弱/推荐，经典计划仍按 16 粗粒度点内存计算，`StudyTask` 与图谱掌握度/题目归因不衔接，是方案 C 唯一遗留口径缺口。
- 修改文件：
  - `packages/shared/src/nodePlan.ts`（新增 `buildNodeDrivenDailyTasks`/`stagePhase`：弱+高频节点优先、模式映射为基础例题/专项训练/阶段巩固、中文理由）+ `index.ts` 导出
  - `apps/api/src/study/study.service.ts`（节点目录缓存增加难度+快照字段；`generatePlan` 灰度走 `buildNodeDrivenPlan`；`getTodayPlan` 任务附加 `questionIds`；推荐回退按节点归因过滤）
  - `apps/web/src/api/endpoints/onboarding.ts`（`TodayPlanTask.questionIds?`）、`features/onboarding/todayLearningRoute.ts`（预检优先按 questionIds、launch context 携带）、`App.tsx`（练习列表按 questionIds 过滤，无则回退旧行为）
  - 新增 `test/node-driven-plan.test.js`（2 项）、`test/plan-node-semantics.test.js`（3 项，含预检行为测试）
  - `scripts/integration-postgres.mjs`（灰度下 `/today/plan` 任务全部为节点 id 且含 questionIds 断言）
- 数据库变化：无迁移（`StudyTask` 复用既有 `knowledgePointId`/`knowledgeNodeId` 字段语义）
- API 变化：`GET /today/plan` 的 `priorityTasks[]` 新增可选 `questionIds`（向后兼容；开关关闭时行为不变）
- 测试结果：`npm run build:api` 通过；`npm run build:web` 通过；`npm test` 565 项 564 通过 / 1 跳过 / 0 失败；`npm run test:integration:postgres` `ok:true`（含节点计划断言）；`npm run test:integration:content-import` `ok:true (questions=320)`
- 截图或验证证据：集成日志 `NODE_PLAN_TASKS` 显示任务均为节点 id 且带 questionIds
- 遗留问题：`考后复盘`（`mergePostExamTasks`）仍按粗粒度 `knowledgePointId` 挂接（独立于七天计划语义，保持现状）；REVIEW/错题重做动作在当前节点计划中映射为“专项训练”（避免错题库按粗粒度 id 失配），错题闭环仍由错题本/到期复习承载
- 下一步：申请提交/推送并部署；浏览器验证“今日计划任务 → 练习”按节点题目启动；方案 C 全部完成

### 2026-08-14 阶段 5：收敛工程化（旧口径冻结 / 多实例 / 性能 / 无障碍 / HTTPS）

- 日期：2026-08-14
- 任务：把阶段 0-4 的统一闭环做工程收敛：旧掌握度口径冻结、多实例缓存一致性、性能缓存、图谱无障碍、HTTPS 部署路径，并产出阶段 0→5 生产上线运行手册。
- 修改原因：阶段 0-4 完成后需要可运维、可回滚、多实例安全的收敛形态；浏览器审计遗留无障碍细节；线上仍为 HTTP 临时 IP。
- 修改文件：
  - `apps/api/src/study/study.service.ts`（缓存拆分 `reloadNodeMasteries` + 60s TTL `ensureNodeMasteryFresh` 多实例最终一致；开关开启时启动日志 `legacy mastery read path frozen`）
  - `apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx`/`KnowledgeTree.tsx`（科目标签 `aria-controls`、树容器 `id`、行 `aria-expanded`）
  - `deploy/tencent-ip/nginx-https.conf.example`（新增 TLS nginx 示例：443 ssl + 80→HTTPS 重定向 + 证书路径 + `X-Forwarded-Proto https`）
  - `docs/deploy-to-tencent-ip.md`（第 9 节补 Certbot 签发/自动续期步骤，编号顺延）
  - 新增 `docs/operations/mastery-graph-convergence-runbook.md`（部署→清重→回填→linker→灰度开关→验收→边界）、`test/convergence-phase5.test.js`（4 项契约）
- 数据库变化：无（阶段 4 迁移已含）
- API 变化：无
- 测试结果：`npm run build:api` 通过；`npm run build:web` 通过；`npm test` 560 项 559 通过 / 1 跳过 / 0 失败；`npm run test:integration:postgres` `ok:true`
- 截图或验证证据：阶段 5 契约测试全绿；集成测试 `ok:true`
- 遗留问题：HTTPS 需正式域名/备案后启用（配置与文档已就绪）；Onboarding 计划语义（Phase 2b）仍单独评审；多实例 TTL 为最终一致（单实例写后即时）
- 下一步：提交推送 → 按运行手册生产上线（部署+数据脚本+灰度开关）→ 浏览器端到端验收 → 阶段 0→5 目标收尾

### 2026-08-14 阶段 4：报告图谱化（掌握度趋势）

- 日期：2026-08-14
- 任务：新增每日节点掌握度快照（`UserMasterySnapshot`）与 `GET /mastery-trend`，报告“四科掌握度”页展示整体/分科趋势、最弱节点与提升/下滑列表。
- 修改原因：掌握度只有当前值、无历史，报告无法回答“一段时间是否真正提高”；阶段 2/3 后节点掌握度已统一，需要快照沉淀趋势。
- 修改文件：
  - `prisma/schema.prisma` + 迁移 `20260814120000_user_mastery_snapshot`（additive 建表 + 唯一/索引 + 外键）
  - `packages/shared/src/nodeMastery.ts`（新增 `buildMasteryTrend` 纯函数：整体/分科序列、分科最弱节点、窗口内 delta 排序）
  - `apps/api/src/score-center/repository.ts`（`saveMasterySnapshot`/`loadMasterySnapshots`）、`service.ts`（作答/复盘写快照；`getMasteryTrend`）、`routes.ts`（`GET /mastery-trend`）
  - `scripts/backfill-user-mastery.mjs`（重放历史记录时按记录日期重建快照，幂等）
  - `apps/web/src/api/endpoints/trend.ts`（`fetchMasteryTrend` + 类型）、`features/report/MasteryTrendPanel.tsx`（趋势面板，柱状图/最弱节点/提升下滑）、`ReportWorkspace.tsx`（四科掌握度页挂载）、`styles.css`
  - 新增 `test/mastery-trend.test.js`（2 项）、`test/mastery-trend-wiring.test.js`（3 项契约）
  - `scripts/integration-postgres.mjs`（写快照、趋势端点、回填重建快照幂等断言）
- 数据库变化：新增 `UserMasterySnapshot` 表（additive，可回滚=移除迁移目录后不再应用）
- API 变化：新增 `GET /mastery-trend?days=N`（仅新增，向后兼容）
- 测试结果：`npx prisma generate` 通过；`npm run build:api` 通过；`npm run build:web` 通过；`npm test` 556 项 555 通过 / 1 跳过 / 0 失败；`npm run test:integration:postgres` `ok:true`（含快照与趋势断言）；`npm run test:integration:content-import` `ok:true (questions=320)`
- 截图或验证证据：集成日志显示 `GET /mastery-trend` 返回整体序列与最弱节点；回填后 `userMasterySnapshot` 行数 > 0 且重跑一致
- 遗留问题：快照按 UTC 日截断（与本地时区展示有一致性但非上海日历日）；趋势面板未做分页/日期范围选择；历史趋势依赖回填脚本在部署后执行
- 下一步：申请提交/推送并部署；生产执行回填重建历史快照；浏览器验证报告趋势面板；随后进入阶段 5（收敛工程化）

### 2026-08-14 阶段 3：题库图谱化 + 真题接入

- 日期：2026-08-14
- 任务：把全部 live 题库物化为题目级图谱标签（`QuestionKnowledgeNodeTag`），并让知识图谱详情展示“考点题库（关联题可一键练习）”与“真题命中（年份/题号/题型/分值/摘要/来源链接）”。
- 修改原因：题库题此前仅经 `QuestionKnowledgePoint → KnowledgePointNodeMap` 运行时兜底归因，题目级图谱链接为空；真题数据（2022-2026，235 题）只沉淀为频率证据，未在图谱中可见，学生无法从“知识点 → 真题/题库题 → 练习”闭环。
- 修改文件：
  - 新增 `scripts/link-question-bank-to-nodes.mjs`（确定性链物化题目级节点标签，`--dry-run` 审计 + <70% 阻断 + 幂等，`source='bridge:knowledge-point-map'`）
  - `apps/api/src/score-center/repository.ts`（新增 `loadRelatedQuestionsForNode`/`loadExamQuestionsForNode`）、`service.ts`（`getKnowledgeDetail` 增加 `relatedQuestions`/`examQuestions`，向后兼容）
  - `apps/web/src/api/endpoints/score-center.ts`（类型扩展）、`KnowledgeCatalog.tsx`（选中节点拉取详情）、`KnowledgePointDetailDrawer.tsx`（“考点题库”+“练习本题”+“真题命中”区块）、`App.tsx`（`onPracticeQuestion` 复用既有重做流程）
  - 新增 `test/question-node-linker.test.js`（4 项）、`test/knowledge-detail-graph-links.test.js`（3 项契约）
  - `scripts/integration-postgres.mjs`（知识详情返回关联题与真题命中）、`scripts/integration-content-import.mjs`（seed 目录+映射 → linker 覆盖率=1、320 条标签、幂等、详情断言）
- 数据库变化：无迁移；生产执行 `node scripts/link-question-bank-to-nodes.mjs` 后 `QuestionKnowledgeNodeTag` 增加题库标签行（幂等，可重跑；回滚=删除 `source='bridge:knowledge-point-map'` 行）
- API 变化：`GET /knowledge/:id` 新增 `relatedQuestions`/`examQuestions` 字段（仅新增，向后兼容）
- 测试结果：`npm run build:api` 通过；`npm run build:web` 通过；`npm test` 551 项 550 通过 / 1 跳过 / 0 失败；`npm run test:integration:postgres` `ok:true`（含阶段 3 断言）；`npm run test:integration:content-import` `ok:true (questions=320)`（含 linker 覆盖率 1、320 标签、幂等）
- 截图或验证证据：集成日志显示 linker `coverage: 1`、`created 320 tags`；`GET /knowledge/OS-C02-S04-P20` 返回关联题库题与真题命中
- 遗留问题：真题仅含摘要与题号/分值（无完整题干，版权约束），故“真题接入”为证据可视化 + 来源链接，不提供真题直接作答；关联题列表取前 20 条，未分页
- 下一步：申请提交/推送并部署；生产执行 linker；浏览器验证抽屉两区块与“练习本题”跳转；随后进入阶段 4（报告图谱化：掌握度趋势）

### 2026-08-14 阶段 2：图谱掌握度驱动掌握度地图/薄弱报告/推荐（方案 C 只读切换）

- 日期：2026-08-14
- 任务：新增 `USE_KNODE_MASTERY` 灰度开关（DB 模式，默认关闭），把掌握度地图、薄弱报告、推荐题组三条读路径从 16 粗粒度点内存计算切换到 `UserKnowledgeMastery` 节点掌握度。
- 修改原因：阶段 0b/1 后节点掌握度已回填并上图谱，但经典闭环（掌握度地图/薄弱/推荐）仍用旧口径，P2-2 两套掌握度并存未收敛；方案 C 第 5 节定义只读切换灰度。
- 修改文件：
  - `packages/shared/src/nodeMastery.ts`（新增 `deriveNodeWeakPoints`/`buildNodeMasteryMap`，输出与旧 `MasteryMap` 兼容）+ `index.ts` 导出
  - `apps/api/src/score-center/repository.ts`（新增 `loadActiveAtomicNodeCatalog`，原子点 + 父链章节）
  - `apps/api/src/study/study.service.ts`：`USE_KNODE_MASTERY` 开关；启动时构建节点目录/题目→节点归因/节点掌握度只读缓存（`loadNodeMasteryReadCache`，无库守卫），单题/会话/复盘写入后刷新；`getMasteryMap`（节点聚合）、`getOverviewReport`（weakPoints 由节点掌握度推导，speedRisks/错因仍来自 records）、`getRecommendedPracticeSet`（按节点归因过滤题目，无匹配回退旧口径）
  - 新增 `test/node-mastery-map.test.js`（2 项）、`test/node-mastery-read-switch.test.js`（5 项契约）
  - `test/recommended-set-dedupe.test.js`（窗口改为覆盖整个函数体，意图不变）
  - `scripts/integration-postgres.mjs`（灰度重启断言：mastery-map 弱/复习状态、overview 薄弱点节点推导、推荐题组节点归因）
- 数据库变化：无迁移；生产灰度需在 `.env.production` 设 `USE_KNODE_MASTERY=true`（部署后重启生效，回滚=删除该变量）
- API 变化：响应结构不变；数值在开关开启后改为 EMA 节点掌握度（设计内漂移）
- 测试结果：`npm run build:api` 通过；`npm run build:web` 通过；`npm test` 544 项 543 通过 / 1 跳过 / 0 失败；`npm run test:integration:postgres` `ok:true`（含阶段 2 灰度断言）；`npm run test:integration:content-import` `ok:true (questions=320)`
- 截图或验证证据：集成日志显示灰度重启后 `GET /mastery-map`、`GET /dashboard/overview`、`GET /practice-sets/recommended` 断言通过
- 遗留问题：只读缓存为单实例快照（写入后刷新，重启后与库一致）；多实例一致性列入阶段 5；计划语义迁移（StudyTask→knowledgeNodeId）属 Phase 2b 单独评审
- 下一步：申请提交/推送并部署；服务器开启灰度开关后浏览器验证；随后进入阶段 3（题库图谱化 + 真题接入）

### 2026-08-14 阶段 1：知识图谱掌握度着色

- 日期：2026-08-14
- 任务：把 `UserKnowledgeMastery` 回填结果叠加到 408 知识图谱页——节点按掌握度状态着色/加徽章，详情抽屉展示“我的掌握度”并可一键“去练习”。
- 修改原因：阶段 0b 完成掌握度回填后，图谱页仍是纯静态目录，学生看不到“我掌握了哪些节点、哪些薄弱”，无法形成“图谱 → 练习 → 图谱”的闭环。
- 修改文件：
  - `packages/shared/src/score-center/mastery.ts`（新增 `deriveNodeMasteryStatus`：untouched/weak/review/mastered）+ `index.ts` 导出
  - `apps/api/src/score-center/service.ts`（新增 `getMyMastery`，返回节点掌握度统计与派生状态）、`routes.ts`（新增 `GET /knowledge/mastery`，置于 `knowledge/:id` 之前，student/teacher/admin）
  - `apps/web/src/api/endpoints/score-center.ts`（`fetchMyMastery` + `NodeMasterySummary`/`MyNodeMastery` 类型）
  - `apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx`（加载掌握度 → `masteryById` → 传树与抽屉；静态演示模式跳过 API）、`KnowledgeTree.tsx`（`mastery-weak/review/mastered` 行着色 + 状态徽章）、`KnowledgePointDetailDrawer.tsx`（“我的掌握度”区块 + “去练习”按钮）、`constants.ts`（状态文案）、`App.tsx`（`<KnowledgeCatalog onNavigate={setActiveSection} />`）、`styles.css`
  - 新增 `test/node-mastery-status.test.js`（2 项）、`test/knowledge-graph-mastery.test.js`（3 项契约测试）
  - `scripts/integration-postgres.mjs`（行为级断言：`GET /knowledge/mastery` 返回练习节点 attempts/wrongCount/status）
- 数据库变化：无
- API 变化：新增 `GET /knowledge/mastery`（仅新增端点，向后兼容）
- 测试结果：`npm run build:api` 通过；`npm run build:web` 通过；`npm test` 537 项 536 通过 / 1 跳过 / 0 失败；`npm run test:integration:postgres` 通过（含新端点断言）；`npm run test:integration:content-import` `ok:true (questions=320)`
- 截图或验证证据：契约测试 GREEN 输出；集成测试日志显示 `GET /knowledge/mastery 200`
- 遗留问题：`fetchMyMastery` 在 API 失败时显示错误文案（不静默回退）；掌握度颜色在旧版浏览器需人工确认；阶段 2 将把同一口径接入推荐与计划
- 下一步：申请提交/推送并部署；部署后浏览器验证图谱着色与“去练习”跳转；随后进入阶段 2

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

### 2026-08-14 浏览器审计后修复：图谱跨科目搜索引导 + 错题详情/答题反馈命名统一

- 日期：2026-08-14
- 任务：按全功能浏览器审计结果修复 F1（知识图谱跨科目搜索无引导）、F2（错题详情出现“未知考点”）、F4（答题反馈/目标进度仍用粗粒度命名）。
- 修改原因：审计发现搜索被限定当前科目但无切换提示；`getWrongQuestionDetail`/`getPracticeFeedback` 未走目录显示映射。
- 修改文件：
  - `packages/shared/src/knowledgeCatalog.ts`（新增 `summarizeSearchHits` 纯函数）+ `index.ts` 导出
  - `apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx`（其他科目有匹配时展示“切换到 XX（N 个匹配）”引导按钮）
  - `apps/api/src/study/study.service.ts`（`getWrongQuestionDetail`/`getPracticeFeedback` 的知识点标题/章节经 `resolveKnowledgePointDisplay` 解析，回退顺序 display → point.title → 兜底）
  - 新增 `test/knowledge-catalog-search-hint.test.js`（4 项）、`test/catalog-naming-wiring.test.js`（3 项）
- 数据库变化：无
- API 变化：响应结构不变；`GET /wrong-questions/:id/detail` 与答题反馈的 `knowledgePointTitle`/`chapter` 在配置映射后返回目录命名
- 测试结果：`npm run build:api` 通过；`npm run build:web` 通过；`npm test` 518 项 517 通过 / 1 跳过 / 0 失败（含 7 项新测试）
- 截图或验证证据：审计报告见 `C:\Users\Lenovo\.codex\visualizations\2026\08\14\019ffe2e-cc7a-7f31-b249-0667c51084dc\audit-deployed\`
- 遗留问题：F3（计划 reviewDue 与到期复习不一致）、F5（今日提分空态无生成入口）、F6（推荐题组同题干重复）、F7（周条日期陈旧）、F8（报告口径并存）待评估；F1 修复后需部署验证
- 下一步：申请提交/推送并部署，随后重跑浏览器审计验证 F1/F2/F4

跟进（同日）：线上验证 F1 通过（搜索 “Cache” 出现“切换到计算机组成原理（8 个匹配）”，点击后正常展示）、F4 通过（答题反馈显示“Cache基本原理”）；F2 复测发现错题详情仍偶发“未知考点”——根因是详情用题目第 1 个绑定 id 解析，而列表用答题记录 id，二者可能不一致。已修复：`getWrongQuestionDetail` 优先用最新答题记录的知识点 id 解析（与列表同源），新增回归断言（`catalog-naming-wiring.test.js` 第 2 条）。待提交部署后复测 F2。

### 2026-08-14 审计项 F3/F5/F6：reviewDue 口径、今日提分空态、推荐题组去重

- 日期：2026-08-14
- 任务：修复审计报告的 F3（今日计划 reviewDue 与到期复习不一致）、F5（今日提分空态无生成入口）、F6（推荐题组同题干重复）。
- 修改原因：`plan.reviewDue` 原为“待复盘错题数”，与 `/review/due` 的到期复习数不是同一口径；今日提分在“计划存在但 0 项”时不显示生成按钮；推荐题组未按题干去重。
- 修改文件：
  - `apps/api/src/study/study.service.ts`：两条 `getTodayPlan` 路径的 `reviewDue` 改为 `this.getDueReviews(userId).dueCount`（与到期复习组件同源）；`getRecommendedPracticeSet` 用 `dedupeQuestionsByStem` 去重后再切片
  - `packages/shared/src/learning.ts`：新增 `dedupeQuestionsByStem` 纯函数（按 `stem.trim()` 去重，保留首个）
  - `apps/web/src/features/today-score-center/TodaysScoreCenter.tsx`：`isEmptyPlan = !plan || plan.items.length === 0`，空态显示“生成今日计划”主按钮
  - 新增 `test/review-due-consistency.test.js`（1 项）、`test/today-score-center-empty.test.js`（1 项）、`test/recommended-set-dedupe.test.js`（3 项）
- 数据库变化：无
- API 变化：`GET /today/plan` 的 `reviewDue` 语义修正为到期复习数（前端徽标与下一步卡片随之正确）；响应结构不变
- 测试结果：`npm run build:api` 通过；`npm run build:web` 通过；`npm test` 524 项 523 通过 / 1 跳过 / 0 失败（含 5 项新测试）
- 遗留问题：F7（周条日期陈旧）、F8（报告口径并存）与无障碍走查仍待处理
- 下一步：申请提交/推送并部署，随后线上验证 F3/F5/F6

### 2026-08-14 审计项 F7/F8：七天计划滚动、报告建议口径统一

- 日期：2026-08-14
- 任务：修复审计报告的 F7（计划周条日期陈旧）与 F8（报告“较上阶段提升”与“暂无测评”并存、总览与阶段报告建议不一致）。
- 修改原因：七天计划在入学时生成、过期后不滚动，`getTodayPlan` 一直展示旧周条；报告“主要进步/下周最重要任务”用练习记录弱点评分，而阶段报告/长期薄弱点用掌握度评分，两套口径并存且无来源标注。
- 修改文件：
  - `apps/api/src/study/study.service.ts`：`getTodayPlan` 检测到计划最后计划日 < 今天时，用 `buildSevenDayPlan` + `saveOnboarding` 滚动重建并持久化（幂等，每天最多一次）
  - `apps/web/src/features/student/NextLearningStepCard.tsx`：`buildReportNextLearningStep` 新增可选 `masteryWeakestPointTitle`，优先使用掌握度最弱点
  - `apps/web/src/features/report/ReportSummaryPanel.tsx`：“主要进步”标注“（基于练习记录）”；“下周最重要任务”优先取 `stageReport.mastery.weakestPoints[0]` 并标注“（基于掌握度地图）”；报告下一步卡片同步传入掌握度最弱点
  - 新增 `test/plan-rollover.test.js`（1 项）、`test/report-action-consistency.test.js`（1 项）；`test/next-learning-step-ui.test.js` 新增 resolver 掌握度优先用例（1 项）
- 数据库变化：无（计划滚动复用既有 `saveOnboarding`，幂等；旧计划归档）
- API 变化：`GET /today/plan` 在七天计划过期后返回滚动后的新计划（周条/今日任务随当天对齐）；响应结构不变
- 测试结果：`npm run build:api` 通过；`npm run build:web` 通过；`npm test` 527 项 526 通过 / 1 跳过 / 0 失败（含 3 项新测试）
- 遗留问题：无障碍走查（同文本按钮 aria-label、树折叠 aria-expanded、键盘焦点）需人工/读屏复核；P2-2 两套掌握度口径在计算层面仍未合并（方案 C）
- 下一步：申请提交/推送并部署，随后线上验证 F7/F8

跟进（同日）：部署后 F8 线上验证通过；F7 复测发现滚动后周条与今日任务为空——根因：滚动时 `buildSevenDayPlan` 内部调用 `generatePlan`，而过期旧计划仍在内存 Map，导致 `generatePlan` 按“今天过滤旧任务”返回空，新计划被建成 0 任务。已修复：滚动前先从内存移除旧计划再构建新计划，并把滚动条件从“过期”放宽为“过期或空任务”（兼容已损坏的空计划）；新增集成回归断言（`integration-postgres.mjs`，把活动计划任务日期改为 2020-01-01 后断言 `/today/plan` 返回 7 天周条与今日任务）。待部署复测。

### 2026-08-14 方案 C 调研：以 UserKnowledgeMastery 为唯一掌握度源

- 日期：2026-08-14
- 任务：产出方案 C 调研与设计文档（只读分析，未改代码）。
- 修改原因：P2-2 两套掌握度口径并存；方案 B 已统一显示命名，方案 C 旨在统一计算口径。
- 修改文件：`docs/superpowers/specs/2026-08-14-knowledge-catalog-engine-option-c.md`（新增）、`docs/superpowers/plans/2026-08-14-knowledge-catalog-engine.md`（Task 4 勾选）
- 数据库变化：无
- API 变化：无
- 测试结果：未运行（纯文档改动）
- 核心结论：`UserKnowledgeMastery` 写入路径与归因链已具备（真题标签直连 + `KnowledgePointNodeMap` 兜底，starter-320 题可归因）；前置缺口是历史记录回填；建议按 Phase 1 数据回填 → Phase 2 灰度只读切换（mastery map/薄弱/推荐/计划）→ Phase 2b 计划语义迁移 → Phase 3 收敛 推进，并在灰度期提供对比模式与开关回滚。
- 下一步：用户确认后启动 Phase 1（归因 dry-run + 回填脚本 + 集成测试）

### 2026-08-14 阶段 0：题库清重 + 掌握度回填（方案 C Phase 1）

- 日期：2026-08-14
- 任务：启动“阶段 0→5 统一提分系统”路线：0a 题库重复题干体检/去重；0b 历史 `PracticeRecord` 回填 `UserKnowledgeMastery`。
- 修改原因：生产题库行数（326~328）多于源 CSV 唯一题干（320），存在历史重复行；`UserKnowledgeMastery` 缺历史数据，无法支撑图谱掌握度着色。
- 修改文件：
  - 新增 `scripts/question-bank-dedupe.mjs`（`planDedupe`/`summarizeBank` 纯逻辑 + CLI `--dry-run/--apply`，按 `isCurrent=false` 归档重复行，幂等）
  - 新增 `scripts/backfill-user-mastery.mjs`（按时间顺序重放 `PracticeRecord` 到节点掌握度，归因链：真题标签直连 → `QuestionKnowledgePoint → KnowledgePointNodeMap`；`--dry-run/--user`，确定性重建、幂等）
  - 新增 `test/question-bank-dedupe.test.js`（3 项）、`test/backfill-mastery.test.js`（2 项）
  - `scripts/integration-content-import.mjs`（导入后断言无重复题干）、`scripts/integration-postgres.mjs`（掌握度回填幂等与 attempts=correct+wrong 回归）
- 数据库变化：无迁移；生产需执行 `question-bank-dedupe.mjs`（归档重复行，可回滚=恢复 isCurrent）与 `backfill-user-mastery.mjs`
- API 变化：无
- 测试结果：`node test/question-bank-dedupe.test.js`、`test/backfill-mastery.test.js` 全绿；`npm run test:integration:content-import` `ok:true (questions=320)`；`npm run test:integration:postgres` `ok:true`（含回填回归）；`npm test` 532 项 531 通过 / 1 跳过 / 0 失败
- 遗留问题：生产库实际重复行数需在服务器跑 `question-bank-dedupe.mjs --dry-run` 确认后归档；无法归因的历史记录（无标签且无映射）由 dry-run 列出，后续补标
- 下一步：申请提交/推送并部署；生产执行去重与回填；随后进入阶段 1（图谱掌握度着色）

### 2026-08-14 部署固化：镜像内置桥接 seed + deploy.sh 自动种映射并重启

- 日期：2026-08-14
- 任务：把 `seed-knowledge-point-map.mjs` 打入生产镜像，并在 `deploy.sh` 中自动执行桥接 seed 与重启 app，避免手动 `docker cp`/`restart`。
- 修改原因：线上部署时映射在 API 启动后写入，导致命名解析需手动重启才生效；Dockerfile 未内置新 seed 脚本。
- 修改文件：`Dockerfile`（生产阶段新增 `COPY scripts/seed-knowledge-point-map.mjs`）、`deploy/tencent-ip/deploy.sh`（seed-408 后追加 seed-knowledge-point-map 与 `restart app`）
- 数据库变化：无
- API 变化：无
- 测试结果：`sh -n deploy/tencent-ip/deploy.sh` 语法校验通过；部署时序为“种目录 → 写映射 → 重启生效”
- 截图或验证证据：线上实际执行 seed 输出 `KnowledgePointNodeMap rows: 16`；重启后报告卡片显示目录命名“信号量”
- 遗留问题：无
- 下一步：提交推送（需用户批准）

### 2026-08-14 P0-2 方案 B：KnowledgePointNodeMap 桥接 + 经典闭环命名解析

- 日期：2026-08-14
- 任务：按用户确认的方案 B，把 16 个粗粒度 `KnowledgePoint` 桥接到 408 目录原子点（`KnowledgeNode`），并让经典闭环（掌握度地图/薄弱报告/错题）的命名与章节统一走目录解析。
- 修改原因：经典闭环仍以 16 粗粒度点命名，与全量目录（1149 原子点）割裂；方案 B 用既有 `KnowledgePointNodeMap` 表桥接，计算口径不变、仅统一对外展示，风险最小。
- 修改文件：
  - 新增 `data/408/knowledge-point-node-map.json`（16 条 PRIMARY 映射 + confidence + note，需教研复核）
  - 新增 `scripts/seed-knowledge-point-map.mjs`（幂等 upsert `KnowledgePointNodeMap`，`--dry-run` 无库校验）+ `package.json` 的 `seed:knowledge-map`
  - 新增 `packages/shared/src/knowledgeDisplay.ts`（`resolveKnowledgePointDisplay` 纯函数，无映射回退原值）并导出
  - `apps/api/src/study/knowledge-point.repository.ts`（新增 `listNodeMaps()`，经 `KnowledgePointNodeMap` + `KnowledgeNode` 父子链返回目录标题/章节）
  - `apps/api/src/study/study.service.ts`（启动加载显示映射；`getMasteryMap` 输出、`getOverviewReport` 薄弱/速度风险、`listWrongQuestions` 标题与章节经解析函数输出）
  - 新增 `test/knowledge-point-node-map.test.js`（3 项）、`test/knowledge-display.test.js`（3 项）；`scripts/integration-postgres.mjs` 新增桥接行持久化断言
- 数据库变化：无迁移（复用既有 `KnowledgePointNodeMap` 表；seed 脚本为纯增量 upsert，回滚=删除映射行）
- API 变化：无路由/响应结构变化；配置映射后掌握度地图、薄弱报告、错题详情使用目录命名（无映射时行为不变）
- 测试结果：`npm run build:api` 通过；`npm run build:web` 通过；`npm test` 511 项 510 通过 / 1 跳过 / 0 失败；`npm run test:integration:postgres` `{"ok": true}`（含桥接行断言）；`node scripts/seed-knowledge-point-map.mjs --dry-run` 校验 16 条映射全部命中原子点
- 截图或验证证据：`verify:408-data` 通过（1296 节点 / 1149 原子点 / 1149 频率项 / 611 真题）；dry-run 输出 16 条映射
- 遗留问题：16 粗粒度点→原子点的 PRIMARY 代表点映射为名称匹配初版，需教研复核并调整 confidence；生产库需执行 `seed:knowledge-map`（含先 `seed:408` 保证 KnowledgeNode 存在）；两套掌握度口径（P2-2）在计算层面仍未合并（方案 C 待后续）
- 下一步：申请提交/推送；部署后运行 `seed:knowledge-map` 并线上验证掌握度/错题命名

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

### 2026-08-17 实施：A/B/C 三档界面主题切换并部署上线

- 日期：2026-08-17
- 任务：登录后工作区新增「深色 / 极简 / 标准」三档主题切换（A/B/C），支持 localStorage 持久化与首帧防闪烁，并部署到 `43.128.30.191`。
- 修改原因：用户确认方案 C（深墨纸白）为默认，并要求 A/B/C 三档可按钮直接切换；D（数据驾驶舱）仅作为 Mockup 参考，不进入系统。
- 修改文件：`apps/web/src/App.tsx`（顶栏挂载切换按钮）、`apps/web/src/main.tsx`（首帧前恢复主题）、`apps/web/src/styles.css`（A/B 两套 token 与表面色覆盖）、`apps/web/src/components/ThemeToggle.tsx`（新增）、`apps/web/src/hooks/useTheme.ts`（新增）、`apps/web/src/theme/themePreference.ts`（新增）、`test/theme-preference.test.js`（新增）；设计交付物 `design/option-c-mockups/`（未入库）。
- 数据库变化：无。
- API 变化：无。
- 测试结果：`node --test test/theme-preference.test.js` 6/6 通过；`npm test` 577 通过 / 0 失败 / 1 跳过；`npm run build:web` 通过；`npm run build:api` 通过。
- 截图或验证证据：浏览器实测三主题即时切换、localStorage 持久化、刷新保持（存 A 刷新仍深色）、三主题均无横向溢出；线上 bundle `index-CUi0Kb3N.js` 包含 `theme-switch` 与 `kaoyan408:theme`。
- 遗留问题：深色主题已覆盖主要表面，个别老组件若仍有硬编码浅色需截图后逐条补覆盖；B（极简）为 token 级收敛，布局骨架未动；登录/注册页保持原深色设计，不参与切换；主题切换入口仅在登录后顶栏。
- 下一步：`npm run verify:deployed` 线上全量核对（登录后切主题、刷新保持）；按 `docs/ROADMAP.md` 与「当前状态」继续后续任务。

### 2026-08-20 P0 核心学生闭环发布验收

- 日期：2026-08-20
- 任务：记录 P0 阶段已部署，并通过线上核心学生闭环验证。
- 修改原因：P0 修复已发布到腾讯云后，需要在项目日志中保留发布提交、验证范围与后续阶段起点。
- 修改文件：无业务代码改动（本条为发布记录）。
- 数据库变化：无新增迁移；线上 E2E 使用测试账号产生了授权范围内的学习数据变更。
- API 变化：无。
- 测试结果：发布提交 `04d8199`；部署前本地验证 `npm test`、`npm run build:api`、`npm run build:web`、`npm run validate:env:development` 通过；线上 `npm run verify:p0-student -- --base-url http://43.128.30.191/ --email 1234@qq.com --password <授权测试密码>` 核心检查 15/15 通过。
- 截图或验证证据：`assets/p0-student-loop-check/report.json`；验证范围覆盖登录、今日计划、做题、错因提交、错题详情、重做、知识图谱。
- 遗留问题：线上仍为 IP HTTP 访问，HTTPS 正式域名启用按既有部署文档继续；本轮仅确认核心学生闭环。
- 下一步：进入 P1-1「知识图谱首屏增强」。

### 2026-08-20 P1-1 知识图谱首屏增强

- 日期：2026-08-20
- 任务：在 408 知识图谱页首屏新增「建议先看」推荐区，按薄弱、高频、闯关状态给学生三个优先查看的知识点入口。
- 修改原因：知识图谱原有首屏直接进入完整树和筛选器，新用户需要自己判断先看哪里；P1-1 目标是降低首屏理解成本，把提分优先级前置。
- 修改文件：
  - `packages/shared/src/knowledgeCatalog.ts`、`packages/shared/src/index.ts`（新增 `buildKnowledgeCatalogFirstScreenHighlights` 纯函数与类型导出）
  - `apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx`（首屏推荐区接入，点击复用详情抽屉选择路径）
  - `apps/web/src/styles.css`（首屏推荐卡片与移动端单列样式）
  - `test/knowledge-catalog-first-screen.test.js`、`test/knowledge-catalog-ui.test.js`（TDD 覆盖推荐排序、fallback 与页面接线）
- 数据库变化：无。
- API 变化：无。
- 测试结果：`node test/knowledge-catalog-first-screen.test.js` 3/3 通过；`node test/knowledge-catalog-ui.test.js` 16/16 通过；`npm test` 612 通过 / 0 失败 / 1 跳过；`npm run build:api` 通过；`npm run build:web` 通过（仅既有 chunk 体积警告）。
- 截图或验证证据：聚焦测试与全量测试输出均为通过；Web 构建产物包含 `KnowledgeCatalog-C3m1Lfnb.js`。
- 遗留问题：2026-08-20 线上浏览器验收发现已部署版本中「薄弱优先」fallback 会在无 weak/review 节点时推荐已掌握节点；本地已补回归测试并修复为优先 fallback 到未掌握/未通关高频候选，待提交推送并重新部署后复验。
- 下一步：提交/推送线上验收修复 → 重新部署 → 复验知识图谱首屏；通过后进入 P1-2。

### 2026-08-20 P1-2 知识图谱推荐卡行动增强

- 日期：2026-08-20
- 任务：增强知识图谱「建议先看」推荐卡的行动语义，并修复详情抽屉在无关联题库题时仍提供可执行练习/闯关入口的问题。
- 修改原因：P1-1 已把优先查看节点前置，但卡片缺少明确下一步；详情抽屉在题库未加载或无关联题时仍显示“去练习/开始闯关”，会让学生产生点击无反馈或学习闭环断裂的感受。
- 修改文件：
  - `packages/shared/src/knowledgeCatalog.ts`、`packages/shared/src/index.ts`（推荐 highlight 增加 `actionType/actionLabel/actionHint`）
  - `apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx`（首屏推荐卡渲染行动文案与行动提示）
  - `apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx`（按加载中/无题库题/有题库题区分练习与闯关行动态）
  - `apps/web/src/styles.css`（推荐卡行动文案与抽屉禁用说明样式）
  - `test/knowledge-catalog-first-screen.test.js`、`test/knowledge-catalog-ui.test.js`（TDD 覆盖行动字段和无题库禁用合同）
- 数据库变化：无。
- API 变化：无。
- 参考方向：参考 GOV.UK disabled button 指南、Carbon/Atlassian empty state 指南和 Material button label 指南；落地为“禁用时必须说明原因，空态必须给下一步，按钮文字描述实际动作”。
- 测试结果：RED 阶段新增测试按预期失败；GREEN 后 `node test/knowledge-catalog-first-screen.test.js` 3/3 通过，`node test/knowledge-catalog-ui.test.js` 17/17 通过；`npm test` 613 通过 / 0 失败 / 1 跳过；`npm run build:api` 通过；`npm run build:web` 通过（仅既有 Vite 动态导入与 chunk 体积提示）。
- 遗留问题：尚未提交、推送和线上部署；上线后需要用真实测试账号复验知识图谱首屏推荐卡和无题库节点抽屉禁用态。
- 下一步：提交/推送 P1-2 → 用户手动部署 → 线上浏览器验收后进入 P1-3。

### 2026-08-20 P1-3 知识图谱推荐卡意图落点增强

- 日期：2026-08-20
- 任务：让知识图谱「建议先看」推荐卡的点击落点与行动文案一致：薄弱卡定位到学习证据/掌握度，高频卡定位到真题命中，闯关卡定位到节点闯关。
- 修改原因：P1-2 已给推荐卡增加行动文案，但点击后仍统一打开详情抽屉顶部，学生还需要自己寻找对应区块；P1-3 目标是减少“点了之后去哪看”的理解成本。
- 修改文件：
  - `apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx`（记录推荐卡 `actionType`，普通树点击/关闭抽屉时清空 intent，并传给详情抽屉）
  - `apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx`（按 `inspect/exam/quest` intent 滚动并聚焦对应区块；薄弱 intent 同时高亮学习证据和我的掌握度）
  - `apps/web/src/styles.css`（详情抽屉目标区块轻量高亮样式）
  - `test/knowledge-catalog-ui.test.js`（TDD 覆盖 intent 传递、普通树点击清空 intent、抽屉落点映射）
- 数据库变化：无。
- API 变化：无。
- 参考方向：参考 WAI-ARIA Dialog focus 管理、Carbon AnchorLinks、Material drawer focus/active destination、Atlassian selected/focus state；落地为“打开抽屉后把对应静态区块设为可程序聚焦并滚入视野，使用轻量 selected 边框/背景提示当前落点”。
- 测试结果：RED 阶段新增测试按预期失败；GREEN 后 `node test/knowledge-catalog-ui.test.js` 19/19 通过；`node test/knowledge-catalog-first-screen.test.js` 3/3 通过；`npm test` 615 通过 / 0 失败 / 1 跳过；`npm run build:api` 通过；`npm run build:web` 通过（仅既有 Vite 动态导入与 chunk 体积提示）。
- 遗留问题：尚未提交、推送和线上部署；上线后需要浏览器验收三张推荐卡是否滚动/高亮到对应区块，且普通知识树点击不残留推荐 intent。
- 下一步：提交/推送 P1-3 → 用户手动部署 → 线上浏览器验收；通过后继续后续 P1 阶段。

### 2026-08-29 Phase R：修复与收线（build:api 解阻塞 + CQRS 工作区落库 + V3 Sprint 1 接线）

- 日期：2026-08-29
- 任务：解除 build:api 阻塞；裁定并修复 10 个真实测试分歧；将约 200 个未提交文件按工作线分批提交；完成 V3 Sprint 1 收尾（StudentHome/TestSection 接线、旧分支清理）；文档收线。
- 修改原因：test/today-plan-projection.test.js 的写回式 TS 加载器把转译产物写回源文件路径，剥离了 today-plan-projection.service.ts 全部类型注解导致 build:api 失败；新 CQRS provider 缺 @Injectable/注册导致 Nest DI 无法解析；exam-score-history parity 与 assessment-history projection 的失败均由测试 stub 与真实 builder 语义不符造成。
- 修改文件：apps/api/src/study/today-plan-projection.service.ts（重建类型化源码）、study.module.ts（PracticeProjectionService 注册 + ExamScoreHistoryProjectionService 工厂 provider）、12 个 study 服务补 @Injectable（stage-assessment/dashboard/assessment-history/exam-score-history/today-plan/assessment-projection/practice-projection）、3 个 query 服务的默认参改 @Optional + 方法内兜底、test/today-plan-projection.test.js 重写加载器、15 个沙箱测试补 @nestjs/common stub、exam-score-history-legacy-parity（设 DATABASE_URL + 忠实快照 stub）、assessment-history-projection（忠实 where 过滤 + 摘要派生 stub）、apps/web StudentSections/StudentHome/TestSection/App.tsx 接线与旧分支删除、styles.css 新增布局样式、test/v3-section-wiring.test.js 新增、goal-progress/console-ui/p2-info/score-center 四个结构测试随行为迁移更新、docs/handoff 状态更新。
- 数据库变化：无新增迁移；随本批提交 3 个既有未提交迁移（answer_receipts、user_knowledge_mastery_version、study_task_progress），均为增量可回滚。
- API 变化：新增 GET /student-state；POST /practice-records 要求 Idempotency-Key 请求头（缺失 400）；/reports/overview 响应形状未变。
- 参考方向：复用仓库内 stage-assessment-projection.test.js 的安全沙箱 CommonJS 加载模式替代写回式加载；DI 修复沿用 student-state-projection 已有的 @Optional 模式。
- 测试结果：`npm test` 1006 项：1005 通过 / 0 失败 / 1 跳过；`npm run build:api`、`npm run build:web` 通过；`npm run test:integration:postgres` 通过（Docker 测试库）；无 DB 内存模式启动 StudyModule DI 解析通过且 /health 200；浏览器走查学生端首页（StudentHome 组合层）、测试中心（阶段测评入口 + 完整报告）、题库页均正常，5 项导航全局一致。
- 集成测试收尾补充：首轮集成测试暴露 compat 读层多处未达遗留契约——dashboard/overview、/mastery-map、/trial-progress、/assessments/stage、/today/plan 的投影适配缺少题目目录、任务质量、weekProgress 等事实（前人 phase 设计文档已登记的已知缺口），且 assessment-history 投影漏掉 sessionId/paperId 字段。处置：前五者按过渡期模式以 @Optional legacy 委托遗留实现（响应结构立即恢复，投影链保留给 /student-state 与后续 parity 工作），assessment-history 以精确修复补齐 sessionId/paperId 透传；集成脚本为 POST /practice-records 自动附加 Idempotency-Key（新契约）；三个「query 服务禁止依赖 StudyService」边界测试更新为「允许 @Optional 过渡委托、其余脏依赖仍禁止」。
- 截图或验证证据：走查为浏览器 DOM 快照核验；启动日志无 Nest 依赖解析错误。
- 遗留问题：OverviewReportAdapter 与 /reports/overview 接线未做（Phase 2.8.5 第二步）；掌握度双口径灰度未切换；前端 mock 未删；/trial-progress 等三端点未废弃；docs/handoff/README.md 与 agent-context.md 中其余部分仍按旧基线表述。
- 下一步：Phase 2.8.5 第二步（Adapter + 接线）或 V3 Sprint 2（前端切换 /student-state、删除 mockData、废弃三冗余端点）。
