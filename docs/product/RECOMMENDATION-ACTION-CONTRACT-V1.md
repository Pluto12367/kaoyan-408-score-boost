# Recommendation Action Contract v1

状态：Phase 3.1 Identity & Action Contract Gate

本契约只定义推荐动作的稳定身份边界，不实现动作持久化、启动、结果归因或状态写入。完整 Action → Outcome Spine 属于 Phase 3.2。

## Identity spaces

| Field | Meaning | Value space |
|---|---|---|
| `actionId` | 一次具体推荐动作实例 | Action identity；不得用知识对象 ID 代替 |
| `targetType` | 目标对象类型 | `KNOWLEDGE_NODE`、`KNOWLEDGE_POINT`、`QUESTION`、`STUDY_TASK` |
| `targetId` | 目标对象 ID | 由 `targetType` 决定的对应 value space |
| `sourceRecommendationId` | 产生该动作的推荐结果/批次（可选） | Recommendation identity |

`actionId`、`targetType`、`targetId` 是三个独立概念。Canonical DTO 禁止使用无类型的 `id` 或混合 `ids[]` 承载它们。

## Target types

- `KNOWLEDGE_NODE`：掌握度、知识图谱和 Node-level Recommendation 的目标。
- `KNOWLEDGE_POINT`：题目、错题和 Point-level 复习资源的目标。
- `QUESTION`：一次具体练习或复习题目标。
- `STUDY_TASK`：已生成学习计划任务的执行目标。

本阶段不新增 `REVIEW`、`RESOURCE` 等 target type；Review/Resource 仍通过 Point 或 Question 表达，除非后续真实代码证明需要独立身份。

## Evidence and reason

每个 canonical action 必须有非空 `reason` 与至少一条 `evidenceRefs`。Evidence reference 至少包含 `kind` 与 `id`，可明确标注 `knowledgeNodeId`、`knowledgePointId`、`questionId`、`assessmentId`、`studyTaskId` 或 `reviewAttemptId`。

## Compatibility

旧 `StudyTask.knowledgePointId` 和旧 mastery/report DTO 可以继续由显式 adapter 产生。该兼容字段不得反向成为新的 canonical source，也不得将 Node ID 直接写入 canonical Point 字段。

## Persistence decision

本阶段不修改 Prisma schema。现有 `StudyTask`、`LearningSession`、`UserEvent`、`PracticeRecord`、`ReviewAttempt` 是否足以承载 Action → Outcome 关联，留待 Phase 3.2 决策；不足时必须单独输出 schema decision。

