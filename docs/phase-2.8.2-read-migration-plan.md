# Phase 2.8.2-B 只读审计：优先迁移候选 read path

> 审计性质：只读审计。
>
> 目标：从剩余 legacy read path 中选出优先级最高的下一个 endpoint，并完成迁移前分析。
>
> 本阶段不修改代码、不创建 service，等待评审后再实施。

## 1. 选择结果

从 Phase 2.8.2-A 审计的候选清单中，**优先级最高、迁移风险最低、facts 边界最清晰**的 endpoint 是：

```text
GET /assessments/stage
  → StudyController.getStageAssessment()
  → StudyService.getStageAssessment(userId)
```

选择理由：

1. **纯 read path**：不产生写操作、不修改状态、不依赖复杂推荐引擎；
2. **facts 边界相对清晰**：由 `getOverviewReport`（weakPoints/speedRisks）驱动选题，从题目池选择，再生成 stage assessment DTO；
3. **已有可复用 facts**：`AssessmentProjectionService`、`DashboardProjectionService`、`StudentStateProjectionService`、`WrongQuestionQueryService` 已经可以提供大部分输入 facts；
4. **迁移收益高**：这个接口同时被 dashboard 的 `stageAssessment` 字段和 `/reports/overview` 依赖，收敛后可以简化 dashboard adapter 和后续 report 迁移。

---

## 2. 当前 Controller 调用链

```text
GET /assessments/stage
  @Roles('student','teacher','admin')
  → StudyController.getStageAssessment(@CurrentUser() user, @Query('userId') viewUserId?)
  → this.resolveUserId(user, viewUserId)
  → StudyService.getStageAssessment(resolvedUserId)
```

依赖链：

```text
StudyService.getStageAssessment(userId)
  → getOverviewReport(userId)
      → this.getStudent(userId)
      → this.records / this.nodeMasteryByUser / mastery projection
      → weakPoints / speedRisks / accuracyRate / summary
  → this.questions  (完整题目池)
  → this.knowledgePoints  (完整知识点目录)
  → this.systemConfig.recommendation.stageAssessmentQuestionLimit
  → toStudentQuestions(selectedQuestions)
```

## 3. DTO 结构

`getStageAssessment(userId)` 当前返回：

```typescript
{
  id: string;                    // `stage-${todayKey()}`
  title: string;                 // `${student.stage ?? '强化'}阶段测评`
  userId: string;
  description: string;           // 固定文案
  estimatedMinutes: number;      // Math.max(10, round(totalExpectedTimeSec / 60))
  focusKnowledgePoints: Array<{  // 从选题知识点去重
    id, subject, chapter, title, importance, frequency, prerequisites
  }>;
  questions: Array<{             // toStudentQuestions(selectedQuestions)
    id, stem, options, answer?, analysis?, difficulty, type,
    source, year, knowledgePointIds, expectedTimeSec
  }>;
}
```

字段性质：

- `id / title / userId / description / estimatedMinutes / focusKnowledgePoints / questions`
- 其中 `title`、`description` 属于**展示文案**，`id` 使用 `todayKey()` 属于**当前时间相关生成值**

## 4. Facts 来源

| DTO 字段 | Facts 来源 | 是否已有 projection 可复用 |
|---|---|---|
| `id` | 当前时间 `todayKey()` | 否（adapter/query 生成即可，属于 DTO 层文案） |
| `title` | `student.stage` | `StudentStateProjectionService.goal` |
| `description` | 固定文案 | adapter 层文案 |
| `estimatedMinutes` | `questions[].expectedTimeSec` | `questions` 题目池（内容目录 facts） |
| `focusKnowledgePoints` | 选题的知识点 | `KnowledgePoint` 内容目录 facts |
| `questions` | 选题 | 题目池 facts（`Question` 目录） |

## 5. 是否已有 Projection 可复用

### 可直接复用

- `AssessmentProjectionService`
  - `attemptCount`
  - `bestScore`
  - `latestScore`
  - `latestAccuracyRate`
  - `history`
  - 这些 facts 可用于 stage assessment 的“历史概览”，但当前 DTO 并不直接消费它们

- `StudentStateProjectionService`
  - `goal.stage` → title 的 `student.stage`
  - `weakPoints` → 选题的 focus knowledge points 候选

- `WrongQuestionQueryService`
  - `getWrongQuestionSummaryCompat` → 错题统计 / weak points 参考

- `DashboardProjectionService`
  - `assessmentFacts` / `todayPlanFacts` / `wrongQuestionFacts`
  - 可作为后续 report / profile 迁移的输入

### 当前不能直接替代的部分

- **选题逻辑**：`getStageAssessment` 当前用 `report.weakPoints`（或 `speedRisks`）筛选题目，再从完整题目池取题，按 `stageAssessmentQuestionLimit` 截断。这是**领域策略**，不属于纯 facts，需要保留在 read model 的 query/adapter 层（或独立 selection service），不能由 snapshot 直接生成。

- **题目池**：`this.questions` + `this.knowledgePoints` 是完整题库，不属于 StudentState facts。需要由内容目录 read path（`Question` / `KnowledgePoint` repository 或未来的 catalog query）提供。

- **systemConfig 的 `stageAssessmentQuestionLimit`**：需要配置 facts 来源。

- **`id` 与 `title` 文案**：属于 DTO 层，由 adapter 生成。

## 6. Migration 方案（待评审）

### 6.1 推荐方案：`StageAssessmentQueryService`

```text
GET /assessments/stage
  → StageAssessmentQueryService.getStageAssessmentCompat(userId, asOf?)
  → AssessmentProjectionService.getFacts(userId, asOf)     // assessment 历史 facts
  → StudentStateProjectionService.getSnapshot(userId, asOf) // goal/weakPoints
  → WrongQuestionQueryService.getWrongQuestionSummaryCompat() // weakPoints 参考
  → QuestionCatalogQueryService (新)                         // 题目池
  → StageAssessmentAdapter.toLegacyStageAssessmentDto(snapshot)
```

### 6.2 需要新增的组成部分

| 组件 | 类型 | 职责 |
|---|---|---|
| `StageAssessmentQueryService` | QueryService | orchestration：组合 facts，固定 `asOf`，返回 DTO |
| `StageAssessmentSnapshot` (可选) | Snapshot | 保存选题所需 facts（不含策略结果） |
| `StageAssessmentAdapter` (可选) | Adapter | 生成 `id/title/description/estimatedMinutes` 等 DTO 层文案 |
| `QuestionCatalogQueryService` | QueryService | 提供题目池 facts（若当前无内容目录 read path） |

### 6.3 边界

- **禁止**：
  - 在 QueryService 内做推荐/选题策略
  - 在 Adapter 内做数据查询
  - 直接依赖 `StudyService`
  - 写数据库
- **允许**：
  - 在 Adapter 内生成 `id/title/description`
  - 在 QueryService 内协调多个 projection/query
  - 保留现有 `getStageAssessment` 作为兼容入口（不删除）

### 6.4 风险与对策

| 风险 | 对策 |
|---|---|
| `questions` 全量返回，DTO 大 | 先确认前端是否真的需要全部题目字段；若只需 id/stem/options，可精简 |
| 选题策略与 legacy 不一致 | 先建立 parity 测试，对比新旧选择结果 |
| `systemConfig` 读取位置 | 需要确认配置来源；可在 StageAssessmentQueryService 内读取配置 facts（只读） |
| `todayKey()` 当前时间相关 | DTO 的 `id` 由 adapter 用 `asOf` 生成，固定测试时间 |
| 历史测评 `attemptCount` 等未进入当前 DTO | 若 DTO 契约不含这些字段，则无需在本次迁移中加入 |

## 7. 下一步建议

1. 评审本方案；
2. 若通过，进入 Phase 2.8.2-C：
   - 定义 `StageAssessmentSnapshot`（可选）
   - 创建 `StageAssessmentQueryService`
   - 创建 `StageAssessmentAdapter`
   - 接入 Controller
   - 建立 parity 测试
   - 运行回归测试与 `npm run build:api`

本阶段仅完成只读审计，等待评审后再实施。
