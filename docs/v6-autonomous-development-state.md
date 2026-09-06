# V6 Autonomous Development State — Learning Effectiveness Optimization

> **上下文恢复入口**：发生上下文压缩后，首先读本文件。
> 最后更新：2026-09-06（V6-0 完成）。

## Current Mission

V6 Learning Effectiveness Optimization——从"系统可以自适应"升级为"能够用真实学习数据验证自适应策略是否有效，并基于实验结果持续优化策略"。

## Current Phase

V6-1 Learning Outcome Model（实现中）。

## Completed

- **V6-0**：Baseline Audit。基线 `f2786df`（v5.5.0-production-certified），工作树归零，AI 回归 33/33。现有基础设施：Learning Signals（8 类）、Risk Detection（6 类）、Adaptive Layer（重排）、Experiment Framework（12 archetype 离线）、AiMetrics（7 类事件）。

## In Progress

- V6-1：Learning Outcome Model——Intervention→Outcome 纯函数派生。

## Pending（依赖序）

V6-2..V6-25 按 mission roadmap 顺序执行。

## Architecture Decisions

- **AD-V6-1**：Learning Outcome Model 是派生层（从 PracticeRecord/UserKnowledgeMastery 等事实表计算），不是新事实源。
- **AD-V6-2**：Intervention ID 复用既有 studyTaskId/recommendationActionId，不创建新 ID 体系。
- **AD-V6-3**：Attribution 明确标注 correlation vs causation，证据不足时报 insufficient_data。
- **AD-V6-4**：Strategy Optimizer 只生成 proposal，不自动修改生产策略。

## Blocked

无。Real AI Provider 已解除（LLM PASS，Embedding 维度需 owner 配置）。

## Next Task

V6-1 实现 `apps/api/src/effectiveness/learning-outcome.ts` 纯函数。
