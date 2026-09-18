/**
 * V13-A1 — Error Pattern read projection (pure functions).
 *
 * Aggregates WRONG-attempt facts into (subject, knowledgeNode, errorReason)
 * rows with count / recentCount / trend. This is a PROJECTION, not a source of
 * truth: authoritative error facts remain PracticeRecord.mistakeReason (auto)
 * and ReviewAttempt.reportedReason (self-reported). The function accepts only
 * attempt facts — there is no mastery/score input by construction, so error
 * counts can never be derived from ability estimates (task §9/§12).
 *
 * Honesty rules pinned by tests:
 *   • OBSERVED count == eligible evidence count (totals.wrongCount).
 *   • Uncontrolled/null reasons surface as `unclassified`, never folded into
 *     concept_confusion or any real type.
 *   • trend compares the two halves of the window and stays `no_data` when the
 *     older half is empty — no trend is manufactured from a zero baseline.
 *   • Node-less attempts count in totals but form no pattern row (the
 *     attribution gap stays visible as totals.nodeUnattributedCount).
 */

import {
  ERROR_REASON_LABELS,
  UNCLASSIFIED_ERROR_REASON_CODE,
  normalizeErrorReason,
  type ErrorReasonCode,
} from './error-reason';

const DAY_MS = 86_400_000;

export type ErrorPatternSource = 'auto' | 'self_reported';

export interface ErrorPatternAttemptFact {
  /** auto = server classifyMistake label on a practice record; self_reported = review attempt reported reason. */
  source: ErrorPatternSource;
  subject: string | null;
  nodeId: string | null;
  questionId: string;
  questionType?: string | null;
  /** Raw stored reason (English code, Chinese label, legacy label, free text or null). */
  reasonRaw: string | null;
  occurredAt: string;
}

export interface ErrorPatternRow {
  subject: string | null;
  nodeId: string;
  reasonCode: ErrorReasonCode;
  reasonLabel: string;
  count: number;
  /** Attempts in the RECENT half of the window. */
  recentCount: number;
  trend: 'up' | 'down' | 'flat' | 'no_data';
  repeated: boolean;
  lastOccurredAt: string;
  questionTypes: string[];
  sources: ErrorPatternSource[];
}

export interface ErrorPatternsResult {
  window: { days: number; from: string; to: string };
  totals: {
    /** OBSERVED count — equals the number of eligible wrong-evidence facts. */
    wrongCount: number;
    attributedCount: number;
    nodeUnattributedCount: number;
    unclassifiedCount: number;
  };
  /** Explicit mirror of totals.wrongCount for the evidence-count invariant. */
  attemptsCounted: number;
  patterns: ErrorPatternRow[];
  byReason: Array<{ code: ErrorReasonCode; label: string; count: number; sources: ErrorPatternSource[] }>;
}

export interface BuildErrorPatternsInput {
  now: string;
  windowDays: number;
  attempts: ErrorPatternAttemptFact[];
}

interface MutableRow {
  subject: string | null;
  nodeId: string;
  reasonCode: ErrorReasonCode;
  count: number;
  recentCount: number;
  lastOccurredAt: string;
  questionTypes: Set<string>;
  sources: Set<ErrorPatternSource>;
}

export function buildErrorPatterns(input: BuildErrorPatternsInput): ErrorPatternsResult {
  const to = new Date(input.now);
  const toMs = to.getTime();
  const fromMs = toMs - input.windowDays * DAY_MS;
  const midpointMs = fromMs + (input.windowDays * DAY_MS) / 2;

  const eligible = input.attempts.filter((attempt) => {
    const at = new Date(attempt.occurredAt).getTime();
    return at >= fromMs && at <= toMs;
  });

  const totals = {
    wrongCount: eligible.length,
    attributedCount: 0,
    nodeUnattributedCount: 0,
    unclassifiedCount: 0,
  };

  const rowsByKey = new Map<string, MutableRow>();
  const reasonCounts = new Map<ErrorReasonCode, { count: number; sources: Set<ErrorPatternSource> }>();

  for (const attempt of eligible) {
    const reasonCode = normalizeErrorReason(attempt.reasonRaw) ?? UNCLASSIFIED_ERROR_REASON_CODE;
    if (reasonCode === UNCLASSIFIED_ERROR_REASON_CODE) totals.unclassifiedCount += 1;
    if (attempt.nodeId == null) {
      totals.nodeUnattributedCount += 1;
    } else {
      totals.attributedCount += 1;
    }

    const reasonAgg = reasonCounts.get(reasonCode) ?? { count: 0, sources: new Set<ErrorPatternSource>() };
    reasonAgg.count += 1;
    reasonAgg.sources.add(attempt.source);
    reasonCounts.set(reasonCode, reasonAgg);

    if (attempt.nodeId == null) continue;
    const key = `${attempt.nodeId}\u0000${reasonCode}`;
    const row = rowsByKey.get(key) ?? {
      subject: attempt.subject,
      nodeId: attempt.nodeId,
      reasonCode,
      count: 0,
      recentCount: 0,
      lastOccurredAt: attempt.occurredAt,
      questionTypes: new Set<string>(),
      sources: new Set<ErrorPatternSource>(),
    };
    row.count += 1;
    if (new Date(attempt.occurredAt).getTime() >= midpointMs) row.recentCount += 1;
    if (attempt.occurredAt > row.lastOccurredAt) row.lastOccurredAt = attempt.occurredAt;
    if (attempt.subject != null && row.subject == null) row.subject = attempt.subject;
    if (attempt.questionType) row.questionTypes.add(attempt.questionType);
    row.sources.add(attempt.source);
    rowsByKey.set(key, row);
  }

  const patterns: ErrorPatternRow[] = [...rowsByKey.values()].map((row) => {
    const olderCount = row.count - row.recentCount;
    const trend: ErrorPatternRow['trend'] =
      olderCount === 0 ? 'no_data'
        : row.recentCount > olderCount ? 'up'
          : row.recentCount < olderCount ? 'down'
            : 'flat';
    return {
      subject: row.subject,
      nodeId: row.nodeId,
      reasonCode: row.reasonCode,
      reasonLabel: ERROR_REASON_LABELS[row.reasonCode],
      count: row.count,
      recentCount: row.recentCount,
      trend,
      repeated: row.count >= 2,
      lastOccurredAt: row.lastOccurredAt,
      questionTypes: [...row.questionTypes].sort(),
      sources: [...row.sources].sort(),
    };
  }).sort((left, right) =>
    right.count - left.count
    || left.nodeId.localeCompare(right.nodeId)
    || left.reasonCode.localeCompare(right.reasonCode));

  const byReason = [...reasonCounts.entries()]
    .map(([code, agg]) => ({ code, label: ERROR_REASON_LABELS[code], count: agg.count, sources: [...agg.sources].sort() }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code));

  return {
    window: {
      days: input.windowDays,
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
    },
    totals,
    attemptsCounted: eligible.length,
    patterns,
    byReason,
  };
}
