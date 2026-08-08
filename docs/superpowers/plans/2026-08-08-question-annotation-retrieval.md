# Question Annotation Foundation & Retrieval Benchmark Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立 Question-Level Atomic Tagging 的标注基础（只读 snapshot、SQLite workspace、40 题 Gold、Dev/Holdout 冻结、确定性 lexical + local embedding 检索、RRF 融合），并跑出可判定 `RETRIEVAL_GATE_PASS/FAIL` 的 retrieval benchmark。

**Architecture:** 全部标注工作离线（Windows 开发机），与生产隔离。纯逻辑放在 `tools/question-annotation/core/`（无生产依赖），SQLite 用 Node 内置 `node:sqlite`，embedding 用 transformers.js（仅装在 tools 子包，不进生产镜像），生产只读 snapshot 通过一次性容器导出。Retrieval = subject 硬过滤 + lexical/stem-embedding/analysis-embedding 三路 → RRF + 小结构 bonus → Top12 持久化 / Top8 视图。

**Tech Stack:** Node ≥22.5（项目实际 Node 24.15.0）、`node:sqlite`（内置）、`@huggingface/transformers`（仅 tools 子包）、node:test、Vite/React 不进入本 Plan。

## Global Constraints

- 唯一需求来源：`docs/superpowers/specs/2026-08-08-question-level-atomic-tagging-v1-design.md`（含 §40 Benchmark Precision Amendment）。
- **Working tree 隔离**：禁止 `git add .` / `git add -A`；每次提交前 `git diff --cached --name-only` 只包含当前 Task 文件；本 Plan 工作区为既有 worktree `C:\Users\Lenovo\Documents\计算机考研提分系统\.worktrees\feature\live-question-atomic-bridge`。
- **只读边界**：任何访问 production DB 的脚本只允许 `findMany/SELECT`；禁止 INSERT/UPDATE/UPSERT/DELETE/migrate/seed；production checkout（`codex/deployment-ready`）不切分支；生产执行复用 Task 3.5/3.6 的一次性容器模式。
- **数据边界**：真实 snapshot / Gold 正文 / embedding 缓存 / SQLite 文件全部 gitignored；Git 只提交 schemas/validators/synthetic fixtures/manifest/code；不得把真实题库正文提交 Git。
- **Gate 口径**（Design Spec §40）：Holdout 16 题；PRIMARY Recall@8 通过条件 ≥15/16（93.75%）；PRIMARY Recall@12 ≥16/16（100%）；Macro All Relevant Recall@12 ≥90%；Cross-subject candidates = 0。All Relevant 用 macro（micro 仅 diagnostic）。PRIMARY Accuracy / HIGH-confidence 指标仅在 Plan B（Phase 3–6）落地，本 Plan 不实现 AI provider。
- **候选规模**：Retriever 永远计算并持久化 Top12；初始视图 Top8；绝不超过 12。
- **依赖纪律**：monorepo（workspaces apps/*, packages/*）；新增依赖优先 portable / non-native / minimal；`node:sqlite` 为内置模块（已验证 Node 24.15.0 可用）；embedding 依赖只装进 `tools/question-annotation/package.json`（非 workspace，生产 Dockerfile 不复制 tools/，不会进生产镜像）。
- **测试边界**：unit/integration 只用 synthetic fixtures；需要真实模型的 benchmark 是 local benchmark gate，不与 CI-safe 测试混同；不得假装跑过 benchmark。
- 本 Plan 禁止实现：AnnotationModelProvider 生产流程、cloud AI 批量建议、326 题 suggestion 生成、完整 Review UI、production `QuestionKnowledgeNodeTag` 写入、production seed、resolver 修改、mastery E2E、Priority Engine 改动、vector DB、生产 embedding/LLM。
- 每个 Task 结束：focused tests 通过、review、显式 commit、working tree check。

## File Structure

### Existing files expected to modify

- `.gitignore` — 忽略 annotation local data、embedding cache、生成 audit JSON。
- `tools/question-annotation/package.json`（新增，见 New）在 Task 7 加入 `@huggingface/transformers`。

### New files expected

```text
tools/question-annotation/
├─ package.json                    # standalone（非 workspace）；scripts: gold, benchmark, export-snapshot
├─ core/
│  ├─ snapshot.js                  # snapshot schema/类型、role 分类、validateSnapshot、fingerprintPayloadHash
│  ├─ sample.js                    # 确定性分层 Gold 抽样、Dev/Holdout 冻结、gold manifest builder
│  ├─ gold.js                      # Gold 校验（PRIMARY exactly 1 / SECONDARY 0..2 / 节点存在性）
│  ├─ lexical.js                   # 确定性 tokenizer + BM25（自实现，无依赖）
│  ├─ embedding.js                 # EmbeddingProvider 接口 + Fake + LocalTransformers + 缓存
│  ├─ fusion.js                    # RRF + KP/chapter bonus（纯函数）
│  ├─ retriever.js                 # 编排三路检索 → Top12（subject 硬过滤）
│  └─ benchmark.js                 # Recall@8/@12、macro/micro All Relevant、cross-subject、gate
├─ workspace/
│  └─ workspace.mjs                # node:sqlite 打开/导入/校验（幂等、事务、stale 保护）
├─ scripts/
│  ├─ export-snapshot.mjs          # 只读生产 snapshot 导出（findMany only）
│  ├─ gold-author.mjs              # 最小 Gold 编写 CLI（wide search + PRIMARY/SECONDARY + confirm）
│  └─ run-benchmark.mjs            # benchmark runner → 报告 JSON + gate PASS/FAIL
├─ local-data/                     # gitignored：snapshot JSON、gold JSON、embedding cache、benchmark 报告
└─ test/                           # node:test（根 `npm test` 自动发现；CI-safe，不依赖真实模型）
    ├─ snapshot.test.mjs
    ├─ sample.test.mjs
    ├─ gold.test.mjs
    ├─ lexical.test.mjs
    ├─ embedding.test.mjs
    ├─ fusion.test.mjs
    ├─ retriever.test.mjs
    └─ benchmark.test.mjs
```

## Locked Interfaces（跨 Task 一致，后续 Task 不得改名）

```ts
// core/snapshot.js
type SnapshotRole = 'INDEPENDENT_UNIT' | 'EXACT_DUPLICATE_COPY' | 'HISTORICAL_ONLY';
interface SnapshotIdentity { snapshotId: string; schemaVersion: 'annotation-snapshot-v1'; generatedAt: string; sourceCommit: string; counts: Record<string, number>; contentSha256: string; }
interface AnnotationSnapshot extends SnapshotIdentity { questions: SnapshotQuestion[]; knowledgePoints: SnapshotKnowledgePoint[]; questionKnowledgePoints: Array<{ questionId: string; knowledgePointId: string }>; nodes: SnapshotNode[]; roles: Record<string, SnapshotRole>; duplicateRepresentative: Record<string, string | null>; }
function classifyRoles(rows: Array<{ id: string; isCurrent: boolean; contentFingerprint: string | null; familyId: string; versionNumber: number }>): { roles: Record<string, SnapshotRole>; duplicateRepresentative: Record<string, string | null> };
function validateSnapshot(snapshot: AnnotationSnapshot): { ok: boolean; errors: string[] };
function fingerprintPayloadHash(question: { stem: string; options: string[]; answer: string; analysis: string }): string;

// core/sample.js
function sampleGoldQuestionIds(snapshot: AnnotationSnapshot): string[];          // 40，deterministic
function splitDevHoldout(goldQuestionIds: string[]): { dev: string[]; holdout: string[] }; // 24/16，deterministic
function buildGoldManifest(input: { goldVersion: string; snapshotId: string; entries: Array<{ questionId: string; contentFingerprint: string; primaryNodeId: string; secondaryNodeIds: string[] }> }): Record<string, unknown>;

// core/gold.js
function validateGoldEntry(entry: { questionId: string; primaryNodeId: string; secondaryNodeIds: string[] }, nodeIds: ReadonlySet<string>, byQuestion: ReadonlyMap<string, { subject: string }>, nodeSubject: ReadonlyMap<string, string>): { ok: boolean; errors: string[] };

// core/lexical.js
const LEXICAL_VERSION = 'lexical-bm25-v1';
function tokenize(text: string): string[];                 // ascii 词 + CJK 单字 + CJK 二元组
function buildLexicalIndex(nodes: Array<{ id: string; subject: string; name: string; chapterName: string | null; sectionName: string | null }>): LexicalIndex;
function searchLexical(index: LexicalIndex, query: string, subject: string): Array<{ nodeId: string; score: number }>;

// core/embedding.js
interface EmbeddingProvider { readonly providerId: string; readonly modelVersion: string; embed(text: string): Promise<number[]>; }
class FakeEmbeddingProvider implements EmbeddingProvider;   // CI-safe 确定性哈希向量
class LocalTransformersProvider implements EmbeddingProvider; // @huggingface/transformers，仅本地
function embedWithCache(provider: EmbeddingProvider, text: string, cacheDir: string): Promise<number[]>;

// core/fusion.js
const FUSION_VERSION = 'rrf-k60-bonus-v1';
interface FusionInput { lexical: Array<{ nodeId: string; rank: number }>; stemEmbedding: Array<{ nodeId: string; rank: number }>; analysisEmbedding: Array<{ nodeId: string; rank: number }>; kpMatched: ReadonlySet<string>; chapterMatched: ReadonlySet<string>; subjectFilter: ReadonlySet<string>; }
interface RetrievalCandidate { nodeId: string; finalRank: number; lexicalRank: number | null; stemEmbeddingRank: number | null; analysisEmbeddingRank: number | null; kpMatched: boolean; chapterMatched: boolean; retrievalReasons: string[]; }
function fuseCandidates(input: FusionInput, topK: number): RetrievalCandidate[];

// core/retriever.js
function retrieveTop12(question: SnapshotQuestion, snapshot: AnnotationSnapshot, providers: { lexical: LexicalIndex; stem: EmbeddingProvider; analysis: EmbeddingProvider }, cacheDir: string): Promise<RetrievalCandidate[]>;

// core/benchmark.js
interface BenchmarkMetrics { primaryRecallAt8: number; primaryRecallAt12: number; macroAllRelevantAt12: number; microAllRelevantAt12: number; crossSubjectCount: number; perQuestionMisses: Array<{ questionId: string; primaryFoundAt12: boolean; macroRecall: number }>; perSubject: Record<string, { primaryRecallAt12: number; macroAllRelevantAt12: number }>; perKp: Record<string, { questionCount: number; primaryRecallAt12: number }>; }
function computeBenchmarkMetrics(runs: Array<{ questionId: string; subject: string; knowledgePointIds: string[]; candidates: RetrievalCandidate[]; goldPrimary: string | null; goldSecondary: string[] }>): BenchmarkMetrics;
function evaluateRetrievalGate(metrics: BenchmarkMetrics, holdoutCount: number): { pass: boolean; reasons: string[] };

// workspace/workspace.mjs
function openWorkspace(path: string): WorkspaceDb;
function importSnapshot(db: WorkspaceDb, snapshot: AnnotationSnapshot): void;      // 事务 + 幂等 + stale 保护
function validateWorkspace(db: WorkspaceDb): { ok: boolean; errors: string[] };
```

## Task 1 — Annotation Tooling Scaffolding + Snapshot Contract

职责：建立 `tools/question-annotation/` 基础、snapshot 纯 schema/校验/role 分类、`.gitignore` 数据边界。所有逻辑纯函数、仅 synthetic fixtures 测试。

**Files:**
- Create: `tools/question-annotation/package.json`
- Create: `tools/question-annotation/core/snapshot.js`
- Create: `tools/question-annotation/test/snapshot.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: 无（首个 Task）。
- Produces: `classifyRoles`、`validateSnapshot`、`fingerprintPayloadHash`（签名见 Locked Interfaces）；`tools/question-annotation/package.json`（scripts: `gold`, `benchmark`, `export-snapshot`；deps 本 Task 为空，Task 7 加入 transformers）。

- [ ] **Step 1: 写 failing test**

`tools/question-annotation/test/snapshot.test.mjs`：

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRoles, validateSnapshot, fingerprintPayloadHash } from '../core/snapshot.js';

test('classifyRoles splits current unique / exact duplicate copy / historical only', () => {
  const rows = [
    { id: 'q1', isCurrent: true, contentFingerprint: 'fp-A', familyId: 'f1', versionNumber: 1 },
    { id: 'q2', isCurrent: true, contentFingerprint: 'fp-A', familyId: 'f2', versionNumber: 1 },
    { id: 'q3', isCurrent: false, contentFingerprint: 'fp-B', familyId: 'f3', versionNumber: 1 },
    { id: 'q4', isCurrent: true, contentFingerprint: 'fp-C', familyId: 'f4', versionNumber: 1 },
  ];
  const { roles, duplicateRepresentative } = classifyRoles(rows);
  assert.equal(roles.q1, 'INDEPENDENT_UNIT');
  assert.equal(roles.q2, 'EXACT_DUPLICATE_COPY');
  assert.equal(roles.q3, 'HISTORICAL_ONLY');
  assert.equal(roles.q4, 'INDEPENDENT_UNIT');
  assert.equal(duplicateRepresentative.q2, 'q1');
  assert.equal(duplicateRepresentative.q1, null);
});

test('validateSnapshot rejects unknown role / missing counts / hash mismatch', () => {
  const snapshot = {
    snapshotId: 's1', schemaVersion: 'annotation-snapshot-v1', generatedAt: '2026-08-08T00:00:00.000Z',
    sourceCommit: 'abc', counts: { totalRows: 1 }, contentSha256: 'x',
    questions: [{ id: 'q1', stem: 's', options: [], answer: 'a', analysis: '', subject: 'DS', contentFingerprint: 'fp', isCurrent: true, familyId: 'f1', versionNumber: 1 }],
    knowledgePoints: [], questionKnowledgePoints: [], nodes: [], roles: { q1: 'BOGUS' }, duplicateRepresentative: {},
  };
  const result = validateSnapshot(snapshot);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('BOGUS')));
});

test('fingerprintPayloadHash is deterministic over normalized content', () => {
  assert.equal(fingerprintPayloadHash({ stem: 'a', options: ['1'], answer: 'A', analysis: 'x' }),
    fingerprintPayloadHash({ stem: 'a', options: ['1'], answer: 'A', analysis: 'x' }));
  assert.notEqual(fingerprintPayloadHash({ stem: 'a', options: ['1'], answer: 'A', analysis: 'x' }),
    fingerprintPayloadHash({ stem: 'b', options: ['1'], answer: 'A', analysis: 'x' }));
});
```

`classifyRoles` 规则（与 Task 3.6.5 数据一致，逻辑不 hardcode 数量）：

```js
// 按 contentFingerprint 分组；同一 fingerprint 且 isCurrent 的多行：字典序最小 id 为 INDEPENDENT_UNIT（代表），其余当前行为 EXACT_DUPLICATE_COPY（duplicateRepresentative 指向代表）
// isCurrent=false → HISTORICAL_ONLY
// 其余当前行 → INDEPENDENT_UNIT
```

`validateSnapshot` 检查：schemaVersion 固定、roles 键覆盖全部 question id、role 值合法、counts 与数组长度一致、`contentSha256 === sha256(questions 排序后的 JSON)`。

`fingerprintPayloadHash`：`sha256(JSON({ stem, options, answer, analysis }))`（audit-only 归一化指纹；本函数只做确定性文本归一：trim、全角→半角、大小写、空白折叠、常见标点归一——与 Task 3.6.5 audit 的 normalizeContent 同规则，自实现于 snapshot.js）。

- [ ] **Step 2: 运行验证 FAIL**

Run: `node --test tools/question-annotation/test/snapshot.test.mjs`
Expected: FAIL with module not found（`../core/snapshot.js` 不存在）。

- [ ] **Step 3: 最小实现**

创建 `core/snapshot.js` 与 `package.json`；实现上述三个函数与 normalize/hash 辅助。

- [ ] **Step 4: 运行验证 PASS**

Run: `node --test tools/question-annotation/test/snapshot.test.mjs`
Expected: PASS（3 项）。

- [ ] **Step 5: 更新 .gitignore**

追加：

```gitignore
tools/question-annotation/local-data/
tools/question-annotation/node_modules/
data/408/knowledge-catalog/*-audit.json
```

（`*-audit.json` 覆盖三个既有生成物：question-node-bridge-audit.json、question-tagging-feasibility-audit.json、question-duplicate-family-audit.json。）

- [ ] **Step 6: Regression + git check**

Run: `npm test`（应无回归；tools 测试会被自动发现）
Run: `git status --short`、`git diff --cached --name-only`

- [ ] **Step 7: Commit**

```bash
git add tools/question-annotation/package.json tools/question-annotation/core/snapshot.js tools/question-annotation/test/snapshot.test.mjs .gitignore
git commit -m "feat: add annotation snapshot contract and tooling scaffolding"
```

## Task 2 — Read-Only Production Snapshot Exporter

职责：从 production PostgreSQL 只读导出完整 snapshot（332 行语义 + role 分类 + 层级），并完成一次生产只读 acceptance（332/328/4/326/2 作为当前数据证据，不 hardcode）。

**Files:**
- Create: `tools/question-annotation/scripts/export-snapshot.mjs`
- Create: `tools/question-annotation/test/export-snapshot.test.mjs`

**Interfaces:**
- Consumes: `core/snapshot.js`（`classifyRoles`、`validateSnapshot`）。
- Produces: `exportSnapshot(prisma, sourceCommit)` → `AnnotationSnapshot`；`writeSnapshotFile(snapshot, dir)`；`readSnapshotFile(path)` → `AnnotationSnapshot`。

- [ ] **Step 1: 写 failing test**

`export-snapshot.test.mjs`（synthetic fixture，不连生产）：

```js
test('exportSnapshot emits a valid snapshot with roles and counts', () => {
  const fakePrisma = {
    question: { findMany: async () => [/* 4 行：2 current 同 fp、1 current 唯一、1 non-current */] },
    knowledgePoint: { findMany: async () => [] },
    questionKnowledgePoint: { findMany: async () => [] },
    knowledgeNode: { findMany: async () => [] },
    questionFamily: { findMany: async () => [] },
  };
  const snapshot = await exportSnapshot(fakePrisma, 'deadbeef');
  assert.equal(validateSnapshot(snapshot).ok, true);
  assert.equal(snapshot.counts.totalRows, 4);
});

test('write/read round-trips the snapshot file', () => { /* tmpdir 写入并读回 deepEqual */ });
```

- [ ] **Step 2: 验证 FAIL**

Run: `node --test tools/question-annotation/test/export-snapshot.test.mjs`
Expected: FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

`export-snapshot.mjs`：仅 `findMany`（Question、QuestionFamily、KnowledgePoint、QuestionKnowledgePoint、KnowledgeNode）；构建 `AnnotationSnapshot`（含 chapter/section 层级由 parentId 推导）；`contentSha256`；写 `local-data/snapshot-<snapshotId>.json` + `local-data/snapshot-manifest.json`。**只读证明**：全文件仅含 `findMany`/`$disconnect`/文件写入；无任何 DB 写方法。

- [ ] **Step 4: 验证 PASS**

Run: `node --test tools/question-annotation/test/export-snapshot.test.mjs` → PASS。

- [ ] **Step 5: 生产只读 acceptance（一次，人工/协调者执行）**

复用既有一次性容器模式（临时 worktree `~/kaoyan-408-bridge-audit` + Dockerfile.audit + 生产 postgres 网络），命令与 Task 3.6 一致，仅脚本换为 `node scripts/export-snapshot.mjs`。预期 acceptance 证据：

```text
totalRows 332 / current 328 / nonCurrent 4
INDEPENDENT_UNIT 326 / EXACT_DUPLICATE_COPY 2 / HISTORICAL_ONLY 4
```

这些只是当前数据 acceptance evidence，**不得 hardcode 进核心逻辑**。

- [ ] **Step 6: Regression + git check**

Run: `node --test tools/question-annotation/test/snapshot.test.mjs tools/question-annotation/test/export-snapshot.test.mjs`；`git status --short`；`git diff --cached --name-only`（生产 acceptance 生成的 local-data 文件 gitignored，不提交）。

- [ ] **Step 7: Commit**

```bash
git add tools/question-annotation/scripts/export-snapshot.mjs tools/question-annotation/test/export-snapshot.test.mjs
git commit -m "feat: add read-only production snapshot exporter"
```

## Task 3 — SQLite Annotation Workspace

职责：用内置 `node:sqlite` 实现本地 workspace（导入 snapshot、幂等、事务、stale 保护、resume-safe）。

**Files:**
- Create: `tools/question-annotation/workspace/workspace.mjs`
- Create: `tools/question-annotation/test/workspace.test.mjs`

**Interfaces:**
- Consumes: `core/snapshot.js`（`AnnotationSnapshot`、`validateSnapshot`）。
- Produces: `openWorkspace(path)`、`importSnapshot(db, snapshot)`、`validateWorkspace(db)`（签名见 Locked Interfaces）。

- [ ] **Step 1: 写 failing test**

`workspace.test.mjs`：

```js
test('importSnapshot is idempotent and transactional', () => {
  const db = openWorkspace(':memory:');
  const snapshot = /* 2 题 synthetic */;
  importSnapshot(db, snapshot);
  importSnapshot(db, snapshot);
  const count = db.prepare('SELECT COUNT(*) AS c FROM questions').get().c;
  assert.equal(count, 2);
  validateWorkspace(db);
});

test('importSnapshot rejects stale snapshot identity mismatch', () => {
  const db = openWorkspace(':memory:');
  importSnapshot(db, snapshotA);
  assert.throws(() => importSnapshot(db, snapshotB), /stale|snapshot/i);
});
```

- [ ] **Step 2: 验证 FAIL**

Run: `node --test tools/question-annotation/test/workspace.test.mjs` → FAIL（模块不存在）。

- [ ] **Step 3: 最小实现**

表：`snapshots`（snapshotId PK、schemaVersion、generatedAt、sourceCommit、contentSha256）、`questions`（questionId PK、snapshotId、contentFingerprint、isCurrent、versionNumber、familyId、stem、options JSON、answer、analysis、subject、role）、`knowledge_points`、`question_knowledge_points`、`knowledge_nodes`（id、parentId、subject、nodeType、name、isActive、chapterName、sectionName）、`gold_questions`、`retrieval_results`、`benchmark_runs`。`importSnapshot` 在事务内：先校验 snapshot，按 snapshotId 幂等（同 id 重导不重复行；不同 id 且已有数据 → 抛 stale）。`validateWorkspace` 校验引用完整性。

- [ ] **Step 4: 验证 PASS**

Run: `node --test tools/question-annotation/test/workspace.test.mjs` → PASS。

- [ ] **Step 5: Regression + git check**

Run: `node --test tools/question-annotation/test/snapshot.test.mjs tools/question-annotation/test/workspace.test.mjs`；`git status --short`。

- [ ] **Step 6: Commit**

```bash
git add tools/question-annotation/workspace/workspace.mjs tools/question-annotation/test/workspace.test.mjs
git commit -m "feat: add sqlite annotation workspace"
```

## Task 4 — Deterministic Gold Sampling + Dev/Holdout Freeze

职责：从 snapshot 确定性选出 40 题（DS/CO/OS/CN 各 10），冻结 24 Dev / 16 Holdout，输出 manifest（不含正文）。

**Files:**
- Create: `tools/question-annotation/core/sample.js`
- Create: `tools/question-annotation/test/sample.test.mjs`

**Interfaces:**
- Consumes: `AnnotationSnapshot`（含 `roles`、`questions`、`questionKnowledgePoints`）。
- Produces: `sampleGoldQuestionIds`、`splitDevHoldout`、`buildGoldManifest`（签名见 Locked Interfaces）。

- [ ] **Step 1: 写 failing test**

`sample.test.mjs`：

```js
test('sampleGoldQuestionIds returns 40 deterministic ids, 10 per subject, only INDEPENDENT_UNIT', () => {
  const ids = sampleGoldQuestionIds(fixtureSnapshot);
  assert.equal(ids.length, 40);
  // 每科 10；全部 role=INDEPENDENT_UNIT；不含 EXACT_DUPLICATE_COPY
  // 重复运行 deepEqual
});

test('splitDevHoldout freezes 24/16 deterministically', () => {
  const { dev, holdout } = splitDevHoldout(sampleGoldQuestionIds(fixtureSnapshot));
  assert.equal(dev.length, 24);
  assert.equal(holdout.length, 16);
  assert.deepEqual(splitDevHoldout(sampleGoldQuestionIds(fixtureSnapshot)), { dev, holdout });
});
```

- [ ] **Step 2: 验证 FAIL**

Run: `node --test tools/question-annotation/test/sample.test.mjs` → FAIL。

- [ ] **Step 3: 最小实现**

抽样算法（deterministic）：

```js
// 1) eligible = role === 'INDEPENDENT_UNIT' 的题，按 (subject, questionId) 排序
// 2) 每科：先取覆盖该科被引用 KP 的首题（按 (kpId, questionId) 首题，跳过已选）；再取 4 个章节失配 KP 相关题；再取 BROAD 题；按 (kpId, questionId) 填满 10
// 3) 全部 40 按 (subject, questionId) 排序返回
```

Dev/Holdout 拆分（deterministic）：每科 10 题按 `(feasibilityClassOrder, kpId, questionId)` 排序，取固定下标 `[1, 4, 7, 9]` 为 Holdout（每科 4 → 16），其余为 Dev（每科 6 → 24）。`feasibilityClassOrder = ['READY','REVIEWABLE','BROAD','INSUFFICIENT']`。Holdout 冻结，禁止参与后续调参。

`buildGoldManifest` 只含 `goldVersion/snapshotId/entries[{questionId, contentFingerprint, primaryNodeId, secondaryNodeIds}]/sha256`，不含题干正文。

- [ ] **Step 4: 验证 PASS**

Run: `node --test tools/question-annotation/test/sample.test.mjs` → PASS。

- [ ] **Step 5: Regression + git check**

Run: `node --test tools/question-annotation/test/snapshot.test.mjs tools/question-annotation/test/workspace.test.mjs tools/question-annotation/test/sample.test.mjs`；`git status --short`。

- [ ] **Step 6: Commit**

```bash
git add tools/question-annotation/core/sample.js tools/question-annotation/test/sample.test.mjs
git commit -m "feat: add deterministic gold sampling and dev holdout split"
```

## Task 5 — Minimal Gold Authoring CLI + Gold Validation

职责：最小 CLI 支撑人工建立 40 题 Gold Truth（wide node search、PRIMARY exactly 1、SECONDARY 0..2、confirm），Gold 校验纯函数。

**Files:**
- Create: `tools/question-annotation/core/gold.js`
- Create: `tools/question-annotation/scripts/gold-author.mjs`
- Create: `tools/question-annotation/test/gold.test.mjs`

**Interfaces:**
- Consumes: `AnnotationSnapshot`（nodes/层级）、`buildGoldManifest`。
- Produces: `validateGoldEntry`（签名见 Locked Interfaces）；CLI 命令：`list`、`search-nodes <query> --subject <code>`、`set <questionId> --primary <nodeId> [--secondary <nodeId>]...`、`confirm <questionId>`、`status`；写 `local-data/gold-set-v1.json`（gitignored）+ manifest。

- [ ] **Step 1: 写 failing test**

`gold.test.mjs`：

```js
test('validateGoldEntry enforces PRIMARY exactly 1 and SECONDARY <= 2 with subject match', () => {
  const nodeIds = new Set(['n1', 'n2', 'n3']);
  const byQuestion = new Map([['q1', { subject: 'DS' }]]);
  const nodeSubject = new Map([['n1', 'DS'], ['n2', 'CO'], ['n3', 'DS']]);
  assert.equal(validateGoldEntry({ questionId: 'q1', primaryNodeId: 'n1', secondaryNodeIds: ['n3'] }, nodeIds, byQuestion, nodeSubject).ok, true);
  assert.equal(validateGoldEntry({ questionId: 'q1', primaryNodeId: 'n2', secondaryNodeIds: [] }, nodeIds, byQuestion, nodeSubject).ok, false); // 跨科
  assert.equal(validateGoldEntry({ questionId: 'q1', primaryNodeId: 'n1', secondaryNodeIds: ['n1'] }, nodeIds, byQuestion, nodeSubject).ok, false); // PRIMARY == SECONDARY
  assert.equal(validateGoldEntry({ questionId: 'q1', primaryNodeId: null, secondaryNodeIds: [] }, nodeIds, byQuestion, nodeSubject).ok, false); // PRIMARY null
});
```

- [ ] **Step 2: 验证 FAIL**

Run: `node --test tools/question-annotation/test/gold.test.mjs` → FAIL。

- [ ] **Step 3: 最小实现**

`gold.js` 纯校验（节点存在、atomic、active、subject 匹配、PRIMARY=1、SECONDARY≤2、PRIMARY≠SECONDARY、无重复节点）。CLI 用 Node 内置 `node:readline`/argv 解析；`search-nodes` 用 `core/lexical.js` 的宽匹配（Task 6 尚未存在时先用 substring 匹配 node name/chapter/section；Task 6 完成后切换为 lexical 搜索——本 Task 的 CLI 接受注入 search 函数，默认 substring，Task 6 在 retriever 测试中验证集成）。写文件前调用 `validateGoldEntry` 与 `buildGoldManifest`。

- [ ] **Step 4: 验证 PASS**

Run: `node --test tools/question-annotation/test/gold.test.mjs` → PASS；CLI `--help` 输出命令列表。

- [ ] **Step 5: Regression + git check**

Run: `node --test tools/question-annotation/test/sample.test.mjs tools/question-annotation/test/gold.test.mjs`；`git status --short`。

- [ ] **Step 6: Commit**

```bash
git add tools/question-annotation/core/gold.js tools/question-annotation/scripts/gold-author.mjs tools/question-annotation/test/gold.test.mjs
git commit -m "feat: add minimal gold authoring cli"
```

## Task 6 — Deterministic Lexical Retrieval

职责：自实现确定性 tokenizer + BM25（无依赖），subject 硬过滤。

**Files:**
- Create: `tools/question-annotation/core/lexical.js`
- Create: `tools/question-annotation/test/lexical.test.mjs`

**Interfaces:**
- Consumes: `AnnotationSnapshot.nodes`。
- Produces: `LEXICAL_VERSION`、`tokenize`、`buildLexicalIndex`、`searchLexical`（签名见 Locked Interfaces）。

- [ ] **Step 1: 写 failing test**

`lexical.test.mjs`：

```js
test('tokenize handles ascii technical terms and CJK unigrams/bigrams deterministically', () => {
  const a = tokenize('TCP 三次握手');
  const b = tokenize('tcp 三次 握手');
  assert.deepEqual(a, b);
  assert.ok(a.includes('tcp'));
  assert.ok(a.includes('三次'));
});

test('searchLexical ranks relevant node above irrelevant within subject and never crosses subject', () => {
  const index = buildLexicalIndex(nodesFixture);
  const result = searchLexical(index, '三次握手', 'CN');
  assert.ok(result.length > 0);
  assert.equal(result[0].nodeId, 'cn-tcp-handshake');
  assert.ok(result.every((r) => index.nodeSubject.get(r.nodeId) === 'CN'));
});

test('searchLexical is deterministic for identical input', () => {
  assert.deepEqual(searchLexical(index, '三次握手', 'CN'), searchLexical(index, '三次握手', 'CN'));
});
```

- [ ] **Step 2: 验证 FAIL**

Run: `node --test tools/question-annotation/test/lexical.test.mjs` → FAIL。

- [ ] **Step 3: 最小实现**

```js
// tokenize(text): 先做确定性文本归一（与 snapshot.normalize 同规则），再：
//   - 英文/数字 token：按非字母数字切分，保留小写词
//   - CJK 连续段：产出单字 + 相邻二元组
// BM25: idf = ln(1 + (N - df + 0.5)/(df + 0.5)); score = sum_t idf(t) * f(t,d)*(k1+1)/(f + k1*(1-b+b*dl/avgdl)); k1=1.2, b=0.75
// buildLexicalIndex(nodes): 预计算 doc 词频、df、avgdl；nodeSubject 映射
// searchLexical(index, query, subject): 先 subject 过滤，再按 BM25 分数降序，平手按 nodeId asc
```

`LEXICAL_VERSION = 'lexical-bm25-v1'`。

- [ ] **Step 4: 验证 PASS**

Run: `node --test tools/question-annotation/test/lexical.test.mjs` → PASS。

- [ ] **Step 5: Regression + git check**

Run: `node --test tools/question-annotation/test/snapshot.test.mjs tools/question-annotation/test/lexical.test.mjs`；`git status --short`。

- [ ] **Step 6: Commit**

```bash
git add tools/question-annotation/core/lexical.js tools/question-annotation/test/lexical.test.mjs
git commit -m "feat: add deterministic lexical retrieval"
```

## Task 7 — Embedding Provider Abstraction + Local Provider

职责：稳定 `EmbeddingProvider` 接口、CI-safe Fake、本地 transformers.js provider、缓存与 model/version 记录。

**Files:**
- Modify: `tools/question-annotation/package.json`（新增 dependency `@huggingface/transformers`）
- Create: `tools/question-annotation/core/embedding.js`
- Create: `tools/question-annotation/test/embedding.test.mjs`
- Create: `tools/question-annotation/scripts/embedding-smoke.mjs`（本地只读冒烟）

**Interfaces:**
- Consumes: 无跨 Task（独立）。
- Produces: `EmbeddingProvider`、`FakeEmbeddingProvider`、`LocalTransformersProvider`、`embedWithCache`（签名见 Locked Interfaces）。

- [ ] **Step 1: 写 failing test**

`embedding.test.mjs`（CI-safe，只用 Fake）：

```js
test('FakeEmbeddingProvider is deterministic and records provider/model version', async () => {
  const provider = new FakeEmbeddingProvider('fake-v1');
  const a = await provider.embed('折半查找');
  const b = await provider.embed('折半查找');
  assert.deepEqual(a, b);
  assert.equal(provider.providerId, 'fake-v1');
  assert.equal(typeof provider.modelVersion, 'string');
});

test('embedWithCache caches by provider+model+text and is idempotent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'emb-'));
  const provider = new FakeEmbeddingProvider('fake-v1');
  const one = await embedWithCache(provider, 'TCP', dir);
  const two = await embedWithCache(provider, 'TCP', dir);
  assert.deepEqual(one, two);
});
```

- [ ] **Step 2: 验证 FAIL**

Run: `node --test tools/question-annotation/test/embedding.test.mjs` → FAIL。

- [ ] **Step 3: 最小实现**

`EmbeddingProvider` 接口 + `FakeEmbeddingProvider`（基于确定性哈希的固定维向量）+ `embedWithCache`（cache key = providerId|modelVersion|sha256(text)，缓存 JSON 到 cacheDir）。`LocalTransformersProvider` 惰性 `await import('@huggingface/transformers')`，默认模型由 benchmark 决定前使用 `Xenova/multilingual-e5-small`（Task 9 在 Dev 上比较候选模型后持久化 winner；本 Task 只实现机制）。`package.json` 增加：

```json
{ "dependencies": { "@huggingface/transformers": "^3.4.0" } }
```

安装与验证：`cd tools/question-annotation && npm install`；本地冒烟 `node scripts/embedding-smoke.mjs --model Xenova/multilingual-e5-small`（CPU/WASM，Windows 可运行；首次下载模型写入 local-data/embedding-cache，gitignored）。CI-safe 测试不 import 真实包。

- [ ] **Step 4: 验证 PASS**

Run: `node --test tools/question-annotation/test/embedding.test.mjs` → PASS；冒烟脚本在本地成功输出一个向量维度与 modelVersion（CI 不运行该冒烟）。

- [ ] **Step 5: Regression + git check**

Run: `node --test tools/question-annotation/test/embedding.test.mjs tools/question-annotation/test/lexical.test.mjs`；`git status --short`。

- [ ] **Step 6: Commit**

```bash
git add tools/question-annotation/package.json tools/question-annotation/core/embedding.js tools/question-annotation/test/embedding.test.mjs tools/question-annotation/scripts/embedding-smoke.mjs
git commit -m "feat: add embedding provider abstraction and local provider"
```

## Task 8 — RRF Fusion + Top12 Retriever

职责：三路排名（lexical / stem embedding / analysis embedding）→ RRF + 小结构 bonus → 确定性 Top12；subject 硬过滤；bonus 不得反转明显不相关结果。

**Files:**
- Create: `tools/question-annotation/core/fusion.js`
- Create: `tools/question-annotation/core/retriever.js`
- Create: `tools/question-annotation/test/fusion.test.mjs`
- Create: `tools/question-annotation/test/retriever.test.mjs`

**Interfaces:**
- Consumes: `core/lexical.js`（`buildLexicalIndex`、`searchLexical`）、`core/embedding.js`（`EmbeddingProvider`、`embedWithCache`）。
- Produces: `FUSION_VERSION`、`fuseCandidates`、`RetrievalCandidate`、`retrieveTop12`（签名见 Locked Interfaces）。

- [ ] **Step 1: 写 failing test**

`fusion.test.mjs`：

```js
test('fuseCandidates applies RRF with k=60 and deterministic tie-break', () => {
  const input = {
    lexical: [{ nodeId: 'n1', rank: 1 }, { nodeId: 'n2', rank: 2 }],
    stemEmbedding: [{ nodeId: 'n2', rank: 1 }, { nodeId: 'n1', rank: 2 }],
    analysisEmbedding: [{ nodeId: 'n1', rank: 1 }, { nodeId: 'n2', rank: 2 }],
    kpMatched: new Set(), chapterMatched: new Set(), subjectFilter: new Set(['n1', 'n2']),
  };
  const out = fuseCandidates(input, 12);
  assert.equal(out[0].nodeId, 'n1');
  assert.ok(out.every((c) => c.finalRank >= 1 && c.retrievalReasons.length > 0));
});

test('structural bonus cannot promote a textually irrelevant node above a strongly matched one', () => {
  const input = {
    lexical: [{ nodeId: 'strong', rank: 1 }, { nodeId: 'weak-bonus', rank: 20 }],
    stemEmbedding: [{ nodeId: 'strong', rank: 1 }, { nodeId: 'weak-bonus', rank: 25 }],
    analysisEmbedding: [{ nodeId: 'strong', rank: 1 }, { nodeId: 'weak-bonus', rank: 25 }],
    kpMatched: new Set(['weak-bonus']), chapterMatched: new Set(['weak-bonus']),
    subjectFilter: new Set(['strong', 'weak-bonus']),
  };
  const out = fuseCandidates(input, 12);
  assert.equal(out[0].nodeId, 'strong');
});
```

`retriever.test.mjs`（Fake embeddings）：

```js
test('retrieveTop12 always persists Top12 and exposes Top8 view, subject-filtered', async () => {
  const candidates = await retrieveTop12(question, snapshot, { lexical, stem: fakeStem, analysis: fakeAnalysis }, cacheDir);
  assert.equal(candidates.length, 12);
  assert.ok(candidates.every((c) => c.nodeId.startsWith(subjectPrefix)));
  assert.deepEqual(candidates.slice(0, 8), candidates.slice(0, 8));
});
```

- [ ] **Step 2: 验证 FAIL**

Run: `node --test tools/question-annotation/test/fusion.test.mjs tools/question-annotation/test/retriever.test.mjs` → FAIL。

- [ ] **Step 3: 最小实现**

```js
// rrfScore(rank, k=60) = 1 / (k + rank)
// fuseCandidates: 对三路排名，各取候选并集；score = rrfSum + (kpMatched ? 0.05 : 0) + (chapterMatched ? 0.02 : 0)
//   bonus 上限约束：bonus 总和 (0.07) 小于“三路均在 top1 与三路均缺位的 rrf 差”的最小观测值；用测试锁不变量
// 排序：score desc，tie-break nodeId asc；输出 RetrievalCandidate（含各 rank 与 retrievalReasons）
// retrieveTop12: subject 硬过滤（question.subject）；lexical search + stem/analysis embed → 缓存；fuseCandidates(…, 12)
```

`FUSION_VERSION = 'rrf-k60-bonus-v1'`。

- [ ] **Step 4: 验证 PASS**

Run: `node --test tools/question-annotation/test/fusion.test.mjs tools/question-annotation/test/retriever.test.mjs` → PASS。

- [ ] **Step 5: Regression + git check**

Run: `node --test tools/question-annotation/test/lexical.test.mjs tools/question-annotation/test/embedding.test.mjs tools/question-annotation/test/fusion.test.mjs tools/question-annotation/test/retriever.test.mjs`；`git status --short`。

- [ ] **Step 6: Commit**

```bash
git add tools/question-annotation/core/fusion.js tools/question-annotation/core/retriever.js tools/question-annotation/test/fusion.test.mjs tools/question-annotation/test/retriever.test.mjs
git commit -m "feat: add rrf fusion and top12 retriever"
```

## Task 9 — Retrieval Benchmark + Gates + Final Verification

职责：benchmark runner、精确 Gate 算术、报告 JSON；安装/比较候选 embedding 模型（Dev 定 winner，Holdout 不参与选择）；Plan A 终验。

**Files:**
- Create: `tools/question-annotation/core/benchmark.js`
- Create: `tools/question-annotation/scripts/run-benchmark.mjs`
- Create: `tools/question-annotation/test/benchmark.test.mjs`

**Interfaces:**
- Consumes: `core/retriever.js`（`retrieveTop12`）、`core/sample.js`（Dev/Holdout）、Gold manifest、workspace。
- Produces: `computeBenchmarkMetrics`、`evaluateRetrievalGate`（签名见 Locked Interfaces）；`local-data/benchmark-report.json`（gitignored）。

- [ ] **Step 1: 写 failing test**

`benchmark.test.mjs`：

```js
test('computeBenchmarkMetrics produces recall metrics and per-question misses', () => {
  const runs = [/* 合成：PRIMARY 在 top8 内、只在 top12 内、缺失；SECONDARY 混合 */];
  const m = computeBenchmarkMetrics(runs);
  assert.ok(m.primaryRecallAt8 >= 0 && m.primaryRecallAt8 <= 1);
  assert.ok(m.primaryRecallAt12 >= m.primaryRecallAt8);
  assert.ok(Number.isFinite(m.macroAllRelevantAt12));
  assert.ok(Number.isFinite(m.microAllRelevantAt12));
  assert.ok(m.perQuestionMisses.length > 0);
});

test('evaluateRetrievalGate passes only with 15/16, 16/16, macro>=0.90, cross=0', () => {
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 15 / 16, primaryRecallAt12: 1, macroAllRelevantAt12: 0.95, crossSubjectCount: 0 }, 16).pass, true);
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 14 / 16, primaryRecallAt12: 1, macroAllRelevantAt12: 0.95, crossSubjectCount: 0 }, 16).pass, false);
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 15 / 16, primaryRecallAt12: 15 / 16, macroAllRelevantAt12: 0.95, crossSubjectCount: 0 }, 16).pass, false);
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 15 / 16, primaryRecallAt12: 1, macroAllRelevantAt12: 0.89, crossSubjectCount: 0 }, 16).pass, false);
  assert.equal(evaluateRetrievalGate({ primaryRecallAt8: 15 / 16, primaryRecallAt12: 1, macroAllRelevantAt12: 0.95, crossSubjectCount: 1 }, 16).pass, false);
});
```

- [ ] **Step 2: 验证 FAIL**

Run: `node --test tools/question-annotation/test/benchmark.test.mjs` → FAIL。

- [ ] **Step 3: 最小实现**

```js
// computeBenchmarkMetrics:
//   primaryRecallAtK = 命中 Gold PRIMARY 的 Holdout 题数 / 16
//   perQuestionRecall(q) = |(PRIMARY+SECONDARY) ∩ Top12| / |PRIMARY+SECONDARY|（分母恒≥1）
//   macroAllRelevantAt12 = mean(perQuestionRecall)；microAllRelevantAt12 = Σ交集 / ΣGoldRelevant（diagnostic）
//   crossSubjectCount = 候选节点 subject ≠ 题目 subject 的数量
// evaluateRetrievalGate: primaryRecallAt8 >= 15/16 && primaryRecallAt12 >= 16/16 && macroAllRelevantAt12 >= 0.90 && crossSubjectCount === 0
```

`run-benchmark.mjs`：加载 snapshot + workspace + Gold manifest → 对 Dev 24 与 Holdout 16 分别 `retrieveTop12` → 输出报告；embedding 模型选择：在 Dev 上比较 `Xenova/multilingual-e5-small` 与 `Xenova/bge-small-zh-v1.5`，以 Dev PRIMARY Recall@8 高者胜出（平手取先列模型），选中的 provider/modelVersion 写入报告；**Holdout 在选型期间不可查看**（runner 先只跑 Dev 选型，再一次性跑 Holdout 并输出最终指标）。本地执行：

```bash
cd tools/question-annotation
node scripts/run-benchmark.mjs --snapshot local-data/snapshot-<id>.json --gold local-data/gold-set-v1.json
```

输出 `RETRIEVAL_GATE_PASS` 或 `RETRIEVAL_GATE_FAIL`。FAIL 时不得自动进入 Plan B。

- [ ] **Step 4: 验证 PASS**

Run: `node --test tools/question-annotation/test/benchmark.test.mjs` → PASS。随后在本地实际运行 `run-benchmark.mjs` 至少一次并记录报告（真实模型 benchmark 为 local gate，CI 不运行）。

- [ ] **Step 5: 最终全量验证（CI-safe）**

Run:

```bash
node --test tools/question-annotation/test
npm test
npm run build:shared
node --test test/score-center-bridge-matcher.test.mjs test/score-center-bridge-audit.test.mjs test/score-center-data.test.mjs
```

另：`node tools/question-annotation/scripts/export-snapshot.mjs --validate-only`（snapshot 校验）、workspace 校验、`gold-author.mjs status`（manifest 校验）在本地数据存在时执行并记录。

- [ ] **Step 6: git check**

Run: `git status --short`、`git diff --cached --name-only`；确认 local-data 与 benchmark 报告未进入暂存。

- [ ] **Step 7: Commit**

```bash
git add tools/question-annotation/core/benchmark.js tools/question-annotation/scripts/run-benchmark.mjs tools/question-annotation/test/benchmark.test.mjs
git commit -m "feat: add retrieval benchmark and gates"
```

## Plan Self-Review（writing-plans）

1. **Spec coverage（Phase 0–2）**：snapshot（T1/T2）、workspace（T3）、Gold sampling + Dev/Holdout（T4）、Gold authoring（T5）、lexical（T6）、embedding（T7）、fusion/Top12（T8）、benchmark+gate（T9）逐项对应 Design Spec §5–§21 与 §40；§40 的 Gate 算术与 abstain/denominator 语义在 Plan B 阶段实现（本 Plan 明确不实现 AI provider，属 Plan B 范围）。
2. **Placeholder scan**：全文无 TBD/TODO/“choose later”/“similar to previous task”；所有公式、下标、命令、commit message 已写死；embedding 候选模型为具名候选（Dev 定 winner），非占位。
3. **Type consistency**：`classifyRoles/validateSnapshot/fingerprintPayloadHash/sampleGoldQuestionIds/splitDevHoldout/buildGoldManifest/validateGoldEntry/tokenize/buildLexicalIndex/searchLexical/EmbeddingProvider/embedWithCache/fuseCandidates/retrieveTop12/computeBenchmarkMetrics/evaluateRetrievalGate` 在 Locked Interfaces 定义且各 Task 引用一致。
4. **Scope check**：无 Plan B（AI provider/326 suggestions/Review UI）、无 Plan C（production tag seed/resolver/mastery）内容；production 只读 acceptance 属允许的只读验证。
