# Retrieval V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement Retrieval V2 (multi-view semantic retrieval + deterministic canonical labeled hierarchical passage) on a new 100-question Gold benchmark, select the V2 configuration on the new 72-question DEV set only, and run a one-shot 28-question blind HOLDOUT gate. Retrieval V1 remains frozen and untouched.

**Architecture:** Semantic-only V2. Query views (stem / analysis) → E5 embeddings (unchanged model) → per-view full same-subject rankings over active atomic nodes → RRF (k=60) over the two semantic views → Top12. Passages are built by either the V1 unlabeled builder (P1) or the V2 canonical labeled hierarchical builder (P2). No lexical channel, no structural bonus, no AI.

**Tech Stack:** Node 24 (`node:test`, `node:sqlite`), existing `@huggingface/transformers` 3.8.1, existing E5 provider and embedding cache, existing Gold authoring CLI. Reuses current `core/sample.js`, `core/gold.js`, `core/lexical.js`, `core/embedding.js`, `core/benchmark.js`, `core/retriever.js` without modifying V1 behavior.

## Global Constraints

- Source of truth: `docs/superpowers/specs/2026-08-09-retrieval-v2-design.md` (highest), plus `docs/superpowers/specs/2026-08-09-retrieval-v1-failure-postmortem.md` and the V1 plan/spec as history.
- Retrieval V1 is permanent: `semantic-e5-v1` config SHA `3533ed7aa0e1635a942a2dce823a17fb4fb8cc336fe24ea4a95cd09ed88443b7`; V1 artifacts and gate history are never rewritten.
- Model is frozen for every experiment: `Xenova/multilingual-e5-small`, revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`, transformers.js 3.8.1, query `query: ` / passage `passage: `, pooling mean, L2, 384 dims.
- Pre-registered experiment matrix is exactly `Q1P1 / Q1P2 / Q2P1 / Q2P2`. No Q3/P3/variant D–G/new model/weighted similarity/new k/lexical hybrid.
- Data roles are locked: old V1 Gold 40 = regression/diagnostic only; new V2 DEV 72 = the only source for final configuration selection; new V2 HOLDOUT 28 = the only blind final gate. Merging old 40 + new 72 into a 112-question selection set is forbidden.
- Old consumed HOLDOUT (16) is regression/diagnostic only and never a final test.
- No code may create Gold truth: Gold is human-authored only, with retriever output never used as an oracle.
- Sampling history is immutable: `gold-sample-v2` SHA `439f3527666784bb6a5ebe73ab44871e732846f59a0482b4543036eb8492a2fc` and `gold-sample-v2r` SHA `368c025c8438d7a7e73efcfb4df73d90b7479e92ef64d6ecf4a19971e9590854` are both `REJECTED_PRE_SPLIT_SAMPLE`; neither may be overwritten, split, authored, benchmarked, or evaluated.
- Every code task follows TDD: RED → verify RED → minimal GREEN → focused GREEN → regression → explicit git add → commit. No `git add .` / `git add -A`. No push.
- Working tree: `C:\Users\Lenovo\Documents\计算机考研提分系统\.worktrees\feature\live-question-atomic-bridge`, branch `feature/live-question-atomic-bridge`.

## Locked Versions and Contracts (used across tasks)

```text
QUERY_VIEW_VERSION            = query-views-v2
PASSAGE_VERSION               = knowledge-node-passage-v2
PASSAGE_FORMAT                = canonical-labeled-hierarchical-passage-v2
SEMANTIC_AGGREGATION_VERSION  = semantic-rrf-v2
SEMANTIC_RETRIEVER_VERSION    = semantic-retriever-v2
V2_GOLD_VERSION               = gold-truth-v2
V2_BENCHMARK_VERSION          = retrieval-benchmark-v2

QueryView { type: 'stem' | 'analysis'; content: string }
Passage P2 format: 考点：<name> 章节：<chapterName> 小节：<sectionName>
RRF contribution: 1 / (60 + rank); k = 60
Final ranking: rrfScore DESC, then nodeId ASC
TopK: Top12 expanded; Top8 initial view of the same list
Final V2 Holdout Gate (28): Recall@8 >= 27/28 (96.43%), Recall@12 = 28/28 (100%), Macro AllRelevant@12 >= 0.90, safety counters all zero
```

## Refined Locked Contracts (2026-08-09)

### 1. Difficulty quota — exact integers (no tolerance)

```text
per subject (25): BASIC 10 / MEDIUM 10 / HARD 5
global (100):     BASIC 40 / MEDIUM 40 / HARD 20
```

Any subject unable to satisfy exactly 10/10/5 → `BLOCKED` with a shortage diagnostic (which subject/bucket and shortfall count). No automatic relaxation to 9/11/5, 11/9/5, or any "within tolerance" acceptance.

### 2. Required V2 KnowledgePoint set — canonical source

Audited from the frozen snapshot (`snap-399242fb3d7f`):

```text
production KnowledgePoint rows: 18
required V2 KP count:           16
canonical source: REQUIRED_V2_KP_SET = { knowledgePointId | ∃ eligible (INDEPENDENT_UNIT, current) question q with relation (q.id, knowledgePointId) }
why 16 vs 18: the other 2 rows (os-memory-1785901175429, os-memory-1785938815312, both titled 分页与地址转换) have zero question relations (eligible or otherwise) in the snapshot; they are orphan rows and cannot be sampled. The 16 required KPs match the V1 gold coverage contract and are all referenced by ≥1 eligible question.
```

Exact set:

```text
CO: co-cache (Cache 映射与替换), co-cpu (数据通路与控制器), co-data (补码、浮点数与溢出判断), co-instruction (寻址方式与指令格式)
DS: ds-graph (图的遍历与最短路径), ds-list (线性表结构与操作), ds-sort (排序算法复杂度与稳定性), ds-tree (树的遍历应用)
CN: net-app (DNS、HTTP 与邮件协议), net-ip (IP、子网划分与路由), net-link (差错控制、流量控制与 MAC), net-tcp (TCP 可靠传输)
OS: os-file (文件分配、目录与磁盘调度), os-memory (分页、分段与虚拟内存), os-process (进程状态、调度与上下文切换), os-sync (进程同步与互斥)
```

Every active V2 sampling version computes this set programmatically and fails closed if its size is not 16 or if any required KP has zero eligible questions.

### 3. Analysis view availability — exact rule (no heuristic threshold)

```text
normalizedAnalysis = normalizeText(analysis ?? '')
usable = normalizedAnalysis.length > 0
```

`null`, `undefined`, `""`, whitespace-only → analysis unavailable → stem-only fallback. Any non-empty normalized analysis → analysis view participates. No "too short", "template detection", or token-count heuristic in V2 first version (this supersedes the design draft's "<5 characters" example; such heuristics would require a future Design amendment).

### 4. PRIMARY MRR — exact formula

```text
RR(q) = 1 / rank(PRIMARY(q))   if PRIMARY in the retrieved set (rank >= 1)
RR(q) = 0                      if PRIMARY not retrieved
PrimaryMRR = mean(RR(q)) over exactly the 72 V2 DEV questions
```

SECONDARY never participates in MRR.

### 5. Final selection — fully deterministic

```text
1. higher PRIMARY Recall@12
2. higher PRIMARY Recall@8
3. higher Macro AllRelevantRecall@12
4. higher PRIMARY MRR
5. lower complexityCost
6. experimentId ASC

complexityCost: Q1P1=0, Q1P2=1, Q2P1=1, Q2P2=2
experimentId ASC: Q1P1 < Q1P2 < Q2P1 < Q2P2
```

Even if Q1P2 and Q2P1 tie on all metrics and complexityCost, experimentId ASC selects Q1P2 — never a manual decision.

### 6. Sampling determinism

```text
hard constraints (violation = fail closed):
  100 unique; 25/subject; exactly four subject KPs; KP totals are 7/6/6/6 (7 + 6 + 6 + 6 = 25);
  BASIC/MEDIUM/HARD = 10/10/5 per subject; all current INDEPENDENT_UNIT;
  old Gold id/fingerprint/family excluded; every selected question has exactly one required KP relation
joint solve: KP totals and difficulty totals must be satisfied simultaneously over unique questions
matrix objective, in exact priority order:
  1) minimize max HARD count across the four KPs
  2) minimize HARD range (max HARD - min HARD)
  3) minimize Σ[(5B-2t)^2 + (5M-2t)^2 + (5H-t)^2], t=B+M+H per KP
  4) extra-7 owner: higher eligible total, then knowledgePointId ASC
  5) canonical matrix [knowledgePointId,BASIC,MEDIUM,HARD] lexicographic ASC
question selection after matrix freeze: questionId ASC within each KP × difficulty cell
forbidden objectives: chapter/source/year diversity (not discriminative in the frozen eligible pool)
forbidden relaxation: 5–8 KP ranges, difficulty tolerance, greedy fallback, or partial sample
```

The same snapshot always yields the same 100 ids. If any subject has no exact assignment, return `SAMPLING DESIGN BLOCKED` with its KP × difficulty audit and stop.

### 7. Gold V1/V2 core — one canonical implementation

`createGoldSetV2` / `loadGoldSetV2` / `freezeGoldManifestV2` are THIN wrappers that delegate to the shared parameterized `createGoldSet` / `loadGoldSet` / `freezeGoldManifest` with `GOLD_CONTRACT_V2`. There is exactly one canonical validation, one canonical manifest hash, and one canonical freeze implementation. No duplicated V2 hashing/freezing logic (explicitly forbidden — the Task 5C drift class must not recur).

### 8. Rejected pre-split samples and replacement identity

```text
rejected file 1:  local-data/gold-sample-v2.json
rejected SHA 1:   439f3527666784bb6a5ebe73ab44871e732846f59a0482b4543036eb8492a2fc
reason 1:         severe KP concentration
rejected file 2:  local-data/gold-sample-v2r.json
rejected SHA 2:   368c025c8438d7a7e73efcfb4df73d90b7479e92ef64d6ecf4a19971e9590854
reason 2:         severe difficulty × KP concentration (HARD 4/1/0/0 in all subjects)
status:           both are REJECTED_PRE_SPLIT_SAMPLE
next version:     gold-sample-v2r2
next file:        local-data/gold-sample-v2r2.json
```

Both rejected files are retained unchanged as historical evidence. They are forbidden as input to V2-2, V2-3, V2 DEV experiments, and the final HOLDOUT. V2-1R2 must write a third file and prove both rejected manifest SHAs and file SHAs are unchanged before and after generation.

---

# Task V2-1 — Versioned Gold V2 Sample Contract (HISTORICAL; OUTPUT REJECTED)

**Historical status:** implementation commit `bb6544e` passed the original hard constraints, but real manifest SHA `439f3527666784bb6a5ebe73ab44871e732846f59a0482b4543036eb8492a2fc` is `REJECTED_PRE_SPLIT_SAMPLE`. This task is retained for traceability and must not be rerun as the active sampling contract. V2-1R supersedes its sampling acceptance.

**Goal:** deterministic 100-question V2 sample (25 per subject) from the remaining independent current question pool, with old-Gold exclusion, KP coverage, difficulty target, fingerprint identity, and a Git-safe manifest. No human truth is started.

**Files:**
- Create: `tools/question-annotation/core/sampleV2.js`
- Create: `tools/question-annotation/test/sampleV2.test.mjs`

**Interfaces:**
```ts
const V2_GOLD_SAMPLE_VERSION = 'gold-sample-v2';
const V2_TOTAL = 100; const V2_PER_SUBJECT = 25;
const REQUIRED_V2_KP_SET: ReadonlySet<string>;   // computed from eligible-referenced KPs; must equal the 16 listed in Refined Contract 2
function computeRequiredV2KpSet(snapshot: AnnotationSnapshot): ReadonlySet<string>;
function sampleV2QuestionIds(snapshot: AnnotationSnapshot, oldGoldIds: ReadonlySet<string>, oldGoldFingerprints: ReadonlySet<string>, oldGoldFamilies: ReadonlySet<string>): string[];
function buildV2SampleManifest(input: { snapshotId: string; contentSha256: string; goldVersion: string; entries: Array<{ questionId: string; contentFingerprint: string; subject: string; difficulty: string; source: string; year: number | null }> }): Record<string, unknown>;
function validateV2SampleManifest(manifest: Record<string, unknown>, snapshot: AnnotationSnapshot): { ok: boolean; errors: string[] };
```

**Preconditions:** frozen snapshot `snap-399242fb3d7f` and `gold-truth-manifest-v1.json` exist in `local-data/`; V1 sample functions are untouched.

**RED test** (`sampleV2.test.mjs`, synthetic fixture of ≥ 25 independent current questions per subject plus old-Gold rows, exact duplicates, version duplicates and historical rows):

```text
'V2-1: excludes old V1 gold ids'            — sampleV2QuestionIds ∩ oldGoldIds = ∅
'V2-1: excludes old gold exact fingerprints' — no selected contentFingerprint equals any oldGoldFingerprint
'V2-1: excludes old gold version families'   — no selected familyId equals any oldGoldFamilies
'V2-1: selects only current INDEPENDENT_UNIT' — every selected id is current and role INDEPENDENT_UNIT
'V2-1: returns exactly 100 unique ids'       — new Set(ids).size === 100
'V2-1: 25 per subject'                       — counts === {DS:25, CO:25, OS:25, CN:25}
'V2-1: required KP set is the canonical 16'  — computeRequiredV2KpSet(snapshot).size === 16 and equals the listed set
'V2-1: covers all 16 required KPs'           — every REQUIRED_V2_KP_SET id has ≥1 selected question
'V2-1: difficulty exact 10/10/5 per subject' — counts per subject === {BASIC:10, MEDIUM:10, HARD:5}
'V2-1: difficulty exact global 40/40/20'     — global counts === {BASIC:40, MEDIUM:40, HARD:20}
'V2-1: deterministic for same snapshot'      — two runs deepEqual
'V2-1: shortage fails closed'                — subject with <25 eligible throws with subject name
'V2-1: difficulty shortage fails closed'     — subject missing 10 BASIC or 10 MEDIUM or 5 HARD throws with bucket diagnostic
'V2-1: manifest sha canonical'               — same input → same sha; any field change → different sha
'V2-1: manifest is Git-safe'                 — no stem/options/answer/analysis keys
```

**RED command:** `node --test tools/question-annotation/test/sampleV2.test.mjs`

**Expected RED:** `ERR_MODULE_NOT_FOUND` for `../core/sampleV2.js` (interface missing).

**Minimal implementation:** in `core/sampleV2.js`, deterministic stratified sampler:

```js
// 1) eligible = current AND role INDEPENDENT_UNIT AND not in oldGoldIds
//    AND fingerprint not in oldGoldFingerprints AND family not in oldGoldFamilies
// 2) group by subject; sort each subject's eligible by (questionId) ASC
// 3) compute REQUIRED_V2_KP_SET from eligible-referenced KPs; fail closed if != 16 or any required KP has 0 eligible
// 4) per subject: phase A pick one question per required KP (sorted kpId, then questionId, skip picked)
// 5) per subject: enforce exact difficulty quotas 10 BASIC / 10 MEDIUM / 5 HARD by selecting the
//    next question of the required bucket in questionId ASC order; shortage -> BLOCKED diagnostic
// 6) per subject: fill remaining slots with deterministic diversity objective
//    (minimize repetition of chapter/source/year against already-selected, tie-break questionId ASC)
// 7) fail closed if any subject < 25
// 8) buildV2SampleManifest: canonical sorted entries + sha256; validateV2SampleManifest checks counts,
//    uniqueness, subject codes, fingerprint presence, KP coverage, difficulty bucket tolerance
```

**GREEN command:** `node --test tools/question-annotation/test/sampleV2.test.mjs`

**Expected GREEN:** all `sampleV2.test.mjs` tests pass.

**Regression command:** `node --test tools/question-annotation/test/sample.test.mjs tools/question-annotation/test/sampleV2.test.mjs`

**Acceptance criteria:** 100 unique ids, 25/subject, exact 10/10/5 per subject and 40/40/20 global, canonical 16-KP coverage, deterministic, fail-closed shortage (subject and difficulty buckets), manifest SHA canonical, Git-safe (no question text), V1 sample tests still pass.

**Explicit git add:** `git add tools/question-annotation/core/sampleV2.js tools/question-annotation/test/sampleV2.test.mjs`

**Commit message:** `feat: add v2 gold sample contract`

**Stop condition:** V2-1 output is rejected. Task V2-2 remains blocked; proceed only to V2-1R.

---

# Task V2-1R — Balanced-KP Replacement Sample Contract (HISTORICAL; OUTPUT REJECTED)

**Historical status:** implementation commit `a54f75d` passed the balanced-KP code contract. Real manifest SHA `368c025c8438d7a7e73efcfb4df73d90b7479e92ef64d6ecf4a19971e9590854` is `REJECTED_PRE_SPLIT_SAMPLE` because every subject produced HARD spread `4/1/0/0`. Retain this task and artifact for traceability; do not rerun it as the active sampling contract. V2-1R2 supersedes only its matrix-selection objective.

**Goal:** generate a new deterministic 100-question sample that jointly satisfies exact KP balance (`7/6/6/6` per subject) and exact difficulty quotas (`10/10/5` per subject), while preserving the rejected pre-split sample unchanged. No split or Gold truth is created.

**Files:**
- Modify: `tools/question-annotation/core/sampleV2.js`
- Modify: `tools/question-annotation/test/sampleV2.test.mjs`
- Create locally only (gitignored): `tools/question-annotation/local-data/gold-sample-v2r.json`
- Preserve byte-for-byte: `tools/question-annotation/local-data/gold-sample-v2.json`

**Interfaces (additive; historical V2-1 exports remain available):**

```ts
const V2R_GOLD_SAMPLE_VERSION = 'gold-sample-v2r';
const V2_REJECTED_PRE_SPLIT_SAMPLE_SHA256 = '439f3527666784bb6a5ebe73ab44871e732846f59a0482b4543036eb8492a2fc';
const V2_KP_MIN_PER_SUBJECT = 6;
const V2_KP_MAX_PER_SUBJECT = 7;

type V2KpDifficultyAuditRow = {
  subject: 'DS' | 'CO' | 'OS' | 'CN';
  knowledgePointId: string;
  eligible: number;
  BASIC: number;
  MEDIUM: number;
  HARD: number;
};

function auditV2RSamplingFeasibility(
  snapshot: AnnotationSnapshot,
  oldGold: OldGoldLineage,
): {
  feasible: boolean;
  rows: V2KpDifficultyAuditRow[];
  errors: string[];
};

function sampleV2RQuestionIds(
  snapshot: AnnotationSnapshot,
  oldGold: OldGoldLineage,
): string[];

function buildV2RSampleManifest(input: {
  snapshotId: string;
  contentSha256: string;
  entries: GoldSampleEntry[];
}): Record<string, unknown>;

function validateV2RSampleManifest(
  manifest: Record<string, unknown>,
  snapshot: AnnotationSnapshot,
  oldGold: OldGoldLineage,
): { ok: boolean; errors: string[] };
```

**Locked solver contract:**

For each subject, exact feasibility is checked as a four-option flow problem: each of the four KPs is considered as the 7-question owner while the other three have quota 6. For an option, the network is:

```text
source
  → difficulty bucket (exact capacities BASIC=10, MEDIUM=10, HARD=5)
  → eligible question (capacity 1)
  → its sole required KP (capacity 1)
  → sink (exact capacity 7 for one KP, 6 for the other three)
```

The candidate pool is sorted by `questionId ASC`. To construct the canonical sample, visit candidates in that order and tentatively include each candidate only when an exact completion still exists for at least one 7-owner option; otherwise exclude it. Stop after the lexicographically first feasible 25-id subject set is fixed. Chapter/source/year never enter feasibility or ordering.

- [x] **Step 1: Add RED tests for replacement identity and rejected-sample isolation**

Add assertions equivalent to:

```js
assert.equal(V2R_GOLD_SAMPLE_VERSION, 'gold-sample-v2r');
assert.equal(
  V2_REJECTED_PRE_SPLIT_SAMPLE_SHA256,
  '439f3527666784bb6a5ebe73ab44871e732846f59a0482b4543036eb8492a2fc',
);
assert.notEqual(buildV2RSampleManifest(input).goldVersion, V2_GOLD_SAMPLE_VERSION);
assert.match(
  validateV2RSampleManifest(rejectedManifest, snapshot, oldGold).errors.join('\n'),
  /REJECTED_PRE_SPLIT_SAMPLE/,
);
```

- [x] **Step 2: Add RED tests for the exact joint contract**

Add these named cases to `sampleV2.test.mjs`:

```text
'V2-1R: returns exactly 100 unique ids and 25 per subject'
'V2-1R: each subject KP count multiset is exactly [6,6,6,7]'
'V2-1R: each subject difficulty is exactly BASIC 10 MEDIUM 10 HARD 5'
'V2-1R: every selected question has exactly one required KP relation'
'V2-1R: old V1 id/fingerprint/family exclusions remain exact'
'V2-1R: input ordering does not change ids'
'V2-1R: changing chapter/source/year does not change ids'
'V2-1R: same input produces the same ids and manifest SHA'
'V2-1R: marginal sufficiency without a joint integer solution fails closed'
'V2-1R: KP count outside 6/7 fails validation'
'V2-1R: difficulty drift fails validation'
```

The “marginal sufficiency” fixture must give every KP at least 7 total questions and the subject at least 10/10/5 by difficulty, while arranging KP × difficulty cells so no simultaneous `7/6/6/6 + 10/10/5` flow reaches 25. Expected error contains `SAMPLING DESIGN BLOCKED`, subject, KP id, and difficulty counts.

- [x] **Step 3: Run the focused test and verify RED**

Run:

```bash
node --test tools/question-annotation/test/sampleV2.test.mjs
```

Expected: failures identify missing `V2R_GOLD_SAMPLE_VERSION`, `auditV2RSamplingFeasibility`, `sampleV2RQuestionIds`, `buildV2RSampleManifest`, and `validateV2RSampleManifest`; historical V2-1 assertions remain green.

- [x] **Step 4: Implement exact feasibility and canonical selection**

Implement the additive interfaces in `core/sampleV2.js`. Reuse `buildV2EligiblePool`, `computeRequiredV2KpSet`, `canonicalJsonHash`, and the existing manifest field whitelist. Do not change `sampleV2QuestionIds` or the historical `gold-sample-v2` builder behavior.

The implementation must:

```text
1. Build the after-V1-exclusion pool.
2. Require 16 required KPs and exactly four per subject.
3. Build and return the full KP × difficulty audit before selection.
4. Fail closed on any candidate used by the solver that has zero or multiple required KP relations.
5. Check exact completion for each possible 7-owner KP; never use a greedy fallback.
6. Construct the lexicographically first feasible questionId set.
7. Validate 100 unique, 25/subject, KP [6,6,6,7], difficulty 10/10/5, lineage exclusion, and canonical SHA.
8. Reject the historical manifest SHA with status REJECTED_PRE_SPLIT_SAMPLE.
```

- [x] **Step 5: Run focused GREEN and V1/V2 sample regression**

Run:

```bash
node --test tools/question-annotation/test/sampleV2.test.mjs
node --test tools/question-annotation/test/sample.test.mjs tools/question-annotation/test/sampleV2.test.mjs
```

Expected: all tests pass with zero new failures; historical V1 and V2-1 tests remain green.

- [x] **Step 6: Generate the real replacement without touching rejected evidence**

Before generation, record both the internal manifest SHA and file SHA of `gold-sample-v2.json`. Generate only `gold-sample-v2r.json`, then re-read both files and assert:

```text
old internal SHA before = old internal SHA after = 439f3527666784bb6a5ebe73ab44871e732846f59a0482b4543036eb8492a2fc
old file SHA before = old file SHA after
new goldVersion = gold-sample-v2r
new manifest SHA != rejected SHA
new validation ok = true
new manifest contains no stem/options/answer/analysis
new manifest contains no split
```

Do not stage either local-data file.

- [x] **Step 7: Run the real Sample Quality Audit and stop at the human gate**

Report, for all 16 KPs, selected total and BASIC/MEDIUM/HARD. Required acceptance:

```text
100 total; 25/subject; KP counts exactly 7/6/6/6 per subject;
difficulty exactly 10/10/5 per subject; V1 overlaps id/fingerprint/family = 0;
rejected file unchanged; no DEV/HOLDOUT split fields
```

Stop and request explicit human acceptance of the new manifest SHA. V2-2 is still forbidden at this point.

- [x] **Step 8: Stage code/tests explicitly and commit only if the user requests Git writes**

```bash
git add tools/question-annotation/core/sampleV2.js tools/question-annotation/test/sampleV2.test.mjs
git commit -m "fix: balance retrieval v2 gold sample"
```

Never use `git add .` or `git add -A`; never stage local-data.

**Historical stop result:** V2-1R code passed, but the real sample was not accepted. `gold-sample-v2r.json` is permanently rejected and V2-2 remains blocked. Proceed only to V2-1R2.

---

# Task V2-1R2 — Difficulty Spread Replacement Sample Contract

**Goal:** generate a third deterministic 100-question sample that preserves the exact V2-1R hard constraints while selecting the KP × difficulty allocation matrix with the pre-registered five-level Difficulty Spread objective. Preserve both rejected samples unchanged. No split or Gold truth is created.

**Files:**
- Modify: `tools/question-annotation/core/sampleV2.js`
- Modify: `tools/question-annotation/test/sampleV2.test.mjs`
- Create locally only (gitignored): `tools/question-annotation/local-data/gold-sample-v2r2.json`
- Preserve byte-for-byte: `tools/question-annotation/local-data/gold-sample-v2.json`
- Preserve byte-for-byte: `tools/question-annotation/local-data/gold-sample-v2r.json`

**Interfaces (additive; historical V2-1 and V2-1R exports and outputs remain unchanged):**

```ts
const V2R2_GOLD_SAMPLE_VERSION = 'gold-sample-v2r2';
const V2R_REJECTED_PRE_SPLIT_SAMPLE_SHA256 = '368c025c8438d7a7e73efcfb4df73d90b7479e92ef64d6ecf4a19971e9590854';

type V2R2MatrixRow = {
  knowledgePointId: string;
  BASIC: number;
  MEDIUM: number;
  HARD: number;
};

type V2R2MatrixScore = {
  maxHard: number;
  hardRange: number;
  difficultyDeviationCost: number;
  extraSevenEligible: number;
  extraSevenKpId: string;
  canonicalMatrix: Array<[string, number, number, number]>;
};

function scoreV2R2Matrix(
  rows: V2R2MatrixRow[],
  eligibleTotalByKp: ReadonlyMap<string, number>,
): V2R2MatrixScore;

function compareV2R2MatrixScores(left: V2R2MatrixScore, right: V2R2MatrixScore): number;

function sampleV2R2QuestionIds(
  snapshot: AnnotationSnapshot,
  oldGold: OldGoldLineage,
): string[];

function buildV2R2SampleManifest(input: {
  snapshotId: string;
  contentSha256: string;
  entries: GoldSampleEntry[];
}): Record<string, unknown>;

function validateV2R2SampleManifest(
  manifest: Record<string, unknown>,
  snapshot: AnnotationSnapshot,
  oldGold: OldGoldLineage,
): { ok: boolean; errors: string[] };
```

**Locked hard constraints:**

```text
100 unique; 25/subject
four required KPs per subject; selected totals are exactly 7/6/6/6
BASIC/MEDIUM/HARD are exactly 10/10/5 per subject and 40/40/20 globally
current INDEPENDENT_UNIT only
V1 questionId, exact fingerprint, and version family overlap are all zero
every selected question has exactly one subject-local required KP relation
no greedy fallback, partial sample, 5–8 tolerance, or difficulty relaxation
```

**Locked matrix comparator:**

For every hard-feasible matrix, compute the score below. `compareV2R2MatrixScores(a, b) < 0` means `a` is preferred.

```js
// Objective 1: lower maxHard wins.
score.maxHard = Math.max(...rows.map((row) => row.HARD));

// Objective 2: lower hardRange wins.
score.hardRange = score.maxHard - Math.min(...rows.map((row) => row.HARD));

// Objective 3: lower integer composition deviation wins.
score.difficultyDeviationCost = rows.reduce((sum, row) => {
  const t = row.BASIC + row.MEDIUM + row.HARD;
  return sum
    + (5 * row.BASIC - 2 * t) ** 2
    + (5 * row.MEDIUM - 2 * t) ** 2
    + (5 * row.HARD - t) ** 2;
}, 0);

// Objective 4: higher eligible total for the 7-owner, then kp id ASC.
// Objective 5: rows sorted by kp id and compared as [kpId,BASIC,MEDIUM,HARD] ASC.
```

The comparator order is exact:

```text
1. maxHard ASC
2. hardRange ASC
3. difficultyDeviationCost ASC
4. extraSevenEligible DESC
5. extraSevenKpId ASC
6. canonicalMatrix lexicographic ASC
```

Items 4 and 5 above are the two sub-steps of Design Objective 4; canonical matrix comparison is Design Objective 5. `questionId` is absent from this comparator. After the winning matrix is frozen, each KP × difficulty cell selects `questionId ASC`. Source, chapter, and year remain diagnostics only.

**Read-only real-data expectation (not hardcoded):**

The implementation must recompute these values from the frozen pool. They are pre-registered expected evidence, not constants used by the solver.

The observed `2/1/1/1` patterns are not additional hard quotas. The implementation always minimizes the locked objectives over whatever matrices satisfy availability; it never requires every KP to contain a HARD question.

| Subject | minimum maxHard | winning HARD pattern in KP-id order | extra-7 owner | deviation |
|---|---:|---|---|---:|
| DS | 2 | ds-graph 1 / ds-list 1 / ds-sort 2 / ds-tree 1 | ds-graph | 58 |
| CO | 2 | co-cache 1 / co-cpu 2 / co-data 1 / co-instruction 1 | co-cache | 58 |
| OS | 2 | os-file 1 / os-memory 2 / os-process 1 / os-sync 1 | os-file | 58 |
| CN | 2 | net-app 1 / net-ip 2 / net-link 1 / net-tcp 1 | net-app | 58 |

- [ ] **Step 1: Add RED tests for third-version identity and immutable history**

Add assertions equivalent to:

```js
assert.equal(V2R2_GOLD_SAMPLE_VERSION, 'gold-sample-v2r2');
assert.equal(
  V2R_REJECTED_PRE_SPLIT_SAMPLE_SHA256,
  '368c025c8438d7a7e73efcfb4df73d90b7479e92ef64d6ecf4a19971e9590854',
);
assert.notEqual(buildV2R2SampleManifest(input).goldVersion, 'gold-sample-v2');
assert.notEqual(buildV2R2SampleManifest(input).goldVersion, 'gold-sample-v2r');
assert.match(validateV2R2SampleManifest(rejectedV2, snapshot, oldGold).errors.join('\n'), /REJECTED_PRE_SPLIT_SAMPLE/);
assert.match(validateV2R2SampleManifest(rejectedV2R, snapshot, oldGold).errors.join('\n'), /REJECTED_PRE_SPLIT_SAMPLE/);
```

- [ ] **Step 2: Add RED tests for every matrix objective in priority order**

Add independently discriminating fixtures:

```text
'V2-1R2 objective 1: maxHard 2 beats maxHard 3 regardless of later costs'
'V2-1R2 objective 2: HARD range 1 beats range 2 when maxHard ties'
'V2-1R2 objective 3: lower locked integer deviation wins after HARD ties'
'V2-1R2 objective 3: deviation uses exact integer formula and no floating point'
'V2-1R2 objective 4: higher eligible total wins extra-7 ownership'
'V2-1R2 objective 4: knowledgePointId ASC breaks equal eligible-total ties'
'V2-1R2 objective 5: canonical [kpId,B,M,H] matrix order is the final tie-break'
```

Each test changes only the criterion named in that test while all earlier criteria tie.

- [ ] **Step 3: Add RED end-to-end sampling regressions**

```text
'V2-1R2: preserves 100, 25/subject, KP [6,6,6,7], and difficulty 10/10/5'
'V2-1R2: replaces feasible 4/1/0/0 with optimal 2/1/1/1'
'V2-1R2: matrix freezes before questionId ASC cell selection'
'V2-1R2: input ordering does not change ids or manifest SHA'
'V2-1R2: changing source/chapter/year does not change ids'
'V2-1R2: V1 id/fingerprint/family exclusions remain zero'
'V2-1R2: no hard-feasible matrix fails closed with KP × difficulty diagnostics'
'V2-1R2: validator rejects KP, difficulty, HARD-objective, or version drift'
```

- [ ] **Step 4: Run focused tests and verify behavior RED**

Run:

```bash
node --test tools/question-annotation/test/sampleV2.test.mjs
```

Expected: new V2-1R2 assertions fail because the V2R2 version, score/comparator, sampler, builder, and validator are missing. Historical V2-1 and V2-1R assertions remain green. A behavior fixture must show the historical V2R objective selecting `4/1/0/0` while the expected V2R2 result is `2/1/1/1`; a module-resolution failure alone is insufficient RED evidence.

- [ ] **Step 5: Implement exhaustive hard-feasible matrix ranking and cell selection**

Reuse `buildV2EligiblePool`, `computeRequiredV2KpSet`, the existing KP × difficulty availability construction, canonical manifest hashing, and the historical validators without changing their outputs. Enumerate every integer row allocation permitted by availability and exact row/column totals, score each complete matrix, and retain the minimum under `compareV2R2MatrixScores`. Do not prune on question ids or diagnostic metadata. After the matrix winner is fixed, take the lowest `questionId ASC` entries required by each cell. `validateV2R2SampleManifest` recomputes the canonical V2R2 selection from the same snapshot and V1 lineage and rejects a manifest whose sorted ids differ, so a hard-feasible but objectively inferior matrix cannot validate.

Fail closed with `SAMPLING DESIGN BLOCKED` plus subject and all KP × difficulty availability counts when no complete matrix exists. Do not introduce an external solver dependency.

- [ ] **Step 6: Run focused GREEN and all sampling regressions**

Run:

```bash
node --test tools/question-annotation/test/sampleV2.test.mjs
node --test tools/question-annotation/test/sample.test.mjs tools/question-annotation/test/gold.test.mjs tools/question-annotation/test/sampleV2.test.mjs
cd tools/question-annotation && npm test
cd ../.. && npm test
```

Expected: zero failures; historical V1, V2-1, and V2-1R behavior remains reproducible; V2-1R2 tests pass.

- [ ] **Step 7: Generate only `gold-sample-v2r2.json` and prove both rejected artifacts unchanged**

Before generation, record internal manifest SHA and file SHA for both rejected files. Refuse overwrite if `gold-sample-v2r2.json` already exists. Generate only the new local file, validate it, then prove:

```text
gold-sample-v2 internal SHA before/after = 439f3527666784bb6a5ebe73ab44871e732846f59a0482b4543036eb8492a2fc
gold-sample-v2 file SHA before = after
gold-sample-v2r internal SHA before/after = 368c025c8438d7a7e73efcfb4df73d90b7479e92ef64d6ecf4a19971e9590854
gold-sample-v2r file SHA before = after
new goldVersion = gold-sample-v2r2
new SHA differs from both rejected SHAs
new manifest contains no split, stem, options, answer, or analysis
```

Do not stage any local-data file.

- [ ] **Step 8: Run the real matrix/sample audit and stop at human acceptance**

Report all 16 KP rows with eligible/selected/BASIC/MEDIUM/HARD, each subject's five matrix-objective values, HARD pattern, chapter/source/year diagnostics, V1 overlaps, repeated identity, input-order independence, and both rejected-artifact hashes. If the recomputed real winners differ from the pre-registered table, stop with `SAMPLING DESIGN BLOCKED` and diagnose the data/contract drift; do not silently accept a different matrix.

Even when all code and hard constraints pass, stop with `V2-1R2 CODE PASS / AWAITING SAMPLE ACCEPTANCE`. V2-2 remains forbidden until explicit human acceptance.

- [ ] **Step 9: Stage only source/tests and commit only when Git writes are authorized**

```bash
git add tools/question-annotation/core/sampleV2.js tools/question-annotation/test/sampleV2.test.mjs
git commit -m "fix: spread retrieval v2 sampling difficulty"
```

Never use `git add .` or `git add -A`; never stage local-data.

**Stop condition:** `gold-sample-v2r2.json` must validate, match the pre-registered matrix objective result, preserve both rejected artifacts unchanged, and receive explicit human acceptance. Until then, V2-2 remains blocked.

---

# Task V2-2 — Deterministic 72/28 Split

**Goal:** deterministic split of the frozen 100 V2 sample into 72 DEV / 28 HOLDOUT with 18/7 per subject, plus split identity and SHA.

**Files:**
- Modify: `tools/question-annotation/core/sampleV2.js`
- Modify: `tools/question-annotation/test/sampleV2.test.mjs`

**Interfaces:**
```ts
const V2_DEV_TOTAL = 72; const V2_HOLDOUT_TOTAL = 28;
const V2_DEV_PER_SUBJECT = 18; const V2_HOLDOUT_PER_SUBJECT = 7;
function splitV2DevHoldout(sampleEntries: GoldSampleEntry[]): { dev: string[]; holdout: string[] };
function buildV2SplitManifest(input: { goldVersion: string; snapshotId: string; sampleSha256: string; split: { dev: string[]; holdout: string[] } }): Record<string, unknown>;
function validateV2SplitManifest(manifest: Record<string, unknown>): { ok: boolean; errors: string[] };
```

**Preconditions:** V2-1R2 code/tests committed if Git writes were authorized; `gold-sample-v2r2.json` exists, validates under the five-level matrix objective, and has explicit human acceptance. `gold-sample-v2.json` SHA `439f3527666784bb6a5ebe73ab44871e732846f59a0482b4543036eb8492a2fc` and `gold-sample-v2r.json` SHA `368c025c8438d7a7e73efcfb4df73d90b7479e92ef64d6ecf4a19971e9590854` are invalid inputs.

**RED test** (same synthetic fixture; deterministic):

```text
'V2-2: 72 DEV / 28 HOLDOUT'
'V2-2: 18 DEV and 7 HOLDOUT per subject'
'V2-2: same 100 ids before and after split'   — union(dev, holdout) === sample ids
'V2-2: no overlap'                            — dev ∩ holdout = ∅
'V2-2: every id assigned exactly once'
'V2-2: deterministic'                         — two runs deepEqual
'V2-2: split manifest sha canonical'
'V2-2: split drift fails closed'              — changing one split label fails validation
'V2-2: rejected pre-split sample is refused'  — old version or rejected SHA throws before assignment
```

**RED command:** `node --test tools/question-annotation/test/sampleV2.test.mjs`

**Expected RED:** `splitV2DevHoldout` / `buildV2SplitManifest` missing (interface not exported).

**Minimal implementation:** deterministic stratified split per subject: sort each subject's 10-block equivalent (here 25) by `(difficultyBucket, questionId)` and assign HOLDOUT indices `[2, 6, 10, 14, 18, 22, 24]` (7 fixed indices), the rest DEV. No random/Date.now/DB order. Frozen before any V2 experiment.

**GREEN command:** `node --test tools/question-annotation/test/sampleV2.test.mjs`

**Expected GREEN:** all split tests pass; V2-1 tests still pass.

**Regression command:** `node --test tools/question-annotation/test/sample.test.mjs tools/question-annotation/test/sampleV2.test.mjs`

**Acceptance criteria:** 72/28, 18/7 per subject, union = 100, disjoint, deterministic, SHA manifest, V1 sample/split tests unchanged.

**Explicit git add:** `git add tools/question-annotation/core/sampleV2.js tools/question-annotation/test/sampleV2.test.mjs`

**Commit message:** `feat: add v2 dev holdout split`

**Stop condition:** V2-3 begins only after this commit.

---

# Task V2-3 — Gold Authoring V2 Isolation

**Goal:** extend the existing Gold authoring CLI/validation to support the accepted V2 contract (`gold-sample-v2r2`, `gold-set-v2`, `gold-truth-v2`, 100/72/28) without breaking V1 (40/24/16) or consuming either rejected sampling artifact.

**Files:**
- Modify: `tools/question-annotation/core/gold.js` (parameterize counts/versions; V1 defaults unchanged)
- Modify: `tools/question-annotation/scripts/gold-author.mjs` (V2 file defaults; authoring view hides split)
- Create: `tools/question-annotation/test/goldV2.test.mjs`

**Interfaces (additive to gold.js):**
```ts
const GOLD_SET_VERSION_V2 = 'gold-set-v2';
const GOLD_CONTRACT_V2 = { total: 100, dev: 72, holdout: 28, perSubject: 25, devPerSubject: 18, holdoutPerSubject: 7 };
function createGoldSetV2({ snapshotId, frozen, frozenManifestSha256 }): GoldSet;
function freezeGoldManifestV2({ goldVersion, goldSet, snapshot }): { ok: boolean; errors: string[]; manifest?: Record<string, unknown> };
function loadGoldSetV2(path): GoldSet | null;
```

V1 functions (`createGoldSet`, `loadGoldSet`, `freezeGoldManifest`, `GOLD_SET_VERSION`) keep their exact signatures and constants.

**Preconditions:** V2-2 committed; audit of V1 constants documented in this task's brief (GOLD_TOTAL=40, DEV_TOTAL=24, HOLDOUT_TOTAL=16, GOLD_PER_SUBJECT=10 in `core/sample.js`; GOLD_SET_VERSION='gold-set-v1' in `core/gold.js`; CLI defaults and `run-benchmark.mjs` EXPECTED_COUNTS 24/16).

**RED test** (`goldV2.test.mjs`, synthetic 100-question fixture with valid nodes):

```text
'V2-3: V1 gold contract unchanged (40/24/16)'   — existing gold.test.mjs still passes
'V2-3: createGoldSetV2 initializes 100 unstarted'
'V2-3: freeze 100/100 confirmed succeeds'
'V2-3: freeze <100 confirmed fails'
'V2-3: fingerprint drift fails closed'
'V2-3: sample drift fails closed'
'V2-3: snapshot drift fails closed'
'V2-3: split drift fails closed'
'V2-3: resume preserves progress'
'V2-3: authoring view omits split labels'       — CLI show/next output does not print DEV/HOLDOUT
'V2-3: V2 files do not collide with V1 files'   — gold-set-v2.json vs gold-set-v1.json
'V2-3: V2 wrappers delegate to the shared core'  — createGoldSetV2 === createGoldSet with GOLD_CONTRACT_V2; same hash/freeze functions
```

**RED command:** `node --test tools/question-annotation/test/goldV2.test.mjs`

**Expected RED:** `createGoldSetV2` / `freezeGoldManifestV2` missing (module export missing).

**Minimal implementation:** introduce a `goldContract` parameter (default = V1 contract) threaded through gold.js internals. `createGoldSetV2` / `loadGoldSetV2` / `freezeGoldManifestV2` are thin wrappers delegating to the shared functions with `GOLD_CONTRACT_V2`; there is exactly one canonical validation/hash/freeze implementation (no duplicated V2 logic). Extend `gold-author.mjs` with V2 default paths (`gold-sample-v2r2.json`, `gold-set-v2.json`, `gold-truth-manifest-v2.json`) selectable via `--gold-version v2`; reject `gold-sample-v2`, `gold-sample-v2r`, and both `REJECTED_PRE_SPLIT_SAMPLE` SHAs before authoring state is created; `show`/`next`/authoring views do not print split; the frozen manifest still stores split internally.

**GREEN command:** `node --test tools/question-annotation/test/goldV2.test.mjs tools/question-annotation/test/gold.test.mjs`

**Expected GREEN:** V2 tests pass and V1 gold tests still pass (0 new failures).

**Regression command:** `node --test tools/question-annotation/test/snapshot.test.mjs tools/question-annotation/test/export-snapshot.test.mjs tools/question-annotation/test/workspace.test.mjs tools/question-annotation/test/sample.test.mjs tools/question-annotation/test/gold.test.mjs tools/question-annotation/test/goldV2.test.mjs`

**Acceptance criteria:** V2 authoring fully supported; V1 authoring/CLI/tests unchanged; V1 artifacts loadable; authoring UX hides split; retriever output never used as oracle (enforced by CLI flow: authoring input is manual node selection only).

**Explicit git add:** `git add tools/question-annotation/core/gold.js tools/question-annotation/scripts/gold-author.mjs tools/question-annotation/test/goldV2.test.mjs`

**Commit message:** `feat: add v2 gold authoring isolation`

**Stop condition:** stop here for the HUMAN GATE.

---

# HUMAN GATE — AUTHOR V2 GOLD TRUTH

Execution of the plan STOPS after V2-3. Codex may not create Gold truth, may not use E5/BM25/RRF candidates as Gold, and may not use LLM batch labeling.

```text
Human author: 0/100 → 100/100
Required state before V2-4:
  confirmed = 100
  draft = 0
  unstarted = 0
  freezeGoldManifestV2 succeeds
```

After the human confirms 100/100 and freeze succeeds, V2-4 may begin. The split is hidden in the authoring UX; the frozen manifest stores it.

---

# Task V2-4 — Query View Builder

**Goal:** implement `query-views-v2`: build stem and analysis QueryViews with deterministic fallback for missing/empty/short analysis.

**Files:**
- Create: `tools/question-annotation/core/queryViews.js`
- Create: `tools/question-annotation/test/queryViews.test.mjs`

**Interfaces:**
```ts
const QUERY_VIEW_VERSION = 'query-views-v2';
function buildQueryViews(question: { stem: string; analysis: string | null | undefined }): { views: Array<{ type: 'stem' | 'analysis'; content: string }>; availability: 'stem' | 'stem+analysis' };
```

**Preconditions:** HUMAN GATE passed (100/100 V2 Gold frozen).

**RED test:**

```text
'V2-4: Q1 stem-only returns exactly one stem view'
'V2-4: Q2 returns stem and analysis views'
'V2-4: null analysis falls back to stem-only'
'V2-4: undefined analysis falls back to stem-only'
'V2-4: empty string analysis falls back to stem-only'
'V2-4: whitespace-only analysis falls back to stem-only'
'V2-4: any non-empty normalized analysis is a valid analysis view'  — e.g. '页号' yields availability 'stem+analysis'
'V2-4: analysis normalization is deterministic'
'V2-4: same input yields same availability'
'V2-4: query never contains gold/split/retriever data'   — assert content contains only question text
```

**RED command:** `node --test tools/question-annotation/test/queryViews.test.mjs`

**Expected RED:** `ERR_MODULE_NOT_FOUND` for `../core/queryViews.js`.

**Minimal implementation:** pure function applying the shared `normalizeText` (from `core/lexical.js`); analysis usable iff `normalizeText(analysis ?? '').length > 0`; otherwise stem-only fallback. No heuristic thresholds. No model/provider interaction.

**GREEN command:** `node --test tools/question-annotation/test/queryViews.test.mjs`

**Expected GREEN:** all query-view tests pass.

**Regression command:** `node --test tools/question-annotation/test/lexical.test.mjs tools/question-annotation/test/queryViews.test.mjs`

**Acceptance criteria:** Q1/Q2 contracts exact; empty/short analysis deterministic fallback; no Gold leakage; lexical regression unchanged.

**Explicit git add:** `git add tools/question-annotation/core/queryViews.js tools/question-annotation/test/queryViews.test.mjs`

**Commit message:** `feat: add v2 query view builder`

**Stop condition:** V2-5 begins after commit.

---

# Task V2-5 — Passage Builder

**Goal:** implement `knowledge-node-passage-v2` (canonical labeled hierarchical passage) and keep the V1 builder for P1.

**Files:**
- Create: `tools/question-annotation/core/passage.js`
- Create: `tools/question-annotation/test/passage.test.mjs`

**Interfaces:**
```ts
const PASSAGE_VERSION = 'knowledge-node-passage-v2';
const PASSAGE_FORMAT = 'canonical-labeled-hierarchical-passage-v2';
function buildPassageV1(node: { name: string; chapterName: string | null; sectionName: string | null }): string;
function buildPassageV2(node: { name: string; chapterName: string | null; sectionName: string | null }): string;
```

**Preconditions:** V2-4 committed.

**RED test:**

```text
'V2-5: P1 is the V1 unlabeled join'            — 'name chapterName sectionName'
'V2-5: P2 full format'                          — '考点：X 章节：Y 小节：Z'
'V2-5: P2 missing chapter'                      — '考点：X 小节：Z'
'V2-5: P2 missing section'                      — '考点：X 章节：Y'
'V2-5: P2 only name'                            — '考点：X'
'V2-5: nodeId absent from passage'
'V2-5: undefined/null fields omitted'
'V2-5: same node yields identical passage'
'V2-5: P1 vs P2 content differ (cache miss)'    — embedding cache key changes
```

**RED command:** `node --test tools/question-annotation/test/passage.test.mjs`

**Expected RED:** `ERR_MODULE_NOT_FOUND` for `../core/passage.js`.

**Minimal implementation:** two pure builders; P2 uses the locked labeled format with fixed field order, empty-field omission, no nodeId, no subjectName.

**GREEN command:** `node --test tools/question-annotation/test/passage.test.mjs`

**Expected GREEN:** all passage tests pass.

**Regression command:** `node --test tools/question-annotation/test/embedding.test.mjs tools/question-annotation/test/passage.test.mjs`

**Acceptance criteria:** P1/P2 builders exact; cache identity naturally differs (content change); embedding cache contract unchanged.

**Explicit git add:** `git add tools/question-annotation/core/passage.js tools/question-annotation/test/passage.test.mjs`

**Commit message:** `feat: add v2 passage builder`

**Stop condition:** V2-6 begins after commit.

---

# Task V2-6 — Multi-view Semantic Aggregation

**Goal:** implement `semantic-rrf-v2`: full same-subject stem/analysis rankings fused by RRF (k=60) into Top12, with stem-only fallback, subject hard filter, active-atomic pool, and no pre-fusion truncation.

**Files:**
- Create: `tools/question-annotation/core/semanticAggregation.js`
- Create: `tools/question-annotation/test/semanticAggregation.test.mjs`

**Interfaces:**
```ts
const SEMANTIC_AGGREGATION_VERSION = 'semantic-rrf-v2';
function fuseSemanticViews(input: { stem: Array<{ nodeId: string; rank: number }>; analysis: Array<{ nodeId: string; rank: number }> | null; subjectFilter: ReadonlySet<string>; k?: number; topK?: number }): Array<{ nodeId: string; finalRank: number; rrfScore: number; stemRank: number | null; analysisRank: number | null }>;
async function retrieveSemanticV2(question: SnapshotQuestion, snapshot: AnnotationSnapshot, provider: EmbeddingProvider, cacheDir: string, options: { queryMode: 'Q1' | 'Q2'; passageFormat: 'P1' | 'P2' }): Promise<Array<{ nodeId: string; finalRank: number; rrfScore: number; stemRank: number | null; analysisRank: number | null }>>;
```

**Preconditions:** V2-4 and V2-5 committed.

**RED test:**

```text
'V2-6: RRF rank math exact k=60'               — 1/(60+rank) sums per view
'V2-6: full ranking, no pre-fusion truncation' — node at stem rank 50 with analysis rank 1 is fused
'V2-6: rank14 + analysis1 rescue'              — synthetic stem rank 14 + analysis rank 1 lands in final Top12
'V2-6: rrfScore DESC then nodeId ASC tie-break'
'V2-6: subject hard filter'                    — cross-subject candidates never ranked
'V2-6: active atomic only'                     — inactive/non-atomic never ranked
'V2-6: Top8 and Top12 without duplicates'
'V2-6: stem-only fallback when analysis unavailable'
'V2-6: deterministic for identical input'
```

**RED command:** `node --test tools/question-annotation/test/semanticAggregation.test.mjs`

**Expected RED:** `ERR_MODULE_NOT_FOUND` for `../core/semanticAggregation.js`.

**Minimal implementation:** `fuseSemanticViews` merges the two full lists, sums `1/(60+rank)`, filters by subjectFilter, sorts rrfScore DESC then nodeId ASC, returns topK with ranks. `retrieveSemanticV2` builds the pool (subject + active atomic), builds views via `buildQueryViews`, embeddings via `embedWithCache` (query `query:` view; passage `passage:` view with P1 or P2 text), produces full per-view rankings (no truncation), then fuses. Analysis unavailable → stem-only list.

**GREEN command:** `node --test tools/question-annotation/test/semanticAggregation.test.mjs`

**Expected GREEN:** all aggregation tests pass, including the rank-14 rescue.

**Regression command:** `node --test tools/question-annotation/test/queryViews.test.mjs tools/question-annotation/test/passage.test.mjs tools/question-annotation/test/semanticAggregation.test.mjs tools/question-annotation/test/retriever.test.mjs`

**Acceptance criteria:** semantic-only RRF; full-ranking behavior; rescue case proven; subject/active-atomic safety; Top8/Top12; deterministic; existing retriever tests unchanged.

**Explicit git add:** `git add tools/question-annotation/core/semanticAggregation.js tools/question-annotation/test/semanticAggregation.test.mjs`

**Commit message:** `feat: add v2 semantic rrf aggregation`

**Stop condition:** V2-7 begins after commit.

---

# Task V2-7 — Pre-registered DEV Experiment Runner

**Goal:** runner that executes only the new V2 DEV 72 set across the four pre-registered cells (Q1P1/Q1P2/Q2P1/Q2P2), with identical model/corpus/filter/metrics, and reports legacy V1 40 regression separately (never in selection).

**Files:**
- Create: `tools/question-annotation/scripts/run-benchmark-v2.mjs`
- Create: `tools/question-annotation/test/benchmarkV2.test.mjs`

**Interfaces (exported pure helpers):**
```ts
const V2_BENCHMARK_VERSION = 'retrieval-benchmark-v2';
function resolveV2ExperimentSplit(split: string): 'DEV';   // rejects HOLDOUT in selection mode
function runV2Cell(question, snapshot, provider, cacheDir, cell: 'Q1P1' | 'Q1P2' | 'Q2P1' | 'Q2P2'): Promise<RetrievalCandidateV2[]>;
```

**Preconditions:** V2-6 committed; new V2 Gold frozen (HUMAN GATE passed); split frozen.

**RED test:**

```text
'V2-7: DEV mode selects exactly 72'
'V2-7: HOLDOUT rejected in selection mode'      — resolveV2ExperimentSplit('HOLDOUT') throws
'V2-7: executes all four cells on the same 72 ids'
'V2-7: metrics computed (Recall@8/@12, Macro, MRR)'
'V2-7: legacy V1 40 regression reported separately' — separate output key, never merged into selection metrics
'V2-7: deterministic for identical input'
```

**RED command:** `node --test tools/question-annotation/test/benchmarkV2.test.mjs`

**Expected RED:** `ERR_MODULE_NOT_FOUND` for `../scripts/run-benchmark-v2.mjs` exports.

**Minimal implementation:** runner loads snapshot + `gold-truth-v2.json`; DEV = split DEV entries (72); for each cell uses `retrieveSemanticV2` with the corresponding queryMode/passageFormat; computes metrics via the existing generic `computeBenchmarkMetrics`; writes Git-safe report `local-data/benchmark-v2-dev.json` (no question text); optional `--legacy` produces `local-data/benchmark-v2-legacy.json` for the old 40 (never in selection).

**GREEN command:** `node --test tools/question-annotation/test/benchmarkV2.test.mjs`

**Expected GREEN:** all runner tests pass.

**Regression command:** `node --test tools/question-annotation/test/semanticAggregation.test.mjs tools/question-annotation/test/benchmarkV2.test.mjs tools/question-annotation/test/benchmark.test.mjs`

**Acceptance criteria:** DEV-only fail-closed; 4 cells; identical conditions; legacy isolation; Git-safe report.

**Explicit git add:** `git add tools/question-annotation/scripts/run-benchmark-v2.mjs tools/question-annotation/test/benchmarkV2.test.mjs`

**Commit message:** `feat: add v2 dev experiment runner`

**Stop condition:** V2-8 begins after commit.

---

# Task V2-8 — Final V2 DEV Selection + Freeze

**Goal:** select exactly one winner from Q1P1/Q1P2/Q2P1/Q2P2 using only the new V2 DEV 72 metrics, and freeze `final-retriever-v2` with a canonical config hash.

**Files:**
- Modify: `tools/question-annotation/core/benchmarkV2.js` (create; selection + config hash + freeze validation)
- Create: `tools/question-annotation/test/benchmarkV2.test.mjs` (add selection/freeze tests)

**Interfaces:**
```ts
const V2_SELECTION_RULE = (a, b) => b.metrics.primaryRecallAt12 - a.metrics.primaryRecallAt12 || b.metrics.primaryRecallAt8 - a.metrics.primaryRecallAt8 || b.metrics.macroAllRelevantAt12 - a.metrics.macroAllRelevantAt12 || b.metrics.mrr - a.metrics.mrr || a.cell.localeCompare(b.cell);
function selectV2Winner(perCell: Record<string, { cell: string; metrics: { primaryRecallAt12; primaryRecallAt8; macroAllRelevantAt12; mrr } }>): string;
function buildFinalV2Config(input: { cell: string; goldSha256: string; snapshotId: string; queryMode: 'Q1' | 'Q2'; passageFormat: 'P1' | 'P2' }): Record<string, unknown>;
function finalV2ConfigHash(config: Record<string, unknown>): string;
function validateFrozenV2Config(config: Record<string, unknown>, expectedHash: string): { ok: boolean; errors: string[] };
```

**Preconditions:** V2-7 committed; DEV 72 metrics produced.

**RED test:**

```text
'V2-8: selection order Recall@12 → @8 → Macro → MRR → simpler'
'V2-8: MRR is PRIMARY MRR (1/rank of primary; 0 when absent; mean over 72)'
'V2-8: complexityCost Q1P1=0 Q1P2=1 Q2P1=1 Q2P2=2'
'V2-8: experimentId ASC final tie-break'        — Q1P2 beats Q2P1 on full metric + cost tie
'V2-8: accepts only 72-DEV metric inputs'      — passing a metrics object keyed 'dev-40' or total 112 throws
'V2-8: config hash canonical and field-sensitive'
'V2-8: freeze sets selectedOn DEV-V2 and holdoutEvaluatedBeforeFreeze=0'
'V2-8: validateFrozenV2Config rejects hash mismatch'
```

**RED command:** `node --test tools/question-annotation/test/benchmarkV2.test.mjs`

**Expected RED:** `selectV2Winner` / `buildFinalV2Config` missing.

**Minimal implementation:** pure selection over the 4-cell DEV metrics (72 only) using the locked order (Recall@12 → Recall@8 → Macro → PRIMARY MRR → complexityCost ASC → experimentId ASC); build `config/final-retriever-v2.json` with cell, queryMode, passageFormat, model identity, versions, goldSha256, snapshotId, topKInitial 8, topKExpanded 12, selectedOn `DEV-V2`, holdoutEvaluatedBeforeFreeze 0; hash via canonical sorted keys (reuse the canonicalization from `core/benchmark.js`).

**GREEN command:** `node --test tools/question-annotation/test/benchmarkV2.test.mjs`

**Expected GREEN:** selection/freeze tests pass.

**Regression command:** `node --test tools/question-annotation/test/benchmarkV2.test.mjs tools/question-annotation/test/benchmark.test.mjs`

**Acceptance criteria:** winner chosen only on 72 DEV; config frozen with hash; holdoutEvaluatedBeforeFreeze=0; V1 benchmark tests unchanged.

**Explicit git add:** `git add tools/question-annotation/core/benchmarkV2.js tools/question-annotation/config/final-retriever-v2.json tools/question-annotation/test/benchmarkV2.test.mjs`

**Commit message:** `feat: freeze v2 semantic retriever`

**Stop condition:** V2-9 begins only after this commit and the V2 HOLDOUT-evaluated=0 check.

---

# Task V2-9 — One-shot New HOLDOUT Gate

**Goal:** evaluate the frozen final-retriever-v2 once on the new 28-question HOLDOUT; locked gate 27/28 @8, 28/28 @12, Macro >= 0.90, safety zero.

**Files:**
- Modify: `tools/question-annotation/scripts/run-benchmark-v2.mjs` (HOLDOUT mode)
- Modify: `tools/question-annotation/core/benchmarkV2.js` (evaluateV2Gate)
- Modify: `tools/question-annotation/test/benchmarkV2.test.mjs`

**Interfaces:**
```ts
function evaluateV2Gate(metrics, holdoutCount): { pass: boolean; reasons: string[] };  // locked 27/28, 28/28, 0.90, safety 0
function resolveV2HoldoutSplit(split: string): 'HOLDOUT';
```

**Preconditions:** V2-8 committed; `final-retriever-v2.json` exists, config hash valid, `selectedOn === 'DEV-V2'`, `holdoutEvaluatedBeforeFreeze === 0`.

**RED test:**

```text
'V2-9: gate 27/28 @8 pass, 26/28 fail'
'V2-9: gate 28/28 @12 pass, 27/28 fail'
'V2-9: macro 0.90 pass, 0.89 fail'
'V2-9: safety counter > 0 fails'
'V2-9: runner requires frozen v2 config + valid hash + selectedOn DEV-V2 + holdoutEvaluatedBeforeFreeze 0'
'V2-9: HOLDOUT selects exactly 28'
```

**RED command:** `node --test tools/question-annotation/test/benchmarkV2.test.mjs`

**Expected RED:** `evaluateV2Gate` missing.

**Minimal implementation:** gate function with locked thresholds; runner HOLDOUT mode verifies the frozen config and evaluates the 28 HOLDOUT entries once via `retrieveSemanticV2` with the frozen cell; report `local-data/benchmark-v2-holdout.json` (Git-safe, no question text); print `RETRIEVAL_V2_GATE_PASS/FAIL`.

**GREEN command:** `node --test tools/question-annotation/test/benchmarkV2.test.mjs`

**Expected GREEN:** all gate tests pass (synthetic fixtures only; no real HOLDOUT in unit tests).

**Regression command:** `node --test tools/question-annotation/test/benchmarkV2.test.mjs tools/question-annotation/test/benchmark.test.mjs`; full `npm test` runs in the Final Verification section.

**Acceptance criteria:** one-shot gate; locked thresholds; safety counters; fail-closed config checks; no retuning after the run.

**Explicit git add:** `git add tools/question-annotation/scripts/run-benchmark-v2.mjs tools/question-annotation/core/benchmarkV2.js tools/question-annotation/test/benchmarkV2.test.mjs`

**Commit message:** `feat: add v2 holdout gate`

**Stop condition:** after the one-shot HOLDOUT: PASS → Plan B unblocked (not started here); FAIL → V2 HOLDOUT consumed, STOP, no retune.

---

# Final Verification (after V2-9)

```bash
node --test tools/question-annotation/test
npm test
git status --short
```

Report exact total/pass/fail/skip. Confirm Gold SHA (V1 `6ca5fa53e8b0db415c7d7132445a72bf10297550d110df0b92f8ce301fabd99d` and V2 `gold-truth-v2` sha) unchanged, V1 artifacts untouched, no local-data staged.

## Plan Self-Review

### Spec coverage

- V2-1 ↔ Design §26–29, §55 (historical sample implementation; real output rejected before split)
- V2-1R ↔ Design §29, §33, §55–56 (historical balanced-KP implementation; real output rejected for difficulty × KP concentration)
- V2-1R2 ↔ Design §29, §33, §56 (five-level Difficulty Spread matrix objective, third-version identity, two-artifact isolation)
- V2-2 ↔ Design §26, §30 (split, frozen identity)
- V2-3 ↔ Design §31–33 (Gold authoring, version isolation, split hiding)
- HUMAN GATE ↔ Design §31–32 (human truth, no retriever oracle)
- V2-4 ↔ Design §6, §10–11 (query views, fallback, contract)
- V2-5 ↔ Design §12–19 (passage enrichment, format, versioning, cache)
- V2-6 ↔ Design §7–8, §20–23 (multi-view aggregation, full ranking, subject/atomic, no bonus)
- V2-7 ↔ Design §34–37 (pre-registered matrix, metrics, DEV-only)
- V2-8 ↔ Design §38 (selection rule, freeze)
- V2-9 ↔ Design §39–41 (one-shot gate, locked thresholds)

### Placeholder scan

No unresolved placeholders remain; every task has concrete tests, commands, and acceptance criteria.

### Interface consistency

```text
V2-4 buildQueryViews → V2-6 retrieveSemanticV2 (views input)
V2-5 buildPassageV1/V2 → V2-6 passageFormat ('P1'|'P2')
V2-6 retrieveSemanticV2 → V2-7 runV2Cell (cell → queryMode + passageFormat)
V2-7 metrics → V2-8 selectV2Winner (72-DEV metrics only)
V2-8 buildFinalV2Config + finalV2ConfigHash → V2-9 runner (validateFrozenV2Config)
```

### V1 compatibility

No task rewrites V1 artifacts, V1 Gold truth, or reopens the old HOLDOUT. `core/sample.js`, `core/gold.js`, `core/benchmark.js`, `core/retriever.js` V1 contracts remain untouched; V1 tests are part of every regression command.

### Git safety

Each task stages explicit files only; local-data, model caches, embedding caches, and benchmark reports remain gitignored; no real question text enters Git; no push.
