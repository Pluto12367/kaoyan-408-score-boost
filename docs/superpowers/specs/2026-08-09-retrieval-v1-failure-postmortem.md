# Retrieval V1 Failure Postmortem

Date: 2026-08-09

Status: COMPLETE — analysis only; no algorithm change, no V2 implementation.

## Frozen V1 Context

- Final retriever: `semantic-e5-v1` (`Xenova/multilingual-e5-small`, revision `761b726dd34fb83930e26aab4e9ac3899aa1fa78`)
- Final config SHA: `3533ed7aa0e1635a942a2dce823a17fb4fb8cc336fe24ea4a95cd09ed88443b7`
- Gold Truth SHA: `6ca5fa53e8b0db415c7d7132445a72bf10297550d110df0b92f8ce301fabd99d`
- V1 final gate: HOLDOUT PRIMARY Recall@8 = 13/16, Recall@12 = 13/16, Macro@12 = 0.8125 → `TASK 9 GATE FAIL`, HOLDOUT consumed.
- Safety: crossSubject=0, activeAtomicViolations=0, invalidNodes=0, duplicates=0, nonFiniteScores=0.

The 16 old HOLDOUT questions are no longer a blind test set. They are used here only for failure diagnosis. Retrieval V1 is permanently frozen.

## Diagnostic Method

- Same frozen E5 config, same stem-query/passage contract (passage = name + chapterName + sectionName; query = stem, prefixed `query: `).
- Ranks computed only for diagnosis with a deeper pool (Top 60) — not a new Gate result.
- Lexical rank: Task 6 BM25 (`lexical-bm25-v1`, k1=1.2, b=0.75). Hybrid rank: Task 8 RRF (`rrf-k60-bonus-v1`) over lexical + stem + analysis lists.

## Miss 1 — cmsfi7xqq0015ez9ipb2qwjrj (DS)

- Gold PRIMARY: `DS-C04-S02-P10` 「二叉树链式存储」 (section 二叉树, chapter 树与二叉树)
- Ranks: semantic stem > 60 | semantic analysis 27 | lexical 14 | hybrid 45
- Semantic stem Top12 (top competitors): DS-C02-S03-P02 头结点与头指针、DS-C02-S03-P11 双链表插入、DS-C03-S02-P05 循环队列判空判满、DS-C04-S01-P90 m叉树结点数与高度关系、DS-C02-S03-P12 双链表删除、DS-C02-S03-P01 单链表结点结构、DS-C02-S03-P06 单链表按值查找、DS-C02-S03-P17 链表公共结点、DS-C06-S07-P02 m阶B树性质、DS-C06-S04-P03 BST插入、DS-C02-S03-P05 单链表按位查找、DS-C02-S03-P07 单链表插入
- Gold confidence: HIGH (the null-pointer-count property belongs to the linked-storage representation node; adjacent 二叉树性质 node is an acceptable alternative but not clearly better)
- Primary failure type: B. NODE_TEXT_INSUFFICIENT
- Secondary failure type: F. EMBEDDING_LIMITATION
- Root cause: the gold passage ("二叉树链式存储 树与二叉树 二叉树") does not express the tested property (null pointer fields in binary linked storage). The question's compound term "二叉链表" is semantically clustered by E5 toward plain linked-list nodes; even the analysis view (which contains the property wording) reaches only rank 27, and BM25 reaches 14. The node text and the query semantics are both weakly bridged.
- Evidence: stem rank > 60; analysis rank 27; lexical rank 14; top semantic competitors are linked-list nodes with no binary-tree-storage property text.
- Recommended V2 direction: deterministic node passage enrichment (subject/chapter/section/name/parent/section name, plus legitimate existing metadata), and evaluate a multi-view (stem + analysis) semantic ranking; do not derive aliases from this question.

## Miss 2 — cmsfi7y4z00b5ez9i1kgxs2o8 (OS)

- Gold PRIMARY: `OS-C03-S03-P02` 「页号与页内偏移」 (section 分页管理, chapter 内存管理)
- Ranks: semantic stem 14 | semantic analysis 1 | lexical 1 | hybrid 2
- Semantic stem Top12 (top competitors): OS-C03-S03-P05 地址转换、OS-C03-S04-P03 分段地址转换、OS-C03-S04-P06 段页式地址转换、OS-C03-S03-P90 最少页框数与指令寻址、OS-C03-S03-P03 页表、OS-C03-S03-P04 页表项、OS-C03-S03-P08 TLB地址转换、OS-C03-S03-P11 反置页表、OS-C03-S01-P02 逻辑地址与物理地址、OS-C03-S03-P10 多级页表、OS-C03-S03-P06 页表大小计算、OS-C03-S03-P01 页与页框
- Gold confidence: HIGH (node name exactly matches the tested concept)
- Primary failure type: F. EMBEDDING_LIMITATION
- Secondary failure type: D. GRANULARITY_CONFUSION (dense 分页管理 section: 12 adjacent atomic nodes)
- Root cause: near-miss boundary — the gold node is rank 14 in the stem semantic view, just outside Top12, while analysis (1), lexical (1) and hybrid (2) all recover it. The stem query's "逻辑地址" wording activates address-conversion nodes; the gold node's short passage ("页号与页内偏移 内存管理 分页管理") is otherwise a verbatim match. Single-view stem ranking is fragile at the boundary.
- Evidence: stem 14 (vs Top12 cutoff), analysis 1, lexical 1, hybrid 2.
- Recommended V2 direction: multi-view semantic ranking (stem + analysis) and/or a slightly larger diagnostic candidate pool; keep subject hard filter.

## Miss 3 — cmsfi7y6j00c9ez9ifi22da3c (OS)

- Gold PRIMARY: `OS-C04-S02-P02` 「文件控制块FCB」 (section 目录, chapter 文件管理)
- Ranks: semantic stem 14 | semantic analysis 12 | lexical 9 | hybrid 11
- Semantic stem Top12 (top competitors): OS-C04-S02-P07 硬链接、OS-C04-S02-P06 目录操作、OS-C04-S02-P08 软链接、OS-C04-S02-P09 硬链接与软链接比较、OS-C04-S02-P03 单级目录、OS-C04-S02-P01 目录概念、OS-C04-S01-P09 顺序文件、OS-C04-S02-P04 两级目录、OS-C04-S01-P11 索引顺序文件、OS-C04-S01-P02 文件属性、OS-C04-S01-P15 显式链接FAT、OS-C04-S01-P13 连续分配
- Gold confidence: HIGH (FCB is the canonical concept for directory entries)
- Primary failure type: F. EMBEDDING_LIMITATION
- Secondary failure type: C. SYNONYM_GAP (question wording "文件目录项" vs node name "文件控制块FCB")
- Root cause: near-miss boundary — stem rank 14, just outside Top12; analysis (12) and lexical (9) also near the boundary; hybrid (11) would include it. The question term "文件目录项" is not literally in the node passage; E5 places directory-operation and file-organization nodes slightly higher.
- Evidence: stem 14, analysis 12, lexical 9, hybrid 11.
- Recommended V2 direction: multi-view semantic ranking plus deterministic passage enrichment that includes the section context (目录) and any legitimate metadata; evaluate synonym coverage without per-question aliases.

## Cross-Case Findings

- Node passage issue: YES for Miss 1 (property keywords absent from the gold passage); passages are otherwise short (name+chapter+section only).
- Query issue: secondary — the stem view alone is the fragile channel; no evidence of query noise in the analysis view.
- Analysis noise: NO — the analysis view is the recovery channel for Miss 2 (rank 1) and Miss 3 (rank 12) and improves Miss 1 (27 vs >60). It is not the noise source for these failures.
- Granularity issue: contributes in Miss 2 (dense 分页管理 section) and Miss 3 (dense 目录 section).
- Embedding limitation: primary factor in 2/3 (boundary rank 14) and a contributor in Miss 1.
- Gold/tree issue: Gold labels are all HIGH confidence; no obvious wrong labels. Tree nodes are valid but their passage text is minimal and some sections are dense with similar atomic nodes.

## V2 Priorities

Ordered by evidence, not intuition:

- P0: Multi-view semantic retrieval (stem + analysis) with a deterministic combination (e.g., rank fusion), evaluated on a NEW blind test set. Evidence: Miss 2 and Miss 3 are recovered by the analysis view; the V1 stem-only single view is boundary-fragile (two rank-14 misses). Hypothesis to verify: fusing stem+analysis raises boundary recall without hurting precision.
- P1: Deterministic KnowledgeNode passage enrichment (subject / chapter / section / name / parent-section name, plus legitimate existing metadata if the schema provides it). Evidence: Miss 1's gold passage cannot express the tested property. Hypothesis to verify: richer deterministic passages improve deep-miss cases without per-question hacks.
- P1: Larger blind benchmark (see below) so single-question noise does not dominate per-subject conclusions (old holdout had 4/subject → one miss = 25%).
- P2: Re-evaluate hybrid (lexical+RRF) as a V2 candidate on the new test set; keep subject hard filter. Hypothesis: hybrid may complement multi-view semantic at the boundary.

## V2 Benchmark Recommendation

Old benchmark: 40 total / 24 DEV / 16 HOLDOUT / 4 HOLDOUT per subject.

Recommended V2 (design only, no split generated):

- total: 100 (25 per subject)
- DEV: 72 (18 per subject)
- HOLDOUT: 28 (7 per subject) — one miss = ~14%, vs 25% before
- distribution: balanced 4 subjects; difficulty mix approx. BASIC 40% / MEDIUM 40% / HARD 20%; source/year variety (基础题/变式题/真题改编/教师新增)
- coverage: every referenced KnowledgePoint represented in DEV; HOLDOUT covers all subjects and the known difficult KPs (co-cache, co-data, ds-sort, os-file included)
- duplicate policy: only INDEPENDENT_UNIT representatives; EXACT_DUPLICATE_COPY and HISTORICAL_ONLY excluded; family-version lineage keeps only the current version
- freeze policy: selection on DEV only; one-shot HOLDOUT; no retune after HOLDOUT; new test set must not be derived from the consumed 16

## Safety

- Retrieval V1 modified: NO
- Old HOLDOUT reused as final test: NO (consumed; diagnosis only)
- Gold modified: NO
- Knowledge tree modified: NO
- V2 implementation started: NO
