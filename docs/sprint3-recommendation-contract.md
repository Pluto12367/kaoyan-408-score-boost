# Sprint 3 — Recommendation Engine v1 契约（Contract Freeze）

> 状态：**已冻结**（Sprint 3.0，2026-08-30）
> 适用范围：`packages/shared/src/score-center/recommendation.ts`（Sprint 3.1 落地）及其全部消费方。
> 配套：`docs/v3-product-refactor-plan.md` §3.2、`docs/handoff/decisions.md`（Decision 1/5/6/7）、Sprint 3 Implementation Plan。
> 变更规则：本契约字段与语义为 v1 冻结项；**只允许向后兼容的增量**（新增可选字段/新增 reasonCode），任何破坏性变更必须升版 `recommendation_engine_v2` 并重审。

---

## 1. ID 规范（最高优先级约束）

- Engine 内部唯一 ID：**`knowledgeNodeId`**。
- **禁止 `knowledgePointId` 混入 Engine**：输入的 `evidence` / `prerequisiteMastery` / `nodeStates` 的键、输出的 `RecommendationItem` 的节点标识，全部为 `knowledgeNodeId`。
- `KnowledgePoint ↔ KnowledgeNode` 桥接（`KnowledgePointNodeMap`）**只允许发生在 Adapter 层**（Sprint 3.3 的 practice-set/review-resources adapter 内），Engine 感知不到 `knowledgePointId` 的存在。
- 已知例外说明：shared 展示层 `NodeMasteryPoint.knowledgePointId` 字段名是历史约定（承载的是 nodeId），Engine **不复用**该类型，避免语义混淆。

## 2. 确定性约束（验收 C3-48）

- 同一 `RecommendationInput` 必须产生逐字节相等的 `RecommendationResult`。
- Engine 内**禁止** `Date.now()` / `Math.random()` / 任何全局时钟与随机源；时间一律来自 `input.now`（ISO 字符串）。
- 排序必须带稳定 tie-breaker（score 相同按 `knowledgeNodeId` 字典序）。

## 3. 纯度约束（handoff Decision 1/6/7）

- 禁止数据库 / Prisma / repository / service / 文件 / 网络 / 环境变量访问。
- 禁止 UI 文案（title/description/reason 人类可读句式）与 nextAction 锚点——由 Adapter 层生成。
- 禁止写操作：Engine 不持久化任何内容；TASK_DRAFT 仅是数据，落库由 API 侧持久化函数完成。
- 输入缺失的退化行为：`evidence` 缺某节点 → 该节点以缺省 evidence 参与并附 `LOW_EVIDENCE` reasonCode；`nodeStates` 为空 → 返回空 `items`（不抛错）。

## 4. 输入契约：`RecommendationInput`

```ts
interface RecommendationInput {
  meta: {
    userId: string;
    now: string;            // ISO；唯一时钟来源（确定性）
    generatedAt: string;    // ISO；写入输出 generatedAt
  };
  student: {
    goal: {
      stage: string | null;
      targetScore: number | null;
      currentScore: number | null;
      remainingDays: number | null;
      dailyHours: number | null;
    };
    // 每个 knowledgeNodeId 一条，源自 UserKnowledgeMastery（SoT）
    nodeStates: NodeState[];
    // 到期复习摘要（源自 StudentStateSnapshot.reviewDue，展示与计数用）
    reviewSummary: { dueCount: number; overdueCount: number };
  };
  content: {
    // 每个 knowledgeNodeId 的真题证据（源自 KnowledgeFrequencySnapshot + KnowledgeNode）
    evidence: Record<string, ExamEvidence>;
    // 前置关系（KnowledgeRelation(type=PREREQUISITE)：nodeId → 前置 nodeId 列表）
    prerequisites: Record<string, string[]>;
    // 前置掌握度（KnowledgeRelation ∩ nodeStates）
    prerequisiteMastery: Record<string, number>;
  };
  config: {
    availableMinutes: 30 | 60 | 120 | 180;  // 当日学习预算（分钟）
    daysToExam: number;                     // ≥0；由 goal/now 推导亦可，显式传入
    maxItems?: number;                      // 默认 8（KNOWLEDGE 类上限）
  };
}

interface NodeState {
  knowledgeNodeId: string;
  mastery: number;            // 0..1（EWMA 水平值）
  accuracy: number;           // 0..1 全量正确率
  recentAccuracy: number;     // 0..1 短窗口正确率
  attempts: number;
  correctCount: number;
  wrongCount: number;
  retention: number | null;   // 0..1，null=从未复习
  stabilityDays: number | null;
  lastReviewedAt: string | null;
  pinned: boolean;
}
```

来源映射（Adapter 责任，Engine 不感知）：`nodeStates` ← `UserKnowledgeMastery`；`reviewSummary` ← `StudentStateSnapshot.reviewDue`；`evidence` ← `KnowledgeFrequencySnapshot`/`KnowledgeNode`；`prerequisiteMastery` ← `KnowledgeRelation` ∩ `nodeStates`。

## 5. 输出契约：`RecommendationResult`

```ts
interface RecommendationResult {
  userId: string;
  generatedAt: string;                 // = input.meta.generatedAt
  source: 'recommendation_engine_v1';  // 契约版本标记
  items: RecommendationItem[];         // 按 score 降序 + nodeId tie-break
}

type RecommendationItem =
  | {
      kind: 'KNOWLEDGE';
      knowledgeNodeId: string;
      score: number;                   // 0..100（cooldown 后）
      action: RecommendationAction;
      estimatedMinutes: number;
      reasonCodes: PriorityReasonCode[];
      facts: { mastery: number; attempts: number; wrongCount: number };
    }
  | {
      kind: 'REVIEW';
      knowledgeNodeId: string;
      score: number;
      reasonCodes: PriorityReasonCode[];  // 至少含 REVIEW_DUE
      facts: { stabilityDays: number | null; retention: number | null; nextReviewAt: string | null };
    }
  | {
      kind: 'QUESTION_SET';
      knowledgeNodeId: string;
      score: number;
      questionCount: number;           // 节点级建议题量（8/12/16/20 定额表）
      focus: '真题错题回炉训练' | '高频基础考点补强' | '薄弱专题突破';
      reasonCodes: PriorityReasonCode[];
    }
  | {
      kind: 'TASK_DRAFT';
      knowledgeNodeId: string;
      score: number;
      action: RecommendationAction;
      estimatedMinutes: number;
      scheduledDate: string;           // YYYY-MM-DD（= now 的日期键）
      reasonCodes: PriorityReasonCode[];
    };
```

不变式：
1. 同一 `knowledgeNodeId` 在 `items` 中至多出现一次（KNOWLEDGE/REVIEW 可与 QUESTION_SET 并存由 Engine 去重规则决定：QUESTION_SET 仅在对应 KNOWLEDGE item 存在时生成）。
2. `TASK_DRAFT` 集合总 `estimatedMinutes` ≤ `config.availableMinutes`。
3. `QUESTION_SET.focus` 三值冻结：冲刺 → 真题错题回炉训练（20 题）；全量正确率 <55% → 高频基础考点补强（16 题）；否则 → 薄弱专题突破（12 题）。
4. `items` 中 REVIEW 不与 KNOWLEDGE（同节点，action=REVIEW）重复：同节点同为复习意图时只保留 REVIEW。

## 6. `RecommendationAction`（冻结）

`'LEARN' | 'REVIEW' | 'PRACTICE' | 'WRONG_QUESTION' | 'MOCK'`

分类规则冻结（`classifyAction`，优先级从上到下）：

| 条件（按序） | action |
|---|---|
| recentWrongCount ≥ 2 | WRONG_QUESTION |
| forgetting ≥ 0.55 | REVIEW |
| mastery < 0.45 | LEARN |
| recentAccuracy < 0.7 | PRACTICE |
| daysToExam ≤ 45 且 mastery ≥ 0.75 | MOCK |
| 其余 | PRACTICE |

## 7. `PriorityReasonCode`（冻结清单，增量式扩展）

`HIGH_RECENT_FREQUENCY` · `LOW_MASTERY` · `LOW_ACCURACY` · `REPEATED_WRONG` · `REVIEW_DUE` · `RISING_TREND` · `EXAM_NEAR` · `LOW_EVIDENCE` · `PREREQUISITE_GAP`

扩展政策：新增 code 只允许**追加**到清单尾部并在本文档登记语义与触发条件；禁止删除/改名/复用既有 code 表达新含义。`PREREQUISITE_GAP` 由 `composeDailyPlan` 前置替换逻辑注入。

## 8. 组成引擎的既有构件（不重写）

- `calculatePriority`（`priority.ts`）— 评分与 reasonCodes 生成。
- `composeDailyPlan`（`plan.ts`）— 行动分类/冷却/预算/科目配额/前置替换/LEARN 上限。
- `updateStabilityAfterReview` / `estimateRetention`（`mastery.ts`）— REVIEW facts 语义参照。
- 阶段定额表（`learning.ts recommendPracticeSet`）— QUESTION_SET 题量与 focus 文案枚举（值迁移至 Engine，文案仍由 adapter 呈现）。

## 9. 消费方契约（Sprint 3.2-3.4 责任）

| 消费方 | 职责 | 禁止 |
|---|---|---|
| `StudentStateRecommendationService`（3.2） | 组装 `RecommendationInput`（快照+SoT+目录）；持久化 TASK_DRAFT | 修改引擎内部逻辑；引入 `knowledgePointId` |
| practice-set / review-resources adapter（3.3） | `RecommendationResult` → 旧 DTO（含文案） | 改 Engine 输出；绕过 adapter 直读引擎内部类型 |
| 闭环钩子（3.4） | 触发时机控制 + `plan.generated` 事件 | 在收据事务内同步调用引擎（仅事务后） |

## 10. 实施修订记录（v1 增量澄清，均为向后兼容）

| 日期 | 澄清 | 原因 |
|---|---|---|
| 2026-08-30 | `RecommendationExamEvidence = Omit<ExamEvidence,'knowledgePointId'> & { subject: string }` —— evidence 增加 `subject`（来自 KnowledgeNode） | 科目配额（applySubjectQuota）需要节点所属科目；subject 属内容侧事实 |
| 2026-08-30 | `content.prerequisites: Record<nodeId, string[]>` 成为必填输入 | `composeDailyPlan` 的前置替换需要关系列表，仅有掌握度映射不足 |
| 2026-08-30 | `RecommendationAction` 唯一定义上移至 `types.ts`（plan.ts 改为导入并保持再导出） | 消除 types↔plan 循环引用 |
| 2026-08-30 | `classifyAction` / `estimateMinutes` / `cooldownScore` 从 plan.ts 导出为 Engine 公共构件 | Engine 复用而非复制（契约 §8） |
| 2026-08-30 | `calculatePriority` 调用时以 `knowledgePointId: knowledgeNodeId` 填充形参（该字段不被算法消费） | 与 score-center 既有实践一致；ID 值空间纪律不受影响 |
| 2026-08-30 | 附件 `Review` 的 `nextReviewAt` 由 `lastReviewedAt + stabilityDays` 推导 | NodeState 不冗余存储 nextReviewAt |
| 2026-08-30 | `plan.ts composeDailyPlan` 新增可选 `now?: Date`（缺省 new Date() 保持旧行为） | 确定性注入（契约 §2） |

---

*冻结人：ZCode（Sprint 3.0）· 审定：项目所有者*
