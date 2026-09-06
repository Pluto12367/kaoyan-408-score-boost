# V9 Learning Experience OS — Baseline Audit（Phase 0）

> 日期：2026-09-07。基线：本地 HEAD `8c0e455`（V8 全部 22 commits 已推送、**未部署生产**——生产仍运行 v7 认证版，本审计以本地代码为准）。
> 测试基线：**1899 tests / 1897 pass / 0 fail / 2 skipped**（全绿）。工作树干净。
> 使命：从"AI 辅助学习工具"升级为"AI 考研教练"。约束：不改架构（CQRS/Read Model/Effectiveness 冻结）、不破坏已有能力、无伪功能、推荐全部基于 StudentState、AI 行为全部 grounded。

## 1. "教练"差距模型（Gap Model）

一个人类考研教练每天做的事，映射到系统现状：

| 教练行为 | 现状（V8 后） | 差距 | 归属 Phase |
|---|---|---|---|
| **开口就说重点**：一句综合判断（状态/风险/今天干什么/为什么） | 碎片化：canonical 卡理由（#9 仲裁）、AIInsight 卡（最弱点）、路线摘要各说各的，V8 后已统一"第一件事"但**没有统一的教练叙述** | 缺 DailyBrief：单一、接地、自然的每日简报（状态+计划+复习债+近效果合成），纯派生可测 | Phase 1 |
| **按今天的时间调整安排** | 快速会话入口在练习面板（#12），每日计划不感知"我今天只有 30 分钟" | 时长预算进入每日计划视图；教练按预算重组当天 | Phase 1 |
| **完成后的跟进**：做完肯定+重校准 | 任务完成后进度条更新，无教练跟进语（"完成后我们看效果"） | 完成事件 → 简报 followUpNote 重算 | Phase 1（slice 2） |
| **按上周效果改下周计划** | 7 天模板+弱点轮转+断档结转（V8 #13）；effectiveness 数据已有（V6.3）但**不回馈计划** | Weekly Planner 消费 effectiveness verdict + 复习债务调整下周强度/结构 | Phase 2 |
| **看得见的进步轨迹** | 报告 6 tab、掌握度趋势（null≠0 已修）、目标进度（假达成已修） | 缺进度叙事：里程碑、周环比教练解读、目标轨迹 | Phase 3 |
| **知识地图指挥行动** | Galaxy + 过滤（高频/重要度）+ 闯关 + 建议先看 | 缺"只看薄弱"过滤（backlog #32）、关系未渲染（#36）、推荐学习路径 | Phase 4 |
| **主动出手而非等提问** | proactive-coach 派生（V4）在 API 层，coachInterventions 计数器在，**无用户触达面**；AI 全部被动应答 | 风险触发的主动面（站内教练提醒），grounded 于 risks + StudentState | Phase 5 |
| **听学生反馈并实验** | 反馈面板（rating/scene/message）+ 实验引擎（V6，proposal-only、insufficient_data 诚实） | 反馈不回流实验选题；无真实 A/B 分流框架 | Phase 6 |

## 2. 可复用资产（不重建）

- **StudentContext v1**：canonical 读模型——一切教练叙述的事实来源；
- **风险/信号层**（V4）：learning-risk 6 类、learning-signals 8 类、adaptive-difficulty；
- **Effectiveness 管线**（V6/V6.3）：evidence gate、干预事件、观察性 cohort + HTTP 读端点；
- **仲裁器**（V8 #9）：selectCanonicalNextAction + resolveReportTopFocus——"一件事"语义已统一；
- **断档恢复/时长预算/复习分组**（V8 #12/#13/#14）；
- **AI 层**（V3-V5）：RAG V2、Agent 工具环、Coach 会话记忆、安全闸、双真 Provider；
- **观测**：ai/metrics + ai/learning-intelligence（V8 #41）。

## 3. 红线（每阶段检查）

1. 不建第二套 StudentState/掌握度/推荐引擎/效果存储；
2. 教练叙述只能陈述已有派生事实，**不得让 LLM 编造建议**——LLM 仅做已核实事实的语言组织（Phase 1 可选、默认纯派生模板）；
3. insufficient_data 语义贯穿：证据不足时教练说"还不能下结论"；
4. 每阶段先出设计文档再动手，RED→最小实现→全量回归（1897+ 基线零新增失败）；
5. 状态账本（current-sprint.md）随阶段更新；精确 git add，禁 add -A。

## 4. 已知长尾（继承自 V8，非 V9 阻塞）

V8 backlog 余 ~30 项 P2/P3 打磨（退出确认、错因批量、metrics 落盘、推送通道等）；#23（score-center UI 接线 or 删）与 #56（错题表回填）为所有者决策项。

## 5. 各 Phase 预案（细节见各设计文档）

- **Phase 1 Daily Coach 2.0**：DailyBrief 纯派生读模型（student context + today plan + review 债 + streak + effectiveness verdict → 结构化简报）+ /coach/daily-brief 端点 + 首页简报卡；开源参考：Strava weekly recap / Duolingo 每日讯息的"事实合成叙述"模式。
- **Phase 2 Adaptive Weekly Planner**：周计划消费上周 effectiveness verdict（effective→加量/ineffective→换法/insufficient→保持）+ 复习债务水位；纯派生 + 现有计划仓库。
- **Phase 3 Progress Dashboard**：进度叙事读模型（里程碑/周环比/目标轨迹）+ 报告页叙事卡。
- **Phase 4 Galaxy 2.0**：只看薄弱过滤、关系渲染（前置/关联已有数据）、推荐路径（先修链）。
- **Phase 5 主动教练**：risks → 站内教练提醒（轮询拉取，不做推送），grounded 引用风险证据；触达频次上限防骚扰。
- **Phase 6 反馈与 A/B**：反馈打标回流实验选题清单；确定性分流框架（用户级 hash → arm），只读实验，不自动改生产。
