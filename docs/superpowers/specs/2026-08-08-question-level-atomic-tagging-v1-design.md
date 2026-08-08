# Question-Level Atomic Tagging V1 — Design Spec

日期：2026-08-08

状态：正式设计文档；尚未创建 Implementation Plan，未开始实现。

## 1. Context

本项目已完成并上线 408 Knowledge Catalog V1，并持续推进 Score Center 学习闭环。为让真实 `PracticeRecord → UserKnowledgeMastery` 生效，需要把 live Question 精确归因到原子 `KnowledgeNode`。多轮只读生产审计（Task 3 / 3.5 / 3.6 / 3.6.5）已给出真实数据，本设计据此确定“题目级原子标注”为 mastery 主精确映射来源。

本设计不覆盖、不删除既有 `KnowledgePointNodeMap` bridge 工作（Task 1–3）；只调整其架构角色为安全 fallback。

## 2. Problem Statement

### 生产真实数据

```text
Question rows: 332
current: 328
non-current: 4

current unique tagging units: 326
exact duplicate copies: 2

KnowledgePoint: 18（其中 16 个被题目引用）
production KnowledgePoint bridge ACTIVE: 0

Task 3 production bridge:
ACTIVE KP = 0
PENDING_REVIEW = 14
UNMATCHED = 4
Question resolvable coverage = 0%

Task 3.6:
READY = 0
REVIEWABLE = 0
BROAD = 242
INSUFFICIENT = 90

candidateCount buckets:
0    = 90
>15  = 242
```

### 核心问题

生产旧 KnowledgePoint 是粗粒度章节/主题标签，不足以安全归因到 Atomic KnowledgeNode：

- 一个粗 KP 对应一个 V2 章节内 35–98 个原子点（章节上下文收窄得到整章候选集）。
- 一道题通常只考查其中 1–3 个原子点；若用 `QuestionKnowledgePoint → KnowledgePoint → KnowledgePointNodeMap` fallback 让同 KP 下所有题影响整组节点，会导致 mastery 系统性污染（把“与题目无关”的节点也更新）。
- 4 个 KP（co-cache / co-data / ds-sort / os-file）因旧章节名与 V2 章节名不一致，直接得到 0 候选（90 题）。

结论：`KnowledgePointNodeMap` 不能作为 mastery 主桥接；需要题目级、经人工确认的精确标注。

## 3. Architectural Decision

正式锁定：

```text
QuestionKnowledgeNodeTag → production mastery 的主要精确 bridge
KnowledgePointNodeMap    → 安全 fallback
```

Resolver 最终语义保持不变：

```text
direct QuestionKnowledgeNodeTag
        ↓
如果不存在
        ↓
ACTIVE KnowledgePointNodeMap fallback
```

`KnowledgePoint` fallback 不再追求 70% coverage。新的主要 rollout 指标：

```text
Live Question Atomic Resolvable Coverage
```

替代：

```text
KnowledgePoint ACTIVE coverage
```

作为主指标。

## 4. Runtime Boundary

目标生产服务器：2 CPU / 2 GB RAM。

Production 禁止运行：

```text
Embedding inference
local LLM
vector database
bulk annotation
review UI
annotation workspace
```

Production 只负责：

```text
Question
QuestionKnowledgeNodeTag
KnowledgeNode
PracticeRecord
UserKnowledgeMastery
```

## 5. Offline Annotation Architecture

```text
Production PostgreSQL
        ↓
read-only snapshot export
        ↓
Windows developer machine
        ↓
Local Annotation Workspace
        ↓
Hybrid Retrieval
        ↓
Cloud AI Suggestion
        ↓
Local Review UI
        ↓
REVIEWED dataset
        ↓
validated export
        ↓
future production seed
```

所有未审核 AI 数据必须留在本地，禁止进入生产。

## 6. Repository Boundary

Annotation Tool 位于：

```text
tools/question-annotation/
```

不放入 `apps/web` / `apps/api` production 请求路径。

建议职责层级（**proposed structure，当前不存在**，Implementation Plan 阶段再定稿）：

```text
tools/question-annotation/
├─ core/
│  ├─ retrieval/
│  ├─ embedding/
│  ├─ annotation-model/
│  └─ validation/
├─ snapshot/
├─ workspace/
├─ review-api/
├─ review-ui/
└─ local-data/
```

## 7. Local Workspace

正式锁定：SQLite + lightweight SQLite driver。

禁止：

```text
production Prisma schema
第二套 Prisma
production PostgreSQL
```

Annotation SQLite 与 production database 物理/逻辑隔离。

Workspace 必须能保存（行为与不变量锁定，不在此锁死所有列名）：

```text
question
snapshot identity
retrieval candidates
retrieval version
embedding provider/model version
AI provider/model version
AI suggestion
review status
reviewed PRIMARY
reviewed SECONDARY
review reason
timestamps
```

## 8. Snapshot Design

生产只读导出全部 332 条 Question，保留版本/重复关系。

每题 annotation role：

```text
INDEPENDENT_UNIT        （326）
EXACT_DUPLICATE_COPY    （2）
HISTORICAL_ONLY         （4）
```

Snapshot 必须带：

```text
snapshotId
schemaVersion
generatedAt
sourceCommit
counts
contentSha256
```

以及标注需要的数据：

```text
Question content
Question ↔ KnowledgePoint
KnowledgePoint metadata
active atomic KnowledgeNodes
chapter / section hierarchy
duplicate representative relation
family/version metadata
```

## 9. Git / Data Boundary

以下全部 gitignored：

```text
snapshot
SQLite workspace
embedding cache
full gold data
AI suggestion data
```

Git 只允许保存：

```text
schemas
validators
small synthetic fixtures
manifest
code
```

禁止把完整真实题库正文提交 Git。

## 10. Question Version / Duplicate Semantics

真实语义：

```text
contentFingerprint =
sha256(JSON(questionFingerprintPayload))
```

payload 包含：

```text
stem
options
answer
analysis
sorted knowledgePointIds
difficulty
type
source
year
expectedTimeSec
```

无内部 normalization。

锁定：

- **Same contentFingerprint** → deterministic identical payload 证据；允许标签 deterministic copy。
- **Different fingerprint** → 不能证明内容不同；normalized-only duplicate 必须人工确认。
- **familyId** → 真实语义是 version lineage（版本谱系），不是变式题关系。

## 11. Version Inheritance

锁定：

```text
same contentFingerprint
→ reviewed tags 可 deterministic copy

format-only difference（经人工确认归一后一致）
→ 允许继承

material content change
→ NEEDS_REVIEW
```

旧版本标签只能作为 suggestion，不能自动 REVIEWED。

## 12. Retrieval Architecture

采用 Hybrid Retrieval。

唯一硬过滤：

```text
subject
```

Chapter / old KnowledgePoint：soft bonus only，绝不作为排除条件。

原因引用 Task 3.6：co-cache / co-data / ds-sort / os-file 因章节名不匹配得到 0 candidates；若把 chapter 当硬过滤会系统性漏召回。

## 13. Multi-View Retrieval

不要把字段简单拼接成一个 text。

锁定视角与权重语义：

```text
stem     → 核心
analysis → 高价值补召回
options  → 辅助
answer   → 低权重
old KnowledgePoint → soft signal
chapter  → soft signal
```

Embedding 至少支持：

```text
stem view
analysis view
```

词法检索可利用多个字段。

## 14. Embedding Architecture

正式锁定抽象：

```text
EmbeddingProvider
```

V1：

```text
LocalEmbeddingProvider
```

此处 “local” 明确指 Windows developer machine，不是 2C2G production server。

未来允许：

```text
ApiEmbeddingProvider
```

上层 retrieval 不依赖具体供应商。模型暂不锁死，由真实 Gold benchmark 决定。要求：

```text
CPU usable
GPU optional acceleration
embedding cache
model/version recorded
```

## 15. Lexical Retrieval

必须包含 lexical retrieval。要求：

```text
deterministic
explainable
versionable
works with Chinese/technical tokens
```

不在设计阶段锁死 BM25 库；Implementation Plan 阶段再 benchmark / 选依赖。

## 16. Fusion

正式锁定：

```text
RRF 为主体 + small structural bonus
```

输入 rankings：

```text
lexical
stem embedding
analysis embedding
```

然后：

```text
RRF
+
small KP bonus
+
small chapter bonus
```

结构 bonus 只能轻微调整排序；不能把 textual relevance 很低的节点强推到 Top。

## 17. Candidate Explainability

每个候选保留可解释信息（概念字段，具体命名以 Implementation Plan 为准）：

```text
nodeId
finalRank
lexicalRank
stemEmbeddingRank
analysisEmbeddingRank
kpMatched
chapterMatched
retrievalReasons
```

Review UI 必须能回答：为什么这个 node 被召回。

## 18. Top-K Strategy

正式锁定：

```text
default Top 8
adaptive expansion up to Top 12
hard max = 12
```

不能无限扩大。若 Top 12 仍无合适候选：

```text
NO_SUITABLE_CANDIDATE
```

或：

```text
NEEDS_REVIEW
```

## 19. Gold Set

正式锁定：

```text
40 questions
DS 10 / CO 10 / OS 10 / CN 10
```

必须 deterministic stratified sampling，覆盖：

```text
16 referenced KnowledgePoints
high-impact KP
broad candidate questions
4 previous chapter-mismatch KPs
difficulty variation
source/year variation
exact duplicate only representative
```

Gold truth：

```text
PRIMARY   = exactly 1
SECONDARY = 0..2
```

生成方式：wide search + AI assistance + human final confirmation。只有人工确认才是 Gold Truth。

## 20. Development / Holdout

固定：

```text
Development = 24
Holdout     = 16
```

按 subject/strata 稳定拆分。Development 可调 embedding / RRF / bonus；Holdout 禁止参与调参。

## 21. Retrieval Gate

正式锁定：

```text
Holdout PRIMARY Recall@8  >= 90%
Holdout PRIMARY Recall@12 >= 95%
Holdout All Relevant Recall@12 >= 90%
Cross-subject candidates = 0
```

不达标：不得开始 326-question full annotation generation。

（精确离散算术与 All Relevant 口径见 §40 Benchmark Precision。）

## 22. Gold Persistence

完整 Gold：

```text
local-data/gold-set-v1.json
```

gitignored。

Git 只保存 manifest（概念字段）：

```text
goldVersion
snapshotId
questionIds
contentFingerprints
primaryNodeIds
secondaryNodeIds
sha256
```

不包含真实题干正文。若 `Question.contentFingerprint` 变化，对应 Gold truth 必须 invalidate。

## 23. Annotation Model Provider

正式锁定抽象：

```text
AnnotationModelProvider
```

V1：high-quality cloud model。Production server 不运行该模型。

输入严格限制：

```text
Question
+
Top 8..12 candidates
```

模型不能看到任意 KnowledgeNode ID 搜索接口；不能自行生成候选外 Node ID。

## 24. AI Output Contract

decision：

```text
SUGGEST
NEEDS_REVIEW
NO_SUITABLE_CANDIDATE
```

confidence：

```text
HIGH
MEDIUM
LOW
```

约束：

- `SUGGEST` → PRIMARY exactly 1，SECONDARY 0..2。
- `NEEDS_REVIEW` / `NO_SUITABLE_CANDIDATE` → PRIMARY 允许 null。
- 模型必须允许 abstain，禁止强选。

## 25. Annotation Model Gate

Retrieval Gate 之后执行模型 benchmark。

Holdout Gate：

```text
PRIMARY Accuracy >= 90%
HIGH-confidence PRIMARY Accuracy >= 95%
Illegal candidate IDs = 0
Structured output success = 100%
```

不达标：换模型 / prompt / contract；不能降低人工审核标准。

（PRIMARY Accuracy denominator、HIGH-confidence denominator、abstain 语义见 §40 Benchmark Precision。）

## 26. Review State Machine

锁定：

```text
PENDING
REVIEWED
NEEDS_REVIEW
NO_SUITABLE_CANDIDATE
SKIPPED
```

关键 invariant：

```text
只有人工操作可以进入 REVIEWED
AI 永远不能直接 REVIEWED
只有 REVIEWED 才能进入最终 seed/export
```

## 27. PRIMARY / SECONDARY Semantics

PRIMARY：

> 如果学生答错这道题，最应该归因到哪个 Atomic KnowledgeNode？

要求：exactly 1。

SECONDARY：

> 解答该题确实依赖，但不是核心考查目标的 Atomic KnowledgeNode。

要求：0..2。禁止因为“有关联”就打 secondary。

若无法确定唯一 PRIMARY：NEEDS_REVIEW，不得 REVIEWED。

## 28. Batch Rules

正式锁定：

```text
Batch copy 可以基于 deterministic facts
Batch accept 不能基于 AI confidence
```

具体：

```text
326 independent units：逐题至少一次人工明确确认
Exact duplicates：允许 deterministic copy
Same fingerprint new version：允许 deterministic copy
AI HIGH：禁止 batch REVIEWED
```

## 29. Local Review UI

正式锁定技术栈：

```text
Vite
React
TypeScript
Local Node API
```

只监听 `127.0.0.1`；不进入生产 bundle。

核心 UX 必须设计：

```text
题目正文
选项
答案
analysis
旧 KP
AI suggestion
PRIMARY
SECONDARY
Top candidates
retrieval evidence
Confirm / Modify / Needs Review / No Suitable Candidate / Skip
```

支持：progress、按 subject/status 过滤、resume、keyboard shortcuts。不做像素级 UI 设计。

## 30. Reviewed Dataset

只有 `status = REVIEWED` 才能进入：

```text
reviewed-question-atomic-tags.json
```

导出前 validator 必须确保：

```text
Question exists
Question is eligible/current
Node exists
Node atomic
Node active
subject matches
PRIMARY exactly 1
SECONDARY <= 2
PRIMARY != SECONDARY
no duplicate nodes
source snapshot still matches question fingerprint
```

Exact duplicate propagation 单独验证。

## 31. Production Boundary

本 V1 Design 范围：

```text
snapshot
local annotation workspace
retrieval
benchmark
AI suggestion
review
validated export
```

真正 production seed（写入 `QuestionKnowledgeNodeTag`）作为后续独立 implementation / rollout task；不把生产写库与本地标注工具混成一个 Task。

## 32. Success Metrics

锁定：

```text
Current unique Question reviewed coverage >= 90%
REVIEWED: PRIMARY exactly 1, SECONDARY 0..2
AI-only production tags = 0
Cross-subject tags = 0
Invalid KnowledgeNode IDs = 0
Exact duplicate deterministic propagation = 100%
```

最终业务指标：

```text
Live Question Atomic Resolvable Coverage
```

替代 `KnowledgePointNodeMap coverage >= 70%` 作为主要 rollout 指标。

## 33. Non-Goals

V1 明确不做：

```text
production online embedding
production online LLM
vector DB
automatic AI approval
LLM-generated KnowledgeNode
changing Knowledge Catalog
rewriting mastery formula
priority-engine changes
review transaction fixes
today-plan source changes
full teacher-facing annotation CMS
multi-user reviewer workflow
```

## 34. Failure Handling

必须覆盖：

```text
snapshot stale
question fingerprint changed
embedding provider unavailable
AI provider unavailable
malformed AI output
candidate IDs invalid
no candidate
ambiguous PRIMARY
review interrupted
SQLite workspace corrupted/invalid
export validation fails
```

核心原则：**fail closed**。任何不确定情况不得进入 REVIEWED export。

## 35. Determinism / Reproducibility

记录：

```text
snapshot version
retrieval version
embedding provider
embedding model/version
RRF config/version
AI provider/model
prompt version
gold version
```

同一 snapshot + 同一 retrieval configuration → 候选排序可重复。AI suggestion 不要求 bit-for-bit deterministic，但必须保存 model / prompt / version / output。

## 36. Security / Privacy

生产 Snapshot 包含完整题库正文，因此：

```text
local-data gitignored
review UI localhost only
no public binding
no browser external telemetry introduced
AI provider only receives minimum required question + candidate content
production DB credentials not stored in annotation workspace
```

## 37. Rollout Phases

```text
Phase 0  snapshot + workspace
Phase 1  40-question Gold
Phase 2  retrieval benchmark
Phase 3  annotation-model benchmark
Phase 4  326 PENDING suggestions
Phase 5  human review
Phase 6  validated reviewed export
Phase 7  production seed + E2E
```

每个 phase 有 gate（Phase 2 通过 Retrieval Gate、Phase 3 通过 Annotation Model Gate 等）。

## 38. Relationship to Existing Bridge Work

既有 Task 1–3 不废弃，继续保留：

```text
KnowledgePointNodeMap metadata
deterministic matcher
bridge audit
ACTIVE-only future fallback
```

仅调整架构角色：

```text
QuestionKnowledgeNodeTag = primary
KnowledgePointNodeMap    = fallback
```

禁止删除已有 bridge implementation。

## 39. Spec Self-Review Checklist

完成后逐项核对（对应任务 §40）：

1. 与生产真实数据一致（332/328/4、326/2、18/16、0% / 0-90-242）。
2. 不再假设 332 都需独立标注；明确 326 独立 / 2 副本 / 4 历史。
3. 明确 326/2/4 分类。
4. KnowledgePoint bridge 降为 fallback。
5. 避免 2C2G server inference。
6. 明确 local = Windows developer machine。
7. subject 是唯一 hard filter。
8. chapter/KP 为 soft bonus。
9. 锁定 RRF + structural bonus。
10. 锁定 Top 8 → 12（hard max 12）。
11. 锁定 40 Gold / 24 Dev / 16 Holdout。
12. 包含 Retrieval Gate。
13. 包含 Annotation Model Gate。
14. 允许 AI abstain。
15. AI 不可 REVIEWED。
16. PRIMARY 1 / SECONDARY 0..2。
17. SQLite workspace。
18. local Vite React Review UI（127.0.0.1）。
19. Snapshot gitignored。
20. Gold manifest strategy。
21. version inheritance。
22. exact duplicate deterministic copy。
23. fail closed。
24. 无 scope creep（Non-Goals 明确）。
25. 与现有 `QuestionKnowledgeNodeTag` schema（questionId/knowledgeNodeId/role ExamTagRole/confidence/taggedBy/source、unique(questionId, knowledgeNodeId, role)）语义一致，无冲突。

## 40. Benchmark Precision（Amendment）

本修订不改变已批准架构，仅补严评测口径。百分比目标保留在正文；离散样本下的实际 passing count 以下为准。

### A. Holdout arithmetic

Holdout 固定 16 题：

```text
PRIMARY Recall@8 >= 90%
→ 实际要求至少 15 / 16 = 93.75%

PRIMARY Recall@12 >= 95%
→ 实际要求 16 / 16 = 100%
```

报告同时给出百分比与离散 count（如 `15/16 (93.75%)`）。

### B. All Relevant Recall@12

Gate 使用 **macro recall**：

```text
perQuestionRecall(q) =
|GoldRelevant(q) ∩ RetrievedTop12(q)|
/ |GoldRelevant(q)|

GoldRelevant(q) = PRIMARY(q) ∪ SECONDARY(q)

AllRelevantRecallAt12 = mean(perQuestionRecall(q))  （16 道 Holdout 平均）
```

允许额外报告 `micro All Relevant Recall@12` 作为 diagnostic；Gate 只看 macro。

`GoldRelevant` 不允许为空：每道 Gold 必须恰好 1 个 PRIMARY，因此分母恒 ≥1。

### C. Annotation Model abstain semantics

PRIMARY Accuracy 的 denominator 是**全部 eligible Holdout 题**（16），不得只统计 AI 选择 SUGGEST 的题：

```text
SUGGEST + correct PRIMARY          → correct
SUGGEST + wrong PRIMARY            → incorrect
NEEDS_REVIEW                       → incorrect（计入 PRIMARY Accuracy）
NO_SUITABLE_CANDIDATE              → incorrect（计入 PRIMARY Accuracy）
malformed output                   → incorrect
```

AI 仍允许 abstain；abstain 是生产安全行为，但**不能用来虚高 benchmark accuracy**。不得通过改 denominator 刷指标。

单独报告：

```text
abstentionRate
needsReviewRate
noSuitableCandidateRate
```

### D. HIGH-confidence metric

保留：

```text
HIGH-confidence PRIMARY Accuracy >= 95%
```

必须显式报告 denominator：

```text
highConfidenceSuggestionCount
```

若 `highConfidenceSuggestionCount = 0`，该指标显示 `N/A`，不得伪装成 100%。整体 PRIMARY Accuracy Gate 仍必须通过。不新增未经批准的 HIGH-confidence coverage Gate。

### E. Top 8 → Top 12 expansion semantics

不使用未经校准的 score-gap heuristic。锁定：

```text
Retriever 永远计算并持久化 Top12 ranked candidates
```

AI / Review UI 初始使用 Top8；允许扩展到 Top12 的触发（互斥）：

```text
1. AI first-pass 返回 NO_SUITABLE_CANDIDATE；或
2. AI 返回 NEEDS_REVIEW 且显式说明候选不足；或
3. 人工 reviewer 显式请求 “show more / expand candidates”
```

AI second pass 最多重试一次（Top12）。Top12 后仍无唯一 PRIMARY：

```text
NEEDS_REVIEW 或 NO_SUITABLE_CANDIDATE
```

绝不超过 12。

Retrieval benchmark 自身直接同时计算 Recall@8 与 Recall@12，不依赖 expansion trigger。
