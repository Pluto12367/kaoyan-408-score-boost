# Student Action Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax (- [ ]) for tracking.

**Goal:** 在不改变后端、Student State、Recommendation Engine、答题链路和现有导航兼容性的前提下，为 Student 端建立统一的 StudentAction 展示模型，并渐进收敛 Home、Review、Knowledge、Assessment、Training 和 Session 的下一步动作。

**Architecture:** 现有 Read Model 继续作为唯一事实来源；各 feature 通过纯 adapter 生成可序列化的 StudentAction，再交给现有 feature-specific command port。第一阶段只统一动作数据和 canonical destination，不引入统一业务执行器，不把动作对象变成命令对象。

**Tech Stack:** React 18.3, TypeScript 5.5 strict, Vite 5.4, React Hooks, Node node:test, TypeScript transpileModule, 当前 hash 导航与既有 API client。

**Spec:** docs/superpowers/specs/2026-08-31-student-action-spine-design.md

## Global Constraints

- 只允许修改 apps/web 与 Phase 5 直接相关的 test/*.test.js；不修改 API、Prisma、migration、shared engine 或数据库。
- Student State、Recommendation Engine、PracticeRecord、AnswerReceipt、StudyPlan、StudyTask、ReviewSchedule 的业务写入和计算保持不变。
- StudentAction 是纯数据；不包含 API 方法、数据库依赖、React callback、业务计算或副作用。
- 不引入 executeAction() 作为全局业务执行器；动作通过现有 command port 进入既有 App handler。
- 不修改 apps/web/src/features/practice/PracticePanel.tsx、apps/web/src/components/ExamSession.tsx、apps/web/src/hooks/usePracticeSession.ts 或主题文件。
- 不新增 API 请求；需要复用已有 fetchDueReviews、TodayPlan、MasteryMap、Knowledge Catalog、Assessment、SessionView 等数据。
- 不创建第二套 mastery、review、priority、session 或推荐状态。
- 不新增 Redux、Zustand、React Context、StudentAction store 或 Review store；共享读取模型只在现有 App/StudentSections 组合边界传递。
- wrongReviewPriority.ts 只保留展示 fallback 角色，不升级为风险引擎。
- 不能通过文案猜测 action；没有稳定实体 ID 或 action anchor 的字符串只保留原文展示。
- 当前工作区中的 AGENTS.md、主题文件、Knowledge Galaxy、Review Center、Smart Review、其他文档和测试均保持原归属，不得混入 Phase 5 commit。
- 对已经存在未提交修改的文件，修改前后必须分别查看 git diff -- <file>；如果同一 hunk 混合两个工作线，停止该 Task 并拆分后再继续。
- 每个 Task 先写失败测试，再实现最小变更，再运行定向测试，最后使用精确路径提交；禁止 git add .、git add -A 和 git commit -am。
- 每个跨页面里程碑运行 npm run build:web；最终按仓库门禁运行受影响测试、全量 npm test 和 clean checkout 验证。
- 当前真实 HEAD 为 6eed109 docs: close out sprint 4 training room；docs/current-sprint.md 中的旧 HEAD 记录属于状态漂移，实施阶段不得据此扩大范围。

---

## File Change Map

### Create

- apps/web/src/features/student/actions/studentAction.ts：动作类型、来源、按类型约束的 context、运行时结构守卫。
- apps/web/src/features/student/actions/studentActionDestination.ts：canonical destination 与 RoleSection 的边缘映射。
- apps/web/src/features/student/actions/adapters/todayActionAdapter.ts：TodayPlan 当前可启动任务到 today_task。
- apps/web/src/features/student/actions/adapters/reviewActionAdapter.ts：due、priority redo 和展示 fallback 到 Review actions。
- apps/web/src/features/student/actions/adapters/knowledgeActionAdapter.ts：知识探索、关联练习和闯关 actions。
- apps/web/src/features/student/actions/adapters/assessmentActionAdapter.ts：阶段测评结果和可验证 follow-up actions。
- apps/web/src/features/student/actions/adapters/reportActionAdapter.ts：报告已有动作到 report/练习/复盘 actions。
- apps/web/src/features/student/actions/adapters/sessionActionAdapter.ts：可恢复 SessionView 到 continue_session。
- apps/web/src/features/student/actions/adapters/trainingActionAdapter.ts：Training Summary 的显式结构化动作桥接。
- apps/web/src/features/student/actions/canonicalNextAction.ts：候选列表的展示层选择器。
- apps/web/src/features/student/actions/actionCandidates.ts：跨来源候选组装的纯函数。
- apps/web/src/features/student/actions/studentActionCommand.ts：动作到既有 command port 所需参数的纯数据描述，不执行命令。
- apps/web/src/features/student/actions/StudentActionCard.tsx：只负责渲染 action，不执行 API 或业务写入。
- test/student-action-contract.test.js：contract 与按类型 context 测试。
- test/student-action-destination.test.js：canonical destination 映射测试。
- test/student-action-adapters.test.js：Today、Review、Knowledge、Assessment、Session、Training adapter 测试。
- test/student-action-navigation.test.js：action context 到既有 command port 参数的映射测试。
- test/student-action-ui.test.js：Home、Review、Knowledge、Assessment、Training UI 接入测试。

### Modify

- apps/web/src/App.tsx：仅在需要共享 /review/due 读取结果时增加最小 read-model wiring；不改变核心业务 handler。
- apps/web/src/features/student/StudentSections.tsx：接收候选 action 和最小 command port，保留现有所有 props 与 section 组合。
- apps/web/src/features/student/home/StudentHome.tsx：显示一个 canonical next action，保留 TodayMission、QuickActions 和原有入口。
- apps/web/src/features/mistakes/MistakeWorkspace.tsx：复用 review adapter 结果，保持筛选、详情、复盘、重做和变式练习。
- apps/web/src/features/mistakes/components/PriorityReviewCard.tsx：在不改变现有回调的前提下使用统一 action 展示数据。
- apps/web/src/features/mistakes/components/ReviewQueue.tsx：使用 due action 的稳定 question context。
- apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx：把现有节点、相关题和 quest 回调映射到 knowledge actions。
- apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx：仅在 action context 传递需要时做最小类型接线，保留原详情能力。
- apps/web/src/features/test/TestSection.tsx：保留 assessmentId，接入 assessment action 展示。
- apps/web/src/features/report/ReportSummaryPanel.tsx：将已有 report action 映射到结构化 action；未知字符串继续原样显示。
- apps/web/src/features/practice/training-room/TrainingSummary.tsx：只消费显式结构化 next action，字符串 action 保持文本展示。
- apps/web/src/features/practice/training-room/trainingRoomViewModel.ts：仅在类型需要时增加结构化 action 的可选展示字段，不改变现有结果字段和计算。

### Protected Files

以下文件在整个计划中不得修改：

- apps/web/src/features/practice/PracticePanel.tsx
- apps/web/src/components/ExamSession.tsx
- apps/web/src/hooks/usePracticeSession.ts
- apps/web/src/styles.css
- apps/web/src/theme-optimizations.css
- apps/web/src/theme/themePreference.ts
- test/mobile-nav-ui.test.js
- test/theme-preference.test.js
- 任何 apps/api、packages/shared、prisma 文件

---

## Task 1: Define the StudentAction Contract

**Files:**
- Create: apps/web/src/features/student/actions/studentAction.ts
- Test: test/student-action-contract.test.js

**Interfaces:**
- Consumes: no runtime dependency; only TypeScript primitive types and RoleSection-independent canonical types.
- Produces:
  - StudentActionType with today_task、review_due、redo_wrong_question、practice_recommended、knowledge_explore、knowledge_quest、assessment_review、assessment_wrong_questions、assessment_practice、continue_session、open_report、coach_explain。
  - StudentActionSource with today-plan、review-due、wrong-summary、mastery-map、knowledge、assessment、session、training、report、coach。
  - StudentActionDestination = home | practice | knowledge | review | test | ai；Task 2 只为该类型增加边缘映射。
  - StudentAction as a discriminated union whose context requires the IDs appropriate to its type。
  - isStudentAction(value: unknown): value is StudentAction。

The contract must include id、type、title、destination、source、optional reason、optional source-provided priority、and action-specific context. Required context rules are:

- today_task → taskId and optional node/question context。
- review_due / redo_wrong_question → questionId。
- practice_recommended → at least one real questionId、knowledgeNodeId or taskId。
- knowledge_explore / knowledge_quest → knowledgeNodeId；quest also carries questionIds when the existing quest port needs them。
- assessment actions → real assessmentId，with optional questionId。
- continue_session → sessionId。
- open_report → optional verified report/assessment context。
- coach_explain → an existing question、node、wrong-question or assessment context。

Action-type review and boundary decisions:

- `today_task` is independent because it preserves the TodayPlan task ID and enters `onLaunchTodayTask` preflight。
- `review_due` and `redo_wrong_question` remain separate because due review and server priority redo have different sources and command ports。
- `practice_recommended` remains separate because a real question、knowledge node or task can enter practice without pretending it is a review item。
- `knowledge_explore` and `knowledge_quest` remain separate because exploration and quest have different existing catalog capabilities and context requirements。
- Assessment follow-up is represented by `assessment_review`、`assessment_wrong_questions` and `assessment_practice`, rather than a generic `assessment_followup`, because current result actions have distinct destinations and IDs。
- `open_report` remains separate only when an existing report or assessment context supplies a stable target；unanchored report text stays display-only。
- `continue_session` remains separate because it requires a resumable `sessionId` and the existing `onResumeSession` port。
- `coach_explain` is retained as a non-canonical contextual capability action because the Design Spec defines it and the existing ContextualCoach can consume an existing typed context. It is never selected as Home's canonical action and does not become an App-level command or side effect。
- `ai` is retained only as the destination for explicit `coach_explain` presentation；it is not a canonical learning destination and is never selected by the Home precedence function。

- [ ] **Step 1: Write the failing test**

  In test/student-action-contract.test.js, use the repository’s TypeScript transpileModule loader and add eight assertions: valid Today action, valid Review action, valid Knowledge action, valid Assessment action, valid Session action, rejection of missing required ID, rejection of an unknown field-only object, and confirmation that the contract source has no API/React callback/persistence import. Also inspect representative action values to reject function、Promise、API client、repository or persistence values。

- [ ] **Step 2: Run test to verify failure**

  Run: node test/student-action-contract.test.js

  Expected: FAIL because studentAction.ts and isStudentAction do not exist。

- [ ] **Step 3: Write minimal implementation**

  Add the discriminated union and isStudentAction. The guard must check the common fields, destination/source/type membership, and required context ID for each action type. It must not normalize business values or call any service。

- [ ] **Step 4: Run test to verify pass**

  Run: node test/student-action-contract.test.js

  Expected: 8/8 PASS。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/student/actions/studentAction.ts test/student-action-contract.test.js
    git commit -m "feat(web): add student action contract"

---

## Task 2: Add Canonical Destination Mapping

**Files:**
- Create: apps/web/src/features/student/actions/studentActionDestination.ts
- Test: test/student-action-destination.test.js

**Interfaces:**
- Consumes: RoleSection type from apps/web/src/layouts/RoleNavigation.tsx and StudentActionDestination from Task 1。
- Produces:
  - toRoleSection(destination: StudentActionDestination): RoleSection。
  - isStudentActionDestination(value: unknown): value is StudentActionDestination。

The mapping is fixed: home → dashboard、practice → question、knowledge → knowledge-catalog、review → wrong-book、test → test、ai → ai. plan、score-center、report remain legacy aliases at the navigation edge and do not enter the action model。

- [ ] **Step 1: Write the failing test**

  Add four tests for all six canonical mappings, rejection of plan/report as canonical values, preservation of existing normalizeRoleSection behavior, and no runtime dependency on React/API. Assert that `ai` is only the explicit `coach_explain` edge destination and is not selected by the canonical Home selector。

- [ ] **Step 2: Run test to verify failure**

  Run: node test/student-action-destination.test.js

  Expected: FAIL because the destination module does not exist。

- [ ] **Step 3: Write minimal implementation**

  Implement the finite destination union and one-way mapping function. Do not modify RoleNavigation.tsx or useRoleSectionNavigation.ts。

- [ ] **Step 4: Run test to verify pass**

  Run: node test/student-action-destination.test.js

  Expected: 4/4 PASS。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/student/actions/studentActionDestination.ts test/student-action-destination.test.js
    git commit -m "feat(web): add student action destinations"

---

## Task 3: Build the TodayPlan Action Adapter

**Files:**
- Create: apps/web/src/features/student/actions/adapters/todayActionAdapter.ts
- Test: test/student-action-adapters.test.js

**Interfaces:**
- Consumes: TodayPlan['priorityTasks'] from apps/web/src/api/endpoints/onboarding.ts; resolveTodayRoute、resolveTodayTaskDestination and TodayPlanTask from apps/web/src/features/onboarding/todayLearningRoute.ts。
- Produces: buildTodayAction(plan: Pick<TodayPlan, 'priorityTasks'>, nowMs?: number): StudentAction | null。

Rules:

- Use resolveTodayRoute to select the existing currentTask；do not duplicate its actionable/postponed判断。
- Use resolveTodayTaskDestination for practice/review/plan destination semantics。
- Use deterministic IDs such as today-task:<taskId>。
- Carry taskId; map the existing knowledgePointId field into the action’s node-context slot only at this adapter boundary and do not rename the API field。
- Map source task.priority to the action priority only; do not infer a new priority。
- Return null when the existing route has no currentTask；completed or future postponed tasks are not converted into executable actions。
- Do not call startTask、onLaunchTodayTask or any API from the adapter。

- [ ] **Step 1: Write the failing test**

  Add five cases: high-priority pending task becomes today_task; in-progress task keeps its ID and priority; completed task returns null when it is the only task; postponed task returns null before nextAvailableAt and becomes actionable after the route helper makes it current; and task mode maps to practice、review or home without hard-coded question counts。

- [ ] **Step 2: Run test to verify failure**

  Run: node --test test/student-action-adapters.test.js --test-name-pattern="Today"

  Expected: FAIL because todayActionAdapter.ts does not exist。

- [ ] **Step 3: Write minimal implementation**

  Implement the adapter using the existing route helpers. Keep source priority and task reason as passthrough fields. Return null for missing or empty task arrays。

- [ ] **Step 4: Run test to verify pass**

  Run: node --test test/student-action-adapters.test.js --test-name-pattern="Today"

  Expected: 5/5 PASS。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/student/actions/adapters/todayActionAdapter.ts test/student-action-adapters.test.js
    git commit -m "feat(web): add today action adapter"

---

## Task 4: Build Review and Wrong-Question Action Adapters

**Files:**
- Create: apps/web/src/features/student/actions/adapters/reviewActionAdapter.ts
- Test: test/student-action-adapters.test.js

**Interfaces:**
- Consumes: DueReviewItem from apps/web/src/api/endpoints/review.ts; WrongQuestionSummary['priorityRedoItems']; WrongQuestion from apps/web/src/api/types.ts。
- Produces: buildReviewActions(input: { dueReviews: readonly DueReviewItem[]; priorityRedoItems: readonly WrongQuestionSummary['priorityRedoItems'][number][]; displayFallbackItems?: readonly WrongQuestion[] }): StudentAction[]。

Rules:

- Preserve the exact order: due/overdue items, then server-provided priorityRedoItems, then explicitly labeled display fallback。
- Produce review_due for due items and redo_wrong_question for redo items。
- Use questionId as the stable context and action ID component。
- Do not calculate risk, weakness score, date buckets, or new priority values。
- Do not convert a display sort into a business fact; fallback actions must have no fabricated priority and a source that identifies the fallback。
- Deduplicate only by stable question ID when the same question appears in later fallback groups; never remove the first higher-authority occurrence。

- [ ] **Step 1: Write the failing test**

  Add six cases: due item precedes priority redo; overdue and due keep source data; priority redo is used when due is empty; display fallback is used last and labeled by source; duplicate question keeps the due occurrence; and no risk/priority engine call is present in the adapter source。

- [ ] **Step 2: Run test to verify failure**

  Run: node --test test/student-action-adapters.test.js --test-name-pattern="Review|Wrong"

  Expected: FAIL because reviewActionAdapter.ts does not exist。

- [ ] **Step 3: Write minimal implementation**

  Implement three ordered passes over the supplied arrays. Reuse existing nextAction、latestMistakeReason and source order only; do not import wrongReviewPriority.ts。

- [ ] **Step 4: Run test to verify pass**

  Run: node --test test/student-action-adapters.test.js --test-name-pattern="Review|Wrong"

  Expected: 6/6 PASS。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/student/actions/adapters/reviewActionAdapter.ts test/student-action-adapters.test.js
    git commit -m "feat(web): add review action adapter"

---

## Task 5: Build Knowledge Action Adapters

**Files:**
- Create: apps/web/src/features/student/actions/adapters/knowledgeActionAdapter.ts
- Test: test/student-action-adapters.test.js

**Interfaces:**
- Consumes: existing Knowledge Catalog node IDs, CatalogPointContext, related question IDs, prerequisite/related node contexts, and quest question IDs from apps/web/src/features/knowledge-catalog/。
- Produces:
  - buildKnowledgeActions(input: KnowledgeActionInput): StudentAction[]。
  - KnowledgeActionInput with nodeId、title、optional related question IDs、prerequisite node IDs、related node IDs、and quest question IDs。

Rules:

- Every knowledge action must retain a real knowledgeNodeId。
- Use knowledge_explore for node、prerequisite and related-node inspection。
- Use practice_recommended for a related question, retaining both node and question IDs when available。
- Use knowledge_quest only when quest question IDs are present; preserve the exact IDs required by onStartQuestFromCatalog。
- Do not derive a node ID from a title、index、array position or display label。
- Do not fetch mastery or call a navigation handler from the adapter。

- [ ] **Step 1: Write the failing test**

  Add six cases: selected node explore; prerequisite explore; related node explore; related question practice; quest with question IDs; and missing node ID produces no executable action rather than a guessed action。

- [ ] **Step 2: Run test to verify failure**

  Run: node --test test/student-action-adapters.test.js --test-name-pattern="Knowledge"

  Expected: FAIL because knowledgeActionAdapter.ts does not exist。

- [ ] **Step 3: Write minimal implementation**

  Implement one deterministic action per supplied relation or question. Use source IDs in action IDs; keep title and existing display reason as presentation metadata。

- [ ] **Step 4: Run test to verify pass**

  Run: node --test test/student-action-adapters.test.js --test-name-pattern="Knowledge"

  Expected: 6/6 PASS。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/student/actions/adapters/knowledgeActionAdapter.ts test/student-action-adapters.test.js
    git commit -m "feat(web): add knowledge action adapter"

---

## Task 6: Build Assessment and Report Action Adapters

**Files:**
- Create: apps/web/src/features/student/actions/adapters/assessmentActionAdapter.ts
- Create: apps/web/src/features/student/actions/adapters/reportActionAdapter.ts
- Test: test/student-action-adapters.test.js

**Interfaces:**
- Consumes: StageAssessmentResult and PracticeSetResult from apps/web/src/api/types.ts; existing ReportSummaryPanel learning insight/action data。
- Produces:
  - buildAssessmentActions(result: StageAssessmentResult | null): StudentAction[]。
  - buildPracticeSetActions(result: PracticeSetResult | null): StudentAction[]。
  - buildReportActions(input: ReportActionInput): StudentAction[]。

Rules:

- Use StageAssessmentResult.id as the real assessmentId。
- Distinguish assessment_review、assessment_wrong_questions、assessment_practice and open_report where the current result has enough semantics。
- Keep reviewItems[].questionId when producing assessment wrong-question actions。
- PracticeSetResult does not expose an assessment history ID. It may produce a practice action only when a real question or known explicit anchor exists; otherwise preserve its string nextActions as display text and return no fabricated assessment action。
- Report actions may produce open_report with a deterministic report scope key; they may produce practice/review actions only when the existing insight carries a real target ID。
- Never turn predicted score、weak-point title or free-form action text into a new business priority。

- [ ] **Step 1: Write the failing test**

  Add eight cases: assessment report action keeps assessmentId; assessment wrong-question action keeps questionId; assessment practice action is distinct; multiple review items remain addressable; PracticeSetResult without ID does not invent assessmentId; explicit practice result question maps safely; known report action maps to test/review/practice; unknown report text remains unstructured。

- [ ] **Step 2: Run test to verify failure**

  Run: node --test test/student-action-adapters.test.js --test-name-pattern="Assessment|Report"

  Expected: FAIL because both adapter files do not exist。

- [ ] **Step 3: Write minimal implementation**

  Implement explicit mappings only. Keep unknown strings outside StudentAction; expose them to callers through their existing result model for text rendering。

- [ ] **Step 4: Run test to verify pass**

  Run: node --test test/student-action-adapters.test.js --test-name-pattern="Assessment|Report"

  Expected: 8/8 PASS。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/student/actions/adapters/assessmentActionAdapter.ts apps/web/src/features/student/actions/adapters/reportActionAdapter.ts test/student-action-adapters.test.js
    git commit -m "feat(web): add assessment and report action adapters"

---

## Task 7: Build Session and Training Adapters

**Files:**
- Create: apps/web/src/features/student/actions/adapters/sessionActionAdapter.ts
- Create: apps/web/src/features/student/actions/adapters/trainingActionAdapter.ts
- Test: test/student-action-adapters.test.js

**Interfaces:**
- Consumes: SessionView from apps/web/src/api/endpoints/sessions.ts; TrainingRoomViewModel、TrainingRoomResult and TrainingRoomSource from apps/web/src/features/practice/training-room/trainingRoomViewModel.ts。
- Produces:
  - buildContinueSessionAction(session: SessionView | null): StudentAction | null。
  - buildTrainingActions(input: TrainingActionInput): StudentAction[]。
  - TrainingActionInput accepts a source ID、existing training source、existing nextActions and optional explicit question/node/task context; it never parses arbitrary text as a command。

Rules:

- continue_session requires existing session.id and maps to practice。
- Training Summary remains a presentation layer。
- String-only nextActions produce no executable action; the original strings remain available for TrainingSummary。
- Explicit structured training context may map to practice_recommended、redo_wrong_question、open_report or review_due。
- Do not modify PracticePanel、ExamSession、usePracticeSession、session submission、session save or session submit。

- [ ] **Step 1: Write the failing test**

  Add six cases: resumable session produces continue_session; completed session is excluded; session ID is preserved; string-only training next actions remain text-only; explicit training practice context maps to practice; and no output contains mastery or recommendation recalculation。

- [ ] **Step 2: Run test to verify failure**

  Run: node --test test/student-action-adapters.test.js --test-name-pattern="Session|Training"

  Expected: FAIL because the session and training adapter files do not exist。

- [ ] **Step 3: Write minimal implementation**

  Implement direct SessionView mapping and an explicit-context-only training bridge. Use deterministic IDs derived from session/source IDs。

- [ ] **Step 4: Run test to verify pass**

  Run: node --test test/student-action-adapters.test.js --test-name-pattern="Session|Training"

  Expected: 6/6 PASS。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/student/actions/adapters/sessionActionAdapter.ts apps/web/src/features/student/actions/adapters/trainingActionAdapter.ts test/student-action-adapters.test.js
    git commit -m "feat(web): add session and training action adapters"

---

## Task 8: Add Candidate Composition and Canonical Next Action Selection

**Files:**
- Create: apps/web/src/features/student/actions/actionCandidates.ts
- Create: apps/web/src/features/student/actions/canonicalNextAction.ts
- Test: test/student-action-adapters.test.js

**Interfaces:**
- Consumes: ordered action arrays from Tasks 3–7。
- Produces:
  - StudentActionCandidates with session、today、review、wrongQuestion、knowledge、assessment、training、report and coach arrays。
  - buildStudentActionCandidates input accepts todayAction: StudentAction | null and the remaining ordered arrays; it places the non-null Today action into the today array without reordering other sources。
  - buildStudentActionCandidates(input): StudentActionCandidates，only merges and deduplicates; it does not sort business sources。
  - selectCanonicalNextAction(input: StudentActionCandidates): StudentAction | null。

Canonical selection order is fixed as presentation precedence, not business priority:

    resumable session
    ↓
    TodayPlan action
    ↓
    due/overdue review
    ↓
    server priorityRedoItems
    ↓
    assessment/report action
    ↓
    null

The selector consumes already ordered arrays. The sequence answers “which available action should Home show first?”; it is not a cross-source priority score and must not be described as Recommendation Engine output. It does not compare numeric `priority` values between source buckets, inspect mastery、calculate priority、call an API or infer missing context. TodayPlan, due/overdue and `priorityRedoItems` retain their own source order and source-provided facts. If a source is unavailable, it is skipped rather than replaced with fabricated data. `coach_explain` and the `ai` destination are excluded from this canonical selector。

- [ ] **Step 1: Write the failing test**

  Add six cases: session wins; the single current TodayPlan action wins when no session exists; due review wins over priority redo; priority redo wins over report; no valid candidate returns null; and a lower numeric priority in an earlier source still follows the fixed presentation precedence. Add a source-order assertion proving the selector does not sort inside any source array。

- [ ] **Step 2: Run test to verify failure**

  Run: node --test test/student-action-adapters.test.js --test-name-pattern="Canonical|Candidates"

  Expected: FAIL because the composition and selector modules do not exist。

- [ ] **Step 3: Write minimal implementation**

  Implement shallow candidate composition and first-valid-candidate selection. Keep the function pure and serializable。

- [ ] **Step 4: Run test to verify pass**

  Run: node --test test/student-action-adapters.test.js --test-name-pattern="Canonical|Candidates"

  Expected: 6/6 PASS。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/student/actions/actionCandidates.ts apps/web/src/features/student/actions/canonicalNextAction.ts test/student-action-adapters.test.js
    git commit -m "feat(web): add canonical student action selection"

---

## Task 9: Define Command Port Boundaries and Navigation Fixtures

**Files:**
- Create: apps/web/src/features/student/actions/studentActionCommand.ts
- Create: test/student-action-navigation.test.js

**Interfaces:**
- Consumes: StudentAction、toRoleSection and existing handler signatures in apps/web/src/App.tsx:
  - handleLaunchTodayTask(task: TodayPlanTask)
  - handleReviewWrongQuestion(questionId: string)
  - handlePracticeQuestionFromCatalog(questionId: string, title: string)
  - handleOpenCatalogNode(nodeId: string)
  - handleStartQuestFromCatalog(nodeId: string, title: string, questionIds: string[])
  - onResumeSession(session: SessionView) wiring at the StudentSections call site
  - setActiveSection through onNavigate。
- Produces:
  - StudentActionCommandDescriptor discriminated union with command kind and exact IDs needed by the existing command ports；`coach_explain` explicitly maps to `null` because it is non-canonical ContextualCoach presentation, not an App command。
  - toCommandDescriptor(action: StudentAction): StudentActionCommandDescriptor | null。
  - test fixtures and a documented command-port mapping; no production global executor。

The test must verify action context mapping, not invoke real network handlers:

- today_task retains taskId for onLaunchTodayTask lookup。
- review_due retains questionId for onOpenReview/detail routing。
- redo_wrong_question retains questionId for onRedo。
- practice_recommended retains question/node context for onPracticeQuestion or the existing task launch path。
- knowledge_explore maps to onOpenCatalogNode。
- knowledge_quest retains node and question IDs for onStartQuestFromCatalog。
- assessment/report destinations map through toRoleSection without replacing assessment IDs。
- continue_session retains sessionId for lookup before calling onResumeSession。
- coach_explain remains a contextual capability edge; it returns no App command descriptor because the existing ContextualCoach owns its request boundary。

- [ ] **Step 1: Write the failing test**

  Add seven navigation fixture cases covering Today、Review、Knowledge、Quest、Assessment、Session and explicit `coach_explain` null mapping. Each fixture calls toCommandDescriptor and asserts the exact command kind and IDs; do not assert internal implementation names that are not in the current code。

- [ ] **Step 2: Run test to verify failure**

  Run: node test/student-action-navigation.test.js

  Expected: FAIL because studentActionCommand.ts and toCommandDescriptor do not exist。

- [ ] **Step 3: Write minimal implementation**

  Add the descriptor union and pure mapping only. The descriptor must contain data needed for a caller to invoke an existing port, but no callback or side effect. Do not add executeAction。

- [ ] **Step 4: Run test to verify pass**

  Run: node test/student-action-navigation.test.js

  Expected: 7/7 PASS。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/student/actions/studentActionCommand.ts test/student-action-navigation.test.js
    git commit -m "test(web): cover student action navigation context"

---

## Task 10: Share Existing Due Review Data at the Student Composition Boundary

**Files:**
- Modify: apps/web/src/App.tsx at the existing resource refresh/state block and the StudentSections call。
- Modify: apps/web/src/features/student/StudentSections.tsx at StudentSectionsProps and the MistakeWorkspace/StudentHome composition。
- Modify: apps/web/src/features/mistakes/MistakeWorkspace.tsx at its dueLoading、dueError and loadDueReviews block only if the current Smart Review hunk can be isolated safely。
- Test: test/student-action-navigation.test.js

**Interfaces:**
- Consumes: existing fetchDueReviews(): Promise<DueReviewsResponse> from apps/web/src/api/endpoints/review.ts and existing onRetryWrongQuestionSummary/review callbacks。
- Produces:
  - a single read-only DueReviewsResponse | null resource at the student composition boundary；
  - an optional dueReviews prop for StudentSections and MistakeWorkspace；
  - existing retry/error state forwarded without changing Review business behavior。

This task exists because the current `/review/due` read is local to MistakeWorkspace while Home and Review are sibling consumers that need the same existing read model for canonical action selection and Review presentation. The request is moved to the Student/App composition boundary so both features consume one `DueReviewsResponse`; this is shared read-model data, not a new global review state or store, and it does not add an endpoint or a second normal-path request. MistakeWorkspace may retain its current internal fetch only as a compatibility fallback when the prop is absent; production composition must pass the shared result so the normal path does not duplicate the request。

The ownership boundary is explicit: App owns resource loading and retry state, StudentSections passes the read-only value, and feature adapters consume it. Do not add Redux、Zustand、React Context、StudentAction store or Review store. If an existing parent resource already contains this exact response, forward it instead of adding another fetch。

- [ ] **Step 1: Write the failing test**

  Add four assertions: App.tsx imports the existing due endpoint rather than a new URL; StudentSectionsProps exposes only the existing due response shape; the composition passes due data to both Home/action candidates and Review; and protected files remain absent from the diff。

- [ ] **Step 2: Run test to verify failure**

  Run: node test/student-action-navigation.test.js

  Expected: FAIL because App.tsx and StudentSections.tsx do not yet expose the shared due read model。

- [ ] **Step 3: Write minimal implementation**

  Add the smallest refresh state and prop wiring. Before editing, inspect the existing git diff of StudentSections.tsx and MistakeWorkspace.tsx; if a hunk contains Smart Review plus this wiring, stop and split it without rewriting the file. Do not touch protected Practice or Theme files。

- [ ] **Step 4: Run test to verify pass**

  Run: node test/student-action-navigation.test.js and npm run build:web

  Expected: 4/4 navigation/boundary assertions PASS; TypeScript passes. A Vite/esbuild spawn EPERM remains an environment result only if TypeScript already passes。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/App.tsx apps/web/src/features/student/StudentSections.tsx apps/web/src/features/mistakes/MistakeWorkspace.tsx test/student-action-navigation.test.js
    git commit -m "feat(web): share due review data at student boundary"

---

## Task 11: Add the Pure StudentActionCard and Home Canonical Action

**Files:**
- Create: apps/web/src/features/student/actions/StudentActionCard.tsx
- Modify: apps/web/src/features/student/home/StudentHome.tsx at the main dashboard composition。
- Modify: apps/web/src/features/student/StudentSections.tsx at trainingModel/dashboard data composition only。
- Test: test/student-action-ui.test.js

**Interfaces:**
- Consumes: StudentAction; canonicalNextAction; existing Home data and existing command ports。
- Produces:
  - StudentActionCardProps = { action: StudentAction; onSelect: (action: StudentAction) => void; compact?: boolean }。
  - Home renders at most one canonical action with title、source、reason when present and an action button。

StudentActionCard only renders data and emits selection. The Student composition layer maps the selected canonical action to existing ports with an exhaustive switch; it does not call API directly from the card. QuickActions、TodayMission and existing secondary cards remain available but are visually subordinate。

- [ ] **Step 1: Write the failing test**

  Add five checks: card renders title/source; reason is optional and does not break empty data; Home accepts one canonical action; no action produces no primary CTA; and the component contains no fetch、submit、RecommendationService、Student State write or model-provider logic。

- [ ] **Step 2: Run test to verify failure**

  Run: node test/student-action-ui.test.js --test-name-pattern="Home|ActionCard"

  Expected: FAIL because StudentActionCard.tsx and the Home prop are absent。

- [ ] **Step 3: Write minimal implementation**

  Add the display-only card and pass the selected canonical action from StudentSections to StudentHome. Keep the current onNavigate、onLaunchTodayTask、onOpenReview and other callback signatures intact。

- [ ] **Step 4: Run test to verify pass**

  Run: node test/student-action-ui.test.js --test-name-pattern="Home|ActionCard" and npm run build:web

  Expected: 5/5 UI assertions PASS; TypeScript passes。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/student/actions/StudentActionCard.tsx apps/web/src/features/student/home/StudentHome.tsx apps/web/src/features/student/StudentSections.tsx test/student-action-ui.test.js
    git commit -m "feat(web): show canonical home student action"

---

## Task 12: Converge Review CTA Presentation Without Removing Review Capabilities

**Files:**
- Modify: apps/web/src/features/mistakes/MistakeWorkspace.tsx at reviewCenter.priorityItem and existing action rendering。
- Modify: apps/web/src/features/mistakes/components/PriorityReviewCard.tsx at its action props/buttons。
- Modify: apps/web/src/features/mistakes/components/ReviewQueue.tsx at its due item action。
- Test: test/student-action-ui.test.js

**Interfaces:**
- Consumes: StudentAction[] from buildReviewActions; existing onOpenDetail、onReview、onRedo、onPracticeVariant、onNavigate callbacks。
- Produces: Review UI that displays the same action fields while preserving existing precise callbacks。

Rules:

- Due/overdue remains first。
- priorityRedoItems remains second。
- Display fallback is visibly presentation-only。
- “开始复习” continues to use onOpenDetail or the existing onOpenReview path; “重做” continues to use onRedo。
- All existing filters、detail、review、redo、variant、evidence and AI Coach capabilities remain。

- [ ] **Step 1: Write the failing test**

  Add five checks: priority card consumes due action source; queue keeps questionId; fallback label is not called risk; existing callbacks remain in MistakeWorkspace; and filter/detail/redo/variant markers remain present。

- [ ] **Step 2: Run test to verify failure**

  Run: node test/student-action-ui.test.js --test-name-pattern="Review"

  Expected: FAIL because Review components do not yet consume the shared action shape。

- [ ] **Step 3: Write minimal implementation**

  Add action props or derive actions at the existing view-model boundary. Keep callback invocation local to the existing component and do not add a second review state or API call。

- [ ] **Step 4: Run test to verify pass**

  Run: node test/student-action-ui.test.js --test-name-pattern="Review" and npm run build:web

  Expected: 5/5 Review assertions PASS; TypeScript passes。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/mistakes/MistakeWorkspace.tsx apps/web/src/features/mistakes/components/PriorityReviewCard.tsx apps/web/src/features/mistakes/components/ReviewQueue.tsx test/student-action-ui.test.js
    git commit -m "feat(web): converge review action presentation"

---

## Task 13: Converge Knowledge Actions While Preserving Galaxy and Tree

**Files:**
- Modify: apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx at selected node/action state and existing callbacks。
- Modify: apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx only if typed node context must be forwarded to the existing detail actions。
- Test: test/student-action-ui.test.js

**Interfaces:**
- Consumes: StudentAction[] from knowledgeActionAdapter; current focusNodeId、onPracticeQuestion、onStartQuest、onCompleteQuest and onNavigate props。
- Produces: Knowledge UI actions that preserve node IDs and route to existing callbacks。

Rules:

- Knowledge Galaxy and Knowledge Tree continue to coexist。
- Search、subject switching、filters、expand/collapse、focus、detail、evidence、related questions、exam hits、prerequisites、related knowledge、quest and Contextual AI Coach remain intact。
- knowledge_explore always retains knowledgeNodeId。
- Related practice retains question ID and node ID when available。
- Quest retains node ID and exact question ID list。
- No new mastery fetch and no new knowledge API。

- [ ] **Step 1: Write the failing test**

  Add five checks: node action renders a node ID; related practice retains question ID; quest retains node/question IDs; existing focusNodeId and catalog callbacks remain; and the component does not introduce a second mastery request。

- [ ] **Step 2: Run test to verify failure**

  Run: node test/student-action-ui.test.js --test-name-pattern="Knowledge"

  Expected: FAIL because Knowledge components do not yet expose shared actions。

- [ ] **Step 3: Write minimal implementation**

  Adapt current selected-point and detail callbacks at the boundary. Do not rewrite the Galaxy layout、tree or detail drawer. Before editing, inspect current uncommitted Knowledge Galaxy hunks and isolate this Task from them。

- [ ] **Step 4: Run test to verify pass**

  Run: node test/student-action-ui.test.js --test-name-pattern="Knowledge" and npm run build:web

  Expected: 5/5 Knowledge assertions PASS; TypeScript passes。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/knowledge-catalog/KnowledgeCatalog.tsx apps/web/src/features/knowledge-catalog/KnowledgePointDetailDrawer.tsx test/student-action-ui.test.js
    git commit -m "feat(web): preserve knowledge action context"

---

## Task 14: Converge Assessment and Report Next Actions

**Files:**
- Modify: apps/web/src/features/test/TestSection.tsx at stageResult ContextualCoach/result composition。
- Modify: apps/web/src/features/report/ReportSummaryPanel.tsx at reportActionPlan、learningInsights and NextLearningStepCard integration。
- Test: test/student-action-ui.test.js

**Interfaces:**
- Consumes: buildAssessmentActions、buildReportActions、stageResult.id、existing onNavigate and report callbacks。
- Produces: separate display actions for report、assessment mistakes and continued practice while retaining existing fallback text。

Rules:

- Always preserve real assessmentId when stageResult.id exists。
- Do not make stageResult a new data source; only adapt existing result data。
- Keep ContextualCoach explain-only and do not pass action objects into AI as executable commands。
- Existing onNavigate('wrong-book'|'question'|'test'|'dashboard') behavior remains at the edge。
- Unknown nextActions remain visible text and are not guessed into actions。

- [ ] **Step 1: Write the failing test**

  Add five checks: assessment action preserves ID; report action maps to test; mistake action maps to review; practice action maps to question only with real context; and existing ContextualCoach request still uses assessment context。

- [ ] **Step 2: Run test to verify failure**

  Run: node test/student-action-ui.test.js --test-name-pattern="Assessment|Report"

  Expected: FAIL because Test and Report components do not yet consume action adapters。

- [ ] **Step 3: Write minimal implementation**

  Add adapter outputs to the existing result/action regions. Keep report calculations、buildLearningInsights、predicted score and existing section navigation unchanged。

- [ ] **Step 4: Run test to verify pass**

  Run: node test/student-action-ui.test.js --test-name-pattern="Assessment|Report" and npm run build:web

  Expected: 5/5 Assessment/Report assertions PASS; TypeScript passes。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/test/TestSection.tsx apps/web/src/features/report/ReportSummaryPanel.tsx test/student-action-ui.test.js
    git commit -m "feat(web): converge assessment and report actions"

---

## Task 15: Converge Training Summary and Session Resume Display

**Files:**
- Modify: apps/web/src/features/practice/training-room/TrainingSummary.tsx at the existing nextActions rendering。
- Modify: apps/web/src/features/practice/training-room/trainingRoomViewModel.ts only if an optional structured action list can be passed without changing current result calculations。
- Modify: apps/web/src/features/student/StudentSections.tsx at existing Training Room model composition。
- Test: test/student-action-ui.test.js

**Interfaces:**
- Consumes: buildTrainingActions、buildContinueSessionAction、current TrainingRoomViewModel、existing PracticeSetResult、StageAssessmentResult and SessionView。
- Produces: Training Summary renders structured actions when explicit context exists and otherwise keeps the current string list. Session resume remains wired to onResumeSession。

Rules:

- Training Room remains an experience layer。
- Do not modify PracticePanel.tsx、ExamSession.tsx、usePracticeSession.ts、answer submission、session save、or session submit。
- Do not recalculate accuracy、mastery、progress or recommendation priority。
- No string parsing into an executable action。

- [ ] **Step 1: Write the failing test**

  Add four checks: explicit Training action renders; string-only nextActions stay text; Training Summary contains no submission/state write imports; and session resume keeps sessionId and existing callback wiring。

- [ ] **Step 2: Run test to verify failure**

  Run: node test/student-action-ui.test.js --test-name-pattern="Training|Session"

  Expected: FAIL because Training Summary does not yet render shared actions。

- [ ] **Step 3: Write minimal implementation**

  Add an optional action presentation path around the existing list. Keep the current empty-state and result rendering behavior for unstructured data。

- [ ] **Step 4: Run test to verify pass**

  Run: node test/student-action-ui.test.js --test-name-pattern="Training|Session" and npm run build:web

  Expected: 4/4 Training/Session assertions PASS; TypeScript passes。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/practice/training-room/TrainingSummary.tsx apps/web/src/features/practice/training-room/trainingRoomViewModel.ts apps/web/src/features/student/StudentSections.tsx test/student-action-ui.test.js
    git commit -m "feat(web): expose structured training actions"

---

## Task 16: Reduce Duplicate Home CTA Presentation With Legacy Compatibility

**Files:**
- Modify: apps/web/src/features/student/home/StudentHome.tsx at canonical/secondary action grouping only。
- Modify: apps/web/src/features/onboarding/StudentLaunchpad.tsx only for display demotion or shared action labels; preserve its callback props。
- Modify: apps/web/src/features/student/NextLearningStepCard.tsx only to consume a compatible display adapter, without deleting its existing builder functions。
- Test: test/student-action-ui.test.js

**Interfaces:**
- Consumes: canonical action and feature action arrays from Tasks 8–15; all current Home and Launchpad callback props。
- Produces: one primary Home action presentation, secondary/exploratory actions retained, legacy components preserved。

Rules:

- This Task changes semantic grouping, labels and visibility only; it does not rewrite page layout, CSS systems or feature behavior。
- StudentLaunchpad、TodayMission、QuickActions、NextLearningStep、StudyPlanOverview and LearningProfileCard are not deleted in this Task。
- Existing section-level fallback navigation remains available。
- Duplicate CTA suppression is presentation-only; it does not hide a required business capability。
- StudentLearningConsole.tsx is not deleted because current usage must be confirmed separately。

- [ ] **Step 1: Write the failing test**

  Add four checks: Home has one canonical action region; QuickActions remain secondary; existing Today and Review callback names remain; and legacy Home components/imports are still present where currently used。

- [ ] **Step 2: Run test to verify failure**

  Run: node test/student-action-ui.test.js --test-name-pattern="CTA|Legacy"

  Expected: FAIL because duplicate action regions are not yet marked as canonical/secondary。

- [ ] **Step 3: Write minimal implementation**

  Add semantic grouping and shared action labels without changing feature behavior. Before touching StudentLaunchpad or any currently modified file, compare its working-tree diff and stop on mixed hunks。

- [ ] **Step 4: Run test to verify pass**

  Run: node test/student-action-ui.test.js --test-name-pattern="CTA|Legacy" and npm run build:web

  Expected: 4/4 Home CTA/Legacy assertions PASS; TypeScript passes。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/student/home/StudentHome.tsx apps/web/src/features/onboarding/StudentLaunchpad.tsx apps/web/src/features/student/NextLearningStepCard.tsx test/student-action-ui.test.js
    git commit -m "feat(web): reduce duplicate home student action CTAs"

---

## Task 17: Preserve Assessment CTA Semantics With Legacy Compatibility

**Files:**
- Modify: apps/web/src/features/assessment/StageAssessmentPanel.tsx at the existing resultActions block only。
- Test: test/student-action-ui.test.js

**Interfaces:**
- Consumes: assessment actions from Task 6、assessment/report integration from Task 14、`stageResult.id` and existing `onNavigate` callback。
- Produces: assessment result CTAs with explicit action semantics while preserving existing section aliases, labels and fallback navigation。

Rules:

- Keep the existing review、wrong-question、practice、plan and report capabilities；only the primary/secondary presentation and action context may change。
- Preserve `stageResult.id` as `assessmentId` whenever an assessment action is rendered。
- Do not add a report API, modify result calculations, add App state or remove the legacy resultActions array。
- Do not change layout systems or unrelated assessment styling。

- [ ] **Step 1: Write the failing test**

  Add four checks: the result renders distinct review/wrong-question/practice/report semantics; an assessment action retains `stageResult.id`; existing `plan` and `report` aliases still reach the current navigation edge; and no StudentAction value contains a React callback。

- [ ] **Step 2: Run test to verify failure**

  Run: node test/student-action-ui.test.js --test-name-pattern="Assessment"

  Expected: FAIL because StageAssessmentPanel does not yet consume the shared assessment action semantics。

- [ ] **Step 3: Write minimal implementation**

  Annotate or render the existing result actions through the shared assessment mapping while preserving the current callback and alias behavior. Do not introduce a new command path。

- [ ] **Step 4: Run test to verify pass**

  Run: node test/student-action-ui.test.js --test-name-pattern="Assessment" and npm run build:web

  Expected: 4/4 Assessment CTA assertions PASS; TypeScript passes。

- [ ] **Step 5: Commit**

  Run:

    git add apps/web/src/features/assessment/StageAssessmentPanel.tsx test/student-action-ui.test.js
    git commit -m "feat(web): preserve assessment action compatibility"

---

## Task 18: Complete Contract, Navigation, UI and Architecture Regression Coverage

**Files:**
- Modify: test/student-action-contract.test.js only if earlier coverage needs a missing boundary assertion。
- Modify: test/student-action-destination.test.js only if an already-defined mapping lacks a case。
- Modify: test/student-action-adapters.test.js only to consolidate the fixed adapter matrix。
- Modify: test/student-action-navigation.test.js only to cover the final composition boundary。
- Modify: test/student-action-ui.test.js only to cover the final UI markers。

**Interfaces:**
- Consumes: all action modules and integrated feature composition from Tasks 1–17。
- Produces: a stable regression suite for type/context/source/destination, source priority preservation, command-port context, UI CTA convergence and forbidden dependency boundaries。

The suite must explicitly assert:

- No action module imports API clients、Prisma、Student State writers、RecommendationService or React callbacks。
- No action module contains mastery/review priority calculations or network calls。
- PracticePanel.tsx、ExamSession.tsx、usePracticeSession.ts、Theme files、packages/shared and backend files are not modified by the action commits。
- Home、Review、Knowledge、Assessment、Training and Session action contexts remain precise。

- [ ] **Step 1: Write the failing test**

  Add the final boundary assertions to the existing focused test files before changing any production file in this Task。

- [ ] **Step 2: Run test to verify failure**

  Run:

    node test/student-action-contract.test.js
    node test/student-action-destination.test.js
    node test/student-action-adapters.test.js
    node test/student-action-navigation.test.js
    node test/student-action-ui.test.js

  Expected: at least one assertion fails if any adapter、boundary or UI integration is incomplete; do not alter assertions to hide an implementation defect。

- [ ] **Step 3: Write minimal implementation**

  Only add missing test fixtures or narrow type exports. If a test reveals a real design violation, fix the smallest relevant Phase 5 file in its own Task rather than changing the test expectation。

- [ ] **Step 4: Run test to verify pass**

  Run the same five commands.

  Expected: all assertions PASS, with no worker loader writing back to source files。

- [ ] **Step 5: Commit**

  Run:

    git add test/student-action-contract.test.js test/student-action-destination.test.js test/student-action-adapters.test.js test/student-action-navigation.test.js test/student-action-ui.test.js
    git commit -m "test(web): cover student action spine boundaries"

---

## Task 19: Release Verification and Clean Checkout Audit

**Files:**
- Modify: none, unless a verification report is explicitly requested in a later documentation task。
- Test: all files from Tasks 1–18 and existing affected UI tests。

**Interfaces:**
- Consumes: the committed Phase 5 action modules and existing frontend behavior。
- Produces: verified release state; no source changes。

- [ ] **Step 1: Write the failing test**

  No new production behavior is introduced here. Treat the existing focused tests and protected-file audit as the release gate fixtures。

- [ ] **Step 2: Run test to verify failure**

  Run:

    npm run build:web
    node test/student-action-contract.test.js
    node test/student-action-destination.test.js
    node test/student-action-adapters.test.js
    node test/student-action-navigation.test.js
    node test/student-action-ui.test.js
    node test/training-room-ui.test.js
    node test/knowledge-galaxy-ui.test.js
    node test/review-center-ui.test.js
    git diff --check

  Expected: any failure is classified as TypeScript/module resolution, assertion failure, environment spawn EPERM or unrelated migration debt before proceeding。

- [ ] **Step 3: Write minimal implementation**

  No implementation is allowed in this Task. If verification fails, return to the owning Task and obtain a separate approved fix; do not edit during release verification。

- [ ] **Step 4: Run test to verify pass**

  Run:

    npm test
    npm run build:shared
    npm run build:api
    npm run build:web

  Expected: existing baseline tests remain green; frontend TypeScript passes. A Vite/esbuild spawn EPERM is recorded as an environment limitation only when TypeScript and module resolution have passed. The four known migration tests remain separate debt:

    student-learning-console-ui.test.js
    today-score-center-ui.test.js
    v3-section-wiring.test.js
    wrong-question-evidence.test.js

- [ ] **Step 5: Commit**

  No commit is created by this verification Task. The preceding Tasks already have precise commits; perform a clean-checkout audit from the resulting commit chain instead。

Clean checkout procedure:

    git worktree add <temporary-path> HEAD
    cd <temporary-path>
    npm install
    npm run build:web
    node test/student-action-contract.test.js
    node test/student-action-adapters.test.js
    node test/student-action-navigation.test.js
    node test/student-action-ui.test.js
    git status --short
    cd <main-worktree>
    git worktree remove <temporary-path>

The clean checkout must not depend on untracked Knowledge Galaxy、Review Center、Theme or documentation files from the original worktree.

---

## Dependency Order

    Task 1 Contract
      ↓
    Task 2 Destination
      ↓
    Tasks 3–7 Source Adapters
      ↓
    Task 8 Candidate Composition / Canonical Selection
      ↓
    Task 9 Command Port Boundary Tests
      ↓
    Task 10 Shared Due Review Read Model
      ↓
    Task 11 Home Canonical Action
      ↓
    Tasks 12–15 Review / Knowledge / Assessment / Training Integration
      ↓
    Task 16 Home CTA Convergence
      ↓
    Task 17 Assessment CTA Compatibility
      ↓
    Task 18 Regression Coverage
      ↓
    Task 19 Release Verification

Tasks 3–7 are independent after Tasks 1–2 and may be implemented separately, but they must not be parallelized against the same mixed working-tree file. Tasks 10–17 are sequential because they alter composition and UI boundaries.

## Commit Strategy

The recommended commit sequence is:

    feat(web): add student action contract
    feat(web): add student action destinations
    feat(web): add today action adapter
    feat(web): add review action adapter
    feat(web): add knowledge action adapter
    feat(web): add assessment and report action adapters
    feat(web): add session and training action adapters
    feat(web): add canonical student action selection
    test(web): cover student action navigation context
    feat(web): share due review data at student boundary
    feat(web): show canonical home student action
    feat(web): converge review action presentation
    feat(web): preserve knowledge action context
    feat(web): converge assessment and report actions
    feat(web): expose structured training actions
    feat(web): reduce duplicate home student action CTAs
    feat(web): preserve assessment action compatibility
    test(web): cover student action spine boundaries

Tasks 1–18 produce eighteen independently explainable commits; Task 19 is verification-only and creates no commit. Every commit must be created with explicit paths. A commit that touches a protected or unrelated file is rejected and must be repaired through a separate boundary review, not amended into the nearest Phase 5 commit.

## Spec Coverage

| Design Spec section | Plan coverage |
|---|---|
| Problem / Goals / Non-Goals | Global Constraints; Tasks 1–19 |
| Current Architecture | File Change Map; Tasks 9–11 |
| Action Model | Task 1 |
| Action Type Matrix | Tasks 3–7 |
| Adapter Architecture | Tasks 3–7 |
| Destination Architecture | Task 2 |
| Command Port Strategy | Task 9; Tasks 11–17 |
| Home Canonical Action | Tasks 8、10、11 |
| Feature Integration | Tasks 12–17 |
| Mastery Read Boundary | Tasks 3–8、13; boundary tests in Task 18 |
| Testing Strategy | Tasks 1–2、9、18–19 |
| Migration Strategy | Tasks 11–17 |
| Risks | Global Constraints; Task 19 classification |
| Acceptance Criteria | Tasks 18–19 |
| Open Questions | Resolved by the fixed contract、destination、ID、adapter and command-port decisions above |

## Risk Points

1. App.tsx and StudentSections.tsx already own broad orchestration and contain other work-line changes; mixed hunks must stop rather than be rewritten。
2. Review due data is currently owned by MistakeWorkspace; sharing it requires one carefully bounded read-model lift to avoid duplicate requests。
3. fetchMyMastery and MasteryMap remain different read shapes; adapters must preserve source identity instead of silently merging them。
4. nextActions: string[] cannot safely become executable actions without a stable ID or anchor。
5. Windows Vite/esbuild spawn EPERM may block bundle verification even when TypeScript and source closure pass。

## Self-Review Result

- Spec coverage: every Design Spec section maps to one or more Tasks。
- Type consistency: Task 1 defines the action union; Tasks 2–8 consume it; Tasks 9–17 use the same destination and context rules。
- Scope: no Student State redesign、Recommendation redesign、Practice rewrite、AI Agent、RAG、Memory or full App rewrite is included。
- Dependency: all production paths and existing functions named in the plan were confirmed in the current repository, including apps/web/src/features/assessment/StageAssessmentPanel.tsx。
- Git boundary: protected files and current unrelated working-tree files are explicitly excluded from every commit command；Task 16 and Task 17 are split so Home and Assessment CTA hunks cannot be committed together accidentally。
- Placeholder scan: the plan contains no unresolved placeholder directives or unspecified interface names。
