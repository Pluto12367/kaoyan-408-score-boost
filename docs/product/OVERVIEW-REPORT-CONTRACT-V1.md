# Overview Report Contract v1

> 状态：**Contract Freeze（契约已冻结；Projection 与学生侧核心消费者已实现，迁移差异见 parity matrix）**
>
> 基线：分支 `feature/v3-product-refactor`，HEAD `ac81e26`。本文只定义 Overview Report 的事实契约、语义和兼容边界；不改变 `/reports/overview`、`/dashboard/overview`、前端、Student State 写路径、Recommendation、AI、Schema 或历史数据。

## 1. Purpose

Overview Report 的职责是回答：

1. 学生当前的目标和学习状态是什么？
2. 哪些 **Node mastery** 薄弱，哪些 **Point practice** 行为有风险？
3. 最近一个明确时间窗口内，正确率、速度、复习和测评是否改善？
4. 下一步行动是什么，以及它能回指哪些事实证据？

它是 read model，不是事实写入器、推荐算法本身或 AI 决策器。所有结论都必须能回指事实、投影或确定性 selector。

## 2. Current Entry and Migration Boundary

当前真实调用链：

```text
GET /reports/overview
  → StudyController.getOverviewReport()
  → StudyService.getOverviewReport()
  → computeWeaknessReport(PracticeRecord + KnowledgePoint)
  → MasterySummaryProjectionService.toReportMasteryDto()（存在时）
  → legacy WeaknessReport / ReportWithMasterySummary
```

`/reports/overview` 当前没有独立 QueryService 或 OverviewReportProjectionService，且 Web 没有直接调用该端点；`ReportWorkspace` 由 `TestSection` 挂载，使用 App 通过 `fetchDashboardOverview()` 得到的组合数据。

```text
StudentHome / App
  → fetchDashboardOverview()
  → GET /dashboard/overview
  → DashboardQueryService.getDashboardOverviewCompat()
  → 有 StudyService 注入时委托 StudyService.getDashboardOverview()
  → report = getOverviewReport(), plan = generatePlan(), 以及其他 legacy 聚合
```

新投影链的事实基础已经存在：`OverviewReportSnapshot`、`OverviewReportSelector`、`StudentStateProjectionService`、`MasterySummaryProjectionService`。它们本轮只作为契约依据，不在本任务接线。

## 3. Canonical Overview Contract

以下是 V1 的逻辑响应。实际 API 命名和版本化由后续 Projection/Adapter 任务决定；本任务不改变现有响应。

```ts
interface OverviewReportV1 {
  contractVersion: 'overview-report-v1';
  userId: string;
  asOf: string;                 // ISO-8601 instant
  generatedAt: string;          // ISO-8601 instant
  source: 'overview_report_projection' | 'empty';
  windows: {
    today: OverviewWindow;
    last7d: OverviewWindow;
    last30d: OverviewWindow;
    allTime: OverviewWindow;
  };
  summary: OverviewSummary;
  mastery: OverviewMastery;
  weaknesses: OverviewWeaknesses;
  practicePerformance: OverviewPracticePerformance;
  assessmentPerformance: OverviewAssessmentPerformance;
  reviewStatus: OverviewReviewStatus;
  recommendedActions: OverviewRecommendedAction[];
  evidence: OverviewEvidenceIndex;
}
```

### 3.1 Summary

| 字段 | 类型 | 含义/来源 | ID 类型 | 时间窗口 | 可空/证据 | 兼容行为 | 当前 consumer |
|---|---|---|---|---|---|---|---|
| `summary.goal.targetScore` | `number \| null` | User 目标分 | 无 | as-of | 可空；无独立 evidence | legacy `student.targetScore` | StudentHome、ReportWorkspace |
| `summary.goal.currentScore` | `number \| null` | User 当前分或诊断输入，不等同最近测评 | 无 | as-of | 可空；来源标记 `user_profile` | legacy student 字段 | Home、Report |
| `summary.goal.studyStage` | `string \| null` | User.studyStage | 无 | as-of | 可空 | legacy `stage` | Home、Test |
| `summary.goal.remainingDays` | `number \| null` | User.remainingDays | 无 | as-of | 可空 | legacy student 字段 | Home、Plan |
| `summary.goal.weakestSubject` | `string \| null` | 诊断目标中的最弱科目 | 无 | as-of | 可空 | legacy student 字段 | Home、Report |
| `summary.learningState` | `'stable' \| 'rising' \| 'risky' \| 'insufficient_data'` | 基于已定义窗口和样本的状态标签；不是事实表字段 | 无 | last30d + allTime | 数据不足必须是 `insufficient_data` | legacy `LearningProfile.insights.learningState` 仅兼容 | LearningProfilePanel |
| `summary.dataQuality` | `{ status, reasons[] }` | 投影是否有足够数据、映射或目录缺口 | 无 | as-of | 必须存在 | legacy 无对应字段 | 新 consumer |

### 3.2 Mastery（Node identity）

“掌握度”在 Canonical Contract 中默认指 **KnowledgeNode mastery**，来源为 `UserKnowledgeMastery`；不能用 Point practice accuracy 代替。

```ts
interface OverviewMastery {
  source: 'user_knowledge_mastery' | 'empty';
  averageMastery: number | null;       // 0..100
  nodeCount: number;
  practicedNodeCount: number;
  weakCount: number;
  reviewCount: number;
  masteredCount: number;
  lastUpdatedAt: string | null;
  nodes: Array<{
    knowledgeNodeId: string;
    title: string;
    subject: string;
    chapter: string;
    masteryRate: number | null;
    accuracyRate: number | null;
    attempts: number;
    wrongCount: number;
    status: 'untouched' | 'weak' | 'review' | 'mastered';
    evidence: EvidenceRef[];
  }>;
}
```

| 规则 | 冻结语义 |
|---|---|
| identity | 每个节点只用 `knowledgeNodeId`；禁止在 canonical mastery 中出现 `knowledgePointId` 承载 Node 值 |
| mastery rate | 由 `UserKnowledgeMastery.mastery` 投影为百分制或明确小数约定；V1 推荐响应使用 0–100 |
| accuracy | 节点相关作答统计，是辅助指标，不等于 mastery |
| empty | 无 UserKnowledgeMastery 行时 `source='empty'`、`averageMastery=null`、`nodes=[]`，不能用 0 冒充已掌握度 |
| evidence | mastery row、相关 snapshot 或明确的 projection evidence；不能凭标题推断 |

### 3.3 Weaknesses（Node 与 Point 分开）

```ts
interface OverviewWeaknesses {
  nodeWeaknesses: Array<{
    idType: 'knowledgeNodeId';
    knowledgeNodeId: string;
    title: string;
    masteryRate: number;
    weaknessScore: number;
    attempts: number;
    wrongCount: number;
    evidence: EvidenceRef[];
  }>;
  practiceWeaknesses: Array<{
    idType: 'knowledgePointId';
    knowledgePointId: string;
    title: string;
    accuracyRate: number;
    wrongCount: number;
    attempts: number;
    topReason: string | null;
    weaknessScore: number;
    evidence: EvidenceRef[];
  }>;
  speedRisks: Array<{
    idType: 'knowledgePointId';
    knowledgePointId: string;
    title: string;
    attempts: number;
    slowCount: number;
    evidence: EvidenceRef[];
  }>;
}
```

- **Node weakness**：Node mastery 较低，来自 `UserKnowledgeMastery`/mastery projection。
- **Practice weakness**：Point/题目行为表现较差，来自 `PracticeRecord` 聚合；`OverviewReportSelector` 已按 Point 聚合并保留 `evidenceRecordIds`。
- **Speed risk**：Point 行为中超过 expected time 的风险，仍是行为指标。
- V1 不输出无 `idType` 的 `weakPoints[]` 作为 canonical 字段。旧 `weakPoints[]` 只能在 legacy adapter 中存在。

### 3.4 Practice Performance（Point behavior）

```ts
interface OverviewPracticePerformance {
  today: PracticeWindowMetrics;
  last7d: PracticeWindowMetrics;
  last30d: PracticeWindowMetrics;
  allTime: PracticeWindowMetrics;
}

interface PracticeWindowMetrics {
  window: OverviewWindow;
  attemptCount: number;
  correctCount: number;
  accuracyRate: number | null;
  averageTimeSpentSec: number | null;
  slowAttemptCount: number;
  mistakeReasons: Array<{ reason: string; count: number; share: number }>;
  evidence: EvidenceRef[];
  dataStatus: 'ready' | 'insufficient_data';
}
```

来源是 `PracticeRecord`（包含 `knowledgePointId`、correct、timeSpentSec、expectedTimeSec、mistakeReason、submittedAt）。`accuracyRate`、平均耗时和趋势在 `attemptCount=0` 时为 `null`，计数仍为 0。

### 3.5 Assessment Performance

```ts
interface OverviewAssessmentPerformance {
  latest: AssessmentMetric | null;
  previous: AssessmentMetric | null;
  trend: 'up' | 'down' | 'flat' | 'insufficient_data';
  sampleSize: number;
  evidence: EvidenceRef[];
}

interface AssessmentMetric {
  assessmentId: string | null;
  sessionId: string | null;
  score: number;
  accuracyRate: number | null;
  submittedAt: string;
}
```

来源优先为 `AssessmentHistoryItem`/AssessmentHistoryProjection；考试会话可通过 `LearningSession`/exam report 关联。`score` 不能被 Node mastery 或 PracticeRecord accuracy 替换。小于 2 个可比较样本时，trend 必须为 `insufficient_data`。

### 3.6 Review Status

```ts
interface OverviewReviewStatus {
  todayDueCount: number;
  overdueCount: number;
  pendingWrongQuestionCount: number;
  reviewedWrongQuestionCount: number;
  resolvedWrongQuestionCount: number;
  reviewAttemptCount: number;
  nextReviewAt: string | null;
  evidence: EvidenceRef[];
  dataStatus: 'ready' | 'insufficient_data';
}
```

来源分别为 `ReviewSchedule`、`ReviewAttempt`、`WrongQuestionReview`。`todayDueCount` 的边界必须由 `windows.today` 的 `[fromInclusive,toExclusive)` 定义，不由前端当前时间自行计算。

### 3.7 Recommended Actions

推荐行动不是 Overview 的事实源，而是下游 Recommendation/StudyTask 的可解释结果：

```ts
interface OverviewRecommendedAction {
  actionId: string;
  actionType: 'learn' | 'practice' | 'review' | 'assessment' | 'continue_task';
  title: string;
  reasonCodes: string[];
  target?: {
    knowledgeNodeId?: string;
    knowledgePointId?: string;
    questionIds?: string[];
    studyTaskId?: string;
  };
  source: 'recommendation_engine' | 'study_task' | 'review_schedule' | 'fallback';
  evidence: EvidenceRef[];
  status: 'available' | 'completed' | 'blocked' | 'insufficient_data';
}
```

`knowledgeNodeId` 与 `knowledgePointId` 可以同时出现，但必须表示各自空间；任何 `ids[]` 必须声明空间。Overview 不重新计算 priority，不让 AI 改写 actionType。

### 3.8 Evidence Index

```ts
type EvidenceKind =
  | 'practice_record'
  | 'mastery_row'
  | 'mastery_snapshot'
  | 'assessment_item'
  | 'review_schedule'
  | 'review_attempt'
  | 'wrong_question_review'
  | 'study_task'
  | 'recommendation_result';

interface EvidenceRef {
  kind: EvidenceKind;
  id: string;
  occurredAt?: string;
  idType?: 'knowledgePointId' | 'knowledgeNodeId' | 'questionId' | 'assessmentId' | 'studyTaskId';
  knowledgePointId?: string;
  knowledgeNodeId?: string;
}

interface OverviewEvidenceIndex {
  refs: EvidenceRef[];
  generatedBy: 'overview_report_projection';
}
```

关键结论必须带 `evidence`；如果现有事实不能提供具体 ref，输出 `dataStatus='insufficient_data'` 或空 evidence，不制造“有依据”的文案。本任务不新增 Evidence storage subsystem。

## 4. Point / Node Identity Rules

| identity | 允许语义 | 禁止语义 |
|---|---|---|
| `knowledgePointId` | `KnowledgePoint.id`、`PracticeRecord`、Point 行为弱点、旧兼容 DTO | 不得承载 `KnowledgeNode.id` |
| `knowledgeNodeId` | `KnowledgeNode.id`、`UserKnowledgeMastery`、Recommendation、canonical 个性化掌握 | 不得写入 Point 字段 |
| `knowledgePointIds[]` | 全部元素必须是 Point ID | 不得混入 Node ID |
| `knowledgeNodeIds[]` | 全部元素必须是 Node ID | 不得混入 Point ID |
| `id` | 只有在对象类型已固定时使用 | 不得单独表示未知知识实体 |

Point↔Node 映射通过 `KnowledgePointNodeMap`/`QuestionKnowledgeNodeTag` 的既有关系完成；Overview 只引用映射结果，不创建第二套算法。

## 5. Mastery Semantics

1. Canonical “掌握度” = Node mastery = `UserKnowledgeMastery.mastery`。
2. Point practice 的 `accuracyRate` 只表示作答行为，不得改名为 mastery。
3. `masteryStatus` 由 Node mastery 与 attempts 的既有 `deriveNodeMasteryStatus` 规则产生。
4. 没有 mastery row 时不能把 `0` 解读为“完全不会”；必须输出 `null + insufficient_data`。
5. Legacy `toReportMasteryDto()` 当前为了旧 `WeaknessReport` 把 `knowledgePointId` 填为 Node ID；该行为标记为 **LEGACY COMPATIBILITY ONLY**，不得进入 Canonical Contract。

## 6. Weakness Semantics

- `nodeWeaknesses` 排序和分数来自 Node mastery projection；证据是 mastery row/snapshot。
- `practiceWeaknesses` 与 `speedRisks` 来自 Point-scoped PracticeRecord 聚合；`OverviewReportSelector` 的 `weakPointSelection`、`speedRiskSelection` 是现有基础。
- 两个列表可以指向同一主题，但不能因名称相同就当成同一 identity；需要通过显式 Point→Node map 关联。
- 空列表表示当前窗口没有该类候选，不表示目录中所有内容均已掌握。

## 7. Progress Semantics

“进步”必须包含：

```ts
interface ProgressMetric {
  metric: 'accuracy' | 'speed' | 'mastery' | 'assessment_score' | 'review_resolution';
  window: OverviewWindow;
  current: number | null;
  baseline: number | null;
  delta: number | null;
  sampleSize: number;
  status: 'up' | 'down' | 'flat' | 'insufficient_data';
  evidence: EvidenceRef[];
}
```

V1 禁止只输出“最近表现有所提升”。必须携带窗口、基线、样本量和 evidence。Mastery 的 baseline 优先使用 `UserMasterySnapshot`；没有快照时不能用随机截断的当前 rows 伪造趋势。

## 8. Time Window Semantics

所有窗口由服务端生成并在响应中返回边界：

```ts
interface OverviewWindow {
  key: 'today' | 'last7d' | 'last30d' | 'allTime' | 'assessmentPeriod';
  fromInclusive: string | null;
  toExclusive: string; // ISO-8601 UTC
  timezone: 'UTC';
}
```

V1 约定：

- `asOf` 是截断前的服务端当前时刻。
- `today` = `asOf` 所在 UTC 日 `[00:00, 次日 00:00)`。
- `last7d` = 包含 today 的连续 7 个 UTC 日。
- `last30d` = 包含 today 的连续 30 个 UTC 日。
- `allTime` = `[null, toExclusive=asOf]`，只纳入 `submittedAt/updatedAt <= asOf` 的事实。
- `assessmentPeriod` = 由 assessment items 的最早至最新提交时间确定；不足 2 个样本时 trend 为 `insufficient_data`。

当前代码在不同服务中同时使用 rolling Date、`startOfDay`、`startOfUtcDay` 和未切窗的全量 records；这属于 **CURRENT INCONSISTENCY**，本 Task 只冻结目标语义，不回填实现。

## 9. Evidence Semantics

- 结论级字段（弱点、趋势、推荐行动）必须可以引用一个或多个 `EvidenceRef`。
- `evidenceRecordIds` 可继续作为 legacy/selector 内部快捷字段，但 Canonical Contract 使用带 `kind`/`idType` 的 EvidenceRef。
- Evidence 表示“参与计算的事实”，不是 LLM 生成文本，也不是用户点击事件本身。
- Evidence 缺失不能由前端自己查表补齐；应标记 `insufficient_data` 或 `dataQuality.reasons`。
- 本轮不增加数据库表、索引或历史回填。

## 10. Null / Insufficient Data Semantics

| 情况 | Canonical 输出 | 禁止行为 |
|---|---|---|
| 无 PracticeRecord | attempt=0，率/速度为 null，`dataStatus=insufficient_data` | 输出 0% 并写“表现稳定” |
| 无 UserKnowledgeMastery | `mastery.source=empty`，average/node values 为 null/空 | 把 0 当成完全不会 |
| 无 assessment history | latest/previous/trend 为 null/insufficient_data | 用当前分或练习正确率冒充测评趋势 |
| 无 review schedule | due/overdue=0，nextReviewAt=null；整体状态可为 ready | 推断学生不需要复习 |
| Point 无 Node map | 保留 Point practice 事实，Node weakness 不强行合并 | 用字符串相等硬匹配 |
| 目录/事实缺失 | 保留 raw identity，增加 dataQuality reason | 静默 fallback 到 mock 或错误标题 |

计数为 0 与指标为 null 是有意区分：前者是可确定的数量，后者表示没有足够样本计算比例或趋势。

## 11. Legacy Compatibility Rules

Canonical → Adapter → Legacy DTO，方向不可反转：

```text
OverviewReportV1
  → legacy overview/report adapter
  → /reports/overview 或 /dashboard/overview 旧响应
```

必须保留的兼容面：

- `GET /reports/overview` 现有 `WeaknessReport` 形状。
- `GET /dashboard/overview` 的 `student/knowledgePoints/questions/practiceRecords/wrongQuestions/learningCalendar/stageAssessment/report/plan` 组合形状。
- `WeaknessReport.weakPoints[]`、`StudyPlan.dailyTasks[].knowledgePointId` 等旧字段，直到所有消费者迁移完成。
- `MasterySummaryProjectionService.toReportMasteryDto()` 的 Node-as-Point 映射只能留在 adapter，必须标注 legacy。

禁止：

- 用 legacy `knowledgePointId` 反向填充 canonical `knowledgeNodeId`。
- 将 legacy `estimatedGain`、`suggestion`、`nextAction` 当作事实放入 Snapshot。
- 删除旧 endpoint 或让旧 consumer 直接读取未声明的新字段。

## 12. Source of Truth Rules

```text
PracticeRecord / UserKnowledgeMastery / ReviewSchedule / WrongQuestionReview
StudyPlan / StudyTask / AssessmentHistory / LearningSession
        ↓
Projection facts (OverviewReportSnapshot)
        ↓
Selector (weakness/progress selection)
        ↓
OverviewReportV1
        ↓
Legacy Adapter
        ↓
Consumer
```

Controller 不直接拼底层表；Frontend 不自行计算 mastery、weakness 或 trend；AI 只能解释已经组装的 Overview facts。

## 13. Consumer Expectations

| Consumer | 应读取 | 不应读取/推断 |
|---|---|---|
| StudentHome | summary、today action、mastery summary、node/practice weakness 摘要、review counts | 不从 `weakPoints[]` 猜 ID 类型，不自行算 mastery |
| ReportWorkspace | mastery、practicePerformance、assessmentPerformance、reviewStatus、evidence | 不将 assessment score 与 mastery 合并为一个分数 |
| Recommendation/Today Plan | action target、reasonCodes、Node identity | 不从报告文案反推推荐优先级 |
| Knowledge 页面 | `knowledgeNodeId` mastery 与显式 mapping 后的 Point/题目 | 不把 Point accuracy 显示为 Node mastery |
| ContextualCoach | 结构化 facts 和 evidence 摘要 | 不执行计划/任务/掌握度写入，不自行检索不存在的事实 |
| Legacy API | 通过 adapter 获得旧字段 | 不污染 canonical snapshot |

## 14. Versioning Rules

- 响应必须带 `contractVersion='overview-report-v1'`。
- 新增可选字段优先向后兼容；改变字段语义必须升主版本。
- 改变 ID 空间、时间窗口或 null 语义必须记录 decision 和 parity 影响。
- Selector 算法版本（当前 `overview-selector-v1`）与 Contract 版本独立记录。
- Adapter 可按 consumer 版本存在多个实现，但只能从 canonical model 生成。

## 15. Non-Goals

本契约不包含：

- `OverviewReportProjectionService` 实现或任何 endpoint 接线。
- 修改 PracticeRecord、UserKnowledgeMastery、Recommendation 或 Student State 写路径。
- 数据迁移、历史回填、Schema/Migration 修改。
- RAG、embedding、vector search、tool calling、Agent loop。
- 新 Evidence 存储系统。
- 前端首页/报告重构。

## 16. Freeze Checklist

- [x] Point / Node identity 明确分离。
- [x] “掌握度”固定为 Node mastery。
- [x] Node weakness 与 practice weakness 分离。
- [x] progress 必须带窗口、样本量和状态。
- [x] evidence 只定义语义，不新增存储系统。
- [x] empty/null/insufficient_data 规则明确。
- [x] legacy 只允许在 adapter boundary 使用。
- [x] 未实现 Projection、未迁移 consumer、未修改业务代码。
