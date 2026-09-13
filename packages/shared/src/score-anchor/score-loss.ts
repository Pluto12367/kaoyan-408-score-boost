/**
 * S1-P1 (SC-1, formal design §三) — Score Loss Evidence derivation + projection.
 *
 * Per-question loss turns the ledger's scalar "how much was lost" into "which
 * question lost it, for how many points, on which node". The rules are the
 * approved invariants, each pinned by test:
 *
 *   IL-1  Σ questionLoss ≤ the entry's envelope. For `exam_total` rows the
 *         envelope is the row's own `rawTotalScale − rawScore` (points vs
 *         points). For `accuracy_rate` rows the percentage and the points are
 *         different semantics, so the honest ceiling is the paper's priced
 *         point total — mixing the two scales is exactly the defect class this
 *         repository forbids.
 *   IL-2  Σ nodeAttributedLoss ≤ Σ questionLoss (structural: one node per row).
 *   IL-3  a question's loss lands on exactly ONE node (the canonical PRIMARY
 *         attribution; multi-node membership stays a label).
 *   IL-4  0 ≤ lostScore ≤ maxScore; a stored 0 is a real observation.
 *   IL-5  unpriced lost questions are COUNTED (maxScore null), never zeroed,
 *         and never scaled away proportionally.
 *   IL-6  observedLoss and proxyLoss are reported separately, never merged.
 *   IL-9  no pricing data → coverage 0 / losses null — absence, not zero.
 *
 * A conservation violation REFUSES to emit (`ok: false`, empty items): the
 * aggregate is not produced, not clipped, not rounded into plausibility.
 *
 * Attribution is an INPUT here — the caller resolves nodes through the
 * canonical resolver (`resolvePrimaryNodeByQuestion`). This module never
 * queries node tags itself, so a second attribution path cannot exist.
 *
 * Pure: deterministic, no clock, no IO.
 */

export type ScoreLossKind = 'OBSERVED' | 'PROXY';

export type ScoreLossGradingMethod = 'exact_match' | 'self_report' | 'rubric';

/** One attempted question's grading facts, with its content-side price and
 *  canonical node attribution resolved by the caller. */
export interface ScoreLossQuestionFact {
  readonly questionId: string;
  readonly correct: boolean;
  readonly gradingMethod: ScoreLossGradingMethod;
  /** 0..1 self-reported credit ratio (self_report grading only). */
  readonly selfScore?: number | null;
  /** Points earned under a rubric (rubric grading only). */
  readonly rubricEarnedScore?: number | null;
  /** Content-declared point value. null = unpriced — never read as 0. */
  readonly maxScore: number | null;
  /** Canonical PRIMARY node from the resolver. null = unattributed. */
  readonly nodeId: string | null;
}

export interface ScoreLossItemDraft {
  readonly questionId: string;
  readonly nodeId: string | null;
  readonly maxScore: number | null;
  readonly earnedScore: number | null;
  readonly lostScore: number | null;
  readonly lossKind: ScoreLossKind;
  readonly gradingMethod: ScoreLossGradingMethod;
}

export interface ScoreLossSummary {
  readonly attemptedQuestions: number;
  readonly lostQuestions: number;
  readonly pricedLostQuestions: number;
  readonly unpricedLostQuestions: number;
  readonly unattributedLostQuestions: number;
  /** pricedLost / lost. null when nothing was lost; 0 when nothing is priced. */
  readonly pricedCoverage: number | null;
  /** Σ OBSERVED lostScore. null when no observed number exists. */
  readonly observedLoss: number | null;
  /** Σ PROXY lostScore. Reported SEPARATELY from observedLoss (IL-6). */
  readonly proxyLoss: number | null;
  readonly nodeAttributedLoss: Readonly<Record<string, number>>;
  readonly conservationBasis: 'exam_total_row' | 'paper_points_envelope' | 'no_lost_questions';
  /** The envelope the loss total was checked against. null = nothing to check. */
  readonly conservationTotal: number | null;
  readonly conservationOk: boolean;
}

export interface ScoreLossDerivation {
  /** false = conservation violated: no rows are emitted (拒绝出数). */
  readonly ok: boolean;
  readonly rejectionReason: string | null;
  readonly items: readonly ScoreLossItemDraft[];
  readonly summary: ScoreLossSummary;
}

const EPSILON = 1e-9;

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Decide whether ONE attempted question lost points, and how much.
 *
 * Returns null when the question lost nothing observable (a fully-earned
 * question produces no loss row — an absent row is "no loss", not a zero row).
 */
function lossOf(fact: ScoreLossQuestionFact): ScoreLossItemDraft | null {
  const { gradingMethod } = fact;
  const maxScore = fact.maxScore != null && Number.isFinite(fact.maxScore) && fact.maxScore >= 0
    ? fact.maxScore
    : null;

  if (gradingMethod === 'exact_match') {
    // Objective exact-match: the attempt earned everything or nothing.
    if (fact.correct && maxScore != null) return null; // full credit: no loss
    if (!fact.correct && maxScore == null) {
      // Lost, but the content price is unknown: record the fact, not a number.
      return { questionId: fact.questionId, nodeId: fact.nodeId, maxScore: null, earnedScore: null, lostScore: null, lossKind: 'OBSERVED', gradingMethod };
    }
    if (!fact.correct) {
      return { questionId: fact.questionId, nodeId: fact.nodeId, maxScore, earnedScore: 0, lostScore: maxScore, lossKind: 'OBSERVED', gradingMethod };
    }
    // correct on an unpriced question: nothing observable was lost.
    return null;
  }

  // Partial-credit grading: earned comes from the grading record itself.
  const isRubric = gradingMethod === 'rubric';
  const lossKind: ScoreLossKind = isRubric ? 'OBSERVED' : 'PROXY';
  const rawEarned = isRubric ? fact.rubricEarnedScore : fact.selfScore;

  if (rawEarned == null) {
    // The grade exists but the earned value was never recorded. The question
    // counts as lost only when the coarse flag says so; the amount stays null.
    if (!fact.correct) {
      return { questionId: fact.questionId, nodeId: fact.nodeId, maxScore, earnedScore: null, lostScore: null, lossKind, gradingMethod };
    }
    return null;
  }

  if (maxScore == null) {
    // Unpriced partial-credit question: a ratio exists but no point value.
    if (!fact.correct && rawEarned < 1) {
      return { questionId: fact.questionId, nodeId: fact.nodeId, maxScore: null, earnedScore: null, lostScore: null, lossKind, gradingMethod };
    }
    return null;
  }

  const earned = isRubric
    ? Math.max(0, Math.min(maxScore, rawEarned))
    : Math.max(0, Math.min(maxScore, clamp01(rawEarned) * maxScore));
  const lost = round3(maxScore - earned);
  if (lost <= EPSILON) return null; // full credit claimed: nothing lost
  return { questionId: fact.questionId, nodeId: fact.nodeId, maxScore, earnedScore: round3(earned), lostScore: lost, lossKind, gradingMethod };
}

export function deriveScoreLossItems(input: {
  facts: readonly ScoreLossQuestionFact[];
  entrySemantic: string;
  entryRawScore: number | null;
  entryRawTotalScale: number | null;
  /** Σ Question.maxScore over every question of the session (priced envelope). */
  sessionPricedTotalPoints: number | null;
}): ScoreLossDerivation {
  const items: ScoreLossItemDraft[] = [];
  for (const fact of input.facts) {
    const loss = lossOf(fact);
    if (loss) items.push(loss);
  }

  const pricedLostQuestions = items.filter((item) => item.maxScore != null).length;
  const unpricedLostQuestions = items.length - pricedLostQuestions;
  const unattributedLostQuestions = items.filter((item) => item.nodeId == null).length;
  const observed = items.filter((item) => item.lossKind === 'OBSERVED' && item.lostScore != null);
  const proxy = items.filter((item) => item.lossKind === 'PROXY' && item.lostScore != null);
  const observedLoss = observed.length ? round3(observed.reduce((sum, item) => sum + (item.lostScore ?? 0), 0)) : null;
  const proxyLoss = proxy.length ? round3(proxy.reduce((sum, item) => sum + (item.lostScore ?? 0), 0)) : null;

  const nodeAttributedLoss: Record<string, number> = {};
  for (const item of items) {
    if (item.nodeId == null || item.lostScore == null) continue;
    nodeAttributedLoss[item.nodeId] = round3((nodeAttributedLoss[item.nodeId] ?? 0) + item.lostScore);
  }

  const lostQuestions = items.length;
  const pricedCoverage = lostQuestions === 0 ? null : round3(pricedLostQuestions / lostQuestions);

  // The envelope (IL-1). exam_total rows carry their own points envelope; an
  // accuracy_rate row's percentage is a DIFFERENT semantic, so the paper's
  // priced point total is the only honest ceiling.
  let basis: ScoreLossSummary['conservationBasis'];
  let envelope: number | null;
  if (lostQuestions === 0) {
    basis = 'no_lost_questions';
    envelope = null;
  } else if (input.entrySemantic === 'exam_total' && input.entryRawScore != null && input.entryRawTotalScale != null) {
    basis = 'exam_total_row';
    envelope = Math.max(0, input.entryRawTotalScale - input.entryRawScore);
  } else {
    basis = 'paper_points_envelope';
    envelope = input.sessionPricedTotalPoints;
  }

  const lossTotal = (observedLoss ?? 0) + (proxyLoss ?? 0);
  const conservationOk = envelope == null ? true : lossTotal <= envelope + EPSILON;

  if (!conservationOk) {
    return {
      ok: false,
      rejectionReason: `分值守恒失败（conservation）：逐题失分合计 ${lossTotal} 超过该场考试的量纲内失分上界 ${envelope}（${basis}）。拒绝产出逐题失分聚合——不裁剪、不四舍五入掩盖，请先修复数据。`,
      items: [],
      summary: {
        attemptedQuestions: input.facts.length,
        lostQuestions,
        pricedLostQuestions,
        unpricedLostQuestions,
        unattributedLostQuestions,
        pricedCoverage,
        observedLoss,
        proxyLoss,
        nodeAttributedLoss,
        conservationBasis: basis,
        conservationTotal: envelope,
        conservationOk: false,
      },
    };
  }

  return {
    ok: true,
    rejectionReason: null,
    items,
    summary: {
      attemptedQuestions: input.facts.length,
      lostQuestions,
      pricedLostQuestions,
      unpricedLostQuestions,
      unattributedLostQuestions,
      pricedCoverage,
      observedLoss,
      proxyLoss,
      nodeAttributedLoss,
      conservationBasis: basis,
      conservationTotal: envelope,
      conservationOk: true,
    },
  };
}

// ---------------------------------------------------------------------------
// Read projection (API-1 GET /coach/score-loss)
// ---------------------------------------------------------------------------

export interface ScoreLossItemRow {
  readonly questionId: string;
  readonly nodeId: string | null;
  readonly maxScore: number | null;
  readonly earnedScore: number | null;
  readonly lostScore: number | null;
  readonly lossKind: string;
  readonly gradingMethod: string | null;
}

export interface ScoreLossEntryInput {
  readonly scoreEntryKind: string;
  readonly scoreEntryId: string;
  readonly semantic: string;
  readonly rawScore: number | null;
  readonly rawTotalScale: number | null;
  readonly title: string | null;
  readonly recordedAt: string | null;
  readonly items: readonly ScoreLossItemRow[];
}

export interface ScoreLossEntryProjection {
  readonly scoreEntryKind: string;
  readonly scoreEntryId: string;
  readonly semantic: string;
  readonly rawScore: number | null;
  readonly rawTotalScale: number | null;
  readonly title: string | null;
  readonly recordedAt: string | null;
  /** The projection is a DERIVED read model — it must never pose as observed. */
  readonly kind: 'DERIVED';
  readonly items: readonly ScoreLossItemRow[];
  readonly lostQuestions: number;
  readonly pricedLostQuestions: number;
  readonly unpricedLostQuestions: number;
  readonly pricedCoverage: number | null;
  readonly observedLoss: number | null;
  readonly proxyLoss: number | null;
  readonly nodeAttributedLoss: Readonly<Record<string, number>>;
  readonly coverageGap: { readonly unpricedLostQuestions: number; readonly unpricedNodeIds: readonly (string | null)[] };
}

export interface ScoreLossProjection {
  readonly kind: 'DERIVED';
  readonly entries: readonly ScoreLossEntryProjection[];
  readonly totals: {
    readonly observedLoss: number | null;
    readonly proxyLoss: number | null;
    /** Kept separate from observedLoss by construction — never one blended number. */
    readonly unpricedLostQuestions: number;
  };
}

function projectEntry(entry: ScoreLossEntryInput): ScoreLossEntryProjection {
  const items = entry.items;
  const pricedLost = items.filter((item) => item.maxScore != null);
  const unpriced = items.filter((item) => item.maxScore == null);
  const observed = items.filter((item) => item.lossKind === 'OBSERVED' && item.lostScore != null);
  const proxy = items.filter((item) => item.lossKind === 'PROXY' && item.lostScore != null);
  const nodeAttributedLoss: Record<string, number> = {};
  for (const item of items) {
    if (item.nodeId == null || item.lostScore == null) continue;
    nodeAttributedLoss[item.nodeId] = round3((nodeAttributedLoss[item.nodeId] ?? 0) + item.lostScore);
  }

  return {
    scoreEntryKind: entry.scoreEntryKind,
    scoreEntryId: entry.scoreEntryId,
    semantic: entry.semantic,
    rawScore: entry.rawScore,
    rawTotalScale: entry.rawTotalScale,
    title: entry.title,
    recordedAt: entry.recordedAt,
    kind: 'DERIVED',
    items,
    lostQuestions: items.length,
    pricedLostQuestions: pricedLost.length,
    unpricedLostQuestions: unpriced.length,
    pricedCoverage: items.length === 0 ? null : round3(pricedLost.length / items.length),
    observedLoss: observed.length ? round3(observed.reduce((sum, item) => sum + (item.lostScore ?? 0), 0)) : null,
    proxyLoss: proxy.length ? round3(proxy.reduce((sum, item) => sum + (item.lostScore ?? 0), 0)) : null,
    nodeAttributedLoss,
    coverageGap: {
      unpricedLostQuestions: unpriced.length,
      unpricedNodeIds: unpriced.map((item) => item.nodeId),
    },
  };
}

/** Assemble the read-only projection from stored loss rows, grouped per entry. */
export function buildScoreLossProjection(input: { entries: readonly ScoreLossEntryInput[] }): ScoreLossProjection {
  const entries = input.entries.map(projectEntry);
  const observedLosses = entries.map((entry) => entry.observedLoss).filter((value): value is number => value != null);
  const proxyLosses = entries.map((entry) => entry.proxyLoss).filter((value): value is number => value != null);
  return {
    kind: 'DERIVED',
    entries,
    totals: {
      observedLoss: observedLosses.length ? round3(observedLosses.reduce((sum, value) => sum + value, 0)) : null,
      proxyLoss: proxyLosses.length ? round3(proxyLosses.reduce((sum, value) => sum + value, 0)) : null,
      unpricedLostQuestions: entries.reduce((sum, entry) => sum + entry.unpricedLostQuestions, 0),
    },
  };
}
