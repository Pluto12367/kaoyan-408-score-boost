# 07 V3 Sprint 2 - Student State 学习与架构分析

> 本文档是「项目学习系列」的第 7 篇，主题是 V3 重构 Sprint 2：**StudentState 统一**。
> 前置阅读：`01-项目整体架构.md`（全局认知）、`02-业务流程.md`（业务链路）、`03-数据库设计.md`（表结构）。
> 相关文档：`docs/v3-product-refactor-plan.md`（Sprint 计划）、`docs/v3-acceptance.md`（验收标准）、`docs/v3-migration-map.md`（迁移映射）。
> 本文基于对仓库实际代码的逐段核对写成，所有函数、端点、公式均可在代码中找到出处。

---

## 1. 一句话定位

Sprint 2 的目标不是新增功能，而是把「学生状态（Student State）」从三处分散的地方收敛成一套：

1. **后端双轨计算**：`study.service.ts` 的 legacy 掌握度聚合 vs `score-center/service.ts` 的节点级原子掌握度，两者并存。
2. **前端本地真相**：`mockData.ts` + `api/mocks/dashboard.ts` 在没有后端时充当第二套"事实"。
3. **冗余聚合接口**：`/trial-progress`、`/study-reminders`、`/sprint-plan` 三个聚合端点与统一数据源重复。

Sprint 2 的验收底线（摘自 `docs/v3-acceptance.md`）：

```text
B2-36  前端无内存态 mock 数据：mockData.ts、api/mocks/dashboard.ts 已删除
B3-37  唯一掌握度来源：所有页面展示的 mastery 值来自 UserKnowledgeMastery
B3-38  API 返回最小数据：首页 API 只返回首页所需字段
B3-39  写操作用事务保证：applyAttempts / applyReview 使用 Prisma 事务
B3-40  幂等提交：重复提交同一 PracticeRecord 不会导致掌握度重复计算
```

---

## 2. Student State 的定义（V3 架构原则 9）

V3 计划中明确写道：**所有模块共享统一 Student State**。它不是一个新的 ORM 模型，而是一组「唯一事实源」的组合：

| 事实源 | Prisma 模型 | 角色 | 写入方（现状） |
|---|---|---|---|
| 掌握度状态 | `UserKnowledgeMastery` | 节点级 mastery/accuracy/retention | `score-center/service.ts` `applyAttempts` / `applyReview` |
| 行为事实 | `PracticeRecord` | 每次作答的结果与错因 | `study.service.ts` `createPracticeRecord` |
| 任务事实 | `StudyTask`（含 `StudyTaskCompletion`） | 任务与进度 | `study.service.ts` `completeStudyTask` |
| 行为事件流 | `UserEvent` | 闭环观测（attempt/review/task_complete/assessment） | `study.service.ts` `trackUserEvent` |
| 趋势快照 | `UserMasterySnapshot` | 每日掌握度快照（画趋势线） | `score-center/service.ts` `saveMasterySnapshot` |
| 错误恢复 | `ReviewSchedule` + `WrongQuestionReview` | 间隔复习排期与复盘状态 | `study.service.ts` + `repository.ts` `touchWrongQuestion` |

**关键认知**：V3 不是新增一张 `StudentState` 表，而是**规定谁是事实源、谁有权写、谁负责读**。前端删掉 mock、后端删掉重复计算，本质都是为了让"读"只能走到这些模型上。

---

## 3. 数据模型拆解（Sprint 2 的状态层）

### 3.1 UserKnowledgeMastery（掌握度唯一事实）

`prisma/schema.prisma` L902 起：

| 字段 | 含义 | 默认值 |
|---|---|---|
| `mastery` | EWMA 平滑后的掌握度（0~1） | 0.5 |
| `accuracy` | 累计正确率（attempts 口径） | 0.55 |
| `recentAccuracy` | 近期正确率（EWMA，反映最近表现） | 0.55 |
| `attempts` / `correctCount` / `wrongCount` | 行为计数 | 0 |
| `retention` | 记忆保留率（复习后排期推算） | null |
| `stabilityDays` | 复习稳定性（间隔天数） | null |
| `lastLearnedAt` / `lastReviewedAt` / `nextReviewAt` | 时间线 | null |
| `confidence` | 置信度（随 attempts 增长） | 0 |
| `pinned` | 是否被学生手动置顶 | false |

约束要点：

- `@@unique([userId, knowledgeNodeId])`：一个学生一个节点一行，天然幂等 upsert 键。
- `@@index([userId, nextReviewAt])`：支撑"到期复习"查询。

### 3.2 UserMasterySnapshot（趋势唯一来源）

`@@unique([userId, knowledgeNodeId, snapshotDate])`：**每天每个节点最多一条快照**，`saveMasterySnapshot` 用 upsert 保证。这是"趋势一致"的兜底——重复提交同一天不会产生重复快照。

### 3.3 UserNodeQuest（节点闯关）

`attempts` / `bestAccuracy` / `passed` / `passedAt`。通关条件在 shared 常量：`QUEST_PASS_THRESHOLD = 60`（正确率 ≥ 60%）。`completeNodeQuest` 每次尝试都会更新 `bestAccuracy`，达标后写 `passedAt`（一次通关，不再回退）。

### 3.4 UserEvent（闭环观测）

`type`（字符串）+ `payload`（Json）。V3 目标扩展为 `attempt / review / task_complete / assessment` 四类。现状 `trackUserEvent` 已写 `practice.submit`、`task.complete` 等事件。

---

## 4. Mastery Engine：掌握度到底怎么算

唯一实现：`packages/shared/src/score-center/mastery.ts`。这是 Sprint 2 必须讲清楚的核心。

### 4.1 一次作答的 EWMA 更新

```24:46:packages/shared/src/score-center/mastery.ts
export function updateMasteryAfterAttempt(
  state: MasteryState,
  signal: AttemptSignal,
): MasteryState {
  const attempts = state.attempts + 1;
  const correctCount = state.correctCount + (signal.isCorrect ? 1 : 0);
  const wrongCount = state.wrongCount + (signal.isCorrect ? 0 : 1);
  const accuracy = attempts > 0 ? correctCount / attempts : 0;
  const alpha = signal.role === 'PRIMARY' ? PRIMARY_ALPHA : SECONDARY_ALPHA;
  const target = targetForAttempt(signal.isCorrect, signal.difficulty);

  return {
    mastery: clamp01(state.mastery + alpha * (target - state.mastery)),
    accuracy,
    recentAccuracy: clamp01(
      state.recentAccuracy + RECENT_ACCURACY_ALPHA * ((signal.isCorrect ? 1 : 0) - state.recentAccuracy),
    ),
    attempts,
    correctCount,
    wrongCount,
    confidence: Math.min(1, 1 - Math.exp(-(attempts + 1) / 12)),
  };
}
```

逐项解释（面试可直接复述）：

1. **mastery 用 EWMA**：`新值 = 旧值 + α × (目标值 - 旧值)`。α 越大反应越快。α 由题目角色决定：
   - 主考点 `PRIMARY`：α = 0.18
   - 次考点 `SECONDARY`：α = 0.07（一道综合题命中多个节点时，主节点吃更多权重）
2. **目标值按难度锚定**（`targetForAttempt`）：
   - 答对：`min(1, 0.72 + difficulty × 0.055)`，难度 5 的题答对目标约 0.995，难度 1 约 0.775——做难题答对涨得更多。
   - 答错：`max(0, 0.38 - (difficulty-1) × 0.045)`，难度越高答错扣得越多。
3. **recentAccuracy 也用 EWMA**（α=0.2），它比累计 accuracy 更能反映"最近表现"，是推荐引擎的重要输入。
4. **confidence 与尝试次数挂钩**：`1 - e^(-(attempts+1)/12)`，约 12 次尝试后接近 0.65，次数越多越"确信"这个 mastery 值。

### 4.2 复习对掌握度的影响（Sprint 2 验收 B 项关键）

```148:172:apps/api/src/score-center/service.ts
  async applyReview(
    userId: string,
    questionId: string,
    input: { reviewedAt: Date; redoCorrect: boolean },
  ) {
    if (!this.enabled) return;
    await this.prisma.$transaction(async (tx) => {
      const tags = await resolveKnowledgeNodesForQuestion(tx, questionId);
      const nodes = await loadActiveKnowledgeNodes(
        tx,
        tags.map((tag) => tag.knowledgeNodeId),
      );
      const nodeById = new Map(nodes.map((node) => [node.id, node]));
      for (const tag of tags) {
        const node = nodeById.get(tag.knowledgeNodeId);
        if (!node) continue;
        const row = await loadMasteryRow(tx, userId, node.id);
        const current = row ? toMasteryState(row) : neutralMastery();
        const stabilityDays = updateStabilityAfterReview(
          row?.stabilityDays ?? null,
          input.redoCorrect ? 4 : 2,
        );
```

重点：`applyReview` **不会修改 mastery 数值**，只更新 `retention` / `stabilityDays` / `lastReviewedAt` / `nextReviewAt`。这正好满足验收 C2-45「复习操作只更新 lastReviewedAt / stabilityDays，不降低 mastery」。

复习排期公式（shared）：

```58:64:packages/shared/src/score-center/mastery.ts
export function updateStabilityAfterReview(
  previousStabilityDays: number | null,
  quality: ReviewQuality,
): number {
  const base = previousStabilityDays ?? 1;
  return Math.max(0.5, base * STABILITY_MULTIPLIERS[quality]);
}
```

`quality` 为 0~5，乘数 `0.6 / 0.8 / 1.0 / 1.35 / 1.7 / 2.1`。当前调用 `redoCorrect ? 4 : 2`，即**重做正确间隔 ×1.7，重做错误 ×1.0（不增长）**。`nextReviewAt = reviewedAt + stabilityDays 天`。

### 4.3 retention（记忆保留率）

```48:56:packages/shared/src/score-center/mastery.ts
export function estimateRetention(
  lastReviewedAt: Date | null,
  stabilityDays: number | null,
  now: Date,
): number {
  if (!lastReviewedAt || stabilityDays == null) return 0.5;
  const elapsedDays = Math.max(0, (now.getTime() - lastReviewedAt.getTime()) / 86_400_000);
  return clamp01(Math.exp(-elapsedDays / Math.max(1, stabilityDays)));
}
```

指数遗忘曲线：`retention = e^(-已过天数 / 稳定性天数)`。`applyReview` 路径直接把 retention 置 1（刚复习完假设 100% 保留），`estimateRetention` 用于推荐时的"遗忘度"估算（`forgetting = 1 - retention`）。

### 4.4 状态推导（展示层）

```66:73:packages/shared/src/score-center/mastery.ts
export type NodeMasteryStatus = 'untouched' | 'weak' | 'review' | 'mastered';

export function deriveNodeMasteryStatus(input: { mastery: number; attempts: number }): NodeMasteryStatus {
  if (input.attempts <= 0) return 'untouched';
  if (input.mastery >= 0.7) return 'mastered';
  if (input.mastery >= 0.45) return 'review';
  return 'weak';
}
```

- `untouched`：没做过
- `mastered`：mastery ≥ 0.7
- `review`：0.45 ~ 0.7
- `weak`：< 0.45

闯关状态 `deriveNodeQuestStatus`：已通关 → `passed`；有尝试 → `in_progress`；否则 `not_started`。

### 4.5 新旧口径对比（Sprint 2 要消灭的双轨）

| 维度 | legacy（`learning.ts computeMasteryReport`） | V3（`score-center/mastery.ts` + `nodeMastery.ts`） |
|---|---|---|
| 粒度 | `KnowledgePoint` 粗粒度知识点 | `KnowledgeNode` 原子节点 |
| mastery 公式 | `accuracy × 0.7 + 练习覆盖度 × 0.3` | EWMA 平滑 + 难度锚定目标值 |
| 状态阈值 | <60 weak，<80 review，否则 mastered（0~100 分制） | <0.45 weak，<0.7 review，≥0.7 mastered（0~1） |
| 复习影响 | 无（只统计次数） | 更新 stabilityDays / retention，不降 mastery |
| 写入位置 | 无持久化，实时从 records 聚合 | `UserKnowledgeMastery` upsert + 每日快照 |
| 前端读取 | `GET /mastery-map`（`useStudentProgressData`） | `GET /knowledge/mastery`（`fetchMyMastery`） |

**这就是双轨的实质**：同一页面在两个开关（`USE_KNODE_MASTERY`）下会显示不同数值。Sprint 2 的目标是让"读"只走 V3 这一列。

---

## 5. Recommendation Engine：从状态到下一步行动

Sprint 2 之后，首页"下一步做什么"应由 `packages/shared/src/score-center/` 的 `priority.ts` + `plan.ts` 唯一决定。

### 5.1 calculatePriority（为什么这个节点优先）

```11:18:packages/shared/src/score-center/priority.ts
const COMPONENT_WEIGHTS = {
  examValue: 0.37,
  weakness: 0.32,
  forgetting: 0.16,
  difficulty: 0.07,
  trend: 0.05,
  pinned: 0.03,
} as const;
```

输入三件套：

1. **考频证据** `ExamEvidence`：近 3 年频率 / 近 5 年频率 / 全量证据 / 重要性 / 趋势方向（RISING/STABLE/FALLING/COLD）
2. **用户状态** `UserKnowledgeState`：mastery / recentAccuracy / wrongCount / retention / pinned
3. **上下文** `PriorityContext`：距考试天数（决定阶段乘数——≤45 天冲刺期放大考频与薄弱度权重）

输出 `score`（0~100）+ `reasonCodes` + 六维 `breakdown`。可解释性由 reasonCodes 保证（验收 C3-47）：

```text
HIGH_RECENT_FREQUENCY  近3年高频
LOW_MASTERY            mastery < 0.55
LOW_ACCURACY           recentAccuracy < 0.65
REPEATED_WRONG         错题数 ≥ 3
REVIEW_DUE             遗忘度 ≥ 0.55
RISING_TREND           趋势上升
EXAM_NEAR              距考试 ≤ 45 天
LOW_EVIDENCE           证据置信度低
PREREQUISITE_GAP       前置节点未达标（composeDailyPlan 注入）
```

### 5.2 composeDailyPlan（选哪些节点、每节点做什么）

动作分类 `classifyAction`（`plan.ts`）：

```text
recentWrongCount ≥ 2        → WRONG_QUESTION（错题重做）
forgetting ≥ 0.55           → REVIEW（复习）
mastery < 0.45              → LEARN（新学）
recentAccuracy < 0.7        → PRACTICE（练习）
距考试 ≤45 天且 mastery ≥0.75 → MOCK（模拟测试）
其余                         → PRACTICE
```

编排约束（`plan.ts`，Sprint 2 后首页数据源）：

1. **预算约束**：总分钟数 ≤ `availableMinutes`（30/60/120/180），按 score 降序贪心选择。
2. **冷却机制** `cooldownScore`：刚复习完（retention ≥ 0.85 且 36 小时内）的节点 score × 0.55，避免反复推荐同一个刚练过的节点。
3. **前置缺口**：某节点前置节点 mastery < 0.45 时，用前置节点替换推荐，并打 `PREREQUISITE_GAP` 标记。
4. **科目配额**：60 分钟以上时至少覆盖 2 个科目（`applySubjectQuota`）。
5. **新学上限**：距考试 > 150 天时，LEARN 任务不超过总数的 40%（`applyFoundationLearnCap`）。

`generateDailyPlan`（后端）把上述 draft 落成 `StudyPlan(source='score-center')` + `StudyTask`，一个事务内先 `archiveScoreCenterPlans` 归档旧计划再创建新计划。任务动作映射为中文标签：

```text
LEARN→新学  REVIEW→复习  PRACTICE→练习  WRONG_QUESTION→错题重做  MOCK→模拟测试
```

题数：MOCK 30 题，其余动作 8 题。

---

## 6. 写入路径：谁有权改 Student State

### 6.1 答题提交（闭环输入）

`study.service.ts createPracticeRecord`（L2616）当前链路：

```text
buildPracticeRecord（判题 + classifyMistake 错因分类）
  → 事务内：PracticeRecordRepository.save(record)
           + scoreCenterService.applyAttempts(userId, [saved])
  → 刷新 nodeMastery 读缓存
  → 答错 → ensureReviewSchedule（1/3/7/14 天复习排期）
  → applyPracticeProgressToTasks（任务进度累计）
  → trackUserEvent('practice.submit')
```

`applySingleAttempt`（`score-center/service.ts` L116）是 V3 的原子更新：

```text
resolveKnowledgeNodesForQuestion（直连 QuestionKnowledgeNodeTag；
  无直连则回退 Question→KnowledgePoint→KnowledgePointNodeMap）
  → 逐节点 loadMasteryRow（无则 neutralMastery()）
  → updateMasteryAfterAttempt（shared 纯函数）
  → saveMastery（upsert）
  → saveMasterySnapshot（按 UTC 日 upsert）
  → 答错 → touchWrongQuestion（WrongQuestionReview 置未解决）
```

注意：`applyAttempts` 接受 `tx?: Prisma.TransactionClient`，在 `createPracticeRecord` 里已包进同一事务，满足验收 B3-39。

### 6.2 错题复盘（错误恢复输入）

`applyReview` 已在上文分析：事务内逐节点更新 stability/retention/nextReviewAt，`redoCorrect` 时 `resolveWrongQuestion` 把 `WrongQuestionReview.resolved=true`。错误恢复链路 `study.service.ts` 还有 legacy 的 `reviewSchedule` 同步路径（`applyVariantRetest` 等），Sprint 2 需要确认两者不复写矛盾。

### 6.3 任务完成（闭环控制器目标态）

`completeStudyTask`（L2807）目前把"score-center 计划任务"和"七天内嵌任务"分开处理：

- 命中 `StudyPlan(source='score-center')` 的任务 → 交给 `scoreCenterService.completeTask`
- 命中七天计划任务 → 走 `completeStudyTaskUnlocked`（写完成记录 + 次日任务量调整 `createTaskCompletionAdjustment`）

V3 Sprint 3 会把这里升级为"统一完成入口"（活动完成 → 更新状态 → 生成下一任务）。Sprint 2 的职责是保证**完成状态的写入不会和掌握度写入冲突**（即任务完成只影响任务进度，掌握度只由作答/复盘驱动）。

---

## 7. 读取路径：页面该从哪里读

### 7.1 统一读取口

| 读取需求 | 现端点 | 归属 Sprint 2 动作 |
|---|---|---|
| 节点掌握度 + 闯关状态 | `GET /knowledge/mastery`（`getMyMastery`） | ✅ 保留为唯一来源 |
| 掌握度趋势 | `GET /mastery-trend`（`getMasteryTrend`） | ✅ 保留 |
| 节点详情（含真题证据） | `GET /knowledge/:id`（`getKnowledgeDetail`） | ✅ 保留 |
| 错题真题链接 | `GET /wrong-questions/:questionId/exam-links` | ✅ 保留 |
| 今日任务 + scoreCenter 计划 | `GET /today/plan`（已内嵌 `scoreCenter` 字段） | ✅ 保留，作为首页数据源 |
| 旧掌握度地图 | `GET /mastery-map` | ⚠️ 迁移到 `getMyMastery`，legacy 分支废弃 |
| 试用进度 / 学习提醒 / 冲刺计划 | `GET /trial-progress` `/study-reminders` `/sprint-plan` | ❌ 冗余聚合，降级或删除 |

### 7.2 getMyMastery 的组装

```348:361:apps/api/src/score-center/service.ts
  async getMyMastery(userId: string) {
    const rows = await loadMasteries(this.prisma, userId);
    const quests = await loadNodeQuests(
      this.prisma,
      userId,
      rows.map((row) => row.knowledgeNodeId),
    );
    const questByNode = new Map(quests.map((quest) => [quest.knowledgeNodeId, quest]));
```

一次拉取 `UserKnowledgeMastery` + `UserNodeQuest`，逐行用 shared 的 `deriveNodeMasteryStatus` / `deriveNodeQuestStatus` 推导展示状态。这是"一行 SQL + 纯函数推导"的最小读取模式，页面侧 `fetchMyMastery()` 直接消费，不再自行聚合。

### 7.3 前端现状与迁移点

`useStudentProgressData.ts` 当前并行加载 5 个资源（trialProgress / studyReminders / sprintPlan / masteryMap / learningProfile），每个都带 `isStaticDemoMode` / `isMockAllowed` 的 mock 回退。Sprint 2 的迁移点：

1. `masteryMap`（`GET /mastery-map`）→ `fetchMyMastery()`（`GET /knowledge/mastery`），知识页/首页统一消费。
2. `trialProgress` / `studyReminders` / `sprintPlan` 三个 mock 工厂删除，页面改从 `GET /today/plan`（含 scoreCenter 字段）取今日任务。
3. `mockData.ts`、`api/mocks/dashboard.ts` 只保留静态演示模式入口（`isStaticDemoMode()`），或整体移除后由 `api/env.ts` 的静态工厂接管。

---

## 8. 事务与幂等（验收 B3-39 / B3-40 的代码依据）

| 场景 | 幂等依据 |
|---|---|
| 掌握度写入 | `UserKnowledgeMastery` 的 `@@unique([userId, knowledgeNodeId])` + `upsert`，同一节点重复写入只更新不插行 |
| 每日快照 | `UserMasterySnapshot` 的 `@@unique([userId, knowledgeNodeId, snapshotDate])` + `upsert`，同一天重复提交不产生重复快照 |
| 错题状态 | `WrongQuestionReview` 的 `userId_questionId` 复合唯一 + upsert |
| 任务完成 | `completeStudyTaskUnlocked` 对已完成任务抛 `BadRequestException('Study task ... has already been completed')` |
| 计划生成 | `generateDailyPlan` 事务内先 `archiveScoreCenterPlans` 归档再创建 |

写放大的防护：`createPracticeRecord` 把 `save` + `applyAttempts` 放进同一个 `$transaction`，避免"记录写了但掌握度没更新"的中间态。

---

## 9. Sprint 2 工作清单（文件级）

| 文件 | 动作 | 风险 |
|---|---|---|
| `apps/web/src/mockData.ts` | 删除（或仅保留静态演示种子） | 低：无后端演示需要保留入口 |
| `apps/web/src/api/mocks/dashboard.ts` | 删除 `createMockMasteryMap` / `createMockTrialProgress` / `createMockStudyReminders` / `createMockSprintPlan` | 中：`App.tsx` / `ReportWorkspace` 仍有引用 |
| `apps/web/src/hooks/useStudentProgressData.ts` | 精简为从统一端点读取；`masteryMap` 切 `fetchMyMastery` | 高：影响所有消费页面 |
| `apps/web/src/App.tsx` | 同步移除对废弃资源的接线 | 中 |
| `apps/api/src/study/study.service.ts` | 删除 `getMasteryMap` 的 legacy 分支与 `computeMasteryReport` 调用链；删除 `/trial-progress` `/study-reminders` `/sprint-plan` 处理器 | 高：4661 行单体，需小心移除 |
| `apps/api/src/score-center/service.ts` | 保持唯一写入方地位；补齐 `completeTask` 与闭环控制器对接 | 高 |
| `packages/shared/src/learning.ts` | `computeMasteryReport` 标记 `@deprecated`，调用方清空 | 中 |

依赖顺序：先删后端冗余聚合 → 再切前端读取 → 最后删前端 mock。保证任何一步都能独立构建（约束：每 Sprint 后 `npm run build:shared && npm run build:api && npm run build:web` 通过）。

---

## 10. 风险与技术债（Sprint 2 视角）

1. **双口径过渡期的灰度开关**：`USE_KNODE_MASTERY` 让新旧路径并存，Sprint 2 结束时应移除开关、删除旧分支，避免"看起来统一了但还能切回去"。
2. **nodeMastery 读缓存**：`study.service.ts` 的 `nodeMasteryByUser` 内存缓存（`loadNodeMasteryReadCache` / `refreshNodeMasteryCache`）是性能优化，但会引入"缓存滞后于写入"的窗口；统一读 `getMyMastery` 后应评估是否保留。
3. **无 DB 模式**：`DATABASE_URL` 未配置时 `ScoreCenterService.enabled=false`，`applyAttempts` 直接 return——演示环境没问题，但必须确保 `isMockAllowed()` 在生产为 false（生产禁静默 mock）。
4. **快照一致性**：验收 C2-46 要求快照值与 `UserKnowledgeMastery` 一致；`applyReview` 写入的快照是复习前的 `current`，需在文档中明确这是有意行为（快照记录"复习触发时的状态"）。

---

## 11. 面试/讲解视角：怎么讲 Student State

### 30 秒版

> V3 的第二个 Sprint 是"统一学生状态"。改版前掌握度有粗粒度知识点和原子节点两套口径，前端还有一套 mock 数据充当默认值，同一个页面在不同开关下会显示不同数值。Sprint 2 把状态收敛成唯一事实源：`UserKnowledgeMastery` 存掌握度、`PracticeRecord` 存行为、`UserMasterySnapshot` 存趋势、`UserEvent` 存事件流。所有页面统一从 `getMyMastery` 和今日计划接口读，删掉了前端内存态 mock 和三个冗余聚合接口。

### 2 分钟版（四段式）

1. **问题**：状态分散——后端双轨计算、前端 mock 充当第二真相、三个聚合接口与统一数据源重复。
2. **方案**：规定唯一事实源（mastery / record / task / event / snapshot），写入收敛到 `ScoreCenterService` 的 `applyAttempts` / `applyReview`，读取收敛到 `getMyMastery` / `getMasteryTrend` / `/today/plan`。
3. **细节**：掌握度用 EWMA，主考点 α=0.18、次考点 0.07，目标值按难度锚定；复习只更新 stabilityDays 和 retention，不降 mastery；推荐引擎 `calculatePriority` 六维加权（考频 0.37 + 薄弱 0.32 + 遗忘 0.16...）+ `composeDailyPlan` 做预算/冷却/前置缺口编排。
4. **取舍与债**：删 mock 会让静态演示需要专门的入口；`study.service.ts` 单体和 nodeMastery 读缓存是遗留问题，Sprint 3 闭环打通时再收尾。

### 追问准备

- **Q：为什么用 EWMA 而不是直接统计正确率？** 答：直接统计对样本量敏感，做 1 题错就 0%；EWMA 用平滑系数让近因权重可控，配合难度锚定的目标值，能让"做难题答对"和"做简单题答对"产生不同增量。
- **Q：怎么保证幂等？** 答：三个层面——模型唯一约束 + upsert（mastery/snapshot/wrong review）、事务内先归档再创建（每日计划）、已完成任务拒绝二次完成（任务）。
- **Q：mastery 和 recentAccuracy 有什么区别？** 答：mastery 是 EWMA 的"水平值"，随学习缓慢上升；recentAccuracy 是短窗口 EWMA（α=0.2），反映最近表现，推荐引擎用 recentAccuracy 判断该"练习"还是该"复习"。

---

## 12. 快速复习路径

1. 先读 `docs/v3-product-refactor-plan.md` 第 6、7 节（Sprint 2 范围与目标）
2. 再读 `packages/shared/src/score-center/mastery.ts`（引擎，全文 73 行）
3. 再读 `apps/api/src/score-center/service.ts` 的 `applySingleAttempt` / `applyReview` / `getMyMastery`
4. 再读 `apps/api/src/score-center/repository.ts` 的 `resolveKnowledgeNodesForQuestion` / `saveMastery` / `saveMasterySnapshot`（幂等的代码依据）
5. 再读 `packages/shared/src/score-center/priority.ts` + `plan.ts`（推荐引擎）
6. 最后对照 `docs/v3-acceptance.md` 的 A4/A5/B3 验收项，在代码里找到每一条的落点
