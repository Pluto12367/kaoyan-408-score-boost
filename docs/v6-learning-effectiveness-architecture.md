# V6 Learning Effectiveness Architecture

> 日期：2026-09-06。以 V6 套件（24/24）+ 全量回归实证的架构描述。

## 1. 效果测量全景

```
┌───────────────────── Student ──────────────────────────┐
│  答题 / 复习 / 考试 / 提问 / 执行 AI 干预               │
└──────┬────────────────────────────────────┬────────────┘
       │ Learning Events（提交路径）         │ AI 交互
       ▼                                    ▼
┌─────────────────────────────────────────────────────────┐
│  SOURCE FACTS（不变，唯一事实源）                         │
│  PracticeRecord / UserKnowledgeMastery / Review / etc.  │
└──────┬──────────────────────────────────┬───────────────┘
       │ 只读派生                          │ 只读派生
       ▼                                  ▼
┌──────────────────┐    ┌─────────────────────────────────┐
│ StudentContext   │    │ LearningIntervention（统一身份）  │
│ canonical 只读    │    │ type / target / source / time   │
└──────┬───────────┘    └──────────────┬──────────────────┘
       │                               │
       ▼                               ▼
┌──────────────┐    ┌─────────────────────────────────┐
│ Learning      │    │ OutcomeAttribution               │
│ Signals (V4) │    │ direct / time_window /           │
└──────┬───────┘    │ knowledge_node / sequence        │
       │            │ correlation ≠ causation           │
       ▼            └──────────────┬───────────────────┘
┌──────────────┐                   │
│ Risk Detector│                   ▼
│ (V4-3, 6 类) │    ┌─────────────────────────────────┐
└──────┬───────┘    │ LearningOutcome                  │
       │            │ before/after deltas + confidence │
       ▼            └──────────────┬───────────────────┘
┌──────────────┐                   │
│ Adaptive      │                  ▼
│ Layer (V4-4) │    ┌─────────────────────────────────┐
└──────┬───────┘    │ Effectiveness Report             │
       │            │ per intervention type             │
       ▼            └──────────────┬───────────────────┘
┌──────────────┐                   │
│ Planner      │                   ▼
│ (V4-5)       │    ┌─────────────────────────────────┐
└──────┬───────┘    │ Experiment Engine                │
       │            │ Strategy A vs B (offline)        │
       │            └──────────────┬───────────────────┘
       │                           ▼
       │            ┌─────────────────────────────────┐
       │            │ Strategy Optimizer (proposal)    │
       │            │ requiresApproval = true          │
       │            └──────────────┬───────────────────┘
       │                           │ Human Approval
       │                           ▼
       │            ┌─────────────────────────────────┐
       │            │ Production Strategy Update       │
       │            └─────────────────────────────────┘
       └─────────── Outcome 反馈闭环 ↺
```

## 2. V6 新增组件

| 组件 | 文件 | 职责 | 写权限 |
|---|---|---|---|
| LearningIntervention | `effectiveness/learning-outcome.ts` | 统一 AI/系统干预身份（复用 studyTaskId） | 无 |
| LearningOutcome | 同上 | Intervention 前后学习状态变化（mastery/accuracy/retention/completion/exam deltas） | 无 |
| OutcomeAttribution | 同上 | Intervention→Outcome 关联（correlation ≠ causation） | 无 |
| EffectivenessReport | 同上 | per-intervention-type 效果报告（effective/neutral/ineffective/insufficient_data） | 无 |
| StudentProfile | `effectiveness/learning-effectiveness.ts` | 11 种学生 archetype 分类 | 无 |
| ExperimentResult | 同上 | 策略 A/B 离线对比（确定性） | 无 |
| StrategyProposal | 同上 | 参数变更建议（requiresApproval=true） | 无 |

## 3. 数据流原则

1. **单向依赖**：Source Facts → StudentContext → Signals/Risks → Adaptive → Agent/Coach → Canonical Writer → Outcome → Attribution → Effectiveness → Optimizer
2. **零新事实源**：Outcome/Intervention/Attribution 全部从既有事实表派生
3. **correlation ≠ causation**：Attribution 层明确标注关联强度，不宣称因果
4. **Human-in-the-Loop**：Strategy Optimizer 只生成 proposal，requiresApproval=true
5. **确定性**：同输入必同输出（可复现实验）

## 4. 与 V4/V5 的关系

| V4/V5 组件 | V6 消费方式 |
|---|---|
| Learning Signals (V4-2) | Outcome 触发因子 + Strategy 分析输入 |
| Risk Detection (V4-3) | Intervention 触发条件 |
| Adaptive Layer (V4-4) | 策略 A/B 对比的 treatment arm |
| Proactive Coach (V4-6) | Intervention 源 |
| AiMetrics (AI-12) | Learning Intelligence 指标扩展 |
| Experiment Framework (V4-11) | 扩展为历史事件驱动 |
