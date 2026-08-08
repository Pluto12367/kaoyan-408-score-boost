# Live Question → Atomic KnowledgeNode Bridge Design

日期：2026-08-08

状态：设计已确认，等待 review；尚未开始 implementation plan 或代码实现。

## Context

408 Knowledge Catalog V1 已完成、生产环境已部署并人工验收通过。

Score Center 只读审计确认当前实际链路：

```text
PracticeRecord / Review
  ↓
UserKnowledgeMastery
  ↓
Priority Score
  ↓
StudyPlan(source='score-center') / StudyTask
  ↓
GET /today/plan
  ↓
TodaysScoreCenter UI
```

代码链路和测试基本完整。当前唯一 P0 阻塞：

```text
live Question
→ atomic KnowledgeNode
```

生产桥接数据为空：

```text
KnowledgePointNodeMap = empty
QuestionKnowledgeNodeTag = empty
```

因此当前 fallback：

```text
Question
→ QuestionKnowledgePoint
→ KnowledgePoint
→ KnowledgePointNodeMap
```

返回空数组，最终：

```text
PracticeRecord
→ applyAttempts
→ resolveKnowledgeNodesForQuestion
→ []
→ UserKnowledgeMastery 不写入
```

生产环境 `UserKnowledgeMastery: 0` 不能简单归因于“没有用户行为”，根因是桥接数据缺失。

## Problem

现有题库的 live Question 通过 `QuestionKnowledgePoint` 关联旧 `KnowledgePoint` 体系，但旧 `KnowledgePoint` 与 V2 原子 `KnowledgeNode` 之间没有可用的桥接数据。即使真实用户作答，`applyAttempts` 也无法把作答事实映射到原子知识点，导致 `UserKnowledgeMastery` 永远不会产生或更新，整条提分闭环在生产环境处于空转状态。

需要为现有 live Question 建立安全、确定性、可审计的

```text
KnowledgePoint → Atomic KnowledgeNode
```

桥接，使真实 `PracticeRecord` 可以开始可靠更新 `UserKnowledgeMastery`。

## Goals

1. 为现有 live Question 建立 `KnowledgePoint → Atomic KnowledgeNode` 桥接，作为主桥接层。
2. 桥接数据必须确定性生成、可测试、可复现、可解释。
3. 每个桥接记录携带最小可审计元数据：`confidence`、`source`、`matchMethod`、`status`。
4. resolver 只消费 `ACTIVE` 映射；`PENDING_REVIEW / REJECTED / INACTIVE` 绝不参与 mastery。
5. seed 幂等且尊重人工事实：`MANUAL` 不被 AUTO 覆盖，`REJECTED` 不被 AUTO 复活。
6. 每次 matcher/seed 产出机器可读审计报告，含覆盖率指标。
7. 第一版上线观察目标：Live Question resolvable coverage ≥ 70%（不得通过放宽匹配标准达成）。
8. 使用真实题库 Question 完成 PostgreSQL E2E 验收：作答 → `UserKnowledgeMastery` 实际写入。

## Non-Goals

本设计明确排除：

- Priority Engine 调整。
- retention 时间衰减接入（`estimateRetention` 接线）。
- Review transaction 一致性重构。
- `/today/plan` 主源调整。
- Score Center UI 修改。
- Knowledge Catalog UI 修改。
- 题干 NLP 自动精标。
- LLM 自动 mapping。
- Embedding / similarity threshold 自动 mapping。
- 根据 `KnowledgePointNodeMap` 自动派生大量 `QuestionKnowledgeNodeTag`。
- 自动生成全部 `QuestionKnowledgeNodeTag`。
- 使用 `ExamQuestionKnowledgeTag` 反推 live Question mapping。
- 无关代码重构。

`QuestionKnowledgeNodeTag` 保留为未来人工精标/题目级高质量事实使用；本阶段不自动写入。

## Existing Architecture

### 数据模型（当前真实状态）

- `Question`：live 题库题目，ID 为 cuid，与真题 `ExamQuestion`（ID 如 `2022-1`）是两套体系。
- `QuestionKnowledgePoint`：live Question ↔ 旧 KnowledgePoint 的多对多。
- `KnowledgePoint`：旧知识点（subject / chapter / title）。
- `KnowledgePointNodeMap`：旧 KnowledgePoint ↔ 原子 KnowledgeNode 的桥接表，当前为空。
  - 唯一键：`@@id([knowledgePointId, knowledgeNodeId])`，已允许 1:N。
  - 字段：`mappingType String @default("PRIMARY")`、`confidence Float?`、`taggedBy ExamTagger @default(HYBRID)`。
  - 字段语义：现有 `mappingType` 的默认值 `PRIMARY` 与 `ExamTagRole`（PRIMARY/SECONDARY）命名一致，属**角色语义保留字段**（mastery 权重 PRIMARY α=0.18 / SECONDARY α=0.07 依赖 resolver 返回的 role）。当前全仓无任何代码读取 `mappingType`，但不得将其 repurpose 为 matcher provenance；provenance 使用独立新字段 `matchMethod`。
- `QuestionKnowledgeNodeTag`：live Question ↔ KnowledgeNode 的题目级标签，当前为空，本阶段不自动生成。
- `UserKnowledgeMastery`：用户 × 原子节点掌握度，当前 0 行。

### Resolver（当前实现）

`apps/api/src/score-center/repository.ts` 的 `resolveKnowledgeNodesForQuestion`：

```text
QuestionKnowledgeNodeTag 优先
→ 否则 QuestionKnowledgePoint → KnowledgePoint → KnowledgePointNodeMap
```

当前读取全部 `KnowledgePointNodeMap`，未过滤 `status`；加入 `status` 后必须改为只读 `ACTIVE`。

### 写路径（当前实现）

`applyAttempts`（作答，同事务）与 `applyReview`（复习，独立事务）通过 `resolveKnowledgeNodesForQuestion` 解析节点后调用 `saveMastery`。桥接为空时解析返回空数组并静默跳过。

## Target Architecture

第一阶段目标架构：

```text
Question
   │
   ├─ QuestionKnowledgeNodeTag
   │    └─ 已有人工/精确题目级标签时优先（本阶段不自动生成）
   │
   └─ fallback
        ↓
QuestionKnowledgePoint
        ↓
KnowledgePoint
        ↓
KnowledgePointNodeMap
        ↓
Atomic KnowledgeNode
```

本阶段 `KnowledgePointNodeMap` 是主桥接层。resolver 保持“题目级标签优先 → 桥接表 fallback”的顺序，并新增 `status = ACTIVE` 强制过滤。

数据流：

```text
live Question
→ QuestionKnowledgePoint
→ KnowledgePoint
→ ACTIVE KnowledgePointNodeMap
→ Atomic KnowledgeNode
→ UserKnowledgeMastery（PracticeRecord 作答后同事务写入）
```

## KnowledgePointNodeMap Metadata

为桥接记录增加最小可审计元数据：

### confidence

```text
HIGH
MEDIUM
```

`LOW` 不入库，只进入 audit。

### source

```text
AUTO
MANUAL
```

### matchMethod

```text
EXACT_NAME
NORMALIZED_NAME
CONTEXT_MATCH
MANUAL
```

`matchMethod` 是 matcher provenance 的独立字段（`BridgeMatchMethod` 枚举），与现有 `mappingType String @default("PRIMARY")` 完全分离：

- 现有 `mappingType` 保留原语义（角色语义保留字段，当前无业务消费者），不 repurpose、不做类型转换。
- mastery 的 PRIMARY / SECONDARY 权重来自 `resolveKnowledgeNodesForQuestion` 返回的 role：direct 路径读 `QuestionKnowledgeNodeTag.role`，fallback 路径当前硬编码 `PRIMARY`；两者都不读 `mappingType`。
- 新代码一律写 `matchMethod`，禁止同时维护两个语义不清的 type 字段。

### status

```text
ACTIVE
PENDING_REVIEW
REJECTED
INACTIVE
```

语义：

- `ACTIVE`：可进入 `UserKnowledgeMastery`。
- `PENDING_REVIEW`：存在合理候选但需人工确认；不参与 mastery。
- `REJECTED`：人工确认错误；自动 seed 永远不得重新激活。
- `INACTIVE`：历史 AUTO mapping 被新规则淘汰；保留审计历史；不参与 mastery。

## Mapping State Machine

状态转移固定为：

```text
MANUAL
→ ACTIVE

AUTO + HIGH
→ ACTIVE

AUTO + MEDIUM
→ PENDING_REVIEW

LOW
→ 不落库，只进入 audit
```

允许的显式人工迁移：

```text
ACTIVE → REJECTED       （人工确认错误）
PENDING_REVIEW → ACTIVE （人工确认正确）
PENDING_REVIEW → REJECTED
ACTIVE → INACTIVE       （人工停用）
REJECTED → ACTIVE       （仅人工显式操作）
INACTIVE → ACTIVE       （仅人工显式操作）
```

自动 seed 只允许：

```text
无记录 → ACTIVE / PENDING_REVIEW
ACTIVE → INACTIVE        （AUTO reconciliation 淘汰）
PENDING_REVIEW → ACTIVE / PENDING_REVIEW（重新匹配结果不变或升级）
```

mastery 只允许以下组合参与：

```text
MANUAL + ACTIVE
AUTO + HIGH + ACTIVE
```

`MEDIUM` 即使已经写进数据库，也绝对不能进入真实用户 mastery。resolver 的 `status = ACTIVE` 过滤是第二道强制防线；`applyAttempts` 不得在过滤之外另作置信度判断。

## Deterministic Matching Pipeline

匹配对象：`KnowledgePoint → KnowledgeNode`，不直接处理 Question。

第一版 matcher 必须 deterministic、testable、reproducible、explainable。禁止：

- LLM 自动决定 HIGH。
- Embedding 自动决定 HIGH。
- similarity threshold 直接变 ACTIVE。
- 为了覆盖率降低 HIGH 标准。

AI 后续最多用于 `PENDING_REVIEW` 人工审核辅助，不能成为生产 mastery 的事实来源。

### 候选集收窄

按固定层级收窄候选：

```text
subject
→ chapter
→ section（如果可用）
```

禁止跨科目匹配。结构上下文冲突时不能成为 HIGH。

### 名称标准化

独立纯函数：

```text
normalizeKnowledgeName(name)
```

仅允许确定性标准化：

- trim
- 大小写
- 全角/半角
- 连续空格折叠
- 中文/英文标点归一
- 括号形式归一（全角/半角、成对括号）
- 常见连接符归一

不做语义猜测、不做同义词推断。

### 匹配优先级

按固定顺序执行：

#### Rule 1 — EXACT_NAME

条件：

```text
subject 一致
原始名称完全一致
候选唯一
```

结果：

```text
HIGH + EXACT_NAME + ACTIVE
```

#### Rule 2 — NORMALIZED_NAME

条件：

```text
subject 一致
normalize(oldName) === normalize(nodeName)
候选唯一
chapter / section 无冲突
```

结果：

```text
HIGH + NORMALIZED_NAME + ACTIVE
```

#### Rule 3 — Alias + Context（CONTEXT_MATCH）

条件（全部满足）：

```text
名称存在显式配置的确定性别名关系
结构上下文一致
候选唯一
```

结果：

```text
HIGH + CONTEXT_MATCH + ACTIVE
```

Alias 必须显式配置；matcher 禁止自行“理解语义”。

### HIGH / MEDIUM / LOW 定义

- `HIGH`：唯一候选 AND 名称存在确定性关系 AND 上下文无冲突。
- `MEDIUM`：存在合理候选，但存在粒度、歧义、1:N 或名称表述不确定性 → `PENDING_REVIEW`。
- `LOW`：无法通过确定性证据证明 → 不入库，只进入 audit。

### 字符串相似度边界

可以计算 similarity，但只能用于：

- 候选排序
- audit 展示
- 人工审核辅助

不能直接 `similarity > threshold → HIGH`。即使 similarity 很高，只要候选不唯一或上下文存在歧义，也必须保持 `MEDIUM`。

## Confidence Rules

规则固定：

```text
MANUAL
→ ACTIVE

AUTO + HIGH
→ ACTIVE

AUTO + MEDIUM
→ PENDING_REVIEW

LOW
→ 不落库，只进入 audit
```

mastery 只允许：

```text
MANUAL + ACTIVE
HIGH AUTO + ACTIVE
```

参与。`MEDIUM` 绝不参与 mastery，即使已存在于数据库。

## 1:N Mapping Rules

`KnowledgePoint → 多个 Atomic KnowledgeNode` 允许，但有严格边界：

### 唯一确定的 1:1

```text
HIGH + ACTIVE
```

### 确定性、可证明的 1:N

只有能证明旧知识点确实等于该原子点集合时：

```text
全部 HIGH + ACTIVE
```

### 无法确认实际覆盖哪些原子点的 1:N

```text
MEDIUM + PENDING_REVIEW
```

禁止：

```text
宽泛 KnowledgePoint
→ 整个章节所有 Atomic Nodes
```

1:N 的判定必须有可复现的确定性证据（名称集合、结构上下文、显式 alias/组合规则），并写入 reasons 供审计。

## Alias Strategy

维护少量显式 alias dictionary（例如 `data/408/...` 下的可审计配置文件或代码内常量表）。

约束：

- 每个 alias 必须显式声明，带出处或理由注释。
- alias 只用于 `CONTEXT_MATCH`，且必须满足“结构上下文一致 + 候选唯一”。
- alias 字典变更属于数据变更，需走 review，禁止 matcher 运行时自行增删。
- alias 不用于跨科目匹配。

## Resolver Rules

生产 resolver 不得读取全部 `KnowledgePointNodeMap`：

```text
QuestionKnowledgeNodeTag
→ 如果存在有效题目级 mapping，优先

否则：

KnowledgePoint
→ KnowledgePointNodeMap
WHERE status = ACTIVE
→ KnowledgeNode
```

必须通过测试保证：

```text
PENDING_REVIEW
REJECTED
INACTIVE
```

不会参与 mastery。

另外：

- resolver 只针对 live `Question` 工作；`ExamQuestion` 的标签（`ExamQuestionKnowledgeTag`）不进入此路径。
- 解析结果为空时 `applyAttempts` 静默跳过（现状），但 audit 会统计 unresolvable 覆盖，驱动人工补充。

## Idempotent Seed Strategy

自动 seed 禁止 `DELETE ALL → rebuild`，必须支持长期人工标注存在。

每次 seed 流程：

```text
1. 读取现有 mapping
2. 建立 MANUAL protection set
3. 建立 REJECTED protection set
4. 运行 deterministic matcher
5. 计算 desired AUTO state
6. upsert AUTO（新行 / 状态迁移）
7. reconciliation 淘汰 stale AUTO（ACTIVE → INACTIVE）
8. MANUAL / REJECTED 不允许被自动修改
```

原则：

```text
MANUAL > AUTO
REJECTED > AUTO
```

seed 连续运行两次结果必须一致（幂等回归测试）。

## Manual / Rejected Protection

- `MANUAL` 行：任何 AUTO matcher 结果都不得修改其 `knowledgeNodeId / status / confidence / matchMethod / source / mappingType`。AUTO seed 只能跳过。
- `REJECTED` 行：AUTO seed 不得重新激活（不得改为 ACTIVE/PENDING_REVIEW）。若 matcher 再次产出同一候选，只能保留 REJECTED 并在 audit 中记录“rejected candidate revisited”。
- 人工显式操作（改 ACTIVE/REJECTED/INACTIVE）通过独立管理脚本或未来管理入口执行，与 AUTO seed 分离。

## AUTO Reconciliation

例如旧版本：

```text
KP-A → Node-X
AUTO HIGH ACTIVE
```

新 matcher 结果：

```text
KP-A → Node-Y
```

则：

```text
Node-Y → ACTIVE
Node-X → INACTIVE
```

不得删除历史 AUTO mapping（保留审计历史）。

边界：

- 如果 Node-X 是 `MANUAL`：完全禁止自动修改。
- 如果 Node-X 已是 `REJECTED`：AUTO 不能重新激活。
- 如果 Node-X 是 `PENDING_REVIEW` 且新 matcher 产出更确定的同候选：可升级 ACTIVE（仍属 AUTO 流程）；产出不同候选时保留原 PENDING_REVIEW 并新增候选行（不覆盖）。

## Audit Report

每次 matcher/seed 必须产出机器可读审计报告，建议路径：

```text
data/408/knowledge-catalog/question-node-bridge-audit.json
```

### summary

```text
knowledgePointTotal
activeKnowledgePoints
pendingKnowledgePoints
unmatchedKnowledgePoints
activeCoverage

liveQuestionTotal
resolvableQuestions
questionResolvableCoverage
```

### 分类

```text
ACTIVE
PENDING_REVIEW
UNMATCHED
conflicts
oneToMany
```

### 每项至少包含

```text
knowledgePointId
knowledgePointName
subject
chapter
section
decision
confidence
matchMethod
candidateNodes
selectedNodes
reasons
affectedQuestionCount
```

审计报告同时记录：

- LOW 候选（不入库项）与其 similarity 排序值（仅供人工审核辅助）。
- REJECTED candidate revisited 事件。
- MANUAL 保护跳过事件。

## Coverage Metrics

至少两个指标：

### KnowledgePoint ACTIVE Coverage

```text
ACTIVE KnowledgePoints
/
All KnowledgePoints
```

### Live Question Resolvable Coverage（本 Task 最重要指标）

```text
能通过 ACTIVE mapping 解析出 ≥1 Atomic Node 的有效 live Questions
/
全部有效 live Questions
```

两个指标都必须在 audit 报告中可复现计算，并有测试锁定计算口径。

## Hotspot Review Strategy

覆盖率不足时禁止降低 HIGH 标准。

处理方式：

```text
审计 high-impact unmatched / pending
→ 按 affectedQuestionCount DESC 排序
→ 增加确定性 alias 或 MANUAL mapping
→ rerun matcher + seed
```

优先级：

```text
PENDING_REVIEW、UNMATCHED 均按 affectedQuestionCount DESC 处理
```

目标：用最少人工审核，提高最多 Question resolvable coverage。

## PostgreSQL E2E Verification

不能继续只用自建测试 bridge 行证明链路。

必须至少选择一条**真实现有题库 Question**：

```text
Question
→ QuestionKnowledgePoint
→ KnowledgePoint
→ ACTIVE KnowledgePointNodeMap
→ Atomic KnowledgeNode
```

### 错误作答验证

提交错误作答后验证：

```text
PracticeRecord written
UserKnowledgeMastery created/updated
attemptCount +1
incorrectCount +1
masteryScore correctly updated
```

### 正确作答验证

随后正确作答：

```text
correctCount +1
recentAccuracy updated
masteryScore correctly updated
```

### 多知识点题验证

至少验证一个真实多知识点 Question：

```text
Question
→ multiple KnowledgePoints / Atomic Nodes
```

一次 `PracticeRecord` 必须产生多个 `UserKnowledgeMastery` 更新，并保持 PRIMARY / SECONDARY 权重语义不被破坏。

### PENDING_REVIEW 安全验证

构造 `KnowledgePointNodeMap.status = PENDING_REVIEW`：

```text
作答后 PracticeRecord 正常写入
对应 UserKnowledgeMastery 不得产生
```

这是防止 MEDIUM 污染用户画像的强制回归测试。

### MANUAL / REJECTED 保护验证

- `MANUAL + ACTIVE`：即使 matcher 得到另一个节点，seed 不得修改人工事实。
- `REJECTED`：后续 AUTO seed 不得重新 ACTIVE。

## Testing Strategy

### 纯函数单测（matcher）

- `normalizeKnowledgeName` 的确定性输入输出。
- Rule 1/2/3 各自命中/未命中/歧义分支。
- 候选不唯一时强制 MEDIUM。
- 结构上下文冲突时不得 HIGH。
- 跨科目禁止匹配。
- LOW 不入库、只进 audit。
- 1:N 可证明集合为 HIGH，不可证明为 MEDIUM。
- alias 字典缺失/冲突时失败或显式降级。

### Seed 幂等测试

- 连续运行两次结果一致。
- MANUAL 不被 AUTO 覆盖。
- REJECTED 不被 AUTO 激活。
- AUTO reconciliation：Node-X → INACTIVE，Node-Y → ACTIVE，历史行保留。

### Resolver 安全测试

- `PENDING_REVIEW / REJECTED / INACTIVE` 不参与 mastery。
- 题目级 `QuestionKnowledgeNodeTag` 优先于桥接 fallback。

### 数据完整性测试

- 所有 ACTIVE mapping 引用存在的、`isActive` 的 KnowledgeNode。
- 无跨科目映射。
- 无整章节批量映射。
- audit 指标可复现。

### 回归测试

- 原有 Score Center 测试无回归（priority / mastery / plan / data / UI）。
- 原有 Knowledge Catalog 测试无回归。

## Migration Safety

当前 `KnowledgePointNodeMap` 约束：

```text
@@id([knowledgePointId, knowledgeNodeId])
```

已允许 `KnowledgePoint → N KnowledgeNodes`，无需改变唯一键语义。

需要的 schema 变更（additive）：

1. 新增 `status`（`ACTIVE | PENDING_REVIEW | REJECTED | INACTIVE`）——无 Prisma 默认值；migration 先加 nullable，backfill 后置 NOT NULL。
2. 新增 `source`（`AUTO | MANUAL`）——无 Prisma 默认值；backfill 后置 NOT NULL。
3. 新增 `confidenceLevel`（`HIGH | MEDIUM`）承载受控语义；现有 `confidence Float?` 保留为历史审计值（不删除）。
4. 新增 `matchMethod`（`BridgeMatchMethod`：`EXACT_NAME | NORMALIZED_NAME | CONTEXT_MATCH | MANUAL`）——无 Prisma 默认值；backfill 后置 NOT NULL。
5. 现有 `mappingType String @default("PRIMARY")` 保留不动（角色语义保留字段；不 repurpose、不转换类型）。
6. 如引入新枚举，使用 additive migration 创建，不重建表。

约束：

- 不删除列、不改唯一键、不破坏已有人工数据。
- 生产当前该表为空，backfill 压力为零；迁移仍按 additive 设计以兼容未来数据。
- 索引建议：`@@index([knowledgePointId, status])` 与 `@@index([knowledgeNodeId, status])`，属于 additive。
- `QuestionKnowledgeNodeTag` 本阶段不新增自动写入路径，不改其 schema。

## Rollout

1. 实现 matcher 纯函数 + 单测（不含 DB 写入）。
2. 实现 audit 计算（dry-run，不写库）。
3. 跑 dry-run，人工抽查 HIGH 样本；确认 0 known incorrect ACTIVE。
4. 实现幂等 seed（含 MANUAL/REJECTED protection 与 reconciliation）。
5. 测试库执行 seed 两次验证幂等；运行 resolver 安全测试。
6. 真实题库 PostgreSQL E2E（错误/正确/多知识点/PENDING_REVIEW 安全）。
7. 全量回归（npm test + build）。
8. 生产上线（真实 deploy.sh 顺序）：backup → `docker compose up -d --build --wait`（**容器替换发生于此**，新 app 容器 CMD 内执行 `prisma migrate deploy` 再启动 API）→ gateway health → `seed-408-v2.mjs`（evidence seed + bridge dry-run + bridge seed）。migration 随容器替换生效；bridge 写入发生在 seed 阶段。
9. Bridge Rollout Gate（本设计采用 **Bridge Persistence Gate，非 Release Gate**）：应用版本允许正常部署；seed 阶段先运行 bridge dry-run 审计：
   - `questionResolvableCoverage >= 0.70` → 执行 AUTO bridge seed。
   - `< 0.70` → **不写入任何 AUTO bridge mapping**，`UserKnowledgeMastery` bridge 保持未启用，seed 打印并记录 `BRIDGE ROLLOUT BLOCKED`（deploy 正常结束，应用可用）。
   - 禁止为达标降低 HIGH 标准、将 MEDIUM 改为 ACTIVE、或调用 LLM 猜 mapping。
10. bridge BLOCKED 时按 hotspot review 流程人工补充 alias / MANUAL mapping，rerun dry-run 后再评估。
11. bridge 启用后观察 `UserKnowledgeMastery` 开始随真实作答增长，并运行 audit 确认覆盖率。

## Acceptance Criteria

Task 完成必须同时满足：

```text
1. matcher deterministic
2. matcher 有纯函数单测
3. seed 幂等
4. seed 连续跑两次结果一致
5. MANUAL 不被 AUTO 覆盖
6. REJECTED 不被 AUTO 激活
7. LOW 不入库
8. MEDIUM 不参与 mastery
9. resolver 只消费 ACTIVE
10. audit report 完整
11. Live Question resolvable coverage 可测
12. 不通过降低 HIGH 标准追覆盖率
13. PostgreSQL 真实 Question → Mastery E2E 通过
14. 多知识点题 E2E 通过
15. 原有 Score Center 测试无回归
16. 原有 Knowledge Catalog 测试无回归
17. 覆盖率 < 70% 时 AUTO bridge seed 不写入生产（Bridge Rollout Gate）
```

成功定义：

```text
0 known incorrect ACTIVE mappings

+
Live Question resolvable coverage >= 70%

+
Production-equivalent
PracticeRecord → UserKnowledgeMastery
真实链路开始工作
```

## Risks

- 映射质量：旧 KnowledgePoint 标题与 V2 原子点名称非一一对应（名称漂移、1:N 粒度差异），自动匹配可能产生错误映射。缓解：HIGH 必须满足唯一候选 + 确定性关系 + 上下文无冲突；MEDIUM 强制 PENDING_REVIEW；audit 提供 affectedQuestionCount 排序的人工审核队列。
- 覆盖率不足：可能得到 68% 而非 70%。缓解：按 hotspot review 增加确定性 alias / MANUAL mapping 后 rerun，不降低 HIGH 标准。
- 人工数据保护：AUTO seed 覆盖 MANUAL 或激活 REJECTED 会造成不可逆污染。缓解：protection set + 强制回归测试 + audit 记录跳过事件。
- 历史映射膨胀：AUTO reconciliation 只做 INACTIVE 淘汰、不删除，表行数可控但仍需审计报告跟踪。
- ExamQuestion / Question 混用：两套 ID 与语义必须继续分离，测试中显式断言互不引用。
- 上线影响：resolver 增加 `status = ACTIVE` 过滤属于行为变更，必须先通过回归测试；上线顺序先 dry-run 审计再写库，避免一次性错误批量落库。
