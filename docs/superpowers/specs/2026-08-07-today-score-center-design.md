# 408 今日提分中心：数据闭环设计

日期：2026-08-07

## 1. 目标

把现有 408 知识树、真题映射、真实考频和 Priority Score 组合成一个可持续更新的学习闭环：

```text
做题 / 学习 / 复习
      ↓
学习事件记录
      ↓
UserKnowledgeMastery
      ↓
Priority Engine
      ↓
DailyRecommendation
      ↓
今日提分中心
      ↓
完成任务 / 再做题
      └──────────────→ 回流
```

第一版成功标准：

1. 用户每完成一道题，相关原子考点的 attempts / accuracy / wrongCount 可增量更新。
2. 每次复习后可更新 lastReviewedAt 与 retention。
3. 系统每天可生成 8–15 个推荐知识点，输出 Priority Score 和可解释原因。
4. 推荐不是单纯按高频排序，而同时考虑用户薄弱度、遗忘、真题价值和距考试天数。
5. 推荐结果可稳定复现、可测试、可人工审计。
6. V1/V2 知识点 ID 保持稳定，不让真题与用户历史因知识树升级而失效。

## 2. 方案选择

### 方案 A：静态 JSON + 前端计算

优点：开发最快，几乎不改后端。

缺点：用户学习状态、错题、复习历史会分散；无法可靠做多人、跨设备、统计和重算。

结论：只适合演示，不作为主方案。

### 方案 B：数据库驱动的学习闭环（推荐）

全局知识数据、用户状态、学习事件和每日推荐拆表。Priority Engine 作为纯函数服务，数据库只负责事实和快照。

优点：可测试、可解释、可增量更新；容易从 MVP 升级到 FSRS、AI 诊断、阶段计划。

缺点：需要一次数据库迁移和 seed。

### 方案 C：事件流 + 特征仓库

将所有学习行为事件化，再通过异步任务构建用户特征。

优点：长期最强。

缺点：当前个人项目复杂度过高，会拖慢上线。

结论：后期用户量和行为量明显增长后再演进。

## 3. 架构边界

### 3.1 全局知识证据层

不包含任何用户字段。

- `KnowledgeNode`
- `KnowledgeRelation`
- `ExamPaper`
- `ExamQuestion`
- `ExamQuestionKnowledgeTag`
- `KnowledgeFrequencySnapshot`

职责：回答“这个知识点在 408 中有多重要、近年怎么考、与哪些考点相关”。

### 3.2 用户学习状态层

只包含某个用户的学习事实和状态。

- `UserKnowledgeMastery`
- `QuestionAttempt`
- `WrongQuestionRecord`
- `ReviewRecord`
- `StudyEvent`

职责：回答“这个用户会不会、最近是否遗忘、错在哪里”。

### 3.3 推荐层

- `DailyRecommendationBatch`
- `DailyRecommendationItem`

职责：把“考试价值”与“用户状态”组合成今天的行动列表。

推荐表保存生成时快照，不直接替代真实用户状态。

## 4. 数据模型

### 4.1 KnowledgeNode

关键字段：

- `id`: 使用现有稳定字符串 ID，例如 `CN-C05-S03-P04`
- `parentId`
- `subject`
- `nodeType`
- `importance`
- `difficulty`
- `syllabusVersion`
- `isActive`

知识树升级采用 append / deprecate，不重写历史 ID。

### 4.2 KnowledgeRelation

关系类型：

- `PREREQUISITE`
- `RELATED`
- `CROSS_SUBJECT`
- `CONFUSED_WITH`
- `SUPERSEDES`

禁止继续把所有关系都塞在 JSON 数组里，数据库关系表更方便查询与版本化。

### 4.3 ExamQuestionKnowledgeTag

字段：

- `questionId`
- `knowledgePointId`
- `role`: `PRIMARY | SECONDARY`
- `confidence`
- `precision`: `EXACT_ATOMIC | BROAD_HISTORICAL`
- `taggedBy`: `AI | HUMAN | HYBRID`

2022–2026 导入为 `EXACT_ATOMIC`。

2009–2021 当前公开历史标签导入为 `BROAD_HISTORICAL`，不能冒充原子级精标。

### 4.4 KnowledgeFrequencySnapshot

每次重新计算保存一份版本化快照，而不是覆盖历史。

字段：

- `knowledgePointId`
- `snapshotDate`
- `recent3Frequency`
- `recent5Frequency`
- `allTimeEvidence`
- `primaryScore5y`
- `trendDirection`
- `trendDelta`
- `evidenceConfidence`
- `modelVersion`

这样后续可以比较“2027大纲后热点是否发生变化”。

### 4.5 UserKnowledgeMastery

一用户 × 一原子考点一行。

字段：

- `mastery` 0–1
- `accuracy` 0–1
- `attempts`
- `correctCount`
- `wrongCount`
- `retention` 0–1
- `stabilityDays`
- `lastLearnedAt`
- `lastReviewedAt`
- `nextReviewAt`
- `confidence`
- `updatedAt`

`mastery` 与 `retention` 分开：掌握度是能力估计，retention 是当前记忆保持率。

### 4.6 QuestionAttempt

保留每次作答事实，不只保存聚合值。

字段：

- `userId`
- `questionId`
- `isCorrect`
- `scoreEarned`
- `durationSeconds`
- `answerConfidence`
- `createdAt`

用户状态可由 attempts 重算，避免聚合字段出错后无源数据恢复。

### 4.7 WrongQuestionRecord

记录错误原因与是否真正解决。

错误类型：

- `CONCEPT`
- `CALCULATION`
- `MEMORY`
- `READING`
- `CARELESS`
- `UNKNOWN`

`resolved=true` 不删除历史错误，只表示当前已解决。

### 4.8 ReviewRecord

字段：

- `knowledgePointId`
- `reviewType`
- `quality` 0–5
- `durationSeconds`
- `beforeRetention`
- `afterRetention`
- `reviewedAt`

后续接 FSRS 时这一表直接作为输入。

## 5. Priority Score V1.1

Priority 不保存为用户知识状态，它是“某日、某上下文”下的派生结果。

### 5.1 组成

```text
ExamValue      37%
Weakness       32%
Forgetting     16%
Difficulty      7%
Trend           5%
Pinned          3%
```

### 5.2 ExamValue

```text
Recent 3Y        38%
Recent 5Y        30%
All Time         16%
Importance       10%
5Y Primary Score  6%
```

### 5.3 Weakness

```text
1 - mastery      52%
1 - accuracy     38%
wrongCount       10%
```

### 5.4 距离考试的动态权重

- `>150天`：基础阶段，提高难度与长期建设价值。
- `46–150天`：强化阶段，考试价值和薄弱度平衡。
- `<=45天`：冲刺阶段，提高 Recent3Y、Recent5Y 和薄弱度，压低高难低频内容。

### 5.5 防止推荐失真

Priority Engine 需增加四条约束：

1. **Prerequisite gate**：前置知识 mastery < 0.45 时，不直接推荐依赖它的高难综合点，先推荐前置。
2. **Subject quota**：默认一天至少覆盖 2 科，避免 Top 12 全被同一科占满。
3. **Novelty cap**：基础阶段每日新学原子点不超过计划的 40%，其余用于练习/复习。
4. **Cooldown**：刚高质量复习且 retention 高的点 24–48 小时内降权，除非持续错题。

## 6. 今日提分计划生成

Priority 排名后不能直接取 Top 12，需要二次编排。

### 6.1 Action 类型

- `LEARN`：mastery 低，且前置满足。
- `REVIEW`：遗忘紧迫度高。
- `PRACTICE`：掌握度中等，但正确率不足。
- `WRONG_QUESTION`：最近同考点反复出错。
- `MOCK`：冲刺阶段、多个知识点已成熟时使用。

### 6.2 时间预算

用户可提供 `availableMinutes`。

没有设置时默认生成 120 分钟计划，但 UI 必须允许一键调整为 30/60/120/180 分钟。

单个原子考点建议：

- 基础概念：10–20 分钟
- 计算/算法类：20–35 分钟
- 综合难点：25–45 分钟

### 6.3 推荐原因

每个推荐至少输出 2 个 reason code，不让 AI 自由编造原因。

例如：

- `HIGH_RECENT_FREQUENCY`
- `LOW_MASTERY`
- `LOW_ACCURACY`
- `REPEATED_WRONG`
- `REVIEW_DUE`
- `RISING_TREND`
- `PREREQUISITE_GAP`
- `EXAM_NEAR`

前端再把 reason code 翻译成人类可读文案。

## 7. API 设计

### GET `/api/knowledge/:id`

返回知识点详情、频率快照、关系和用户状态。

### POST `/api/questions/:id/attempts`

提交一次作答，事务内：

1. 写入 `QuestionAttempt`
2. 更新相关 knowledge mastery
3. 更新/创建错题记录
4. 标记今日推荐项状态

### POST `/api/reviews`

写 ReviewRecord，更新 retention / lastReviewedAt / nextReviewAt。

### POST `/api/recommendations/generate`

输入：

- targetExamDate
- availableMinutes
- optional subject constraints

输出：DailyRecommendationBatch。

### GET `/api/recommendations/today`

返回今天已经生成的计划；默认不重复生成，除非显式 `refresh=true`。

## 8. 前端：首页“今日提分中心”

页面优先级：行动 > 解释 > 数据详情。

第一屏：

- 今日建议总时长
- 预计提分价值
- 今日完成度
- Top 3 高优先任务

任务卡：

- 科目 / 原子考点
- Priority Score
- 推荐动作
- 建议分钟数
- 2–3 个原因标签
- 最近正确率 / retention
- 一键“开始练习”

第二屏：

- 今日完整 8–15 项列表
- 可按科目筛选
- 可拖动顺序，但拖动不修改系统原始 score

第三屏：

- “为什么推荐我学这个”解释抽屉
- Recent3Y / Recent5Y / AllTime
- 用户 mastery / accuracy / forgetting
- prerequisite 状态

## 9. 状态更新策略

MVP 不直接上复杂 BKT/IRT。

### 作答后 mastery 增量

- 正确且中高难度：上调
- 错误且低难度：明显下调
- 错误且高难度：温和下调
- secondary 知识点更新幅度低于 primary

所有更新使用指数平滑，避免一道题把 mastery 从 0.8 打到 0.3。

### accuracy

保留累计正确率，同时维护最近窗口 `recentAccuracy`，Priority 优先使用最近窗口。

### retention

第一版：按 lastReviewedAt + stabilityDays 做指数衰减。

第二版：替换为 FSRS，API 与数据结构不变。

## 10. 错误处理

- 知识点不存在：拒绝写入 attempt/review，不自动创建幽灵节点。
- 真题标签引用无效：seed 阶段失败，而不是跳过。
- Priority evidence 缺失：允许冷启动，标记 `LOW_EVIDENCE`。
- 用户状态缺失：使用中性默认值，不把“没有数据”当作“掌握差”。
- 历史 broad tag：只能进入 AllTimeEvidence，不进入 recent exact primary score。
- 推荐生成失败：返回上一次有效 recommendation batch，并标记 stale。

## 11. 测试策略

### 单元测试

Priority Engine 必须覆盖：

1. mastery 越低，其他条件相同 Priority 不应下降。
2. retention 越低，Priority 不应下降。
3. 临近考试时 Recent3Y 高频点相对排名应提高。
4. 低频高难点在冲刺期不应压过高频薄弱点。
5. prerequisite 不满足时，高阶点应被降级或转换为前置任务。
6. 所有 score 必须位于 0–100。

### 数据完整性测试

- 所有 `parentId` 可解析。
- 所有精确真题标签指向 atomicPoint。
- 每年 408 分科分值为 DS45 / CO45 / OS35 / CN25。
- RecommendationItem 所引用知识点不能是 deprecated。

### API 集成测试

- 提交正确答案后 attempts + mastery 同事务更新。
- 错题重复发生时 wrongCount 累增，不重复制造多条 active wrong record。
- 同一天重复获取 plan 不产生重复 batch。

## 12. 实现顺序

1. Prisma Schema + migration
2. V2 seed / integrity check
3. Frequency snapshot seed
4. User mastery / attempt / wrong / review repository
5. Priority Engine V1.1 + 单元测试
6. Daily plan composer + 约束测试
7. API routes
8. 今日提分中心 UI
9. 端到端闭环测试
10. 再继续 2009–2021 原子级精标，提高 AllTime 精度

## 13. 暂不做

第一版明确不做：

- 大模型自由生成 Priority 分数
- 实时 Kafka/消息队列
- 复杂 IRT / BKT
- 社交排名
- 全自动生成练习题
- 复杂多目标优化器

这些都不阻塞“今天最应该学什么”的核心价值。
