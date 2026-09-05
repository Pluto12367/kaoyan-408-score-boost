# v3.4 AI Production Architecture — Closed-Loop Learning System

> 日期：2026-09-06。以 v3.4 闭环验证（真实 DB + 真实语料）实证的架构图与数据流。所有箭头均已在 `scripts/v34-*-eval.mjs` 中以真实数据行验证。

## 1. 全景架构

```
                        ┌────────────────────────────────────────────┐
                        │              Student (User)                │
                        └──────┬─────────────────────────┬───────────┘
                        提问/请求│                        │练习/复习/考试
                               ▼                        ▼
        ┌──────────────────────────────────────────────────────────────┐
        │                     AI SURFACES                              │
        │  Coach(PX-1 session+personalization)   Exam Simulator(PX-3)  │
        │  Study Agent V1(V1 loop+workflow)      Tutor Mode(PX-4)      │
        │  Planner(PX-4 validate→execute)        Supervisor(PX-5)      │
        └──────┬───────────────────────────────────────────┬───────────┘
               │ 读（唯一入口）                             │ 写（唯一通道）
               ▼                                          ▼
   ┌─────────────────────────┐              ┌─────────────────────────────┐
   │  StudentContext (v1)    │              │   Canonical Writers         │
   │  mastery/practice/      │              │  - createStudyTask tool →   │
   │  review/plan/momentum   │              │    RecommendationService    │
   │  + freshness/evidence   │              │    .generateDailyPlanFromSt │
   └──────┬──────────────────┘              │    ate (generationKey 幂等) │
          │ 派生（只读，可重建）             │  - mastery 唯一写方：       │
   ┌──────▼──────────────┐                  │    ScoreCenter.applyAttempts│
   │ Learning Memory(PX) │                  │    /applyReview（练习/复习  │
   │ short/mid/long      │                  │    提交路径内）              │
   └─────────────────────┘                  └──────────┬──────────────────┘
   ┌─────────────────────┐                              │
   │ RAG V2              │                              ▼
   │ rewrite→hybrid→     │                  ┌─────────────────────────────┐
   │ graph→difficulty    │                  │        STUDENT STATE        │
   └──────┬──────────────┘                  │ PracticeRecord（练习事实）   │
          │ 真实语料                         │ UserKnowledgeMastery（掌握） │
   ┌──────▼──────────────┐                  │ WrongQuestionReview/        │
   │ Knowledge Corpus    │                  │ ReviewSchedule/Attempt（复习）│
   │ DB KnowledgeNode    │                  │ StudyPlan/StudyTask（计划）  │
   │ 1297 节点+Relations │                  │ AnswerReceipt（幂等台账）    │
   │ +Question bank      │                  └──────────┬──────────────────┘
   │ +frequency evidence │                             │
   └─────────────────────┘                             │
                        ▲                              │
                        └────────── 反馈闭环 ◄─────────┘
        练习→mastery→recommendation 排序变化（v3.4 实测 46→39）
        复习→stability/nextReviewAt 变化（v3.4 实测 null→1.7）
        考试→错点进入 planner 焦点（v3.4 实测焦点迁移）
```

## 2. 六条已验证的闭环通路（v3.4 证据）

| # | 通路 | 验证脚本 | 关键断言 |
|---|---|---|---|
| 1 | Planning Loop | v34-closed-loop-eval | 错题→mastery 0.402→推荐 items 生成→planner 落真实 StudyPlan（generationKey 幂等） |
| 2 | Mastery Feedback | v34-closed-loop-eval | 练对→mastery 0.402→0.596→引擎 priority 46→39（closed loop 实证） |
| 3 | Review Loop | v34-closed-loop-eval | 错题→WrongQuestionReview→applyReview 成功 stability null→1.7 / 失败持平（引擎设计） |
| 4 | Coach Loop | v34-coach-exam-loop-eval | "为什么PV总错"→StudentContext weakPoints=[信号量]→RAG grounding→练习后第二次装配 weak 1→0 |
| 5 | Exam Loop | v34-coach-exam-loop-eval | 真实节点+真实题库出卷→作答→weakPoints=3→planner 焦点迁移（组相联映射→优先级调度） |
| 6 | Write Safety | v34-agent-toolcalling-eval | 未授权 createStudyTask 被闸（writer 0 调用）；FK 约束拒非法写；同键幂等 |

## 3. 边界与护栏（持续由测试钉死）

- **Agent 层零数据库访问**：agent/rag 目录源码无 DB 客户端引用、无写原语（边界测试）。
- **单一事实源**：Memory/Coach Session 均为派生视图（RuntimeState/内存），StudentContext 仍是唯一学习上下文入口；mastery 唯一写方是 ScoreCenterService。
- **LLM 失败全降级**：402/timeout/malformed → template/workflow（source/fallbackReason 显式），无静默 mock、无坏写通道。
- **多代理隔离**：specialist 仅经 Agent Protocol 通信，互不引用。

## 4. 分层验证等级（Phase 0 定义，v3.4 结束时）

| 层 | 等级 |
|---|---|
| 单元/契约（240 项） | Contract PASS |
| RAG（真实语料 1388 chunks） | Integration PASS |
| Agent 编排（真实 DB 写入+幂等+权限） | Integration PASS |
| 四条学习闭环 | Integration PASS |
| 远程 LLM / Embedding | BLOCKED（billing / credentials+provider） |
| Production Readiness | RELEASE BLOCKED BY CREDENTIALS（详见 v34-ai-release-gate.md） |
