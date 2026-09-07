/**
 * LE-V10 Feature 1 / Milestone 1 — Exam Alignment Selector (pure projection).
 *
 * Projects the existing recommendation intelligence down to the question
 * level: for each recommended question, join its knowledge nodes with the
 * frequency snapshots, the user's mastery state, and the real exam question
 * tags — producing the explainable "why this question NOW" payload.
 *
 * Discipline (docs/feature1-real-exam-practice-plan.md §5):
 *   - pure functions only, zero imports, deterministic (time/IO injected by
 *     the service layer); deleting this module removes a projection, never a
 *     source of truth
 *   - honesty: NO snapshot → null fields + 0 stars (never a fabricated "0
 *     次"); NO mastery record → null ("尚未练习", never 0%); LOW evidence
 *     confidence hides the estimated gain entirely
 *   - every estimate carries its formula; the gain factor is conservative
 *   - star semantics mirror the engine's HIGH_RECENT_FREQUENCY trigger
 *     (packages/shared/src/score-center/priority.ts) — a source-level test
 *     keeps the two from drifting apart
 */

export const ENGINE_HIGH_RECENT_FREQUENCY_THRESHOLD = 4; // mirrors priority.ts: recent3Y.frequency >= 4
export const GAIN_CONSERVATIVE_FACTOR = 0.6;
export const GAIN_FORMULA = 'round(primaryScore5y × (1 − mastery) × 0.6)';

const EXAM_HITS_MAX = 3;
const COVERED_YEARS_MAX = 5;

export interface AlignmentNodeMeta {
  readonly knowledgeNodeId: string;
  readonly name: string;
  readonly subject: string;
}

export interface AlignmentFrequencySnapshot {
  readonly knowledgeNodeId: string;
  readonly recent3Frequency: number;
  readonly recent5Frequency: number;
  readonly allTimeEvidence: number;
  readonly primaryScore5y: number;
  readonly trendDirection: string;
  readonly trendDelta: number | null;
  readonly evidenceConfidence: string;
}

export interface AlignmentExamHit {
  readonly knowledgeNodeId: string;
  readonly year: number;
  readonly subject: string;
  readonly questionNo: number;
}

export interface AlignmentMasteryState {
  readonly knowledgeNodeId: string;
  readonly mastery: number;
  readonly attempts: number;
}

export interface AlignmentNodeIndex {
  readonly nodesById: Readonly<Record<string, AlignmentNodeMeta>>;
  readonly snapshotByNode: Readonly<Record<string, AlignmentFrequencySnapshot>>;
  readonly masteryByNode: Readonly<Record<string, AlignmentMasteryState>>;
  readonly examHitsByNode: Readonly<Record<string, readonly AlignmentExamHit[]>>;
}

export interface AlignmentQuestionInput {
  readonly questionId: string;
  /** Ordered node ids (PRIMARY before SECONDARY — the service layer orders them). */
  readonly nodeIds: readonly string[];
}

export interface QuestionExamAlignment {
  readonly questionId: string;
  readonly primaryNode: { readonly knowledgeNodeId: string; readonly name: string; readonly subject: string } | null;
  readonly stars: 0 | 1 | 2 | 3 | 4 | 5;
  readonly recent5Frequency: number | null;
  readonly recent3Frequency: number | null;
  readonly allTimeEvidence: number | null;
  readonly frequencyConfidence: string | null;
  readonly trendDirection: string | null;
  readonly lastSeenYear: number | null;
  readonly mastery: number | null;
  readonly attempts: number | null;
  readonly predictedGainEstimate: number | null;
  readonly examHits: readonly { readonly year: number; readonly subject: string; readonly questionNo: number }[];
  readonly evidence: {
    readonly frequencySource: { readonly table: 'KnowledgeFrequencySnapshot'; readonly nodeId: string | null };
    readonly masterySource: { readonly table: 'UserKnowledgeMastery'; readonly nodeId: string | null };
    readonly gainFormula: string;
  };
}

export interface ExamAlignmentResult {
  readonly summary: {
    readonly coveredNodeCount: number;
    readonly coveredYears: readonly number[];
    readonly highFrequencyCount: number;
  };
  readonly items: readonly QuestionExamAlignment[];
}

function starsFromRecent5(recent5Frequency: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (recent5Frequency >= 5) return 5;
  if (recent5Frequency >= 3) return 4;
  if (recent5Frequency >= 1) return 3;
  return 0;
}

function estimateGain(
  snapshot: AlignmentFrequencySnapshot,
  masteryState: AlignmentMasteryState,
): number | null {
  if (snapshot.evidenceConfidence === 'LOW') return null;
  return Math.round(snapshot.primaryScore5y * (1 - masteryState.mastery) * GAIN_CONSERVATIVE_FACTOR);
}

function capExamHits(hits: readonly AlignmentExamHit[]): { year: number; subject: string; questionNo: number }[] {
  const seen = new Set<string>();
  return [...hits]
    .sort((left, right) => right.year - left.year || left.questionNo - right.questionNo)
    .filter((hit) => {
      const key = `${hit.year}#${hit.questionNo}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, EXAM_HITS_MAX)
    .map((hit) => ({ year: hit.year, subject: hit.subject, questionNo: hit.questionNo }));
}

function buildItem(question: AlignmentQuestionInput, index: AlignmentNodeIndex): QuestionExamAlignment {
  const nodeIds = question.nodeIds;
  // Primary node = first node that actually carries exam evidence; fall back
  // to the first resolved node so the card can still name the topic.
  const primaryNodeId =
    nodeIds.find((id) => index.snapshotByNode[id] != null) ?? nodeIds[0] ?? null;

  if (primaryNodeId == null) {
    return {
      questionId: question.questionId,
      primaryNode: null,
      stars: 0,
      recent5Frequency: null,
      recent3Frequency: null,
      allTimeEvidence: null,
      frequencyConfidence: null,
      trendDirection: null,
      lastSeenYear: null,
      mastery: null,
      attempts: null,
      predictedGainEstimate: null,
      examHits: [],
      evidence: {
        frequencySource: { table: 'KnowledgeFrequencySnapshot', nodeId: null },
        masterySource: { table: 'UserKnowledgeMastery', nodeId: null },
        gainFormula: GAIN_FORMULA,
      },
    };
  }

  const meta = index.nodesById[primaryNodeId] ?? {
    knowledgeNodeId: primaryNodeId,
    name: primaryNodeId,
    subject: '未分类',
  };
  const snapshot = index.snapshotByNode[primaryNodeId] ?? null;
  const masteryState = index.masteryByNode[primaryNodeId] ?? null;
  const hits = index.examHitsByNode[primaryNodeId] ?? [];
  const cappedHits = capExamHits(hits);

  return {
    questionId: question.questionId,
    primaryNode: { knowledgeNodeId: meta.knowledgeNodeId, name: meta.name, subject: meta.subject },
    stars: snapshot ? starsFromRecent5(snapshot.recent5Frequency) : 0,
    recent5Frequency: snapshot ? snapshot.recent5Frequency : null,
    recent3Frequency: snapshot ? snapshot.recent3Frequency : null,
    allTimeEvidence: snapshot ? snapshot.allTimeEvidence : null,
    frequencyConfidence: snapshot ? snapshot.evidenceConfidence : null,
    trendDirection: snapshot ? snapshot.trendDirection : null,
    lastSeenYear: cappedHits.length > 0 ? cappedHits[0].year : null,
    mastery: masteryState ? masteryState.mastery : null,
    attempts: masteryState ? masteryState.attempts : null,
    predictedGainEstimate: snapshot && masteryState ? estimateGain(snapshot, masteryState) : null,
    examHits: cappedHits,
    evidence: {
      frequencySource: { table: 'KnowledgeFrequencySnapshot', nodeId: snapshot ? primaryNodeId : null },
      masterySource: { table: 'UserKnowledgeMastery', nodeId: masteryState ? primaryNodeId : null },
      gainFormula: GAIN_FORMULA,
    },
  };
}

export function buildExamAlignment(
  questions: readonly AlignmentQuestionInput[],
  index: AlignmentNodeIndex,
): ExamAlignmentResult {
  const items = questions.map((question) => buildItem(question, index));

  const coveredNodes = new Set<string>();
  const highFrequencyNodes = new Set<string>();
  const years = new Set<number>();
  for (const item of items) {
    if (item.primaryNode == null) continue;
    if (item.recent5Frequency != null && item.recent5Frequency > 0) {
      coveredNodes.add(item.primaryNode.knowledgeNodeId);
    }
    if (item.stars >= 4) highFrequencyNodes.add(item.primaryNode.knowledgeNodeId);
    // Summary years describe the set's full coverage — the per-item display
    // cap (3 hits) must not truncate them.
    for (const hit of index.examHitsByNode[item.primaryNode.knowledgeNodeId] ?? []) {
      years.add(hit.year);
    }
  }

  return {
    summary: {
      coveredNodeCount: coveredNodes.size,
      coveredYears: [...years].sort((left, right) => right - left).slice(0, COVERED_YEARS_MAX),
      highFrequencyCount: highFrequencyNodes.size,
    },
    items,
  };
}

export interface RecentPracticeRef {
  readonly questionId: string;
  readonly lastPracticedAt: string;
}

/**
 * Exam-aligned ordering — a projection over already-selected questions. The
 * recommendation engine keeps full authority over WHAT is recommended; this
 * only orders the set by exam value (stars → frequency → mastery headroom,
 * never-practiced counting as full headroom) and demotes recently practiced
 * questions so the same set stays fresh. Deterministic tiebreak by questionId.
 */
export function rankByExamAlignment(
  items: readonly QuestionExamAlignment[],
  recentPractice: readonly RecentPracticeRef[],
): QuestionExamAlignment[] {
  const practiced = new Set(recentPractice.map((ref) => ref.questionId));
  const headroom = (item: QuestionExamAlignment): number =>
    item.mastery == null ? 1 : 1 - item.mastery;
  const tierScore = (item: QuestionExamAlignment): number =>
    item.stars * 1000 + (item.recent5Frequency ?? 0) * 50 + headroom(item) * 100;

  return [...items].sort((left, right) => {
    const practicedDelta = Number(practiced.has(left.questionId)) - Number(practiced.has(right.questionId));
    if (practicedDelta !== 0) return practicedDelta;
    const scoreDelta = tierScore(right) - tierScore(left);
    if (scoreDelta !== 0) return scoreDelta;
    return left.questionId.localeCompare(right.questionId);
  });
}

/**
 * M2 — attaches the examAlignment section to a practice-set payload.
 *
 * Plain mode (anything but 'exam_aligned') returns the base untouched — not
 * even the key — so the non-aligned response stays byte-identical to
 * production. exam_aligned without a working store or without alignment data
 * yields an explicit `examAlignment: null` (honest absence, never a fake
 * payload). With data, the ranking is applied to the alignment items.
 */
export function withExamAlignmentSection<
  T extends { readonly questions: readonly { readonly id: string }[] },
>(
  base: T,
  mode: string | null | undefined,
  alignment: ExamAlignmentResult | null,
  options: { serviceEnabled: boolean; recentPractice?: readonly RecentPracticeRef[] },
): T & { examAlignment?: ExamAlignmentResult | null } {
  if (mode !== 'exam_aligned') return base;
  if (!options.serviceEnabled || alignment == null) {
    return { ...base, examAlignment: null };
  }
  return {
    ...base,
    examAlignment: {
      summary: alignment.summary,
      items: rankByExamAlignment(alignment.items, options.recentPractice ?? []),
    },
  };
}
