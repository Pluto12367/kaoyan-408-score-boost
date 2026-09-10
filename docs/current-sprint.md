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

> **2026-09-07 V9 Learning Experience OS Mission 启动（Phase 0 完成）**：使命 = 从 AI 辅助工具升级为 AI 考研教练。基线固化：本地 8c0e455（V8 全量 22 commits 已推送未部署生产），测试 1899/1897/0 全绿。Phase 0 产出 docs/v9-baseline-audit.md：教练差距模型（7 类教练行为 vs 现状差距映射到 6 个 Phase）+ 可复用资产清单（StudentContext/风险层/effectiveness/仲裁器/AI 层冻结复用）+ 红线（LLM 只做已核实事实的语言组织、insufficient_data 贯穿、无第二套 SoT）。Phase 1 完成（4d107f9 + slice2）：DailyBrief 纯派生 + GET /coach/daily-brief + 首页简报卡 + focus/visibility/自定义事件重算。Phase 2 Adaptive Weekly Planner 完成：weekly-adjustment 纯模块（上周证据 → intensity_up 1.2 / maintain / down 0.8，证据不足强制 maintain）+ 重建链应用（跳过 carry 任务，minutes 下限 15）+ 响应 weeklyAdjustment 字段；EffectivenessModule 导出 EffectivenessService 供 StudyModule 注入（构造器末位 @Optional）。npm test 1913/1911/0。Phase 3 Learning Progress Dashboard 完成：progress-narrative 纯模块（周环比 = 本周/上周 7 日均值差，各半区 ≥2 有效值才对比，否则 no_data；里程碑行仅随证据出现）+ GET /coach/progress-narrative + 报告总览 tab 本周进步叙事卡。npm test 1918/1916/0。Phase 4 Knowledge Galaxy 2.0 完成：shared filterKnowledgeTree 新增 onlyWeak+masteryById 过滤（weak 状态或 mastery<45 才算薄弱，未知≠薄弱）+ 前端 只看薄弱 toggle；Galaxy 关系计数诚实化（视图内 N 条 · 全库 M 条——根因是知识树关系数据稀疏：1296 节点仅 33 前置/21 关联，DS 科目内 0 边，属内容侧缺口对应 backlog B13）。npm test 1920/1918/0。Phase 5 主动教练完成：GET /coach/proactive（StudentContext→signals→detectLearningRisks→deriveProactiveInterventions，slice(0,2) 频次上限）+ 首页 ProactiveCoachCard（count=0 静默、demo 隐藏、错误不变成横幅）；LearningSignalService 注册进 StudyModule。npm test 1921/1919/0。Phase 6 完成：coach-experiments 纯模块（assignExperimentArm = sha256(userId::key) 确定性分流，无持久化不漂移；deriveFeedbackInsights 场景负反馈≥3 → 实验候选）+ GET /coach/experiment-assignment（只读标记，特性自行决定变什么）+ GET /coach/feedback-insight（teacher/admin，反馈回流信号，绝不自动改生产）。npm test 1924/1922/0。V9 生产部署完成（服务器 HEAD e65eaf7）：备份（kaoyan408 角色，1.2M）→ 显式 refspec 更新 → 重建 → 4 端点冒烟全过（daily-brief headline 正确点名任务、proactive 2 条、progress-narrative +7.4 点、A/B 分流正常）→ 冒烟抓到并修复 1 个真 bug（repeated_mistake 文案读旧键 weakWrongRatio 致 错误占比 0%，已改读 wrongStreakRatio 并加契约测试，e65eaf7 需再拉取重建一次上线）。npm test 1925/1923/0。**生产复测通过（2026-09-07，服务器 a7dd1b5）**：health ok；proactive 复测 headline 显示真实占比 100%（该节点全部作答错误，与错 6 次未掌握一致——数字诚实且与高风险判定自洽）；缓存清理 1.2GB。V9 部署验证闭环，V9 Mission 关闭。

> **2026-09-07 前端设计体系落地（DESIGN.md v2.0 + token 收敛第一步 + 主题 D · Notion）已完成（未提交，用户决定入库时机）**：基于 [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)（MIT）的 DESIGN.md 方法论四阶段落地。① `design/brand-previews/` 三品牌静态预览（Linear/Notion/Claude，同一结构 CSS 纯 `--p-*` 换肤，DOM 审计+截图验证通过），用户选定 Notion；② 根目录 `DESIGN.md` v2.0（Stitch 九章节：逐主题 hex 色板/排版/组件状态/布局/阴影/Do&Don't/响应式断点 640-900/代理提示词 + §10 主题 D 色板），`docs/frontend-design-system.md` 头部加指针保留为 v1.0 基线；③ token 收敛：`:root` 新增 `--space-1..6`（4px 网格），别名收敛 `--muted→--text-muted`（全主题精确同值）、`--text-soft→--text-secondary`（A/B 同值，C 微移以 canonical 为准；计划原写保留 --text-soft，按代码事实以占主导且合族的 --text-secondary 为准，已向用户说明）、`--slate-900→--surface-sidebar` 语义化（侧边栏深色面）、`--slate-800/300` 零引用删除；22 处 var 替换全在 styles.css，theme-optimizations.css 仅删 2 行别名定义；`ui-design-tokens.test.js` 契约断言同步（新增"旧别名必须保持删除"守卫）；④ 主题 D：styles.css 新增 `html[data-theme="d"]` **纯 token 覆盖块**（目标模式示范，不新增逐类覆盖）+ `themePreference.ts` 注册（'d'/'Notion'）+ 契约测试更新（'e' 为非法值用例）。验证：`npm run build:web` PASS ×2；`npm test` 1925/1923/0 ×2（与 V9 基线一致，零新增失败）；dev 目检：d 登录页与仪表盘 Notion 风格正常、4 按钮切换器桌面+375px 均无溢出、a/b/c 背景基线逐一切换无回归。**附带必要修复**：`StudentHome.tsx` 尾部错位 `import { lazy, Suspense }`（f9f15b4 引入，dev 模式 TDZ `Cannot access 'lazy' before initialization` 致整个应用无法挂载；生产构建不受影响），1 行移至文件顶部以解除目检阻塞。DESIGN.md 后续维护规则：页面/主题/token 变更须同步更新该文件。

> **2026-09-07 V10 AI Learning Sprite（AI学习精灵）Mission 启动（V10-0 Product Freeze 产出，待所有者确认）**：所有者已决议——版本号 **V10**（V9 编号保留给已关闭的 Learning Experience OS）、精灵人格**「星野」**（沉稳学长/陪跑教练，80% 鼓励/60% 严格/30% 幽默，禁鸡汤/PUA/焦虑/罪感化）、形象 **SVG 2D**（零图片资产零新依赖）、**MVP = V10-1 Sprite Core + V10-2 Sprite UI + V10-3 Companion Loop**（对话后置 V10-5、长期记忆后置 V10-4 且禁向量方案）。Phase 0 产出：`docs/ai-learning-sprite-design.md`（架构分析/复用清单/风险 11 项/Milestone）+ `docs/v10-sprite-product-constitution.md`（产品宪法：定位/画像/人格规则/对话原则/9 态情绪模型/MVP 范围/数据边界/技术约束/Success Metrics）。**零代码改动**：精灵定位为纯派生只读层（计划中 `GET /sprite/state`），不建新表、不迁移、不触碰 StudentContext/Mastery/RAG/Agent/Effectiveness 冻结架构，LLM 402 blocked 不阻塞 MVP。待所有者确认宪法后进入 V10-1 编码。

> **2026-09-07 V10-1 Sprite Core 完成（TDD，未提交，待所有者审查；V10-2 未启动等待确认）**：新增精灵后端核心——`apps/api/src/study/sprite-state.ts`（9 态 Mood Engine 纯派生：10 档有序守卫 recovery>concern>celebrate>rest>streak>encourage>idle + focused 会话强制安静 + unknown 双通道 insufficient_data/context_unavailable，全 mood 强制 evidenceRefs）、`sprite-persona.ts`（宪法六类禁词校验 + 全量台词模板，静态模板 build-time 自检、运行时干预 headline 不洁落安全兜底）、`sprite.controller.ts`（GET /sprite/state 只读，四来源防御性拉取失败记入 degraded.unavailableSources，celebrate 复用 buildProgressStory 有效性门），`study.module.ts` +2 行注册。契约设计见 `docs/v10-1-sprite-core-design.md`（Phase A 含开源参考检查：XState 守卫转移/游戏 FSM State/TUM Emotion Engine appraisal 模式，拒绝模糊逻辑）。验证：定向 18/18（先 RED 后 GREEN）；全量 **npm test 1943/1941/0**（基线 1925/1923/0 + 18 项零新增失败）；build:shared/api PASS；build:web 按门禁豁免（零前端变更）。**红线钉死**：零迁移零新表零存储、零 LLM（源码断言）、数字全部来自既有派生（concern 逐字复用 V4 headline 断言）。**预存问题归因**：PostgreSQL 集成脚本 `integration-postgres.mjs:1254` 断言"明日计划含 ≥3 目标任务"失败——摘除 SpriteController 复跑失败相同 + 全新库复现 → 属 HEAD 预存债务（疑 V8 #13 结转重锚/V9 周强度改计划管线后未再跑集成），本轮不修，见地雷区。报告：`docs/v10-1-sprite-core-final-report.md`。提交须精确 git add（新文件 3+测试 1+module 2 行+docs 3）。

> **2026-09-07 V10-2 Sprite UI 完成（TDD + 真实浏览器目检 + 端到端冒烟；未提交，待所有者审查；V10-3 未启动等待确认）**：新增前端呈现层 `apps/web/src/features/sprite/` 四文件——`spriteMood.ts`（mood→视觉纯映射：9 型 SVG 面孔/success·warning 状态点/breath·pulse 两档动效，未知回退 idle）、`useSpriteState.ts`（GET /sprite/state 拉取：isStaticDemoMode 门 + cancelled 卸载守卫 + requestId 防过期 + accountKey 切换清态 + daily-brief:refresh/focus/visibilitychange 重算 + 免打扰 localStorage `kaoyan408:sprite.muted`）、`SpriteWidget.tsx`（悬浮球 aria-expanded + role=dialog 面板：台词/依据展开(evidenceRefs 中文来源)/deep-link 行动/免打扰 aria-pressed，Escape+点击外部+关闭钮关闭，参数化 SVG currentColor）、`sprite.css`（纯 token 零 hex、z-index 60、≤720px 抬升至底部导航上方 calc(84px+safe-area)、prefers-reduced-motion 关停）；App.tsx +4 行挂载（学生 && !learningSessionType）；DESIGN.md §4 新增精灵组件小节。验证：定向 8/8（先 RED 后 GREEN）；全量 **npm test 1951/1949/0**（1943 基线 + 8 项零新增失败）；build:web PASS。**真实目检**（dev 栈 5174/3000 + IAB）：API 不可达时精灵诚实隐藏；面板台词/依据/行动/免打扰全渲染；A/B/C/D 四主题零破版；Escape/点外关闭/免打扰持久化实测；375px orb 悬于底部导航上方无溢出；**端到端冒烟**（demo-login token）真实库命中 concern/high_risk（V4 study_inactivity）、台词逐字复用干预 headline、unavailableSources 真实记录 today_plan 拉取失败——诚实降级链路生产语义成立。dev 栈已清理（端口无监听、孤儿进程已杀、临时日志已删）。报告：`docs/v10-2-sprite-ui-final-report.md`。提交须精确 git add（新文件 4+测试 1+App.tsx+DESIGN.md+docs 3）。

> **2026-09-07 V10-3 Companion Loop 完成——V10 MVP 线（V10-0~V10-3）收官（未提交，待所有者审查）**：①主动弹泡——问候（挂载首次 state）与完成回应（daily-brief:refresh 转 celebrate/rest）共用自然日额度（localStorage `kaoyan408:sprite.bubble`，写入失败视为已消费），muted 永不弹且即时隐藏，idle/focused 永不问候，8s 自匿带 cleanup，role=status 非模态；②成就反馈——`sprite-state.ts` 新增 `SpriteMilestone` 契约 + `deriveMilestones` 纯派生（evidence_gate/resolved/streak≥7/gap_recovery 四类，仅既有输入、≤3 条、每条强制 evidenceRef），面板"成就"区落地，quest 类里程碑后置；③埋点——`sprite.interact` 追加进 `TELEMETRY_EVENT_TYPES`（一行纯增量），前端 panel_open/bubble_shown(含 greeting/completion)/bubble_click/action_click 四 action 经 trackEvent best-effort。验证：定向 31/31（+5 先 RED 后 GREEN）；全量 **npm test 1956/1954/0**（1951 基线 + 5 零新增失败）；build:api/web 双 PASS。**真实目检**：问候弹泡自动触发（spark 脸+绿点）、8s 准时自匿、同日二次触发被额度正确抑制（`sprite.bubble==='2026-09-07'`）、庆祝弹泡完整呈现、面板成就区显示、额度消费与本地日期逐字一致；dev 栈已清理。报告：`docs/v10-3-companion-loop-final-report.md`。**V10 MVP 上线决策与部署（对齐 V9 runbook）、V10-4 Memory/V10-5 对话（均需单独批准）由所有者决策。**

> **2026-09-07 V10 MVP 已提交并推送（HEAD `6b17041`）；V10-4 Memory + V10-5 Real AI Companion 完成并仅本地提交（未推送）；生产部署由所有者人工执行**。①MVP 上生产：`1808737`（feat sprite 13 文件）+ `6b17041`（docs 10 文件）已推 origin/feature/v3-product-refactor；服务器 SSH 凭据本机不可用（publickey 拒绝），所有者选择人工登录执行——手册 `docs/v10-mvp-deployment-runbook.md`（显式 refspec fetch+reset → deploy.sh 自带备份门禁 → 五步冒烟含 sprite 路由 401 检查与真实账号 /api/sprite/state）。②V10-4+V10-5（均获批准）：`sprite-memory.ts` 纯模块（七类陈述确定性提取/12 条上限/精确去重 touch）+ RuntimeState 仓库（`sprite-memory:{userId}` 可丢弃）+ 服务（disabled 诚实降级）+ 三端点（GET/POST/DELETE /sprite/memory，严格 self-only）+ state 契约增量 memory.entries(≤3)；前端"星野记得"区（增/忘/手动输入）+"问星野"对话（supervisor 零新端点、routedTo 四分型诚实渲染、tutor deep-link #/ai、workflow 模式标注、失败显式、每次发送 best-effort 记忆回流）；LLM 提取/garnish/聊天历史拼接按设计后置。验证：定向 40/40（9 项 RED→GREEN）、全量 **npm test 1965/1963/0**、build:api/web PASS。**V10-4/5 提交未推送——推送时机=所有者审查后，推送即进下次部署**。报告：`docs/v10-4-5-memory-companion-final-report.md`。

> **2026-09-07 V10 MVP 生产部署完成并验证（服务器 HEAD `6b17041`）**：所有者人工 SSH 执行 fetch+reset（显式 refspec）→ `deploy/tencent-ip/deploy.sh`——部署前备份 `kaoyan408-20260907T141116Z.dump` 自动生成，构建 PASS，三容器健康，seed 幂等落库（1296 节点/5 套真题/16 桥接）。外部验证（Agent 从本机直测生产）：`/health` 200 overall ok；`/api/sprite/state` 未认证 **401**（路由注册+守卫生效，非 404）；`/api/coach/daily-brief` 401（V9 无回归）；前端 200 且生产 bundle `index-BSTtbzJ3.js` 含"AI 学习精灵"与 `sprite/state` 标记。备注：服务器冒烟命令曾出现 `000` 为双行粘贴粘连 + 3000 端口未映射宿主（正确入口为 nginx `/api` 前缀）；应用级冒烟（真实账号看 mood/台词）留待所有者随手验证。V10-4/5 仍在本地 `92301d3` 未推送。

> **2026-09-07 V10 Learning Engine Upgrade（LE 线）Mission 启动：Phase 0 Repository Audit 完成 + Roadmap 待所有者 Review**：使命 = 从「智能刷题工具」升级为「围绕 408 提分结果优化的 AI 自适应学习系统」。⚠️ 命名说明：V10 编号已被 AI Learning Sprite 占用，本线账本内以「LE 线」区分（编号是否改 V11 待所有者定夺，文件路径按指令 `docs/v10-learning-engine-roadmap.md`）。Phase 0 审计关键事实：①考频数据超预期齐备（KnowledgeFrequencySnapshot 含 recent3/5 频次+primaryScore5y+趋势，1149 条）；②推荐引擎契约已含频率输入与 HIGH_RECENT_FREQUENCY 理由码（F1=接线非新造）；③getExamReport 已有分科统计与主观题自评处理（F2=深化）；④ReviewAttempt.nextIntervalDays 已逐次落库（F3 影子对照数据在积累）；⑤综合题 selfScore 管线全通（F4=rubric 结构化升级）。五大 Feature：真题对标练习 / 模考诊断增强 / 遗忘防线+FSRS 影子 / 大题采分点 / 交错练习+自我解释——全部以 Selector/Projection 落地，SoT 零污染；**唯一提议 Schema 变更 = F4 的 Question.rubric（可空 JSON，单独批准门）**；F3 保温复习绝不写 ReviewSchedule（走推荐层）。排序：F1→F5（数据就绪度×分数杠杆÷风险；F3 影子记录建议在 F1 期间并行开启）。**零代码改动完成，等待 Roadmap Review 后进入 Feature 1。**

> **2026-09-07 LE-V10 Feature 1（真题对标练习模式）Phase 1 Implementation Plan 完成，待所有者 Review**：文档 `docs/feature1-real-exam-practice-plan.md`（13 章含 UX 流程/理由链设计/0 迁移 API 契约/三级测试/验收标准/M1-M5/面试价值）。Phase 0 补充审计关键事实：①**频率已真实接线进引擎**（recommendation.service.ts:400 buildEvidence 读快照喂 calculatePriority，HIGH_RECENT_FREQUENCY 在产）；②真实缺口=练习集路径只有集合级 reason（getRecommendedPracticeSet legacy）+ 前端无理由卡；③题→节点→频次→真题四连装载器已在 exam-links 端点生产验证（score-center/service.ts:263-298），F1=泛化为只读投影。设计要点：引擎零触碰、0 migration、mode=exam_aligned 增量字段 examAlignment（evidence 载荷可追溯源表）、predictedGain 公式强制"估算"标记（primaryScore5y×(1−mastery)×0.6）、无快照/LOW 置信诚实隐藏。待 Review 后进入 M1（数据读取层，TDD）。

> **2026-09-07 LE-V10 F1 Milestone 1（数据读取层）完成，待所有者 Review；M2 未启动**：TDD 全程（RED 31 失败确认 → GREEN 15/15）。新增 `exam-alignment.selector.ts`（纯投影：buildExamAlignment 题级对齐 + rankByExamAlignment 考频×缺口排序/近期降权；诚实分支钉死——无快照≠0次、无掌握≠0%、LOW 置信隐藏估算；同源阈值锁：源码级测试断言 selector 常量 === shared priority.ts 的 `recent3Y.frequency >= 4` 字面量）+ `exam-alignment.service.ts`（只读装载，**五个 loader 全部为 repository.ts 既有导出、零 export 改动零复制** + 一次有界 UserKnowledgeMastery 读；库不可用返回 null）+ study.module.ts 两行注册；**引擎/shared/Controller/前端/Schema 零触碰，API 零变更**。修复一个测试抓到的真实缺陷：摘要年份曾受"展示上限 3 条"截断丢年——改从索引全量命中聚合。验证：定向 15/15、全量 **npm test 1980/1978/0**（1965 基线 + 15 项零新增失败）、build:api PASS。报告：`docs/feature1-milestone1-completion-report.md`。M2 预告：getRecommendedPracticeSet mode 接线 + examAlignment 响应段（M1 输出形状已对齐 Plan §9，零重塑）+ 近 7 日练习有界读。

> **2026-09-07 LE-V10 F1 Milestone 2（Recommendation Explanation + 接线）完成，待所有者 Review；M3 前端未启动**：`GET /practice-sets/recommended` 增第三参 `mode=exam_aligned`——普通模式响应**逐字段一致**（纯函数 withExamAlignmentSection 对非 exam_aligned 返回原对象连键不加）；exam_aligned 附加 examAlignment 段（M1 投影 + rankByExamAlignment 排序/近期降权）；legacy/无库显式 `examAlignment: null`。改动：selector +withExamAlignmentSection、service +attachToPracticeSet（仅 exam_aligned 做 IO）、study.service 三分支收口 + recentPracticeRefs（内存 records 近 7 日有界过滤）+ 构造器末位 @Optional 注入、controller +mode Query、shared 引擎零触碰（源码断言）。修复 1 个真实类型错误：内存 PracticeRecord 时间字段为 submittedAt 非 createdAt（ts-node 直载 parity 测试连带暴露，已恢复 4/4）。验证：定向 20/20（+5 RED→GREEN）、全量 **npm test 1985/1983/0**（1980 基线 + 5 零新增失败）、build:api PASS。报告：`docs/feature1-milestone2-completion-report.md`。M3 预告：前端 exam-aligned/ 四文件 + PracticePanel 侧栏挂载（Plan §7 批准方案）+ DESIGN.md 增量 + dev 栈四主题目检。

> **2026-09-07 LE 线新增最高约束：唯一评价标准 = 帮学生获得更多 408 分数，四问门禁（学习效率/知识保持/大题得分/模考恢复效率）生效**——每个 Feature/技术决策必须正面回答至少一问并写进 Acceptance Criteria，否则默认不做。已形式化进 `docs/v10-learning-engine-roadmap.md` §0（四问×五 Feature 映射审计：F1=Q1 核心、F2=Q4 核心、F3=Q2 核心、F4=Q3 核心、F5=Q1/Q2 双核）。**新标准暴露一个增量点已并入 F2：恢复计划执行追踪**——恢复任务即 StudyTask、执行事实即 StudyTaskCompletion（零迁移），诊断视图须输出缺口闭环率（"上次暴露 5 个缺口已修复 3 个"），把 Q4 从"生成计划"深化为"闭环度量"。当前 LE 进度不变：F1 M1/M2 完成待 M3 Review，M3（前端展示）为 F1 收官步。

> **2026-09-07 LE-V10 F1 M3+M4 完成（前端展示，本地提交 `a1178ad`）+ Phase 4 User Impact Report 产出；M5 集成验证待执行**：M3——PracticePanel「真题强化」开关（aria-pressed，普通模式字节级原样）+ 集卡徽标（覆盖 N 个真题知识点）+ 前 3 题逐题理由行（星级/近5年频次/掌握度，vm 纯函数生成）+ 可展开逐题理由卡（估算强制"估算"标记、LOW 置信自动隐藏、关联真题年份题号）；M4——训练后 ExamCoverageSummary（覆盖知识点/年份跨度/高频繁点数）。数据流：mode 经 App→StudentSections→PracticePanel→hook→endpoint 全链透传；types 增 PracticeSetExamAlignment；组件纯 token（零 hex）+ DESIGN.md 增条目。验证：定向 26/26（+6 RED→GREEN）、全量 **npm test 1991/1989/0**（1985 基线 + 6 零新增失败）、build:web/api PASS。**F1 Phase 4 User Impact Report**：`docs/feature1-user-impact-report.md`（Before/After、六指标映射、Acceptance 除 M5 外全勾）。待办：M5 集成脚本 + dev 栈四主题目检 → F1 关闭；随后 F2 模考诊断（含缺口闭环率）。

> **2026-09-07 LE-V10 F1（真题对标练习模式）M5 完成并正式关闭**：`scripts/integration-exam-aligned.mjs` + npm script `test:integration:exam-aligned`——对真实种子测试库断言全链（快照采样→无掌握=null≠0%→LOW 置信估算隐藏（真实 LOW 节点实证）→mastery 公式精确匹配→examHits 年份降序≤3→夹具全清理），**PASS**。Phase 4 User Impact Report：`docs/product-evolution-report-feature1.md` + `docs/feature1-user-impact-report.md`。F1 全部里程碑关闭（M1-M5，本地提交 cd0f953/a1178ad/M5-commit）。**下一 Feature：F2 全真模考诊断增强**（Phase 0 审计事实已具备，含缺口闭环率）。

> **2026-09-08 LE-V10 F2（全真模考诊断增强）后端完成，待所有者 Review；诊断前端视图为下一 Milestone**：新端点 `GET /exam/diagnosis/:sessionId`（只读 self-only，ownership 经既有 getExamReport）——`score150Estimate`（客观正确率×408 标准结构 80 分折算 + 主观真实自评，自评超上限截断，basis 三重声明，confidence=medium）、`perSubject` 客观口径估算行（scopeNote 明示）、`nodeLoss`（失分题经节点解析归因，lostCount×考频排序 Top5 + ★ 星级）、`gapDecomposition`（有 targetScore 才算，否则 null 不伪造）、**`recoveryClosure` 缺口闭环率**（确定性任务 id 反查 StudyTask/StudyTaskCompletion；计划未生成 → null + 显式 reason）；getExamReport 响应纯增量附加 `lostQuestionIds`；新增 `exam-diagnosis.ts`（纯投影，零依赖）+ `exam-diagnosis.service.ts`（只读装配，注入 StudyService 单向）；shared/引擎/写路径零触碰。验证：定向 10/10（RED→GREEN）、全量 **npm test 2001/1999/0**（1991 基线 + 10 零新增失败）、build:api PASS（修复 readonly 索引赋值与类型缺导入）。报告：`docs/product-evolution-report-feature2.md` + `docs/feature2-exam-diagnosis-plan.md`。队列：F2 前端诊断视图 → F3 影子评估器 → F4（content-blocked）。

> **2026-09-08 LE-V10 F2 前端诊断视图完成（本地提交，未推送）——F2 后端+前端全部落地**：`features/report/ExamDiagnosisPanel.tsx`（自取数面板，EffectivenessPanel 先例）挂载于考试报告 OverlayDialog 内 ExamReportView 之后；渲染 150 估算分（"估算"徽标 + 客观估算/主观自评分解 + basis + 置信度）、分科客观口径行、失分知识点（丢题数×星级考频）、目标差距（估算标注）、**恢复计划闭环率**（未生成 → 显式提示并指向既有"生成考后复习任务"入口）；静态演示隐藏、加载失败显式文案、unmount 取消。types 增 ExamDiagnosis 全套视图接口；exam.ts 增 fetchExamDiagnosis（throw 语义）。验证：定向 6/6、全量 **npm test 2007/2005/0**（1991 基线 + 16 零新增失败）、build:web PASS。报告：`docs/product-evolution-report-feature2.md`。队列：F3 影子评估器 → F4（content-blocked）。

> **2026-09-08 LE-V10 F3 M1（影子评估器基线）完成，待所有者 Review；FSRS 预测器下一循环**：`packages/shared/src/score-center/review-shadow.ts`（纯，零依赖）——从既有事实测当前复习调度器的保持率：`ReviewAttempt.nextIntervalDays`（旧算法排程）+ 同源题后续 `PracticeRecord`（观察窗 17 天）→ post_1d 即时正确率、retention_7d/14d（窗口内首次后续练习定结果）、按旧算法排程间隔分桶的观测保持率；诚实规则：无后续 = 无证据（绝不计为遗忘）、样本 < 30 = insufficient_data（预注册门槛，禁止无证据下迁移结论）。`GET /coach/review-shadow`（teacher/admin，ReviewShadowService 只读有界装载：ReviewAttempt≤500 + PracticeRecord≤2000）。验证：定向 8/8（RED→GREEN，期间修复 study.module 漏 import 连带的 4 个上传测试失败与测试断言错位）、全量 **npm test 2015/2013/0**（2007 基线 + 8 零新增失败）、build:shared/api PASS。提交 `ad718e8`（本地）。下一循环：FSRS 预测器（shared 纯函数，与 ts-fsrs 对照）接入同一结果形状完成双算法对比。

> **2026-09-08 外部接管审计回应（P0-2 文档失真已修 + B4 证实入册 + 交付就绪）**：所有者转来第三方审计。核实结论：①**证实**——本地领先 origin 7 提交（LE F1/F2/F3-M1 全部完成未交付）；`recommendation.service.ts:134` `if (!snapshot) continue`（B4：147 无快照节点静默排除，无观测端点）；StudyModule 零 exports → Agent/Effectiveness 模块双注册共享 provider；"标记已复习不产生掌握度证据"（applyReview 仅 isReview===true）；任务完成无能力证据（completeStudyTask 只写 StudyTaskCompletion）。②**纠正**——"验证门禁不可执行"是审计沙箱特有（spawn EPERM）：主开发环境本会话实测 `npm test` 2015/2013/0 全绿、build 三端 PASS；替代门禁已登记地雷区。③**已修（本轮）**——current-sprint §1 校正为当前事实（旧 §1-9 标注历史归档）；CLAUDE.md 三处失真（mock 模式条件/19→46 model/8 文件 46 测试→338 文件 ~2015 测试）；地雷区新增沙箱替代门禁；补提交 `docs/optimization-reference-check.md`。④**入册待办**（并入 LE 队列）：B4 观测端点（GET /admin/data-quality，M3 审计项）；M2 任务→能力证据链（方向待所有者定：只读派生投影 vs 扩展 applyReview——后者触写路径需批准）；模块双注册收敛（P2）。⑤**推送/部署**：8 个本地提交（+本轮 docs）就绪，按 AGENTS.md §9 等待所有者明确指令后 push；部署手册沿用 `docs/v10-mvp-deployment-runbook.md` 流程。

> **2026-09-08 V11 Mission 冻结（roadmap：`docs/v11-roadmap.md`）+ V11-M1 Data Quality Observability 完成 + P0 交付同步执行**：所有者确认 V11 编号（取代 LE 线 V10 暂用名，LE 路线图归档保留）并下达 P0 交付同步指令。**P0 完成**：本地全部提交（F1 完整/F2 全量/F3 M1/V11-M1/审计回应文档）已推送 origin（`f50fa08..2a6cade`，领先归零）；生产部署待所有者人工执行（runbook 沿用 `docs/v10-mvp-deployment-runbook.md`，部署后即带上 F1 真题对标/F2 诊断/F3 基线 + V11-M1）。**V11-M1 完成**：`GET /admin/data-quality`（admin 只读）+ 纯组装器——把审计证实的三处静默缺口变成可见清单与健康旗标：B13 无节点标签题（覆盖率%）、知识点缺 PRIMARY 映射、B4 无考频快照节点（147 个，按科目分布+样本）、B6 关系边稀疏（先修/关联计数）；零迁移零写入。验证：定向 5/5（RED→GREEN）、全量 **npm test 2020/2018/0**（2015 基线 + 5 零新增失败）、build:api PASS。**审计五决策点落定**：①推送=已执行（指令授权）；②沙箱替代门禁登记地雷区（AGENTS.md 不动宪法）；③M2 证据链=只读派生投影方向（所有者 P1 条目确认）；④Question.rubric=维持单独批准门（V11-M5）；⑤编号=V11 定案。**下一循环队列**：V11-M2 Learning Evidence Projection（任务→能力证据只读投影）→ V11-M3 推荐候选诚实化（无快照节点显式标记）→ V11-M4 FSRS 预测器+遗忘防线 → V11-M5 大题（等批准+内容）。

> **2026-09-08 V11-M1 生产部署完成并外部验证 PASS（服务器 HEAD `32ab233`）**：`/health` 200 overall ok；新路由未认证守卫全过——`/api/admin/data-quality` 401、`/api/exam/diagnosis/:id` 401、`/api/coach/review-shadow` 401（全部注册+守卫，非 404）；`/api/practice-sets/recommended?mode=exam_aligned` 401；前端 200 且新 bundle（`index-yCled2yf.js` + 懒加载 `PracticePanel-BAR5HZMB.js`）含 F1 真题强化开关/尚未练习 vm、F2 诊断书/exam/diagnosis、精灵标记——**F1 真题对标、F2 模考诊断、F3 影子基线、V11 数据质量观测全部到达生产**。验证方法备注：F1 组件经 Vite 懒加载在独立 chunk，主 bundle grep 不含属正常，须按 chunk 名抓取验证。LE/V11 队列下一项：V11-M2 Learning Evidence Projection（任务→能力证据只读投影）。

> **2026-09-08 生产实测走查完成（测试账号 jackchou，全功能 PASS）**：浏览器自动化全流程——①精灵真实数据 concern 态（担忧表情+警示点）+ 主动弹泡"连续同型错误（错误占比 100%）"（真实 V4 干预）；②面板全功能：依据展开（风险提醒 severity=high）、去练习、星野记得（手写"我喜欢计组"→持久化→渲染+忘记）、问星野**真实 LLM 对话**（DeepSeek v4-flash 402 已解除！mode=llm 19s，基于 jackchou 真实错题/掌握度输出三大方向复习策略，全部溯源到节点 id）、免打扰；③F1 真题强化开关生产验证（徽标"覆盖 1 个真题知识点"+理由行"★★★★ 偶考·近5年 2 次·掌握度 91%"）；④F2 诊断书 API 真实历史模考验证（8/15 会话 5 题全错 → 诚实 0 分 + nodeLoss 真实归因 Cache基本原理/线性表定义 + recoveryClosure 0/3 真实闭环率）。**发现并修复 1 个视觉缺陷**：F1 理由行多画一颗星（已修，随下次部署上线）。走查报告：`docs/le-production-walkthrough-report.md`。

> **2026-09-08 V11-M2 Learning Evidence Projection 完成（本地提交 `31d2a3f`，未推送）——审计 P1-1 断点关闭**：`packages/shared/src/score-center/task-evidence.ts`（纯）+ `task-evidence.service.ts`（只读装配）+ `GET /coach/task-evidence`（self-only）——对最近 ≤5 个完成任务输出能力证据：任务知识点上完成前后 ±3 天的练习事实（次数/正确率）+ 完成时快照 vs 当前掌握度 Δ；判定 improved/practiced/practiced_no_gain/insufficient_data，**完成标记单独永不构成证据**（宪法诚实条款的投影化）。路由进 DailyBriefController（coach 家族）。验证：定向 8/8（RED→GREEN）、全量 **npm test 2028/2026/0**（2020 基线 + 8 零新增失败）、build:shared/api PASS（中途 tsc 抓到 Date→ISO 与 Edit 错位两处，均修复）。下一循环：M2 前端消费（今日任务/报告页证据卡）→ V11-M3 推荐候选诚实化 → V11-M4 FSRS 预测器。

> **2026-09-09 V11-M3 推荐候选诚实化落地并推送（`914aba0`，origin 同步归零）**：`recommendation.service.ts` 候选宇宙不再静默排除无考频快照节点（B4）——缺快照节点按契约 §3 退化规则携带中性证据（频次 0、LOW 置信、真实科目/重要度/难度）进入候选，由引擎按薄弱度排序；排序公式零改动；缺口观测走 `/admin/data-quality`。教训入册：**候选宇宙扩张曾两度被 daily-plan-parity 测试正确拦下**（legacy 转录不含无快照节点）——最终语义 = parity 夹具补齐 node-os 快照（parity 保证覆盖"全快照宇宙"），无快照宇宙行为由 recommendation-honesty 引擎级测试覆盖。验证：honesty 3/3、parity 3/3、全量 2041/2039/0、build:api PASS。

> **2026-09-09 V11-M4 Learning Impact Measurement Layer 完成（M4.1/M4.2/M4.3，本地提交未推送）——完成后暂停，不进 F4**：M4.1 补 FSRS reviewPriority 出口（urgency=1−R + 建议间隔，fsrs-scheduler 同步修复重复 nextStability 定义并移除无测试 stepFsrs）；M4.2 mastery-calibration 纯模块（EMA 存储掌握度 vs 真实做题正确率的校准影子：±15pt 方向阈值 raise/lower/hold、样本量置信 high/medium/low，无练习=hold 不伪造）+ 只读服务 + GET /coach/mastery-calibration（最常练 20 节点，30 天窗口）；M4.3 outcome-tracking 纯模块（推荐干预前后 14 天对照：正确率/掌握度快照/错误练习减少，样本 <3 次=insufficient_data）+ GET /coach/outcome-tracking。全部 Selector/Projection 只读派生，零迁移零 SoT 触碰；FSRS 权重显式标注 UNTRAINED（golden 对照 ts-fsrs 待 devDependency 决策）。验证：定向 15/15（RED→GREEN）、全量 **npm test 2049/2047/0**（2041 基线 + 8 零新增失败）、build:shared/api PASS。报告：`docs/product-evolution-report-v11-m4.md`。

> **2026-09-10 V12-0 Score Improvement Intelligence Audit 完成（只读审计，报告已推 `e2aee45`）→ STOP 等 V12 路线确认**：所有者下达 V12-0 审计使命（先审计后路线，不预设功能）。Phase A-F 全部完成：行为→证据→掌握度→诊断→测评→分数六层能力地图（CAN PROVE/PARTIAL/CANNOT PROVE 逐层判定）、干预证据链八环审计（2 层 CONFIRMED / 3 层 PARTIAL / 3 层 MISSING，EB-1..EB-5 断点清单带 file:line）、14 特征价值矩阵（发现 AIInsightCard 装饰性智能、ReviewAttempt 数据闲置、EB-1/EB-2/EB-4 三处断环）、Top5 瓶颈（P0 证据断链/双算法/分数验证闭环缺失）。V12 宪法与路线提案已入报告待所有者确认——确认前零实施。报告：`docs/v12-0-score-improvement-audit.md`。另：生产部署（34c4c86）仍待所有者人工执行（server steps 见 `docs/v11-final-release-server-steps.md`）。

> **2026-09-10 V12 FINAL AUDIT + V12 FINAL RELEASE REPORT 完成（V12 CODE COMPLETE）**：`docs/v12-final-release-report.md`（20 节：执行摘要/最终架构/提分闭环/证据链/干预链/机会模型/分数校准/大题训练/AI 边界/数据模型/API 面/前端集成/测试矩阵/E2E 矩阵/生产状态/已知局限/剩余风险/技术栈/技术亮点/最终提交）。**最终判定**：M1/M2a/M2b/M4/M5 与 F4 无 Schema 部分 **COMPLETE**；M3 Phase C（复习证据回流掌握度）与 F4 Schema **待所有者批准**；生产部署 **DEFERRED（无 SSH 凭据，未伪造）**。**独立复核证据**：`git diff 8abff36..HEAD -- prisma/` 为空（**V12 零 Schema 变更**）、迁移仍 34 个、与 V12 前版本零删除行、V12 全部 50 个改动文件严格 UTF-8 扫描 0 非法。**FINAL AUDIT 八类问题排查**：抓到并修复 **1 个自伤缺陷**——我用未指定编码的 `Set-Content` 往返 `daily-brief.controller.ts`，损坏 19 处 em-dash（`E2 80 94`→`E2 80 3F`）、吞掉 18 个空格、合并 1 处换行；**构建与全量测试全程绿色**，正因如此更值得记录；已按字节精确修复（修复脚本在结果非法时拒绝写入），修复后零删除行，并新增严格 UTF-8 全量扫描。其余七类如实列入报告附表（既有死代码/装饰性智能仍在册未清理，未获授权；EB-5 仅审计+影子，未冒充闭合；集成测试与生产 E2E **明确标注未执行**）。**技术栈诚实排除**：任务清单列出但本项目**未使用** Next.js（实际 Vite）与 Redis（无依赖、无客户端，唯一命中是注释里的 "Redistribute"）。最终数字：**8 提交 / 50 文件 / +7151−9 行 / 6 纯模块 / 5 只读端点 / 150 新测试（2049→2199）**；门禁 `npm test` 2199/2197/0/2 exit 0、`build:api`/`build:web` exit 0。报告：`docs/v12-final-release-report.md`。

> **2026-09-10 V12-M6 / F4 大题采分点：设计 + 无 Schema 影子实现完成（`Question.rubric` 仍属批准门，未触碰 Prisma）**：408 满分 150 中约 **70 分是主观大题**，而审计确认 `Question.rubric` 不存在、无采分点拆分、无步骤证据。按任务 §12.1「没有批准权限：不要修改 Schema，但可以完成 pure module / shadow evaluator / offline rubric / tests」，本轮交付：①**提议 Schema**（`Question.rubric Json?`，纯增量可空，`ADD/DROP COLUMN` 可回滚，无回填，旧服务忽略未知列）；②**Rubric JSON 形状**（`schemaVersion`/`totalPoints`/`points[{id,label,points,matchAny,required,knowledgeNodeIds}]`，**版本必填且校验**，不匹配即拒绝打分以保证历史内容可审计）；③**离线影子评分器**（`scoreLargeQuestion`，确定性、逐点返回 `basis`、输出 `hitNodeIds`/`missedNodeIds` 供未来接入证据层）；④**两种"不给分"严格区分**——无 rubric → `score=null`/`no_rubric`（**缺失不是 0 分**）、rubric 非法 → `score=null`/`invalid_rubric`（拒绝近似）、合法 rubric + 空答案 → 真实 `0` 分；⑤**AI 边界（任务 §12.2）**：本评分器**完全不含任何模型调用**（测试断言源码无 `fetch(`/`openai`/`deepseek`/`axios`/`http`），逐条 `authoritative:false` + `limitations` 明写"关键词匹配**不是语义判定**、最终分数须人工复核"，即 LLM 若引入只能作为**与离线基线对照的候选评分器**。新增测试 1 文件 14 项全绿。门禁全绿：**`npm test` 2199/2197/0/2 exit 0、`build:api` exit 0、`build:web` exit 0**。**刻意未做**：Prisma 字段、内容批次、端点、前端、LLM 评分。获批后路径（F4-1…F4-6）见设计文档 §7。报告：`docs/v12-m6-f4-large-question-design.md`。

> **2026-09-10 V12-M5 Real Score Calibration 完成（EB-4 闭合；零迁移；预测/证据/实测严格分离）**：勘察关键发现决定本轮可行性——`AssessmentHistoryItem` 已有 `score`/`totalScore`/`accuracyRate`（**真实记录分数已存在**，故零迁移即可校准）；而 `ExamScoreHistoryExamFact` 只有 `totalQuestions`/`correctCount`，**不是分数**，不能当作实际成绩；`estimatePredictedScore`（shared）已有生产预测实现（`minScore/maxScore/bestEstimate` + `disclaimer:'仅为估算'` + basis）可直接复用。**三概念严格分离（任务 §11.1 硬约束）**：prediction（区间 + 逐字输出 `PREDICTION_IS_NOT_ACTUAL` 免责）、evidence（`sampleSize` + `basis`）、actual（记录分）**永不合并**；`error = actual − predicted` 明确是"差"而非任一方替代；`improvement` 中 `predictedDelta` 与 `actualDelta` 为**两条独立序列**，文案写明"掌握度上升不等同于分数上升"。**四条诚实规则（测试钉死）**：①`CALIBRATION_MIN_SAMPLE=5`，低于下限时 MAE/bias 均 `null` 且 `confidence='insufficient_data'`；②无成对记录时明示"没有误差 ≠ 没有数据"；③无法重建预测的测评进 `exclusions[]` 而**不按零误差计入**；④首次测评基准分由评估前正确率折算，并在 `evidence.basis` **明写"估算"**。**时序隔离测试**：构造"测评前 2 次全对 + 测评后 2 次全错"，断言 basis 为"评估前 2 次（正确率 100%）"——若泄漏会读成"4 次 / 50%"。**数学性质测试**：断言 `MAE ≥ |bias|`（单边取等号、双向严格大于），而非假设相等（初版测试断言 MAE==|bias| 在 3 负 2 正下数学上本就错误，已修正为真实性质）。新增 `GET /coach/score-calibration`（teacher/admin）。新增测试 2 文件 20 项全绿。门禁全绿：**`npm test` 2185/2183/0/2 exit 0、`build:api` exit 0、`build:web` exit 0**。**诚实局限**：系统内**不存在"真实考研分数"表或录入通道**，"实际成绩"当前是模考/测评记录分（真实测量，但**不是**考研最终分数）；要闭合到真实考研分需新增录入通道（Schema 变更需批准）。另：重建预测时"当时的剩余天数"无历史留痕，已用回退值且未伪装为精确值。报告：`docs/v12-m5-score-calibration.md`。

> **2026-09-10 V12-M4 Score Opportunity Shadow 完成（零迁移；只读；反黑箱）**：回答"时间有限时哪个薄弱点最值得训练"。任务 §10.1 明确"公式不是事实，必须验证每个变量是否有真实数据支撑"，§10.2 禁止黑箱分。**本轮核心工作是对六个因子逐一做真实数据核查**：`weakness`←`UserKnowledgeMastery.mastery`（实测/high）、`examImportance`←`KnowledgeFrequencySnapshot.primaryScore5y` 在候选集内归一化（实测/high，**不另造第二套考频公式**，完整加权混合仍归推荐引擎且引擎保持权威排序）、`recoverability`←代理（`correctCount>0` + `KnowledgeRelation` 前置就绪度，**系统无直接测量故最高置信仅 low**）、`evidenceConfidence`←快照字段（实测/high）、`urgency`←`User.examDate` + `retention`（实测/high）、`trainingCost`←`estimateMinutes(action, difficulty)` 生产估算器（**估算非实测，最高 medium**）。**权重为公开常量**（归一化=1），任何评审者可手算复现——反黑箱的具体兑现。**三条诚实规则（测试钉死）**：①必需因子（weakness/examImportance/trainingCost）缺失 → `score=null` + `blockedBy` 点名 + 中文说明"拒绝用替代值估算"；②可选因子缺失 → 进 `exclusions[]` 并**重新归一化权重** + 置信度下调（≥2 项排除→low）；③不可测即不可测——考频 0 分→`examImportance=null`（不当作"重要性 0"）、无掌握度行→`weakness=null`（不假设 0.5）、无前置边→`prerequisiteReadiness=null`（不读作"已就绪"）。**TDD 抓出一个建模缺陷（诚实记录）**：初版 recoverability 对"从未做对过但前置就绪"给出 0.55（中高），测试断言 `<0.5` 失败——判定为**建模缺陷而非测试缺陷**（会推荐一个没有任何切入点的知识点），修复为 `everSucceeded===false` 时封顶 0.45 并在 basis 说明。新增 `GET /coach/score-opportunity`（teacher/admin，模型质量仪器非学生界面）+ 每行输出 `factors[]`（value/weight/confidence/source/basis）+ `exclusions[]` + `reason` + `expectedBenefit`（**区间**且 `expectedBenefitIsEstimate:true`）+ `risk`。新增测试 2 文件 23 项全绿。门禁全绿：**`npm test` 2165/2163/0/2 exit 0、`build:api` exit 0、`build:web` exit 0**。刻意未做：机会分不得影响生产排序（影子未验证前）。报告：`docs/v12-m4-score-opportunity-shadow.md`。

> **2026-09-10 V12-M3 Review Semantics 审计 + 影子完成（EB-2/EB-5；零迁移；Phase C 待批准）**：Phase A 只读审计产出**三套"复习/记忆"表示法并存**的实证——A `ReviewSchedule`（`stability` 是**字符串状态机** learning/review/mastered，题目级）、B `UserKnowledgeMastery`（`stabilityDays` 是**数值天数**，节点级）、C FSRS 纯函数（`(S,D)`，无存储、未接线），三者单位与粒度互不兼容。**比审计原文更尖锐的发现**：`applyReview`（`score-center/service.ts:156-171`）**根本不改 `mastery`**——它 spread `...current` 原样保留，只写 `retention`/`stabilityDays`/`lastReviewedAt`/`nextReviewAt`；且 `retention` **硬编码为 1**（无条件宣称刚复习完保持率完美，与 `mastery.ts:48-56` 的 `estimateRetention` 指数衰减不同口径）。同时确认 `applyAttempts`（`:118-129`）**只**更新 EMA 状态、不碰 stability/retention/nextReviewAt → **两条路径更新不相交字段集**。结论：**`isReview` 不是"是否回流掌握度"的开关，而是"是否更新排程字段"的开关**；已观测复习结果（M1 分类为**强证据**）对能力估计**零贡献**。产出 `REVIEW_SEMANTICS_MATRIX`（7 动作 × Activity/Evidence/Mastery/Schedule + file:line，**以代码形式**随端点下发，杜绝两套口径各自表述）。Phase B 影子（**只读、零写语义变更、零 Schema**）：`replayUnifiedReviewMastery`（以 `UserMasterySnapshot` 为基线、用**生产同一** `updateMasteryAfterAttempt` 重放复习观测，与存储掌握度对比）+ `reviewRetentionShadow`（用生产同一 `estimateRetention` 对比存储常量 1）+ `GET /coach/review-semantics-shadow`（teacher/admin，走 resolveUserId 授权）；诚实设计：无观测→`null`/`insufficient_data` 不报 0、无存储值→不与缺失值作差、**快照缺 accuracy/recentAccuracy/confidence 的事实写进 basis 不冒充完整基线**、`verdict='unknown'` 不计入分歧统计。新增测试 2 文件 21 项全绿。**过程中 `npm test` 出现 2 个失败，定位为 TEST BUG 而非产品回归**：M1/M2a 的边界测试用"切片到下一个文档注释"界定控制器方法体，插入新端点后被误纳 → 改为按**下一个路由**界定切片，并新增**正向对照断言**（切片须非空且覆盖方法签名）防止空切片空洞通过。修复后正式门禁全绿：**`npm test` 2142/2140/0/2 exit 0、`build:api` exit 0、`build:web` exit 0**。Phase C（切换 `applyReview` 语义）**未实施**——纯语义变更、零迁移、单函数可回滚、预注册阈值（方向一致率 ≥70% 且样本 ≥30）、风险是掌握度被复习拉高将改变推荐排序，**需所有者批准**。报告：`docs/v12-m3-review-semantics-audit.md` + `docs/v12-m3-review-shadow.md`。

> **2026-09-10 V12-M2b Learning Evidence Ledger 完成（M1 证据层前端兑现；零迁移；门禁全绿）**：M1 让系统开始**记录**证据，但学生看不到——即审计原话"零记录、零归因、**零反馈**"的最后一项。本轮新增 `LearningEvidenceLedger`（报告总览 tab，紧随 V11-M2 的 `TaskEvidencePanel`）+ `fetchLearningEvidence` + api/types 三类契约 + 纯 token CSS（词汇与同目录 `task-evidence.css` 一致）。**三类证据在 UI 上强制可区分**：`strong`→「观测证据」（--primary-faint/--primary-strong）、`weak`→「自评证据」（--amber-soft/--amber-strong，明示"不作为能力依据"）、`none`→「仅活动」（--text-muted）。**四条诚实规则（测试钉死）**：①"只有被系统观测到的作答才能支撑能力判断"对学生可见；②`hasAbilityEvidence=false` 时渲染"系统**拒绝**据此判断能力变化"，而非画 0 或画提升；③活动行永不渲染能力数字——`factLine` 依 `canInfluenceMastery` 追加"（不作为能力依据）"，无观测直接输出"未观测到任何表现数据。"；④`store_unavailable`/`summary=null` 明示"数据存储未就绪，因此不显示任何能力判断"，记录为空明示"还没有任何学习证据记录"。静态演示模式 `return null`（无真实学生不渲染伪证据）。新增测试 1 文件 9 项全绿。**门禁：`npm test` 2121/2119/0/2 exit 0、`npm run build:web` exit 0、`tsc --noEmit` exit 0**。**过程诚实记录**：首版 CSS 误用不存在的 token（`--border`/`--surface-muted`/`--surface-strong`/`--radius-md`/`--radius-pill`/`--success*`/`--warning*`/`--text-primary`/`--danger`），提交前逐个核对已全部替换为真实 token（真实集合含 `--line-faint`/`--surface-soft`/`--surface-soft-2`/`--text-strong`/`--primary-faint`/`--primary-strong`/`--amber*`/`--red*`/`--green*`）。报告：`docs/v12-m2b-learning-evidence-ledger.md`。

> **2026-09-10 V12-M2a Recommendation Exposure 完成（EB-3 闭合；零迁移；只读漏斗）**：审计断点 EB-3 的本质是干预证据链第 2 环 "Student Saw" 整体缺失——更尖锐的实证是 `recommendation.created/accepted/completed/failed` 四个类型在 `RESERVED_CANONICAL_EVENT_TYPES` 里**只有声明、全仓零处发射**。本轮建立最小可靠曝光遥测：新增纯模块 `packages/shared/src/score-center/recommendation-exposure.ts`（`buildRecommendationFunnel`）、只读服务 `recommendation-exposure.service.ts`、`GET /coach/recommendation-funnel`（self-only，不接受 userId 覆盖）、`RecommendationActionRepository.listRecentByUser`；客户端新增 `apps/web/src/features/recommendation/recommendationExposure.ts`（静态演示模式跳过 + 按 `日:阶段:面:id` 去重 + 无身份丢弃），接线两个真实推荐面：`TodayMission`（今日任务即引擎推荐，渲染后上报 `exposed`）、`TodaysScoreCenter`（渲染后上报 `exposed`，**仅打开"为什么推荐"才上报 `viewed`**）。`recommendation.exposed/viewed` 进 **telemetry** allowlist（客户端观测），既有 `recommendation.*` 四个类型保持**服务器专属**。**核心诚实语义（本轮最重要）**：曝光有两种伪造方式，代码同时拒绝——①窗口内完全没有曝光观测时返回 `exposureTelemetryAvailable=false` 且 `exposed=null`，**绝不把"没有遥测"报成"曝光 0"**；②`exposed/viewed` 只能由带身份的客户端观测置真，无身份上报被丢弃而非归属。**仪器一旦工作，缺席即有意义**：存在任意观测时，某条无观测即 `false`（未看到）而非 `null`（不可知）——`null` 与 `false` 语义严格分开。新增测试 3 文件 28 项全绿（11 纯 + 7 服务 + 10 接线/边界）。**重大环境改善**：本会话权限放开后 spawn 可用，**AGENTS.md §7 正式门禁首次在本会话全部可执行并通过——`npm test` 2112/2110/0/2 exit 0、`npm run build:api` exit 0、`npm run build:web` exit 0**（此前沙箱 spawn EPERM 导致的 3 个假失败随之消失，全量首次零失败）。未做（诚实边界）：服务端推荐生命周期事件（分母直接读 `RecommendationAction` 已够用）、`review_queue`/`exam_aligned` 面接线（已留 surface 常量未接线，避免为凑覆盖面接未验证的面）、前端漏斗可视化、前端上报器的运行时网络行为未被自动化覆盖（依赖 `import.meta.env`，故采用源码行为断言，与既有 `frontend-events.test.js` 同约定）。报告：`docs/v12-m2a-recommendation-exposure.md`。

> **2026-09-10 V12-M1 Evidence Foundation 完成（EB-1/EB-2 闭合；零迁移；本地提交待推送）**：所有者确认 V12 路线并授予自主长程模式。本轮确立并代码化了**活动 / 证据 / 能力**三层语义（此前三者混同正是 EB-1/EB-2 的根因）：Activity = 动作发生（`task.complete`/`wrong.review` 遥测）；Evidence = 系统**观测**到的可解释表现（新增服务器专属事件 `EVIDENCE_RECORDED`）；Ability = 掌握度（唯一写方 `ScoreCenterService` 未动）。新增 `packages/shared/src/score-center/learning-evidence.ts`（纯分类学：`LEARNING_ACTION_TAXONOMY`/`classifyLearningAction`/`buildLearningEvidence`/`learningEvidenceKey`/`summarizeLearningEvidence`，**只有强观测证据 `canInfluenceMastery=true`**）、`apps/api/src/study/learning-evidence.service.ts`（写路径 + 查询）、`GET /coach/learning-evidence`（self-only，不接受 userId 覆盖）、`UserEventRepository.listByType`。**EB-1 三处接线**：已排程任务完成、**score-center 分支（推荐引擎生成的任务，此前直接 return 完全无证据）**、复习重做；`recordTaskCompletionEvidence` 返回两部分——学生自评（弱）/ 系统在该任务范围 ±3 天**实际观测到的已判分练习**（强），无观测则 `observed=null`（缺失即结论，不填零）。**EB-2**：`review.marked` 记为纯活动证据（显式声明不含回忆观测），`review.recalled`（`redoCorrect` 已观测）记为强证据；复习证据在**事务提交后**写入（源码顺序断言钉死）。**防伪**：`EVIDENCE_RECORDED` 进 `RESERVED_CANONICAL_EVENT_TYPES` 而**不进** `TELEMETRY_EVENT_TYPES`（客户端不可伪造证据，测试断言）。**边界测试**：证据层源码零掌握度写原语（`userKnowledgeMastery`/`applyAttempts(`/`applyReview(`/`saveMastery`/`userMasterySnapshot` 全部断言不存在）。**合成数据防护**：`study.service.ts:3424` 的 `correctCount ?? Math.round(questionCount*0.75)` 伪造默认值被测试锁死**不得进入证据**（该既有合成值经 `taskCompletionMetricsByUser` 流入 `computeMasteryReport:866-870`，本轮**未改动**以免动计划调整行为，已登记为遗留风险）。新增测试 3 文件 35 项全绿（17 纯模块 + 10 服务 + 8 边界）；**全量回归 347 文件 2084/2079/3/2**（基线 2049/2047/0 + 35 项零新增失败；3 败 == 沙箱 spawn EPERM 既有项 admin-user-email-ui/deployment-config/question-import-cleanup）。**零 Schema 迁移**（复用 `UserEvent`+`(userId,eventKey)` 唯一索引，回滚 = 删 `type='EVIDENCE_RECORDED'` 行）；**零掌握度写语义变更**。未做（诚实边界）：证据→掌握度回流语义统一（改生产写语义，需批准）归 V12-M3；前端消费归 M2b；推荐曝光遥测 EB-3 归 M2a。报告：`docs/v12-m1-evidence-foundation.md`。**环境实录**：本会话 Docker Desktop 引擎未能在 5 分钟内就绪（宿主级），55432 测试库与 PostgreSQL 集成测试本轮**不可执行**，故未声称任何集成/生产证据。

> 本文件是所有 Agent 接管项目的**唯一常青状态入口**。开工先读本文件 + AGENTS.md。
> 维护规则：每换阶段/每完成一个 Sprint 由当值 Agent 更新本文件；历史细节去 `docs/DEVELOPMENT_LOG.md` 与 `docs/handoff/` 查。
> 最后更新：2026-09-10（V12-M2a 完成：EB-3 闭合——推荐曝光遥测 + 只读漏斗，`exposed=null≠0` 诚实缺席语义；AGENTS.md §7 全部正式门禁在本会话首次可执行并通过：npm test 2112/2110/0/2、build:api/web exit 0。V12 路线见 `docs/v12-0-score-improvement-audit.md` §8；进度账本见本文件顶部）

---

## 1. 当前阶段与目标

> **本节 2026-09-08 校正**（外部接管审计 P0-2 修复）：以下为当前事实；§2-9 为 2026-09-05 时代的历史快照，仅作归档参考，与顶部账本冲突时以账本为准。

- **分支**：`feature/v3-product-refactor`；**HEAD 随账本最新条目**（见 git log；本节不再维护具体哈希以免再次漂移）。
- **当前 Mission**：**V12 — Score Improvement Engine**（2026-09-10 所有者确认并授予自主长程模式）。唯一评价标准 = 把"练习闭环"升级为"**提分证据闭环**"：每个学习决策可解释、每次干预可验证、能力变化可对照到分数口径（宪法与路线见 `docs/v12-0-score-improvement-audit.md` §7/§8）。
- **进度**：**V12-M1 ✅ M2a ✅ M2b ✅ M3（审计 + 影子）✅ M4 ✅ M5 ✅** —— EB-1/EB-2/EB-3/EB-4/EB-5 全部处置：证据层（活动/证据/能力三层语义）+ 推荐曝光遥测与只读漏斗 + 证据账本前端 + 复习语义矩阵与只读影子 + 机会模型（反黑箱、缺数据拒绝出分）+ 分数校准（预测/证据/实测严格分离）。**门禁状态：AGENTS.md §7 全部可执行并通过**（`npm test` 2185/2183/0/2、`build:api`、`build:web` 均 exit 0）。下一步：**F4 大题训练**（无 Schema 批准，故只做纯模块 + 影子评分器 + 离线 rubric + 测试）→ V12 FINAL AUDIT → V12 FINAL RELEASE REPORT。历史 LE/V10 线：F1 真题对标 ✅；F2 模考诊断 ✅；F3 遗忘防线 M1 影子基线 ✅；F4 content-blocked。V11 M1-M4 全部 code-complete 且已推送 origin。
- **交付状态**：**本地与 origin 同步**（截至 V12-M4 已推送 `fe878b9`；M5 提交后需再次核对）；**生产部署 DEFERRED（所有者门控）**——生产运行 `43b715e` 前后构建，V11-M2/M3/M4 端点未上线（404，V12-0 路由探测实证），server steps 见 `docs/v11-final-release-server-steps.md`。
- **一句话目标**：诊断 → 学习 → 训练 → 测评 → 修复 → 再学习 的完整提分闭环，每个变更以六指标之一结算。
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

### 沙箱环境验证门禁替代（2026-09-08 外部审计 P0-4 登记）

部分受限沙箱环境 `npm test`（node --test 逐文件 spawn 子进程）与 `npm run build:web`（esbuild spawn）会 EPERM 失败——这是环境限制，不是代码缺陷。该环境下可用的替代门禁（已在 2026-09-08 审计实测验证）：
1. **逐文件**：`node --test <file.test.js>`（330 个 .test.js 全跑 ≈ 1945 tests；勿用 `--test-isolation=none`——跨文件状态污染会产生假失败）。
2. **类型三端**：`tsc -p packages/shared --noEmit` / `apps/api` / `apps/web` 全部 exit 0 等价于 build 门禁的类型部分。
3. **区分**：主开发环境 `npm test` 正常（本会话实测 2015/2013/0）；只有沙箱会话需要本替代。若在此类沙箱中工作，完成声明须注明所用的替代门禁。

### PostgreSQL 集成脚本预存断言失败（2026-09-07 V10-1 归因登记）

- `npm run test:integration:postgres` 在 `scripts/integration-postgres.mjs:1254`（assert :3168）失败："review scheduler regression requires three target-date tasks"——脚本要求明日（UTC）ACTIVE 计划含 ≥3 个任务。
- **归因实验**（V10-1 期间完成）：摘除 SpriteController 注册复跑 → 失败相同；`db:test:down`（清卷）→ 全新库复现 → **与 V10 无关，属 HEAD 预存债务**。账本最近一次集成全绿 = V6.3（`b72bfc5`）；此后 V8 #13 断档结转重锚、V9 Phase 2 周强度均改写计划管线，目标任务在特定日期的分布可能已变化。
- `npm test` 全量不受影响（该脚本不在其中）。**待独立小任务收口**：核对脚本前置与现行计划管线语义，修脚本前置或修管线，由所有者指派。

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
