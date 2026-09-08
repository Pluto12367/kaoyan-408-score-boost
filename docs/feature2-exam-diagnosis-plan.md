# Feature 2：全真模考诊断增强 — Implementation Plan（Phase 0/1）

> 状态：Plan（待实施；按长期自主授权，实施不再逐步等待批准——触发第五章暂停条件才停）。
> 日期：2026-09-08。上游：Roadmap §F2 + §0 四问/六指标。**零迁移、零新表、引擎零触碰。**

## Phase 0 问题定义

- **学生痛点**：模考后只知道"答对多少"，不知道"为什么错、丢在哪、怎么补"。
- **失分机制**：模考暴露的缺口没有转化为修复动作 = 同样的失分在真实考场重演。
- **现有能力**（审计实证）：`getExamReport` 已有分科正确率/主观题真实自评分/失分考点 Top10/未答清单/180min 超时判定；`generatePostExamReviewTasks` 以确定性 id（`exam-review-{sessionId}-day-N`）生成 3 天恢复任务并入计划；`ExamQuestionKnowledgeTag`/`QuestionKnowledgeNodeTag` 提供节点归因；`User.targetScore` 存目标分；`StudyTaskCompletion` 是任务执行事实。
- **缺口**：无 150 分标准化、无目标差距分解、无节点级失分×考频归因、**无恢复计划闭环率**。

## Phase 1 设计（契约）

`GET /exam/diagnosis/:sessionId`（新端点，只读，owner 校验经 getExamReport）→ `ExamDiagnosis`：

```jsonc
{
  "version": "exam-diagnosis-v1",
  "sessionId": "...", "asOf": "...",
  "score150Estimate": {                      // 估算（客观题按 408 标准结构 80 分折算正确率）
    "value": 96, "objectiveMax": 80, "objectiveEarnedEstimate": 58,
    "subjectiveEarned": 21, "subjectiveMax": 45, "subjectiveNote": "含自评题",
    "basis": "客观题按正确率×80 折算（估算）；主观题为真实自评分", "confidence": "medium"
  } | null,                                  // 会话无客观题且无主观分 → null
  "perSubject": [{ "subject": "操作系统", "questions": 5, "accuracyRate": 60,
                   "objectiveEarnedEstimate": 6, "objectiveMax": 10 }],   // 客观题口径标注
  "nodeLoss": [{ "knowledgeNodeId": "OS-DEADLOCK", "name": "死锁", "lostCount": 3,
                 "recent5Frequency": 5, "stars": 5 }],                     // ≤5，按 lostCount×freq 排序
  "nodeLossUnmappedCount": 2,                // 无法归因节点的失分题数（诚实计数）
  "gapDecomposition": {                      // user.targetScore 缺失 → null
    "targetScore": 350,                      // 研究生总分口径（408 专业课满分 150）
    "predictedScore150": 96, "gap": 54,
    "note": "gap 基于估算分与目标分；目标分为 408 单科口径时请直接对比 score150Estimate"
  } | null,
  "recoveryClosure": {                       // 恢复计划未生成 → null + reason
    "exposedTasks": 3, "completedTasks": 1, "closureRate": 33,
    "taskIds": ["exam-review-{sid}-day-1", "..."]
  } | null, "recoveryClosureReason": "recovery_plan_not_generated" | null,
  "source": "derived"
}
```

## Phase 2 实施拆分

| 件 | 内容 |
|---|---|
| `exam-diagnosis.ts`（纯） | 输入=report 摘要/分科/失分点 + nodeLoss 富化输入 + 目标分 + 闭环事实；全部诚实分支（无目标/无计划/无分值基础）|
| `exam-diagnosis.service.ts`（新） | IO 组装：StudyService.getExamReport（含 owner 校验）+ `resolveKnowledgeNodesForQuestion`（逐失分题归因）+ `loadLatestFrequencyForNodes` + prisma（user.targetScore / StudyTask 存在性 / StudyTaskCompletion 计数）|
| `study.controller.ts` | 新路由 `GET /exam/diagnosis/:sessionId` + 构造器末位注入 |
| `study.service.ts` | getExamReport 响应**增量**附加 `lostQuestionIds: string[]`（节点归因输入；纯增量键） |
| `study.module.ts` | provider 注册 |

## 测试

- `test/exam-diagnosis.test.js`：纯投影行为（150 估算公式/主观题标注/无目标 null/恢复计划未生成 null+reason/闭环率计算/节点富化排序/无失分诚实空态/纯度）。
- 接线源码断言：路由/注入/lostQuestionIds 增量/StudyModule 注册。
- 全量回归 + build 双端。

## 指标落点

M5 模考恢复效率 = `recoveryClosure.closureRate`（本 Feature 直接落地度量）；大题能力分析（M4）以主观题自评聚合先导呈现，逐点版随 F4 rubric。
