# AI Learning Companion Productization — Milestone Final Report

> 日期：2026-09-06。分支 `feature/v3-product-refactor`（含 v3.2-ai-agent-production checkpoint 之后增量）。
> 范围：PX-1 → PX-5，将 AI 基础设施转化为用户可感知的学习产品能力。
> 硬约束遵守：未修改 Prisma Schema / Mastery Engine / Recommendation Engine 核心逻辑 / Practice 写路径；未绕过 StudentContext；Agent 层零数据库访问；未引入新事实源（Coach Session 存现有 RuntimeState 表，非事实源、可重建）。

## 1. 最终验收清单

| 验收项 | 状态 | 证据 |
|---|---|---|
| Coach Session Memory | ✅ | `coach-session.ts`（纯模型）+ `CoachSessionRepository`（RuntimeState 持久化）；短期=有界近期消息、中期=Learning Memory 注入、长期=StudentContext；零事实副本 |
| Conversation Compression | ✅ | `appendAndCompress`：>12 条自动折叠进 summary/goals/unresolvedIssues；30 轮对话 token 有界且信息保持（测试钉死） |
| Personalized Coach Prompt V2 | ✅ | `buildPersonalizedPromptSections` 四段契约（student_profile/learning_memory/recent_behavior/current_goal）；三水平学生输出差异+guardrail 保持 |
| Daily Agent | ✅ | `DailyPlanningService` + `POST /agent/daily/plan`；Adaptive Adjustment 基于 mastery evidence 纯规则（reduce/maintain/challenge），不由 LLM 判断 |
| Exam Simulator | ✅ | `POST /agent/exam/generate|analyze`；试卷题目全部来自真实题库、覆盖节点来自 RAG 检索+引擎优先级——LLM 零参与内容生成 |
| Tutor Mode | ✅ | Socratic 序列（recall→why→contrast→apply）+ 三层解释（beginner/exam/interview）+ 误区检测（5 类错因→认知模式） |
| Multi-Agent foundation | ✅ | Agent Protocol（类型化信封+correlationId+citations）+ SupervisorAgentService（4 意图路由）；specialist 互不引用（源码隔离测试钉死） |
| Evaluation | ✅ | `px-eval-productization.test.js`：planner feasibility/workload/alignment、exam coverage/difficulty accuracy、tutor misconception、coach personalization |
| Performance/Metrics | ✅ | AiMetrics 扩展：rag.cacheHitRate、evaluation（runs/passRate/avgScore/suites）、DeepSeek usage（上期已有） |
| Tests / Build / Docs | ✅ | PX 新增 52 项测试（12+7+8+13+7+5）；build 全 PASS；本报告+current-sprint 更新 |

## 2. 分阶段交付

### PX-1 Contextual Coach Productization

**Design Gate**：CoachConversationSession 不建新表——存现有 RuntimeState key/value 表（key=`coach-session:{userId}`）。理由：会话摘要是对话派生状态而非学习事实；RuntimeState 语义即"运行时状态"；Schema 冻结纪律不破。无 DB 时 repository 显式降级（enabled=false → 单轮行为，不静默）。

- **分层**：短期=recentMessages（≤12 条，单条 ≤500 字符）；中期=Learning Memory（调用时注入 prompt，不存入 session）；长期=StudentContext（永不复制进 session）。
- **压缩**：`appendAndCompress` 溢出即折叠——学生轮按规则提取 goals（学会/掌握/安排/计划…）与 unresolvedIssues（疑问句/不懂/还是…），折叠内容并入 summary（≤400 字符）。确定性、无 LLM。
- **Prompt V2**：`conversation`（session brief ≤900 字符）与 `personalization`（四段）注入 user prompt JSON 信封（可选字段，向后兼容）；base guardrail prompt 原样保留。
- **向后兼容**：旧客户端（无 sessionId）在 repository 可用时自动续接既有会话并开始收到 sessionId 字段；repository 不可用时响应形状与 PX 前逐字节一致（测试钉死）。

### PX-2 Daily AI Study Agent

- **DailyStudyPlan**：date / adjustment(level+reasons) / goals / recommendedTasks(validatePlan 过滤后) / reviewTasks(高风险错题) / riskAlerts(逾期、低正确率、3 天未练习) / execution / evidence 透明披露。
- **Adaptive Adjustment（证据驱动）**：`deriveDifficultyAdjustment`——accuracy<0.5→reduce；completion≥0.8 且 accuracy≥0.75→challenge（预算升档 60→120）；其余 maintain。全部输入来自 StudentContext（practice.recentAccuracy / plan.completion.rate / review.due），**LLM 不参与判断**。
- **触发模型（Design Gate）**：幂等端点供外部调度器/应用每日入口调用（generationKey=`DAILY:{userId}:{date}:v1`，与 learning-loop 的 LEARNING_LOOP 命名空间隔离）；不引入调度依赖，多实例并发由 StudyPlan 唯一约束收敛。

### PX-3 AI Exam Simulator

- **生成（LLM 零参与）**：RAG V2 检索真实知识节点（coverage）+ 推荐引擎预览（考频/优先级证据）+ StudentContext mastery（难度配额）→ `buildExamPaper` 纯函数从**真实题库**选题：coverage 优先轮转（跨最多知识点）、难度 mix 按 mastery 适配（弱→BASIC 50%、强→HARD 50%）、priority hint 决胜。
- **分析**：`analyzeExam` 纯统计——per-point 正确率、weak（<60%）/strong（≥80%）分档、nextStepSuggestion；数字全部确定性计算，LLM 只能在叙事层装饰。
- **写入边界**：mastery 唯一写方仍是 ScoreCenterService（学生真实作答经既有 practice 提交路径）；考后计划经 supervisor 组合 planner（validate-only，execute 显式）——exam agent 不直接调用 planner（隔离测试钉死）。

### PX-4 AI Tutor Mode

- **Socratic**：`buildSocraticSequence` 生成递进提问（recall→why→contrast(misconception 驱动)→apply），每个问题带 expectedDirection（教师参考方向，不作为答案展示）；`checkUnderstanding` 规则判据（on_track/needs_redirect+hint）。
- **三层解释**：beginner（规则+条件+一个例子）/ exam（考点题型+易错+同源题验证）/ interview（设计动机+相邻机制对比+系统影响）——同一节点事实的三种 register，输出必然不同（测试钉死）。
- **Misconception Detection**：判题引擎 5 类错因（概念不清/知识点混淆/计算失误/审题/速度）→ 5 种认知模式（conceptual_gap/adjacent_confusion/procedural_error/misreading/fluency_gap），按证据计数排序出 dominant，附教学建议；证据来自错题投影（read-only 工具）。

### PX-5 Multi-Agent Architecture

- **Agent Protocol**：`AgentProtocolRequest{intent,userId,correlationId,payload}` / `AgentProtocolResponse{correlationId,from,ok,data,citations}`；`CooperatingAgent` 契约（name/intents/handle）。**代理间零数据库共享、零内部引用**——Tutor/Planner/Exam/Coach 四个 specialist 通过 adapter 加入系统，互相不可见（源码隔离测试逐文件断言）。
- **Supervisor**：`detectIntent` 确定性关键词路由（考试/安排/解释/默认 coach）+ 显式 intent 覆盖；每跳记录 `supervisor.routed` 日志；exam 响应携带 citations（真实节点 id）。
- **端点**：`POST /agent/supervisor/run`（RoleGuard，body userId 拒绝）。

## 3. Evaluation 扩展（指标即断言）

`test/px-eval-productization.test.js` + 各 phase 套件：

| 面 | 指标 | 断言 |
|---|---|---|
| Coach | personalization | 三水平学生输出两两不同；guardrail 全保留 |
| Planner | feasibility | totalMinutes ≤ 预算；单任务 ≤ 90min |
| Planner | workload balance | 无重复节点；任务数合理区间 |
| Planner | mastery alignment | mastered 节点必不出现在最终计划 |
| Exam | knowledge coverage | 6 题覆盖 6 个不同知识点（coverage 优先轮转） |
| Exam | difficulty accuracy | 弱→BASIC、强→HARD 方向正确 |
| Tutor | misconception detection | 三组错因组合的 dominant 判定全对 |

## 4. Metrics 扩展

- `snapshot.rag.cacheHitRate`：热索引命中比例（`KnowledgeSearchService` 每次搜索上报）。
- `snapshot.evaluation`：评测事件流（suite/passRate/avgScore）——运行时评测可通过 `recordEvaluation` 接入，评测套件结果可外推到 Dashboard。
- 其余（agent tokens/latency P95/failureRate、coach fallbackRate）沿用上期。

## 5. 单向依赖验证

```
StudentContext (canonical, 只读)
      ↓
Learning Memory（纯派生）/ Coach Session（对话派生，RuntimeState）
      ↓
RAG V2 / Agent Tools（六+扩展只读工具）/ Tutor / Planner / Exam / Supervisor
      ↓
Canonical Writer（唯一写通道：createStudyTask → generateDailyPlanFromState；
mastery 唯一写通道：ScoreCenterService ← 既有 practice 提交路径）
```

源码边界测试持续钉死：agent 层无数据库客户端引用、无写原语；specialist 互不引用。

## 6. 新增/修改文件清单

新增：
- `apps/api/src/study/`：coach-session.ts、coach-session.repository.ts
- `apps/api/src/agent/`：adaptive-difficulty.ts、daily-planning.service.ts、exam-simulator.ts、exam-simulator.service.ts、tutor-mode.ts、tutor.service.ts、agent-protocol.ts、supervisor.service.ts
- `test/`：px1-coach-productization、px2-daily-agent、px3-exam-simulator、px4-px5-tutor-multiagent、px-eval-productization（5 文件，52 项）
- `docs/px-ai-learning-companion-final-report.md`（本文件）

修改：
- `apps/api/src/study/`：contextual-coach.service.ts（session 编排+个性化）、contextual-coach.prompt.ts（prompt 可选字段）、contextual-coach.types.ts（sessionId/session 可选字段）、ai-tutor.service.ts（透传）、study.module.ts（CoachSessionRepository、LearningMemoryService 注册）
- `apps/api/src/agent/`：agent.module.ts、agent.controller.ts（daily/exam/supervisor 端点）
- `apps/api/src/rag/knowledge-search.service.ts`（cacheHit 上报）
- `apps/api/src/ai-metrics/ai-metrics.service.ts`（cacheHitRate/evaluation）
- `docs/current-sprint.md`

## 7. 验证结果

- PX 套件：PX-1 12/12、PX-2 7/7、PX-3 8/8、PX-4/5 13/13、评测 7/7、metrics 回归 12/12 → 合计 **59/59**。
- Coach 既有回归（12 文件）75/75：Prompt V2 与 session 字段向后兼容实证。
- 全量 `npm test`（最终门禁）：**1717 tests / 1690 pass / 25 fail / 2 skipped**——25 失败与接管时预存基线完全一致，零新增（门禁首轮曾出现 1 个模块 exports 契约断言过时，修复归零后复跑确认）。
- 构建：`build:shared` PASS；`build:api` EXIT=0；`build:web` PASS（`✓ built in 8.92s`）。
- AI 域组合回归（foundation+production+PX 全部 24 个测试文件）：**136/136 PASS**。

## 8. 遗留风险与建议

1. **外部调度器未部署**：Daily Agent 以幂等端点交付；接入云函数/CI cron 或前端每日入口由部署侧决定（接口已稳）。
2. **Coach Session 的 RuntimeState 存储**：单用户单会话语义（每用户一 key）；多设备并发写同一会话以最后写入为准——对学习伙伴场景可接受，未来如需多会话需契约演进。
3. **题库-节点精确映射（已关闭，2026-09-06 增量 7c7b4ff）**：新增只读 `ExamQuestionRepository`（`QuestionKnowledgeNodeTag` 按 knowledgeNodeId 索引查询，仅 isCurrent 题、有界 take、学生安全投影）。Exam Simulator 生成时把检索节点+引擎优先节点的精确题与科目级候选合并去重、按节点 mastery 加权；DB 不可用时回退科目级路径（行为不变，测试钉死）。
4. **Socratic 检查为规则判据**：理解度判定基于关键词/结构启发；接入 LLM 后可在 guard 框架内增强语义判定。
5. **远程 LLM 链路**：与上期相同，协议层 stub 全覆盖，真实冒烟建议在配置 key 后执行。

## 9. 结论

四个产品面（Coach 学习伙伴、Daily Agent、Exam Simulator、Tutor Mode）+ Multi-Agent 骨架全部落地：每一条 AI 能力仍然单向依赖 StudentContext，写入只经 canonical writer，内容真实性由真实题库/真实节点保证，难度调整由 mastery evidence 驱动。八项最终验收全部达成。
