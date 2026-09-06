# V6.1 Real Outcome Pipeline Audit

> 日期：2026-09-06。只读审计。映射 Intervention → User Action → Outcome → Attribution 全链路。

## 1. Intervention 生产点（已存在）

| Surface | 干预类型 | 写入路径 | interventionId 来源 |
|---|---|---|---|
| DailyPlanningService | study_plan_task | `createStudyTask` → `generateDailyPlanFromState` (generationKey 幂等) | StudyPlan.task.id |
| StudyPlannerService | recommendation | `createStudyTask` → 同上 | 同上 |
| ProactiveCoach | coach_prompt | 不写入（生成卡片） | risk.type + date |
| ExamSimulator | exam_simulation | 不写入（生成试卷） | 试卷 ID |
| AdaptiveRecommendation | recommendation | 不写入（重排引擎输出） | 引擎 item ID |

## 2. Outcome 生产点（已存在）

| Outcome 维度 | 写入路径 | 数据源表 |
|---|---|---|
| mastery change | `ScoreCenterService.applyAttempts` → `UserKnowledgeMastery` | mastery delta 可直接计算 |
| accuracy change | PracticeRecord 提交 → recentAccuracy | practice.recentAccuracy.value |
| review stability/success | `ScoreCenterService.applyReview` → `ReviewSchedule.stability` | stabilityDays/consecutiveCorrect |
| task completion | `completeStudyTask` → `StudyTaskCompletion` | completionRate |
| exam performance | 提交路径 → `AssessmentHistoryItem` | score |

## 3. Attribution 路径

| 方法 | 条件 | 状态 |
|---|---|---|
| knowledge_node | intervention.targetKnowledgeNodeId === outcome 节点 ID | ✅ 可直接建立（QuestionKnowledgeNodeTag 已按节点标记） |
| time_window | intervention deliveredAt 到 outcome 测量在 N 天内 | ✅ 可直接计算 |
| direct | 同一 interventionId 下的 before/after | ✅ generationKey 幂等保证一对一 |
| sequence | 多个 intervention 按时序排列 | ✅ 事件按 submittedAt/completedAt 排序 |

## 4. 数据质量风险

| 风险 | 缓解 |
|---|---|
| duplicate outcome | generationKey 幂等 + attribution 去重 |
| missing intervention | attribution 返回 insufficient_data |
| missing baseline | signals 优雅降级（present=false, no_baseline） |
| partial event | bounded reads + step-level error 记录 |
| late event | outcome window 按时间排序，late 事件影响后续窗口 |
| out-of-order event | PracticeRecord 按 submittedAt 排序 |
| insufficient sample | minSampleSize=2 + confidence=insufficient_data |

## 5. V6.1 需新建的代码

1. `effectiveness/outcome-pipeline.ts` — 从 Source Facts 构建 Outcome 的纯函数（去重 + 窗口 + 质量）
2. `effectiveness/strategy-comparison.ts` — 四种选题策略的离线对比
3. `effectiveness/evidence-gate.ts` — Optimizer 生成 proposal 前的证据门槛检查

不新建事实表，不改 Schema，不绕过既有写路径。
