/**
 * PHASE 7 — Forgetting Risk projection (pure).
 *
 * "会了但快忘了": covers LEARNED nodes (mastery ≥ the review threshold) and
 * classifies their decay risk using the ONE shared retention formula
 * (`estimateRetention`) — the same exponential decay the priority engine reads.
 * No second formula, no second state store.
 *
 * Honesty rules (pinned by tests):
 *   • unknown decay (no lastReviewedAt / no stabilityDays) is COUNTED as
 *     insufficient data, never claimed as at-risk — unknown ≠ risk.
 *   • weak/unlearned nodes are OUT of scope: forgetting defense is about
 *     keeping what was learned, not about initial acquisition (diagnosis owns
 *     that).
 *   • risk precedence is explicit: overdue > at_risk > due_soon > healthy.
 *   • deterministic ordering: precedence, then retention asc (unknown last),
 *     then nodeId asc; priorityRank is 1..N.
 *   • read-only by construction: facts in, classification out.
 */

import { deriveNodeMasteryStatus, estimateRetention } from './mastery';

export const FORGETTING_RETENTION_THRESHOLD = 0.5;
export const DUE_SOON_HOURS = 24;

const HOUR_MS = 3_600_000;

export type ForgettingRiskLevel = 'overdue' | 'at_risk' | 'due_soon' | 'healthy';
export type LearnedStage = 'review' | 'mastered';

export interface ForgettingFactInput {
  nodeId: string;
  subject: string | null;
  nodeName: string | null;
  mastery: number;
  attempts: number;
  stabilityDays: number | null;
  lastReviewedAt: string | null;
  nextReviewAt: string | null;
}

export interface ForgettingRiskRow {
  nodeId: string;
  subject: string | null;
  nodeName: string | null;
  mastery: number;
  learnedStage: LearnedStage;
  /** null = insufficient data (no review history) — never a fabricated number. */
  retention: number | null;
  stabilityDays: number | null;
  daysSinceReview: number | null;
  nextReviewAt: string | null;
  daysUntilDue: number | null;
  risk: ForgettingRiskLevel;
  /** Evidence-only statement for the student surface. */
  finding: string;
  priorityRank: number;
}

export interface ForgettingRiskResult {
  dataStatus: 'OK' | 'EMPTY';
  summary: {
    learnedNodes: number;
    atRiskCount: number;
    overdueCount: number;
    dueSoonCount: number;
    insufficientDataCount: number;
  };
  rows: ForgettingRiskRow[];
}

export interface BuildForgettingRiskInput {
  now: string;
  rows: ForgettingFactInput[];
}

const RISK_ORDER: Record<ForgettingRiskLevel, number> = {
  overdue: 0,
  at_risk: 1,
  due_soon: 2,
  healthy: 3,
};

export function buildForgettingRisk(input: BuildForgettingRiskInput): ForgettingRiskResult {
  const now = new Date(input.now);
  const nowMs = now.getTime();
  const out: ForgettingRiskRow[] = [];

  for (const fact of input.rows) {
    const stage = deriveNodeMasteryStatus({ mastery: fact.mastery, attempts: fact.attempts });
    if (stage !== 'review' && stage !== 'mastered') continue; // out of forgetting scope

    const lastReviewedAt = fact.lastReviewedAt ? new Date(fact.lastReviewedAt) : null;
    const stabilityDays = fact.stabilityDays;
    const retention = lastReviewedAt && stabilityDays != null
      ? estimateRetention(lastReviewedAt, stabilityDays, now)
      : null;
    const nextReviewAt = fact.nextReviewAt ? new Date(fact.nextReviewAt) : null;

    let risk: ForgettingRiskLevel = 'healthy';
    if (nextReviewAt && nextReviewAt.getTime() < nowMs) risk = 'overdue';
    else if (retention != null && retention < FORGETTING_RETENTION_THRESHOLD) risk = 'at_risk';
    else if (nextReviewAt && nextReviewAt.getTime() <= nowMs + DUE_SOON_HOURS * HOUR_MS) risk = 'due_soon';

    const daysSinceReview = lastReviewedAt ? Math.floor((nowMs - lastReviewedAt.getTime()) / 86_400_000) : null;
    const daysUntilDue = nextReviewAt ? Math.ceil((nextReviewAt.getTime() - nowMs) / 86_400_000) : null;

    const percent = retention == null ? null : Math.round(retention * 100);
    let finding: string;
    if (risk === 'overdue') finding = `复习已过期 ${daysUntilDue != null ? Math.abs(daysUntilDue) : 0} 天，保持率${percent != null ? `约 ${percent}%` : '未知'}。`;
    else if (risk === 'at_risk') finding = `已掌握但保持率降至约 ${percent}%（距上次复习 ${daysSinceReview} 天），可能遗忘。`;
    else if (risk === 'due_soon') finding = '复习即将到期（24 小时内），保持率尚可。';
    else if (retention == null) finding = '缺少复习记录，保持率未知（不等于风险）。';
    else finding = `保持率良好（约 ${percent}%），按计划维持。`;

    out.push({
      nodeId: fact.nodeId,
      subject: fact.subject,
      nodeName: fact.nodeName,
      mastery: fact.mastery,
      learnedStage: stage === 'mastered' ? 'mastered' : 'review',
      retention,
      stabilityDays,
      daysSinceReview,
      nextReviewAt: fact.nextReviewAt,
      daysUntilDue,
      risk,
      finding,
      priorityRank: 0,
    });
  }

  out.sort((left, right) =>
    RISK_ORDER[left.risk] - RISK_ORDER[right.risk]
    || (left.retention ?? Number.POSITIVE_INFINITY) - (right.retention ?? Number.POSITIVE_INFINITY)
    || left.nodeId.localeCompare(right.nodeId));
  out.forEach((row, index) => { row.priorityRank = index + 1; });

  return {
    dataStatus: out.length > 0 ? 'OK' : 'EMPTY',
    summary: {
      learnedNodes: out.length,
      atRiskCount: out.filter((row) => row.risk === 'overdue' || row.risk === 'at_risk').length,
      overdueCount: out.filter((row) => row.risk === 'overdue').length,
      dueSoonCount: out.filter((row) => row.risk === 'due_soon').length,
      insufficientDataCount: out.filter((row) => row.retention == null).length,
    },
    rows: out,
  };
}
