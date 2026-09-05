# Contextual Coach — StudentContext Design Gate

审计日期：2026-09-04
范围：Contextual Coach 对 StudentContext v1 的增量只读消费设计
环境：`ENV-005 = BLOCKED`；`D4-B4 = BLOCKED BY ENVIRONMENT`
前端基线：`4f58fe3`（工作树含未提交在途工作线）

本文件是**只读设计门禁**，不修改任何 backend production code、frontend、StudentContext、Prisma、tests、Recommendation、AI behavior。唯一产物是本设计文档。

核心结论先置：**`StudentContext` 足以作为 Coach 的 base student state（`student` 块 + `currentTasks`），且 identity 安全；但四个 scenario 的 focus 事实全部为专属 loader 持有，应保留 legacy。** 判定：**READY FOR COACH MIGRATION**（仅迁移 base context，不迁移 scenario focus，不扩契约）。

---

## 1. Current Coach Data Flow

```text
POST /ai/contextual-coach
    ↓
ContextualCoachService
    ↓
ContextualCoachContextAssembler.assemble(userId, request)
    ├─ studentState = StudentStateProjectionService.getSnapshot(userId)   // BASE
    ├─ buildFocus(userId, request)                                        // SCENARIO
    │    ├─ question        → QuestionsService.findQuestionById + PracticeRecordRepository.listByUser(过滤)
    │    ├─ wrong_question  → WrongQuestionProjectionService.getSnapshot
    │    ├─ knowledge_node  → ScoreCenterService.getKnowledgeDetail
    │    └─ assessment      → AssessmentHistoryProjectionService.getSnapshot
    ├─ currentTasks = studentState.studyTasks.today.slice(0,5)            // BASE
    └─ assembledAt = new Date().toISOString()                             // TIME
```

ContextAssembler 依赖（构造器注入）：`StudentStateProjectionService`、`QuestionsService`、`WrongQuestionProjectionService`、`AssessmentHistoryProjectionService`、`PracticeRecordRepository`、`ScoreCenterService`。**当前不消费 StudentContext。**

`assemble()` 输出 `ContextualCoachContext`：

| 块 | 字段 | 来源 |
|---|---|---|
| `student.goal` | targetScore/currentScore/dailyHours/remainingDays/stage/weakestSubject | StudentState.goal |
| `student.masterySummary` | `{...studentState.mastery}`（raw spread） | StudentState.mastery |
| `student.weakPoints` | `studentState.weakPoints.slice(0,3)` | StudentState.weakPoints |
| `focus` | 视 scenario 而定 | buildFocus |
| `currentTasks` | `studyTasks.today.slice(0,5)` → id/title/status/scheduledDate/completed/mode/questionCount | StudentState.studyTasks.today |
| `assembledAt` | `new Date().toISOString()` | 当前时间 |

---

## 2. Scenario Inventory

| Scenario | Current Facts | StudentContext Coverage | Keep Legacy | Risk |
|---|---|---|---|---|
| **base** | goal（targetScore/currentScore/dailyHours/remainingDays/stage/weakestSubject）、masterySummary、weakPoints(3)、currentTasks(5) | `exam`（target/current/remaining/stage/year）、`profile`（weakestSubject/targetSchool/diagnosis）、`mastery`（weakNodes/weakPoints/improving/mastered）、`plan.todayTasks`（studyTaskId/actionId/title/status/scheduledDate/completed/minutes/questionCount） | dailyHours、task.mode（StudentContext 无） | 见 §6 |
| **question** | question detail（id/stem/options/answer/analysis/knowledgePointIds[:3]）、selectedAnswer、practiceHistory（该题最近5条：correct/selectedAnswer/mistakeReason/submittedAt）、message | **无** — StudentContext 无题目详情、无 per-question 练习历史 | **全部保留专属**（QuestionsService + PracticeRecordRepository） | 无新风险 |
| **wrong_question** | wrong item（questionId/stem/answer/analysis/knowledgePointId/knowledgePointTitle/latestCorrect/latestMistakeReason/wrongCount/attemptCount）、attemptHistory[:5]、reviewHistory[:3]、message | **无** — StudentContext.review 只有 dueCount/overdue/reviewed/resolved/highRiskQuestions（无 per-question attempt/review history、无题意解说） | **全部保留专属**（WrongQuestionProjectionService） | Point 身份正确；但 `knowledgeNodeIds[]` 可用未用（见 §5） |
| **knowledge_node** | knowledgeNode（knowledgePoint detail）、mastery.userState（mastery/accuracy/recentAccuracy/attempts/correctCount/wrongCount/retention/stabilityDays）、knowledgeEvidence（frequency/relations.prerequisites[:3]/related[:3]/relatedQuestions[:3]/examQuestions[:3]）、message | `mastery.weakNodes` 仅覆盖节点级 mastery 数字；**无** relations 图谱、frequency、related/examQuestions、userState(stabilityDays/retention) | **大多保留专属**（ScoreCenter.getKnowledgeDetail）；`mastery.weakNodes` 可作 base 补充 | Node↔Point 命名歧义（见 §5） |
| **assessment** | assessment item（`{...item}` 历史）、available、message | **无** — StudentContext 的 assessment 在 QueryService 里被 `void assessment` 丢弃，不进入契约 | **全部保留专属**（AssessmentHistoryProjectionService） | 无新风险 |

**总括：**
- **base student state**：StudentContext 覆盖约 90%，仅缺 `dailyHours`（goal）与 `task.mode`（currentTasks）。
- **scenario focus**：四个 scenario 的 focus 数据（题目详情、错题详情/attempt/review history、知识节点图谱/relations/frequency、测评历史）**StudentContext 全未覆盖**，且不该进契约。
- **不应迁移 scenario focus 到 StudentContext** —— 这正是「不要为了 Coach 扩契约」的红线。

---

## 3. Proposed Boundary

```text
ContextualCoachContextAssembler
    ↓
StudentContextQueryService.getContext(userId, asOf)     // BASE student state (replaces StudentState/goal/mastery/weakPoints/currentTasks)
    +
existing scenario focus assembler                       // SCENARIO focus (unchanged, stays on own loaders)
    ↓
question / wrong_question / knowledge_node / assessment
    ↓
existing Coach pipeline (prompt + normalizer + AI)      // UNCHANGED
```

**Base student state（由 StudentContext 提供）：**

| Coach 块 | 替换为 StudentContext 字段 |
|---|---|
| `student.goal.targetScore/currentScore/remainingDays/stage` | `exam.targetScore/currentScore/remainingDays/studyStage` |
| `student.goal.weakestSubject` | `profile.weakestSubject`（StudentContext 把 weakestSubject 放 profile 而非 exam） |
| `student.goal.dailyHours` | **缺** → 保留 StudentState.goal.dailyHours，或单独富化（见 §4） |
| `student.goal.diagnosis`（如需） | `profile.diagnosis` |
| `student.masterySummary` | `mastery`（weakNodes/weakPoints/improving/mastered） |
| `student.weakPoints` | `mastery.weakPoints`（Point 行为）+ `mastery.weakNodes`（Node 掌握度） |
| `currentTasks` | `plan.todayTasks`（studyTaskId/actionId/title/status/scheduledDate/completed/minutes/questionCount） |

**Scenario focus（保持不变，仍走专属 loaders）：**
- question → questions.findQuestionById + records.listByUser
- wrong_question → wrongQuestions.getSnapshot
- knowledge_node → scoreCenter.getKnowledgeDetail
- assessment → assessments.getSnapshot

**Boundary 关键点：** Coach 的 `focus` 块保持原样，`student` 块改为主要由 StudentContext 供给（base student context）。这实现了「StudentContext → Coach base state + existing scenario focus」的目标架构，不重写 Coach、不扩契约、不把 StudentContext 变成 AI memory / RAG context。

---

## 4. Contract Sufficiency

**基判：`READY AS-IS`（作为 base student state）。仅两处小缺口，通过「保留专属 loader 字段」补足，不扩 StudentContext。**

| 缺口 | StudentContext 现状 | 处理 |
|---|---|---|
| `student.goal.dailyHours` | 不在 contract（无此字段） | **保留 StudentState.goal.dailyHours 单独读取**，或者由调用方从 profile/user 源补充。**不加入 StudentContext**（dailyHours 不是通用摘要，是 profile 细节）。 |
| `currentTasks[].mode` | `plan.todayTasks` 无 `mode`（有 minutes/questionCount） | **保留 StudentState.studyTasks.today 的 mode**，或由专属 loader 富化。**不加入 StudentContext**（task.mode 是 StudyTask 执行细节）。 |

**明确不进 StudentContext：**
- assessment history（已被 `void assessment` 丢弃 → 完全保持 legacy）
- wrong question detail（stem/answer/analysis/attemptHistory/reviewHistory）
- question-specific data（stem/options/analysis/knowledgePointIds）
- knowledge point detail / relations / frequency / related & exam questions / userState(stabilityDays/retention)
- report-specific metrics

**结论：** 让 Coach 全部使用 StudentContext 需要扩契约（dailyHours、task.mode、scenario 专属），违反「不扩契约」红线。因此**只把 StudentContext 用作 base student state**，scenario focus 继续 legacy。**不扩 StudentContext。**

---

## 5. Identity Audit

| 身份 | 现状 | 风险 |
|---|---|---|
| `knowledgeNodeId`（Node） | StudentContext.mastery.weakNodes 用 `knowledgeNodeId`；Coach knowledge_node 请求用 `request.knowledgeNodeId` | ✅ Node |
| `knowledgePointId`（Point） | StudentContext.mastery.weakPoints 用 `knowledgePointId`；wrong_question focus 用 `item.knowledgePointId` | ✅ Point |
| `actionId` / `studyTaskId` | StudentContext.plan.todayTasks 分离 `studyTaskId` 与 `actionId` | ✅ 不混用 |
| **Node-as-Point 传播** | **发现**：`ScoreCenterService.getKnowledgeDetail(userId, knowledgePointId)` 的**参数名是 `knowledgePointId`，但 `loadKnowledgeDetail` 内部 `db.knowledgeNode.findUnique({ where: { id: knowledgePointId } })` 按 **Node** 查。** Coach 的 knowledge_node scenario 传 `request.knowledgeNodeId`（Node），功能上正确（Node in → Node out），但**参数命名误导、类型不安全**。 | ⚠️ **类型/命名风险**（非功能性 Node-as-Point bug），需在实现时重命名为 `knowledgeNodeId` 或加类型守卫，**不改行为**。 |
| wrong_question 的 `knowledgeNodeIds?` | `WrongQuestionItemSnapshot` 有 `knowledgeNodeIds?` 数组（Node），Coach 只用 `knowledgePointId`（Point）。可用未用。 | ✅ 无；若未来要用，须明确 Node 空间。 |
| legacy StageReport 的 Node-as-Point | Coach **未消费** StageReport.mastery.weakestPoints（Coach 用 StudentState.weakPoints / WrongQuestion * own focus） | ✅ 未传播。 |

**结论：** Coach context 不消费 legacy Node-as-Point 字段；唯一风险是 `getKnowledgeDetail` 参数命名误导（Node 值标为 Point 名），实现时应重命名/加守卫，不改业务行为。**StudentContext 侧身份安全。**

---

## 6. asOf / Freshness

| 时间来源 | 现状 | 风险 |
|---|---|---|
| `StudentContext.asOf` | `getContext(userId, asOf)` 单次解析，传给每个 loader 与 selector | ✅ 统一读边界 |
| Coach `assembledAt` | `new Date().toISOString()`（每次调用实时） | ⚠️ 与 StudentContext.asOf 不同步（见下） |
| Coach focus loaders | 各 loaders 默认 `new Date()`（如 wrongQuestions.getSnapshot 无 asOf） | ⚠️ 与 base 的 asOf 不同 window |
| StudentState.goal | StudentStateProjectionService.getSnapshot(userId, asOf = new Date()) | ⚠️ 无显式 asOf 传入时用当前时间 |

**发现的 window / freshness 不一致：**
- Coach.base 若改读 StudentContext（带 `asOf`），而 focus loaders 仍用各自默认当前时间，则 **base 与 focus 可能来自不同时间基点**（base 的 asOf 已定，focus 的 snapshot 默认即时）。
- `assembledAt`（实时）与 StudentContext.freshness（基于来源观察时间）语义不同。

**策略（本阶段不实现 global snapshot/cache）：**
1. **StudentContext 作为 base 的统一时间入口**：Coach.assemble 对 `student` 块传入显式 `asOf`（可复用 `/student-context` 的 asOf，或在 assembler 内解析一次传给 `getContext`）。
2. **focus loaders 保持各自时间**（scenario 专属，需最新实时数据）；记录 base asOf vs focus 时间为不同基点，**不强行对齐**（Coach 场景 focus 需要最新题目/错题实时状态，base 只需稳定的阶段性摘要）。
3. **`assembledAt` 保留为响应元数据**（Coach 响应给前端的时间戳），与 base asOf 分离。
4. **明示**：本阶段不引入 request-level 固定 asOf / cache；只把 StudentContext 作为 base 的单一时间入口，并记录 focus 与 base 的时间基点差异。

---

## 7. Duplicate Query / Duplication Risk

| 风险 | 级别 | 说明 | 处理 |
|---|---|---|---|
| base student state 由 StudentContext 与 StudentStateProjectionService 各读一次 | 中 | 迁移前：`studentState.getSnapshot`（goal/mastery/weakPoints/currentTasks）被 Coach 读；迁移后改为 `StudentContextQueryService.getContext`。StudentContext 内部仍会调 StudentStateProjectionService，故**不新增**真正重复，只是把 Coach 的读从「直接 StudentState」改为「经 StudentContext（含 StudentState + Practice + WrongQuestion + TodayPlan + Assessment + supplemental）」 | 迁移复用 StudentContext，**不并行保留**两套 base 读（StudentContext 是 canonical base） |
| focus loaders（question/wrong/knode/assessment）与 base 重复 | 低 | focus 是场景专属，base 是摘要；二者数据口径不同，**非重复** | focus 保留 legacy |
| `assembledAt` vs StudentContext.asOf | 低 | 两个时间戳语义不同 | 分离标注 |
| `/ai/contextual-coach` 内部多次 DB 读 | 中 | 现状：base + focus 各自触发 DB；StudentContext 内部已做 Promise.all 并行 | 迁移后 base 由 StudentContext 一次组装（内部并行），比现状更聚合 |

**结论：** 迁移本质上把 base 的读取**收敛到 StudentContext**（更聚合、少重复），focus 保持专属。不新增第二套 base 读。

---

## 8. Migration Strategy（最多 2~3 步）

**Step 1 — base context bridge（核心）**
- 在 `ContextualCoachContextAssembler` 注入 `StudentContextQueryService`（**追加到构造器末尾，带 `@Optional` 更稳**，参照 Sprint 3.3 同款教训）。
- `assemble()` 的 `student` 块与 `currentTasks` 改为由 `StudentContextQueryService.getContext(userId, asOf)` 供给：`goal` ← `exam`+`profile`；`masterySummary`/`weakPoints` ← `mastery`；`currentTasks` ← `plan.todayTasks`。
- **dailyHours 与 task.mode 两处缺口**：保留从 `StudentState.goal.dailyHours` / `studyTasks.today.mode` 补足（若 base 已不读 StudentState，在这两处单独读或由调用方富化）。
- `asOf`：assemble 内解析一次传给 `getContext`，作为 base 统一时间入口。
- 不改 focus、不改 prompt、不改 normalizer、不改 AI 调用。

**Step 2 — scenario integration（可选，轻量）**
- 仅当某个 scenario 的 focus 明确需要 base 摘要做补充（如 knowledge_node 用 `mastery.weakNodes` 增加上下文占比）时，从 Step 1 的 StudentContext 结果里取字段。
- **不把 scenario focus 专属数据写进 StudentContext。**
- 不改 loaders 的查询。

**Step 3 — cleanup / duplicate-read reduction**
- 若 Step 1 后 Coach 不再直接读 `StudentStateProjectionService.getSnapshot`（仅剩 dailyHours/mode 两处），评估是否将该两处也收敛或注明保留。基准仍是「不扩契约、不破坏 focus」。
- 移除或保留 base 与 focus 的时间冲突证明（记录 asOf 语义）。

**不要拆成大量微阶段。** 推荐仅执行 Step 1（base bridge）作为本轮迁移主体；Step 2/3 可视需要后续单独批准。

---

## 9. Non-Goals

本轮明确不做：
- RAG
- Agent
- prompt redesign / AI behavior 改变
- model 调用协议改变
- Recommendation 迁移
- Knowledge 迁移
- Assessment 迁移
- Schema / Migration 修改
- D4-B4
- 把 StudentContext 扩成包含 dailyHours / task.mode / assessment history / wrong detail / knowledgePoint detail / report metrics
- 实现 global snapshot / request-level cache
- 修改 Student State 写路径

---

## 10. Gate Decision

**READY FOR COACH MIGRATION**

判定依据：
- `StudentContext` **足以作为 Coach 的 base student state**：覆盖 `student.goal`（缺 dailyHours）、`student.masterySummary`/`weakPoints`（mastery 完整，Node/Point 正确）、`currentTasks`（plan.todayTasks，缺 mode）。
- 两处缺口（`dailyHours`、`task.mode`）**通过保留专属字段补足，不扩 StudentContext** —— 符合「不要为了 Coach 扩契约」。
- 四个 scenario 的 focus 数据（题目详情、错题 attempt/review history、知识节点 relations/frequency/related & exam questions、测评历史）**StudentContext 全未覆盖，继续 legacy loader**。
- **Dependency direction 正确**：`ContextualCoachContextAssembler → StudentContextQueryService → StudentContext`（允许）；不出现 `StudentContextQueryService → ContextualCoachService`（禁止）；不把 StudentContext 接到 AI write path（禁止）。
- **Identity 安全**：无 legacy Node-as-Point 传播；唯一风险是 `getKnowledgeDetail` 参数名 `knowledgePointId` 实则按 Node 查 —— 实现时重命名/加守卫，不改行为。
- **asOf/freshness 策略**：StudentContext 作为 base 的统一时间入口；focus loaders 保留各自时间；不实现 global snapshot/cache。

**下阶段（需单独批准）**：执行 Step 1 base context bridge —— 在 ContextAssembler 注入 `StudentContextQueryService`，把 `student` 块与 `currentTasks` 改为 StudentContext 供给，保留 dailyHours/mode 补足，focus 不动。前提：不扩契约、不重写 Coach、不破坏 focus/Agent 边界。

必须遵守沿用约束：
- StudentContext != Source of Truth；`learningSignal/UserEvent` 不直接改 mastery。
- 保留 `ENV-005 = BLOCKED`、`D4-B4 = BLOCKED BY ENVIRONMENT`。
- 本门禁未修改任何生产代码；完整 `npm test` / Vite bundle / PostgreSQL integration 仍受宿主环境 `spawn EPERM` 阻塞，如实记录。
