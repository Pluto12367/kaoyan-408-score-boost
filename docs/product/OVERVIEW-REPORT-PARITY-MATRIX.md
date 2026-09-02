# Overview Report Parity Matrix

> 用途：记录当前 `/reports/overview`、`/dashboard/overview` 行为与 `Overview Report Contract v1` 的差异，为后续 Projection/Adapter 迁移提供基线。
>
> 本文件只读审计结果，不代表本轮已修改 endpoint、consumer 或数据库。

## 1. Endpoint and Consumer Chains

### `/reports/overview`

```text
StudyController.getOverviewReport
  → StudyService.getOverviewReport
  → computeWeaknessReport(
      this.knowledgePoints,
      this.records[userId],
      targetScore
    )
  → applyCatalogDisplay
  → MasterySummaryProjectionService.getProjectionFromRows (if available)
  → toReportMasteryDto
  → WeaknessReport / ReportWithMasterySummary
```

代码证据：`apps/api/src/study/study.controller.ts`（`@Get('reports/overview')`）、`apps/api/src/study/study.service.ts`（`getOverviewReport`）、`apps/api/src/study/mastery-summary-projection.service.ts`（`toReportMasteryDto`）。

Web 当前没有直接调用 `/reports/overview` 的 endpoint wrapper。`ReportWorkspace` 由 `TestSection` 挂载，数据来自 App 的 `fetchDashboardOverview()` 组合响应。

### `/dashboard/overview`

```text
StudentHome / App / teacher refresh
  → fetchDashboardOverview
  → GET /dashboard/overview
  → StudyController.getDashboardOverview
  → DashboardQueryService.getDashboardOverviewCompat
  → StudyService.getDashboardOverview (when optional legacy is injected)
  → getOverviewReport + generatePlan + other legacy collections
```

代码证据：`apps/web/src/api/endpoints/dashboard.ts`、`apps/web/src/hooks/useDashboardOverviewData.ts`、`apps/web/src/App.tsx`、`apps/api/src/study/dashboard-query.service.ts`、`apps/api/src/study/study.service.ts`。

`DashboardProjectionService` 和 `toLegacyDashboardOverview` 已存在，但 `DashboardQueryService` 在 `legacy` 可用时明确优先委托 legacy；因此当前生产代码路径不能被描述为“已完全切换到 projection”。

## 2. Field / Concept Matrix

状态含义：`MATCH`、`RENAME`、`SEMANTIC_MISMATCH`、`LEGACY_ONLY`、`MISSING`、`DERIVED`、`UNKNOWN`。

| Field / Concept | Current Source | Current Meaning | Canonical Meaning | ID Type | Time Window | Compatibility | Status |
|---|---|---|---|---|---|---|---|
| `userId` | Controller JWT resolution / StudyService argument | 当前查询用户 | Overview owner | none | as-of | Keep | MATCH |
| `generatedAt` | `new Date().toISOString()` in StudyService / adapters | 组装时间 | `generatedAt` + explicit `asOf` | none | instant | Add `asOf` canonically | RENAME |
| `student.targetScore` | `User` profile or memory student | 目标分 | `summary.goal.targetScore` | none | as-of | Keep via adapter | MATCH |
| `student.currentScore` | `User.currentScore` / profile | 用户资料中的当前分 | Profile current score, not assessment latest | none | as-of | Keep with source label | SEMANTIC_MISMATCH |
| `report.accuracyRate` | `computeWeaknessReport(PracticeRecord)` | 全量/未显式切窗的练习正确率 | `practicePerformance.{window}.accuracyRate` | none | CURRENT = all records; CANONICAL = explicit windows | Legacy field only | RENAME |
| `report.completionRate` | `computeWeaknessReport` / plan-derived data | 旧报告完成率，具体分母随 legacy report | Windowed task/practice completion metric with denominator | none | Not declared | Preserve only in legacy adapter | SEMANTIC_MISMATCH |
| `report.weakPoints[]` (DB Node path) | `toReportMasteryDto` replaces with `projection.weakPoints` | 代码字段叫 Point，但值为 Node ID | `weaknesses.nodeWeaknesses[]` | CURRENT value = `knowledgeNodeId`; field name = Point | as-of, no explicit window | **LEGACY COMPATIBILITY ONLY** | SEMANTIC_MISMATCH |
| `report.weakPoints[]` (legacy path) | `computeWeaknessReport` | Point 行为弱点聚合 | `weaknesses.practiceWeaknesses[]` | `knowledgePointId` | CURRENT all records; canonical explicit window | Adapter can retain shape | RENAME |
| `report.speedRisks[]` | `computeWeaknessReport` / selector equivalent | Point slow-answer risk | `weaknesses.speedRisks[]` | `knowledgePointId` | CURRENT unspecified; canonical window | Adapter | RENAME |
| `report.mistakeReasons` | `computeWeaknessReport` | 全量错因计数 map | Windowed `practicePerformance.mistakeReasons[]` with share | no knowledge ID | CURRENT unspecified | Map retained legacy | RENAME |
| `report.estimatedGain` | Legacy `computeWeaknessReport` | 估算提分值/文案指标 | Not a source fact; must be labeled derived model | none | CURRENT unspecified | Legacy-only until formula documented | LEGACY_ONLY |
| `report.summary` | `computeWeaknessReport`; `toReportMasteryDto` may inject `summary.mastery` | 混合摘要文本/对象 | Structured summary + dataQuality; no hidden mastery | none | CURRENT unspecified | Adapter may keep summary text | SEMANTIC_MISMATCH |
| `report.masterySummary` | `toReportMasteryDto` when legacy summary not object | Node mastery aggregate | `mastery` section | `knowledgeNodeId` inside node list | as-of | Keep as adapter input | RENAME |
| `mastery.averageMastery` | `MasterySummaryProjectionService` / `StudentStateProjectionService` | UserKnowledgeMastery aggregate | Node mastery average, explicit null when empty | Node | as-of | Legacy 0 may map from null | MATCH |
| `mastery.nodes[]` | `MasterySummaryProjectionService` / `/knowledge/mastery` | Node mastery rows | `mastery.nodes[]` | `knowledgeNodeId` | as-of | Keep | MATCH |
| `mastery.status` | `deriveNodeMasteryStatus` | weak/review/mastered/untouched | Same status with source declaration | `knowledgeNodeId` | as-of | Keep | MATCH |
| `practiceRecords[]` | `StudyService.getDashboardOverview` | Raw user records | Evidence/facts input, not a summary field | `knowledgePointId`, `questionId` | CURRENT all records | Legacy dashboard only | LEGACY_ONLY |
| `wrongQuestions[]` | `listWrongQuestions` / `WrongQuestionProjection` | Current wrong items, enriched title/status | `reviewStatus` + evidence refs | question + Point display; Node only via mapping | CURRENT aggregate/as-of | Adapter | RENAME |
| `wrongQuestionCount` | Dashboard adapter / legacy report | Count of current wrong items | `reviewStatus.pendingWrongQuestionCount` | none | as-of | Keep via adapter | RENAME |
| `dueReviewCount` | Dashboard adapter / ReviewSchedule projection | Due review count | `reviewStatus.todayDueCount` | question schedule | today window | Keep via adapter | RENAME |
| `reviewedCount` / `resolvedCount` | Wrong question summary | Counts derived from review/records | Explicit review status counters | questionId | as-of + today due window | Adapter | MATCH |
| `plan` | `generatePlan` / StudyPlan+StudyTask | Daily tasks and completion | `recommendedActions` for actions; plan facts remain separate | legacy tasks Point; node optional | today | Legacy plan shape retained | SEMANTIC_MISMATCH |
| `plan.dailyTasks[].knowledgePointId` | Legacy StudyPlan/StudyTask adapter | Historical task identity; DB may also carry `knowledgeNodeId` | `recommendedActions[].target.knowledgeNodeId` plus optional Point IDs | CURRENT field may be legacy Node-as-Point | today/future schedule | **Adapter only** | SEMANTIC_MISMATCH |
| `stageAssessment` | `getStageAssessment` legacy | Assessment candidate questions | Not performance; action/input resource | Point question bindings | current generated assessment | Legacy dashboard only | LEGACY_ONLY |
| `assessmentHistory` | AssessmentHistoryProjection/Repository | Historical assessment items | `assessmentPerformance.latest/previous/trend` | assessment/session | assessment period | Adapter | DERIVED |
| `assessment.latestScore` | `DashboardProjectionService` assessment facts | Most recent score | `assessmentPerformance.latest.score` | assessment/session | latest item | Adapter | MATCH |
| `assessment.trend` | `AssessmentHistorySummary`/legacy panels | May be inferred from history | Explicit trend with sample size and insufficient_data | assessment/session | assessment period | Adapter | DERIVED |
| `learningCalendar.streakDays` | StudyService calendar / Student State | Consecutive active days | Not a mastery/progress metric; optional activity fact | task/session | all-time/calendar | Keep outside core report or explicit activity section | LEGACY_ONLY |
| `suggestions` / `nextAction` | Legacy report, StudyTask, recommendation adapter | UI/action copy | `recommendedActions[]` with reasonCodes and evidence | target must declare Node/Point | today/next action | Adapter only | SEMANTIC_MISMATCH |
| `evidenceRecordIds` | `OverviewReportSelector` candidates | PracticeRecord IDs behind Point candidates | `EvidenceRef[]` typed by kind/idType | Point record or Node mastery | selector input window | Keep internal shortcut; map canonically | MATCH |
| `source` | Dashboard source / mastery source | memory-api/postgresql/legacy source | `overview_report_projection` or `empty` plus per-section source | none | as-of | Keep as metadata | RENAME |
| `insufficient_data` | Not consistently present in legacy responses | Usually empty array or 0 | Explicit status for unavailable ratios/trends | none | per window | New optional canonical field | MISSING |

## 3. Contract-Relevant Current Inconsistencies

### 3.1 Mastery semantic collision

`toReportMasteryDto()` currently creates:

```ts
{
  knowledgePointId: point.knowledgeNodeId,
  knowledgeNodeId: point.knowledgeNodeId,
  ...
}
```

This is a compatibility behavior required by existing `WeaknessReport` consumers, not a valid canonical meaning. The new contract therefore calls it `SEMANTIC_MISMATCH / LEGACY COMPATIBILITY ONLY` and keeps `knowledgeNodeId` as the authoritative identity.

### 3.2 Unspecified time windows

`computeWeaknessReport()` and the legacy `getOverviewReport()` calculate from user records without returning a window. `OverviewReportSelector` also receives a snapshot but currently has no window parameter; its `practiceRecordCount` is a snapshot count, not a declared `last7d` or `last30d` metric. This is a contract gap, not evidence that current values are wrong.

### 3.3 Report endpoint and dashboard endpoint are not the same read path

`/reports/overview` calls `StudyService` directly. `/dashboard/overview` is wrapped in a compat query, but with the optional legacy service present it also calls `StudyService.getDashboardOverview()`. The two endpoints should not be treated as interchangeable canonical sources.

### 3.4 Derived action text mixed with facts

Legacy `suggestion`, `nextAction`, `estimatedGain` and summary copy are useful UI fields but are not source facts. Canonical Overview keeps them in `recommendedActions` or derived metadata with explicit source/evidence.

## 4. Current Consumer Inventory

| Consumer | Endpoint/data entry | Fields read today | Migration implication |
|---|---|---|---|
| StudentHome / App | `fetchDashboardOverview()` → `/dashboard/overview` | `student`, `report`, `plan`, `wrongQuestions`, `learningCalendar`, `stageAssessment`; also separate today/due/mastery resources | First recommended migration consumer; needs adapter for existing props |
| ReportWorkspace | Props passed from `TestSection`; ultimately dashboard overview plus separate history/resources | `report`, `masteryMap`, trial/reminders/sprint, stageReport, assessmentHistory, plan | Must consume structured mastery/practice/assessment/review sections, not infer from `weakPoints` |
| StudentProgressOverview | report + trial/reminder/sprint/mastery resources | `report.accuracyRate`, `report.weakPoints`, completion values | Requires explicit metric/window mapping |
| LearningProfilePanel | `/students/:userId/profile` | `insights.weakPoints`, `speedRisks`, `learningState` | Not directly `/reports/overview`; keep separate until profile contract is aligned |
| RecommendationService / StudyService | internal `getOverviewReport` consumers | `weakPoints`, `speedRisks`, titles and Point IDs | Must not consume canonical Node weakness through legacy Point field |
| ContextualCoach | `/ai/contextual-coach` | Student State and scenario facts, not Overview endpoint directly | Future context may use Overview facts only through typed projection |
| KnowledgeCatalog | `/knowledge/mastery` + `/knowledge/:id` | Node mastery keyed by `knowledgeNodeId` | Already aligned with canonical Node identity |

## 5. Scope Classification

### MATCH

- `UserKnowledgeMastery` aggregate fields and Node rows can map directly to canonical `mastery`.
- `OverviewReportSelector` Point candidate evidence and Node candidate `idType` provide a good selection basis.
- Goal profile fields, review counters and assessment latest score have identifiable sources.

### RENAME

- `report.accuracyRate` → windowed `practicePerformance` metric.
- `report.speedRisks` → `weaknesses.speedRisks`.
- `masterySummary` → `mastery`.
- `generatedAt` without an `asOf` → explicit window metadata.

### SEMANTIC_MISMATCH

- `toReportMasteryDto` Node value under `knowledgePointId`.
- `report.weakPoints` used for both Point behavior and Node mastery depending on DB/projection availability.
- `completionRate`, `estimatedGain`, `suggestion`, `nextAction` treated as if they were source facts.
- Plan tasks and recommendation actions mixed in one legacy `plan` object.

### LEGACY_ONLY

- Full dashboard payload (`questions`, `knowledgePoints`, raw `practiceRecords`) as a report source.
- `stageAssessment` candidate resource inside dashboard overview.
- String summary/focus hints without typed evidence.

### MISSING

- Explicit `asOf` + per-window boundaries.
- `insufficient_data` statuses.
- Typed evidence refs for mastery, assessment and review conclusions.
- Separate canonical `nodeWeaknesses` and `practiceWeaknesses` in a public report contract.

## 6. Baseline Decisions for Task 2

1. Implement the next projection from facts into the frozen Contract, not by expanding `StudyService.getOverviewReport()`.
2. Keep `/reports/overview` and `/dashboard/overview` response compatibility through adapters.
3. Migrate one consumer first (recommended: homepage summary) and compare against this matrix.
4. Do not remove legacy fields until all listed consumers and integration tests are migrated.
5. Treat any Node ID exposed in `knowledgePointId` as a measured compatibility debt, not a new canonical contract.

## 7. Task 2 Projection Parity Verification

`OverviewReportProjectionService.buildOverview()` now produces the frozen canonical shape from read-side facts without changing either legacy endpoint. The following differences are intentional Contract v1 changes:

| Area | Result | Evidence |
|---|---|---|
| Node mastery identity | MATCH | `mastery.nodes[].knowledgeNodeId`; no Point alias in canonical output |
| Point practice weakness | MATCH | `weaknesses.practiceWeaknesses[].knowledgePointId` |
| Speed risk identity | MATCH | `weaknesses.speedRisks[].knowledgePointId` |
| Explicit windows | MATCH | UTC `today`, `last7d`, `last30d`, `allTime` boundaries |
| Empty/null semantics | MATCH | null rates and `insufficient_data`, never synthetic zero rates |
| Assessment separation | MATCH | latest/previous score and independent trend |
| Typed evidence | MATCH | practice, mastery, assessment, review and task refs |
| Legacy endpoint parity | LEGACY_ONLY | endpoints remain on existing StudyService/compat paths by scope |
| Consumer migration | EXPECTED_CHANGE | Homepage summary now reads canonical mastery/node weakness/review facts; Report Workspace and other consumers remain legacy |

## 8. Task 3 Runtime Parity Boundary

The new `/overview/canonical` query is wired to the canonical projection and is consumed only by the homepage view model. The database is unavailable in the current environment (`DATABASE_URL` is unset), so live database parity is **RUNTIME DB PARITY BLOCKED**. Fixture parity covers mastery value preservation, Node/Point separation, windowed accuracy, insufficient-data semantics, action preservation, and evidence indexing.

## 9. Task 4 Consumer Migration Boundary

`ReportWorkspace` 的 Overview tab（`ReportSummaryPanel`）已接入 `CanonicalOverview`。总结卡片中的 Node mastery、Node/Point weakness、last7d progress、review status、evidence 与 action rationale 均优先读取 canonical projection；canonical 数据存在时不回退到 legacy `report.weakPoints` 或 `report.speedRisks`。旧的 Report tabs（mastery/history/actions/resources）保留各自既有契约，未被强行合并。

| Consumer | Result | Evidence |
|---|---|---|
| ReportWorkspace / Overview summary | EXPECTED_CHANGE | `StudentSections → TestSection → ReportWorkspace → ReportSummaryPanel` canonical prop path |
| ReportWorkspace / metrics + mastery | EXPECTED_CHANGE | `StudentProgressOverview` uses canonical last7d facts and Node rows when supplied |
| ReportSummaryPanel identity | MATCH | Node weaknesses use `knowledgeNodeId`; practice/speed weaknesses use `knowledgePointId` |
| ReportSummaryPanel progress/review | MATCH | `progress.last7d` carries current/baseline/sampleSize/status; review uses `pendingWrongQuestionCount` |
| ReportWorkspace mastery/history/actions/resources tabs | LEGACY_ONLY / INDEPENDENT | Existing panels remain unchanged by scope |
| Live DB parity | UNKNOWN | `DATABASE_URL` unavailable; fixture parity is available |

Remaining legacy or independent consumers are intentionally deferred: `/reports/overview`, `/dashboard/overview`, `WeaknessReportPanel`, assessment history panels, Knowledge Catalog, Review Center, and Teacher analytics. `StudentProgressOverview` is no longer remaining for the migrated Report Workspace metrics/mastery path; its trial/reminders/sprint sections remain independent resource contracts.

## 10. Phase 2 Baseline Closure

Phase 2 scope is closed at the canonical student Overview/Report boundary:

- Completed: `StudentHome`, `ReportSummaryPanel`, `StudentProgressOverview` (metrics/mastery), `TestSection → ReportWorkspace` canonical prop path.
- Remaining compatibility/independent paths: `/reports/overview`, `/dashboard/overview`, `StudyService.getOverviewReport()`, Report history/resources panels, Knowledge mastery, Review Center, and Teacher analytics.
- Environment blockers: Windows `child_process.spawn → EPERM` blocks Node test-runner fan-out and Vite/esbuild; `DATABASE_URL` unavailable blocks live DB parity.
- Pre-existing failures: `v3-section-wiring.test.js` and `student-action-navigation.test.js`; both reproduce outside the Phase 2 targeted suite and are not caused by the canonical Overview changes.

Baseline decision: **PHASE 2 BASELINE READY** (with runtime verification blockers recorded above).
