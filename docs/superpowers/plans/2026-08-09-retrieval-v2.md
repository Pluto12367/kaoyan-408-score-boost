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

---

# Task V2-1 — Versioned Gold V2 Sample Contract

**Goal:** deterministic 100-question V2 sample (25 per subject) from the remaining independent current question pool, with old-Gold exclusion, KP coverage, difficulty target, fingerprint identity, and a Git-safe manifest. No human truth is started.

**Files:**
- Create: `tools/question-annotation/core/sampleV2.js`
- Create: `tools/question-annotation/test/sampleV2.test.mjs`

**Interfaces:**
```ts
const V2_GOLD_SAMPLE_VERSION = 'gold-sample-v2';
const V2_TOTAL = 100; const V2_PER_SUBJECT = 25;
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
'V2-1: covers all 16 referenced KPs'         — every eligible-referenced KP id has ≥1 selected question
'V2-1: difficulty target within tolerance'   — BASIC 38–42%, MEDIUM 38–42%, HARD 18–22%
'V2-1: deterministic for same snapshot'      — two runs deepEqual
'V2-1: shortage fails closed'                — subject with <25 eligible throws with subject name
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
// 3) per subject: phase A pick one question per referenced KP (sorted kpId, then questionId, skip picked)
// 4) per subject: fill to 25 using deterministic diversity-aware selection
//    (minimize difficulty-bucket overshoot vs target 40/40/20, tie-break questionId ASC)
// 5) fail closed if any subject < 25
// 6) buildV2SampleManifest: canonical sorted entries + sha256; validateV2SampleManifest checks counts,
//    uniqueness, subject codes, fingerprint presence, KP coverage, difficulty bucket tolerance
```

**GREEN command:** `node --test tools/question-annotation/test/sampleV2.test.mjs`

**Expected GREEN:** all `sampleV2.test.mjs` tests pass.

**Regression command:** `node --test tools/question-annotation/test/sample.test.mjs tools/question-annotation/test/sampleV2.test.mjs`

**Acceptance criteria:** 100 unique ids, 25/subject, 16/16 KP coverage, difficulty within tolerance, deterministic, fail-closed shortage, manifest SHA canonical, Git-safe (no question text), V1 sample tests still pass.

**Explicit git add:** `git add tools/question-annotation/core/sampleV2.js tools/question-annotation/test/sampleV2.test.mjs`

**Commit message:** `feat: add v2 gold sample contract`

**Stop condition:** Task V2-2 begins only after this task's commit and review gate.

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

**Preconditions:** V2-1 committed; the frozen 100 sample manifest exists (git-safe) and validates.

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

**Goal:** extend the existing Gold authoring CLI/validation to support the V2 contract (`gold-sample-v2`, `gold-set-v2`, `gold-truth-v2`, 100/72/28) without breaking V1 (40/24/16).

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
```

**RED command:** `node --test tools/question-annotation/test/goldV2.test.mjs`

**Expected RED:** `createGoldSetV2` / `freezeGoldManifestV2` missing (module export missing).

**Minimal implementation:** introduce a `goldContract` parameter (default = V1 contract) threaded through gold.js internals; add V2 variants with the V2 contract and `gold-set-v2` version string. Extend `gold-author.mjs` with V2 default paths (`gold-sample-v2.json`, `gold-set-v2.json`, `gold-truth-manifest-v2.json`) selectable via `--gold-version v2`; `show`/`next`/authoring views do not print split; the frozen manifest still stores split internally.

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
'V2-4: empty analysis falls back to stem-only'
'V2-4: null analysis falls back to stem-only'
'V2-4: analysis shorter than 5 normalized characters falls back to stem-only'
'V2-4: analysis normalization is deterministic'
'V2-4: query never contains gold/split/retriever data'   — assert content contains only question text
```

**RED command:** `node --test tools/question-annotation/test/queryViews.test.mjs`

**Expected RED:** `ERR_MODULE_NOT_FOUND` for `../core/queryViews.js`.

**Minimal implementation:** pure function applying the shared `normalizeText` (from `core/lexical.js`) to detect effective analysis length; returns views and availability. No model/provider interaction.

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
'V2-8: accepts only 72-DEV metric inputs'      — passing a metrics object keyed 'dev-40' or total 112 throws
'V2-8: config hash canonical and field-sensitive'
'V2-8: freeze sets selectedOn DEV-V2 and holdoutEvaluatedBeforeFreeze=0'
'V2-8: validateFrozenV2Config rejects hash mismatch'
```

**RED command:** `node --test tools/question-annotation/test/benchmarkV2.test.mjs`

**Expected RED:** `selectV2Winner` / `buildFinalV2Config` missing.

**Minimal implementation:** pure selection over the 4-cell DEV metrics (72 only); build `config/final-retriever-v2.json` with cell, queryMode, passageFormat, model identity, versions, goldSha256, snapshotId, topKInitial 8, topKExpanded 12, selectedOn `DEV-V2`, holdoutEvaluatedBeforeFreeze 0; hash via canonical sorted keys (reuse the canonicalization from `core/benchmark.js`).

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

- V2-1 ↔ Design §26–29 (V2 sample contract, sampling, independence)
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
