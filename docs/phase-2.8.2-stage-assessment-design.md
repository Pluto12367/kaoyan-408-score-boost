# Phase 2.8.2-C StageAssessment 迁移设计

> 目标：迁移 `GET /assessments/stage` 从 `StudyService.getStageAssessment()` 到新的 read-model 分层。
>
> 本阶段只输出设计文档，不修改代码、不创建 service。

---

## 1. Legacy 分析

### 1.1 当前调用链

```text
GET /assessments/stage
  @Roles('student','teacher','admin')
  → StudyController.getStageAssessment(@CurrentUser(), @Query('userId') viewUserId?)
  → resolveUserId(user, viewUserId)
  → StudyService.getStageAssessment(resolvedUserId)
```

内部依赖链：

```text
StudyService.getStageAssessment(userId)
  → getOverviewReport(userId)            // weakPoints / speedRisks / accuracy
  → getStudent(userId)                   // student.stage
  → this.questions                       // 完整题目池
  → this.knowledgePoints                 // 完整知识点目录
  → this.systemConfig.recommendation.stageAssessmentQuestionLimit
  → toStudentQuestions(selectedQuestions)
```

### 1.2 DTO 完整结构

```typescript
{
  id: string,                    // `stage-${todayKey()}`
  title: string,                 // `${student.stage ?? '强化'}阶段测评`
  userId: string,
  description: string,           // 固定文案
  estimatedMinutes: number,      // Math.max(10, round(sum(expectedTimeSec)/60))
  focusKnowledgePoints: Array<{
    id, subject, chapter, title,
    importance, frequency, prerequisites
  }>,
  questions: Array<{
    id, stem, options, answer?, analysis?,
    difficulty, type, source, year,
    knowledgePointIds, expectedTimeSec
  }>,
}
```

### 1.3 字段来源 / 事实 vs 策略 / 能否进入 Snapshot

| DTO 字段 | Legacy 来源 | 事实(Fact) 还是 策略/文案 | 能否进入 Snapshot |
|---|---|---|---|
| `id` | `todayKey()` | 策略/DTO 生成值（基于当前时间） | 否（DTO 层生成） |
| `title` | `student.stage ?? '强化'` | 事实（student.stage）+ 拼接文案 | 部分：stage 是事实，title 文案在 Adapter |
| `userId` | 入参 | 事实 | 是 |
| `description` | 常量 | 文案 | 否（Adapter 生成） |
| `estimatedMinutes` | `round(totalExpectedTimeSec/60)` | 策略/计算值（基于题目 expectedTimeSec） | 否（Adapter 或 Query 计算） |
| `focusKnowledgePoints` | 选题去重后的知识点 | 事实（知识点目录），但**选题结果**是策略 | 知识点目录 facts 可进 Snapshot；选题序列不进 |
| `questions` | 选题结果 | 题目池 facts + **选题策略结果** | 题目池 facts 可进候选集；最终 selectedQuestions 是策略 |

### 1.4 哪些字段不能进入 Snapshot（summary）

- `id`：基于当前时间的 DTO 生成值，不是稳定事实。
- `description` / `title` 的拼接文案：UI 文案，不放 Snapshot。
- `estimatedMinutes`：策略计算值。
- **选题结果**（`focusKnowledgePoints`、`questions` 的具体内容）：这是从弱项 + 题目池做策略选择的结果，属于**决策产物**，不是事实。Snapshot 只保存"候选输入"，不保存"选中结果"。

### 1.5 结论

Legacy `getStageAssessment` 本质上是：

```text
读 facts（stage / weakPoints / 题目池 / 知识点目录）
  → 执行“选题策略”（weakPoints 优先 + 数量截断）
  → 生成 DTO（文案 + id + estimatedMinutes）
```

因此迁移时必须把 **策略/选题** 与 **facts** 分离：facts 进 Snapshot，选题策略保留在 Query/Adapter 层，DTO 文案只在 Adapter。

---

## 2. Facts 分层设计：`StageAssessmentSnapshot`

### 2.1 Snapshot 只保存事实

```typescript
export interface StageAssessmentSnapshot {
  source: 'stage_assessment_facts';
  userId: string;
  asOf: string;

  // 从 AssessmentProjectionService 或 assessment history facts
  assessmentFacts: {
    attemptCount: number;
    bestScore: number | null;
    latestScore: number | null;
    latestAccuracyRate: number | null;
    lastAssessmentAt: string | null;
    history: Array<{ id: string; score: number; submittedAt: string }>;
  };

  // 从 StudentStateProjectionService
  studentFacts: {
    stage: string | null;
    targetScore: number | null;
  };

  // 从 mastery/weak points projection
  weakPointFacts: Array<{
    knowledgeNodeId: string;
    subject: string;
    chapter: string;
    title: string;
    masteryRate: number;
    accuracyRate: number;
  }>;

  // 从 WrongQuestionProjectionService（可选：作为弱项/错题补充事实）
  wrongQuestionFacts: {
    total: number;
    unresolved: number;
    dueCount: number;
  };

  // 从 practice facts
  practiceFacts: {
    todayCount: number;
    accuracy: number;
  };

  // 题目池候选集（内容目录 facts，不含“选中哪些”）
  questionPool: Array<{
    id: string;
    stem: string;
    options?: unknown;
    difficulty: string;
    type: string;
    source: string | null;
    year: number | null;
    knowledgePointIds: string[];
    expectedTimeSec: number;
  }>;
  knowledgePoints: Array<{
    id: string;
    subject: string;
    chapter: string;
    title: string;
    importance: number;
  }>;
}
```

### 2.2 允许的事实来源

- assessment history facts
- mastery facts
- weak point facts
- practice facts
- question selection **候选** facts（question pool + knowledge points catalog）
- wrong-question summary facts（可选补充）

### 2.3 禁止进入 Snapshot

- `recommendation`
- `nextAction`
- `reason`
- UI 文案（`title`, `description`, `nextActions`）
- 排序策略（`focusKnowledgePoints`/`questions` 的**选中结果**）
- 汇总计算的 `estimatedMinutes`
- DTO 专属字段（`id`, `todayKey()`）

### 2.4 对现状的说明

当前 `AssessmentProjectionService` 只输出 `DashboardAssessmentFacts`。为满足 StageAssessmentSnapshot，需要：

- 要么直接复用其输出作为 `assessmentFacts`；
- 要么在 `StageAssessmentProjectionService` 内部组合。

不需要修改既有 Adapter / Dashboard 逻辑。

---

## 3. Projection 边界：`StageAssessmentProjectionService`

### 3.1 契约

```typescript
class StageAssessmentProjectionService {
  constructor(
    private readonly assessmentProjection: AssessmentProjectionService,
    private readonly studentStateProjection: StudentStateProjectionService,
    private readonly wrongQuestionProjection: WrongQuestionProjectionService,
    // QuestionCatalogQuery：未来新增的内容目录查询，或直接复用现有 catalog read
    private readonly questionCatalog?: QuestionCatalogQuery,
  ) {}

  async getSnapshot(userId: string, asOf: Date = new Date()): Promise<StageAssessmentSnapshot>
}
```

### 3.2 输入 / 输出

- **输入**：`userId`, `asOf`
- **输出**：`StageAssessmentSnapshot`（含题目池候选 + 弱项 facts + history 等）

### 3.3 可依赖

- `AssessmentProjectionService`
- `StudentStateProjectionService`
- `WrongQuestionProjectionService`
- `QuestionCatalogQuery`（新增，提供题目池 + 知识点目录 facts）

### 3.4 不能依赖

- `StudyService`
- `Controller`
- `Adapter`
- 任何写路径
- 任何推荐/选题策略

### 3.5 边界

- 只做 facts 组合；
- 不做选题；
- 不做 DTO；
- 不生成文案。

---

## 4. QueryService 设计：`StageAssessmentQueryService`

### 4.1 职责

```text
StageAssessmentQueryService
  ├─ 调用 StageAssessmentProjectionService.getSnapshot(userId, asOf)
  ├─ 执行“选题策略”（weakPoints 优先选题 + stageAssessmentQuestionLimit 截断）★
  └─ 调用 StageAssessmentAdapter.toLegacyStartStageAssessment(snapshot, selection, asOf)
      → Legacy 兼容 DTO
```

```typescript
class StageAssessmentQueryService {
  constructor(
    private readonly projection: StageAssessmentProjectionService,
    private readonly selection: StageAssessmentSelector, // 只做选题策略，不做数据查询
  ) {}

  async getStageAssessmentCompat(userId: string, asOf: Date = new Date()): Promise<LegacyStageAssessmentDto> {
    const snapshot = await this.projection.getSnapshot(userId, asOf);
    const selection = this.selection.select(snapshot); // 弱项优先 + limit 截断
    return toLegacyStageAssessment(snapshot, selection, asOf);
  }
}
```

### 4.2 关于“选题策略”的位置

- 选题策略不属于 facts，也不属于最终 DTO adapter 的文案生成。
- 建议放在一个独立的 `StageAssessmentSelector`（或 Query 内部辅助函数），**只接收 snapshot facts，不访问数据库**。
- 这样保持 CQRS read model 边界：QueryService 只编排 + 策略选择，不直接查库、不生成文案。

### 4.3 允许

- 编排 projection
- 编排 selector
- 编排 adapter
- 传递 `asOf`

### 4.4 禁止

- 查询数据库
- 生成文案
- 直接依赖 Adapter 去查询
- 写数据

---

## 5. Adapter 边界：`StageAssessmentAdapter`

### 5.1 职责

Adapter 只负责把 `StageAssessmentSnapshot + selection` 转成 Legacy DTO，**不执行数据查询或学习状态计算**。

```text
toLegacyStageAssessment(snapshot, selection, asOf)
  → {
      id: `stage-${dateKey(asOf)}`,
      title: `${snapshot.studentFacts.stage ?? '强化'}阶段测评`,
      userId: snapshot.userId,
      description: '根据当前薄弱点生成的小测……',
      estimatedMinutes: computeEstimatedMinutes(selection.questions),
      focusKnowledgePoints: selection.focusKnowledgePoints,
      questions: selection.questions,
    }
```

### 5.2 Adapter 负责

- DTO 字段转换（snapshot + selection → DTO shape）
- 文案兼容（title / description / id / estimatedMinutes 的计算）
- fallback（例如 stage 为空 → `强化`；selection 为空 → 按默认候选截图）

### 5.3 Adapter 禁止

- 查询数据库
- 计算学习状态（不做 mastery / weakPoints / accuracy 计算）
- 生成选题策略（不决定选哪些题——只使用传入的 selection）

---

## 6. Migration 顺序

按既有 CQRS/read-model 规范执行：

### C. Snapshot Contract

```text
C1. 新增 StageAssessmentSnapshot 接口 + buildStageAssessmentSnapshot()（空 snapshot 安全）
C2. 明确允许/禁止字段（见 §2）
C3. 测试：contract 边界检查（不含文案/策略字段）
```

### D. Projection

```text
D1. 新增 StageAssessmentProjectionService
D2. 依赖 AssessmentProjectionService / StudentStateProjectionService / WrongQuestionProjectionService / QuestionCatalogQuery
D3. 测试：facts 正确映射、空数据安全、固定 asOf 透传
```

### E. Adapter

```text
E1. 新增 StageAssessmentAdapter (toLegacyStageAssessment)
E2. 负责 DTO 字段转换 + 文案 + fallback
E3. 测试：空 snapshot、完整 selection、不修改 snapshot、无数据依赖
```

### F. Parity Test

```text
F1. 用同一组 facts，对比 Legacy getStageAssessment 与 新 query 输出
F2. 覆盖：空数据、完整学习状态、有弱项、有题目池、固定 asOf
F3. 记录差异原因（如 estimatedMinutes、id 生成方式、选题差异），不直接修改生产逻辑
```

### G. QueryService

```text
G1. 新增 StageAssessmentQueryService
G2. 组装 projection → selector → adapter
G3. 测试：调用 projection、调用 adapter、固定 asOf、返回 DTO、不依赖 StudyService
```

### H. Controller Wiring

```text
H1. study.controller.ts 将 GET /assessments/stage 改为 this.stageAssessmentQuery.getStageAssessmentCompat(resolvedUserId)
H2. study.module.ts 注册 StageAssessmentProjectionService / StageAssessmentQueryService（与 selector、catalog 依赖对齐，去重注册）
H3. 保持 HTTP path / 参数 / DTO 不变
H4. 新增 controller wiring 测试
H5. 跑全部 regression + npm run build:api
```

---

## 7. 风险与备注

| 风险 | 说明 | 缓解 |
|---|---|---|
| 选题策略与 legacy 不一致 | 新旧 `focusKnowledgePoints/questions` 可能不同 | F parity 阶段逐字段对比；若不要求字节级一致，记录可接受差异 |
| 题目池/知识点目录 read path 缺失 | `QuestionCatalogQuery` 尚不存在 | 先复用现有 questions/knowledgePoints repo 作为 supplemental read，独立在 projection 外 |
| `estimatedMinutes` 数值敏感 | 依赖 expectedTimeSec 总和 | 在 Adapter 内原样保留 legacy 算法 `Math.max(10, round(sum/60))` |
| `id` 基于当前时间 | 影响幂等/缓存 | 由 Adapter 用 `asOf` 生成，固定测试时间；如契约不要求稳定 id，可保留 |
| 现有 AssessmentProjectionService 输出为 Dashboard shape | 需复用 | projection 内直接映射字段，不改 Dashboard |

本设计仅输出文档，等待评审后再按 C→D→E→F→G→H 依次实施。