/**
 * PHASE 9 — Score Recovery projection (pure).
 *
 * "失分有没有被追回来": for every question carrying loss evidence, ask whether
 * the student RE-ATTEMPTED it after the loss and what the latest outcome was.
 *
 * Recovery is claimed ONLY from a real correct re-attempt on the SAME question
 * after the loss baseline. Never from mastery, never from prediction, never by
 * inference. The amount fields are named for what they ARE — observed loss
 * with re-attempt evidence — because RULE-11 forbids calling anything here a
 * verified score gain.
 *
 * Honesty rules (pinned by tests):
 *   • OBSERVED / PROXY amounts live in separate fields and are never merged.
 *   • Unpriced loss (lostScore null) is counted, never priced by inference.
 *   • status ∈ { recovered, not_recovered, awaiting_reattempt } — latest
 *     outcome decides; a later wrong re-attempt is a relapse, not recovery.
 *   • Window applies to BOTH sides: loss facts and re-attempts; re-attempts at
 *     or before the loss baseline do not count.
 *   • Deterministic ordering: outstanding observed loss desc, then nodeId /
 *     questionId asc; priorityRank is 1..N.
 */

import type { ScoreLossKind } from './score-loss';

export interface ScoreRecoveryLossFact {
  questionId: string;
  nodeId: string | null;
  /** null = unpriced / unknown, NEVER 0 (INV-10). */
  lostScore: number | null;
  lossKind: ScoreLossKind;
  recordedAt: string;
}

export type RecoveryReattemptSource = 'practice' | 'review';

export interface ScoreRecoveryReattemptFact {
  questionId: string;
  correct: boolean;
  occurredAt: string;
  source: RecoveryReattemptSource;
}

export type ScoreRecoveryStatus = 'recovered' | 'not_recovered' | 'awaiting_reattempt';

export interface ScoreRecoveryRow {
  questionId: string;
  nodeId: string | null;
  status: ScoreRecoveryStatus;
  /** Whether any loss row for this question carried a real price. */
  priced: boolean;
  observedLostScore: number;
  proxyLostScore: number;
  /** OBSERVED loss on questions whose latest re-attempt was correct. */
  observedLossWithReattemptSuccess: number;
  proxyLossWithReattemptSuccess: number;
  /** OBSERVED loss still lacking recovery evidence (awaiting or failed re-attempt). */
  observedLossOutstanding: number;
  reattemptCount: number;
  reattemptSources: RecoveryReattemptSource[];
  latestReattemptCorrect: boolean | null;
  lastLossAt: string;
  latestReattemptAt: string | null;
  priorityRank: number;
}

export interface ScoreRecoveryNodeRow {
  nodeId: string | null;
  questions: number;
  recoveredQuestions: number;
  observedLostScore: number;
  observedLossWithReattemptSuccess: number;
  observedLossOutstanding: number;
  proxyLostScore: number;
}

export interface ScoreRecoveryResult {
  window: { days: number; from: string; to: string };
  dataStatus: 'OK' | 'EMPTY';
  summary: {
    questions: number;
    recoveredQuestions: number;
    notRecoveredQuestions: number;
    awaitingQuestions: number;
    unpricedQuestions: number;
    observedLostScore: number;
    observedLossWithReattemptSuccess: number;
    observedLossOutstanding: number;
    proxyLostScore: number;
    proxyLossWithReattemptSuccess: number;
  };
  rows: ScoreRecoveryRow[];
  nodes: ScoreRecoveryNodeRow[];
}

export interface BuildScoreRecoveryInput {
  now: string;
  windowDays: number;
  lossFacts: readonly ScoreRecoveryLossFact[];
  reattempts: readonly ScoreRecoveryReattemptFact[];
}

interface MutableRecovery {
  questionId: string;
  nodeId: string | null;
  priced: boolean;
  observedLostScore: number;
  proxyLostScore: number;
  lastLossAt: string;
  firstLossMs: number;
}

export function buildScoreRecovery(input: BuildScoreRecoveryInput): ScoreRecoveryResult {
  const toMs = new Date(input.now).getTime();
  const fromMs = toMs - input.windowDays * 86_400_000;

  const byQuestion = new Map<string, MutableRecovery>();
  for (const fact of input.lossFacts) {
    const at = new Date(fact.recordedAt).getTime();
    if (at < fromMs || at > toMs) continue;
    const entry = byQuestion.get(fact.questionId) ?? {
      questionId: fact.questionId,
      nodeId: fact.nodeId,
      priced: false,
      observedLostScore: 0,
      proxyLostScore: 0,
      lastLossAt: fact.recordedAt,
      firstLossMs: at,
    };
    if (fact.nodeId != null && entry.nodeId == null) entry.nodeId = fact.nodeId;
    if (fact.lostScore != null) {
      entry.priced = true;
      if (fact.lossKind === 'OBSERVED') entry.observedLostScore += fact.lostScore;
      else entry.proxyLostScore += fact.lostScore;
    }
    if (at < entry.firstLossMs) entry.firstLossMs = at;
    if (fact.recordedAt > entry.lastLossAt) entry.lastLossAt = fact.recordedAt;
    byQuestion.set(fact.questionId, entry);
  }

  // Re-attempts are grouped per question and filtered: inside the window AND
  // strictly after that question's loss baseline.
  const retriesByQuestion = new Map<string, ScoreRecoveryReattemptFact[]>();
  for (const fact of input.reattempts) {
    const at = new Date(fact.occurredAt).getTime();
    if (at < fromMs || at > toMs) continue;
    const bucket = retriesByQuestion.get(fact.questionId) ?? [];
    bucket.push(fact);
    retriesByQuestion.set(fact.questionId, bucket);
  }

  const rows: ScoreRecoveryRow[] = [];
  for (const entry of byQuestion.values()) {
    const retries = (retriesByQuestion.get(entry.questionId) ?? [])
      .filter((fact) => new Date(fact.occurredAt).getTime() > entry.firstLossMs)
      .sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
    const latest = retries.at(-1) ?? null;
    const status: ScoreRecoveryStatus = !latest
      ? 'awaiting_reattempt'
      : latest.correct ? 'recovered' : 'not_recovered';
    const recovered = status === 'recovered';
    rows.push({
      questionId: entry.questionId,
      nodeId: entry.nodeId,
      status,
      priced: entry.priced,
      observedLostScore: entry.observedLostScore,
      proxyLostScore: entry.proxyLostScore,
      observedLossWithReattemptSuccess: recovered ? entry.observedLostScore : 0,
      proxyLossWithReattemptSuccess: recovered ? entry.proxyLostScore : 0,
      observedLossOutstanding: recovered ? 0 : entry.observedLostScore,
      reattemptCount: retries.length,
      reattemptSources: [...new Set(retries.map((fact) => fact.source))].sort(),
      latestReattemptCorrect: latest ? latest.correct : null,
      lastLossAt: entry.lastLossAt,
      latestReattemptAt: latest ? latest.occurredAt : null,
      priorityRank: 0,
    });
  }

  rows.sort((left, right) =>
    right.observedLossOutstanding - left.observedLossOutstanding
    || (left.nodeId ?? '').localeCompare(right.nodeId ?? '')
    || left.questionId.localeCompare(right.questionId));
  rows.forEach((row, index) => { row.priorityRank = index + 1; });

  const nodeAgg = new Map<string, ScoreRecoveryNodeRow>();
  for (const row of rows) {
    const key = row.nodeId ?? '';
    const agg = nodeAgg.get(key) ?? {
      nodeId: row.nodeId,
      questions: 0,
      recoveredQuestions: 0,
      observedLostScore: 0,
      observedLossWithReattemptSuccess: 0,
      observedLossOutstanding: 0,
      proxyLostScore: 0,
    };
    agg.questions += 1;
    agg.recoveredQuestions += row.status === 'recovered' ? 1 : 0;
    agg.observedLostScore += row.observedLostScore;
    agg.observedLossWithReattemptSuccess += row.observedLossWithReattemptSuccess;
    agg.observedLossOutstanding += row.observedLossOutstanding;
    agg.proxyLostScore += row.proxyLostScore;
    nodeAgg.set(key, agg);
  }
  const nodes = [...nodeAgg.values()].sort((left, right) =>
    right.observedLossOutstanding - left.observedLossOutstanding
    || (left.nodeId ?? '').localeCompare(right.nodeId ?? ''));

  return {
    window: {
      days: input.windowDays,
      from: new Date(fromMs).toISOString(),
      to: new Date(toMs).toISOString(),
    },
    dataStatus: rows.length > 0 ? 'OK' : 'EMPTY',
    summary: {
      questions: rows.length,
      recoveredQuestions: rows.filter((row) => row.status === 'recovered').length,
      notRecoveredQuestions: rows.filter((row) => row.status === 'not_recovered').length,
      awaitingQuestions: rows.filter((row) => row.status === 'awaiting_reattempt').length,
      unpricedQuestions: rows.filter((row) => !row.priced).length,
      observedLostScore: rows.reduce((sum, row) => sum + row.observedLostScore, 0),
      observedLossWithReattemptSuccess: rows.reduce((sum, row) => sum + row.observedLossWithReattemptSuccess, 0),
      observedLossOutstanding: rows.reduce((sum, row) => sum + row.observedLossOutstanding, 0),
      proxyLostScore: rows.reduce((sum, row) => sum + row.proxyLostScore, 0),
      proxyLossWithReattemptSuccess: rows.reduce((sum, row) => sum + row.proxyLossWithReattemptSuccess, 0),
    },
    rows,
    nodes,
  };
}
