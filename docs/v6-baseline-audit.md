# V6 Baseline Audit

> 日期：2026-09-06。基线 `f2786df`（v5.5.0-production-certified）。工作树归零。

## 1. 版本线

v3.0 → v3.2 → v3.3 → v3.4.1 → v4.0 → v5.0 → v5.5.0-production-certified → HEAD `f2786df`

## 2. 现有基础设施（V6 增量空间）

| 组件 | 来源 | V6 复用方式 |
|---|---|---|
| StudentContext v1 | v3.0 canonical read model | Outcome 派生的输入 |
| Learning Signals（8 类） | V4-2 | Outcome 触发因子 |
| Risk Detection（6 类） | V4-3 | Intervention 触发因子 |
| Adaptive Layer（重排） | V4-4 | 策略 A/B 对比对象 |
| Proactive Coach | V4-6 | Intervention 源 |
| Experiment Framework | V4-11（12 archetype 离线） | V6-12 扩展为历史事件驱动 |
| AiMetrics（7 类事件） | AI-12/V4-12 | Outcome 指标存储 |
| DailyPlanningService | V5-4 adaptive | Planner effectiveness 评估对象 |
| ExamSimulator | V4-9 | Exam effectiveness 评估对象 |
| LearningSignalService | V4-2 | Coach/Intervention effectiveness 评估输入 |

## 3. 缺口（V6 需新建）

1. **Learning Outcome Model**：mastery gain/accuracy delta/retention/task completion 等 outcome 的结构化定义与派生
2. **Intervention Model**：统一 Recommendation/Coach/Review/Practice/Exam 的 intervention 类型与身份
3. **Outcome Attribution**：intervention→outcome 的关联层（direct/time-window/knowledge-node/sequence）
4. **Effectiveness Evaluators**：per-surface（Recommendation/Review/Coach/Planner/Practice/Exam）的 effectiveness 报告
5. **Student Segmentation**：archetype 分类模型（mastery level/consistency/error pattern/review behavior）
6. **Offline Experiment Engine**：基于历史学习事件的策略 A/B 对比
7. **Strategy Optimizer**：基于实验结果的参数变更 proposal（human-in-the-loop）

## 4. 测试基线

全量 1791/1767/22（22 为前序工作线 UI 债）。V4 adaptive 套件 70/70。AI 回归 33/33。
