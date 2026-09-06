# V8 全产品审计（Phase 0）

> 日期：2026-09-07。基线：`b72bfc5`（V6.3 已上线生产）。审计方式：三路仓库静态审计（前端产品面 / 后端学习闭环 / 测试与可观测性）+ 生产环境（http://43.128.30.191/）真实账号（jackchou，有 8 月以来真实学习数据）浏览器走查（首页/题库/错题/测试报告/知识五分区）。
> 原则：只记录有证据的机会，不制造问题。编号规则：U=前端 UX、B=后端能力、T=测试/可观测、P=生产走查实证。

## 1. 产品现状一句话

学习闭环的"写"侧（练习→判题→掌握度→错题→复习→计划）完整且已在生产运行；最大的产品问题不是缺功能，而是**同一个学生在同一屏被告知互相矛盾的事实**（四科"暂无数据" vs 89% 掌握度、三处"最重要考点"各不相同、错题计数 0/12/23 三种口径），以及**关键能力最后一公里缺失**（effectiveness API 无前端消费、无时长预算入口、断档无恢复、计划理由不下发到任务卡）。

## 2. 生产走查实证（P 系列证据）

| # | 发现 | 证据位置 | 影响 |
|---|---|---|---|
| P1 | 学生可见内部术语泄漏："预计提分空间 -- / Canonical Overview 未定义该指标" | 测试→提分报告→总览 KPI 卡 | 信任硬伤，开发者语言直达学生 |
| P2 | 掌握度原始浮点直出："先序遍历（掌握 41.6462%）" | 报告"下周最重要任务/长期薄弱点" | 粗糙感，数据不严肃 |
| P3 | 掌握度趋势图把无快照日渲染为 0%（数据结构序列 76/82/80/0/80/0/0…） | 报告→四科掌握度→趋势柱状图 | 误读为"掌握崩塌"，违反 unknown≠0 原则 |
| P4 | 目标进度"还差 0 分"（目标分默认=估分=120）与"预测分数 115–125 分"同屏矛盾 | 报告→目标进度卡 | 目标机制形同虚设 |
| P5 | 错题计数三口径：错题页"待复盘 0/当前错题 12/已复盘 12/重做解决 13"，报告"23 道待复盘" | 错题页汇总 vs 报告当前风险 | 学生无法判断真实进度 |
| P6 | 同一考点 5 张完全相同的复习卡（同名"Cache 映射与替换 · 复习时间 2026-09-06 · 已复习 0 次"） | 错题→复习队列"今天 11" | 无法区分，重复感强，信任受损 |
| P7 | "最重要的一件事"跨模块不一致：AI 洞察=先序遍历、今日计划=Cache 映射与替换、题库提分报告=树与二叉树、错题"今日最该复盘"=Cache基本原理 | 首页/题库/错题/报告四页 | 核心产品承诺"它知道我现在该做什么"被打折 |
| P8 | 同屏自相矛盾：StudentStateCard 四科全部"-- 暂无数据"，下方"408 科目模块"显示 58%/89%/67%/0% | 首页两相邻模块 | 两套掌握度口径（P2-2）直达学生 |
| P9 | "本周学习节奏"跨 08-16→09-12 四周，且残留 8 月考后复盘旧任务（0/1 已完成） | 首页本周节奏区 | 断档任务无结转/清理（对应 B5） |
| P10 | 可恢复会话列表噪音：5 条重复"模拟考试 0/40" + 空名按钮 + "阶段测评 0/2 题 · 2 分钟"级碎片 | 首页中段 | 决策疲劳 |
| P11 | Knowledge Galaxy "0 条已知关系"（318 节点）——图有关系数据但视图不渲染 | 知识→Galaxy 汇总条 | 图谱价值未兑现 |
| P12 | 文案口径漂移："当前薄弱点较少"（题库）vs "12 个薄弱信号"（首页画像） | 题库/首页 | 口径不一致 |
| P13 | 跨页矛盾：计组"89% · 暂无薄弱点"（知识/首页）vs Cache（计组）"错误 6 次 · 未掌握"（错题） | 知识/错题 | 同 P8 双口径跨页版 |
| P14 | 题库训练流"第 1 / 328 题"与"预计 33 分钟"数学不自洽；答题区与"训练模式/学习模式"双按钮并存状态困惑 | 题库 | 理解成本 |

## 3. 前端产品面（U 系列，仓库审计）

结构事实：5 个学生分区（首页/题库/知识/错题/测试），StudentLoopGuide 四步闭环导航条常驻；plan/score-center/report 分区被别名归一（`RoleNavigation.tsx:80-84`）；DashboardHero/StudentStateCard/StudentActionCard/TodayMission/TodayLearningRoute/QuickActions/学习画像/LearningTrend 同屏 8+ 模块。

- U1 AI 分区无导航入口，只能靠 Hero 按钮发现（`RoleNavigation.tsx:62-72` 白名单含 ai 但导航项无）。
- U2 "调整计划"→onNavigate('plan') 被归一为 dashboard 原地不动（`TodayLearningRouteView.tsx:73,137`）。
- U3 死代码：TodaysScoreCenter、StudentLearningConsole 全仓无 import（score-center 分区不可达）。
- U4 闯关中途离开静默清空 questContext（`App.tsx:287-294`）。
- U5 首页三个今日模块（StudentActionCard/TodayMission/TodayLearningRoute）竞争，完成态不同步（`StudentSections.tsx:310-362`）。
- U6 TodayMission 任务行无推荐理由（reason 只在 TodayLearningRoute）。
- U7 LearningTrend 柱高是合成权重 completedTask*24+practice*8，易误读为时长（`useDashboardViewModel.ts:117-122`）。
- U8 会话"保存并退出"/Esc 无二次确认（`ExamSession.tsx:341,293-301`）。
- U9 静默恢复会话无"已恢复到第 N 题"提示。
- U10 提交错卷后 N 个错因弹窗连发，不能批量跳过（`App.tsx:1735-1772`）。
- U11 测评/模考开始前无题数/时长确认。
- U12 错题行"做同考点变式"实际只打开详情（`MistakeWorkspace.tsx:375-380`）。
- U13 复习队列"即将到期"tab 永远为 0（`ReviewQueue.tsx:57-61`；生产实证 P 系列）。
- U14 "已掌握"无学生手动出口（不能主动标记不再复习）。
- U15 知识图谱无"只看薄弱"过滤（只有高频/重要度；生产实证）。
- U16 effectiveness 四端点前端零消费（grep 0 命中；V6.3 最后一公里）。
- U17 学生顶栏 API 状态只反映 overview 单资源（`App.tsx:331`）。
- U18 移动端底部导航硬编码深色不随主题（`styles.css:5494,5503`）。
- U19 mobile-nav 测试为源码正则断言非行为测试。
- U20 首跑向导 OnboardingWizard 渲染在 dashboard 最底部，首屏全是"-- 暂无数据"卡（`StudentSections.tsx:310-362`）。
- U21 InitializationCore 固定 6.6s 假初始化动画。
- U22 无时间预算入口（"我只有 15 分钟"场景全缺；后端四档引擎已存在被闲置）。

## 4. 后端学习闭环（B 系列）

- B1 GET /today/plan 不透出结构化 reasonCodes/scoreBreakdown（字段已存在，仅 score-center 路径填充；`recommendation.service.ts:241-249` vs `study.service.ts:1176-1192`）。
- B2 任务无 skip 语义（postponeCount 混用）。
- B3 无任何推送通道（纯拉取；grep notification/websocket/@Cron 零命中）；actionAnchor 是前端 hash 字符串。
- B4 sprint-plan remainingDays 直接回显自报值，无 targetExamDate 倒计时（`student-state-sprint-plan.adapter.ts:91`；生产实证"冲刺阶段 + 109 天"）。
- B5 断档恢复缺失：旧计划静默删除重建，未完成任务无结转压缩（`study.service.ts:1139-1156`；生产实证 8 月旧任务残留）。
- B6 StudyPlan.stale 是死字段（从未写 true），与 score-center 响应层 stale 两套语义。
- B7 经典闭环无时长参数；四档打包引擎（30/60/120/180）只在 score-center 生效（`score-center/routes.ts:21` vs `study.service.ts:2613` 硬编码 60）。
- B8 practice-sets/recommended 只有一句话 reason，无结构化 evidence（数据在内存中已算出：`recommendation.service.ts:96-98,185-196`）。
- B9 score-history trendLabel"提升 X 分"实为正确率百分点差；无考试倒计时字段。
- B10 effectiveness 数据无前端消费（同 U16，后端侧确认）。
- B11 Question.contentFingerprint 无唯一约束（仅索引），去重靠脚本人工执行；verify 脚本未进 CI。
- B12 题目无真题年份聚合视图（year 字段在但未在练习/报告露出"真题来源"）。
- B13 NodeMap/考频覆盖率无观测端点；推荐引擎静默排除无快照节点（`recommendation.service.ts:126-134`）。

## 5. 测试与可观测性（T 系列）

- T1 22 项失败中 14 项 A 类（B2 重构后源码契约过时：student-action-ui×12、student-action-navigation:241、wrong-question-evidence:63，另有 v3-section-wiring:21、web-desktop-actions:36 可归此类）——断言的 canonical action-spine 管道已被 wrongReviewPriority 架构替换。
- T2 4 项 B 类是**真实产品缺陷**：useStudentContextData 无过期请求守卫（旧响应覆盖新状态、旧失败打翻新成功、跨账号串数据、disabled 仍写入；`useStudentContextData.ts:11-37`）。22 项中唯一"该修产品"的一组。
- T3 2 项 C 类脆弱断言（整段 JSX/变量名匹配）。
- T4 ai-metrics 11 类事件仅 4 类有生产接线；snapshotLearningIntelligence 无 controller 暴露（死代码半边）。
- T5 AI 指标 60 分钟内存窗口重启清零，无持久化。
- T6 产品指标有基础（beta-metrics：近 7 天活跃/留存/正确率等）但无按日 DAU 序列、无 session 时长聚合（LearningSession.totalActiveMs 闲置）。
- T7 CI 门禁矛盾：deploy-pages.yml 必红（含 22 失败）；workflow 只盯旧分支 codex/deployment-ready。
- T8 浏览器层靠手写 CDP 脚本（verify-ui.mjs 进 check:local；verify-deep-interactions.mjs 手动且默认指生产）。
- T9 staging-smoke 未覆盖 /ai/metrics、/admin/metrics 权限与形状。

## 6. 审计结论与排序原则

P0 判据：破坏学生对系统"诚实"的信任（数据自相矛盾、内部泄漏、null 当 0）、或存在真实状态破坏风险（竞态串数据）、或阻塞 CI 门禁。P1 判据：打通已投入建设能力的最后一公里（effectiveness 消费、reason 下发、时长预算、断档恢复）。P2：体验摩擦。P3：打磨。

完整 55 项排序清单见 `docs/v8-master-backlog.md`。学生体验状态基线见 `docs/v8-student-experience-state.md`。
