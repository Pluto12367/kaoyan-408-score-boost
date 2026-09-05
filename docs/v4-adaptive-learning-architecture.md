# V4 Adaptive Learning OS — Architecture

> 日期：2026-09-06。以 v4 套件（70/70）+ 全量回归实证的架构描述。

## 1. 闭环全景

```
┌─────────────────────────── Student (User) ───────────────────────────┐
│  答题 / 复习 / 考试 / 提问 / 任务执行                                  │
└──────┬───────────────────────────────────────────────┬───────────────┘
       │ Learning Events（提交路径，唯一写入口）          │ AI 交互
       ▼                                               ▼
┌──────────────┐   ┌──────────────┐        ┌─────────────────────────────┐
│ SOURCE FACTS │   │   AI SURFACES（单向依赖 StudentContext）       │
│ PracticeRecord│  │  Coach(PX-1 session+V4-6 proactive)           │
│ UserKnowledge │  │  Exam Simulator(PX-3+V4-9 strategy modes)     │
│  Mastery(含   │  │  Tutor Mode(PX-4 Socratic/三层/误区)           │
│  snapshots)   │  │  Study Agent(AI-3 loop/workflow + V4-5 brief) │
│ WrongQuestion │  │  Planner(AI-5 validate→execute)               │
│ ReviewSchedule│  └──────────────┬───────────────────────────────┘
│ +Attempt      │                 │ 读（唯一入口）                    │
│ StudyPlan/Task│                 ▼                                 │
│ LearningSession│      ┌──────────────────────┐                   │
│ UserEvent     │      │ StudentContext v1    │                   │
│ AnswerReceipt │      │ canonical 只读边界    │                   │
│ AssessmentHist│      └──────────┬───────────┘                   │
└──────────────┘                 │ 派生（只读，可重建）             │
       ▲                         ▼                                │
       │              ┌─────────────────────┐   ┌────────────────┐
       │              │ Learning Memory(PX) │   │ Learning Signals│──┐
       │              └─────────────────────┘   └───────┬────────┘  │
       │                                                ▼            │
       │                                       ┌────────────────┐    │
       │                                       │ Risk Detector  │    │
       │                                       │ (V4-3, 6 类)    │    │
       │                                       └───────┬────────┘    │
       │                                               ▼             │
       │              ┌──────────────────────────────────────────┐   │
       │              │ Adaptive Layer (V4-4)                    │   │
       │              │ risk boost + exam proximity + review card│   │
       │              │ + overload cap                           │   │
       │              └──────────────┬───────────────────────────┘   │
       │                             ▼                               │
       │              ┌──────────────────────────┐                   │
       │              │ Planner (V4-5)           │                   │
       │              │ validate → execute       │                   │
       │              └──────────────┬───────────┘                   │
       │                             ▼                               │
       │              ┌──────────────────────────┐                   │
       │              │ CANONICAL WRITERS        │                   │
       │              │ createStudyTask tool →   │                   │
       │              │  RecommendationService   │──┐                │
       │              │  .generateDailyPlanFrom  │  │                │
       │              │  State(generationKey)    │  │                │
       │              └──────────────┬───────────┘  │                │
       └─────────────────────────────┴──────────────┘
```

## 2. 组件职责与数据流

| 组件 | 输入 | 输出 | 写权限 |
|---|---|---|---|
| StudentContext v1 | Source Facts（DB 只读） | canonical 学习上下文 | 无（只读边界） |
| Learning Memory | StudentContext | 三层记忆 + brief | 无（纯派生） |
| Learning Signals | StudentContext + 可选 baseline | 8 类信号 + brief | 无（纯派生） |
| Risk Detector | Signals + 基线 | 6 类风险 + 严重度 + 建议 | 无（纯派生） |
| Adaptive Layer | Signals + Risks + 引擎 items | 重排 + 调整注释 | 无（纯派生） |
| Recommendation Engine | Source Facts（mastery/frequency/graph） | items（TASK_DRAFT/KNOWLEDGE/...） | 无（纯计算） |
| Planner | Signals/Risks/Engine via tools | validate 后的计划 + execute 指令 | 经 createStudyTask 工具 |
| Agent/Supervisor | 消息 + tools + signals | 步骤 trace + 答案（含引用） | 经 createStudyTask 工具 |
| Coach | StudentContext + RAG + session | 结构化辅导（grounding 契约） | 无 |

## 3. 七段闭环与 V4 组件映射

| 段 | 组件 | 状态 |
|---|---|---|
| Observe | Source Facts → StudentContext | 已有（v3.0） |
| Understand | StudentContext → Learning Memory → Signals | V4-2 |
| Predict | Signals → Risk Detector（6 类） | V4-3 |
| Plan | Adaptive Layer → Planner（validate→execute） | V4-4/V4-5 |
| Act | StudyTask/Review 呈现与执行（前端/既有提交路径） | 已有 |
| Measure | Practice/Review/Assessment 提交 → Source Facts | 已有 |
| Adapt | Mastery/Recommendation 变化 → Signals 更新 | v3.4 实证 + V4 信号化 |

## 4. 不变量（Invariants，测试钉死）

1. StudentContext 是唯一学习上下文入口；Memory/Signals 只读派生。
2. Agent 层零数据库访问；唯一写通道是 createStudyTask（canonical writer，generationKey 幂等）。
3. mastery 唯一写方是 ScoreCenterService（练习/复习提交路径内）。
4. 风险判定 evidence-based；LLM 不参与风险决策。
5. 主动干预全部经既有工具/canonical 通道；Proactive Coach 不新增写路径。
6. 信号/风险/自适应层全部确定性纯函数——同输入必同输出。

## 5. 失败工程要点

- 所有 AI 失败（LLM timeout/malformed/429/tool failure/RAG empty）降级为确定性 workflow 或显式 unavailable，不静默 mock。
- 未授权写被 tool 权限闸硬拒（tool_permission_denied）。
- 垃圾输入经 sanitize/guard 入口净化。
- 重复执行被 generationKey 幂等收敛。

## 6. 观测

- 结构化日志：study_agent.completed / knowledge_search.completed / exam_analyzed / supervisor.routed / tutor_session.started。
- `GET /ai/metrics`（admin）：agent（token/latency/p95/failure/toolCalls）、rag（hitRate/cacheHitRate）、coach（fallbackRate）、risk（bySeverity）、adaptiveRecommendation、plan/review adaptations、learningOutcomeDelta。
