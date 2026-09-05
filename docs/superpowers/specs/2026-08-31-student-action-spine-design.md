# V3 Student Action Spine Design

> 文档状态：Design Specification。本文只定义 Phase 5 的前端动作语义、适配边界和渐进迁移顺序，不包含实现代码。

## 1. Problem

V3 已经具备 Dashboard、Knowledge、Review、Practice、Assessment、Training Room 和 Contextual AI Coach 等学习入口，但“下一步行动”仍由多个 feature 分别表达。

当前动作存在四类不一致：

- 同一业务动作在 `StudentHome`、`StudentLaunchpad`、`TodayMission`、`NextLearningStepCard` 和旧学习中控台中重复表达。
- 动作通常只有展示文案和 `RoleSection`，缺少稳定的类型、来源和实体上下文。
- `plan`、`report` 等旧 section alias 会在导航边缘被归一化，业务语义因此不稳定。
- `nextActions` 多数仍是字符串，无法可靠地保留 task、question、knowledge node、assessment 或 session 的精确上下文。

这会导致用户在不同页面看到的主行动不一致，也增加跨页面导航丢失上下文的风险。Phase 5 需要收敛“展示什么行动”和“如何执行该行动”的边界，但不应创建新的业务状态系统。

## 2. Goals

- 建立纯前端、可序列化、可单测的 `StudentAction` contract。
- 让 Today、Review、Wrong Question、Knowledge、Assessment、Session、Training、Report 和 Coach 都能使用一致的动作语义。
- 保留来源实体 ID，确保动作点击可以回到现有精确业务入口。
- 将 canonical destination 与旧 `RoleSection` 导航解耦，并保留兼容映射。
- 让 Home 能够展示一个有来源、有理由、有上下文的 canonical next action。
- 逐步减少重复 CTA，但保留旧组件和现有 feature-specific command port。
- 为后续 AI Coach、Recommendation 展示和学习状态更新提供稳定的前端动作上下文。

## 3. Non-Goals

Phase 5 不包含：

- Student State schema、写入链路或 mastery 重算。
- Recommendation Engine、RecommendationService 或 review priority 算法重写。
- PracticeSession、PracticePanel、ExamSession、PracticeRecord 或 AnswerReceipt 重构。
- 新 API、Prisma schema、migration 或数据库字段。
- 统一的业务命令执行器或全量 `App.tsx` 重写。
- 新增导航 section 或替换当前 hash 导航机制。
- AI Agent、RAG、长期 Memory 或 AI 执行动作。
- 删除 `StudentLearningConsole`、Legacy Tutor 或其他旧组件。
- 修改主题在途文件、`PracticePanel.tsx` 或 `ExamSession.tsx`。
- 直接修复 V2 → V3 migration debt 测试。

## 4. Current Architecture

当前前端真实调用边界为：

```text
App.tsx
  ↓
StudentSections
  ↓
StudentHome / TestSection / MistakeWorkspace / KnowledgeCatalog / PracticePanel
  ↓
App-owned callbacks
  ↓
Existing API and business flows
```

`App.tsx` 负责数据加载、section 导航、答题与会话状态、测评提交、错题操作和 Today Task 启动。`StudentSections.tsx` 接收大量业务数据和回调，并组合各个学生页面。

当前已经存在若干局部展示模型：

- `NextLearningStep`：提供标题、理由和两个 section 级动作。
- `todayLearningRoute`：根据 TodayPlan、任务状态和任务模式选择可启动路线。
- `trainingRoomViewModel`：整理训练标题、来源、目标、进度和结果。
- `reviewCenterViewModel`：按 due、server priority redo、展示 fallback 生成 Review 页面模型。
- `useDashboardViewModel`：整理 Home 所需的今日任务、mastery、弱项和趋势。

这些模型都属于展示层，但尚未共享一个动作 contract。当前导航由 `RoleSection` 和 URL hash 承担；`plan`、`score-center` 归一到 dashboard，`report` 归一到 test。

Student State 仍是事实来源。TodayPlan、ReviewSchedule、WrongQuestionSummary、MasteryMap、Assessment/Result 和 SessionView 都是已有读取模型；Phase 5 只在其上增加前端 presentation adapter。

## 5. Action Model

### 5.1 Design principle

`StudentAction` 是不可变的展示数据，不是命令对象。它只回答：

1. 用户现在可以看到什么行动。
2. 该行动来自哪个事实或读取模型。
3. 点击时需要携带哪些稳定上下文。
4. 应该把用户交给哪个 canonical destination。

它不包含 API 方法、React callback、数据库操作、状态写入、业务计算或副作用。

### 5.2 Final action types

首版保留以下最小动作类型：

| 类型 | 语义 |
|---|---|
| `today_task` | 启动或继续 TodayPlan 中的具体任务 |
| `review_due` | 打开已有到期或逾期复习入口 |
| `redo_wrong_question` | 重做已有错题 |
| `practice_recommended` | 进入已有题目、题组或知识点练习入口 |
| `knowledge_explore` | 查看知识节点、前置知识或相关知识 |
| `knowledge_quest` | 启动已有节点闯关入口 |
| `assessment_review` | 查看某次测评的结果或报告 |
| `assessment_wrong_questions` | 从测评结果进入错题范围 |
| `assessment_practice` | 从测评结果进入后续训练 |
| `continue_session` | 恢复已有可继续的练习或测评会话 |
| `open_report` | 打开已有学习报告或报告入口 |
| `coach_explain` | 请求或打开针对已有上下文的 AI 解释 |

不单独创建 `training_next_step`、`action_executor` 或 `review_risk` 类型。Training Summary 的下一步应适配到上述动作；无法可靠映射时只作为原始文本展示，不伪造类型。

### 5.3 Fields

| 字段 | 要求 |
|---|---|
| `id` | 稳定的前端动作标识。优先使用来源实体 ID；没有自然 ID 时使用确定性的来源组合。禁止随机 UUID、时间戳或随机字符串。无法产生稳定 ID 的动作暂不进入 canonical action。 |
| `type` | 使用上表中的有限语义，不以页面名称代替动作类型。 |
| `title` | 面向用户的行动文案或命令短语，由 feature adapter 提供。 |
| `destination` | 使用 `StudentActionDestination`，不直接使用包含 legacy alias 的 `RoleSection`。 |
| `source` | 表示事实来源，必须对应真实读取模型或已有页面结果。 |
| `context` | 使用按动作类型约束的 discriminated union；禁止 `Record<string, unknown>`。 |
| `reason` | 只能透传 Recommendation、TodayPlan、Review、Report 等已有解释或事实，不由 adapter 重新计算。 |
| `priority` | 只有来源提供优先级时才填充。adapter 不创建新算法。 |

### 5.4 Stable ID policy

有自然业务 ID 的动作使用实体 ID 的确定性组合，例如 task、question、knowledge node、assessment 或 session 的 ID。复合动作的 ID 使用固定的动作类型、来源名和实体 ID 组成；同一实体在同一来源下不得因渲染次数改变。

没有实体 ID 的“查看报告”或泛化建议不得通过随机值补齐。若来源只提供无法定位的字符串，第一阶段保留为展示文本，直到来源提供可验证的稳定上下文。

### 5.5 Typed context policy

动作上下文按类型约束：

- `today_task`：必须有 `taskId`；若启动路径需要节点或题目，则同时保留已存在的 node/question context。
- `review_due`、`redo_wrong_question`：必须有 `questionId`，必要时保留 `knowledgeNodeId`。
- `practice_recommended`：至少有可定位的 `questionId`、`knowledgeNodeId` 或 `taskId` 之一；不得只有标题。
- `knowledge_explore`、`knowledge_quest`：必须有 `knowledgeNodeId`。
- `assessment_review`、`assessment_wrong_questions`、`assessment_practice`：必须有真实 `assessmentId`；没有持久化 ID 时不得伪造。
- `continue_session`：必须有 `sessionId`。
- `open_report`：如果动作针对某次测评，应保留 `assessmentId`；泛化报告入口只有在来源有稳定 report context 时才生成。
- `coach_explain`：必须带可解释的 question、knowledge node、wrong question 或 assessment context；它只打开解释能力，不执行其他动作。

当前代码中部分 TodayPlan 字段仍沿用 `knowledgePointId` 命名，但已有项目契约将相关题目映射到 knowledge node 语义。Phase 5 只在 adapter 边界按已验证契约映射，不修改该字段名、不修改 shared engine，也不进行全局 ID 重命名。

## 6. Action Type Matrix

| Action Type | 来源 | 必需 Context | Destination | Priority 来源 | 执行入口 |
|---|---|---|---|---|---|
| `today_task` | `TodayPlan.priorityTasks` | `taskId`，必要时保留 node/question context | `practice`、`review` 或 `home` | `TodayPlan` 的既有任务 priority 和状态 | `onLaunchTodayTask` |
| `review_due` | `/review/due`、`ReviewSchedule` | `questionId` | `review` | due/overdue 状态和服务端顺序 | `onOpenReview` 或既有复习入口 |
| `redo_wrong_question` | `WrongQuestionSummary.priorityRedoItems`、`WrongQuestion` | `questionId` | `practice` | 服务端 `priorityRedoItems` 顺序；无时不补算 | `onRedo` |
| `practice_recommended` | `MasteryMap`、TodayPlan、题组、知识详情、Training Summary | 至少一个真实 question/task/node ID | `practice` | 来源已有推荐或任务顺序；展示 fallback 不升级为业务 priority | `onPracticeQuestion`、`onLaunchTodayTask`、`onStartTraining` |
| `knowledge_explore` | Knowledge Catalog、Galaxy、detail | `knowledgeNodeId` | `knowledge` | 不要求 priority；可透传 importance，但不重算 | `onOpenCatalogNode` 或知识详情回调 |
| `knowledge_quest` | Knowledge detail 的 quest 能力 | `knowledgeNodeId` | `knowledge` 或 `practice` | 节点既有 quest 状态 | `onStartQuestFromCatalog` |
| `assessment_review` | `StageAssessmentResult`、Assessment history、Report | `assessmentId` | `test` | 结果上下文，不新增 priority | `onNavigate('test')` 或既有报告入口 |
| `assessment_wrong_questions` | Assessment result review items | `assessmentId`，有题目时保留 `questionId` | `review` | 结果已有 review items 顺序 | `onNavigate('wrong-book')` / 既有错题入口 |
| `assessment_practice` | Assessment result `nextActions` 或既有 action mapping | `assessmentId`，若可定位则保留 node/question | `practice` | 只使用结果提供的后续动作 | `onNavigate('question')` / 既有训练入口 |
| `continue_session` | `SessionView`、ResumeSession | `sessionId` | `practice` | session 的既有 resumable 状态 | `onResumeSession` |
| `open_report` | Report、Assessment result、已有 report action | 可选稳定 report/assessment context | `test` | Report 已提供的下一步；不自行推算 | `onNavigate('test')` |
| `coach_explain` | ContextualCoach context | question/node/assessment context | `ai` 或当前嵌入位置 | 不参与学习 priority | 现有 ContextualCoach 请求入口 |

以下动作暂不进入首版 `StudentAction`：只有模糊 `nextActions: string[]`、没有实体 ID 的“继续学习”、无法区分目标的泛化 CTA。它们继续作为 feature 文本展示，直到存在可验证的 action anchor 或稳定实体。

## 7. Adapter Architecture

所有 adapter 都是纯函数或纯 selector，输入已有读取模型，输出 `StudentAction` 或动作候选列表。它们不请求 API，不访问 Prisma，不写状态，不执行导航，也不调用 RecommendationService。

### 7.1 TodayPlan Adapter

```text
TodayPlan
  ↓ 保留 priorityTasks、status、mode、taskId 和已有上下文
todayLearningRoute 的既有可行动判断与启动预检
  ↓
today_task action candidates
```

目的不是重新排序任务，而是把当前任务路线包装为动作。`resolveTodayRoute`、`resolveTodayTaskDestination` 和已有 preflight 继续负责路线语义；若没有题目或错题内容，动作应保留 `navigate-plan` 或错误状态，不伪造练习动作。

### 7.2 Review Adapter

```text
ReviewSchedule / /review/due / priorityRedoItems
  ↓ 按已有来源顺序透传 due、overdue、server priority
review_due / redo_wrong_question
```

优先级保持：due/overdue → `priorityRedoItems` → 展示 fallback。`wrongReviewPriority.ts` 只能提供已有展示排序，不产生新的风险分数或 priority 字段。

### 7.3 Wrong Question Adapter

```text
WrongQuestionSummary / WrongQuestion
  ↓ 保留 questionId、knowledgeNodeId、nextAction 和已有统计
redo_wrong_question 或 practice_recommended
```

如果只有错题标题而没有可定位 ID，不能生成可执行动作。错题详情、错因、复习轨迹和 Contextual AI Coach 仍由原页面负责。

### 7.4 Mastery Adapter

```text
MasteryMap / node mastery
  ↓ 读取已有 weakestPoints 或节点 ID
practice_recommended / knowledge_explore
```

adapter 只使用已有弱点顺序和 ID。它不计算 mastery、不重新定义阈值、不把空值变成业务上的零分，也不把展示排序声明为 Recommendation 事实。

`fetchMyMastery` 与 `useStudentProgressData` 当前代表两种前端读取形态：节点级 `masteryById` 与 subject/point 级 `MasteryMap`。Phase 5 先通过适配器隔离差异；读取模型是否最终合并属于 P2 评估，不作为首轮动作主线。

### 7.5 Assessment Adapter

```text
StageAssessment / StageAssessmentResult / Assessment history / Report actions
  ↓ 使用真实 assessmentId，按结果已有动作语义映射
assessment_review / assessment_wrong_questions / assessment_practice / open_report
```

只有持久化 assessment history ID 才能生成带 `assessmentId` 的动作。当前结果中的字符串 `nextActions` 只有在已有稳定映射时才转换；未知文本保留为显示信息。

### 7.6 Session Adapter

```text
SessionView / ResumeSession
  ↓ 读取现有 resumable 状态和 sessionId
continue_session
```

adapter 不维护第二套 session 状态，不启动、不提交、不恢复 session；点击后仍交给 `onResumeSession` 和现有 `usePracticeSession` 链路。

### 7.7 Training Summary Adapter

```text
TrainingRoomViewModel / PracticeSetResult / StageAssessmentResult / PaperSubmitResult
  ↓ 透传已有 result 与 nextActions；仅对已知 action anchor 做结构化映射
StudentAction candidates 或原始展示文本
```

Training Room 仍是体验层。不能通过解析自然语言猜测训练命令，也不能在 adapter 内重新计算正确率、mastery 或下一步推荐。

### 7.8 Report Adapter

```text
Report / learningInsights / existing report actions
  ↓ 使用已有 action mapping 和稳定上下文
open_report / review_due / redo_wrong_question / practice_recommended
```

Report adapter 只把已有报告结论映射成展示动作，不把预测分数、弱点排序或文案重新计算成新的业务事实。

### 7.9 Coach Adapter

```text
StudentAction context
  ↓ 生成解释所需的只读 context
coach_explain
```

Coach 可以解释一个动作为什么出现，但不负责解析、排序或执行 `StudentAction`。它仍然只能读取 Contextual Coach 输入并返回说明。

## 8. Destination Architecture

`RoleSection` 当前同时承担可见导航、兼容别名和业务目标，不适合作为动作模型的 canonical destination。Phase 5 定义更小的前端目标集合：

| Canonical destination | 当前 section 映射 |
|---|---|
| `home` | `dashboard` |
| `practice` | `question` |
| `knowledge` | `knowledge-catalog` |
| `review` | `wrong-book` |
| `test` | `test` |
| `ai` | `ai` |

`plan`、`score-center`、`report` 等 legacy alias 不进入 `StudentActionDestination`。它们只在边缘映射层转换到 canonical destination，保持现有 URL hash 和角色权限行为。

动作目标与实际 command port 仍然分离：同一个 destination 不代表同一个命令。比如 `review` 可能是打开详情、标记复盘或重做题目，具体执行入口由 action type 和 context 决定。

## 9. Command Port Strategy

Phase 5 第一阶段不引入统一 `executeAction`。采用：

```text
StudentAction
  ↓
feature-specific command port
  ↓
existing App handler
```

继续保留并逐步标准化以下 command port：

| Command port | 保持原因 |
|---|---|
| `onLaunchTodayTask` | 需要 task preflight、题目内容和错题内容检查 |
| `onOpenReview` | 现有复习详情与 section 状态由 App 管理 |
| `onRedo` | 需要 questionId 并进入现有答题链路 |
| `onPracticeQuestion` | 需要 questionId、标题和当前题目状态 |
| `onOpenCatalogNode` | 需要 focusNodeId 和知识详情状态 |
| `onStartQuestFromCatalog` | 需要节点闯关上下文 |
| `onStartAssessment` / `onSubmitAssessment` | 受现有测评配置和会话生命周期约束 |
| `onResumeSession` | 需要完整 `SessionView`，不能只传 section |
| `onNavigate` | 作为无精确实体上下文的兼容边界，逐步减少直接使用 |

第一阶段允许在 Student 组合层增加一个穷举映射函数，把动作映射到上述 port，但该函数不能包含业务计算或 API 调用。只有当动作类型和 context 稳定后，才评估是否需要统一 facade。

## 10. Home Canonical Action

Home 的 canonical next action 是候选动作的展示层选择，不是新的 Recommendation Engine。候选和选择规则如下：

1. 若已有 session 状态明确可恢复，优先展示 `continue_session`。
2. 否则使用 TodayPlan 现有路线选择的第一个可启动任务，生成 `today_task`。
3. 没有可启动今日任务时，使用 `/review/due` 的 due/overdue 候选。
4. 没有 due/overdue 时，使用服务端 `priorityRedoItems`。
5. 没有上述候选时，使用已有 Report/Assessment next action。
6. 如果只有无 ID 的展示 fallback，显示辅助信息，不把它升级为可执行 canonical action。

这套规则只在不同来源之间选择第一个可展示候选，不改变来源内部 priority。TodayPlan 内部继续由已有任务 priority 和路线函数决定；Review 内部继续由 due/overdue、服务端 priority redo 和展示 fallback 决定。

Home 最终只突出一个 canonical action，其余动作降级为辅助入口或页面内列表。每个 canonical action 至少显示 title、source、reason（如来源提供）和精确 context；点击后仍调用现有 command port。

## 11. Feature Integration

### Home

- 将 TodayPlan、可恢复 session、Review due、priority redo 和 Report 候选转换为统一动作。
- `StudentHome` 只消费展示模型和 command port。
- `QuickActions` 保留为探索性快捷入口，不冒充 canonical next action。
- `StudentLaunchpad`、`TodayMission` 和 `NextLearningStepCard` 逐步复用 adapter 输出。

### Review

- 优先卡片使用 due/overdue 或服务端 `priorityRedoItems` 的动作。
- 继续保留原有精确错题列表、筛选、详情、复盘、重做和变式练习。
- 展示 fallback 明确标记为展示排序，不称为风险事实。

### Knowledge

- Galaxy、Tree 和 Detail Drawer 共用 knowledge action adapter。
- 所有知识动作保留 `knowledgeNodeId`。
- 查看节点、相关知识、练习和闯关使用不同动作语义或明确的 command mapping，不能都降成无上下文的 `practice`。

### Assessment

- 结果页将查看报告、查看错题、继续练习和后续训练分别映射。
- 真实 `assessmentId` 始终透传。
- 无持久化 ID 时保留当前 fallback，不创建伪造动作上下文。

### Training

- Training Room 使用动作适配器解释现有 result 和 nextActions。
- 不改变 PracticePanel、ExamSession、usePracticeSession 或提交流程。
- Summary 无法可靠映射的字符串动作继续按文本展示。

### AI Coach

- 可在动作卡旁提供 `coach_explain`，解释推荐来源、知识节点或测评结果。
- AI 不参与 canonical action 选择，不修改 action priority，不执行 command port。

## 12. Mastery Read Boundary

Student State 和已有 read model 继续是唯一事实来源：

- `MasteryMap` 提供 subject/point 级弱点与掌握展示。
- Knowledge Catalog 的 `masteryById` 提供 node 级掌握事实。
- `ReviewSchedule` 和 `/review/due` 提供复习状态。
- TodayPlan 和任务状态提供今日行动来源。
- Assessment、SessionView 和结果对象提供测评与训练上下文。

Action adapter 只能读取这些数据，不能：

- 把 null mastery 转成业务上的 0。
- 从错题数量重新计算 mastery 或遗忘风险。
- 从标题猜测 knowledge node ID。
- 从字符串文案猜测不存在的业务 action。
- 创建第二套 mastery、review 或 priority 状态。

`fetchMyMastery` 与 `useStudentProgressData` 的读取路径差异先作为适配边界处理。若后续发现同一动作无法可靠获得稳定 node ID，再将其作为单独的 P2 read-model convergence 议题，不在首轮改后端。

## 13. Testing Strategy

### Unit tests

为每个 adapter 建立纯函数测试，验证：

- action type
- canonical destination
- source
- stable id
- required context
- priority 是否只来自来源
- null/缺失数据的安全表现

最低覆盖：TodayPlan、Review due、WrongQuestionSummary、MasteryMap、AssessmentResult、SessionView、TrainingSummary。

### Contract tests

验证 `StudentAction`：

- 不包含 API client。
- 不包含 Prisma 或数据库依赖。
- 不包含 React callback。
- 不包含可执行命令函数。
- 不包含新的 Student State 字段或写入方法。
- context 为有限且按 type 约束的字段集合。

### Navigation tests

使用真实 action fixture 验证：

- Today task 保留 taskId 并进入原有 launch port。
- Review/redo 保留 questionId。
- Knowledge 保留 knowledgeNodeId。
- Assessment 保留 assessmentId。
- Session 保留 sessionId。
- legacy destination 能映射到正确的 `RoleSection`。

### UI tests

至少覆盖：

- Home 只突出一个 canonical next action。
- Review action 遵循 due → server priority redo → display fallback。
- Knowledge action 点击后仍打开现有详情或练习入口。
- Assessment action 区分报告、错题和继续练习。
- Training Summary 不重新计算 mastery 或准确率。
- AI Coach 只作为解释入口。

### Verification gate

触碰前端时运行仓库既有 `npm run build:web`、受影响的 Node tests，以及在环境允许时的全量 `npm test`。Windows `spawn EPERM` 需与 TypeScript、模块解析和断言失败分开记录。

## 14. Migration Strategy

采用可独立测试、可独立提交的渐进迁移：

### Phase 5.1：Action contract

- 定义 `StudentActionType`、`StudentActionDestination` 和按类型约束的 context。
- 定义来源与稳定 ID 规则。
- 建立 contract tests。

### Phase 5.2：Today / Review

- 建立 TodayPlan adapter 和 Review adapter。
- Home 首先接入 canonical next action。
- 保留原有任务启动、复习和错题回调。

### Phase 5.3：Knowledge / Assessment

- 接入 Galaxy、Knowledge Tree、Detail Drawer 和 Assessment Result。
- 保留 node ID 和 assessment ID。
- 为错误或缺失 ID 增加显式不可执行状态。

### Phase 5.4：Training / Session

- 接入 Training Room Summary 与可恢复 session。
- 只结构化已有稳定 action anchor。
- 不改 Practice/Exam 提交流程。

### Phase 5.5：Home convergence

- 统一来源候选选择。
- Home 只突出一个 canonical action。
- 将其他入口降级为辅助动作。

### Phase 5.6：CTA cleanup

- 合并重复展示，不删除旧组件。
- 对 `StudentLearningConsole` 先确认引用关系，再单独决定是否清理。
- 将历史 migration debt 维持在独立任务中。

## 15. Risks

### R1：动作语义过早统一

不同入口需要不同参数和副作用。过早引入统一执行器会把 App 的复杂命令逻辑集中化。缓解方式是首轮只统一数据模型和 adapter，保留 command port。

### R2：来源读取模型不一致

`masteryById` 与 `MasteryMap` 是不同形态的读取数据。若 adapter 直接假设它们完全同构，可能丢失 node context。缓解方式是保留来源类型，先做前端适配，不做后端合并。

### R3：nextActions 字符串无法可靠结构化

Training、Assessment 和 Report 部分动作仍是字符串。禁止通过文案猜测命令；无法确认时维持文本展示，并为后续来源增加稳定 anchor。

### R4：重复 CTA 造成优先级冲突

多个旧组件可能同时展示不同的“下一步”。缓解方式是先增加 canonical action，再降级辅助卡片；不在首轮删除 Legacy 组件。

### R5：导航 alias 隐藏真实目标

`RoleSection` 的 legacy alias 可能让 action destination 与实际页面不一致。缓解方式是使用 canonical destination，并在单一边缘映射层转换。

## 16. Acceptance Criteria

### Product

- Home 能展示一个来源明确、上下文准确的 canonical next action。
- Today task 点击后仍经过原有 task preflight 和 launch 流程。
- Review 顺序保持 due/overdue → server `priorityRedoItems` → display fallback。
- Knowledge action 保留 `knowledgeNodeId`，可以定位到现有详情或练习入口。
- Assessment action 保留真实 `assessmentId`，报告、错题和练习语义不混淆。
- Session action 保留 `sessionId`，恢复逻辑不变化。
- Training Summary 不重新计算业务指标。
- AI Coach 只能解释动作，不能选择或执行动作。
- 同一页面不再突出多个相互冲突的高优先级 CTA。

### Architecture

- Action model 是纯数据，不包含 API、数据库、React callback 或副作用。
- Adapter 不调用 RecommendationService，不修改 Student State，不创建 StudyPlan、StudyTask 或 ReviewSchedule。
- Recommendation Engine 继续是 priority 和学习决策的唯一来源。
- Student State 继续是事实来源。
- Practice、Exam、Review、Knowledge 和 Assessment 的现有 command port 保持兼容。
- 不修改冻结文件和其他工作线。

### Quality

- 所有 adapter 具备 unit/contract tests。
- 关键 destination 和 context 具备 navigation tests。
- Home、Review、Knowledge、Assessment、Training 的 UI tests 通过。
- `npm run build:web` 通过；若 Windows 环境仍有 `spawn EPERM`，须单独记录且不能伪装为代码通过。
- clean checkout 能解析新增的前端 action 模块及其依赖。

## 17. Open Questions

当前没有阻塞实现的开放架构问题。以下决策已固定：

- 首轮采用 Shared Action ViewModel，不采用完整 Action Registry。
- 首轮不引入 `executeAction`。
- canonical destination 独立于 `RoleSection`。
- 没有稳定实体 ID 的动作不进入可执行 canonical action。
- `wrongReviewPriority.ts` 不升级为风险引擎。
- `fetchMyMastery` 与 `MasteryMap` 先由 adapter 隔离，读取模型合并属于后续 P2 评估。
- Phase 5 不修改后端、数据库、Student State 写链路或答题链路。

