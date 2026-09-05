# StudentContext Contract Evolution

日期：2026-09-05（SC-5 TASK 5）
状态：**v1（不升级版本）** — 本文档定义演进规则，不改变任何契约行为
相关：`docs/student-context-contract.md`（契约本体）、`docs/student-context-contract-hardening-report.md`（P-1 先例）

---

## 1. Current v1

### 1.1 Version identity

```ts
version: 'student-context-v1'   // STUDENT_CONTEXT_VERSION, student-context.contract.ts
```

### 1.2 Fields & ownership

| Section | 字段 | 事实来源（SoT） | 语义要点 |
|---|---|---|---|
| `version` / `userId` / `asOf` | 契约标识 | — | asOf = 单点解析的读边界；selector 无时钟 |
| `freshness` | asOf/status/sources[].observedAt | 各 source 观察时间 | available/unavailable；不等于事件发生时间 |
| `profile` | name/role/targetSchool/weakestSubject/diagnosis | `User` + 诊断 | 缺失 = null，不伪造 |
| `exam` | examYear/targetScore/currentScore/remainingDays/studyStage | `User` 目标事实 | 不含 dailyHours（有意排除，Coach 缺口读保留） |
| `mastery` | source / weakNodes / weakPoints / improvingPoints / masteredPoints / lastUpdatedAt | `UserKnowledgeMastery`（Node 桶）+ `PracticeRecord`（Point 行为弱点） | improvingPoints 含 review-stage 节点（P-1）；weakPoints = **top-20 by wrongCount**（SC-5 有界）；桶行身份 = `knowledgeNodeId` |
| `practice` | source / recentAccuracy / recentVolume / subjectDistribution / totalCount / latestSubmittedAt | `PracticeRecord` | trend 统一 window/baseline/sampleSize/status/value；insufficient_data ≠ 0 |
| `review` | source / dueCount / overdueCount / reviewedCount / resolvedCount / highRiskQuestions / nextReviewAt | `ReviewSchedule` / `ReviewAttempt` / `WrongQuestionReview` | 不含 pendingWrongQuestionCount（有意排除；canonical 在 /overview/canonical.reviewStatus） |
| `plan` | source / planId / todayTasks / completion | `StudyPlan` / `StudyTask` | task 身份 = `studyTaskId`，`actionId` 分离；不含 mode |
| `momentum` | studyStreak / recentSessions(≤10) / activityTrend | LearningSession + activity facts | streak 派生自 activityDays |
| `recommendationEvidence` | source/timestamp/身份字段 的**有界 provenance window（≤60 行，时间倒序）** | `RecommendationAction` | provenance 而非第二推荐源；防御性归一（malformed 行不致命，source 缺失='unknown'，仅契约字段保留） |

### 1.3 Consumers（全部经 canonical 边界）

| 消费者 | 通道 | 适配层 |
|---|---|---|
| StudentHome | `GET /student-context`（useStudentContextData） | `studentHomeContextAdapter` |
| ReportWorkspace summary | 同上 | `reportWorkspaceContextAdapter` |
| Contextual Coach（backend base） | `StudentContextQueryService.getContext` | `toStudentContextBase`（Coach 汇编器内） |

独立领域（不经过 StudentContext，见 consumer audit）：KnowledgeCatalog（全量 mastery 图）、Assessment（考试分析）、错题/趋势/档案/trial/reminders/sprint/推荐明细。

### 1.4 v1 内已落地的语义演进（向后兼容先例）

| 变更 | 批次 | 类型 |
|---|---|---|
| improvingPoints 桶并入 review-stage 节点（P-1） | SC-3 | 值域修正（shape 不变，注释澄清） |
| weakPoints top-20 有界化 | SC-5 | 摘要列表上界（shape 不变） |
| recommendationEvidence ≤60 行 provenance window + 防御归一 | SC-5 | 有界化 + 鲁棒性（shape 不变） |

## 2. Future v2 Strategy（未触发，仅规则）

### 2.1 v1 内允许（无需升版）

1. 新增**可选**字段 / 新只读节（消费者可渐进采用）。
2. 值域/语义修正（前提：shape 不变 + 契约注释 + 消费者回归全绿，参照 P-1 流程）。
3. 有界化/排序等确定性策略调整（须在契约文档记录窗口语义）。
4. 防御性归一强化（不得改变合法输入的输出）。

### 2.2 v2 触发条件（任一出现才升版）

- 字段**重命名或删除**；
- 现有字段**语义破坏性变化**（如 trend 窗口语义重构、桶含义改变）；
- 类型收紧（如 `string | null` → `string`）导致旧消费者类型不合法。

### 2.3 v2 迁移流程

```text
1. 提案（契约 diff + 消费者影响矩阵 + parity 清单）→ 人工批准
2. 双轨期：同一响应/端点并行提供 v1 形状（v1Mirror 或兼容 adapter）与 v2
3. 契约测试双版本 parity（差异清单显式化，禁止隐式 diff）
4. 消费者逐个切换（StudentHome → Report → Coach），每个独立批次 + 回归
5. 下线 v1（确认零消费者后）
```

前端 `apps/web/src/api/types.ts` 的契约 mirror 必须与后端契约**同批次**演进；`version` 字段是消费者分支依据，不得在同一 version 下做破坏性变更。

### 2.4 Parity validation 规则

- 每次演进批次必须包含：selector 契约测试（形状 + 身份 + 时序）+ 三消费者 adapter 回归 + query-boundary 测试 + performance 预算测试。
- 现行回归基线：**SC-5 后全量定向套件共 77 项**（见 final report §5 测试清单）。
- 任何"改断言凑绿"禁止；语义变化必须先改文档与提案，再改测试期望。

## 3. Explicitly frozen（本文件不改变现状）

- version 保持 `student-context-v1`；无 v2 字段、无 deprecation 标记需求。
- 有意排除项维持排除：dailyHours、task.mode、pendingWrongQuestionCount、assessment 历史、图谱/详情（见 1.2 与 consumer audit）。
