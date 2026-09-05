# 408 提分系统 V4 产品功能蓝图

> 文档性质：V4 产品能力定义与技术决策输入。仅描述产品目标、能力边界和分阶段路线，不代表本轮已经实现任何 V4 功能。
>
> 事实基线：当前分支 `feature/v3-product-refactor`，HEAD `ac81e26`。代码优先于历史文档；本文件引用的当前能力以 `apps/web/src`、`apps/api/src`、`packages/shared/src` 和 `prisma/schema.prisma` 为准。
>
> 范围约束：本阶段不开发 OverviewReportProjection、RAG、Agent、UI 重构、API 变更、Schema/Migration 或 AI 行为变更。

## 1. Current V3 Reality

### 1.1 当前产品形态

V3 已经不是普通题库，而是一个可运行的 408 学习闭环：诊断 → 计划/今日任务 → 题目训练 → 作答与反馈 → 掌握度/错题更新 → 复习与推荐 → 阶段测评 → 报告。Sprint 4 的 AI Training Room 已封板，Phase 1 Knowledge Identity Boundary 已完成（代码验证充分，但 Web Vite/full test 仍受 Windows `spawn EPERM` 环境限制）。

当前学生侧导航由 `apps/web/src/layouts/RoleNavigation.tsx` 固定为：首页、题库、知识、错题、测试五项。AI 没有学生一级导航；ContextualCoach 嵌入题目、错题、知识节点和测评场景。`StudentSections.tsx` 仍保留 `ai`/`report`/`plan`/`score-center` 兼容 section，但学生导航会把这些 section 归并到首页或测试。

### 1.2 已验证的核心事实与边界

| 领域 | V3 真实状态 | 证据 |
|---|---|---|
| 答题事实 | `PracticeRecord` 记录用户对题目的行为，真实知识字段为 `knowledgePointId`；会话提交也最终写 PracticeRecord | `prisma/schema.prisma` `PracticeRecord`; `apps/api/src/study/study.service.ts` |
| 掌握度事实 | `UserKnowledgeMastery` 按 `userId + knowledgeNodeId` 唯一，Score Center 的 `applyAttempts/applyReview` 是新链路写入方，带 OCC `version` | `prisma/schema.prisma`; `apps/api/src/score-center/service.ts` |
| 错题/复习 | `WrongQuestionReview` 表示复盘状态；`ReviewSchedule`/`ReviewAttempt` 表示排期与复习行为 | `prisma/schema.prisma`; `wrong-question-projection.service.ts` |
| 计划/任务 | `StudyPlan`→`StudyTask` 持久化计划；`StudyTaskProgress`/`StudyTaskCompletion` 记录任务进度与完成 | `prisma/schema.prisma`; `student-state-projection.service.ts` |
| 推荐 | shared `runRecommendation` 以 Node 为 canonical identity，RecommendationService 组装 UserKnowledgeMastery、考频、关系和复习事实，再通过 adapter 兼容旧 StudyTask/DTO | `packages/shared/src/score-center`; `apps/api/src/study/recommendation.service.ts` |
| 读模型 | `/student-state` 是新状态快照；`/dashboard/overview`、`/mastery-map`、部分报告/计划端点仍通过 compat query 或 legacy DTO 提供兼容 | `study.controller.ts`; `dashboard-query.service.ts`; `student-state-query.service.ts` |
| 知识目录 | Knowledge 页面使用前端 408 树和 `/knowledge/mastery` 的 Node mastery；详情通过 `/knowledge/:id` | `KnowledgeCatalog.tsx`; `apps/web/src/api/endpoints/score-center.ts` |
| AI | ContextualCoach 只读组装 Student State 与当前场景，调用 DeepSeek（配置时）或模板 fallback；不写计划、任务、掌握度或复习 | `contextual-coach-context-assembler.service.ts`; `contextual-coach.service.ts`; `ai-tutor.service.ts` |
| RAG/Agent | 当前没有 embedding、向量库、reranker、证据检索流水线、tool calling 或 agent loop | 全仓 `rg` 审计；AI 服务仅构造 prompt 并调用 LLM |

### 1.3 当前用户能力地图（V3）

| 能力 | 当前可用体验 | 当前数据/API | V3 产品问题 |
|---|---|---|---|
| 首页/学习总览 | StudentHome 展示目标、今日任务、掌握摘要、错题/复习入口、学习日历和下一步 | `/dashboard/overview`（compat）、`/today/plan`、`/review/due`、`/wrong-questions/summary`、`/knowledge/mastery` | 总览仍组合多个 payload；overview 与 Student State 的报告口径尚未完全收敛 |
| 题库/Training Room | 推荐题组、单题作答、会话保存/恢复、即时判题、错因、自信度/提示、变式题和答后 ContextualCoach | `/practice-sets/recommended`、`/practice-records`、`/sessions/practice/*`、`/practice-sets/:id/submit` | 题库内容质量和多知识点归因仍依赖导入与桥接；长会话体验需要持续验证 |
| 知识 | 四科知识树、搜索/筛选、节点掌握度、关联题和真题、节点闯关 | `/knowledge/mastery`、`/knowledge/:id`、`/knowledge/:id/quest`；部分目录来自前端静态 JSON | 目录展示与 PracticeRecord Point identity 仍需清晰的产品解释；完整知识图谱关系不是 V4 默认承诺 |
| 错题/Review Center | 错题列表、错因筛选、复盘标记、笔记、原题重做、变式练习、到期复习队列 | `/wrong-questions`、`/wrong-questions/summary`、`/review/due`、detail/note/reason 路由 | Point 与 Node 通过 adapter/mapping 连接，旧 DTO 仍存在；复盘后动作闭环需要更明确的产品成功标准 |
| 测试/报告 | 阶段测评、测评历史、成绩趋势、掌握度/薄弱点/行动/资源标签页、考试报告 | `/assessments/stage`、`/assessment-history`、`/reports/overview`、`/exam/report/:sessionId`；报告页面嵌在 `TestSection` | 仍有 legacy overview/report 组合；“成绩提升”与“掌握提升”尚未统一成单一解释模型 |
| 学习计划 | 入学诊断生成七日计划；今日任务可开始、延期、重排、减负、完成；任务完成可触发次日计划 | `/onboarding/*`、`/today/plan`、`/tasks/*`、`StudyPlan/StudyTask` | 多实例 Learning Loop 幂等仍是已登记 P1；任务与作答精确归因仍有限 |
| AI 辅导 | 题目、错题、知识节点、测评四类上下文解释；标准解析/错因/下一步建议；旧 Tutor API 兼容 | `/ai/contextual-coach`；`/ai/tutor-reply`、`/ai/follow-up` | 配置 Key 才是真实模型；fallback 是模板；没有检索证据和可执行工具 |
| Training Room | 从首页/今日任务/题库进入统一训练壳，显示目标、进度、下一步和答题反馈 | `TrainingHero/Progress/Summary` + `PracticePanel` + session/practice APIs | 仍是训练体验壳，不等同于独立“AI 学习代理”或完整课程播放器 |

### 1.4 V3 的产品结论

V3 已解决“能不能形成闭环”，但还没有完全解决“学生是否持续理解为什么做、做完是否真的提升、系统是否能以统一口径解释结果”。V4 应以可验证的学习结果为中心，收敛体验和解释，不以增加基础设施数量为目标。

## 2. V4 Product Vision

### 2.1 产品目标

V4 的目标是让一个 408 备考学生在每个学习日都能完成四个可验证动作：

1. 知道当前最值得解决的一个薄弱问题，以及证据是什么。
2. 完成一个与该薄弱问题匹配的最小训练动作。
3. 复盘错误并用相邻题/变式题验证是否迁移。
4. 在周期性报告中看到“掌握、正确率、速度和测评成绩”是否共同改善。

产品承诺不是“AI 替学生学习”，而是“系统把事实、下一步和解释连接起来，并允许学生验证结果”。

### 2.2 产品原则

- **结果优先**：所有推荐都要能回指到作答、复习、测评或题库证据。
- **一个事实，多种视图**：Student State/Node mastery 是个性化决策事实；Point identity 只用于 PracticeRecord 和兼容边界。
- **动作小而可完成**：每次推荐优先给出 10–30 分钟内可完成的动作，而不是泛化的课程清单。
- **AI 解释不越权**：AI 提供解释、对比、提示和复盘问题，不直接修改学习状态。
- **渐进增强**：模型不可用时，规则和模板仍提供透明、可验证的体验。
- **不制造复杂度**：只有当产品指标证明瓶颈来自吞吐、检索或协作时，才引入新基础设施。

## 3. User Scenarios

以下场景是 V4 的产品验收单元；“现有”表示可由 V3 代码支撑，“新增”表示需要后续产品/工程任务。

| 场景 | 用户目标与痛点 | 目标体验/流程/自动化 | 数据与现有能力 | AI / RAG / Agent 需求 | V4 增量与验收 |
|---|---|---|---|---|---|
| S1 今日诊断 | 不知道今天先学什么，首页信息太多 | 首页给出一个主任务、证据、预计耗时和完成定义；完成后自动刷新下一步 | Student State、StudyTask、ReviewSchedule、Recommendation | 不需要 RAG/Agent；ContextualCoach 可解释证据但不执行 | **现有增强**；点击主任务能进入正确训练，完成后状态和推荐刷新 |
| S2 诊断后起步 | 新用户没有足够历史，怕计划不可信 | 初始诊断后生成可解释的 7 日起步路径；无历史时显示低置信度 | User 目标字段、StudyPlan/Task、诊断接口 | 不需要 RAG/Agent；可用模板解释冷启动规则 | **现有增强**；每个任务标注“为什么现在做” |
| S3 薄弱点修复 | 看到低分但不知道是概念、速度还是粗心 | 把弱点拆成一个知识节点、一个错因和一组最小题；完成后做验证题 | UserKnowledgeMastery、PracticeRecord、Recommendation | RAG 非必需；Agent 不应决定弱点，Coach 可生成复盘提示 | **现有增强**；弱点卡可追溯 evidenceRecordIds，并完成至少一次验证题 |
| S4 推荐训练 | 推荐题常像随机题库 | 先解释目标，再给 5–10 题训练组，支持中途保存和继续 | Node recommendation、QuestionKnowledgeNodeTag、LearningSession | 不需要 RAG/Agent；规则引擎负责选择，AI 只解释 | **现有增强**；训练组只使用单一 Node ID 空间，提交后更新 Student State |
| S5 错题复盘 | 反复看答案但仍会错 | “看错因→复述规则→原题重做→变式验证”四步引导 | WrongQuestionReview、ReviewSchedule、PracticeRecord、ContextualCoach | RAG 后置；Agent 不可自动标记解决/排期 | **现有增强**；四步状态可见；无 mapping 时禁止错误跳转 |
| S6 知识节点学习 | 知识树是目录，不知道与题目/考试的关系 | 节点详情显示掌握、关联题、真题频次和下一动作 | KnowledgeNode、UserKnowledgeMastery、QuestionKnowledgeNodeTag、Exam tags | 可先用结构化事实；RAG 仅在讲义内容规模证明需要时 | **现有增强**；不把 Point ID 当 Node ID，能从节点进入训练/闯关 |
| S7 阶段测评 | 测试分数与平时掌握度割裂 | 结束后展示成绩变化、暴露节点和下一次验证动作 | AssessmentHistory、LearningSession、PracticeRecord、mastery snapshots | 不需要 RAG/Agent；Coach 可解释结果但不能改状态 | **现有增强**；报告区分“测评分数”和“节点掌握度” |
| S8 计划失约 | 计划太满，延期后更焦虑 | 允许延期/减负，保留原因并重新平衡当天动作 | StudyTask、StudyTaskProgress、UserEvent、Recommendation | 不需要 RAG；Agent 不应绕过现有任务命令 | **现有增强**；减负不删除事实，次日计划变化可解释 |
| S9 AI 题目辅导 | 只想问当前题，不想复制上下文 | 答题后直接问“为什么错/提示一步”，引用当前题和个人记录 | ContextualCoach question context、PracticeRecord、Question | 当前结构化 context 足够；RAG/Agent 均非必需 | **现有增强**；Key 不可用时显示模板来源，AI 不声称修改掌握度 |
| S10 AI 错题复盘 | 错题原因表达不清 | 根据错题、错因和最近历史提出复盘问题与对比提示 | ContextualCoach wrong_question context、WrongQuestionProjection | RAG 后置；Agent 不创建任务或复习排期 | **现有增强**；输出只能是解释/建议 |
| S11 学习进步证明 | 想知道“我是否真的提高” | 每周报告同时显示准确率、速度、掌握节点、错题解决率、测评趋势 | PracticeRecord、UserKnowledgeMastery、ReviewAttempt、AssessmentHistory | 不需要 RAG/Agent；可用模板解释样本量和置信度 | **新增产品视图**；必须给出时间窗口、样本量和数据不足提示 |
| S12 教师干预 | 教师不知道该帮助哪一类学生 | 教师看到授权学生的风险分层和可干预动作，不直接替学生改状态 | Teacher class analytics、Student State、授权关系 | 不需要 RAG/Agent；未来可让 Coach 生成沟通草稿 | **新增产品增强**；查看严格按授权，建议可追溯到事实 |

### 场景优先级

- **P0**：S1、S3、S4、S5、S7、S11。它们直接决定提分闭环是否可解释、可验证。
- **P1**：S2、S6、S8、S9、S10。它们提升起步、知识理解和辅导体验。
- **P2**：S12，以及更丰富的教师协作和长期学习画像。

## 4. Capability Map

| V4 capability domain | 要解决的问题 | 当前状态 | V4 定义 | 关键事实/依赖 |
|---|---|---|---|---|
| Learning Diagnosis | 学生不知道最关键的薄弱点及原因 | Partial | 将目标、作答、错因、速度、节点掌握和测评结合成可解释诊断 | PracticeRecord + UserKnowledgeMastery + AssessmentHistory |
| Adaptive Practice | 学生知道弱点，却没有合适的下一组题 | Partial | Recommendation Engine 选择 Node，再由题目标签生成单一目标训练组 | RecommendationService + QuestionKnowledgeNodeTag |
| Knowledge Learning | 知识目录与练习脱节 | Partial | 节点详情成为“理解→练习→验证”的入口 | KnowledgeNode + map/tag + related questions |
| Intelligent Review | 复习靠记忆原题，不能验证迁移 | Partial | ReviewSchedule 驱动复习，错因与变式题形成闭环 | WrongQuestionReview + ReviewSchedule + PracticeRecord |
| AI Tutor | AI 回答没有当前学习上下文 | Implemented (V3 baseline) | ContextualCoach 解释当前事实，透明显示模型/fallback 来源 | ContextualCoach + AiTutorService |
| AI Learning Agent | 希望系统自动连续编排学习行动 | Design only | 未来可在明确权限、工具、审计和回滚后做受限编排 | 依赖稳定 Student State、工具契约和评估；V4 不默认交付 |

### 能力边界

V4 的“智能”主要来自高质量状态、确定性推荐、可解释复盘和上下文 AI，而不是让 LLM 直接成为事实源。AI Learning Agent 只能作为后续受控能力，不应在 V4 早期绕过 Recommendation/Student State。

## 5. Navigation Map

V4 保持学生五项一级导航，不新增“AI”顶级导航：

```text
首页（Today / Diagnosis / Progress）
├─ 今日主任务 → Training Room
├─ 当前薄弱点 → Knowledge node / Practice
├─ 到期复习 → Review Center
└─ 本周进步 → Overview Report

题库（Adaptive Training）
├─ 推荐训练组
├─ 专项/章节训练
└─ Training Room（答题、反馈、ContextualCoach）

知识（Knowledge Galaxy）
├─ 四科目录与搜索
├─ Node mastery / 证据
└─ 关联题、真题、闯关、ContextualCoach

错题（Review Center）
├─ 今日复习队列
├─ 错因与笔记
└─ 原题重做 / 变式验证 / ContextualCoach

测试（Assessment & Report）
├─ 阶段测评
├─ 测评历史与趋势
└─ Overview Report（总览、掌握、行动、资源）
```

计划、报告、AI 都是上下文能力或二级工作区，不恢复为互相割裂的顶级入口。教师/管理员导航继续与学生导航分离。

## 6. Feature Matrix

| Feature | V3 current | V4 goal | Frontend surface | Backend/SoT | RAG | Agent | Priority |
|---|---|---|---|---|---|---|---|
| 今日主任务 | 已有 StudentHome + TodayPlan | 一个主任务 + 证据 + 完成定义 | Home / Training Room | Student State + StudyTask + Recommendation | No | No | P0 |
| 弱点诊断卡 | 有 WeaknessReport/Node mastery 两种视图 | Point 行为事实与 Node 掌握解释并列呈现 | Home / Report / Knowledge | PracticeRecord + UserKnowledgeMastery | No | No | P0 |
| 自适应训练组 | 已有 recommended practice set | Node-only selection，题目标签可审计 | Question / Training Room | Recommendation Engine + QuestionKnowledgeNodeTag | No | No | P0 |
| 错题四步闭环 | 已有复盘、重做、变式入口 | 复盘步骤可见且可验证 | Review Center | WrongQuestionReview + ReviewSchedule + PracticeRecord | No | No | P0 |
| 节点学习页 | 已有目录、掌握、关联题 | 解释 Point/Node 边界，节点到练习可追踪 | Knowledge | KnowledgeNode + mapping/tag | Optional later | No | P1 |
| 阶段测评 | 已有测评、历史和考试报告 | 分数/掌握/错题变化统一解释 | Test / Report | AssessmentHistory + LearningSession + Student State | No | No | P0 |
| 进步报告 | 已有组合式报告 | 新 Overview read model（后续任务）统一时间窗口、样本和证据 | Test / Report | Projection over facts; no new SoT | No | No | P0 |
| ContextualCoach | 已实现四类 context + fallback | 在每个关键动作后提供受限解释和复盘提示 | embedded in Question/Review/Knowledge/Test | ContextAssembler + AiTutorService | No | No | P1 |
| AI evidence answer | 目前 prompt context，无检索 | 只有在内容规模/错误率证明需要时增加检索证据 | embedded Coach | future retrieval boundary | Later | No | P2 |
| AI Learning Agent | 未实现 | 受限、可审计的建议编排；不直接写事实 | future contextual action | future tools over existing commands | Optional | Later | P2 |
| 教师干预台 | class analytics 已有 | 风险分层、证据和授权动作 | Teacher | authorized Student State views | No | No | P2 |

## 7. Technology → Feature Mapping

| Technology / pattern | Current status | Product feature it enables | V4 decision |
|---|---|---|---|
| Student State projection | Existing | 首页、诊断、报告、AI context 的事实快照 | 保持为事实入口；不要新增第二套状态 |
| Knowledge Graph (`KnowledgeNode` + relations) | Existing | 知识目录、前置关系、节点学习 | 先用于导航和解释；不承诺复杂图谱可视化 |
| Recommendation Engine | Existing | 今日主任务、训练组、计划 | 继续作为确定性选择器；输出不得被 AI 改写 |
| Overview/Report projection | Partial/design | 进步报告、统一掌握口径 | 作为 Phase 2 产品能力；先完成 contract/parity，再切消费者 |
| RAG | Not implemented | 大规模知识内容问答、证据化讲解 | 仅在内容检索成为瓶颈时进入 Phase 4 |
| Hybrid retrieval | Not implemented | 关键词 + 语义检索题目/讲义 | 依赖内容库规模、检索指标和权限边界 |
| pgvector/vector search | Not implemented | RAG 候选召回 | 当前 PostgreSQL 只承载业务事实；不提前加 Schema |
| Reranker | Not implemented | 多候选证据排序 | 只有召回质量被测量证明不足时引入 |
| Evidence/citation | Partial | AI 回答可解释性 | V4 先要求引用已组装的题目/错题/节点事实；真正 chunk citation 后置 |
| Prompt versioning | Partial | AI 回归与安全 | 记录 prompt/model/source，后续补版本 ID 与评估集 |
| AI evaluation | Existing targeted tests | fallback、字段校验、unsafe output | 扩展为场景级离线评估，不改变业务事实 |
| Observability | Partial | AI fallback/延迟诊断 | 保留 structured log；后续再统一 tracing |
| Tool calling | Not implemented | 受控执行“开始训练/查看复习”等动作 | V4 不开放写入工具；先使用前端显式按钮 |
| Agent loop | Not implemented | 连续规划/执行/验证 | V4 不做；需权限、预算、审计、回滚后再评估 |
| OpenTelemetry | Not implemented | 跨请求/AI/队列 trace | 当前单体规模不足以成为 P0；可在性能问题出现时引入 |
| CI/CD | Existing scripts/workflows | 构建、测试、部署和回归 | 优先修复环境可复验性与 release gates |
| Redis | Not implemented | 缓存、限流、队列 | 当前单实例 + PostgreSQL 事实足够；不提前引入 |
| PostgreSQL | Existing | 用户、题库、学习事实、计划、复习 | 继续作为业务事实存储 |
| Docker Compose | Existing | 本地/测试/生产运行 | 保持；只有部署规模变化才评估编排平台 |

## 8. New Technology Recommendations

V4 需要的新技术不是默认依赖，而是按产品验收门槛逐项引入：

1. **OverviewReportProjection（代码能力，不是新基础设施）**：先统一报告所需事实、时间窗口和 ID 契约，再迁移消费者。
2. **AI prompt/evaluation registry（轻量文件或表级版本记录）**：在扩大 AI 场景前，让每次 prompt/model/fallback 变化可回归。
3. **检索抽象接口（先不接向量库）**：当内容证据不足时，先定义 `retrieve → rank → cite` 边界，允许初期使用 PostgreSQL/关键词实现。
4. **Tracing（可选）**：当 ContextAssembler、LLM、检索链路的 P95 或失败定位成为瓶颈时，再引入 OpenTelemetry。

每项都必须通过“技术增加闸门”：

- 没有现有产品能力能解决该用户问题吗？
- 有可量化的失败指标或容量指标吗？
- 能否先用当前 PostgreSQL/Node 单体做小规模验证？
- 新组件是否会改变事实写入、身份隔离或 API 兼容？
- 是否有回滚、降级和观测方案？
- 是否有专人维护与测试预算？

## 9. Technology NOT Recommended Now

| 技术 | 结论 | 真实理由 | 重新评估条件 |
|---|---|---|---|
| Kafka | NOT RECOMMENDED NOW | 当前事件是 UserEvent + 事务后触发，产品没有跨服务事件吞吐需求；先解决多实例幂等 | 事件量、异步消费者和可靠投递成为已测瓶颈 |
| Kubernetes | NOT RECOMMENDED NOW | 当前 Docker Compose/单体部署足够，K8s 不会直接提升提分闭环 | 多实例弹性、隔离和运维团队成熟 |
| Microservices | NOT RECOMMENDED NOW | StudyService 尚有单体债务，拆服务会扩大一致性和部署风险 | 明确领域边界、独立扩缩容和团队 ownership |
| Service mesh | NOT RECOMMENDED NOW | 当前无多服务流量治理需求 | 微服务数量和 mTLS/流量策略达到门槛 |
| Elasticsearch | NOT RECOMMENDED NOW | 当前题库和知识目录规模可由 PostgreSQL/内存投影支持；先测检索质量 | 内容规模、复杂全文检索或运营搜索成为瓶颈 |
| MQ（通用） | NOT RECOMMENDED NOW | Learning Loop 主要是同一事务后的幂等触发，不应先用 MQ 掩盖事务边界 | 明确异步任务 SLA、重试与死信需求 |
| Nacos | NOT RECOMMENDED NOW | 当前不是 Java 微服务集群，配置/发现复杂度不匹配 | 采用多服务架构且需要集中配置/发现 |
| pgvector | NOT RECOMMENDED NOW（Phase 4 候选） | 当前没有 RAG 证据链和 embedding 评估，Schema 变更会扩大范围 | 有内容规模、召回指标和数据生命周期方案 |

## 10. Learning Loops

### Loop A — 诊断 → 训练

```text
Goal / PracticeRecord / UserKnowledgeMastery
        ↓
        Diagnosis
        ↓
Node-based Recommendation
        ↓
Training Room
        ↓
PracticeRecord + Mastery update
```

状态：**Partial → V4 P0**。选择和写入已存在，需补统一证据展示与报告验证。

### Loop B — 错题 → 复盘 → 变式

```text
Wrong answer
  → mistake reason
  → review schedule
  → explanation / note
  → original redo
  → variant verification
  → resolved / next review
```

状态：**Partial → V4 P0**。组件和 API 已存在，产品验收要以“变式正确/掌握状态变化”而非“看过详情”为完成。

### Loop C — 知识节点 → 题目 → 掌握

```text
KnowledgeNode
  ↔ Point/Node mapping + QuestionKnowledgeNodeTag
  → related questions
  → practice
  → UserKnowledgeMastery
  → node detail/report
```

状态：**Partial → V4 P1**。Identity Boundary 已建立，Overview/report 仍需明确 Point 行为与 Node 掌握如何并列表达。

### Loop D — AI 解释 → 学习动作 → 再验证

```text
Current context + Student State
  → ContextualCoach explanation
  → student chooses explicit action
  → practice/review/assessment
  → new facts
```

状态：**Existing explanation / Partial loop → V4 P1**。AI 不执行写入；动作必须由现有按钮/命令触发，避免 Agent 越权。

## 11. Phase 2–6 Roadmap

路线按产品成熟度排列，技术名称只是实现手段：

| Phase | 产品目标 | 交付边界 | 退出标准 |
|---|---|---|---|
| Phase 2 | 可信的学习总览 | 建立 OverviewReportProjection/adapter 契约，统一报告的时间窗口、Node/Point 标识和证据；迁移一个消费者 | 首页/报告核心数字由同一事实快照解释，旧 API 仍兼容，contract/parity 通过 |
| Phase 3 | 可验证的自适应训练 | 主任务、推荐题组、错题复盘和变式验证形成一条可追踪 action spine | 每次推荐可回指 Node/证据；完成训练后推荐和状态可重复计算 |
| Phase 4 | 证据化 AI 学习助手 | 评估内容检索需要后，再接 `retrieve → rank → cite`；保持 Coach 只读和 fallback | AI 回答能区分事实/推断并展示证据，检索失败可降级，离线评估达标 |
| Phase 5 | 受控的主动学习编排 | 在已有命令上提供有限的多步建议，不直接成为事实写入者 | 工具权限、幂等、审计、预算、人工确认和回滚齐备 |
| Phase 6 | 可规模化的学习运营 | 教师干预、群体洞察、性能和多实例一致性按真实负载演进 | 以用户留存、完成率、掌握提升和运营 SLA 验证，不以基础设施数量验收 |

## 12. Highest Priority Next Task

**下一任务：Phase 2 — Overview Report Read Model Contract & One-Consumer Migration。**

为什么现在做：V3 已有 Student State、Recommendation 和 ContextualCoach，最大的产品断点是首页、报告、推荐和 AI 对“掌握/薄弱/进步”的解释可能来自不同 read path。继续堆叠 AI 或新推荐功能会放大不一致。先定义 Overview projection 的事实契约、Point/Node 双空间呈现规则和一个消费者的 parity 迁移，能以最小范围提升用户信任。

依赖：Knowledge Identity Boundary Phase 1 验收；现有 `OverviewReportSnapshot/Selector`、Student State projection、legacy adapters；不依赖 Schema 变更或 RAG。

不在下一任务中做：重写 Student State 写路径、改 PracticeRecord 语义、改变 Recommendation 算法、改变 AI 行为、引入数据库迁移、恢复 AI 一级导航。

## 13. Risks / Unknowns

| 风险/未知 | 级别 | 证据与影响 | 处理策略 |
|---|---|---|---|
| `/dashboard/overview` 与部分报告仍由 legacy compat 提供 | P1 | `dashboard-query.service.ts` 明确在 legacy 存在时委托 `StudyService` | Phase 2 做事实契约和单消费者迁移，保留旧 contract |
| Point/Node 两套掌握视图仍需产品解释 | P1 | `OverviewReportSelector` 同时输出 Point weak selection 与 Node mastery candidates | 所有 V4 DTO 显式携带 idType；禁止模糊 `id` |
| 多实例 Learning Loop 幂等非原子 | P1 | `docs/current-sprint.md` 已登记 | 在产品扩大规模前做原子幂等设计；不由 V4 文档隐式解决 |
| 题库内容/标签质量 | P1 | 题库导入与 `QuestionKnowledgeNodeTag` 依赖教研/桥接数据 | 以标签 provenance、内容审核和覆盖率作为发布门槛 |
| AI_API_KEY/模型服务不可用 | P2 | `AiTutorService` 有明确 template fallback | 前端透明显示 source/fallbackReason，指标分开统计 |
| Web Vite/full test 的 Windows `spawn EPERM` | P2 环境 | 当前验证记录为环境限制，不是业务断言通过 | 在具备正常子进程权限的环境完成 release 复验 |
| 前端静态目录与数据库知识目录可能不同步 | P2 | `KnowledgeCatalog.tsx` 使用打包的 catalogData，同时 mastery 来自 API | Phase 2/3 建立目录版本和缺失提示；不静默使用假数据 |
| `StudyService`/`App.tsx` 巨型文件 | P2 | 架构文档和代码规模已登记 | 只在功能边界稳定后按垂直切片拆分 |
| 真正 RAG/Agent 的收益尚未被指标证明 | P3 | 全仓无 retrieval/tool/loop 实现 | 先定义失败指标和离线评估，再过技术闸门 |

## 14. Open Decisions

1. Overview Report 第一批迁移消费者选首页还是测试报告页；建议优先选择用户频率更高、依赖较少的首页摘要。
2. 报告的“掌握度”主指标是否只展示 Node mastery，Point 行为指标是否以“练习表现”单独命名；不得继续用同一字段混合两者。
3. V4 是否需要把“变式题正确”作为错题解决的硬门槛，还是允许教师/用户确认；需产品实验数据支持。
4. AI 证据引用先展示结构化事实来源，还是等内容 chunk 化后统一实现；当前建议先做前者。
5. 教师干预动作是否只读建议，还是允许经过确认后调用既有任务命令；在工具审计前保持只读。

## 15. Evidence Index

主要代码证据：

- 学生导航与页面组合：`apps/web/src/layouts/RoleNavigation.tsx`、`apps/web/src/features/student/StudentSections.tsx`、`apps/web/src/features/student/home/StudentHome.tsx`、`apps/web/src/features/report/ReportWorkspace.tsx`、`apps/web/src/features/test/TestSection.tsx`。
- 前端 API：`apps/web/src/api/endpoints/dashboard.ts`、`score-center.ts`、`review.ts`、`practice.ts`、`sessions.ts`、`onboarding.ts`、`tutor.ts`。
- 后端路由与兼容层：`apps/api/src/study/study.controller.ts`、`dashboard-query.service.ts`、`student-state-query.service.ts`、`dashboard-projection.service.ts`、`student-state-projection.service.ts`。
- 推荐与训练：`apps/api/src/study/recommendation.service.ts`、`practice-set-recommendation.adapter.ts`、`packages/shared/src/score-center/recommendation.ts`、`apps/web/src/features/practice/training-room/`。
- 错题/复习：`apps/api/src/study/wrong-question-projection.service.ts`、`apps/web/src/features/mistakes/MistakeWorkspace.tsx`、`reviewCenterViewModel.ts`。
- AI：`apps/api/src/study/contextual-coach-context-assembler.service.ts`、`contextual-coach.service.ts`、`ai-tutor.service.ts`、`contextual-coach.prompt.ts`、`apps/web/src/components/ContextualCoach.tsx`。
- 数据模型：`prisma/schema.prisma`（User、Question、KnowledgePoint、PracticeRecord、WrongQuestionReview、ReviewSchedule、StudyPlan、StudyTask、LearningSession、UserEvent、AnswerReceipt、KnowledgeNode、KnowledgePointNodeMap、QuestionKnowledgeNodeTag、UserKnowledgeMastery、UserNodeQuest）。
- 阶段和风险：`docs/current-sprint.md`、`docs/DEVELOPMENT_LOG.md`、`docs/handoff/2026-08-30-v3-sprint3.6-handoff.md`、`docs/ARCHITECTURE.md`、`docs/PROJECT_CONTEXT.md`。

本文件完成后停止在产品定义阶段；任何 Phase 2 实施必须另行确认范围、修改文件、验证门禁和 commit 边界。
