# Retrieval V2 Design

Date: 2026-08-09

Status: DESIGN COMPLETE — awaiting design review. No implementation plan and no V2 code are produced by this document.

Approved direction: **Option 1 — Multi-view Semantic Retrieval + Deterministic KnowledgeNode Passage Enrichment**, keeping the existing E5 embedding model unchanged.

## 1. Context

- Retrieval V1 = `semantic-e5-v1` (`Xenova/multilingual-e5-small`, revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`, transformers.js 3.8.1, pooling mean, L2, 384 dims).
- V1 final config SHA: `3533ed7aa0e1635a942a2dce823a17fb4fb8cc336fe24ea4a95cd09ed88443b7`.
- V1 blind HOLDOUT (one-shot, 16 questions): PRIMARY Recall@8 = 13/16, Recall@12 = 13/16, Macro@12 = 0.8125 → `TASK 9 GATE FAIL`, HOLDOUT consumed.
- V1 safety: crossSubject=0, invalidNodes=0, inactive/non-atomic=0, duplicates=0, nonFinite=0.
- The 16 old HOLDOUT questions are consumed: usable for diagnosis/regression only, never again as a final test set.

## 2. V1 Failure Evidence

Postmortem (`docs/superpowers/specs/2026-08-09-retrieval-v1-failure-postmortem.md`) identified three misses:

| Miss | Subject | Gold node | stem rank | analysis rank | lexical rank | primary failure |
|---|---|---|---|---|---|---|
| 1 | DS | 二叉树链式存储 | >60 | 27 | 14 | NODE_TEXT_INSUFFICIENT |
| 2 | OS | 页号与页内偏移 | 14 | 1 | 1 | EMBEDDING_LIMITATION |
| 3 | OS | 文件控制块FCB | 14 | 12 | 9 | EMBEDDING_LIMITATION |

Key observations:

- Miss 2 and Miss 3 are boundary misses in the stem-only view (rank 14, just outside Top12) while the analysis view recovers them (rank 1 and 12). The stem-only single view is the fragile channel.
- Miss 1 is a deep miss: the V1 passage (`name + chapterName + sectionName`) does not express the tested property; E5 clusters the compound term toward linked-list nodes.
- The old 3-way fusion (lexical + stem + analysis RRF) was lower than the E5 baseline on the old DEV set; this design isolates the analysis-view contribution instead of discarding it.

## 3. Goals

- Improve Top8/Top12 semantic recall for Question → Atomic KnowledgeNode.
- Specifically reduce (a) stem-only boundary misses and (b) deep misses caused by short KnowledgeNode passages.
- Keep deterministic, offline, subject-safe, Gold-independent, with no AI.

## 4. Non-Goals

- No new embedding model, no cross-encoder, no reranker, no LLM retrieval, no LLM-generated aliases, no learned fusion, no vector DB, no BM25/tokenizer tuning, no structural scoring bonus (kpMatched/chapterMatched are diagnostics only).
- No Plan B work (AI candidate selector, AnnotationModelProvider, full-question annotation, review UI, production seeding).
- No modification of Retrieval V1, V1 config, V1 benchmark artifacts, or V1 gate history.

## 5. Architecture

Option 1 (recommended) — semantic-only multi-view retrieval with enriched passages:

```text
Question
├── stem
└── analysis
      ↓
QueryView Builder (QUERY_VIEW_VERSION = query-views-v2)
      ↓
E5 Query Embeddings (query: prefix, unchanged)
      ↓
same-subject active atomic KnowledgeNodes (hard filter at pool build)
      ↓
V2 Enriched Passage Builder (PASSAGE_VERSION = knowledge-node-passage-v2)
      ↓
E5 Passage Embeddings (passage: prefix, unchanged)
      ↓
per-view semantic rankings (cosine = dot product on L2 vectors)
      ↓
Multi-view aggregation (SEMANTIC_AGGREGATION_VERSION = semantic-rrf-v2)
      ↓
Top12 (expanded) / Top8 (initial view)
```

No AI, no lexical channel in V2 first version.

## 6. Query Multi-view Design

`QueryView { type: 'stem' | 'analysis'; content: string }`.

- stem view content = question.stem.
- analysis view content = question.analysis.
- Gold labels, questionId→node mappings, and split identity never enter query content.
- Query building applies the unchanged E5 `query: ` prefix per view. Query embedding cache key is unchanged (spec hash + view + normalized content), so stem and analysis remain distinct cache identities.

## 7. Multi-view Candidate Approaches (compared)

### Approach A — Independent Rank Fusion (RRF, semantic views only)

```text
rrf(node) = Σ_{view ∈ {stem, analysis}} 1 / (k + rank_view(node))
```

- k = 60 (fixed; the pre-existing RRF constant from Task 8. It is not re-tuned on old DEV or on the new V2 DEV).
- Inputs to fusion are the FULL same-subject rankings of both views. There is NO pre-fusion truncation to Top8/Top12: every active atomic node of `question.subject` is ranked by the stem view and by the analysis view, and both full rankings feed the RRF. This prevents reintroducing the single-view Top12 boundary cut that caused V1 misses at rank 14.
- Deterministic, parameter count = 1 (fixed), interpretable (stemRank/analysisRank/rrfScore on each candidate).
- Miss 2 (14, 1) and Miss 3 (14, 12) both gain contributions from the analysis view.

### Approach B — Max Similarity

```text
score(node) = max(sim(stem, node), sim(analysis, node))
```

- Simple and analysis can rescue stem misses, but a noisy view can push an irrelevant node to the top; raw score magnitudes are not comparable across views and there is no rank-calibration signal.

### Approach C — Deterministic Weighted Similarity

```text
score(node) = α * sim(stem, node) + β * sim(analysis, node)
```

- Requires choosing α/β without a principled source; any choice risks overfitting to the consumed HOLDOUT; adds a parameter with no evidence basis. Rejected for V2 first version.

## 8. Recommended Aggregation

**Approach A — RRF over stem + analysis (k = 60), semantic views only.**

Locked retrieval contract:

```text
stem ranking depth:    FULL same-subject ranking (all active atomic nodes of question.subject)
analysis ranking depth: FULL same-subject ranking
fusion:                RRF, contribution 1 / (60 + rank), summed over the two views
final TopK:            Top12 (expanded), Top8 is the initial view of the same list
tie-break:             rrfScore DESC, then nodeId ASC
structural bonus:      none
```

No pre-fusion cutoff and no structural bonus. The full same-subject ranking is tractable at the current offline tool scale (≤ ~320 active atomic nodes per subject).

Rationale:

- Robustness: rank fusion is insensitive to per-view score calibration; max (B) lets one noisy view dominate; weights (C) add a tunable parameter.
- Parameter count: 1 fixed constant (pre-existing, not re-tuned).
- Interpretability: each candidate exposes stemRank, analysisRank, rrfScore.
- Overfitting risk: low (no learned weights, no per-question rules).
- Determinism: pure function of ranks, stable tie-break nodeId ASC.
- Later AI candidate consumption: Top12 list carries the same RetrievalCandidate-like shape as V1 with per-view ranks and reasons.

This is the ONE default V2 aggregation. Alternative approaches B/C are documented only as rejected alternatives.

## 9. Analysis View Reliability

- Analysis is NOT a noise source for the three misses: Miss 2 analysis = 1, Miss 3 analysis = 12, Miss 1 analysis = 27 (better than stem > 60).
- The old Task 8 3-way fusion drop is attributed to the fusion strategy (adding the lexical channel and its rank distribution), not to analysis content. V2 isolates stem + analysis and defers lexical to a later comparison on a fresh test set.

## 10. Analysis Missing / Low-quality Handling

- analysis == null or trimmed empty: stem-only fallback; the empty view does not participate in fusion.
- analysis too short (normalized length < 5 characters): treated as unavailable (stem-only fallback), recorded as `viewAvailability: 'stem'`.
- analysis present and non-trivial: both views participate; recorded as `viewAvailability: 'stem+analysis'`.
- No LLM rewriting of analysis. Fallback is deterministic and fail-safe.

## 11. V2 Query Representation

- `QueryView { type: 'stem' | 'analysis'; content: string }`.
- Contract: content is derived only from question content; never from Gold, split identity, or retriever output.
- Query builder version locked as `query-views-v2`.

## 12. Passage Enrichment Design (P1)

Deterministic KnowledgeNode → passage builder using only structured information that already exists in the snapshot/knowledge tree.

Honest scope statement: the V2 passage builder produces a canonical labeled hierarchical representation. It does NOT add semantic attributes that do not exist in the tree. In particular it cannot add the missing property text for Miss 1 (e.g., the binary-linked-list null-pointer property); closing that gap requires a separate knowledge-catalog semantic metadata enhancement (V3 candidate), not a retrieval-side invention.

## 13. Real KnowledgeNode Schema Audit

Audited from the frozen snapshot (`snap-399242fb3d7f`):

Available fields on nodes:

```text
id
name
subject
nodeType (subject | chapter | section | atomicPoint)
parentId
isActive
chapterName
sectionName
```

Additionally, the tree contains subject-level nodes with full Chinese names (e.g., subject `DS` → name `数据结构`), which is legitimate structured information for subject-name enrichment.

Audit of the authoritative tree (`data/408/knowledge-tree-408-v2.json`) versus the snapshot/exporter/workspace:

```text
snapshot node fields: id, name, subject, nodeType, parentId, isActive, chapterName, sectionName
exporter enriches:    chapterName, sectionName from parent hierarchy
workspace columns:    node_id, snapshot_id, parent_id, subject, node_type, name, is_active, chapter_name, section_name
tree extra fields:    level, order, scoreWeight, importance, estimatedFrequency, difficulty, syllabusVersion, frequencySource
```

The tree's extra fields (`importance`, `difficulty`, `estimatedFrequency`, `frequencySource`, `order`, `scoreWeight`, `syllabusVersion`, `level`) are numeric/version metadata, not candidate-discriminative semantic passage text, and are out of scope for P2 passage text.

Not available fields (must NOT be assumed):

```text
aliases
keywords
description
```

`parentName` is derivable from `parentId` + tree lookup, but for atomic points the parent section name is already `sectionName`, so no new field is introduced.

## 14. Passage Enrichment Candidate Levels

- V1: `name + chapterName + sectionName` (space-joined, unlabeled).
- V2 canonical labeled hierarchical passage: `考点：<name> 章节：<chapterName> 小节：<sectionName>`.
  - `subjectName` is deliberately excluded: the subject is a hard filter, so it is constant within a candidate pool and carries no intra-subject discrimination.
- V2 Expanded (only if the schema later adds legitimate fields): aliases/keywords/description. They do not exist today and are excluded from the current V2 contract.

## 15. No nodeId as Semantic Content

- Node ids (`DS-C04-S02-P10`, ...) are identity/cache/result references only and never enter the embedding text.

## 16. Parent Context

- For atomic points, `parentId` points to the section node and `sectionName` is already that section's name; parent/section context is therefore already captured without a new field.
- Chapter context is captured by `chapterName`.
- Subject context is intentionally NOT in the passage: the subject is a hard filter, so it is constant within a candidate pool and carries no intra-subject discrimination.
- To prevent broad-concept flooding, the labeled format keeps level labels (`考点/章节/小节`) so each field is distinguishable and no single broad level dominates the embedding.

## 17. Canonical Passage Format (locked)

```text
考点：<name> 章节：<chapterName> 小节：<sectionName>
```

Rules (deterministic):

- Field order is fixed: name, chapterName, sectionName (labeled 考点/章节/小节).
- Empty fields are omitted together with their label.
- Fields appear exactly once; no value-based deduplication (identical values across levels are kept as-is; determinism is guaranteed by fixed order).
- No nodeId in the text.
- No subjectName (non-discriminative under the hard subject filter).
- Exactly one production format; no parallel formats.

What P2 genuinely adds versus P1:

- explicit level labels (考点/章节/小节) that help the embedding distinguish node name from chapter/section context;
- fixed canonical field order and hierarchy framing;
- deterministic duplicate suppression of empty fields.

P2 does NOT add any attribute semantics missing from the tree (e.g., the Miss 1 property text). It only validates whether field order / hierarchy context / labeled representation improve retrieval. This is an honest limitation, not a claim to close the Miss 1 gap.

## 18. Passage Versioning

- `PASSAGE_VERSION = 'knowledge-node-passage-v2'`.
- The embedding cache key already includes `normalized content`; enriched passage content differs from V1 content, so the V2 passage embeddings naturally miss the V1 cache.

## 19. Cache Compatibility

- Cache contract unchanged: key = sha256(specHash | view | normalized content), entry stores specHash + view + vector.
- V1 and V2 embeddings never mix: V2 content differs → different keys; benchmark metadata records the passage version.

## 20. V2 Retrieval Pipeline

See Architecture (§5). Data flow is fully textual: QueryView Builder → E5 query embeddings → subject-filtered active-atomic pool → V2 Enriched Passage Builder → E5 passage embeddings → per-view rankings → RRF aggregation → Top12.

## 21. Subject Hard Filter

- Pool construction filters `node.subject === question.subject` before any scoring; candidates from other subjects never enter scoring.

## 22. Active Atomic Only

- Candidate pool = active atomic nodes only. Chapter/section/subject nodes may appear as passage context fields but are never candidates (they are non-atomic).

## 23. Structural Metadata

- No kpMatched/chapterMatched score bonus in V2 semantic scoring. If computed, they are diagnostics only.

## 24. Data Roles

```text
V1 DEV 24:            regression / diagnostic evidence only
V1 consumed HOLDOUT 16: regression / diagnostic evidence only; never a final test
NEW V2 DEV 72:        the ONLY source of V2 final configuration selection metrics
NEW V2 HOLDOUT 28:    the only final blind test set
```

## 25. Old 40 Usage

- The old 40 may be used for representation sanity, regression, and design validation.
- They may be reported as `legacy regression metrics` alongside V2 experiments, but they must NOT enter the V2 final configuration selection metric. The pre-registered matrix winner is selected ONLY on the new V2 DEV 72. Merging old 40 + new 72 into a 112-question selection set is forbidden, to prevent the known 3 misses from over-influencing V2 selection.
- They may not be used as the V2 final blind Gate.

## 26. New V2 Benchmark

Locked numbers:

```text
total   100   (DS 25 / CO 25 / OS 25 / CN 25)
DEV     72    (18 per subject)
HOLDOUT 28    (7 per subject)
```

Math check: 4 × 25 = 100; 4 × 18 = 72; 4 × 7 = 28.

## 27. Independence Constraints for the New 100

- No exact duplicate and no version duplicate of any old Gold question.
- Not derived by rewriting the 3 old miss questions.
- Not generated to target current algorithm weaknesses (no leakage-style sampling).

## 28. Data Source Design

Audited the frozen snapshot corpus:

```text
total questions: 332
independent current: 326
old Gold: 40
remaining independent current (not in old Gold): 286
  DS 70 / CO 75 / OS 70 / CN 71
referenced KPs covered by remaining: 16/16 relevant KPs
difficulty: BASIC 112 / MEDIUM 119 / HARD 55
source: 自编基础题 64 / 自编变式题 221 / 教师新增 1
year: 2026 × 286
```

The corpus is sufficient: 286 ≥ 100. No synthetic questions are needed. Sampling is deterministic from the real remaining pool.

## 29. V2 Gold Sampling

Deterministic stratified sample of 100 from the 286 remaining independent current questions:

- subject: 25 per subject.
- KnowledgePoint: every referenced KP represented in DEV; HOLDOUT covers all subjects and includes the known difficult KPs (co-cache, co-data, ds-sort, os-file).
- difficulty: target ≈ BASIC 40% / MEDIUM 40% / HARD 20%.
- source/year: prefer variety (all remaining are 2026; source mix 基础题/变式题/教师新增 as available).
- chapter diversity: spread across chapters per subject.
- Sampling is computed from workspace data only (no hardcoded production counts; no targeting of the 3 old misses).

## 30. V2 Split

- 72 DEV / 28 HOLDOUT; 18/7 per subject.
- Split is frozen before any V2 retrieval tuning.

## 31. Gold Truth Authoring

- Human authoring only: PRIMARY exactly 1, SECONDARY 0–2.
- Gold truth is decided from knowledge-tree search + manual judgement; retriever candidate output is never used as the Gold oracle (no circular evaluation).
- The frozen split (DEV/HOLDOUT) is stored in the manifest but is NOT displayed as a judgment cue in the authoring UX. The authoring view shows question, subject, knowledge tree and authoring state only. If the existing CLI cannot hide the split without cost, this does not block V2, but the invariant is recorded: split must never affect Gold labeling decisions.

## 32. Gold Authoring Workload

- Reuse the existing Gold authoring infrastructure (gold-author CLI, draft/confirmed/resume) — no second CLI.
- Resumable workflow: draft → confirm → freeze; fingerprint protection per question; 100-question workload is handled incrementally with the existing resume-safe gold-set.

## 33. V2 Version Isolation

```text
gold-sample-v2.json
gold-set-v2.json
gold-truth-v2.json
```

V1 files (`gold-sample-v1.json`, `gold-set-v1.json`, `gold-truth-manifest-v1.json`) remain untouched and reproducible.

## 34. V2 DEV Usage

- DEV 72 is used to select the multi-view aggregation (pre-registered A/B/C comparison), validate passage V1 vs V2, and make limited representation decisions.
- Experiment budget is capped by the pre-registered matrix (below); no post-hoc Variant D/E/F/G.

## 35. Pre-registered Experiment Matrix

Frozen before seeing new V2 DEV metrics:

```text
Query:
  Q1 stem-only
  Q2 stem + analysis RRF (k=60)      [V2 default]

Passage:
  P1 V1 (unlabeled name + chapterName + sectionName)
  P2 canonical labeled hierarchical passage v2 (考点：<name> 章节：<chapterName> 小节：<sectionName>)

Matrix (4 cells):
  Q1P1  = V1 baseline reproduction
  Q1P2  = enrichment only
  Q2P1  = multi-view only
  Q2P2  = multi-view + enrichment     [V2 default candidate]
```

No additional variants may be added after seeing DEV results.

## 36. Model Fixed

- All experiments use `Xenova/multilingual-e5-small`, revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`, transformers.js 3.8.1, pooling mean, L2, 384 dims, unchanged prefixes.

## 37. V2 Metrics

- PRIMARY Recall@8, PRIMARY Recall@12, Macro AllRelevantRecall@12 (primary gate priority).
- MRR added as diagnostic only (does not change the gate priority).

## 38. Final DEV Selection Rule (locked before results)

```text
1. PRIMARY Recall@12
2. PRIMARY Recall@8
3. Macro AllRelevantRecall@12
4. MRR (diagnostic tie-break)
5. simpler configuration (fewer moving parts)
```

Default expectation: Q2P2 wins; a simpler cell may win only if it ties or strictly dominates on the priority order.

## 39. New HOLDOUT Gate

The single locked gate is defined below (§40). The earlier draft options (26/28 and 27/28 @12 variants) are rejected: 26/28 (92.86%) would be an unannounced relaxation of the V1 standard (15/16 ≈ 93.75%) and must not be described as equivalent to it. A 27/28 @12 variant would break the Top12 candidate-ceiling guarantee.

## 40. Final Holdout Gate

Final locked Holdout Gate (28 questions, locked before any new HOLDOUT evaluation):

```text
PRIMARY Recall@8:    >= 27/28 (96.43%)
PRIMARY Recall@12:   = 28/28 (100%)
Macro AllRelevant@12: >= 0.90
Safety:              all zero
```

Rationale: 27/28 preserves the "at most 1 Top8 miss" engineering standard from V1 (15/16 ≈ 93.75%) without secretly relaxing it, while allowing exactly one boundary miss. Recall@12 must be 28/28 (100%) because Top12 is the ceiling for the later AI candidate selector. Per-subject metrics are diagnostics only (7/subject is too small for an independent hard gate).

## 41. One-shot Policy

```text
DEV select → freeze V2 config → commit → HOLDOUT evaluated = 0 → one-shot new HOLDOUT
PASS → Plan B
FAIL → V2 HOLDOUT consumed → Retrieval V3 with a new test set
```

No retuning after the new HOLDOUT is evaluated.

## 42. Plan B Entry Condition

- Only a PASS on the new 28-question blind HOLDOUT Gate permits starting Plan B (AI candidate selector, AnnotationModelProvider, full-question annotation, human review).
- A good DEV result alone is never sufficient.

## 43. No AI Selector Design

- This design does not discuss prompt engineering, LLM provider, confidence scoring, review UI, or production seeding. Those belong to Plan B.

## 44. Error Handling

```text
analysis missing/empty/short : stem-only fallback; viewAvailability recorded
node parent missing          : omit parent/context (sectionName may still exist)
optional metadata missing    : omit that labeled field
cache miss                   : recompute deterministically
model unavailable            : fail (BLOCKED), never fall back to fake embeddings
dimension mismatch           : fail closed
subject missing on question  : fail closed
no candidate                 : return [] (fail-safe)
non-finite embedding         : fail closed (candidate rejected / error)
```

Fail closed where data integrity matters; graceful deterministic fallback where optional text is missing.

## 45. Determinism

- Same snapshot + Gold + model revision + query builder version + passage builder version + aggregation version → identical ranking.
- Tie-break: nodeId ASC.

## 46. Versioning (locked)

```text
QUERY_VIEW_VERSION            = query-views-v2
PASSAGE_VERSION               = knowledge-node-passage-v2
PASSAGE_FORMAT                = canonical-labeled-hierarchical-passage-v2
SEMANTIC_AGGREGATION_VERSION  = semantic-rrf-v2
SEMANTIC_RETRIEVER_VERSION    = semantic-retriever-v2
V2_GOLD_VERSION               = gold-truth-v2
V2_BENCHMARK_VERSION          = retrieval-benchmark-v2
```

## 47. Git-safe Metadata

Final config and benchmark artifacts record:

```text
snapshotId
Gold SHA
model id / revision / transformers version
query representation version
passage representation version
aggregation version
metrics
selected config
```

No question text (stem/options/answer/analysis) in Git artifacts.

## 48. Retrieval V1 Permanent Retention

- `final-retriever-v1.json`, the V1 benchmark, and the V1 Gate FAIL record remain untouched. V2 is a new version; V1 history is not rewritten to PASS.

## 49. Overall V2 Architecture Options

```text
Option 1 (recommended): multi-view semantic + passage enrichment, semantic-only
Option 2:               Option 1 + lexical hybrid (RRF 3-way) — deferred to a later comparison on the fresh test set
Option 3:               model change / reranking — future route only, not V2 first version
```

Comparison:

```text
expected benefit:    Option 1 targets both observed failure classes (boundary + deep)
complexity:          Option 1 lowest
overfitting risk:    Option 1 lowest (no new learned parameters)
interpretability:    Option 1 highest (per-view ranks + rrf)
implementation cost: Option 1 lowest
```

Recommendation: **Option 1**. No blocker found in the schema audit (286 remaining questions, 16/16 KPs, all enrichment fields exist in the snapshot).

## 50. Acceptance Criteria for V2

- Multi-view semantic retrieval implemented per this design (stem + analysis RRF k=60).
- Deterministic canonical labeled hierarchical passage (`knowledge-node-passage-v2` / `canonical-labeled-hierarchical-passage-v2`) with the locked format.
- No nodeId in semantic text; no aliases/keywords/description invented.
- Pre-registered 4-cell matrix executed on new DEV; final selection by the locked rule.
- New 28-question blind HOLDOUT evaluated once; G2 gate; no retune after.
- V1 untouched; old HOLDOUT never a final test.

## 51. Spec Self-Review

- Consistency: semantic-only throughout; lexical/hybrid appears only in rejected/deferred options (Option 2) and data-role sections, never in the V2 default pipeline.
- Leakage: old HOLDOUT is explicitly diagnostic/regression-only; new 100 excludes exact/version duplicates of old Gold and is not derived from the 3 misses.
- Benchmark math: 4 × 25 = 100; 4 × 18 = 72; 4 × 7 = 28.
- Versioning: V1/V2 fully isolated (config, gold files, passage version, cache content).
- Gate: exactly one locked gate (27/28 @8, 28/28 @12) locked before any new HOLDOUT evaluation; no open options remain in the body.
- Passage: P2 adds explicit level labels and hierarchy framing; it does NOT add missing attribute semantics (audited — the tree has no aliases/keywords/description, and numeric metadata is out of scope). Miss 1's attribute gap is deferred to a separate knowledge-catalog semantic metadata enhancement.
- Fusion: with full same-subject rankings feeding RRF (no pre-fusion truncation), a node at stem rank 14 with analysis rank 1 still receives both contributions and can be rescued into Top12 — this directly addresses the V1 boundary misses.
- Data roles: old 40 → regression only; new 72 → selection; new 28 → blind final gate. Old 40 never enters the selection metric.
- Gold: new HOLDOUT truth authoring is not influenced by retriever output, and the split is hidden from authoring UX.

## 52. Design Review Amendment (2026-08-09)

Resolutions from the design review:

1. Passage enrichment is reframed as `canonical labeled hierarchical passage v2`: it validates field order, hierarchy context and labeled representation only. It does not add attribute semantics missing from the tree; the Miss 1 property gap is deferred to a separate knowledge-catalog semantic metadata enhancement (V3 candidate). `subjectName` is excluded (constant under the hard subject filter).
2. Multi-view RRF pre-fusion depth is locked: FULL same-subject rankings for both stem and analysis; no Top8/Top12 pre-truncation; k = 60; rrfScore DESC then nodeId ASC; no structural bonus.
3. Data roles are locked: old 40 → regression/diagnostic only (legacy regression metrics); winner selected only on new V2 DEV 72; new 28 is the only blind final gate. Merging old 40 + new 72 is forbidden.
4. Gold authoring hides the split in the authoring UX (manifest still stores the frozen split); retriever output remains forbidden as the Gold oracle.
5. The Holdout Gate is locked to a single standard: PRIMARY Recall@8 >= 27/28 (96.43%), PRIMARY Recall@12 = 28/28 (100%), Macro >= 0.90, safety all zero.

## 52. Alternatives Rejected

- Max similarity (Approach B): a single noisy view can dominate raw-score ranking.
- Weighted similarity (Approach C): unprincipled α/β, overfitting risk.
- Lexical hybrid in V2 first version (Option 2): deferred; old 3-way fusion was not proven on a fresh test set.
- Model replacement / reranker (Option 3): no evidence that a different model fixes the diagnosed representation issues; violates controlled-variable principle.

## 53. Safety

- Retrieval V1 modified: NO
- Old HOLDOUT reused as final test: NO
- Gold modified: NO
- Knowledge tree modified: NO
- V2 implementation started: NO
