# V8 Master Backlog（55 项，证据支撑）

> 来源：`docs/v8-full-product-audit.md`（U/B/T/P 证据编号保留，便于追溯）。排序原则见审计 §6。
> 执行状态标记：⬜ 未开始 / 🔨 进行中 / ✅ 完成。每项完成时追加 Before/After/Evidence 记录。

## P0 — 信任与状态安全（立即执行）

| # | 项 | 来源 | 状态 |
|---|---|---|---|
| 1 | 修复 useStudentContextData 竞态：请求序号守卫 + refresh 检查 enabled + auth 切换作废 in-flight（4 个 B 类测试已 RED，修产品即转绿，消除跨账号串数据风险） | T2 | ✅ |
| 2 | 掌握度百分比格式化：全局一位小数以内（41.6462%→41.6% 或 42%），建 shared formatPercent 工具并替换报告/错题/知识消费点 | P2 | ✅ |
| 3 | 移除学生可见内部术语："Canonical Overview 未定义该指标"改为学生语言（如"完成一次阶段测评后生成"） | P1 | ✅ |
| 4 | 掌握度趋势图 null→不渲染（无快照日留空/虚线，不画 0% 柱） | P3 | ✅ |
| 5 | 目标进度矛盾修复：目标分默认值不再等于估分；"还差 0 分"需校验 targetScore>estimated 才显示，否则提示"先设置目标分" | P4 | ✅ |
| 6 | 22 项测试债分类处置：4 项 B 类随 #1 转绿；14 项 A 类过时断言改写到 wrongReviewPriority 新架构或删除；2 项 C 类重写为语义标记断言——换取 npm test 全绿、CI 门禁恢复 | T1/T3/T7 | ✅ |
| 7 | 错题计数统一口径：定义"待复盘/当前错题/已复盘/重做解决"唯一计算式，错题页与报告共用一个 selector（先出口径文档再动代码） | P5 | ✅（措辞精确化+口径文档；深层对账拆至 #56） |

## P1 — 已建能力的最后一公里（高价值）

| # | 项 | 来源 | 状态 |
|---|---|---|---|
| 8 | 首页唯一今日卡：合并 StudentActionCard/TodayMission/TodayLearningRoute 为单一"今日焦点"模块（一个任务、一个理由、一个开始按钮），其余任务降级为列表 | U5/P7 | ⬜ |
| 9 | 全局"下一步"仲裁：建立单一 pickNextBestAction selector（输入 StudentContext+risks+review+plan），四页（首页/题库/错题/报告）共用，保证"最重要的一件事"全产品一致 | P7 | ⬜ |
| 10 | effectiveness 前端消费第一刀：报告页新增"努力与效果"卡（复用 V6.3 summary/outcomes，insufficient_data 显示"继续积累一周数据"） | U16/B10 | ⬜ |
| 11 | TodayMission 任务行透出 reason（GET /today/plan 透传结构化 reasonCodes，B1 后端先行，前端渲染理由标签） | B1/U6 | ⬜ |
| 12 | 时长预算入口："我有 15/30/60 分钟"快速会话——后端开放 composeDailyPlan 四档引擎到经典闭环，前端首页加预算选择 | B7/U22 | ⬜ |
| 13 | 断档恢复：重建窗口时结转 overdue 任务（按 priorityScore 压缩进未来 N 天），/today/plan 返回 recoveredFromGap，首页显示"已为你把 X 个逾期任务排进本周" | B5/P9 | ⬜ |
| 14 | 复习卡去重聚合：同考点多题聚合为一张卡（"Cache 映射与替换 · 5 题待复习"），点开看题目列表 | P6 | ⬜ |
| 15 | 顶栏 API 状态聚合多资源（任一关键资源失败即显示降级） | U17 | ⬜ |
| 16 | 考试倒计时贯通：targetExamDate→sprint-plan/exam 端点暴露 examCountdown，报告与首页展示倒计时；缺省时用 remainingDays 推算 | B4/B9 | ⬜ |
| 17 | 首跑向导前置：未完成 onboarding 时 dashboard 只渲染向导（其余模块骨架占位），完成后渐进展开 | U20 | ⬜ |
| 18 | practice-sets/recommended 附带结构化 evidence（每题节点正确率/考频），前端"为什么是这些题"面板 | B8 | ⬜ |
| 19 | 题目真题来源展示：经 QuestionKnowledgeNodeTag+frequency snapshot 派生 examYears[]，练习反馈与错题详情显示"2019/2023 真题考点" | B12 | ⬜ |
| 20 | 数据覆盖率观测端点：/admin/data-quality（无标签题数、无 PRIMARY 映射点数、无考频快照节点数），把静默排除变成清单 | B13 | ⬜ |

## P2 — 体验摩擦（按价值逐个清）

| # | 项 | 来源 | 状态 |
|---|---|---|---|
| 21 | AI 分区加入学生导航（侧边栏+底部栏） | U1 | ⬜ |
| 22 | "调整计划"死链修复：跳转首页计划折叠区并展开，或移除该按钮 | U2 | ⬜ |
| 23 | 删除死代码 TodaysScoreCenter/StudentLearningConsole（或恢复 score-center 入口，二选一） | U3 | ⬜ |
| 24 | 闯关离开确认（questContext 将丢失时提示） | U4 | ⬜ |
| 25 | 会话退出/Esc 二次确认（"已自动保存，下次从这里继续"） | U8 | ⬜ |
| 26 | 静默恢复会话后显示"已恢复到第 N/Y 题" | U9 | ⬜ |
| 27 | 错因弹窗批量处理：提交后一次收集（复选+统一提交），取消逐题连发 | U10 | ⬜ |
| 28 | 测评/模考开始前确认页（题数/时长/模式） | U11 | ⬜ |
| 29 | 错题行"做同考点变式"名实一致（直接进入变式练习） | U12 | ⬜ |
| 30 | 删除"即将到期"空 tab 或实现 true 预到期窗口（未来 3 天） | U13 | ⬜ |
| 31 | 学生手动"标记已掌握/暂不再复习"出口 | U14 | ⬜ |
| 32 | 知识图谱"只看薄弱"过滤 | U15 | ⬜ |
| 33 | 薄弱口径统一（薄弱信号计数单一来源） | P12 | ⬜ |
| 34 | "本周学习节奏"严格 7 天窗口，8 月旧任务按 #13 结转清理 | P9 | ⬜ |
| 35 | 可恢复会话列表聚合去重（同类型合并+显示相对时间），空名按钮修复 | P10 | ⬜ |
| 36 | Knowledge Galaxy 渲染节点关系（prerequisite/related 已有数据），"0 条已知关系"清零 | P11 | ⬜ |
| 37 | 题库 1/328 与预计时长自洽（按题组时长或显示"全天训练流"） | P14 | ⬜ |
| 38 | 中英文混搭清理（Welcome back/Daily Mission/Learning Trend 等统一中文） | 生产走查 | ⬜ |
| 39 | "目标院校待设置"补设置入口 | 生产走查 | ⬜ |
| 40 | 移动端底部导航改主题变量 | U18 | ⬜ |

## P3 — 打磨与基建

| # | 项 | 来源 | 状态 |
|---|---|---|---|
| 41 | ai-metrics 7 个未接线 record 方法接生产者或删除；暴露 GET /ai/learning-intelligence（admin） | T4 | ⬜ |
| 42 | ai-metrics 定期落盘（复用 RuntimeState/Prisma），支撑趋势 | T5 | ⬜ |
| 43 | beta-metrics 增加 DAU 按日序列 + 人均 session 时长（LearningSession 字段已齐） | T6 | ⬜ |
| 44 | deploy-pages.yml 触发分支扩展 + 期望失败清单门禁（随 #6 完成后直接转严格门禁） | T7 | ⬜ |
| 45 | verify-deep-interactions 进 CI/staging 定时；中期评估 Playwright | T8 | ⬜ |
| 46 | staging-smoke 补 /ai/metrics、/admin/metrics 冒烟 | T9 | ⬜ |
| 47 | 任务 skip 语义（与 postpone 分离） | B2 | ⬜ |
| 48 | 推送通道调研落地（Phase 30 范围：先做站内提醒中心，推送后置） | B3 | ⬜ |
| 49 | StudyPlan.stale 字段处置（启用或删除迁移） | B6 | ⬜ |
| 50 | contentFingerprint 偏唯一索引 + 数据校验脚本进 CI | B11 | ⬜ |
| 51 | LearningTrend 柱高语义化（改为题量或时长，去合成权重） | U7 | ⬜ |
| 52 | InitializationCore 假等待改真实资源加载（或压缩至 <1.5s） | U21 | ⬜ |
| 53 | mobile-nav 测试升级为真实 DOM 渲染断言 | U19 | ⬜ |
| 54 | 错题"审题错误 83 次"→针对性策略卡（审题类错因专项训练入口） | 生产走查 | ⬜ |
| 55 | 学习画像 timeline"入学诊断 2026-09-07"时间戳异常排查（学生 8 月已开始练习） | 生产走查 | ⬜ |
| 56 | 错题本与 canonical WrongQuestionReview 表漂移对账（23 vs 12）：数据来源审计 → resolved 回写策略 → 迁移评估（架构保护边界，设计先行） | P5/新 | ⬜ |

## 执行节奏

按 P0→P1 顺序串行推进，每项走 DISCOVER→TDD→IMPLEMENT→VERIFY→REGRESSION→DOCUMENT→COMMIT。P0 #1 起步（测试已 RED）。里程碑门禁：P0 全部完成 + npm test 全绿后，进入 P1 批量执行。
