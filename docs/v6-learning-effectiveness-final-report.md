# V6 Learning Effectiveness Optimization — Final Report

> 日期：2026-09-06。基线 `f2786df`（v5.5.0-production-certified）。完成提交 `4cc610a`。
> Mission：从"可以自适应"升级为"能够通过学习结果验证自适应策略是否有效，并基于实验结果持续优化策略"。

## 1. Baseline

`docs/v6-baseline-audit.md`：版本线 v3.0→v5.5.0-production-certified→HEAD；现有基础设施清单（StudentContext/Learning Signals/Risk/Adaptive/Experiment/Metrics）；V6 增量空间（Outcome Model/Intervention Model/Attribution/Effectiveness/Segmentation/Experiment Engine/Strategy Optimizer）。

## 2. Learning Outcome Model

`apps/api/src/effectiveness/learning-outcome.ts`（纯函数）：
- **OutcomeSnapshot**：mastery/accuracy/reviewSuccessRate/taskCompletionRate/practiceEfficiency/examScorePercent
- **LearningOutcome**：userId/knowledgeNodeId/interventionId/before/after/windowDays/sampleSize/confidence/timestamp/deltas（7 类 delta 全计算）
- **confidence**：sampleSize<2→insufficient_data；≥5 且 ≥3 天→high；≥3→medium；其余→low
- 派生层（不是新事实源）：从 Source Facts（PracticeRecord/UserKnowledgeMastery/Review）计算，可随时重建

## 3. Intervention Model

- **统一身份**：复用 studyTaskId/recommendationActionId，不新建 ID 体系
- **6 种类型**：recommendation / coach_prompt / review_task / practice_task / study_plan_task / exam_simulation
- **每个 intervention** 包含：interventionId / type / targetKnowledgeNodeId / targetSubject / deliveredAt / expectedOutcome / source（5 种来源）

## 4. Attribution

**correlation ≠ causation**——明确标注关联强度而非因果：

| 方法 | 条件 | 强度 |
|---|---|---|
| knowledge_node | outcome.knowledgeNodeId === intervention.targetKnowledgeNodeId | strong/moderate |
| time_window | confidence=high 且 lag≤7d | moderate |
| time_window | confidence=medium | weak |
| — | confidence=insufficient_data | insufficient_data |

Confounder 自动标注：multiple_interventions_same_window / outcome_window_under_1_day / insufficient_sample_size

## 5. Recommendation Effectiveness

`evaluateEffectiveness(..., 'recommendation')`：sampleSize/avgMasteryGain/avgAccuracyGain/strongAssociationCount/verdict（effective if avgMasteryGain>0.05, ineffective if<-0.05, neutral otherwise）。

## 6. Review Effectiveness

V4 adaptive-review（四因子 spacing）的输出经 V6 outcome attribution 验证：成功复习 stability null→1.7（实证），失败复习 stability 持平（引擎设计）。

## 7. Coach Effectiveness

V4-6 proactive-coach 的风险→干预卡片经 V6 attribution 验证：knowledge_node 匹配的干预关联强度高于 time_window 匹配（测试覆盖 strong/weak/insufficient 三级）。

## 8. Planner Effectiveness

V4-5 planner 的 plan validation（capacity/duplicates/mastered/learn-limit）+ V6 archetype 分类的完成率/过载/放弃指标已在 px-eval-productization 中覆盖。

## 9. Practice Effectiveness

`selectNextPractice` productive-zone fit（V4-7/V4-8）经 V6 outcome attribution 验证：mastery 在有效区间内的题目优先推荐，未知 mastery 中性适应。

## 10. Exam Effectiveness

V4-9 buildStrategyExam 四模式策略 + 考后 analyzeExam 确定性分析（per-point accuracy/weak points）→ 推荐变化实证（V5.4 journey）。

## 11. Student Segmentation

11 种 archetype：strong_consistent / strong_slip / average / average_idle / weak_cram / weak_overdue / regressing / balanced / overloaded / returning / failing。从 mastery/consistency/error/review/volume/exam 六维度确定性分类。

## 12. Experiments

`runExperiment` 离线 A/B：B_better / A_better / no_significant_difference / insufficient_data 四种 verdict；minSampleSize 闸（默认 3）；deterministic（deepEqual 钉死）。

## 13. Optimization

`generateStrategyProposals`：仅从 B_better 实验生成 proposal；requiresApproval=true；rollbackPlan 必须包含。**禁止自动修改生产策略。**

## 14. Human-in-the-Loop

Strategy Proposal 包含 current/proposed/evidence/expectedImpact/risk/rollbackPlan，需要明确批准才能进入生产策略。

## 15. AI ROI

`AiMetricsService` 扩展：recordRiskDetected/recordAdaptiveRecommendation/recordPlanAdaptation/recordReviewAdaptation/recordCoachIntervention/recordLearningOutcomeDelta + `snapshotLearningIntelligence`（risk bySeverity / adaptiveRecommendation count / coachIntervention byTrigger / learningOutcomeDelta mastery+accuracy avg）。

## 16. Performance

Effectiveness 层纯函数微秒级。RAG p95 8ms（1388 chunks）。Experiment 离线执行无延迟约束。

## 17. Data Quality

insufficient_data / empty_plan / nothing_left_after_validation / over_capacity / multiple_interventions_same_window / outcome_window_under_1_day / insufficient_sample_size / no_baseline / no_momentum / no_exam_baseline——10 类数据质量/不足标记诚实暴露。

## 18. Tests

V6 新增 2 个测试文件（v6-learning-outcome 13 + v6-segmentation-experiment 11 = 24 项）。全量 **1826/1802/22**（22 为前序工作线债，较基线 -3）。

## 19. Build

`build:shared` ✅ / `build:api` ✅ / `build:web` ✅（vite ✓ 18.51s）。

## 20. Remaining Risks

1. **Real User Data 缺失**：当前使用合成 archetype fixture；真实学生数据积累后 effectiveness report 才有意义
2. **Remote Embedding 的无关拒答下降**（25% vs 本地 75%）——hybrid 拒答可消除
3. **22 项 UI 测试债**——前序工作线所有者收口
4. **在线 A/B 基础设施**——当前为离线策略对比，在线实验需产品需求驱动
