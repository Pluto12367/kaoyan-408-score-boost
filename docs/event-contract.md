# Event Contract v1

状态：Phase 3.6.2B-1 Event Contract Freeze；Phase 3.6.2B-2 EventKey Schema Migration 已实施，writer 迁移进行中

本文定义 `UserEvent` 的稳定事件边界。它不是 Event Sourcing 规范，也不把
`UserEvent` 变成 Student State 或 Mastery 的事实源。

## 1. 设计原则

1. `PracticeRecord`、`ReviewAttempt` 和 `UserKnowledgeMastery` 仍是学习事实与掌握度的来源；`UserEvent` 只记录可观测行为或反馈。
2. 事件类型是稳定的公共契约。v1 保留当前已经产生的字符串，不通过大小写或同义词重命名已有事件。
3. `userId` 由认证上下文决定，不能由 payload 或客户端覆盖。
4. canonical 事件由后端领域 writer 产生；通用埋点接口不应成为 canonical feedback 或 plan 事件的可信生产者。
5. `eventKey` 由服务端确定性生成，并由数据库唯一索引约束。它用于数据库级去重，不代表可靠投递、无损恢复或完整 exactly-once delivery。
6. 事件消费者不得根据 `UserEvent` 直接修改 `UserKnowledgeMastery`。

## 2. 持久化 Envelope

当前 Prisma 模型为：

```text
UserEvent {
  id        String   @id
  userId    String
  type      String
  payload   Json?
  createdAt DateTime
}
```

字段语义：

| 字段 | 语义 | 约束 |
|---|---|---|
| `id` | UserEvent 持久化身份 | 不得复用 action、task、question 或 outcome ID |
| `userId` | 事件所属用户 | 服务端认证上下文写入 |
| `type` | v1 事件类型 | 当前数据库为 String；未知值按 legacy/extension 处理 |
| `payload` | 类型专属 JSON | 由对应 producer 负责契约校验 |
| `createdAt` | 数据库写入时间 | 不等同于业务发生时间 |

部分业务事件（尤其 `USER_ACTION_FEEDBACK`）在 payload 中携带
`occurredAt`，它表示业务事实发生时间。消费者需要区分 `occurredAt` 与
`createdAt`。

## 3. Event Type Registry

### 3.1 当前 Active 事件

| Event type | Producer | 当前 payload | Consumer / 用途 | eventKey 计划 |
|---|---|---|---|---|
| `practice.submit` | `StudyService.trackUserEvent` | `questionId`, `correct` | 行为观测 | 未来使用稳定 `practiceRecordId`；当前不生成 |
| `session.submit` | `StudyService.trackUserEvent` | `sessionId`, `type` | 会话观测 | 未来使用 `sessionId`；当前不生成 |
| `task.complete` | `StudyService.trackUserEvent` | `taskId`, `scheduledDate` | Learning Loop 触发输入 | 未来使用 `TASK_COMPLETE:{userId}:{taskId}:{scheduledDate}` |
| `wrong.review` | `StudyService.trackUserEvent` | `questionId` | 错题行为观测 | 当前缺少稳定 review outcome ID，保持 NULL |
| `assessment.import` | `StudyService.trackUserEvent` | `title`, `score`, `totalScore` | 评估导入观测 | 未来使用 `assessmentHistoryItemId`；当前不生成 |
| `plan.generated` | `LearningLoopTriggerService` | `planId`, `generationKey`, `source`, `scheduledDate`, `triggerType`, `sourceId`, `triggerKey` | 次日计划生成观测与重复检查 | `PLAN_GENERATED:{generationKey}` |
| `USER_ACTION_FEEDBACK` | `ActionLearningSignalConsumerService` → `StudentStateFeedbackRepository` | 见 §4.6 | Student State feedback event；未来分析输入 | `USER_ACTION_FEEDBACK:{userId}:{actionId}:{signalType}` |

已有 `triggerKey` 必须继续保留在 `plan.generated` payload 中，以兼容现有读取方；它与未来数据库 `eventKey` 是两个字段，不应混为一谈。

### 3.2 Reserved / Future 事件

以下名称只作为后续契约预留，当前没有生产者，不得由现有通用接口随意产生：

```text
recommendation.created
recommendation.accepted
recommendation.completed
recommendation.failed
learning.insight.created
knowledge.gap.detected
study.strategy.updated
```

在这些事件拥有独立 payload、producer 和消费方契约前，不纳入 RAG、Memory 或 Recommendation 训练数据。

## 4. Payload Contracts

### 4.1 `practice.submit`

当前稳定 payload：

```json
{
  "questionId": "question-id",
  "correct": true
}
```

它是练习观测事件，不替代 `PracticeRecord`。未来如果需要可靠去重，必须传入稳定的 `PracticeRecord.id`，不能用题目 ID 充当事件身份。

### 4.2 `session.submit`

```json
{
  "sessionId": "session-id",
  "type": "practice_set"
}
```

`sessionId` 是 LearningSession ID，不是 Action ID 或 PracticeRecord ID。

### 4.3 `task.complete`

```json
{
  "taskId": "task-id",
  "scheduledDate": "2026-09-02"
}
```

任务完成事实仍由 `StudyTask` / `StudyTaskCompletion` 表达；该事件只用于观测和触发链输入。

### 4.4 `wrong.review`

```json
{
  "questionId": "question-id"
}
```

当前 payload 没有独立 ReviewAttempt ID，因此不能可靠推导 eventKey。不得用 `questionId` 冒充 ReviewAttempt 或 Action ID。

### 4.5 `assessment.import`

```json
{
  "title": "历史测评",
  "score": 72,
  "totalScore": 100
}
```

它是导入观测，不是 AssessmentHistoryItem 的替代记录。eventKey 只有在 payload 或 writer 具备稳定历史记录 ID 后才启用。

### 4.6 `USER_ACTION_FEEDBACK`

canonical payload：

```json
{
  "id": "student-state-feedback:action-1:POSITIVE_FEEDBACK",
  "userId": "user-1",
  "actionId": "action-1",
  "actionType": "PRACTICE",
  "targetType": "KNOWLEDGE_NODE",
  "targetId": "node-1",
  "signalType": "POSITIVE_FEEDBACK",
  "confidence": 1,
  "evidenceRefs": ["practice-record:record-1"],
  "occurredAt": "2026-09-02T08:05:00.000Z"
}
```

约束：

- `actionId`、`targetId`、`userId` 是不同身份空间；`actionId` 不得等于或承载 `targetId`。
- `actionId` 必须来自已验证的 `RecommendationAction`。
- `evidenceRefs` 只能引用可追溯事实，不得伪造掌握度结论。
- payload 中的 `id` 是反馈投影身份，不是 `UserEvent.id`。
- `signalType` 变化代表不同 feedback key；相同 action 与相同 signalType 应幂等。

## 5. EventKey Contract（Schema 与 canonical writer 已实施）

### 5.1 Schema 形态

已实施 Schema 形态：

```prisma
eventKey String?

@@unique([userId, eventKey])
```

`eventKey` 必须 nullable：普通历史埋点和无法可靠推导身份的事件继续使用 NULL。PostgreSQL 的 nullable unique 行为允许这些旧事件共存。

### 5.2 生成规则

- key 由后端 writer 生成，客户端不能提交或覆盖。
- key 必须包含事件类型命名空间，避免不同事件类型碰撞。
- key 中的业务 ID 必须来自权威事实表；不得使用可变标题、展示文案、随机 UUID 或混合 ID 空间。
- `(userId, eventKey)` 是数据库唯一边界；同 key 冲突应读取并返回已有事件。
- `eventKey` 与 payload 中的 `triggerKey` 不是同一字段。旧 `triggerKey` 在迁移期间保留。

### 5.3 可靠性边界

加入唯一键后可得到：

```text
同一 key 至多一条持久化 UserEvent
```

仍不能得到：

```text
进程崩溃不丢事件
事务后异步触发必达
StudyPlan 副作用 exactly-once
```

尤其是 `LearningLoopTriggerService` 的 `hasTriggerKey → 生成计划 → 写事件` 仍需单独处理计划副作用幂等；仅增加 `UserEvent.eventKey` 不足以解决该问题。

## 6. Producer Boundary

当前代码中的 producer：

- `UserEventRepository.record()`：通用埋点写入。
- `StudentStateFeedbackRepository.createIfAbsent()`：反馈事件写入。
- `LearningLoopTriggerService`：计划生成事件写入。
- `StudyService.trackUserEvent()`：对通用事件 writer 的 best-effort 包装。

目标边界：

1. `USER_ACTION_FEEDBACK` 只能由 ActionLearningSignal consumer 产生。
2. `plan.generated` 只能由 LearningLoopTriggerService 产生。
3. `POST /events` 继续兼容普通埋点，但不得成为上述 canonical 类型的可信入口；writer 迁移阶段应拒绝或隔离保留类型。
4. 反馈 writer 的失败不回滚已提交的 Practice/Review；当前 best-effort 语义保持不变。
5. 任何事件 writer 都不能更新 `UserKnowledgeMastery`、`PracticeRecord` 或 `ReviewAttempt`。

## 7. Consumer Boundary

当前消费者：

- `LearningLoopTriggerService` 读取 `plan.generated` 的 `triggerKey`。
- `ActionLearningSignalConsumerService` 生成并持久化 `USER_ACTION_FEEDBACK`。
- Recommendation feedback 查询读取 ActionLearningSignal，而不是把 UserEvent 当作 Mastery 来源。

未来 Memory/RAG 只能消费经过类型过滤和 payload 校验的事件，并且必须与 `PracticeRecord`、`ReviewAttempt`、`UserKnowledgeMastery` 事实联合使用。未知事件、客户端普通埋点和未冻结的 AI memory 事件不得直接进入检索语料。

## 8. Compatibility and Security

- 保留已有 event type 字符串，避免当前查询方失效。
- 旧 `UserEvent` 行的 `eventKey` 视为 NULL；不要求历史事件回填。
- 旧 payload 缺少稳定身份时，不通过猜测补 key。
- canonical event 的 `userId`、`actionId`、`targetId` 必须由服务端事实校验；通用事件 payload 中的同名字段不能覆盖数据库列或权威身份。
- `UserEvent` 不是事件溯源存储，不承担 aggregate replay 或状态重建职责。

## 9. Implementation Gates

进入 EventKey Writer Migration 前必须满足：

1. 事件类型 registry 与 payload contract 通过契约评审。
2. 生产库完成只读冲突盘点；无法推导 key 的旧事件保持 NULL。
3. 明确 canonical writer 与通用 `/events` 的保留类型边界。
4. 完成数据库唯一冲突处理和跨实例 PostgreSQL 集成测试。
5. 单独验证 Learning Loop 的计划副作用幂等，不把 eventKey 当作唯一方案。

当前 canonical writer 按本契约生成并写入 `eventKey`；Feedback writer 与 LearningLoop 已接入数据库唯一冲突回读。其他通用事件 writer 仍保持 NULL eventKey，除非未来具备稳定事实身份。
