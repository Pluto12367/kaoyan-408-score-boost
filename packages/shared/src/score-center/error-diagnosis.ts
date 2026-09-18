/**
 * V13-A2 — ErrorPattern → Diagnosis (pure composition).
 *
 * A2 turns the A1 question "why wrong" into "what to diagnose first": the
 * wrong-attempt facts are bucketed with the SAME single rule as the error
 * pattern projection (`bucketizeAttempt`), then joined with per-question loss
 * aggregates from the ScoreLoss ledger.
 *
 * Evidence contract (non-negotiable):
 *   • OBSERVED and PROXY loss are aggregated as SEPARATE fields, never merged.
 *   • Unpriced questions count (`unpricedCount`) but contribute NO loss value —
 *     NULL ≠ 0.
 *   • Loss facts only attach to questions that actually appear in the window's
 *     wrong evidence; ledger rows for untouched questions are ignored.
 *   • Ordering is deterministic: observedLostScore desc (zero/absent last),
 *     then count desc, then stable bucket key asc. `priorityRank` is 1..N.
 *   • The input contains attempt facts + ledger loss facts ONLY — there is no
 *     mastery/prediction input, so a diagnosis can never be derived from
 *     ability estimates.
 */

import { ERROR_REASON_LABELS, type ErrorReasonCode } from './error-reason';
import { questionSubtypeLabel, type QuestionSubtypeCode } from './question-subtype';
import { bucketizeAttempt, type ErrorPatternAttemptFact, type ErrorPatternSource } from './error-patterns';

const DAY_MS = 86_400_000;

export interface DiagnosisLossFact {
  /** Σ OBSERVED lostScore for this question across ledger rows (null losses contribute 0). */
  observed: number;
  /** Σ PROXY lostScore (self-scored attempts). Reported separately, never merged. */
  proxy: number;
  /** Whether any ledger row for this question carried a real price (maxScore non-null). */
  priced: boolean;
}

export interface BuildErrorDiagnosisInput {
  now: string;
  windowDays: number;
  attempts: ErrorPatternAttemptFact[];
  /** questionId → loss aggregate from the ScoreLoss ledger. */
  lossByQuestion: Record<string, DiagnosisLossFact>;
}

export interface ErrorDiagnosisRow {
  subject: string | null;
  nodeId: string;
  reasonCode: ErrorReasonCode;
  reasonLabel: string;
  questionSubtype: QuestionSubtypeCode | 'unknown';
  questionSubtypeLabel: string;
  count: number;
  recentCount: number;
  trend: 'up' | 'down' | 'flat' | 'no_data';
  repeated: boolean;
  lastOccurredAt: string;
  observedLostScore: number;
  proxyLostScore: number;
  pricedCount: number;
  unpricedCount: number;
  sources: ErrorPatternSource[];
  priorityRank: number;
}

export interface ErrorDiagnosisResult {
  window: { days: number; from: string; to: string };
  summary: {
    wrongCount: number;
    observedLostScore: number;
    proxyLostScore: number;
    pricedQuestions: number;
    unpricedQuestions: number;
  };
  rows: ErrorDiagnosisRow[];
}

interface MutableDiagnosisRow {
  subject: string | null;
  nodeId: string;
  reasonCode: ErrorReasonCode;
  questionSubtype: QuestionSubtypeCode | 'unknown';
  count: number;
  recentCount: number;
  lastOccurredAt: string;
  observedLostScore: number;
  proxyLostScore: number;
  pricedQuestions: Set<string>;
  unpricedQuestions: Set<string>;
  sources: Set<ErrorPatternSource>;
}

export function buildErrorDiagnosis(input: BuildErrorDiagnosisInput): ErrorDiagnosisResult {
  const toMs = new Date(input.now).getTime();
  const fromMs = toMs - input.windowDays * DAY_MS;
  const midpointMs = fromMs + (input.windowDays * DAY_MS) / 2;

  const rowsByKey = new Map<string, MutableDiagnosisRow>();
  let wrongCount = 0;
  let observedLostScore = 0;
  let proxyLostScore = 0;
  const pricedQuestions = new Set<string>();
  const unpricedQuestions = new Set<string>();
  // Loss facts are per-QUESTION ledger aggregates: a question with several
  // wrong attempts in the window contributes its loss exactly once.
  const lossCountedQuestions = new Set<string>();

  for (const attempt of input.attempts) {
    const occurredMs = new Date(attempt.occurredAt).getTime();
    if (occurredMs < fromMs || occurredMs > toMs) continue;
    wrongCount += 1;

    const bucket = bucketizeAttempt(attempt);
    if (!bucket) continue; // node-less: no diagnosis row (caller-level attribution gap)

    const loss = input.lossByQuestion[attempt.questionId];
    const observed = loss?.observed ?? 0;
    const proxy = loss?.proxy ?? 0;
    if (loss && !lossCountedQuestions.has(attempt.questionId)) {
      lossCountedQuestions.add(attempt.questionId);
      observedLostScore += observed;
      proxyLostScore += proxy;
    }
    if (loss?.priced) pricedQuestions.add(attempt.questionId);
    else unpricedQuestions.add(attempt.questionId);

    const key = `${bucket.nodeId}\u0000${bucket.reasonCode}\u0000${bucket.subtypeBucket}`;
    const row = rowsByKey.get(key) ?? {
      subject: attempt.subject,
      nodeId: bucket.nodeId,
      reasonCode: bucket.reasonCode,
      questionSubtype: bucket.subtypeBucket,
      count: 0,
      recentCount: 0,
      lastOccurredAt: attempt.occurredAt,
      observedLostScore: 0,
      proxyLostScore: 0,
      pricedQuestions: new Set<string>(),
      unpricedQuestions: new Set<string>(),
      sources: new Set<ErrorPatternSource>(),
    };
    row.count += 1;
    if (occurredMs >= midpointMs) row.recentCount += 1;
    if (attempt.occurredAt > row.lastOccurredAt) row.lastOccurredAt = attempt.occurredAt;
    if (attempt.subject != null && row.subject == null) row.subject = attempt.subject;
    if (!row.pricedQuestions.has(attempt.questionId) && !row.unpricedQuestions.has(attempt.questionId)) {
      row.observedLostScore += observed;
      row.proxyLostScore += proxy;
    }
    if (loss?.priced) row.pricedQuestions.add(attempt.questionId);
    else row.unpricedQuestions.add(attempt.questionId);
    row.sources.add(attempt.source);
    rowsByKey.set(key, row);
  }

  const rows: ErrorDiagnosisRow[] = [...rowsByKey.values()].map((row) => {
    const olderCount = row.count - row.recentCount;
    const trend: ErrorDiagnosisRow['trend'] =
      olderCount === 0 ? 'no_data'
        : row.recentCount > olderCount ? 'up'
          : row.recentCount < olderCount ? 'down'
            : 'flat';
    return {
      subject: row.subject,
      nodeId: row.nodeId,
      reasonCode: row.reasonCode,
      reasonLabel: ERROR_REASON_LABELS[row.reasonCode],
      questionSubtype: row.questionSubtype,
      questionSubtypeLabel: row.questionSubtype === 'unknown' ? '未知题型' : questionSubtypeLabel(row.questionSubtype),
      count: row.count,
      recentCount: row.recentCount,
      trend,
      repeated: row.count >= 2,
      lastOccurredAt: row.lastOccurredAt,
      observedLostScore: row.observedLostScore,
      proxyLostScore: row.proxyLostScore,
      pricedCount: row.pricedQuestions.size,
      unpricedCount: row.unpricedQuestions.size,
      sources: [...row.sources].sort(),
      priorityRank: 0,
    };
  }).sort((left, right) =>
    right.observedLostScore - left.observedLostScore
    || right.count - left.count
    || left.nodeId.localeCompare(right.nodeId)
    || left.reasonCode.localeCompare(right.reasonCode)
    || left.questionSubtype.localeCompare(right.questionSubtype));

  rows.forEach((row, index) => { row.priorityRank = index + 1; });

  return {
    window: {
      days: input.windowDays,
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
    },
    summary: {
      wrongCount,
      observedLostScore,
      proxyLostScore,
      pricedQuestions: pricedQuestions.size,
      unpricedQuestions: unpricedQuestions.size,
    },
    rows,
  };
}
