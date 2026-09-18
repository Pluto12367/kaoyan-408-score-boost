/**
 * PHASE 11 — Mock-exam score-loss trend (pure).
 *
 * The report already knows the accuracy history; this adds the LOSING
 * dimension per exam session, straight from the ScoreLoss ledger:
 *
 *   per exam:   observed / proxy lost points (separate), priced vs unpriced
 *               question counts, node attribution
 *   across:     adjacent delta in observed loss (only when BOTH exams carry
 *               observed evidence, otherwise null + explicit reason)
 *
 * Honesty rules (pinned by tests):
 *   • OBSERVED and PROXY stay in separate fields and are never merged.
 *   • Unpriced losses are COUNTED per exam and add no points (NULL ≠ 0).
 *   • An exam with no loss evidence keeps null loss fields — unknown ≠ 0.
 *   • Deltas never compare across a gap: both sides need observed evidence.
 *   • Loss rows whose session is not in the exam list are ignored.
 *   • Deterministic ordering (date, sessionId) and stable ranks; read-only.
 */

import type { ScoreLossKind } from './score-loss';

export interface MockLossExamFact {
  sessionId: string;
  date: string;
  totalQuestions: number;
  correctCount: number;
  accuracyRate: number;
  totalTimeMin: number;
}

export interface MockLossLedgerFact {
  sessionId: string;
  questionId: string;
  nodeId: string | null;
  /** null = unpriced / unknown, NEVER 0. */
  lostScore: number | null;
  lossKind: ScoreLossKind;
}

export interface MockLossNodeRow {
  nodeId: string;
  observedLostScore: number;
  proxyLostScore: number;
  questions: number;
}

export interface MockLossTrendRow {
  sessionId: string;
  date: string;
  totalQuestions: number;
  correctCount: number;
  accuracyRate: number;
  totalTimeMin: number;
  /** null = no loss evidence recorded for this exam (unknown, never 0). */
  observedLostScore: number | null;
  proxyLostScore: number | null;
  pricedLossQuestions: number;
  unpricedLossQuestions: number;
  unattributedObservedLoss: number;
  nodes: MockLossNodeRow[];
  /** Change vs the previous exam; null when either side lacks observed evidence. */
  observedLossDelta: number | null;
  observedLossDeltaLabel: string | null;
  deltaReason: string | null;
  priorityRank: number;
}

export interface MockLossTrendResult {
  dataStatus: 'OK' | 'EMPTY';
  summary: {
    exams: number;
    examsWithLoss: number;
    totalObservedLostScore: number;
    totalProxyLostScore: number;
    latestObservedLostScore: number | null;
    latestDelta: number | null;
  };
  rows: MockLossTrendRow[];
}

export interface BuildMockLossTrendInput {
  exams: readonly MockLossExamFact[];
  losses: readonly MockLossLedgerFact[];
}

export function buildMockLossTrend(input: BuildMockLossTrendInput): MockLossTrendResult {
  const exams = [...input.exams].sort((left, right) =>
    left.date.localeCompare(right.date) || left.sessionId.localeCompare(right.sessionId));
  const sessionIds = new Set(exams.map((exam) => exam.sessionId));

  const perSession = new Map<string, {
    observed: number;
    proxy: number;
    priced: Set<string>;
    unpriced: Set<string>;
    unattributed: number;
    nodeObserved: Map<string, number>;
    nodeProxy: Map<string, number>;
    nodeQuestions: Map<string, Set<string>>;
  }>();
  for (const fact of input.losses) {
    if (!sessionIds.has(fact.sessionId)) continue; // ghost sessions ignored
    const bucket = perSession.get(fact.sessionId) ?? {
      observed: 0, proxy: 0,
      priced: new Set<string>(), unpriced: new Set<string>(),
      unattributed: 0,
      nodeObserved: new Map<string, number>(),
      nodeProxy: new Map<string, number>(),
      nodeQuestions: new Map<string, Set<string>>(),
    };
    if (fact.lostScore != null) {
      if (fact.lossKind === 'OBSERVED') bucket.observed += fact.lostScore;
      else bucket.proxy += fact.lostScore;
      if (fact.lossKind === 'OBSERVED') {
        if (fact.nodeId == null) bucket.unattributed += fact.lostScore;
        else bucket.nodeObserved.set(fact.nodeId, (bucket.nodeObserved.get(fact.nodeId) ?? 0) + fact.lostScore);
      } else if (fact.nodeId != null) {
        bucket.nodeProxy.set(fact.nodeId, (bucket.nodeProxy.get(fact.nodeId) ?? 0) + fact.lostScore);
      }
      bucket.priced.add(fact.questionId);
    } else {
      bucket.unpriced.add(fact.questionId);
    }
    if (fact.nodeId != null) {
      const questions = bucket.nodeQuestions.get(fact.nodeId) ?? new Set<string>();
      questions.add(fact.questionId);
      bucket.nodeQuestions.set(fact.nodeId, questions);
    }
    perSession.set(fact.sessionId, bucket);
  }

  const rows: MockLossTrendRow[] = exams.map((exam) => {
    const bucket = perSession.get(exam.sessionId);
    const hasEvidence = Boolean(bucket && (bucket.priced.size > 0 || bucket.unpriced.size > 0));
    const nodeIds = new Set<string>([
      ...(bucket?.nodeObserved.keys() ?? []),
      ...(bucket?.nodeProxy.keys() ?? []),
      ...(bucket?.nodeQuestions.keys() ?? []),
    ]);
    return {
      sessionId: exam.sessionId,
      date: exam.date,
      totalQuestions: exam.totalQuestions,
      correctCount: exam.correctCount,
      accuracyRate: exam.accuracyRate,
      totalTimeMin: exam.totalTimeMin,
      observedLostScore: hasEvidence ? bucket!.observed : null,
      proxyLostScore: hasEvidence ? bucket!.proxy : null,
      pricedLossQuestions: bucket?.priced.size ?? 0,
      unpricedLossQuestions: bucket?.unpriced.size ?? 0,
      unattributedObservedLoss: bucket?.unattributed ?? 0,
      nodes: [...nodeIds].map((nodeId) => ({
        nodeId,
        observedLostScore: bucket?.nodeObserved.get(nodeId) ?? 0,
        proxyLostScore: bucket?.nodeProxy.get(nodeId) ?? 0,
        questions: bucket?.nodeQuestions.get(nodeId)?.size ?? 0,
      })).sort((left, right) =>
        right.observedLostScore - left.observedLostScore || left.nodeId.localeCompare(right.nodeId)),
      observedLossDelta: null,
      observedLossDeltaLabel: null,
      deltaReason: null,
      priorityRank: 0,
    };
  });

  rows.forEach((row, index) => {
    row.priorityRank = index + 1;
    if (index === 0) {
      row.deltaReason = '这是第一次模考记录，还没有可比的上一次。';
      return;
    }
    const previous = rows[index - 1];
    // Same-day exams have no determinable order (history is day-granular), so
    // comparing them would invent a direction. Refuse the delta explicitly.
    if (row.date === previous.date) {
      row.deltaReason = '与上一次模考在同一天，无法确定先后，不做趋势判断。';
      return;
    }
    if (row.observedLostScore == null || previous.observedLostScore == null) {
      row.deltaReason = '两次中至少有一次没有可用的观察失分证据，不做趋势判断。';
      return;
    }
    row.observedLossDelta = row.observedLostScore - previous.observedLostScore;
    row.observedLossDeltaLabel = row.observedLossDelta < 0
      ? `较上次少丢 ${Math.abs(row.observedLossDelta)} 分`
      : row.observedLossDelta > 0
        ? `较上次多丢 ${row.observedLossDelta} 分`
        : '与上次持平';
  });

  const withLoss = rows.filter((row) => row.observedLostScore != null);
  const latestWithLoss = [...withLoss].at(-1) ?? null;
  return {
    dataStatus: rows.length > 0 && withLoss.length > 0 ? 'OK' : 'EMPTY',
    summary: {
      exams: rows.length,
      examsWithLoss: withLoss.length,
      totalObservedLostScore: withLoss.reduce((sum, row) => sum + (row.observedLostScore ?? 0), 0),
      totalProxyLostScore: withLoss.reduce((sum, row) => sum + (row.proxyLostScore ?? 0), 0),
      latestObservedLostScore: latestWithLoss?.observedLostScore ?? null,
      latestDelta: latestWithLoss?.observedLossDelta ?? null,
    },
    rows,
  };
}
