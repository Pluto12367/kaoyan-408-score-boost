# Student Operating Protocol — 产品 / UX / 学习行为 / 系统引导设计

> 日期：2026-09-12 ｜ 性质：**READ-ONLY AUDIT + PRODUCT DESIGN**
> 基线：分支 `feature/v3-product-refactor`，HEAD `7832a5b`（工作区脏文件仅 `.zcode/` 未跟踪）
> 事实来源：**当前仓库真实代码 + Prisma Schema + 迁移 + 测试 + Git 历史**（AGENTS.md §1）；文档与代码冲突时以代码为准并记录差异。
> 本文件是唯一产物。**零代码改动、零 schema、零迁移、零数据库写入、零 API 变更、零页面、零新 Agent、零新算法、零部署、未启用 C1、未开始 G1 实现。**
> 输入：`docs/score-improvement-gap-report.md`（提分有效性差距审计）、`docs/score-improvement-reconstruction-design.md`（架构与产品重构设计）、`docs/s2-transfer-probe-formal-design.md`（迁移探针形式化设计）、`docs/current-sprint.md`（状态唯一入口），以及三份只读旁证审计：
> `docs/audit/sp-guidance-frontend-inventory.md`、`docs/audit/sp-guidance-backend-audit.md`、`docs/audit/sp-guidance-infra-audit.md`。

---

## 0. 任务回答（先给结论）

**§38 唯一问题的判定：`PARTIAL`。**

> 如果一个完全不了解系统的 408 学生第一次登录，系统能否在不依赖人工教学的情况下，让他知道"今天应该做什么、为什么做、怎么做、什么时候验证、验证后下一步是什么"？

| 子问题 | 判定 | 一句话依据（详见 §B/§C） |
|---|---|---|
| 今天应该做什么 | **YES** | 有强制入学表单（`OnboardingWizard` 4 步，`App.tsx:348-354`）+ 唯一主行动仲裁（`canonicalNextAction.ts:4-13`）+ 今日任务首行（`TodayMission.tsx:68-70`）。**但同屏有 ≥7 个并列的"下一步"来源，没有仲裁者。** |
| 为什么做 | **PARTIAL** | 每个任务都有理由行（`TodayMission.tsx:69`「为什么：」）与解释抽屉（`WhyRecommendedDrawer.tsx`）。**但 `priority.ts:111-121` 会把凑数的通用理由当真实理由下发，UI 原样当真话展示——"为什么"可能是假的。** 且答案只是"为什么优先级高"，不是"它能换几分"。 |
| 怎么做 | **NO** | 全仓 `grep` 零处针对任何学生功能的使用方法教学：错题本「标记复盘」意味着什么、复习 1/3/7/14 天规则、迁移复测是什么、模考该怎么用，都没有在功能发生时解释。唯一例外是错因自评弹窗内一句复习节奏说明（`ErrorReasonSelector.tsx:121`）。 |
| 什么时候验证 | **PARTIAL** | 验证机制真实存在（`task-evidence.ts` verdict、证据台账、迁移探针 `detail.kind='transfer_probe'`）。**但验证结果只在「测试 → 总览」里出现，而"完成任务"发生在首页/题库；验证与行为不同屏、不同区，学生做完任务看不到"系统会怎么验证我"。** 迁移探针默认关闭（`TRANSFER_PROBE_ENABLED` 未设置），且挂在报告页而非今日区域。 |
| 验证结果意味着什么 | **PARTIAL** | 证据强度的语言已经写好且诚实（`LearningEvidenceLedger.tsx:113-115` 观测证据/自评证据/仅活动；`:72` 系统拒绝据此判断能力变化）。**但这套语言埋在报告页；而且 `null` 在 10 处被渲染成 `0`（`StudentStateCard.tsx:10` 未知科目画成空环、`RecommendationCard.tsx:22` 打印字面 `0` 优先级分），与它自己的诚实层直接冲突。** |
| 下一步是什么 | **PARTIAL** | `NextLearningStepCard` 在 5 个面挂载，逐面给出 NEXT；`canonicalNextAction` 有严格优先级。**但它与全局仲裁的优先级不一致（`NextLearningStepCard.tsx:53` 与 `canonicalNextAction.ts:4-13` 各写一套），且验证后的 NEXT（探针答错之后做什么）不存在。** |

**为什么不是 `NO`**：系统的"WHAT"是真实可用的，"验什么/怎么判"的机制与诚实词汇已经存在且工程化程度很高（证据台账强/弱/仅活动三分类、`insufficient_data` 贯穿、预注册校准门槛、探针的"这不是普通练习"文案）。缺的是**把已有诚实资产搬到行为发生的时刻**，而不是从零造。

**为什么不是 `YES`**：四个结构性缺陷使"零人工教学自举"不成立——
1. **HOW 完全缺失**：没有任何功能在首次使用时解释自己该被怎么用（§C-C、§C-D）。
2. **WHY 可能被伪造**：理由码凑数（`priority.ts:111-121`），UI 无从区分"真实触发"与"凑满两条"（§C-B）。
3. **VERIFY 错位**：验证的语言在报告页，行为在首页/题库；且"完成 ≠ 学会"只出现在 `TaskEvidencePanel.tsx:44`（报告 → 总览）（§C-E）。
4. **系统不会纠正错误用法**：任务书 §12 的 10 类错误行为中，**7 类的判定数据已经存在、零 schema 就能检测，但一条都没有实现**（§I.2）；剩下 2 类只能用代理信号，1 类（"掌握度↑但新题不↑"）在个人层因样本门而**不可判定**（§I 模式 9）。而唯一一条现实的纠偏通道 `ProactiveCoachCard` 把动作渲染成**死的 `<li>`**，`actorHint` 字段前端根本不消费（`ProactiveCoachCard.tsx:71-81`）——正是任务书禁止的"只弹 Toast"（§C-N、§I、§J）。

---

## A. Executive Summary

### A.1 现状：系统拥有很少被"翻译"的强引擎

`docs/score-improvement-gap-report.md` 已判定因果链五段中只有"推荐→干预"为 `CONFIRMED`。本设计不重审该结论，而是审计**另一个被忽略的维度**：**引擎已产出的状态，有多少被翻译成了学生能执行的行为**。

答案是一张不对称的图：

```text
引擎侧（Decision / Learning Engine）        Guidance 侧（学生能看见的）
─────────────────────────────────────      ──────────────────────────────
6 因子 priority 分解            ████████    ███░░░░░  抽屉里一句 "Priority Score：58"，无刻度含义
9 类 reason codes               ████████    ████░░░░  映射为中文，但可能是凑数的（priority.ts:111-121）
4 态 task-evidence verdict      ████████    ██░░░░░░  只在报告页；完成处不显示
3 级证据强度 strong/weak/none    ████████    ██░░░░░░  只在报告页
4 态校准状态（预注册门槛）        ████████    ██░░░░░░  只在报告页
6 类学习风险 + 每类 3 个行动     ████████    █░░░░░░░  渲染为无点击的 <li>，actorHint 未被消费
迁移探针全链（E1-E6 资格规则）    ████████    █░░░░░░░  默认关闭；挂在报告页；结果页无 NEXT
18 类遥测事件                   ████████    ██░░░░░░  解释类行为零遥测；guidance 漏斗不可测
```

### A.2 五个结构性根因

| # | 根因 | 证据 |
|---|---|---|
| R1 | **"解释"与"行为"不同屏**：所有诚实解释集中在报告页（`ReportWorkspace`），所有行为发生在首页/题库/错题。学生做完任务时，与他对话的是"完成率"和"下一题"，不是"完成 ≠ 学会"。 | `TaskEvidencePanel.tsx:44` 在 `ReportWorkspace.tsx:122`；完成任务在 `TodayMission.tsx` / `PracticePanel.tsx` |
| R2 | **解释可以是不真实的**：`priority.ts:111-121` 在真实理由 <2 条时从通用池补齐。下游 `nodePlan.ts:123` 直接 `join('，')` 成一句话，`TodayMission.tsx:69` 冠以「为什么：」。学生被系统性告知一个可能没发生过的原因。 | `packages/shared/src/score-center/priority.ts:111-121`、`packages/shared/src/nodePlan.ts:123` |
| R3 | **纠偏不接线**：`deriveProactiveInterventions` 已经产出 `headline` + 3 条具体 `actions` + `actorHint`（指向 review/plan/practice/coach 四个既有入口），前端把它渲染成纯文本，连 `actorHint` 都没读。这是"不要只弹 Toast"的字面反例。 | `apps/api/src/adaptive/proactive-coach.ts:37-84` vs `ProactiveCoachCard.tsx:62-82` |
| R4 | **诚实层与显示层互相矛盾**：系统的诚实词汇是"未测量 / 证据不足 / 拒绝判断"，但 10 处 `?? 0` 把未知画成 0（空环、0 分、0 优先级）。**第一次使用系统的学生看到的正是这些 0。** | `StudentStateCard.tsx:10`、`RecommendationCard.tsx:22`、`ReportSummaryPanel.tsx:67,71`、`StudentProgressOverview.tsx:188,191` |
| R5 | **引导不可测**：`recommendation.exposed/viewed` 证明了这个模式可行，但只覆盖 2 个面（`score_center`、`today_mission`），`review_queue`/`exam_aligned` 两个语义最丰富的面声明了却零调用；`RecommendationEvidence`、`RecommendationReasonCard`、`依据` 展开、错因跳过、`ContextualCoach` 全部无遥测。 | `recommendationExposure.ts:25,57,62`；`TELEMETRY_EVENT_TYPES`（21 类）中 `page.view`/`button.click`/`ui.interaction`/`client.error` 零发射点 |

### A.3 本设计做什么（不加引擎，只加翻译层）

**Student Operating Protocol** = 在**不新增任何学习状态**的前提下，把 Learning Engine 与 Decision Engine 已经产出的状态，翻译成学生在**行为发生的那一刻**能执行、能验证、能被纠正的话。

```text
WHAT   → 今天/此刻做哪一件事          （已有：canonicalNextAction + todayPlan；需收敛到 1 个）
WHY    → 为什么是它，且必须是真的      （已有：reasonCodes；需拆掉凑数、补上"值几分"）
HOW    → 具体怎么执行才算做对          （缺失：全新，纯文案 + 每功能首次解释）
VERIFY → 系统会怎么判断我是否学会       （已有：task-evidence / 证据台账 / 探针；需搬到行为现场）
NEXT   → 验证结果出来后走哪条路        （半有：NextLearningStepCard；需统一优先级 + 补验证后分支）
```

### A.4 交付边界

- **不新增**：第二套 Student State、第二套 mastery、第二套推荐、第二套任务、第二套证据台账、第二套幂等（继承 V12 / S2 红线）。
- **可新增（提案，需独立批准）**：纯函数 guidance 模块、只读投影端点、前端引导组件、遥测事件名（受控词表扩展）、受控文案词表。
- **需要 schema 的**：本设计**不需要任何 schema 变更**。唯一"存储"需求是 dismiss/cooldown 记忆，可用既有 `UserEvent` 通道承载（§R.4）。
- **明确不在范围内**：真实分数录入通道（S1 已建，E1 实验未跑）、ROI 排序（S3/S4）、探针内容池（内容任务）、B13 节点标注（内容任务）。

---

## B. Current User Journey（首次使用学生逐屏走查）

审计人格：**第一次使用本系统、零内部知识的 408 考生**。视角：从登录到 AI Coach。
每步回答六个问题：①知道该做什么吗 ②知道为什么吗 ③知道怎么做吗 ④知道什么时候验证吗 ⑤知道验证结果意味着什么吗 ⑥知道下一步吗。

### B.0 走查前置事实

| 事实 | 证据 |
|---|---|
| 学生导航 6 个区：首页 / 题库 / 知识 / 错题 / 测试 / AI 答疑 | `RoleNavigation.tsx:46-53`、`:55-62`（移动端同 6 项） |
| **"今日计划""提分报告"不是导航项**：`normalizeRoleSection` 把 `plan`/`score-center` 折叠进 `dashboard`，`report` 折叠进 `test` | `RoleNavigation.tsx:82-86` |
| 因此**提分报告藏在「测试」区里**（`TestSection` = 阶段测评 + ReportWorkspace） | `StudentSections.tsx:373`、`TestSection.tsx:80-141` |
| 注册后有一次全屏仪式：`OnboardingFlow` → `InitializationCore`(3s 动画) → `WelcomeHero` | `App.tsx:1369-1371`、`InitializationCore.tsx:8,16,18-19`、`OnboardingFlow.tsx:8-14` |
| 真正的首用闸门是后端状态的 4 步表单，**无跳过** | `App.tsx:348-354`、`StudentLaunchpad.tsx:127`、`OnboardingWizard.tsx:61-122` |
| 每个学生区顶部都有一条 4 步闭环条 | `StudentLoopGuide.tsx:24-33`，挂载 `App.tsx:1433-1435` |

### B.1 逐步走查

| # | 步骤 | 学生实际看到的（path:line） | ① | ② | ③ | ④ | ⑤ | ⑥ |
|---|---|---|---|---|---|---|---|---|
| 1 | **登录 / 注册** | 注册表单里唯一的方向提示：`三步开始提分：填写邀请码 → 创建账号 → 完成入学诊断`（`AccountPanel.tsx:90`）；`RegisterWizard` 另有 4 步（`RegisterWizard.tsx:12`），其中目标院校/四科自评/学习时长/学习方式**只写 localStorage `408-os-onboarding-profile`，除欢迎页外无人读取**（`onboardingProfile.ts:16,34`；`loadOnboardingProfile` 唯一消费者 `OnboardingFlow.tsx:9`） | 部分 | ✗ | ✗ | ✗ | ✗ | 部分 |
| 2 | **首次进入** | 全屏 `InitializationCore`：5 行状态文字，其源码注释自认 `The stages are presentation only; nothing here gates real initialization work.`（`InitializationCore.tsx:16`）→ `WelcomeHero` 三个能力胶囊 `知识地图 / 学习计划 / AI 推荐`（`WelcomeHero.tsx:15-19`） | ✗ | ✗ | ✗ | ✗ | ✗ | 部分 |
| 3 | **开始学习（首用闸门）** | `OnboardingWizard` 4 步：考试目标 / 当前基础（**当前估分、最薄弱科目**）/ 学习节奏 / 确认。文案 `诚实评估才能生成有效计划`（`OnboardingWizard.tsx:80`）。**这是自报，不是测量** | ✓ | 部分 | 部分 | ✗ | ✗ | ✓ |
| 4 | **首页** | 同屏并列：`DashboardHero` CTA、`DailyBriefCard`（headline`先完成「X」`）、`ProactiveCoachCard`、`StudentStateCard`、**核心行动卡**（`aria-label="首页核心行动"`）、`TodayMission`、`TodaysScoreCenter`、`LearningTrend`、`AIInsightCard`（含硬编码 `READY` 徽标）、`QuickActions`、连击条、`StudentLaunchpad`（今日学习路线 + 科目卡 + 薄弱 TOP5 + 最近错题 + 本周节奏 + 掌握度趋势 + 断点续做 + 模拟考试配置面板）（`StudentHome.tsx:78-128`；`AIInsightCard.tsx:6`） | ✓×7 | 部分 | ✗ | ✗ | ✗ | ✓×7 |
| 5 | **诊断** | 学生点「开始入学诊断」（`DiagnosticSummary.tsx:54-55`）→ `POST` 自报的 5 个数字 → 模板句 `当前分数基础偏弱，建议先补高频基础考点，优先处理{最弱科目}。`（`learning.ts:152-158`；后端 `study.service.ts:1088-1099` 只做 `buildDiagnosticProfile` + `save`）。**名字叫"诊断"，实际是把表单又交了一遍** | 部分 | ✗ | ✗ | ✗ | ✗ | 部分 |
| 6 | **推荐** | `TodaysScoreCenter`：`今天最应该学什么` + 时长档 30/60/120/180 + 卡片（`RecommendationCard.tsx:41` CTA「为什么推荐」）。抽屉里：中文理由列表 + `Priority Score：{score}` + 6 因子 `分数构成`（`WhyRecommendedDrawer.tsx:33,40-47`）+ 一句恒定免责（`:48-50`）。**没有任何一句说明 Priority Score 是什么刻度、多少算好** | ✓ | 部分 | ✗ | ✗ | 部分 | ✓ |
| 7 | **第一道题** | 题库区 `TrainingHero` + `TrainingProgress` + `PracticePanel`。答题前无"怎么用"说明 | ✓ | 部分 | ✗ | ✗ | ✗ | ✓ |
| 8 | **答错** | 结果区：`下一步建议`（`PracticePanel.tsx:180-182`）、`本次学习影响`、`本题反馈依据`（`RecommendationEvidence`，其中 `confidence` 是**硬编码** `answerResult.knowledgePointTitle ? 'medium' : 'low'`，`PracticePanel.tsx:207`——不是样本量推导）、`GoalProgressInsight`、`NextLearningStepCard`，整体收在 `<details>学习影响与推荐依据</details>` 内（`:189-222`）。随后错因自评弹窗（8 类，可跳过，`ErrorReasonSelector.tsx:58-74`） | ✓ | 部分 | 部分 | ✗ | 部分 | ✓ |
| 9 | **错题** | `MistakeWorkspace`：`高频错因` / `优先重做` / `闭环建议`、`错题复盘依据`（confidence 按 `totalWrongCount` 阈值）、`复盘闭环` 标题句 `错题不是再看一遍，而是把错误变成下一次会做的动作。`（`:257`）、行内 `系统判定：{masteryStatus}（依据：连续正确 a 次 + 变式答对 b 次）`（`WrongQuestionDetail.tsx:226`） | ✓ | ✓ | 部分 | 部分 | 部分 | ✓ |
| 10 | **复习** | 到期复习在 `TodayPlan` 折叠区内（`TodayPlan.tsx:229`），或错题本的 `ReviewQueue` 分组卡。复习节奏规则（1/3/7/14 天）**只在错因自评弹窗里出现过一句**（`ErrorReasonSelector.tsx:121`） | ✓ | 部分 | ✗ | ✗ | ✗ | ✓ |
| 11 | **任务** | `TodayMission` 行：`为什么：{理由}`、完成后追加证据 chip（`掌握度 ↑` / `已练·未见提升` / `已练习`，`TodayMission.tsx:34-37,69`）；`TodayLearningRoute` 的 `今日第一步`（`TodayLearningRouteView.tsx:148-151`「完成后系统会更新掌握度、错题和下一步建议」）。**系统承诺"会更新"，但没承诺"会验证"，也没说"完成不等于学会"** | ✓ | 部分 | ✗ | ✗ | ✗ | ✓ |
| 12 | **大题** | 综合题在 `ExamSession` 内提交自评：`评分点将在确认交卷时展示，由你自行核对评分。`（`ExamSession.tsx:401`）；交卷确认弹窗列出未作答并可跳题（`:516-585`）。**无 rubric 内容（生产 0 行），无"大题该怎么练"的引导** | 部分 | ✗ | ✗ | ✗ | 部分 | 部分 |
| 13 | **Transfer Probe** | 挂在 `ReportWorkspace` 的**总览 tab**（默认 tab）内（`ReportWorkspace.tsx:81,124`），即「测试 → 提分报告 → 总览」。文案：`迁移复测 · 检验学习是否迁移到新题` / `一道从未见过的新题 · 这不是普通练习` / `本次复测：答对/答错` + `这道新题的结果已计入你的学习记录。` / `本次复测窗口已过期——这不是失败…`（`TransferProbeCard.tsx:101,132-133,141,150`）。**默认关闭**（`TRANSFER_PROBE_ENABLED` 未设置即 off）；答错后无 NEXT；聚合数值刻意不展示 | ✓ | ✓ | 部分 | ✓ | 部分 | ✗ |
| 14 | **模考** | 入口是首页 `StudentLaunchpad` 底部的 `408 模拟考试` 配置面板（卷型/科目/题数 + 生成并开始考试，`StudentLaunchpad.tsx:224-257`），提交后 `本次模拟：{score} 分`（`:251`）。**全仓无一句说明"模考是测量工具，不是学习任务"**（`grep 测量` 在 `*.tsx` 只命中 `TransferProbeCard` 的注释） | ✓ | ✗ | 部分 | 部分 | 部分 | 部分 |
| 15 | **Score** | `ScoreAnchorPanel`（报告 → 总览）是唯一有分账的地方：`系统预测（估算，不是成绩）`、4 态校准（`not_started / insufficient_evidence / preliminary / gate_passed`，含预注册门槛文字）、来源徽标、`未测之前系统不会替你编造分数`（`ScoreAnchorPanel.tsx:23-28,112,118,134`）。**但 `StudentProgressOverview.tsx:191` 同时显示 `目标分 {targetScore ?? 0}`、`StudentLaunchpad.tsx:251` 用 `本次模拟：{score} 分` 的口径说话** | 部分 | 部分 | ✗ | 部分 | ✓ | 部分 |
| 16 | **AI Coach** | 三个面：`TutorPanel`（`nextActions`/`reviewCards` 全是纯文本 `<li>`，无深链）、`ContextualCoach`（同样纯文本，附 `AI 教练只解释当前学习事实，不会修改你的学习状态或自动生成计划。`（`ContextualCoach.tsx:44`））、`SpriteWidget` 星野（**唯一带深链的 AI 面**：每句台词可展开 `依据`，`line.action.kind==='deep_link'` 产生可点击 chip，`SpriteWidget.tsx:233-243`）。服务端 prompt 明令不得执行（`contextual-coach.prompt.ts:9`） | ✓ | 部分 | ✗ | ✗ | 部分 | 部分 |

### B.2 走查结论：六问的通过率

```text
① 做什么   ████████░░  强（冗余到过载）
② 为什么   █████░░░░░  有载体，但可为假 + 不回答"值几分"
③ 怎么做   ░░░░░░░░░░  全缺
④ 何时验证 ███░░░░░░░  机制真实、位置错误、默认关闭
⑤ 结果含义 █████░░░░░  语言优秀，埋在报告页，且被 10 处 ?? 0 抵消
⑥ 下一步   ██████░░░░  5 个面各有实现，优先级互相不一致，验证后分支缺失
```

**结构性判断：这个产品已经具备"解释能力"，但把解释放在了错误的位置、用错误的可靠性、以不可测的方式，讲了一部分只有开发者能读懂的话。**

---

## C. Student Confusion Map

15 类混淆，按任务书 A–O 分类。每条给出：**当前 UI / 当前行为 / 用户误解 / 后果 / 严重程度 / 最小修复**。

严重程度定义：**P0** = 直接导致学生做出错误学习决策或对系统产生错误信任；**P1** = 显著降低效率或造成认知负担；**P2** = 体验瑕疵。

---

### A. 不知道做什么（Don't know what to do）

| 项 | 内容 |
|---|---|
| **当前 UI** | 首页同屏 ≥7 个"下一步"来源：`DashboardHero` CTA、`DailyBriefCard` headline、`ProactiveCoachCard`、核心行动卡、`TodayMission` 首行、`TodayLearningRoute` 的 `今日第一步`、`AIInsightCard`、`QuickActions`、顶部 `StudentLoopGuide`（`StudentHome.tsx:78-128`、`StudentLaunchpad.tsx:129-142`、`App.tsx:1433-1435`） |
| **当前行为** | 只有 `canonicalAction` 与 `TodayLearningRoute` 之间做了一次去重（`hideFirstStepAction`，`StudentSections.tsx:357` → `TodayLearningRouteView.tsx:79-83`）。其余 5 个来源各自独立渲染，互不仲裁 |
| **用户误解** | "这些是不同的事情，我都要做" / "教练提醒最重要" / "顶部闭环条说要去题库，但核心行动卡说要做任务，到底听谁的" |
| **后果** | 决策瘫痪与错配：学生按"最显眼"而非"最高价值"行动；`ProactiveCoachCard` 是纯提醒无入口，学生点不动，产生"系统坏了"的印象 |
| **严重程度** | **P1**（内容正确，但排名无仲裁 ⇒ 30 秒内无法确定唯一动作，与 §24 的"30 秒知道今天怎么学"目标不符） |
| **最小修复** | 单一仲裁出口：首页只保留 **1 个主 CTA**（`canonicalAction`）+ 1 行"为什么是它" + 1 个"还有别的事"折叠区（把其余来源降级进折叠区并各自带 `来源` 标签）。零 schema；纯前端信息层级变更。**必须在 G2 完成前先做，否则新引导只会变成第 8 个并列来源。** |

---

### B. 不知道为什么做（Don't know why）

| 项 | 内容 |
|---|---|
| **当前 UI** | `TodayMission.tsx:69` `<small>为什么：{reasonCodes → REASON_LABELS}</small>`；`WhyRecommendedDrawer.tsx` 的中文理由列表 + `Priority Score` + 6 因子构成；`TodayPlan.tsx:264-281` 的 `为什么做/完成标准/完成收益/做不完怎么办` |
| **当前行为** | **理由码在不足 2 条时会从通用池补齐**：`priority.ts:111-121` 依次补 `HIGH_RECENT_FREQUENCY` / `LOW_MASTERY` / `REVIEW_DUE`（按 breakdown 分值排序）。下游 `nodePlan.ts:123` 把数组 `join('，')`；前端无法区分哪条是真实触发 |
| **用户误解** | 把展示的理由当作事实："系统说我近 3 年高频考查 + 掌握度偏低，所以这个真的又高频又薄弱" |
| **后果** | **系统性地向学生传达错误因果**。学生据此建立的复习直觉是错的；一旦学生发现系统说的"薄弱"与自身体验不符，整条解释链的可信度一起崩塌（包括那些真实的部分）。这是引导层自身制造的教学谎言 |
| **严重程度** | **P0** |
| **最小修复** | ①后端把"真实触发"与"凑数回退"分开（`reasons` vs `fallbackReasons`，或给每条 reason 带 `triggered: boolean`）——**纯增量契约**，`calculatePriority` 的 score 计算零改动；②前端对 `triggered=false` 的条目改写为"其他参考因素"分组，或干脆不展示；③`WhyRecommendedDrawer` 的 `Priority Score` 换成有刻度含义的表述（如"系统给这个考点的学习优先级：中（58/100，本周第 3 位）"）。三项都不需要 schema。 |

---

### C. 不知道怎么做（Don't know how）

| 项 | 内容 |
|---|---|
| **当前 UI** | 不存在。全仓 `grep` 没有任何"操作方法"层（无 tooltip、无 info icon、无首次使用说明、无 feature tour；`docs/audit/sp-guidance-frontend-inventory.md` §11 记录 `Tooltip|info-icon` = 0 匹配）。唯一例外是 `ErrorReasonSelector.tsx:121` 一句复习节奏说明 |
| **当前行为** | 系统把"给一个按钮"当作"教会了一件事"。`错题本` 的 `标记复盘` 按钮不解释它做什么（`MistakeWorkspace.tsx:373`）；`学习模式` vs `训练模式` 无差别说明（`PracticePanel.tsx:291-292`）；`真题强化` 开关只有一句括号说明（`:265`）；迁移复测的"约 5 分钟"是唯一的时间预期 |
| **用户误解** | "标记复盘"被理解为"打勾了事"；"学习模式"被理解为更容易；错题本被当作"再看一遍解析"（尽管 `MistakeWorkspace.tsx:257` 已明确否认这一点） |
| **后果** | **Case C（练习正确 ≠ 考试正确）的主要人为成因**：学生会用最省力的方式使用功能（看解析、跳过重做、只刷熟题），而这些正是系统无法自动检测的行为（§I）。HOW 的缺失直接放大了错误使用模式的概率 |
| **严重程度** | **P0**（本设计的新增主体，也是 §38 判 PARTIAL 的第一主因） |
| **最小修复** | 建立 **HOW 文案表**（纯前端常量 + 首次使用门）：每个核心动作配 3 行 —— ①这一步在闭环里的位置 ②怎么做才算做对（可判定标准）③常见做错方式。挂在功能首次使用时（§T.2 的 `Contextual Guide`）。零 schema、零后端。 |

---

### D. 不知道什么时候算完成（Don't know when it's done）

| 项 | 内容 |
|---|---|
| **当前 UI** | 三种互不相同的"完成"语义并存：任务侧 `status==='completed' \|\| completed`（`TodayMission.tsx:68` 的勾）、进度侧 `progress.reachedTarget`（`useDashboardViewModel.ts:109-111`）、证据侧 `task-evidence` 的 `verdict`（`task-evidence.ts:55`）。`ExamSession` 有真正的完成判据（未作答清单 + 自评硬阻断，`ExamSession.tsx:516-585`） |
| **当前行为** | `TodayPlan.tsx:264-281` 提供 `完成标准` 标签，但内容来自 `task.reason`（与 `为什么做` 同源字符串，`:87`/`:96` 的 `taskCompletionDraft` 校验则是另一套自报字段） |
| **用户误解** | "题做完了 / 打了个勾 = 这件事结束了" |
| **后果** | 学生失去"什么水平才算过"的标准，只能以题量自我结算 —— 直接对应任务书 §8 的"今天完成了任务不等于今天已经学会" |
| **严重程度** | **P1** |
| **最小修复** | 把 `task-evidence` 的判定规则**前移到任务卡**：任务卡显式写出"完成 = 本任务知识点上出现 ≥1 条判分练习记录；达标 = 正确率 ≥60% 或掌握度上升"（即 `task-evidence.ts:104-143` 的真实阈值，逐字引用，不再写第二套）。零 schema。 |

---

### E. 把完成误解成学会（Completion mistaken for learning）

| 项 | 内容 |
|---|---|
| **当前 UI** | 报告 → 总览 → `TaskEvidencePanel`：`完成标记不等于能力提升——以下是每个任务对应知识点上的练习与掌握度事实。`（`TaskEvidencePanel.tsx:44`）。**这是全仓唯一一句直接说"完成 ≠ 学会"的学生文案** |
| **当前行为** | 完成任务的那一刻（`TodayMission` 勾选、`TodayLearningRoute` 的"今日任务已完成"终态、`PracticePanel` 的"本组训练基本达标"），出现的全是正向语言：`今日任务已完成`、`本次会帮助提升该知识点掌握度`、`会提升该考点掌握度，并计入今日练习进度`（`PracticePanel.tsx:198,206`）。`task-evidence` chip 只在**完成之后异步**追加（`TodayMission.tsx:19-48`），且失败静默（`:39-41`） |
| **用户误解** | "任务完成 + 正确率高 = 我学会了" |
| **后果** | Case A/B（mastery ↑ 而 score 不变 / activity ↑ 而 mastery 不变）在**产品叙事层**被鼓励，而系统在**数据层**明确否认。这是本产品最大的内外不一致 |
| **严重程度** | **P0** |
| **最小修复** | **零新逻辑的搬迁**：把 `TaskEvidencePanel` 的那句话与完成后的 verdict chip 提升为任务完成态的**同屏必显**元素（例如完成瞬间在任务卡内展开一行：`已记录 N 次作答 · 正确率 X% · 掌握度 Δ`，或 `已完成但无练习记录 —— 完成标记不构成能力证据`）。文案直接复用后端 `verdictBasis`（已经有了，无需新造）。 |

---

### F. 把 mastery 误解成考试分（Mastery mistaken for exam score）

| 项 | 内容 |
|---|---|
| **当前 UI** | mastery 以裸百分比出现在 ≥9 处：`StudentStateCard`（综合掌握度）、`StudentLaunchpad`（平均掌握度 + 进度条宽度）、`StudentProgressOverview`（四科平均掌握度）、`KnowledgeGalaxy.tsx:196`、`KnowledgePointDetailDrawer.tsx:216`、`RecommendationReasonCard.tsx:21`、`reviewCenterViewModel` 的 `masteryLabel`、`MasteryTrendPanel`、`TeamWorkspace.tsx:99`（教师侧） |
| **当前行为** | `formatMasteryRate` 只做取整 + `未评估` 兜底（`displayFormat.ts:7-9`）；`MASTERY_STATUS_LABELS` 只给状态词（薄弱/巩固/掌握）。**没有任何一处把 [0,1] 数值翻译成"这意味着什么考试能力"**；同时 `ReportSummaryPanel.tsx:347` 与 `StudentProgressOverview.tsx:192` 在同一屏给出"预测分数"区间，两者视觉等同 |
| **用户误解** | `掌握度 80%` = `考研能得 80 分`（task §15 明令禁止的误解） |
| **后果** | 学生用掌握度自我结算考试水平，忽略 150 分制映射、题型权重与主观题主权；报告页的"估算"徽标无法抵消首页的裸百分比 |
| **严重程度** | **P0**（与任务书 §15 直接冲突） |
| **最小修复** | 建立 **mastery 语言层**（纯前端映射，值域来自既有数据，不新增计算）：按 mastery 区间 × 证据强度输出 1 句人话（§L 的对照表），并**在同一个组件里**常驻一句固定边界声明："这是练习证据强度，不是考试分数。" 禁止在任何掌握度出现处只给百分比而无人话。 |

---

### G. 把练习正确误解成真正掌握（Practice accuracy mistaken for mastery）

| 项 | 内容 |
|---|---|
| **当前 UI** | `PracticePanel` 训练结论：`本组训练基本达标，可以继续加速巩固。`(≥85) / `接近达标`(≥70) / `还不稳`（`:61-65`）；作答结果 `本题答对，系统会把它作为当前考点的正向练习记录。`（`:204`） |
| **当前行为** | 正确率是**同源练习正确率**，且 `PracticeAccuracy` 的定义明确排除了探针与 review（`s2-transfer-probe-formal-design.md` §11）——但**这个排除在 UI 层完全没有被表述**。学生无法知道"我刷的这组题是不是我刚才错过的那批" |
| **用户误解** | "一组题 85% 正确 = 这个考点稳了" |
| **后果** | 这就是 Case C。系统已经建好测量设施（探针），却没有在**练习结论**里提示"正确率高 ≠ 新题会做，需要迁移验证" |
| **严重程度** | **P0** |
| **最小修复** | `PracticePanel` 训练结论卡新增一行"这个结论的边界"：`这组是同源练习正确率；新题是否也会做，要等迁移复测（约 5 分钟）验证。` 并在探针可用时于同卡给出直接 CTA（复用既有探针投递，不新增算法）。 |

---

### H. 把 AI 解释误解成已经学习（AI explanation mistaken for learning）

| 项 | 内容 |
|---|---|
| **当前 UI** | `TutorPanel`（分层提示 / 思路拆解 / 相似题推荐 / 下一步）、`ContextualCoach`、`SpriteWidget` 星野对话。已有的边界声明：`AI 教练只解释当前学习事实，不会修改你的学习状态或自动生成计划。`（`ContextualCoach.tsx:44`）、`AI 解释仅作辅助，最终以标准答案、标准解析和教师审核内容为准。`（`TutorPanel.tsx:62`）、`答案解析会由标准解析优先提供，AI 只负责补充讲解和相似题推荐。`（`PracticePanel.tsx:342`） |
| **当前行为** | 服务端 prompt 硬约束 AI 不得声称执行（`contextual-coach.prompt.ts:9`）；但 `nextActions` 是字符串数组（`:13` 明令"禁止出现执行性动作"），**因此 AI 的所有建议都无法变成动作**：`TutorPanel.tsx:108` 与 `ContextualCoach.tsx:72` 都渲染为纯 `<li>`。AI 侧唯一有深链的是 `SpriteWidget`（`SpriteWidget.tsx:233-243`） |
| **用户误解** | "我看了 AI 的解释并理解了 ⇒ 我学会了"；"AI 说建议练习这个概念 ⇒ 它已经帮我安排了" |
| **后果** | 阅读行为被误当作学习行为，系统侧零证据（`learning-evidence.ts` 里"阅读"根本不在 `LearningActionType` 中）；且 AI 建议**永不回流**：`recordLearningOutcomeDelta` 全仓零调用（gap report §15） |
| **严重程度** | **P1**（系统已用 prompt 守住"不撒谎执行"，但没堵住"阅读≠学习"这一侧） |
| **最小修复** | ①所有 AI 面统一加一句固定声明：`阅读解释不会自动产生掌握证据；要形成证据，需要做一次判分练习。`（复用证据语言，零新逻辑）；②把 AI 的建议从纯文本升格为**既有 action 的深链**（复用 `SpriteWidget` 已验证的 `deep_link` 机制 + `canonicalNextAction` 的既有动作类型），**不新增 AI 可执行权限**；③对 `nextActions` 计数做遥测（§V），使"AI 建议→是否真的开始"可测。 |

---

### I. 把推荐任务误解成唯一正确选择（Recommendation mistaken for the only option）

| 项 | 内容 |
|---|---|
| **当前 UI** | `TodaysScoreCenter` 的 3 张主卡 + `今日完整建议` 折叠（`TodaysScoreCenter.tsx:147-160`）。`TodayMission` 显示前 5 个任务（`useDashboardViewModel.ts:103`）。时长档 30/60/120/180 会**重算**计划（`TodaysScoreCenter.tsx:47-62`） |
| **当前行为** | 时长切换只改 `minutes` 入参重新生成（走 `generateScoreCenterPlan`），**UI 不解释"换了时长后为什么变了"**；`plan.stale` 时只输出 `当前展示上一次有效计划，新的推荐计算暂时不可用。`（`:100`） |
| **用户误解** | "系统给的这 3 个就是全部该做的" / "我换了 60 分钟，任务全变了，是不是系统在乱跳" |
| **后果** | 学生把推荐当指令，失去对"为什么变"的理解；换时长后的推荐漂移会被读成不稳定（对应任务书 §6-M） |
| **严重程度** | **P1** |
| **最小修复** | 时长切换时输出**差异说明**（纯前端比较两次 `items` 的 nodeId 集合：`60 分钟比 120 分钟少做了「X」「Y」，因为预算只装得下前 N 项`）。零后端。 |

---

### J. 不理解 Transfer Probe（Doesn't understand transfer probe）

| 项 | 内容 |
|---|---|
| **当前 UI** | `TransferProbeCard`：`迁移复测 · 检验学习是否迁移到新题`、进行页 `一道从未见过的新题 · 这不是普通练习`、结果页 `本次复测：答对/答错` + `这道新题的结果已计入你的学习记录。`、过期页 `这不是失败`（`TransferProbeCard.tsx:101,132-133,141,150`） |
| **当前行为** | ①**默认关闭**（`TRANSFER_PROBE_ENABLED` 未设置 = off；生产探针样本 = 0，`docs/current-sprint.md:3-4`）；②挂在 `ReportWorkspace` 总览 tab（`ReportWorkspace.tsx:124`），而**报告藏在「测试」区**；③投递后无预警（不推送不催促，设计如此）；④结果页无 NEXT 分支；⑤聚合数值刻意不下发（设计正确） |
| **用户误解** | 学生甚至可能永远看不到它；看到了也只知道"这是一道新题"，不知道"答错意味着什么、接下来该做什么" |
| **后果** | 迁移——本产品最高的效度资产——对学生的行为影响接近 0；Case C 的**唯一外部校准器**被闲置 |
| **严重程度** | **P1**（设计正确、位置与开关错误） |
| **最小修复** | ①首次出现时给一段一次性解释（`这不是普通刷题，是陌生题迁移测试；熟题做对 ≠ 新题会做`），用 §T.2 的 `Contextual Guide` 机制；②投递时在**今日区域**给一张卡（今日区域是行为发生地），报告页保留历史；③结果页补 NEXT：答错 → `把这道新题加入错题复盘 + 系统会在下次干预后重新复测`；答对 → `迁移已验证；继续保持`。三者都不需要 schema（探针投递端点已存在）。 |

---

### K. 不理解模考作用（Doesn't understand the mock exam's role）

| 项 | 内容 |
|---|---|
| **当前 UI** | 首页 `408 模拟考试` 配置面板（卷型/科目/题数/`生成并开始考试`）+ 完成摘要 `本次模拟：{score} 分`（`StudentLaunchpad.tsx:224-257`）；`ExamReport` 有分科统计、知识点失分、考后复习计划；`ExamDiagnosisPanel` 有 `模考诊断书` + `估算` 徽标 + `失分知识点（按 丢题数 × 考频 排序）` + 恢复计划闭环率 |
| **当前行为** | 全仓 `*.tsx` 对 `测量` 的匹配只在 `TransferProbeCard` 注释；**没有任何面向学生的话说明"模考是测量工具、不是学习任务"**。更糟的是入口与每日学习任务同屏同构（同为"配置 + 开始"），语义被抹平 |
| **用户误解** | "模考就是一次大练习" / "分低说明我完了" / "先多刷题，模考留着以后做" |
| **后果** | 模考被当作学习任务而被回避或滥用；`nodeLoss`/`recoveryClosure` 这些真正的情报被当成成绩单看；Case E（完成大量任务而预计分不提升）失去了唯一的测量锚 |
| **严重程度** | **P1** |
| **最小修复** | ①模考入口与起始页加固定声明：`模考不是学习任务，是测量工具：它的价值是发现真实失分，而不是让分数好看。`；②说明"何时该模考"（如：一个阶段收尾 / 距上次模考 ≥14 天 / 考后必须看失分清单），③把 `recoveryClosure` 的语言从 `恢复计划闭环：a/b (c%)` 改为可执行句。零 schema。 |

---

### L. 不理解预测分与实际分区别（Prediction vs actual）

| 项 | 内容 |
|---|---|
| **当前 UI** | 分账最清楚的一处是 `ScoreAnchorPanel`：`系统预测（估算，不是成绩）`、来源徽标（`系统模考/教师判分/采分点评分/真实考试/外部导入/来源未记录`）、`· 已验证/· 待验证`、4 态校准（`ScoreAnchorPanel.tsx:12-28,134,213-216`）。反面：`ReportSummaryPanel.tsx:247` 的"预测分数"卡与 `StudentProgressOverview.tsx:192` 的"预测分数"同屏并列，而 `StudentLaunchpad.tsx:251` 用 `本次模拟：{score} 分` 给出一个**无口径声明**的裸分 |
| **当前行为** | 量纲错配已在 S1 修复（`normalizeScore` 拒绝缺 totalScale；150 vs 100 不再可配对）；但 **UI 层没有统一的"这是估算 / 这是测评 / 这是真实成绩"三色标识**，三个概念在不同组件里用不同措辞 |
| **用户误解** | "报告说 94 分，我大概就这水平"（`estimatePredictedScore` 含 `0.2×remainingDays/240` 的 timeFactor artifact，gap report §13-E） |
| **后果** | 学生把启发式插值当成绩，`ScoreAnchorPanel` 的诚实被其他 4 处的随意冲淡 |
| **严重程度** | **P1** |
| **最小修复** | 统一 `ScoreKind` 徽标词表（`预测(估算)` / `测评` / `成绩`，含来源与时间），并**强制**所有展示分数的组件使用同一徽标组件；`StudentLaunchpad.tsx:251` 的 `本次模拟` 明确标注其语义为"本次模考正确率折算（估算）"。纯前端 + 复用 S1 已有字段。 |

---

### M. 不知道为什么系统突然改变推荐（Why did recommendations change?）

| 项 | 内容 |
|---|---|
| **当前 UI** | `plan.stale` 有降级提示（`TodaysScoreCenter.tsx:99-101`）；任务有 `reasonCodes`；`WeeklyAdjustment`（V9 Phase 2）会改次日计划强度 |
| **当前行为** | 推荐重算的触发因素对**学生不可见**：到期复习、掌握度变化、时长预算切换、周强度调整（`intensity_up 1.2 / maintain / down 0.8`）、`daysToExam` 相位乘数（`priority.ts:31-35`）。系统没有任何"变化说明"（diff）产出 |
| **用户误解** | "系统在乱跳 / 昨天让我学 A 今天让我学 B，它自己都不知道要什么" |
| **后果** | 信任流失；学生停止按推荐行动，退化为随机刷题 —— 这会让所有排序投资失效 |
| **严重程度** | **P1** |
| **最小修复** | 在今日计划顶部输出一行 **变更说明**（纯前端 diff 上一版已曝光集合，数据源 = `recommendation.exposed` 的当日记录 + 当前 `items`）：`今天变了：新增「X」（考频上升）、移除「Y」（已达标）`。若无法 diff 则诚实说明"计划重新计算"。零 schema。 |

---

### N. 不知道任务失败后怎么办（What to do after a task fails）

| 项 | 内容 |
|---|---|
| **当前 UI** | 有丰富的**非失败**出口：`task.postpone` / `task.reschedule` / `task.rebalance`（`TodayPlan.tsx:124,143,157`，全部有遥测），`错题本` 有 `复盘闭环` 三步骤（`MistakeWorkspace.tsx:259-266`），`NextLearningStepCard` 提供 NEXT。**没有"失败"这一状态** |
| **当前行为** | `task-evidence` 有 `practiced_no_gain` 判定（`task-evidence.ts:139-142`），但只是报告页的一个 chip；`ActionLearningSignal` 的 `FAILED` 已计算但 **`priority.ts`/`plan.ts`/`recommendation.service.ts` 零消费**（gap report §7 Q4）——失败推荐永不降权，系统会日复一日推荐同样的东西并同样失败 |
| **用户误解** | 学生连续两次没做完同一个任务后，只会看到同一个任务再次出现，于是理解为"我不行"或"系统没用" |
| **后果** | Case D（推荐分 ↑ 而实际 outcome ↓）在数据层可观测、在产品层不可见。这正是任务书 §12 模式 8（推荐任务连续失败）要防的 |
| **严重程度** | **P1** |
| **最小修复** | ①**引导层先于排序层**：当同一 `(nodeId, actionType)` 的任务连续 2 次以 `practiced_no_gain` 或不达标结束时，任务卡显示**降级/换手段**建议（`这个方式两次没有带来提升，换一种：先看概念对比，再做 3 道基础题`——复用 `MISTAKE_SUGGESTIONS` 与 `proactive-coach.ts` 的既有动作文案）；②明确写出"没做起来不算失败"的出口（顺延/削减/换难度），把 `task.rebalance` 从隐藏 API 升为可见按钮。**不改排序公式**（那是 S3/S4）。 |

---

### O. 不知道如何处理"证据不足"（How to handle insufficient evidence）

| 项 | 内容 |
|---|---|
| **当前 UI** | 系统已经很会在报告页说"证据不足"：`LearningEvidenceLedger.tsx:72` `没有可支撑能力推断的观测证据，系统拒绝据此判断能力变化。`；`EffectivenessPanel.tsx:144` `证据不足 ≠ 没进步，只是还不能证明`；`EffectivenessPanel.tsx:137` `…在此之前系统不会假装知道你提升了多少。`；`ScoreAnchorPanel.tsx:25` 预注册门槛；`TodayLearningRouteView.tsx:66` `当前没有可执行任务` |
| **当前行为** | **"证据不足"只被陈述，不被回答。** 全仓没有任何一处告诉学生"怎么才能让证据变足"：需要几次作答？多少正确率？多少天？唯一的量化线索是报告页的 `（至少 5 次练习且掌握度变化明显）`（`EffectivenessPanel.tsx:137`），且它埋在第三个 tab |
| **用户误解** | "系统说数据不足 ⇒ 我做得不够多 ⇒ 继续刷量"（最坏的解释），或"系统不给我结论 ⇒ 系统没用" |
| **后果** | 诚实的缺席被读成"要更多活动量"，**反向激励刷量**——与"Activity ≠ Learning"的宪法级立场冲突 |
| **严重程度** | **P0**（诚实机制被误用为刷量激励，是本设计最需要修的一处"诚实性副作用"） |
| **最小修复** | 给每一种 `insufficient_data` 配一条**可执行的最小充分条件**（把后端的真实阈值翻译成行动）：`再完成 3 次该考点的判分练习（现在 2 次），系统就能判断能力变化` / `需要 5 对"预测-实测"，现在 0 对：做一次教师判分模考即可建立第一个锚点`。阈值全部来自既有代码（`task-evidence` 门槛、`EffectivenessPanel` 的 5 次、`ScoreAnchorPanel` 的 n≥5），**不新造阈值**。 |

---

### C.3 严重程度汇总

| 等级 | 条目 | 数量 |
|---|---|---|
| **P0** | B（理由可能为假）、C（HOW 全缺）、E（完成≠学会不同屏）、F（mastery 当考试分）、G（练习正确当掌握）、O（证据不足被读成刷量） | **6** |
| **P1** | A（多来源无仲裁）、D（完成标准不明）、H（AI 解释当学习）、I（推荐当唯一）、J（探针不可见/无 NEXT）、K（模考语义缺失）、L（三色分账不统一）、M（推荐变化不解释）、N（失败无出口） | **9** |
| **P2** | —（本审计未发现独立 P2 级混淆；现有 P2 均为显示瑕疵，已并入上表） | 0 |

---
## D. Correct Learning Protocol（系统推荐的标准学习流程）

### D.0 设计约束

1. **不复述任务书的十条，而是给每条绑定真实代码资产**：如果一条步骤在仓库里没有任何已实现载体，它必须被标记为 `MISSING`，并进入 G 里程碑，而不是被写成"系统会……"。
2. **不假设所有学生每天执行全部步骤**：十步是**完备集**，不是日清单。四层级（§E–§H）负责决定"什么时候做哪几步"。
3. **步内五问**：每一步都必须回答 WHAT / WHY / HOW / VERIFY / NEXT。§D.2 是主表。
4. **阈值只引用代码**：本协议不新造任何阈值；所有数字（5 次证据门、n≥5 校准门、60% 正确率、45 天相位、36h–96h 探针窗）全部来自既有常量，并标注 `path:line`。

### D.1 十步 × 代码资产

| # | 步骤 | 载体（已实现） | 状态 |
|---|---|---|---|
| 1 | **Diagnose** 诊断 | `OnboardingWizard` 自报 4 步（`OnboardingWizard.tsx:61-122`）+ `DiagnosticSummary`（`DiagnosticSummary.tsx:54-55`）→ 后端 `buildDiagnosticProfile` 生成阶段句（`learning.ts:152-158`） | `PARTIAL`：**只有自报，没有测量**；真实的诊断性入学测（分层抽样 30-45 题）在 `score-improvement-reconstruction-design.md` §N.1 只是蓝图 |
| 2 | **Understand Loss** 认识失分 | 模考 `nodeLoss`（`ExamDiagnosisPanel.tsx:60-81`，`失分知识点（按 丢题数 × 考频 排序）`）、`gapDecomposition`、`recoveryClosure`（`恢复计划闭环 a/b (c%)`） | `PARTIAL`：仅在一场模考之后存在；全谱系失分地图 `MISSING`（gap report §5） |
| 3 | **Choose Intervention** 选择干预 | `canonicalNextAction`（`canonicalNextAction.ts:4-13`）→ `StudentActionCard`；`classifyAction` 五分支（推荐层）；`NextLearningStepCard` 五面变体 | `CONFIRMED`（仲裁唯一），但**首页同时存在 7 个并列来源**（§C-A） |
| 4 | **Execute Training** 执行训练 | `PracticePanel` + 练习会话（`usePracticeSession`）+ 幂等提交（AnswerReceipt） | `CONFIRMED` |
| 5 | **Do Not Assume Mastery** 不假定已掌握 | `task-evidence` 4 态 verdict（`task-evidence.ts:104-143`）+ `LearningEvidenceLedger` 3 级强度（`learning-evidence.ts:43`） | `CONFIRMED`（引擎）/ `MISSING`（位置：只在报告页） |
| 6 | **Transfer Probe** 迁移验证 | `TransferProbeCard` + `TRANSFER_PROBE_*` 常量（`transfer-probe.ts:21-44`）：窗 36h–96h、门 n≥5、同构 verified/unverified 永不合并 | `CONFIRMED`（工程）/ **默认 OFF**（`TRANSFER_PROBE_ENABLED` 未设置即关，生产样本 0） |
| 7 | **Review Result** 复盘结果 | `TaskEvidencePanel`（`完成标记不等于能力提升`，`TaskEvidencePanel.tsx:44`）+ `verdictBasis` | `CONFIRMED` |
| 8 | **Periodic Assessment** 周期测评 | `StageAssessmentPanel` + `ExamSession`（paper）+ `ExamReport` + 考后复习任务 | `PARTIAL`：阶段测评结果仅内存数组（gap report §17-#8） |
| 9 | **Score Validation** 分数验证 | `ScoreAnchorPanel` 三分账 + 4 态校准（`ScoreAnchorPanel.tsx:23-28`）；S1 四表（ScorePrediction/Assessment/Outcome/Correction） | `PARTIAL`：结构真实，生产校准数字 = 0（E1 未跑）；`User.examDate` 列已存在但**全仓无写入方** |
| 10 | **Re-adjust** 重新调整 | `deriveWeeklyAdjustment`（含**写给学生的完整句子**，`weekly-adjustment.ts:47,56,65,73`）→ 写入 plan；推荐重算 | `CONFIRMED`（引擎）/ **前端零消费**（`grep weeklyAdjustment apps/web/src` = 0 匹配） |

### D.2 十步的主表（WHAT / WHY / HOW / VERIFY / NEXT）

> HOW 列是本设计**新增**的内容；它有载体时标注载体，无载体时标 `NEW`。所有 HOW 都必须是**可判定的**（学生能自检"我做到了没有"），否则不写。

| # | WHAT | WHY（向学生的一句话） | HOW（可判定标准） | VERIFY（系统怎么判） | NEXT（结果出来之后） |
|---|---|---|---|---|---|
| 1 | 用 4 分钟填完基础信息，并对"当前估分"给出诚实的数 | "系统必须先知道你的起点和目标，才能排序；填错会让整周计划偏。" | 3 条：①当前估分写下你最近一次整卷的真实分数，不确定就填保守值 ②最薄弱科目选你"最怕考"的那科，不是"最不喜欢"的 ③剩余天数按真实考试日填 | 无验证（这是输入，不是学习） | 立刻得到第一份今日路线（`TodayLearningRouteView`）。**明确告知：这不是诊断，是计划输入** |
| 2 | 做一次模考，然后只看"失分清单" | "模考的作用是找出真实失分，不是让分数好看。" | 3 条：①整卷一次做完，不查资料 ②交卷前用未作答清单检查（`ExamSession.tsx:528-531`）③交卷后先看 `失分知识点`，再看分数 | `nodeLoss`（丢题数 × 考频排序）+ `recoveryClosure`（`ExamDiagnosisPanel.tsx:60-101`） | 把失分 Top 节点转成今日任务（`尚未生成恢复计划——使用报告页的"生成考后复习任务"…`，`ExamDiagnosisPanel.tsx:101`） |
| 3 | 只做**一件**最高价值的事 | "时间是有限的，系统按考频×薄弱×遗忘排序，先做收益最高的那件。" | 2 条：①打开首页只看"首页核心行动"卡 ②其余入口留到这件事做完（**严禁同时开两条线**） | `priority`（6 因子）+ 曝光遥测 `recommendation.exposed`（`recommendationExposure.ts:57`） | 做完 → 第 4 步；做不动 → 用 `顺延 / 削减计划`（`TodayPlan.tsx:124,157`），**不算失败** |
| 4 | 做判分练习，且**必须产生作答事实** | "只有被判分的作答才会形成能力证据；看完解析不算。" | 3 条：①每题先作答再看解析（学习模式也用先答后看）②综合题写出推导过程并自评，不要留空 ③一组结束前确保每题都有提交记录 | `PracticeRecord` + `EVIDENCE_RECORDED`（`learning-evidence.service.ts:34`） | 立刻看到第 5 步的判定 |
| 5 | 读系统给出的**证据判定**，而不是正确率 | "任务完成 ≠ 学会；系统只承认它观测到的作答。" | 2 条：①看 verdict 而不是正确率：`能力提升 / 已练习 / 已练习·未见提升 / 证据不足`（`task-evidence.ts:55`）②若为 `已练习·未见提升` → 走第 2 步的错因路径，不要重复刷 | `resolveVerdict`（`task-evidence.ts:104-143`）：未完成→`insufficient_data`；0 次作答→`insufficient_data`；任一节点掌握度 Δ>0→`improved`；正确率≥60→`practiced`；否则 `practiced_no_gain` | `improved` → 第 6 步（迁移验证）；`practiced_no_gain` → 错题复盘 + 换干预手段（§J-8） |
| 6 | 做一次迁移复测（约 5 分钟） | "熟题做对 ≠ 新题会做；这道题你从没见过，专门用来测迁移。" | 3 条：①不看解析 ②一次提交 ③约 5 分钟内完成 | `detail.kind='transfer_probe'` → `TransferRate/Gap`（**n≥5 才出结论**，`transfer-probe.ts:40-44`） | 答对 → 该节点"迁移已验证"；答错 → 进错题复盘 + 记为 `transfer failure` 类（§L 状态语言）；过期不做 → 中性记录，**不算失败**（`TransferProbeCard.tsx:141`） |
| 7 | 复盘结果，把结论落到动作 | "复盘不是再看一遍解析，而是把错误变成下一次会做的动作。"（`MistakeWorkspace.tsx:257`） | 3 条：①每题标错因（8 类，可跳过但要标）②重做一次，不看答案 ③做一道同考点变式 | 错因 `reportedReason/inferredReason` + `ReviewAttempt` + 重做结果 | 变式答对 → 该错题可标"已解决"；否则留在队列（`WrongQuestionDetail` 的 `系统判定`，`WrongQuestionDetail.tsx:226`） |
| 8 | 每 1–2 周做一次阶段测评或整卷 | "定期测量才能知道训练是否真的转化成了考试能力。" | 2 条：①两次测评间隔 ≥7 天 ②每次都做完（半途而废的测评不进入趋势） | `StageAssessmentResult` / `LearningSession(paper)` → `AssessmentHistory` | 有两次以上测评 → 趋势可比（`StageReportPanel` `暂无两次以上测评记录`，`StageReportPanel.tsx:48`）；否则第 9 步保持"未测" |
| 9 | 建立并查看**成绩锚点** | "预计分 ≠ 实际分。系统没有真实成绩前不会给你编一个。" | 3 条：①录入真实考试日期 ②做一次教师判分的模考，或录入一次外部成绩 ③看四态校准而不是看分数 | `GET /coach/score-evidence` + 分层校准（每组 n≥5 且中位误差 <15 分，`ScoreAnchorPanel.tsx:25`） | `not_started` → 按最小充分条件补齐（§C-O）；`preliminary` → 继续积累；`gate_passed` → 此时预测分才允许放大展示 |
| 10 | 按上周证据调整下周 | "负荷要由上周的真实证据挣来，不是靠意志力。" | 2 条：①先看 `上周：N 个节点证据充分、平均掌握提升 X%——本周加码 20%` 这类句子 ②若为"证据有限" → 不要加量，先把现有任务做完 | `deriveWeeklyAdjustment`（`weekly-adjustment.ts:33-76`）：evaluated<2 次→`maintain`；avgGain≥0.1 且 gatePassed≥1→`intensity_up`(×1.2)；avgGain<0→`intensity_down`(×0.8) | `intensity_up` → 只加时长不加新考点；`intensity_down` → 走 `task.rebalance`；`maintain` → 保持 |

### D.3 四种节奏的职责（不假设每天全做）

| 层级 | 覆盖十步中的哪几步 | 触发条件（全部来自既有代码） | 载体 |
|---|---|---|---|
| **Daily（每日）** | 3 → 4 → 5 →（6 若到期）→ 7（若有错题） | 每个自然日；`todayPlan.priorityTasks` 非空 | §E |
| **Weekly（每周）** | 2（若有模考）→ 7 → 8（若有测评）→ 10 | 周窗口；`deriveWeeklyAdjustment` 在生成计划时重算（`study.service.ts:1204`） | §F |
| **Milestone（里程碑）** | 5 → 6 → 8 | 节点级：该节点练习证据达门（≥5 次，`effectiveness.assembly.ts:62-70`）或节点闯关结算 | §G |
| **Pre-Exam（考前）** | 2 → 3 → 4（限时）→ 8 → 9 | `daysToExam ≤ 45`（相位乘数切换点，`priority.ts:32`）或 `remainingDays ≤ 14` | §H |

**"不适用"声明**：以上四层全部是"建议协议"，**系统不得阻断**。学生不执行时的正确行为是"如实记录未执行"，而不是弹窗劝返（见 §T.4 非阻断原则）。

---

## E. Daily Protocol（最小每日协议）

### E.1 协议

```text
① 查看今日目标            ≤30 秒
② 选择最高价值任务        系统已算好；学生只需确认或顺延
③ 完成主动训练            必须产生判分作答（不是看解析）
④ 记录错误                错因自评（8 类，可跳过）
⑤ 完成必要复习            到期复习优先于新内容
⑥ 结束前检查当天证据      看 verdict，不看完成率
```

来源对照（任务书 §8 的默认序列逐条落到代码）：

| 步骤 | 当前载体 | 每日协议需要的改变 |
|---|---|---|
| ① 查看今日目标 | `DailyBriefCard`（headline `先完成「X」`）+ `TodayMission` | **收敛**：首页只保留 1 个主行动（§C-A 最小修复）；`DailyBriefCard.headline` 升级为主标题，其余降级 |
| ② 选择最高价值任务 | `canonicalNextAction` + `StudentActionCard` | 补"为什么是它"（必须是真实理由，§K）；补"如果你今天只能做 20 分钟，就做它的前三题" |
| ③ 完成主动训练 | `PracticePanel` / `TrainingHero` | 补一句 HOW：`先作答再看解析；有提交记录才算这一步完成` |
| ④ 记录错误 | `ErrorReasonSelector`（8 类，可跳过） | 保留可跳过（诚实），但补一句 `标错因会让系统的下一个任务更准`（说明收益，不胁迫） |
| ⑤ 完成必要复习 | `TodayPlan` 折叠区内的 dueReviews + `ReviewQueue` | 把"复习"从折叠区**提到今日协议的第 5 步**（不是新功能，是把已有区块重排 + 一句 `到期复习优先于新内容`） |
| ⑥ 检查当天证据 | `task-evidence` chip（`TodayMission.tsx:34-37`）+ `LearningEvidenceLedger` | 在**今日区域**给一张"今天形成了什么证据"的小结（复用 `buildDailyBrief` 的 `followUpNote` 位 + verdict 数据） |

### E.2 每日协议的"今天完成了任务不等于今天已经学会"

**这是 §8 的核心要求，当前实现位置错误。** 设计如下：

| 位置 | 现在 | 每日协议要求 |
|---|---|---|
| 任务完成的那一刻 | 勾 + `今日任务已完成`（`TodayLearningRouteView.tsx:107-109`） | 同屏追加一行（数据已存在，来自 `verdictBasis`）：<br>`今日已完成 3/3 项；其中 2 项有练习证据（1 项掌握度上升），1 项只有完成标记、没有作答记录 —— 完成标记不构成能力证据。` |
| 报告页 | `TaskEvidencePanel.tsx:44` 已有正确文案 | **保留**，作为可下钻的详版 |
| 一句话原则 | 不存在 | 在完成态必显：**`完成 ≠ 学会；系统只承认它观测到的作答。`** |

### E.3 每日协议的边界（诚实条款）

- 每日协议**不要求**每天模考、每天探针、每天测评。
- 若当天没有到期复习、没有到期探针、没有错题，协议退化为 ①③④⑥ 四步——这必须被明说，否则学生会以为"我没做全"。
- 若学生一天没打开系统：**不惩罚、不制造罪感**（`sprite-persona.ts` 的宪法级禁词已约束语气）；断档恢复走既有 `missed-day-recovery`（`docs/current-sprint.md` 记录 V8 #13）。

---

## F. Weekly Protocol（每周协议）

### F.1 协议

```text
① Review       上周证据汇总（不是任务完成率）
② Transfer     至少一次迁移复测（若已有干预）
③ Mini Assessment  阶段测评或整卷（≥7 天间隔）
④ Score / Loss Review  看失分清单与校准状态
⑤ Next Week Plan   按证据加/减载
```

### F.2 "每周不是为了完成更多任务，而是为了验证上周训练是否减少了真正失分"

这句话必须由**数据**支撑，而数据已经存在，只是没被展示：

| 每周要回答的问题 | 已有数据 | 载体 | 当前是否展示 |
|---|---|---|---|
| 上周训练有没有形成证据 | `EVIDENCE_GATE`（n≥5、effect≥0.05、confidence≥medium，`effectiveness.assembly.ts:62-70`） | `GET /effectiveness/*` → `EffectivenessPanel`（报告 tab「努力与效果」） | ✅ 展示（但埋在第三个 tab） |
| 掌握度有没有动 | `UserMasterySnapshot` 日快照 + `MasteryTrendPanel` | `GET /mastery/trend` | ✅ |
| 负荷该加还是该减 | `deriveWeeklyAdjustment`（含学生可读 `note`） | 写在 plan 上（`onboarding-plan.repository.ts:53`） | ❌ **前端零消费** |
| 真正失分有没有减少 | `nodeLoss` + `recoveryClosure` | `ExamDiagnosisPanel`（仅在每场模考报告内） | ⚠️ 单场可见，跨周不可见 |
| 迁移有没有改善 | `TransferRate/Gap`（n≥5 门） | teacher/admin 端点（`transfer-probe.service.ts:688-694`） | ❌ 学生端刻意不下发聚合（设计正确，见 §N） |

### F.3 每周协议的设计动作

1. **周报页（复用，不新建页面）**：把「周」作为报告页 `总览` tab 的第一块卡，内容 = ①`weeklyAdjustment.note`（逐字，已写好）②证据充分节点数 / 证据不足节点数 ③掌握度周变化 ④本周是否完成 ≥1 次迁移验证 ⑤下一步：加码/维持/降载。
2. **周报必须显式回答"失分有没有减少"**：若上周有模考，显示 `上周失分 Top3：X / Y / Z；本周：…`（纯 diff，数据来自两次 `nodeLoss`）。
3. **不得把"完成的任务数"作为周报头条**（任务书 §9 隐含要求）。头条永远是"证据 / 失分变化"。
4. **迁移验证的诚实缺席**：`TransferRate` 学生端不可见（设计如此）。周报只能说 **"本周你完成了 N 次迁移复测（个人事件）"**，不能说 "你的迁移率是 X%"——后者违反 S2 §12 证据门与学生可见性设计（`transfer-probe.service.ts:688-694`）。

---

## G. Milestone Protocol（里程碑协议）

### G.1 要防的失败模式（任务书 §10）

```text
刷熟题 → 正确率很高 → 继续刷        （无迁移验证的死循环）
```

### G.2 里程碑触发条件（全部来自既有代码，零新阈值）

| 触发 | 判据（代码） | 触发的协议步骤 |
|---|---|---|
| 节点练习证据达门 | `EVIDENCE_GATE.minSampleSize = 5` 且 `minEffectSize = 0.05` 且 `requiredConfidence = 'medium'`（`effectiveness.assembly.ts:62-70`） | 强制进入 **Transfer**（§D 第 6 步） |
| 节点闯关结算 | `quest.complete` 遥测（`App.tsx:931`，携带 `{nodeId, accuracy, passed}`） | 结算即提迁移复测 |
| 任务连续两次 `practiced_no_gain` | `task-evidence.ts:139-142` verdict | 强制进入 **换手段**（§J-8），而不是继续同手段 |
| 同节点分数持续上升但无探针记录 | mastery Δ>0 且该节点 `TRANSFER_PROBE` 证据数 = 0 | 提示 `迁移未验证`（§L 状态语言），给出复测 CTA |

### G.3 里程碑协议的行为设计

```text
节点掌握度上升 + 证据充分
   ↓ 系统判定：练习证据充分（不是"已掌握"）
显示：该考点已有充分练习证据 —— 但"新题会不会做"还没验证
   ↓
CTA（可跳过，不阻断）：做一次迁移复测（约 5 分钟）
   ↓ 复测结果
答对 → 状态升级为「迁移已验证」
答错 → 状态为「迁移未通过」→ 进错题复盘 + 下次干预后再复测
无合格新题 → 诚实显示「暂时没有合格的新题，系统不会拿旧题冒充迁移测试」
```

最后一句直接对应用户任务书 §23 的第三种 empty state，且它**在代码中已经是真的**：`no_probe_available` 是显式终态（`s2-transfer-probe-formal-design.md` §7、§17），永远不降级用旧题。

### G.4 禁止

- 禁止用"掌握度 80%"作为里程碑达成的语言（§C-F）。
- 禁止在没有探针可用时把"证据充分"包装成"已掌握"。
- 禁止把里程碑设计成奖励点击（`guide click ≠ learning improvement`，任务书 §32）。

---

## H. Pre-Exam Protocol（考前协议）

### H.1 相位切换点（引用既有常量，不新造）

| 相位 | 判据 | 系统已有行为 |
|---|---|---|
| 常规 | `daysToExam > 150` | `phase.exam 0.92 / weakness 0.95 / difficulty 1.12`（`priority.ts:31-35`） |
| 中期 | `45 < daysToExam ≤ 150` | `exam 1.08 / weakness 1.05 / difficulty 1`（`priority.ts:33`） |
| **冲刺** | `daysToExam ≤ 45` | `exam 1.18 / weakness 1.12 / difficulty 0.82`（`priority.ts:32`）；`EXAM_NEAR` 理由码（`priority.ts:108`） |
| 考前收尾 | `remainingDays ≤ 14` | S2 已定义探针降权：`探针在呈现排序中降至任务之后；不自动取消`（`s2-transfer-probe-formal-design.md` §8） |

### H.2 协议

```text
① Score Loss Map        打开最近一次模考的失分清单（不是分数）
② High ROI Weakness     只选"考频高 × 还没掌握"的 3 个以内
③ Timed Training        限时训练（用 ExamSession 的计时；不要用无计时的刷题）
④ Mock                  整卷模考（≥7 天一次，配合教师判分）
⑤ Error Review          按错因分类复盘（不是按题号）
⑥ Final Recovery        从"学更多"切到"减少可恢复失分"
```

### H.3 "从学更多内容切换为减少可恢复失分"

这句话的**产品落地**必须是可判定的，否则只是口号。设计：

| 项 | 考前模式的呈现 | 反向（常规模式） |
|---|---|---|
| 主行动口径 | `修复 1 个高频失分点` | `推进今日任务` |
| 推荐理由 | 必须含考频与失分（`HIGH_RECENT_FREQUENCY` + `EXAM_NEAR`） | 可用薄弱/遗忘 |
| 允许的动作 | 错题重做 / 限时专项 / 模考 / 复习 | 全部五类 |
| 明确禁止 | 新学低频低分节点（若 `recent3Y.frequency < 2`）、长时间看不熟的教材 | 无 |
| 迁移复测降权 | 是（`s2-transfer-probe-formal-design.md` §8 已定义） | 否 |

### H.4 考前协议的诚实边界（必须写给学生）

- 考前**不承诺提分**。可承诺的是："在有限时间里，把注意力放在最可能被捞回的失分上。"
- 若从未模考过，系统无法给出失分地图 —— 必须显式说 `还没有可用的失分地图：需要一次整卷模考或一次教师判分测评。`，而不是显示空图或 0%。
- 预测分在 `gate_passed` 之前**不得**作为考前决策依据（`ScoreAnchorPanel.tsx:25` 的四态语义）。

---
## I. Wrong Behavior Detection（"错误使用系统"的检测设计）

### I.0 判定方法

对任务书 §12 的 10 个模式，逐个给出：**可检测性判定**（`DETECTABLE NOW` = 现有数据+代码足以检测 / `PARTIAL` = 需要代理信号或新遥测 / `NOT DETECTABLE` = 数据结构上不可能）、**所需数据的真实位置**、**当前是否有实现**、**最小实现**。

判定原则：**只有能落到"一个有 `path:line` 的数据源 + 一个可写进 shared 纯函数的规则"的模式，才算 DETECTABLE。** 任何"大概可以推断"的说法一律记为 `PARTIAL` 并写明缺什么。

### I.1 十条逐项

#### 模式 1：连续重复熟题

| 项 | 内容 |
|---|---|
| 可检测性 | **`DETECTABLE NOW`（派生，无需 schema）** |
| 数据 | `PracticeRecord(userId, questionId, submittedAt)`；"首次见到该题"可由**该用户对该 `questionId` 的最早 attempt**派生——S2 形式化设计已明文确认不需要新列（`docs/s2-transfer-probe-formal-design.md` §E.2：*"不需要新列——由该用户对该 questionId 的最早 attempt 派生"*） |
| 当前实现 | **无**。`PracticeRecord` 无 `firstSeen`/`source`（gap report §17-#3）。排序层有"近期降权"（`rankByExamAlignment`）但那是排序，不是检测 |
| 检测规则 | `repeatRatio = |{q : count(user,q,window) ≥ 2}| / |{q : user 在 window 内作答过}|`；window = 7 天。`repeatRatio ≥ 0.5` 且 `distinctNewQuestions < 5` → 命中 |
| 最小实现 | shared 纯函数 `detectRepeatFamiliarity(input)`；输入是既有 `PracticeRecord` 投影（读模型），零迁移 |
| 干扰项（必须排除） | 到期复习的**同源题重做**是设计内行为（SM-2 1/3/7/14 天），**不得计入**。判据：排除 `ReviewAttempt` 链（`review` 天然不在 `PracticeRecord` 内，S2 §11 已由结构保证） |

#### 模式 2：只做简单题

| 项 | 内容 |
|---|---|
| 可检测性 | **`DETECTABLE NOW`** |
| 数据 | `Question.difficulty`（Prisma 枚举 + legacy 中文双词表，归一化函数已存在：`toDifficultyBucket`，`packages/shared/src/transfer-probe/transfer-probe.ts:60-62`） |
| 当前实现 | **无**。`priority.ts:64` 只用 difficulty 加 0.07 权重，从不检测学生的难度选择 |
| 检测规则 | `hardRatio = hard尝试 / 总尝试`；连续 14 天内 `hardRatio == 0` 且 `mediumRatio < 0.3` → 命中（阈值写在纯函数里，可预注册调整） |
| 最小实现 | shared 纯函数 + 今日区域一行提示（§J-2） |
| 诚实边界 | 408 客观题本身以中等难度为主；不能因为学生做基础题就断定"逃避"。**必须同时看"是否只做已掌握节点"**：若 `mastery ≥ 0.75 的节点占尝试 ≥70%` 才判为逃避性刷熟题 |

#### 模式 3：只看解析不作答

| 项 | 内容 |
|---|---|
| 可检测性 | **`PARTIAL`** |
| 数据 | 现状：`answerResult` 只在提交后出现（`PracticePanel.tsx:234` `{!answerResult ? status : null}`），"打开解析"没有独立事件。**可用的近似信号**：`LearningSession.questionIds` 含未提交题（快照存全量题号）→ 可算 `session 未提交率`。已有遥测 `practice.learning_mode_start`（`App.tsx:780`）只证明"进了学习模式"，不证明"看了没答" |
| 当前实现 | **无** |
| 检测规则（可用版） | `abandonRatio = (会话题目数 − 已提交题数) / 会话题目数`；单会话 `≥0.5` 记一次"只看不做" |
| 检测规则（精确版，需新遥测） | 新增前端事件 `practice.explain_viewed`（`TELEMETRY_EVENT_TYPES` +1，见 §S.5）；payload `{questionId, answered:boolean}` |
| 最小实现 | 先用 `abandonRatio`（零遥测）；精确版排在 G4 |
| 注意 | **不得把"看解析"本身当作错误行为**。看解析是学习动作；系统要检测的是"只看看，从不形成作答证据"。措辞必须中立（§J-3） |

#### 模式 4：疯狂刷题但不复测

| 项 | 内容 |
|---|---|
| 可检测性 | **`DETECTABLE NOW`** |
| 数据 | 练习量 = `PracticeRecord` 计数；复测 = `EVIDENCE_RECORDED(detail.kind='transfer_probe')` 计数 + `AssessmentHistoryItem` 计数；两者都在库 |
| 当前实现 | **无**。探针默认关闭（`TRANSFER_PROBE_ENABLED` 未设置 = off） |
| 检测规则 | 过去 14 天：`practiceAttempts ≥ 60` 且 `probeEvidence == 0` 且 `assessments == 0` → 命中 |
| 最小实现 | shared 纯函数 + 今日区域提示（§J-4） |
| 前置依赖 | 探针必须可用（内容池就绪 + `TRANSFER_PROBE_ENABLED=true`）。**若探针不可用，本模式的纠正只能是"去做一次阶段测评"**——必须按可用手段改写文案，不能建议一个做不到的动作 |

#### 模式 5：只追求任务完成率

| 项 | 内容 |
|---|---|
| 可检测性 | **`DETECTABLE NOW`，且系统已经能逐任务判定** |
| 数据 | `StudyTaskCompletion`（完成事实）vs `task-evidence` 的 `insufficient_data`（"任务已完成，但完成标记≠能力证据：任务知识点上没有练习记录"，`packages/shared/src/score-center/task-evidence.ts:114-118`） |
| 当前实现 | **逐任务判定已实现**（`buildTaskEvidence` + `GET /coach/task-evidence` + `TaskEvidencePanel`），**聚合信号不存在** |
| 检测规则 | 过去 14 天：`completedTasks ≥ 3` 且 `insufficient_data 占比 ≥ 0.5` → 命中 |
| 最小实现 | **一次聚合，零新逻辑**：`GET /coach/task-evidence` 已经返回每个任务的 verdict，前端（或后端只读投影）统计占比即可 |
| 设计地位 | **本设计里性价比最高的一条**：它把系统自己已经写好的诚实判定（"完成标记不构成能力证据"）从"报告页的脚注"变成"会被看见的行为信号" |

#### 模式 6：连续跳过 Transfer Probe

| 项 | 内容 |
|---|---|
| 可检测性 | **`DETECTABLE NOW`** |
| 数据 | `RecommendationAction(actionType='TRANSFER_PROBE').status` 的 `expired` 终态（S2 §7 状态机；`TRANSFER_PROBE_WINDOWS.graceDays = 7`，`transfer-probe.ts:33`） |
| 当前实现 | 状态机会写 `expired`；**没有任何聚合，也没有任何学生可见反馈（这是设计内行为）** |
| 检测规则 | 同节点/全仓连续 `expired ≥ 3` 次 |
| **设计边界（关键）** | S2 §7 硬规则：**`probe_expired` 不是失败——不计失败、不进 TransferGap 分母、不产生任何负面学生反馈。** 因此本模式的检测结果**允许**用于：①内容/节奏诊断（为什么学生总在窗口内没做？窗口是否太短？）②在"今日区域"把探针卡提前。**禁止**用于：向学生展示"你已跳过 N 次复测"、施压、扣分、计入任何成就或风险叙事 |
| 最小实现 | 后端只读计数（admin/teacher 面板 + 内部信号），前端只做"提前呈现"，**不做任何负向文案** |

#### 模式 7：频繁要求 AI 直接给答案

| 项 | 内容 |
|---|---|
| 可检测性 | **`PARTIAL`（只能用代理）** |
| 数据 | `tutor.ask` 遥测（`App.tsx:971`，**payload 为空**）；`AiTutorLog` 表存在但**只写不读**（gap report §15）；`ContextualCoach` **零遥测**；`AiTutorLog` 不含 userId 归因的 ai-metrics（`ai-metrics.service.ts:2-40`，内存 60 分钟滑窗） |
| 当前实现 | **无**。`Tutor Mode` 有 Socratic 序列 + 5 类误区检测（既有能力），但那是内容侧，不是行为检测 |
| 检测规则（代理版） | 过去 7 天：`tutor.ask 次数 / 判分作答次数 ≥ 3` → 命中"问得多、做得少" |
| 检测规则（意图版） | 需要把提问内容分类（"直接要答案" vs "问概念"）——属于 LLM/规则分类，**超出本设计范围**，记为 G6 的后续 |
| 最小实现 | 代理版规则 + **不指责学生**的纠正（§J-7）。真正的纠正在于 AI 侧行为（Socratic 优先），不是在于劝阻学生提问 |

#### 模式 8：推荐任务连续失败

| 项 | 内容 |
|---|---|
| 可检测性 | **`DETECTABLE NOW`（数据已计算、零消费）** |
| 数据 | `ActionOutcomeAudit` 聚合 action 后续作答 → `ActionLearningSignal` 判 SUCCESS/PARTIAL/FAILED → 写 `USER_ACTION_FEEDBACK`（`student-state-feedback.repository.ts:50-57`，**只写不读**）；`outcome-tracking` 做 14 天前后对照（`after.attempts < 3 → insufficient_data`） |
| 当前实现 | **零消费**：`priority.ts`/`plan.ts`/`recommendation.service.ts` 都不读这些信号（gap report §7 Q4） |
| 检测规则 | 同 `(nodeId, actionType)` 连续 2 次 outcome ∈ {FAILED} 或 `practiced_no_gain` → 命中 |
| 最小实现 | **引导层先行**（不改排序，排序属于 S3/S4）：命中时把任务卡的下一步改为"换手段"（§J-8），而不是把同一个任务再排一次 |
| 说明 | 本设计**只做纠正，不做降权**。降权是 `score-improvement-reconstruction-design.md` §K 的排序层改动，需独立批准 |

#### 模式 9：掌握度提升但新题表现不提升

| 项 | 内容 |
|---|---|
| 可检测性 | **节点聚合层 `DETECTABLE`；个人层 `NOT DETECTABLE`（诚实结论）** |
| 数据 | `TransferGap(node, kind, bucket) = PracticeAccuracy − TransferRate`（`docs/s2-transfer-probe-formal-design.md` §11）；门禁 `minSampleSize = 5`（`transfer-probe.ts:40-44`） |
| 当前实现 | 投影已实现（`buildTransferProjection`），**教师/管理员专用**（`transfer-probe.service.ts:688-694`），学生端刻意不下发 |
| 关键诚实结论 | **单个学生的单节点样本几乎不可能达到 n≥5**（同一学生同一节点同一桶的探针需要 5 次，而设计规定同节点探针间隔 ≥14 天、`minDaysBetweenProbesPerNode: 14`）→ 因此"掌握度提升但新题不提升"在**个人层永远达不到证据门**，系统**不得**对学生宣称这个判定 |
| 学生层可用信号（降级版） | `该节点练习证据充分（≥5 次）但从未有迁移复测记录` → 状态 `迁移未验证`（§L），而不是"迁移失败" |
| 最小实现 | 学生端只呈现"有没有做过迁移复测"，聚合结论保持 teacher/admin |

#### 模式 10：模考失分集中但学习行为没有改变

| 项 | 内容 |
|---|---|
| 可检测性 | **`DETECTABLE NOW`** |
| 数据 | 模考逐题作答（`LearningSession(paper)` → `PracticeRecord`）+ `nodeLoss`（`exam-diagnosis.ts`）两次模考的失分节点集合 + 两次之间的 `PracticeRecord` 节点集合 |
| 当前实现 | **无**（`ExamDiagnosisPanel` 只做单场归因；`recoveryClosure` 统计"缺口任务完成率"，不是"失分节点是否被练过"） |
| 检测规则 | `两次模考失分节点交集 ∩ 期间练习节点集合 = ∅` 且交集大小 ≥2 → 命中 |
| 最小实现 | shared 纯函数 + 报告页一行 `上次失分的 X、Y 之后你没有练过` + 一键把交集节点转成任务（`generatePostExamReviewTasks` 已存在） |

### I.2 汇总

| 模式 | 判定 | 现在能实现吗 | 归属里程碑 |
|---|---|---|---|
| 1 连续重复熟题 | DETECTABLE NOW | 能（纯派生） | **G4** |
| 2 只做简单题 | DETECTABLE NOW | 能 | **G4** |
| 3 只看解析不作答 | PARTIAL | 代理版能；精确版需 1 个遥测事件 | G4（代理版）/ G4+（精确版） |
| 4 疯狂刷题不复测 | DETECTABLE NOW | 能（依赖探针可用性） | **G4** |
| 5 只追求任务完成率 | DETECTABLE NOW | **能，且判定已存在，只差聚合** | **G4（首选）** |
| 6 连续跳过探针 | DETECTABLE NOW | 能（但**禁止**用于学生侧施压） | G4（内部信号） |
| 7 频繁要答案 | PARTIAL | 代理版能 | G6 |
| 8 推荐任务连续失败 | DETECTABLE NOW | 能（信号已算） | **G4** |
| 9 掌握度↑新题不↑ | 聚合层能 / 个人层不能 | 个人层**不得**宣称 | G5（状态语言） |
| 10 失分集中但行为未变 | DETECTABLE NOW | 能 | G4 |

**结论：10 条里 7 条（模式 1、2、4、5、6、8、10）现在就能检测——判定数据全部已在库，零 schema 变更，但一条都没有实现；模式 3 与模式 7 当前只能用代理信号（模式 3 补 1 个遥测事件后可精确化）；模式 9 在个人层必须诚实放弃（样本门 n≥5 与 14 天探针间隔在数学上互斥）。**

---

## J. Behavioral Guardrails（纠偏设计：Detection → Explanation → Correction → Action → Verification）

### J.0 五段式契约与"接回学习流程"的硬要求

任务书 §13 的硬要求：**不要只弹 Toast，必须把纠偏重新接回学习流程。**

本设计把这句话翻译成可验收的规则：

```text
GUARDRAIL 合格判据（每条都必须满足，缺一即不合格）
G-1  Detection   ：命中条件来自既有数据 + 纯函数（不得由 LLM 判定）
G-2  Explanation ：说明"这为什么不算学习"，且必须引用系统自己的证据语义
G-3  Correction  ：给出**一个**替代动作，且该动作必须是系统里真实存在的入口
G-4  Action      ：该动作必须**可点击并且真的能到达**（有 onClick / deep_link）
G-5  Verification：执行后必须有一个可观测的结果（证据 / verdict / 状态变化）
G-6  Non-blocking：默认不阻断主流程；强提醒仅限 P0 级误区
```

**当前全仓只有 1 条 guardrail 满足 G-1～G-6**：`ExamSession` 的未作答确认（显式列出、可跳题、硬阻断自评缺失，`ExamSession.tsx:516-585`）。
**最接近但失败的是**：`ProactiveCoachCard` —— `headline`（G-2 部分）与 3 条 `actions`（G-3）都有，但渲染为无 `onClick` 的 `<li>`，`actorHint` **前端零消费**（`ProactiveCoachCard.tsx:71-81`）。→ **G-4 失败 ⇒ 整条 guardrail 不成立。**

### J.1 十条 guardrail 设计

下表每条给出**完整五段**。所有 `Correction` 都是既有入口，所有 `Verification` 都是既有可观测结果。

| # | Detection（规则 / 数据） | Explanation（给学生的话） | Correction（一个动作） | Action（真实入口） | Verification |
|---|---|---|---|---|---|
| **1** | `repeatRatio ≥ 0.5` 且 7 天内新题 <5（`PracticeRecord` 派生） | "你最近做的题里有一半是重复的。**重复能提高熟悉度，但不能验证迁移**——熟练和会做新题是两件事。" | 换一组**陌生同构题**（该节点上你从未作答过的题） | `题库 → 同考点训练`（既有 node→question 选题面；探针池题被单点排除，需排除池题后取普通新题） | 产生新的 `PracticeRecord`，且该题在该学生的 attempt 历史中为首次 → `task-evidence` 的 verdict 可更新；同时记录迁移证据（若有探针） |
| **2** | `hardRatio == 0` 且 `mediumRatio < 0.3` 且已掌握节点占比 ≥70% | "你最近做的题集中在已经掌握的考点上。**刷熟的题不会带来新分数**——考频高的陌生考点才是失分来源。" | 做一组"考频高 × 你还没掌握"的题 | `TodayScoreCenter` 的推荐卡（已有 `examValue`/`weakness` 排序）或 `真题强化` 开关（`PracticePanel.tsx:253-268`） | 新的作答落在 `mastery < 0.55` 的节点上（可按 `UserKnowledgeMastery` 判定） |
| **3** | `abandonRatio ≥ 0.5`（单会话未提交率） | "这一组题你只看了解析，没有提交作答。**阅读不会自动产生掌握证据**——系统只承认被判分的作答。" | 把未提交的题做完（回到同一会话继续） | `ResumeSessionBanner`（`ResumeSessionBanner.tsx:52-79`，已有"继续"入口 + 断点恢复） | 会话提交 → `PracticeRecord` 落库 → `EVIDENCE_RECORDED(strength='strong')`（`learning-evidence.ts:147-193`） |
| **4** | 14 天 `practiceAttempts ≥ 60` 且 `probeEvidence == 0` 且 `assessments == 0` | "你已经练了很多题，但还没有做过任何**测量**。练习告诉你'做过'，测量才告诉你'会不会'。" | 做一次阶段测评；若探针可用则先做迁移复测 | `测试 → 阶段测评`（`StageAssessmentPanel`，`assessment.generate` 遥测已有）或探针卡 | `AssessmentHistoryItem` 新增一行 / `transfer_probe` 证据新增一条 |
| **5** | `completedTasks ≥ 3` 且 `insufficient_data 占比 ≥ 0.5`（`task-evidence` 聚合） | "你有 N 个任务打了完成标记，但对应的知识点上没有作答记录。**完成标记不等于能力提升**。"（后半句逐字复用 `task-evidence.ts:117`） | 挑其中 1 个任务，在其知识点上做 3 道判分题 | 任务卡 → 该任务的 `questionIds` / 节点练习入口 | 该任务的 verdict 从 `insufficient_data` 变为 `practiced`/`improved`（`task-evidence.ts:104-143`） |
| **6** | 连续 `expired ≥ 3`（探针 Action 终态） | **不给学生任何负向文案**（S2 §7 硬规则）。内部信号用于：①把探针卡从报告页搬到今日区域 ②诊断窗口是否过短 | （系统侧动作）调整投递位置/时机 | 今日区域的探针卡（`TransferProbeCard` 移到 `TodayMission` 邻位） | 下一次探针在窗内被提交（`transfer_probe` 证据出现） |
| **7** | 7 天 `tutor.ask / 判分作答 ≥ 3` | "你问得很多、练得少。**AI 的解释是输入，不是证据**；先自己写一步，再问比一次问到底更有用。" | 用"先给提示，再自己完成"的提问方式 | `AI 答疑` 的 `分层提示`（`TutorPanel.tsx:84-103`，既有四层提示）与 Tutor Mode 的 Socratic 序列 | 提问后出现该题/该节点的作答记录 |
| **8** | 同 `(nodeId, actionType)` 连续 2 次 FAILED 或 `practiced_no_gain` | "这个方式连续两次没有带来提升。**不是你的问题，是手段不匹配**——换一种。 " | 换干预手段（按 `MISTAKE_SUGGESTIONS` 的 8 类映射，`packages/shared/src/learning.ts:33-42`） | 错题本的重做 / 变式入口，或重新生成的任务 | 新的 verdict 不再是 `practiced_no_gain`；或 `outcome-tracking` 的 14 天对照改善 |
| **9** | 节点练习证据达门（≥5 次）但该节点探针证据 = 0 | "这个考点你已经练了 N 次、证据充分。但**练习证据只说明同源题做得好，不说明新题会做**。" | 做一次迁移复测（约 5 分钟） | 探针卡（`TransferProbeCard`；若 `no_probe_available` 则诚实说明"暂时没有合格的新题，系统不会拿旧题冒充迁移测试"） | `transfer_probe` 证据新增；学生端只标"迁移已验证/未通过"，不显示聚合率 |
| **10** | 两次模考失分节点交集 ≥2 且期间未练过交集节点 | "上次模考丢分的 X、Y，这周你没有练过它们。**失分不会自己消失**。" | 把交集节点转成任务 | 报告页 `生成考后复习任务`（既有，`ExamDiagnosisPanel.tsx:101` 已指向它） | 期间出现交集节点的 `PracticeRecord`；下次模考的 `nodeLoss` 交集缩小 |

### J.2 强提醒 vs 软提醒的分配（任务书 §30 不过度打扰）

| 级别 | 适用 guardrail | 呈现 | 理由 |
|---|---|---|---|
| **强提醒（P0 级误区）** | #5（完成≠学会，聚合占比 ≥0.5）、#3（只看不作答） | 卡片（非模态）+ 在**今日区域**常驻至被处理；不阻断任何流程 | 这两条直接对应"活动被误当学习"的宪法级风险 |
| **软提醒（内联）** | #1、#2、#8、#9、#10 | 内联在相关卡片内（任务卡 / 练习结论卡 / 报告卡），或 `<details>` 内 | 都是"改进建议"，不是"错误" |
| **静默（仅内部信号）** | #6 | 不给学生文案 | S2 §7 硬规则：过期不算失败 |
| **仅代理提示** | #4、#7 | 今日区域一行 + 一个 CTA | 判据是代理，不能当作确定错误 |

### J.3 语气与禁词

`apps/api/src/study/sprite-persona.ts` 已经实现了宪法级的禁词校验（`docs/current-sprint.md` V10-0/V10-1 条目：80% 鼓励 / 60% 严格 / 30% 幽默，**禁鸡汤/PUA/焦虑/罪感化**）。本设计**复用**该校验器，并追加 3 条 guardrail 专属禁词：

```text
禁止："你落后了" / "你又错了" / "别人已经…" / "再这样就来不及了"
禁止：把活动量（题数/天数/连击）当作成就向学生展示为"进步"
禁止：在 insufficient_data 状态下使用任何形式的"目前表现不佳"
必用：区分"你没做"与"系统还不能判断"（后者不是学生的问题）
```

### J.4 不做什么

- **不做行为阻挡**：唯一允许的硬阻断是既有的"未作答就交卷"确认（`ExamSession.tsx:516`）与"综合题缺自评"阻断（`:577`），本设计不新增任何阻断。
- **不做强制复测**：探针过期中性处理（S2 §7）；任务不完成不惩罚。
- **不做扣分/降级**：纠偏不改变任何掌握度、分数、排序（排序改动属 S3/S4）。
- **不做 Toast-only**：任何无 `onClick` 的提醒都不允许上线（G-4 验收）。

---

## K. Recommendation Explanation（"为什么推荐"设计）

### K.1 五问契约（任务书 §14）

每个重要 Recommendation 必须能回答五个问题。下表给出**每问的数据来源与当前状态**：

| 问题 | 需要的输入 | 现有数据（path:line） | 现状 |
|---|---|---|---|
| **Why now?**（为什么是现在） | 时间相位、到期状态、遗忘度 | `phaseMultipliers(daysToExam)`（`priority.ts:31-35`）；`forgetting ≥ 0.55`（`priority.ts:106`）；`EXAM_NEAR`（`:108`） | ✅ 数据有；**理由码会被凑数污染** |
| **Why this node?**（为什么是这个考点） | 考频、真题分值、当前掌握度、错题数 | `examValue = 0.38×(recent3Y/5) + 0.3×(recent5Y/5) + 0.16×(allTime/5) + 0.1×(importance/5) + 0.06×(primaryScore5y/45)`（`priority.ts:44-50`）；`weakness = 0.52(1−mastery) + 0.38(1−recentAccuracy) + 0.1×min(1,wrongCount/8)`（`:55-58`） | ✅ 6 因子 `breakdown` 已持久化并下发（`WhyRecommendedDrawer.tsx:40-47`） |
| **Why this action?**（为什么是练/复习/新学/模考） | `classifyAction` 五分支 | `recentWrongCount≥2→错题重做`；`forgetting≥0.55→复习`；`mastery<0.45→新学`；`recentAccuracy<0.7→练习`；`daysToExam≤45 且 mastery≥0.75→模考`（`plan.ts:36-43`） | ⚠️ 逻辑存在，**从未对学生解释过**——学生只知道"系统让我错题重做" |
| **What expected outcome?**（预期结果） | 期望提分 / 期望能力变化 | **不存在分数量纲**（gap report §5：生产无 Expected Score Loss 模型）；`estimatePredictedScore` 是启发式插值且含 timeFactor artifact | ❌ **MISSING** → 必须诚实回答"不能预计提分"，而不是编造区间（任务书 §14 明文禁止） |
| **How will we verify?**（怎么验证） | 验证协议 | `task-evidence` verdict 四态（`task-evidence.ts:104-143`）；证据门（`effectiveness.assembly.ts:62-70`）；探针（`transfer-probe.ts:40-44`） | ✅ **机制全有**，但**从未出现在推荐卡上** |

### K.2 设计：推荐解释卡的五段式

**目标形态**（逐字段对应真实数据，禁止新造）：

```text
推荐你今天训练「二叉树遍历」（约 25 分钟 · 8 题）

WHY NOW
  距离考试 96 天，进入强化期；这个考点今天到期复习（遗忘度 0.62）。

WHY THIS NODE
  近 3 年考了 4 次（高频）· 你目前的掌握度 0.41（薄弱）· 你在这道题所在
  考点上错过 3 次。系统给出的学习优先级：中（58/100，今日第 3 位）。

WHY THIS ACTION
  因为你在该考点上错过 ≥2 次，系统选择了"错题重做"而不是"继续刷新题"。

WHAT WE EXPECT（诚实条款）
  不能预计你能提高几分——系统还没有可标定的失分模型。
  可以承诺的是：这会形成一条判分练习证据；若证据足够，会触发一次迁移复测。

HOW WE VERIFY
  完成后系统会看：①该考点上是否出现新的判分作答 ②掌握度是否上升
  ③（若证据 ≥5 次）是否通过了迁移复测。
  判定结果会直接写在这里，包含"证据不足"的可能。
```

### K.3 三条必改（对应 §C-B 与 §C-I）

| # | 改动 | 性质 | 影响面 |
|---|---|---|---|
| **K-1** | **拆掉理由码凑数**：`buildReasons` 区分 `triggered` 与 `fallback`。最小实现：`PriorityResult` 增量返回 `reasons: PriorityReasonCode[]`（真实触发）与 `fallbackReasons: PriorityReasonCode[]`（凑数），或给每条 reason 带 `triggered: boolean`。**`score` 计算零改动** | 共享层纯增量（契约允许） | `priority.ts` 的返回结构 + 两个消费点（`nodePlan.ts:123`、`recommendation.service.ts:245,318`） |
| **K-2** | **停止把英文码当学生文案**：`recommendation.service.ts:245,318` 直接 `join('、')` 下发英文码；应统一走 `REASON_LABELS`（`nodePlan.ts:41-51`）。并且 `\|\| \`recommendation:${draft.action}\``（`:318`）这个机器兜底字符串**绝不能**到达学生面前 | 后端字符串变更（不改结构） | `recommendation.service.ts` |
| **K-3** | **`Priority Score` 必须有刻度含义或消失**：`WhyRecommendedDrawer.tsx:33` 现在打印 `Priority Score：58`。改为有意义的表述：`学习优先级：中（58/100，今日第 3 位）`；同时把 `Math.round(breakdown[key] ?? 0)`（`:44`）改为在缺失时显示 `—` 而不是 `0` | 前端 | `WhyRecommendedDrawer.tsx` |

### K.4 禁止条款

- **禁止**在没有失分模型时给出"做完能提高 X 分"（任务书 §14 明文）。
- **禁止**展示 `LOW_EVIDENCE`（`个人数据较少，当前为冷启动建议`）之外的任何"预测"措辞；`LOW_EVIDENCE` 必须与 `NEUTRAL_MASTERY` 的诚实语义绑定 —— 注意后端目前把 `NEUTRAL_MASTERY = {mastery:0.5, accuracy:0.55, attempts:0}`（`apps/api/src/score-center/repository.ts:34-41`）当作学生状态注入（`recommendation.service.ts:146`）并作为 `facts.mastery` 下发（`recommendation.ts:141-146`）；**这是"未知被当成 0.5 的测量值"**，必须在文案层显式标注"未测量（按中性值参与排序）"，否则 §C-F 的混淆会从掌握度页蔓延到推荐页。
- **禁止**在推荐层使用 `overallAccuracyRate = 55`（`recommendation.service.ts:207`，attempts==0 时的发明值）作为任何学生可见数字；`remainingDays ?? 96`（`:117`）同理。

---

## L. Mastery Explanation（掌握度教育：把 0.67 翻译成人话）

### L.1 现状问题

`mastery` 以裸百分比出现在 ≥9 处（§C-F 已列）。系统的显示层只做两件事：取整（`displayFormat.ts:7-9`）与状态词（`薄弱/巩固/掌握`）。**没有任何一处解释它预测什么、不预测什么。** 同时 `confidence` 字段的定义是纯样本量函数 —— `Math.min(1, 1 − Math.exp(−(attempts+1)/12))`（`packages/shared/src/score-center/mastery.ts:44`），attempts≈8 就到 0.5+，**与预测质量无关**（gap report False Confidence #9）。`GET /knowledge/mastery` **根本不返回 confidence**（`apps/api/src/score-center/service.ts:459-491`），而 `GET /knowledge/:id` 返回（`:374`）——同一产品内部不一致。

### L.2 状态语言（任务书 §22）→ 真实可判定条件

任务书给出的 8 级状态链必须**每一级都有可判定的条件**，否则不得展示。判定全部来自既有数据：

| 状态 | 判定条件（全部引用既有数据） | 学生语言 |
|---|---|---|
| **未测量** | `UserKnowledgeMastery` 无行，或 `attempts == 0`（`NEUTRAL_MASTERY` 命中） | "还没有足够证据判断这个考点的水平。" |
| **正在学习** | `attempts ≥ 1` 且 `attempts < 5` | "刚开始积累证据（N 次作答）——现在下结论太早。" |
| **已有练习证据** | `attempts ≥ 5`（`EVIDENCE_GATE.minSampleSize`，`effectiveness.assembly.ts:67`）且未通过 effect gate | "练习证据够了（N 次），但还看不出稳定变化。" |
| **初步掌握** | effect gate 通过（`minSampleSize 5` + `minEffectSize 0.05` + `confidence ≥ medium`，`:62-70`） | "基础题表现稳定。" |
| **迁移未验证** | 初步掌握 **且** 该节点 `transfer_probe` 证据数 == 0 | "练习证据充分，但**新题会不会做还没验证**。" |
| **迁移已验证** | 该节点存在 `transfer_probe` 证据且结果正确（个人事件层，不是聚合率） | "你已经在一道陌生新题上做对了——方法迁移成立。" |
| **考试表现已验证** | 存在 `ScoreOutcome`（`verificationStatus='verified'`）或教师判分 `ScoreAssessment` 覆盖到该节点 | "有真实判分数据支持这个考点的表现。" |
| **稳定掌握** | 迁移已验证 **且** 迁移验证后 14 天内再有 ≥1 次判分作答且未失败 | "方法稳定，保持节奏即可。" |

**关键设计约束**：
- 上表**不新增任何计算**，全部是既有字段的组合判定。
- **`confidence` 不得被称为"置信度"**：`learning-evidence` 与探针层已经给出正确命名纪律（`sampleConfidence` + 明写"样本量置信，反映样本多少，**不是**预测质量"，`transfer-probe.ts:39-44` 与形式化设计 §12）。本设计要求**全仓统一**：所有学生可见的 `confidence` 一律改称 `样本量`，并在 tooltip/说明中写明公式语义。

### L.3 展示规则（硬约束）

```text
R-L1  任何出现 mastery 数值的地方，必须同时出现该状态链中的状态词。
      禁止只显示 "掌握度 67%"。

R-L2  任何 mastery 出现处，必须常驻一句边界声明：
      "这是练习证据强度，不是考试分数。"（或等价的一句）
      禁止将 mastery 与预测分放在同一视觉层级而无区分。

R-L3  mastery 缺少测量时必须显示"未测量"，禁止 `?? 0`。
      （点名：mastery-summary-projection.service.ts:310-312 的
       `averageMastery: ... : 0` 与 overview-report-projection.service.ts:362 的
       `null` 语义冲突，必须统一为 null。）

R-L4  禁止把 mastery 命名为"正确率"或与正确率并列而无数值口径区分。
      （正确率 = 观测频率；mastery = EMA 推断。两者是不同的量。）
```

### L.4 一处必须写进 UI 的效度声明（逐字）

以下三条是 gap report 已证实的效度威胁，学生不需要知道全部细节，但**至少要知道它们存在**，否则"掌握度 80% = 考研 80 分"的误解无法被自然纠正：

| 威胁 | 学生可见的一句话 |
|---|---|
| EMA 方向瞬态 | "掌握度是趋势量。**偶尔会出现'答错了分数反而升高'，因为它在追踪这个考点的整体水平，不是单题对错。**" |
| 主观题自评污染 | "综合题目前由你自评（≥0.6 记对），所以**大题的掌握度会有自评噪声**。" |
| 中性先验 0.5 | "**没练过的考点按中性值参与排序，不代表它真的中等薄弱。**"（此句已在 `WhyRecommendedDrawer.tsx:48-50` 存在，但需要绑定到具体条件而非恒定显示） |

---

## M. Evidence Explanation（证据教育）

### M.1 现状：最优秀的一层资产，位置最差

证据语义已经完整实现并且已经学生化：

| 层 | 契约（path:line） | 学生文案（path:line） |
|---|---|---|
| 动作类型 | `LearningActionType = practice.answered \| task.completed \| review.marked \| review.recalled \| assessment.submitted`（`learning-evidence.ts:28-33`） | `练习作答 / 任务完成 / 标记已复习 / 复习重做 / 测评提交`（`LearningEvidenceLedger.tsx:95-110`） |
| 证据种类 | `EvidenceKind = none \| self_reported \| recall_outcome \| objective_performance`（`:41`） | — |
| 证据强度 | `EvidenceStrength = none \| weak \| strong`（`:43`） | `观测证据 / 自评证据 / 仅活动`（`:113-115`） |
| 是否可影响掌握度 | `canInfluenceMastery` 仅对 objective/recall 为 true（`:147-193`） | `（不作为能力依据）`（`:128`） |
| 拒绝判断 | — | `没有可支撑能力推断的观测证据，系统拒绝据此判断能力变化。`（`:72`） |
| 逐任务判定 | `verdict = improved \| practiced \| practiced_no_gain \| insufficient_data`（`task-evidence.ts:55`） | `能力提升 / 已练习 / 已练习·未见提升 / 证据不足`（`TaskEvidencePanel.tsx:53`） |

问题只有两个：**①它在报告页（第三个 nav 区里）；②`null` 在别处被画成 `0`，抵消了它的诚实。**

### M.2 "活动 ≠ 证据"的教育设计

任务书 §16 要求三件事：①`完成任务` 只能显示"任务完成"；②能展示 Strong/Weak/Insufficient；③解释每一种是什么意思。

**设计（复用既有词汇，不造新词）**：

| 学生看到的标签 | 对应的真实契约 | 一句话解释（学生语言） | 典型场景 |
|---|---|---|---|
| **观测证据** | `strength='strong'`，`kind ∈ {objective_performance, recall_outcome}`，`canInfluenceMastery=true` | "系统观测到了你的作答结果。**只有这一种能支撑能力判断。**" | 判分练习、复习重做、测评提交 |
| **自评证据** | `strength='weak'`，`kind='self_reported'` | "这是你填写的数字，系统没有验证。**会被记录，但不会作为能力依据。**" | 手动标记任务完成并自报题数/正确数（`taskCompletionDraft.ts`） |
| **仅活动** | `strength='none'`，`kind='none'` | "发生了动作，但没有观测到任何表现。**'做了'和'会了'是两件事。**" | 标记已复习（`review.marked`）、任务完成标记 |
| **证据不足** | verdict `insufficient_data`（`task-evidence.ts:111,114`） | "现在还不能判断。**这不是'没进步'，是'还不能证明'。**"（逐字复用 `EffectivenessPanel.tsx:144`） | 完成任务但该节点 0 次练习 |

### M.3 位置改造（本设计的主体工作）

| 时刻 | 要求 | 数据来源（零新逻辑） |
|---|---|---|
| 答完一题 | 在结果卡内标出这一条记录的证据强度 | `EVIDENCE_RECORDED` 的 `strength`（提交事务内已写） |
| 做完一组 | 在训练结论卡内标出"本组形成了 N 条观测证据" | 同上，按 session 聚合 |
| 完成任务 | 在任务完成态显示 verdict 与 `verdictBasis` | `task-evidence.ts` 的 `verdictBasis`（字符串已生成） |
| 每天结束 | 今日证据小结（N 条观测 / M 条仅活动 / 拒绝判断提示） | `buildDailyBrief` 的 `followUpNote` 位 + 台账 summary |
| 报告页 | 保留全量台账（现状即为正确形态） | `LearningEvidenceLedger` |

**验收**：在**不打开报告页**的前提下，学生必须至少一次看到"观测证据 / 自评证据 / 仅活动"三词中的两个，以及"完成不构成能力证据"这句话。

---

## N. Transfer Explanation（迁移探针教育）

### N.1 现状

侧栏（学生端）已实现且文案诚实（`TransferProbeCard.tsx:101,132-133,141,150`）；聚合数值刻意不下发（`transfer-probe.service.ts:688-694`；`transferRate` 在门下为 `null`，`transfer-probe.ts:252`）。**问题：默认关闭 + 挂错位置 + 无 NEXT + 首次出现无解释。**

补充两个后端事实（本设计必须处理）：
- 探针自身的诚实 `note`（`authoritative:false` 及解释，`transfer-probe.service.ts:660-661`）**不可达**：`fetchTransferObservation` 在 web 端**零调用点**（`apps/web/src/api/endpoints/transferProbe.ts` 只导出 due-probes 相关）。→ 学生端的"个人事件 + 门禁状态"视图实际上没有接入。
- `GET /coach/transfer-probes` 的响应**本身没有任何免责声明字段**。

### N.2 首次出现的解释（任务书 §17）

```text
【首次遇到迁移复测时，一次性说明，之后不再重复】
这不是普通刷题，而是一次"陌生题迁移测试"。

为什么要有它：练熟题的正确率高，可能来自"我记得这道题"。
要确认你真的会，只能用一道你从没见过的题来测。

怎么做才算有效：不看解析、一次提交、约 5 分钟内完成。

它会告诉你什么：
  答对 → 你的方法迁移到了新题上。
  答错 → 不是失败，而是发现"练习正确 ≠ 新题会做"——
        这是系统最想帮你找到的问题。
  没有合格新题 → 系统会直说，不会拿旧题冒充迁移测试。
```

### N.3 结果页必须写明的三句话（任务书 §17 末）

```text
你刚才测的是：能否把已有方法应用到陌生题。

（答对）结果：这次迁移通过。
（答错）结果：这次迁移未通过 —— 已加入错题复盘；下次干预后会有新的复测。
（无题可用）结果：本次没有合格的新题，测量作废且不计入任何统计。
```

### N.4 禁止条款

- **禁止**把 `TransferRate` 包装成"最终分数提升"（任务书 §17 末句）。
- **禁止**在学生端展示 `transferRate` / `transferGap` / `sampleConfidence` 数值（S2 已确立；`transfer-probe.service.ts:688-694`）。
- **禁止**把过期包装成失败（`probe_expired` 硬规则，S2 §7）。
- **禁止**在没有合格新题时降级用旧题（`no_probe_available` 是显式终态，S2 §17）。

### N.5 位置改造

| 现状 | 改造 |
|---|---|
| 只在 `ReportWorkspace` 总览 tab（`ReportWorkspace.tsx:124`） | ①**今日区域**新增探针卡位（行为发生地）②报告页保留"历史复测记录" |
| 开关默认 OFF（`TRANSFER_PROBE_ENABLED` 未设置） | **不由本设计开启**。本设计只要求：当探针不可用时，相关文案（§G.3、§J-9）必须**诚实说明不可用**，而不是显示空卡或假装可用 |
| 无 NEXT | 结果页补 NEXT（§N.3） |
| `transferObservation` 端点无前端消费者 | G5 接入（只读，个人事件 + 门禁状态；**不含聚合值**） |

---

## O. Assessment Explanation（模考 / 测评教育）

### O.1 必须写进 UI 的一句话（任务书 §18）

```text
模考不是学习任务，模考是测量工具。
它的价值是发现真实失分，而不是让分数好看。
```

放置位置：①模考配置面板顶部（`StudentLaunchpad.tsx:224-227` 的 `panel-heading` 之后）②`ExamSession` 起始页 ③`ExamReport` 顶部。

### O.2 三类测量的语义分层（学生必须能区分）

| 类型 | 载体 | 语义（学生语言） | 现有口径声明 |
|---|---|---|---|
| **阶段测评** | `StageAssessmentPanel` / `stage_assessment` 会话 | "查一个阶段的覆盖情况" | `assessmentStatus` 文本 |
| **整卷模考** | `ExamSession(sessionType='paper')` | "按考试形态测一次，目的是找失分" | `ExamDiagnosisPanel` 的 `估算` 徽标（`exam-diagnosis.ts:149,165,211` 的 `（估算）` 括号） |
| **真实成绩** | `ScoreOutcome`（教师判分/外部导入） | "已发生的成绩事实" | `ScoreAnchorPanel` 的 `· 已验证 / · 待验证`（`ScoreAnchorPanel.tsx:213-216`） |

**当前缺口**：`student` 角色看不到任何"预测分不等于真实成绩"的完整声明 —— 该声明是 `teacher/admin` 专属（`score-calibration.ts:64,296` 在 `@Roles('teacher','admin')` 之后，`daily-brief.controller.ts:332-334`）。学生只拿到 `（估算）` 括号。**本设计要求**：把该声明的**学生版**（一句）放到所有出现预测分的位置。

### O.3 模考的"何时做 / 做完看什么"（HOW）

| 项 | 内容 |
|---|---|
| 何时模考 | ①一个阶段收尾 ②距上次模考 ≥14 天 ③考前 45 天内每 7–10 天一次（与 `priority.ts:32` 的相位切换一致） |
| 做完先看什么 | ①`失分知识点`（按 丢题数 × 考频 排序）②`恢复计划闭环 a/b`③最后才是分数 |
| 综合题怎么答 | `评分点将在确认交卷时展示，由你自行核对评分。`（`ExamSession.tsx:401` 已有）+ **必须补一句**："目前没有采分点内容，综合题分数由你自评——这会让大题的掌握度带自评噪声。"（对应 gap report B-F4：rubric 生产 0 行） |
| 交卷前 | 使用未作答清单（`ExamSession.tsx:528-531` 已有 + 可跳题） |
| 做完之后 | 走 §D 第 2 步 → 生成考后复习任务 → 走 §D 第 7 步 |

### O.4 测评结果"不能被解读成什么"

| 禁止解读 | 必须显示的替代说明 |
|---|---|
| "模考 96 分 = 我考试能得 96 分" | "这是本次模考的正确率折算（客观题精确匹配 + 主观题自评），是**估算**。" |
| "两次测评分数上升 = 我进步了" | "两次测评之间题目不同、难度可能不同；**趋势需要 ≥2 次同口径测评**（`StageReportPanel.tsx:48` 已有 `暂无两次以上测评记录`）。" |
| "阶段测评分数下降 = 我退步了" | "单次测评波动大于信号；结合 `nodeLoss` 看具体失分点。" |

---

## P. Score Explanation（分数教育：预测 / 测评 / 真实结果）

### P.1 三层分账（任务书 §19）

S1 已经在**数据结构**上做对了这件事，而且是构造性隔离：

| 层 | 表 / 端点 | 学生可见字段 | 语义标签 |
|---|---|---|---|
| **预测** | `ScorePrediction`（`@@unique([userId, predictionKey])`）→ `GET /coach/score-evidence` 的 `predictions[]`（`score-anchor.service.ts:663,686,706`，`kind:'prediction'`） | `predictedScore`, `predictedMinScore/MaxScore`, `modelVersion`, `generatedAt` | **`系统预测（估算，不是成绩）`**（`ScoreAnchorPanel.tsx:134`） |
| **测评** | `ScoreAssessment`（`@@unique([userId, originType, originId])`） | `normalizedScore`, `source`, `semantic`, `examDate`, `corrected` | **来源徽标 + `正确率口径` 标注**（`:199-205`） |
| **真实结果** | `ScoreOutcome`（`@@unique([userId, dedupKey])`） | `normalizedScore`, `examType`, `verificationStatus` | **`· 已验证 / · 待验证`**（`:213-216`） |

配套守卫（已实现）：学生自称 `TEACHER_GRADED` → **403**（`score-anchor.service.ts:171-173`）；未来 `examDate` → **400**（`:176-182`）；provenance 跟随实际操作者（`:170`）；未验证 outcome 被排除并标 `outcome_unverified`（`:538`）。

### P.2 "学生必须能看到：数据来源 / 评分方式 / 更新时间"（任务书 §19）

| 要求 | 现状 | 差距 |
|---|---|---|
| 数据来源 | ✅ 来源徽标七值（`ScoreAnchorPanel.tsx:12-21`） | 无（已达标） |
| 评分方式 | ⚠️ 部分：`· 正确率口径`（`semantic === 'accuracy_rate'`，`:203`） | 缺少"客观题精确匹配 + 主观题自评"的口径说明句 |
| 更新时间 | ✅ `formatDate(row.generatedAt)` / `examDate` / `occurredAt` | 无（已达标） |
| **口径统一** | ❌ 同一屏存在未标注口径的裸分：`StudentLaunchpad.tsx:251` `本次模拟：{score} 分`；`StudentProgressOverview.tsx:192` 的预测区间 | **必须**统一到 `ScoreKind` 徽标 |

### P.3 设计：统一 `ScoreKind` 徽标（纯前端 + 复用 S1 字段）

```text
[预测·估算]  96–104 分   · 系统预测 · 生成于 09-11 · 模型 v1
[本次测评]  87 / 150    · 系统模考（客观精确匹配 + 主观自评）· 09-05 · 正确率口径
[成绩·待验证] 96 / 150  · 外部导入 · 考试日 08-20
[成绩·已验证] 96 / 150  · 教师判分 · 考试日 08-20
```

**硬约束**：
- **R-P1** 任何分数出现处必须带 `ScoreKind` 徽标；无徽标的裸分禁止上线。
- **R-P2** 预测分在 `calibrationEvidence.status !== 'gate_passed'` 时，**必须**同时显示四态中的当前态文字（`ScoreAnchorPanel.tsx:23-28` 已定义，逐字复用）。
- **R-P3** `User.examDate` 已有列但**全仓无写入方**（`prisma/schema.prisma:160` + 迁移 `20260912120000_score_anchor_foundation`）。学生端文案已诚实（`未设置（可在个人信息中录入…）`，`ScoreAnchorPanel.tsx:112`），但**"可在个人信息中录入"这句话当前不成立** —— 录入入口不存在。**必须**要么补录入入口（S1 范围的收尾），要么把文案改为"请联系教师/管理员录入"。**不得让 UI 宣称一个做不到的操作。**

### P.4 分数教育的"预期管理"三句话

```text
① 预计分 ≠ 实际分。系统在你没有真实成绩之前，不会给你一个假的确切数字。
② 系统要建立可信的分数锚点，需要：一次教师判分（或采分点评分）的整卷，或一次外部成绩录入。
③ 校准只有在该来源达到预注册门槛（每组 ≥5 对、中位误差 <15 分）之后才算通过。
   在那之前，你看到的都只是"初步证据"。
```

（第 ③ 句的全部数字来自 `ScoreAnchorPanel.tsx:25`，不新造。）

---
## Q. AI Coach Protocol（AI Coach 使用协议）

### Q.1 角色重定义（任务书 §20）

```text
不要：问什么答什么（问答机）
要：  Diagnose → Explain → Propose Action → Execute → Verify（教练）
```

**当前实现的真实能力边界**（全部有代码依据）：

| 能力 | 现状 | 证据 |
|---|---|---|
| Diagnose | ⚠️ 部分。上下文注入真实（goal / 掌握度摘要 / 前 3 薄弱点 / 今日任务 / 错题史 / 考频 / RAG 节点） | gap report §15；`contextual-coach-context-assembler.service.ts:151-188` |
| Explain | ✅ 真实 | RAG grounded，且系统 prompt 允许解释 |
| Propose Action | ⚠️ **只有文本，没有动作身份**：`nextActions: string[]`（`contextual-coach.types.ts:57`）；`reviewCards[].id` 是合成 slug | 同左 |
| **Execute** | ❌ **被 prompt 明确禁止**：`你不能修改学习计划。你不能创建学习任务。你不能修改掌握度。你不能安排复习。你不能写入系统。绝不能声称这些事情已经发生。`（`contextual-coach.prompt.ts:9`）；`nextActions 禁止出现 create task / update plan / modify mastery / schedule review 等执行性动作`（`:13`） | 同左 |
| Verify | ❌ **完全缺失**：AI 建议后学生是否变好，系统既不追踪也不反馈；`recordLearningOutcomeDelta`（`apps/api/src/ai-metrics/ai-metrics.service.ts:131`）**全仓零调用** | gap report §15 |

**结论**：AI Coach 是"会解释、不会做、不追踪"的教练。**本协议不改变这个边界**（改变它需要写权限与审批，超出范围），而是**把它变成一个诚实的、可追踪的"提议者"**。

### Q.2 "我今天学什么"的正确应答格式（任务书 §20）

当学生问"我今天学什么"时，AI 必须优先给出四段式，而不是长文：

```text
ACTION（要做什么）
  做「二叉树遍历」的 8 道题，约 25 分钟。
  [开始]   ← 这是 deep_link，不是文字

REASON（为什么）
  近 3 年考了 4 次 · 你当前掌握度 0.41 · 你在这个考点错过 3 次。
  （数据来源：今日计划 + 掌握度 + 错题记录）

EXPECTED OUTCOME（预期结果）
  不能预计提高几分——系统还没有可标定的失分模型。
  会形成一条判分练习证据；若证据足够，会触发一次迁移复测。

VERIFICATION（怎么验证）
  完成后系统会看：①该考点是否出现新的判分作答 ②掌握度是否上升
  ③（证据 ≥5 次时）是否通过迁移复测。结果会写回这里。
```

**硬约束**：
- **R-Q1** 四段式的 `ACTION` 必须是**既有 canonical 动作**的深链（复用 `SpriteWidget` 已验证的 `line.action.kind='deep_link'` 机制，`sprite-state.ts:68-72`），**不新增 AI 可执行权限**。
- **R-Q2** `EXPECTED OUTCOME` 在无失分模型时**必须**写"不能预计提高几分"（任务书 §14 禁止编造）。
- **R-Q3** `VERIFICATION` 必须引用既有判定契约（`task-evidence` verdict / 证据门 / 探针门），不得自造标准。
- **R-Q4** 长文默认折叠：优先给四段式；解释放 `<details>`。

### Q.3 AI Coach 的错误行为检测（任务书 §21）

| 模式 | 检测（可用数据） | 纠正设计 |
|---|---|---|
| **直接索取答案** | 判据需要提问意图分类（LLM/规则）→ 当前 `NOT DETECTABLE`。**代理**：`tutor.ask` 后无同题作答 | 不劝阻提问。改为**行为侧**改变默认：AI 默认先给**分层提示**（`TutorPanel.tsx:84-103` 已有四层提示）而不是完整答案；回复内提供 `先给我一个提示` 快捷入口。**"先给提示，再让你自己完成"由默认行为实现，而不是由告诫实现** |
| **只阅读解析** | 无独立事件 → 需 `practice.explain_viewed`（§S.5） | 回复末尾固定一句：`阅读不会自动产生掌握证据；要形成证据，需要一次判分作答。`（复用证据语义）并给同节点练习深链 |
| **反复问同一知识点** | ⚠️ `tutor.ask` 有遥测但**payload 为空**；`AiTutorLog` 只写不读；`ContextualCoach` 零遥测。**当前不可按节点归因** | ①先补遥测（把 `knowledgeNodeId` / `questionId` 放进 payload —— 响应里**已有** `contextType` + `contextId`，`contextual-coach.types.ts:60-73`，只是没被上报）；②检出后 AI 首句改为**归因问句**：`是概念不清楚、方法不会用，还是书写表达扣分？`，然后按答案转成行动（概念 → 看该节点概念卡；方法 → 做一道变式；表达 → 走 rubric 分步自查）。**禁止**把"反复问"当作学生的错 |

### Q.4 AI 侧的统一声明（三处一致）

| 面 | 必须显示的声明 |
|---|---|
| `TutorPanel` | 已有：`AI 解释仅作辅助，最终以标准答案、标准解析和教师审核内容为准。`（`TutorPanel.tsx:62`）→ **追加**：`阅读解释不产生能力证据。` |
| `ContextualCoach` | 已有：`AI 教练只解释当前学习事实，不会修改你的学习状态或自动生成计划。`（`ContextualCoach.tsx:44`）→ **追加**同一句 |
| `SpriteWidget` | 每句台词已有 `依据` 展开（`SpriteWidget.tsx:206-217`）→ **追加**同一句到面板底部 |

### Q.5 AI 有效性可测（任务书 §32 的前置）

**当前状况**：`ai-metrics` 七类"学习智能"事件六类零生产者、`evaluation.passRate` 硬编码 0（`apps/api/src/ai-metrics/ai-metrics.service.ts:194`）；RAG/Agent/Coach 事件**不含 userId**、内存 60 分钟滑窗、重启清零（`ai-metrics.service.ts:2-40`）→ **"用过 AI 的学生 vs 没用的学生"在数据结构上不可能对比**。

**最小修复（不新建系统，复用既有遥测通道）**：

```text
coach_suggestion.exposed    { surface, contextType, contextId }
coach_suggestion.action_clicked { surface, targetActionId }
coach_suggestion.action_started { surface, actionId }     ← 与既有 task.start / practice.set_start 关联
coach_suggestion.action_completed { surface, actionId, verdict }
```

这 4 个事件走 `UserEvent`（`TELEMETRY_EVENT_TYPES` 扩展，零迁移），即可回答："AI 给了建议 → 学生是否开始 → 是否完成 → 是否形成证据"。**注意**：`recommendation.created/accepted/completed/failed` 四个保留事件全仓零发射点（`canonical-event-writer.service.ts:43-46`），说明"生命周期事件"在本仓库尚未被真正使用过；本设计**不试图补全它**，只用 telemetry allowlist 里的 4 个新事件。

---

## R. Guidance Engine（是否需要一套轻量引导引擎）

### R.1 判定

**结论：不需要"第二套学习状态"；需要一层很薄的"投递状态 + 触发规则"层。**

依据（来自 `docs/audit/sp-guidance-infra-audit.md`）：

| 判断项 | 结论 |
|---|---|
| KPI 是否需要新引擎 | **不需要**。KPI 可以从既有受门禁指标组合：`beta-metrics`（day1/day7 留存 + 10 项漏斗率，`beta-metrics.service.ts:106-117`）、`effectiveness`（证据门，`effectiveness.assembly.ts:62-70`）、`score-calibration`（`CALIBRATION_MIN_SAMPLE=5`）、探针门（`minSampleSize=5`）、`task-evidence` verdict、`outcome-tracking` verdict |
| 真正的缺口 | **投递状态**：系统里**没有任何** "已展示 / 已忽略 / 每日一次" 的记忆（`grep dismiss` over `apps/api/src` → 0；sprite / proactive / daily-brief / progress-narrative / study-reminders **全部无服务端频次上限、无去重、无忽略记忆**） |
| 唯一真实的去重先例 | 计划生成（`triggerKey` + `eventKey`，`learning-loop-trigger.service.ts:66,82`）与探针的 `(userId, creationKey)` |
| 是否可用零 schema 实现投递状态 | **可以**。①`RuntimeState` JSON KV（`prisma/schema.prisma:742-746`，已有约定 `{prefix}:{userId}`，现用于 `coach-session:{userId}` 与 `sprite-memory:{userId}`）②`UserEvent.eventKey` 的 `@@unique([userId, eventKey])`（`:221`）——`GUIDANCE:{userId}:{trigger}:{dayKey}` 即可实现"每天一次"的结构性幂等 |

### R.2 三层架构定位（任务书 §36）

```text
┌─────────────────────────────────────────────────────────────┐
│ Learning Engine                                              │
│   产出：Evidence · Mastery · Transfer · Assessment · Score   │
│   （唯一写方：ScoreCenterService；证据：learning-evidence）   │
└───────────────────────────┬─────────────────────────────────┘
                            │ 只读
┌───────────────────────────▼─────────────────────────────────┐
│ Decision Engine                                              │
│   产出：Opportunity(影子) · Recommendation · Intervention    │
│   （priority / classifyAction / composeDailyPlan / 探针调度）  │
└───────────────────────────┬─────────────────────────────────┘
                            │ 只读
┌───────────────────────────▼─────────────────────────────────┐
│ Student Guidance Layer  ← 本设计新增的唯一一层                │
│   职责：把"复杂系统状态"翻译成"学生的下一步正确行为"            │
│   产出五种东西：                                              │
│     ①WHAT  单一主行动（消费 canonicalNextAction，不重算）      │
│     ②WHY   真实理由（消费 priority reasons，不重算）           │
│     ③HOW   文案表（静态常量，无计算）                         │
│     ④VERIFY 判定契约引用（消费 task-evidence / 证据门，不重算） │
│     ⑤NEXT  分支（消费既有 action 类型，不重算）                │
│   写入：只有投递状态（shown/dismissed/cooldown），无学习状态    │
└─────────────────────────────────────────────────────────────┘
```

**红线（继承 V12 / S2）**：
- **R-R1** Guidance Layer **不得**计算第二套 mastery / recommendation / 分数。它只允许：读取、组合、改写措辞。
- **R-R2** Guidance Layer **不得**写入任何 Learning Engine 的表（`PracticeRecord` / `UserKnowledgeMastery` / `AnswerReceipt` / `EVIDENCE_RECORDED`）。唯一写权限是 `RuntimeState`（投递状态）。
- **R-R3** Guidance Layer **不得**改变排序输入（`priority.ts` 零 import）。
- **R-R4** 实现期必须用**源码级边界断言**锁死 R-R1..R-R3（沿用 V12 证据层与 S2 探针模块的断言模式：源码级测试断言该模块不 import 任何写原语）。
- **R-R5** Guidance Layer 可完全删除（deleting this layer removes a surface and changes nothing else）——沿用 `sprite-state.ts:10` 的既有纪律。

### R.3 是否需要新模块

| 选项 | 评价 |
|---|---|
| **A. 不建模块，把引导散在前端组件里** | ❌ 现状即如此，结果是：优先级不一致（§C-A）、不可测（§C-R5）、无法去重（§R.1）。不采纳 |
| **B. 建完整 Guidance Engine（新表 + 调度器 + 状态机）** | ❌ 违反"不建第二套状态"。不采纳 |
| **C. 建一个 shared 纯函数模块 + 一个薄只读端点 + 前端呈现层**（**采纳**） | ✅ ①`packages/shared/src/guidance/`：纯函数（触发判定、消息选择、优先级排序、冷却判定）②`apps/api/src/study/guidance.controller.ts`：只读端点 `GET /coach/guidance`（返回当前该说什么），投递状态写 `RuntimeState` ③`apps/web/src/features/guidance/`：呈现层（card / inline / CTA） |

**C 方案的最小面**：

```text
新增文件（提案）：
  packages/shared/src/guidance/guidance-rules.ts      纯函数：触发 → 消息选择 + 优先级 + 冷却
  packages/shared/src/guidance/guidance-copy.ts        文案常量表（HOW 文案 + 声明）
  packages/shared/src/guidance/guidance-state.ts       投递状态类型 + dayKey 派生
  apps/api/src/study/guidance.service.ts               只读装配 + RuntimeState 投递状态
  apps/api/src/study/guidance.controller.ts            GET /coach/guidance · POST /coach/guidance/:id/dismiss
  apps/web/src/features/guidance/GuidanceCard.tsx      呈现层
  apps/web/src/features/guidance/useGuidance.ts        拉取 + 重算信号

新增遥测事件（TELEMETRY_EVENT_TYPES +N）：
  guidance.shown / guidance.dismissed / guidance.action_clicked / guidance.action_completed
```

**零 schema 变更**（投递状态走 `RuntimeState`；遥测走 `UserEvent`）。

### R.4 投递状态的最小设计

| 需求 | 实现 | 零 schema 依据 |
|---|---|---|
| 每日只展示一次 | `UserEvent` canonical-ish 写一条 `eventKey = GUIDANCE:{userId}:{triggerId}:{dayKey}` | `@@unique([userId, eventKey])`（`schema.prisma:221`） |
| 冷却期（例如 7 天内不重复） | `RuntimeState` key `guidance:{userId}` 存 `{triggerId: lastShownAt}` | `RuntimeState` KV 既有约定（`sprite-memory.repository.ts:16-20` 同模式） |
| 永久忽略 | 同上 KV 存 `dismissedAt` + 版本号（触发条件变化时自动解除） | 同左 |
| 频次上限 | `deriveGuidance` 纯函数内 `slice(0, N)`（沿用 `proactive-coach` 的 `slice(0,2)`、sprite 的 `slice(0,3)` 先例） | 无 |
| 优先级 | 纯函数内排序（沿用 `detectLearningRisks` 的 `severityOrder` + `confidence` 二级排序，`learning-risk.ts:128-130`） | 无 |

**重要**：`RuntimeState` 是可丢弃的（schema 注释即如此）；丢失投递状态的最坏后果是"同一天多说一次话"，**不会破坏任何学习事实**。这是可以接受的设计取舍，必须在文档中声明。

---

## S. Trigger Matrix（触发条件矩阵）

### S.1 矩阵（任务书 §29 的 13 个触发 + 本审计发现的 3 个补充）

每条给出：**触发条件（真实数据） / message / action / dismiss rule / cooldown / success condition**。

| # | 触发 | 条件（数据来源） | message（示例，直接可用） | action | dismiss rule | cooldown | success condition |
|---|---|---|---|---|---|---|---|
| T1 | **首次登录 / 首用** | `OnboardingStatus.completed === false`（`App.tsx:348-351`）；或 `User.onboardingCompletedAt` 为空 | 分 3 次按需出现（不一次性讲完）：①"先填 4 项基础信息，系统才能给你排计划"②"填完后你会得到一条今日路线"③"计划不是作业，做不完可以顺延" | 分别为：打开引导表单 / 无（信息） / 无 | 完成 onboarding 即永久解除 | 无（一次性） | onboarding 完成 |
| T2 | **首次推荐** | `recommendation.exposed` 当日首次（`recommendationExposure.ts:57`） | "这是系统给你的第一个推荐。**点「为什么推荐」可以看到它的全部依据**——包括系统还不知道的部分。" | 打开 `WhyRecommendedDrawer` | 点击一次即永久解除 | 无 | `recommendation.viewed` 事件出现 |
| T3 | **首次做错题** | `wrong.open_review` 首次（`App.tsx:850`） | "错题不是再看一遍解析，而是把错误变成下一次会做的动作。**先标错因，再重做一次，最后做一道变式。**" | 打开错因选择 / 重做 | 完成一次"标错因 + 重做"即解除 | 无 | `ReviewAttempt` 或重做 `PracticeRecord` 出现 |
| T4 | **首次看掌握度** | 首次进入含 mastery 的视图（前端首次渲染事件） | "掌握度是**练习证据强度**，不是考试分数。它只说明同源练习表现；新题会不会做是另一件事。" | 无（信息）+ 链接到证据台账 | 展示一次即永久解除 | 无 | 学生打开过证据台账 |
| T5 | **首次完成任务** | `task.manual_complete` 或 `task.complete` 首次 | "任务完成 ≠ 学会。**系统只承认被判分的作答。**完成后回来看一眼判定。" | 跳到该任务的证据判定 | 展示一次即解除 | 无 | verdict 被查看（新遥测） |
| T6 | **首次跳过复测** | 探针 Action 首次 `expired` | **无学生文案**（S2 §7 硬规则） | 系统侧：把探针卡提前到今日区域 | — | — | 下一次探针在窗内提交 |
| T7 | **连续重做旧题** | `repeatRatio ≥ 0.5` 且 7 天新题 <5（§I 模式 1） | "重复能提高熟悉度，**但不能验证迁移**。" | 一组陌生同构题 | 出现在今日区域一次，学生忽略则降到报告页 | 7 天 | 7 天内出现 ≥5 道首次作答的题 |
| T8 | **连续失败** | 同 `(nodeId, actionType)` 连续 2 次 FAILED / `practiced_no_gain`（§I 模式 8） | "这个方式连续两次没有带来提升——**不是你的问题，是手段不匹配**，换一种。" | 换干预手段（按 `MISTAKE_SUGGESTIONS`，`learning.ts:33-42`） | 换手段后解除 | 14 天 | 新 verdict ≠ `practiced_no_gain` |
| T9 | **首次 Transfer Probe** | `transfer-probe` 端点返回非空且该学生无历史探针 | §N.2 的完整首次解释 | 开始复测 | 完成一次即永久解除 | 无 | `transfer_probe` 证据出现 |
| T10 | **首次模考** | `paper` 会话首次创建 | "模考不是学习任务，是测量工具。**它的价值是发现真实失分。**" | 无（信息）；交卷后指向失分清单 | 完成一次即永久解除 | 无 | `ExamReport` + `nodeLoss` 被查看 |
| T11 | **预测分明显下降** | `ScorePrediction` 相邻两次 `predictedScore` 下降 ≥ 阈值（阈值需预注册，本设计不预设数值；**当前无历史对照，属 S1 之后的实验项**） | "预测分下降不等于你退步了：**它在能力不变时也会随考试日临近而机械下滑**（含时间因子）。请看掌握度与失分清单，而不是看这个数。" | 查看证据台账 / 失分清单 | 展示一次 | 14 天 | — |
| T12 | **分数数据不足** | `calibrationEvidence.status ∈ {not_started, insufficient_evidence}`（`ScoreAnchorPanel.tsx:23-28`） | §C-O 的最小充分条件句式："需要 5 对「预测-实测」，现在 0 对：做一次教师判分模考即可建立第一个锚点。" | 打开成绩锚点面板 / 模考入口 | 补足后自动解除 | 7 天 | status 前进一档 |
| T13 | **证据不足（节点级）** | `EffectivenessPanel.tsx:137` 的 `至少 5 次练习` 条件未达 | "再完成 N 次该考点的判分练习（现在 M 次），系统就能判断能力变化。" | 该节点的练习入口 | 达到门即解除 | 3 天 | 节点证据达门（`minSampleSize=5`） |
| **T14（补充）** | **只看解析不作答** | 单会话 `abandonRatio ≥ 0.5`（§I 模式 3） | "这一组你只看了解析，没有提交作答。**阅读不产生能力证据。**" | 继续未完成会话（`ResumeSessionBanner`） | 会话提交即解除 | 3 天 | 会话提交 → `EVIDENCE_RECORDED` |
| **T15（补充）** | **只追求完成率** | `completedTasks ≥ 3` 且 `task-evidence` `insufficient_data` 占比 ≥0.5（§I 模式 5） | "你有 N 个任务打了完成标记，但对应考点上没有作答记录。**完成标记不等于能力提升。**" | 挑 1 个任务做 3 道判分题 | 占比降到 0.3 以下 | 7 天 | verdict 分布改善 |
| **T16（补充）** | **推荐变化未解释** | 当日 `recommendation.exposed` 集合与昨日不同（集合差非空） | "今天变了：新增「X」（考频上升）、移除「Y」（已达标）。" | 无（信息） | 展示一次 | 每日 | — |

### S.2 优先级与并发上限

```text
优先级（从高到低）：
  P0  误用类：T15（完成≠学会）、T14（只看不作答）、T7（重复熟题）
  P1  验证类：T9（首次探针）、T10（首次模考）、T12（分数不足）、T13（证据不足）
  P2  理解类：T2（首次推荐）、T4（首次掌握度）、T5（首次完成）、T3（首次错题）
  P3  信息类：T16（推荐变化）、T1（首用分期）、T11（预测下滑）

并发上限：每个页面渲染最多 1 条 guidance（沿用 proactive 的 slice(0,2) 与 sprite 的
slice(0,3) 的收紧版：引导比提醒更"重"，上限取 1）。
每日总上限：3 条（超过则丢弃 P3/P2）。
```

### S.3 dismiss 与"不再打扰"的持久化

| 动作 | 效果 |
|---|---|
| 点 X | 该 `triggerId` 在冷却期内不再出现；冷却期后**仅当条件仍成立**才再次出现 |
| 点 CTA 但未完成 | 不视为已处理；冷却期减半（避免"点了就不再提醒"的漏洞） |
| 条件不再成立 | 自动解除（例如 T15 的占比降到阈值以下） |
| 全局"不再提示使用建议"开关 | `RuntimeState` 单个布尔；学生可随时在设置里恢复 |

### S.4 与既有 surface 的关系（不重复说话）

| 既有 surface | 与 guidance 的关系 |
|---|---|
| `DailyBriefCard` | **保留为"今天的简报"**（WHAT 的载体）；guidance 不重复它的内容 |
| `ProactiveCoachCard` | **升级为可点击**（消费 `actorHint` → CTA）；其 6 类风险继续走它自己的通道，**不并入 guidance**（避免两套东西说同一件事） |
| `SpriteWidget` | **保留为陪伴层**；guidance 的 message 可由 sprite 承载呈现（语气已受宪法约束），但**判定逻辑不在 sprite** |
| `NextLearningStepCard` | **统一**其优先级到 `canonicalNextAction`，或明确标注"这是本页的下一步，不是全局唯一动作" |

### S.5 需要新增的遥测（受控词表扩展，零 schema）

```text
guidance.shown            { triggerId, priority, surface }
guidance.dismissed        { triggerId }
guidance.action_clicked   { triggerId, targetActionId }
guidance.action_completed { triggerId, actionId, verdict }
practice.explain_viewed   { questionId, answered }      ← §I 模式 3 精确版
coach_suggestion.*        { surface, contextType, contextId }  ← §Q.5
```

同时在 `recommendationExposure.ts` 补上**已声明但零调用**的两个 surface：`review_queue`、`exam_aligned`（`recommendationExposure.ts:25`）——这是零成本的既有能力补齐。

---

## T. Guidance UX（呈现与打扰控制）

### T.1 七类 Guide Types（任务书 §27）

**核心原则：不要把一切塞进 onboarding。** 每类有独立的触发、位置、生命周期：

| # | 类型 | 用途 | 位置 | 触发 | 生命周期 |
|---|---|---|---|---|---|
| 1 | **Onboarding** | 只讲"系统会怎么工作"，不讲操作细节 | 注册后 + 后端首用闸门 | 首次 | 一次，可跳过（跳过不阻断） |
| 2 | **Contextual Guide** | 某个功能**首次使用**时解释它 | 该功能所在卡片内（内联） | 首次进入该功能 | 每个功能一次，永久记忆 |
| 3 | **Inline Explanation** | 解释当前出现的数字/判定 | 数字旁边常驻（非弹窗） | 该数字出现时 | 常驻（不是引导，是标注） |
| 4 | **Decision Explanation** | 解释"为什么推荐这个" | 推荐卡内 `<details>` / 抽屉 | 用户展开或首次 | 按需 |
| 5 | **Mistake Correction** | 纠偏错误用法 | 今日区域卡 或 内联 | §I 的 10 类命中 | 冷却 + 条件解除 |
| 6 | **Progress Interpretation** | 把数字翻译成语言 | 报告 / 首页小结 | 每周 / 每阶段 | 常驻 |
| 7 | **Result Interpretation** | 结果页说明"你刚测的是什么" | 结果卡内 | 每次结果 | 每次 |

**分配检查**：本设计把 §C 的 15 条混淆按上表分配，**没有一条被放进 onboarding**（除"系统如何工作"的总纲），这是刻意的——§C 的 P0 项全部是"行为发生时"的误解。

### T.2 Contextual Guide 的实现（一次性 + 永久记忆）

```text
判定："该学生是否见过 featureKey"
  → UserEvent eventKey = GUIDANCE_SEEN:{userId}:{featureKey}
  → 存在则不再展示
  → 不存在则展示，并写该事件

featureKey 清单（首批 8 个，对应 §C 的 P0/P1）：
  why_recommended     推荐抽屉
  mastery_meaning     任何 mastery 数字首次出现
  evidence_strength   证据台账首次出现
  mistake_loop        错题本首次进入
  transfer_probe      探针首次出现
  mock_exam           模考首次进入
  review_schedule     复习队列首次出现
  score_anchor        成绩锚点面板首次出现
```

### T.3 呈现优先级（任务书 §30）

```text
优先（默认）：inline 一行 > 卡片 > next-step CTA
强提醒（仅 P0 误用类）：卡片，非模态，不阻断
禁止：
  ✗ 全屏 interstitial（除首用闸门）
  ✗ 每次登录都弹
  ✗ 一次讲完 20 屏
  ✗ 100 个 tooltip（本仓库当前 tooltip 数为 0，不要反向引入）
  ✗ 任何无 onClick 的提醒（§J G-4）
```

### T.4 非阻断原则的验收方式

```text
验收：把 guidance 的全部 HTTP 调用短路（模拟 500），
      学生的所有主流程（登录 / 首页 / 练题 / 错题 / 测评 / 报告 / AI）
      必须逐字节行为不变（沿用 V12 影子层与 M3 Phase C 的
      "带内行为逐字节不变"验证方法学）。
```

这条验收是硬性的：引导层的失败**绝不能**变成错误横幅或空页面。既有先例：`ProactiveCoachCard.tsx:45-47`（`silent: proactive surface must never become an error banner`）、`useSpriteState.ts:124-126`（transport 失败则精灵整体隐藏）。

### T.5 Learning Contract 的呈现位置

见 §U。契约的呈现**不是** 20 屏 onboarding，而是：

```text
① 注册/首用时：一张卡，5 行，一个"我知道了"按钮（不勾选、不签署、不可拒绝）
② 任何时候可从「AI 答疑」或首页页脚重新打开（可回顾，不重复出现）
```

---

## U. Learning Contract（408 提分使用协议）

### U.1 内容（5 条，逐条绑定系统真实行为）

任务书 §31 要求至少包含 5 条。每条都必须**能被系统证据支持**，否则不得写入契约（否则契约本身就是一次不诚实）。

| # | 契约条款（学生语言） | 系统侧的真实依据（必须存在） |
|---|---|---|
| 1 | **刷题不是最终目标。** 系统会优先让你做"考频高 × 还没掌握"的考点，而不是更多的题。 | `priority.ts` 的 `examValue 0.37 + weakness 0.32` 权重；`TodaysScoreCenter` 的推荐 |
| 2 | **任务完成不等于学会。** 系统只承认它观测到的判分作答；完成标记不会被当作能力证据。 | `learning-evidence.ts:17`（`An activity marker is never evidence`）+ `task-evidence.ts:117` |
| 3 | **熟题做对不等于新题会做。** 系统会用一道你从未见过的新题来验证迁移；没有合格新题时会直说，不会拿旧题冒充。 | 探针 E1–E6 资格规则 + `no_probe_available` 终态（S2 §3、§17） |
| 4 | **模考用于验证，不是表演。** 它的价值是找出真实失分。 | `nodeLoss` + `recoveryClosure`（`ExamDiagnosisPanel`） |
| 5 | **系统会根据证据调整推荐。** 包括：证据不足时拒绝给结论；负荷由上周证据决定。 | `deriveWeeklyAdjustment`（证据不足 → `maintain`）+ `LearningEvidenceLedger` 的拒绝判断 + `ScoreAnchorPanel` 的四态 |

**追加 2 条（本审计发现必须写进契约的边界，否则学生会误解系统承诺）**：

| # | 条款 | 依据 |
|---|---|---|
| 6 | **系统今天还不能预计你能提高几分。** 在你录入真实成绩之前，所有分数都是估算。 | gap report §5/§10；`ScoreAnchorPanel.tsx:118` |
| 7 | **系统的判断可能不完整。** 部分考点还没有节点标注，部分节点没有考频数据——系统会标注"证据不足"，而不是猜。 | B13（332 题 0 直接标签）、B4（147 节点无考频快照） |

### U.2 呈现形式（禁止法律条款式）

```text
标题：408 提分系统的 7 条使用约定
形式：7 行，每行一句；无编号条款、无"甲方乙方"、无勾选框、无"我已阅读并同意"
按钮：「开始使用」（唯一按钮；没有"不同意"）
可回顾：首页页脚 "系统怎么工作" 链接
```

**设计理由**：契约的目的是**校准预期**，不是**获取同意**。强制勾选会让学生产生"我签了什么"的防御心理，反而降低理解。

### U.3 契约的可验证性

契约的 7 条必须在**系统里能找到**（学生点击任一条能跳到对应证据位置）。验收见 §X-Case D/E/F/G。

---

## V. Metrics（引导本身也必须可测）

### V.1 引导漏斗（任务书 §32）

| 指标 | 定义 | 数据来源（既有/新增） | 门禁 |
|---|---|---|---|
| `Guidance shown` | guidance 被渲染次数（按 triggerId / surface） | 新遥测 `guidance.shown` | — |
| `Guidance accepted` | 学生点击 CTA 的比例 | `guidance.action_clicked / guidance.shown` | — |
| `Guidance action started` | CTA 指向的动作真的开始 | 与既有 `task.start` / `practice.set_start` / `assessment.generate` join | — |
| `Guidance action completed` | 动作完成 | 与既有 `StudyTaskCompletion` / `PracticeRecord` / `verdict` join | — |
| `Guidance correction success` | 纠偏后目标行为改善 | T7：新题占比上升；T8：新 verdict ≠ `practiced_no_gain`；T14：会话提交；T15：`insufficient_data` 占比下降 | 样本 ≥5 才报 |
| `Transfer completion` | 到期探针在窗内被提交的比例 | 探针 Action 状态机（`submitted` vs `expired`） | 个人层只报事件，聚合层 n≥5 |
| `Assessment participation` | ≥1 次测评/模考的学生占比 | `AssessmentHistoryItem` + `LearningSession(paper)` | 周 |

### V.2 学习行为 KPI（任务书 §33）

| KPI | 定义 | 数据来源 | **必须声明的性质** |
|---|---|---|---|
| **Protocol Adherence** | 执行正确协议的比例（分四层：daily/weekly/milestone/pre-exam） | 组合：①当日有判分作答 ②到期复习清零 ③≥1 次探针（若到期）④周内有测评（若到周） | **leading indicator** |
| **Verification Rate** | 训练后接受复测的比例 = 有探针/测评的节点数 ÷ 证据达门的节点数 | `EVIDENCE_GATE` 节点集合 ∩ `transfer_probe`/assessment 集合 | **leading indicator** |
| **Transfer Completion** | 完成探针的比例 | 同 V.1 | **leading indicator** |
| **False Mastery Exposure** | "练习正确但迁移失败"的比例 | `TransferGap < 0` 的节点占比（**n≥5 才出数**） | **leading indicator；个人层不可判定**（§I 模式 9） |
| **Outcome Closure** | 干预最终有有效结果证据的比例 | `outcome-tracking` 的 `improved` / (`improved+no_change`) | **leading indicator** |

**强制声明（任务书 §33 末）**：以上 5 项**全部是 leading indicators，不是最终 Score Gain**。任何将它们报为"提分效果"的表述都不允许出现在学生可见或运营文档中。

### V.3 归因链（任务书 §32 末）

```text
Guidance → Behavior Change → Learning Evidence
```

**禁止**把 `guide click` 当作 `learning improvement`。验收方式：

```text
验收：任何 KPI 报表中，禁止出现 "点击率提升 ⇒ 学习提升" 的因果措辞。
      允许的表述只有关联描述（沿用 EffectivenessPanel.tsx:156 的
      "相关不等于因果…不承诺分数变化" 文案纪律）。
```

### V.4 北极星与引导的关系

项目北极星是 **Verified Score Gain / 30d**（`score-improvement-reconstruction-design.md` §B），锚定模考 + 教师判分。引导层的 KPI **全部**是它的上游 leading indicator，**不得**替代它。若引导导致 adherence 上升而 Verified Score Gain 无改善，那是引导失败的证据，不是成功的证据。

---

## W. Experiment Design（对照实验）

### W.1 现状（必须先说清才能设计）

| 事实 | 依据 |
|---|---|
| 确定性分流器存在且可用 | `assignExperimentArm` = `sha256(userId::experimentKey)[0] % arms.length`，无持久化不漂移（`apps/api/src/study/coach-experiments.ts:15-22`） |
| 唯一调用点 | `GET /coach/experiment-assignment`（`daily-brief.controller.ts:125-137`），**只返回一个标签** |
| Web 端消费者 | **零**（`grep experiment-assignment apps/web/src` → 0） |
| 结论 | **当前没有任何实验改变学生可见行为**。分流器是"只打标不测量"（gap report §12 Attribution 行） |
| 臂持久化 | 无（不持久化 = 不漂移，但也无法做"事后按臂归因"） | 

### W.2 实验设计（任务书 §34）

```text
实验名：SP-1 Student Operating Protocol
对象：新注册学生（避免"老学生对旧 UI 的习惯"污染）
分流：assignExperimentArm(userId, 'SP-1')，2 臂
   Control   ：现有产品（无 guidance 层，无统一 HOW 文案）
   Treatment ：加入 Student Operating Protocol（G1+G2 的最小集）
时长：4 周（覆盖 4 个 weekly 周期 + 至少 1 个里程碑周期）

主指标（按重要性排序，全部 pre-registered）：
  M1  Protocol Adherence（daily 层：当日形成 ≥1 条观测证据的天数占比）
  M2  Verification Rate（证据达门节点中完成过复测的比例）
  M3  Assessment Participation（4 周内 ≥1 次测评/模考的比例）
  M4  Verified Score Gain / 30d（锚定模考 + 教师判分 —— 需 E1 先跑通）

禁止作为主指标：
  ✗ 页面点击率 / guidance 展示次数 / 停留时长 / 任务完成率
  理由：任务书 §34 明文"不要只比较页面点击率"；且任务完成率本质是
       活动指标，与本项目"Activity ≠ Learning"的宪法级立场冲突。
```

### W.3 预注册门槛（沿用仓库既有实践）

| 项 | 门槛 | 依据 |
|---|---|---|
| 每组最小样本 | `CALIBRATION_MIN_SAMPLE = 5` 的量级不足以做 A/B；**A/B 需 ≥30/臂**（本设计提出，需所有者确认） | 新增预注册项 |
| 方向一致率 | 与既有"方向一致率"预注册实践一致（`score-improvement-gap-report.md` §26 第 3 件） | 既有 |
| 效果门 | M1/M2/M3 至少在 2 项上达到 +10% 相对提升，且无一显著为负 | 新增预注册项 |
| 负向信号熔断 | 若 Treatment 组 `insufficient_data` 占比上升（说明引导只增加了活动），立即停 | 新增预注册项 |
| M4 | 因 E1 未跑，M4 在本实验中**只记录不判定**；不得以 M4 为晋级依据 | 诚实条款 |

### W.4 必须防的"假成功"

| 风险 | 防法 |
|---|---|
| guidance 只增加了点击，没有改变行为 | 主指标是 M1/M2/M3（证据与验证），不是点击 |
| guidance 把学生推向"刷量" | 同时监控 `insufficient_data` 占比（若上升 = 引导在制造活动） |
| guidance 制造焦虑 | 监控 `FeedbackSubmission` 的负面反馈 + 关卡：出现"罪感/焦虑"类反馈 → 立即审计文案 |
| 臂不持久化导致归因不可靠 | 实验期把臂写入 `RuntimeState`（零 schema），实验后清理 |
| 分流偏差 | `assignExperimentArm` 是哈希分流，无偏；但需断言实验期内 `experimentKey` 不变 |

### W.5 与既有实验的关系

- **E1（分数锚定）必须先跑**，否则 M4 无意义（`score-improvement-gap-report.md` §24）。
- **E2（迁移探针）与本实验有依赖**：M2/M3 需要探针可用（内容池 + `TRANSFER_PROBE_ENABLED=true`）。
- **若 E2 未就绪**：SP-1 可先只测 M1 + M3（证据与测评参与），**诚实声明 M2 不可测**。

---

## X. Acceptance Criteria（产品级验收：Case A–J）

任务书 §35 的 10 个 Case，逐条给出**可执行的验收方法**与**当前判定**。

| Case | 要求 | 验收方法（可执行） | 当前判定 | 达标所需 |
|---|---|---|---|---|
| **A** | 新用户知道今天该做什么 | 新账号登录 → 只数"页面上并列的'下一步'入口"数量；必须 = 1 个主 CTA + 1 个折叠区 | ❌ **不通过**（≥7 个并列来源，§C-A） | G2 |
| **B** | 知道为什么 | 打开任一推荐 → 检查每条理由是否有 `triggered=true` 依据；故意构造"只有 1 条真实触发"的场景，验证不会出现第 2 条假理由 | ❌ **不通过**（`priority.ts:111-121` 会补假理由） | G1（K-1） |
| **C** | 知道如何做 | 逐功能检查是否存在 HOW 文案（可判定标准），且首次进入该功能时展示 | ❌ **不通过**（HOW 全仓缺失） | G3 |
| **D** | 完成任务后知道"完成 ≠ 学会" | 完成一个任务（不做任何练习）→ 检查完成态是否出现"完成标记不构成能力证据" | ❌ **不通过**（该句只在报告页 `TaskEvidencePanel.tsx:44`） | G2 |
| **E** | 知道 Transfer Probe 的意义 | 首次收到探针 → 检查是否有一次性解释（迁移测试 / 不是普通练习 / 熟题≠新题） | ⚠️ **部分**（文案存在 `TransferProbeCard.tsx:101`，但无首次解释机制、默认关闭、位置错误） | G5 |
| **F** | 知道模考是验证工具 | 进入模考 → 检查是否有"模考不是学习任务，是测量工具" | ❌ **不通过**（全仓无此文案） | G5 |
| **G** | 知道预测分不是实际分 | 同屏比对：预测分是否有 `预测·估算` 徽标 + 四态校准状态 | ⚠️ **部分**（`ScoreAnchorPanel` 达标，但 `StudentLaunchpad.tsx:251` 裸分、`StudentProgressOverview.tsx:192` 无徽标） | G5 |
| **H** | 系统能纠正错误使用方式 | 制造条件命中 §I 的 7 条可检测模式 → 检查是否出现"可点击且能到达"的纠正（G-4） | ❌ **不通过**（唯一通道 `ProactiveCoachCard` 是无 onClick 的 `<li>`） | G4 |
| **I** | AI Coach 能把建议转成真实 action | 在 AI 面提问"我今天学什么" → 检查回复是否含可点击 deep link 且点击后真的进入该动作 | ⚠️ **部分**（只有 `SpriteWidget` 有 deep link；`TutorPanel`/`ContextualCoach` 全是纯文本） | G6 |
| **J** | 用户可以看到自己的学习闭环位置 | 打开任一学生页面（**不进入报告页**）→ 检查是否能说出"我现在在闭环的第几步" | ❌ **不通过**（`StudentLoopGuide` 只有 4 步导航，不反映学生当前进度；闭环位置信息在报告页） | G2 |

**当前合计：0 通过 / 4 部分 / 6 不通过。**

### X.1 验收的刚性规则

```text
R-X1  验收必须在"新账号 + 零人工教学"条件下执行（不得用开发者账号）。
R-X2  验收以"学生能否说出答案"为准，不以"代码里有没有这句话"为准。
      因此每条 Case 都要写一句**期望学生能说出的话**，并逐字比对。
R-X3  当前判定为"部分/不通过"的部分不得因为"文案已在代码里"而改判（§C 的核心教训）。
R-X4  修复不得以降低标准达成：禁止把验收问题删掉、禁止把 Case 改写得更宽松。
```

---

## Y. Architecture（最终三层架构）

### Y.1 三层与职责（任务书 §36）

```text
┌───────────────────────────────────────────────────────────────────────┐
│ ① Learning Engine                                                     │
│   产生：Evidence · Mastery · Transfer · Assessment · Score            │
│   唯一写方：ScoreCenterService（applyAttempts / applyReviewObservation）│
│   证据：learning-evidence.service（EVIDENCE_RECORDED）                 │
│   探针：PracticeRecord(transfer_probe 会话) + EVIDENCE_RECORDED(detail) │
│   分数：ScorePrediction / ScoreAssessment / ScoreOutcome / Correction  │
│   ⚠️ Guidance Layer 对它只有读权限                                     │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ 只读投影
┌───────────────────────────────▼───────────────────────────────────────┐
│ ② Decision Engine                                                     │
│   产生：Opportunity（影子） · Recommendation · Intervention            │
│   priority（6 因子）/ classifyAction（5 分支）/ composeDailyPlan       │
│   风险层：learning-signals → detectLearningRisks → proactive-coach     │
│   探针调度：TRANSFER_PROBE 懒投递                                      │
│   ⚠️ Guidance Layer 对它的公式零 import、零修改                        │
└───────────────────────────────┬───────────────────────────────────────┘
                                │ 只读投影（+ 投递状态写 RuntimeState）
┌───────────────────────────────▼───────────────────────────────────────┐
│ ③ Student Guidance Layer（本设计新增）                                 │
│   输入：①canonicalNextAction ②priority reasons(triggered)             │
│        ③task-evidence verdict ④证据台账 summary ⑤探针状态             │
│        ⑥weeklyAdjustment ⑦calibration status ⑧scheduled/window 状态   │
│   产出：WHAT / WHY / HOW / VERIFY / NEXT 五件套                        │
│   写入：仅 RuntimeState（shown / dismissed / cooldown）                │
│   边界：源码级断言 —— 不 import 任何写原语、不重算 mastery/排序         │
│   可删除：删掉它只少一个面，不改任何学习事实（sprite-state.ts:10 纪律）  │
└───────────────────────────────────────────────────────────────────────┘
```

### Y.2 数据流（一次"任务完成"的完整路径）

```text
学生完成练习
  → PracticeRecord（Learning Engine 写，事务内）
  → applyAttempts → UserKnowledgeMastery（OCC，唯一写方）
  → EVIDENCE_RECORDED（strong，事务内，occurrence 键）
  → StudyTaskCompletion（活动事实）
        ↓（只读）
  task-evidence 投影 → verdict（improved / practiced / practiced_no_gain / insufficient_data）
        ↓（只读，不重算）
  Guidance Layer：
    ├─ 完成态内联：verdict + verdictBasis（逐字复用）
    ├─ 若 insufficient_data → 触发 T15（完成≠学会）
    └─ 若证据达门 → 触发 T13/G9（建议迁移复测）
        ↓
  前端呈现（inline / card / CTA）
        ↓
  学生点击 CTA → 既有 canonical 动作（无新写路径）
        ↓
  遥测：guidance.action_clicked → guidance.action_completed（与 verdict join）
```

### Y.3 与既有架构的一致性检查（Check A–H）

| Check | 问题 | 裁决 | 依据 |
|---|---|---|---|
| **A** | 是否引入第二套数据 SoT？ | **通过** | 唯一新写入是 `RuntimeState`（既有 KV，可丢弃）；学习状态零新增 |
| **B** | 是否改变 Learning Engine 语义？ | **通过** | 零 schema、零写路径；`applyAttempts`/`applyReviewObservation`/证据台账全不触碰 |
| **C** | 是否改变排序/推荐？ | **通过** | `priority.ts`/`plan.ts`/`recommendation.service.ts` 的公式零改动；引导只**解释**，不参与排序 |
| **D** | 是否破坏 V12.1 / S1 / S2 已批准语义？ | **通过** | C1 未启用；`applyReview` 零语义改动；Score Ledger 四表零改动；`probe_expired` 中性语义保留 |
| **E** | 历史数据可解释性？ | **通过** | 所有判定读既有投影；`RuntimeState` 丢失不影响事实 |
| **F** | 学生隔离？ | **通过** | 新端点 `GET /coach/guidance` 沿用 `resolveUserId` self-only 纪律（既有模式） |
| **G** | 是否可回滚？ | **通过** | 删端点 + 删前端挂载；`RuntimeState` 键可清理；零迁移 → 无迁移回滚面 |
| **H** | 是否偷偷实现 S3/S4（ROI 排序）？ | **通过** | 明确 Non-Goals：不做失分模型、不改排序货币、不做 outcome 降权（只做引导层"换手段"建议） |

---

## Z. Implementation Roadmap（G1–G7）

### Z.0 拆分原则（任务书 §39）

```text
设计 READY 之后，不立即实现全部功能。
先拆 G1–G7，G1–G2 优先。
本设计到此停止：不开始 G1 实现，等待独立的 Implementation Approval。
```

### Z.1 路线图

| # | 里程碑 | 目标 | 交付物（预计） | 依赖 | 验收 | 回滚 |
|---|---|---|---|---|---|---|
| **G1** | **Guidance Foundation** | 建立投递状态 + 触发规则的最小骨架，并**先修掉 K-1/K-2/K-3 三条"解释可为假"** | `packages/shared/src/guidance/{guidance-rules,guidance-copy,guidance-state}.ts`；`apps/api/src/study/guidance.{service,controller}.ts`；`GET /coach/guidance` + `POST /coach/guidance/:id/dismiss`；4 个遥测事件；`priority.ts` 的理由拆分（K-1）；`recommendation.service.ts` 的文案修复（K-2） | 无 | ①`GUIDANCE:{userId}:{trigger}:{dayKey}` 幂等可证（重复调用不重复投递）②源码级边界断言（不 import 写原语 / 不 import priority 公式）③`npm test` 零回归 ④短路 HTTP 后主流程逐字节不变 | 删端点 + 删前端挂载 |
| **G2** | **Daily Learning Protocol** | 让学生"30 秒知道今天怎么学"，并且**完成 ≠ 学会**在完成态可见 | 首页信息层级收敛（1 主 CTA + 折叠区）；今日协议 6 步的文案与顺序；完成态内联 verdict + `verdictBasis`；`weeklyAdjustment.note` 首次上屏；今日证据小结 | G1 | §X-Case A / D / J 通过；"新账号零教学"下学生能说出今日第一步 | 前端回滚 + 隐藏卡 |
| **G3** | **Contextual Guidance** | 消灭 §C-C（HOW 缺失）：8 个 `featureKey` 的首次使用解释 + HOW 文案表 | `guidance-copy.ts` 全量文案（8 个功能 × 3 行 HOW）；`GUIDANCE_SEEN:{userId}:{featureKey}` 幂等；前端 Contextual Guide 组件 | G1 | §X-Case C 通过；每个 featureKey 只出现一次且可回顾 | 前端回滚 |
| **G4** | **Wrong-Behavior Guardrails** | 把 §I 的 7 条可检测模式接成可点击、可验证的纠偏 | `detect*` 纯函数 ×7；`ProactiveCoachCard` 消费 `actorHint` → CTA；10 条 guardrail 的文案与 G-1..G-6 断言 | G1、G2 | §X-Case H 通过；每条 guardrail 的 CTA 可达（自动化断言"存在可点击元素且指向既有区"） | 关闭触发 |
| **G5** | **Transfer / Assessment Guidance** | 让测量工具被理解：探针首次解释 + 今日区域探针卡 + 模考语义声明 + `ScoreKind` 统一徽标 | 探针卡迁至今日区域 + 首次解释 + 结果 NEXT；`transferObservation` 前端接入（只读，个人事件）；模考声明；`ScoreKind` 徽标组件全量替换 | G1 | §X-Case E / F / G 通过 | 前端回滚；探针仍由 `TRANSFER_PROBE_ENABLED` 控制 |
| **G6** | **AI Coach Action Guidance** | 让 AI 从"会说"到"可点到" | 四段式应答格式（Action/Reason/Expected Outcome/Verification）；`nextActions` → 既有 canonical 动作深链；`coach_suggestion.*` 遥测；三处统一声明 | G1、G5 | §X-Case I 通过；AI 的可点击动作全部落在既有 canonical 面上（源码断言：无新写路径） | 前端回滚 + AI 侧回退到纯文本 |
| **G7** | **Learning Protocol Measurement** | 让协议本身可测，并跑 SP-1 | KPI 投影（V.1/V.2 全部指标）；臂持久化（`RuntimeState`）；SP-1 runbook + 分析脚本 | G1–G6 | V.1 全部指标可出数（含诚实缺席分支）；SP-1 预注册文档就绪 | 只读，可删 |

### Z.2 优先级与依赖

```text
G1 ──┬── G2 ──┬── G4
     │        │
     ├── G3 ──┘
     └── G5 ── G6
                │
G1..G6 ─────────┴── G7
```

- **G1 + G2 优先**（任务书 §39 明文）。
- **G1 内含 K-1（理由码拆分）**：这是本设计的**第一优先修复**，因为它是一个正在运行的错误（系统正在向学生展示可能为假的理由）。
- **G3 与 G4 可并行**（互不依赖）。
- **G7 必须在 G1 之后**（否则无投递状态可测），但**不必等 G6**。

### Z.3 每个里程碑的 Non-Goals（防止范围蔓延）

```text
ALL:  NO schema change · NO second mastery/recommendation/task/evidence SoT
      NO ROI ranking · NO transfer aggregation exposed to students
      NO change to applyReview / C1 · NO deployment without owner approval
G1:   NO UI beyond the minimum to prove the endpoint
G2:   NO new page; only re-ordering + inline blocks
G3:   NO tooltip library · NO tour library · NO 20-screen onboarding
G4:   NO blocking modal · NO penalty · NO mastery/score write
G5:   NO enabling TRANSFER_PROBE_ENABLED (that requires content readiness)
G6:   NO new AI write permission · NO AI-generated content storage
G7:   NO new analytics service; compose existing gated metrics
```

### Z.4 需要独立批准的事项（本设计只提案）

| # | 事项 | 为什么需要批准 |
|---|---|---|
| A1 | K-1 修改 `PriorityResult` 的理由结构（`triggered` / `fallbackReasons`） | 触及共享引擎返回契约（虽为向后兼容增量，仍属契约变更） |
| A2 | 新增 `GET /coach/guidance` + `POST /coach/guidance/:id/dismiss` | 新增 API 面 |
| A3 | `TELEMETRY_EVENT_TYPES` 扩展（guidance.* / practice.explain_viewed / coach_suggestion.*） | 受控词表扩展 |
| A4 | 首页信息层级收敛（移除并列来源） | 触及既有 UI 契约测试（`today-plan-ui` / `student-learning-console-ui` 等） |
| A5 | 启用 `TRANSFER_PROBE_ENABLED` | 需内容池就绪（30 节点 × 2 题）+ 所有者批准 |
| A6 | `User.examDate` 录入入口（或改文案） | 当前 UI 宣称"可在个人信息中录入"但入口不存在 |
| A7 | G7 的臂持久化与 SP-1 开跑 | 涉及真实学生分流 |

---

## 最终回答（§38）

### 判定：`PARTIAL`

> 如果一个完全不了解系统的 408 学生第一次登录，系统能否在不依赖人工教学的情况下，让他知道"今天应该做什么、为什么做、怎么做、什么时候验证、验证后下一步是什么"？

**`PARTIAL`**，五个子问题的证据如下（全部可复现）：

| 子问题 | 判定 | 决定性证据 |
|---|---|---|
| **今天应该做什么** | **YES** | 后端持久化的首用闸门（`App.tsx:348-354` → `StudentLaunchpad.tsx:127`）+ 唯一主行动仲裁（`canonicalNextAction.ts:4-13`）+ 今日任务首行（`TodayMission.tsx:68-70`）+ 今日学习路线（`TodayLearningRouteView.tsx:148-151`）。**冗余到过载：同屏 ≥7 个并列"下一步"来源，无仲裁者**（§C-A），但"知道做什么"这件事本身成立 |
| **为什么做** | **PARTIAL** | 载体齐全（`TodayMission.tsx:69` 的「为什么：」、`WhyRecommendedDrawer` 的 6 因子构成、`nodePlan.ts:41-51` 的中文标签表）。**但 `priority.ts:111-121` 在真实理由 <2 条时从通用池补齐，UI 无从区分真假** —— 学生可能被告知一个未发生过的原因。且答案止于"优先级高"，不回答"值几分"（§C-B、§K） |
| **怎么做** | **NO** | 全仓**零处**功能级 HOW：没有 tooltip、没有首次使用说明、没有 feature tour（`sp-guidance-frontend-inventory.md` §11：`Tooltip\|info-icon` = 0 匹配）。错题本「标记复盘」不解释、学习模式 vs 训练模式无差别说明、模考该怎么用无处可查（§C-C） |
| **什么时候验证** | **PARTIAL** | 验证协议真实且已工程化：`task-evidence` 四态 verdict（`task-evidence.ts:104-143`）、证据门（`effectiveness.assembly.ts:62-70`）、迁移探针全链（`transfer-probe.ts:21-44`）。**但验证结果只出现在报告页（藏在「测试」区），行为发生在首页/题库；探针默认关闭且挂在报告页；无任何"系统会怎么验证我"的前置说明**（§B.1 步 11、§C-D） |
| **验证后下一步** | **PARTIAL** | `NextLearningStepCard` 在 5 个面挂载（`PracticePanel`×2 / `ReportSummaryPanel` / `MistakeWorkspace` / `TodayPlan`）；`canonicalNextAction` 有严格优先级。**但两套优先级不一致，且"验证结果→下一步"的分支缺失**（探针答错之后没有 NEXT；`failed` 之后无出口）（§C-N、§N.5） |

### 为什么不是 `YES`

四个必须修的结构性缺陷，且**每一个都有明确的、零 schema 的最小修复路径**：

1. **HOW 完全缺失** —— 本设计的主体新增（G3）。当前系统把"给一个按钮"当作"教会了一件事"。
2. **WHY 可能为假** —— `priority.ts:111-121` 是一个**正在运行**的缺陷：它让引导层自己制造教学谎言。**这是第一优先修复（G1 的 K-1）**。
3. **VERIFY 错位** —— 系统最优秀的诚实资产（证据台账、verdict、拒绝判断）全部埋在报告页；把它搬到行为发生的时刻是**零逻辑的搬迁**（G2）。
4. **不会纠偏** —— 唯一现实的纠偏通道把动作渲染成无 `onClick` 的 `<li>`，`actorHint` 前端零消费（`ProactiveCoachCard.tsx:71-81`）。10 类目标错误行为中 7 类的判定数据已经在库、零 schema 就能检测，缺的只是 G-4 那一行 `onClick`。

### 为什么不是 `NO`

- **"做什么"是真实可用的**，且已有单一仲裁机制。
- **"怎么验证"的机制与词汇已经写完并且诚实**：`strong/weak/none` 三分类、`insufficient_data` 贯穿、预注册门槛、探针的"这不是普通练习"、`系统拒绝据此判断能力变化`、`未测之前系统不会替你编造分数`。这是一个**罕见的、已经建成的诚实层**。
- **不需要任何 schema 变更**即可达到 `YES`：唯一的新存储需求（投递状态）可以用既有 `RuntimeState` KV 与 `UserEvent.eventKey` 满足。
- **不需要任何新算法**：`weekly-adjustment.ts` 已经写好了学生可读的完整句子（含阈值），`proactive-coach.ts` 已经写好了每类风险的 3 个具体动作与 `actorHint`，`task-evidence.ts` 已经写好了 verdict 与 `verdictBasis`。**大量正确的文案已经存在，只是从未被送到学生面前。**

### 一句话总结

> 这个系统已经具备"解释能力"，但把解释放在了错误的位置、以不可靠的方式（理由可凑数）、用不可测的形式、讲了一部分只有开发者能读懂的话。
> **Student Operating Protocol 的工作不是建造解释能力，而是把已有的诚实资产搬到学生行为发生的那一刻，并保证它说的每一句都是真的。**

---

## 停止声明

```text
READ-ONLY AUDIT              = COMPLETE
PRODUCT DESIGN               = COMPLETE
UX GUIDANCE MODEL            = COMPLETE
LEARNING PROTOCOL            = COMPLETE
METRICS                      = COMPLETE
IMPLEMENTATION ROADMAP       = COMPLETE
```

本任务已按约定完成：**零代码改动、零 schema 变更、零数据库写入、零迁移、零 API 变更、零页面、零新 Agent、零新学习算法、零 Mastery 公式改动、零 Recommendation 公式改动、零 Score Opportunity 改动、零 Transfer Probe 改动、零部署、未启用 C1、未开始 G1 实现。**

产物：
- `docs/student-operating-protocol-design.md`（本文件，唯一设计产物）
- `docs/audit/sp-guidance-frontend-inventory.md`（只读旁证：前端引导机制清册）
- `docs/audit/sp-guidance-backend-audit.md`（只读旁证：后端学生可见语义审计）
- `docs/audit/sp-guidance-infra-audit.md`（只读旁证：测量与投递基础设施审计）

**已完成，停止。**
不实现 G1、不开始 S3、不改代码、不迁移、不 commit、不 push、不部署。
G1–G7 的取舍、排期与 A1–A7 的批准，由所有者逐项决策。
