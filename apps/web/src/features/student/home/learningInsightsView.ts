/**
 * PHASE 10 (frontend consumption) — pure view helpers for the learning-insights
 * card.
 *
 * The card consumes FOUR read-only projections that already exist server-side:
 * error-diagnosis, training-prescription, forgetting-risk, score-recovery.
 * Everything here is presentation-only: no thresholds are re-derived, no
 * numbers are computed that the API did not state, and nothing is invented
 * when a projection reports emptiness or unavailability.
 */

export type DiagnosisConfidence = 'high' | 'medium' | 'low';
export type PrescriptionStage = 'basic' | 'same_type' | 'variant' | 'review' | 'retest';
export type PrescriptionStepStatus = 'READY' | 'UNAVAILABLE' | 'NO_CONTENT';
export type ForgettingRiskLevel = 'overdue' | 'at_risk' | 'due_soon' | 'healthy';
export type RecoveryStatus = 'recovered' | 'not_recovered' | 'awaiting_reattempt';

export interface DiagnosisView {
  storeAvailable: boolean;
  reason?: string;
  dataStatus: 'OK' | 'EMPTY';
  findings: Array<{
    nodeId: string;
    reasonLabel: string;
    questionSubtypeLabel: string;
    count: number;
    repeated: boolean;
    observedLostScore: number;
    confidence: DiagnosisConfidence;
    finding: string;
  }>;
}

export interface PrescriptionStepView {
  order: number;
  stage: PrescriptionStage;
  label: string;
  status: PrescriptionStepStatus;
  questionCount: number;
  difficulty: string | null;
  minutes: number | null;
  dueInDays: number | null;
  limitedByContent: boolean;
  reason: string | null;
}

export interface PrescriptionView {
  storeAvailable: boolean;
  reasonUnavailable?: string;
  dataStatus: 'OK' | 'LIMITED_CONTENT' | 'NO_CONTENT' | 'EMPTY';
  target: { nodeId: string; questionSubtypeLabel: string; reasonLabel: string } | null;
  reason: string;
  difficultyAnchor: 'BASIC' | 'MEDIUM' | null;
  reviewEmphasis: boolean;
  ladder: PrescriptionStepView[];
}

export interface ForgettingRiskView {
  storeAvailable: boolean;
  dataStatus: 'OK' | 'EMPTY';
  rows: Array<{
    nodeId: string;
    nodeName: string | null;
    risk: ForgettingRiskLevel;
    retention: number | null;
    daysUntilDue: number | null;
    finding: string;
  }>;
}

export interface ScoreRecoveryView {
  storeAvailable: boolean;
  dataStatus: 'OK' | 'EMPTY';
  summary: {
    questions: number;
    recoveredQuestions: number;
    notRecoveredQuestions: number;
    awaitingQuestions: number;
    observedLostScore: number;
    observedLossWithReattemptSuccess: number;
    observedLossOutstanding: number;
  };
  rows: Array<{
    questionId: string;
    nodeId: string | null;
    status: RecoveryStatus;
    observedLostScore: number;
    observedLostScoreOutstandingLabel?: never;
    observedLossOutstanding: number;
    reattemptCount: number;
  }>;
}

const DIFFICULTY_LABELS: Record<string, string> = {
  BASIC: '基础',
  MEDIUM: '中等',
  HARD: '困难',
};

const CONFIDENCE_LABELS: Record<DiagnosisConfidence, string> = {
  high: '样本充足',
  medium: '样本一般',
  low: '样本较少',
};

/** Only the actionable warnings surface on the home page; healthy is noise. */
export function selectForgettingWarnings(rows: ForgettingRiskView['rows'], limit = 3): ForgettingRiskView['rows'] {
  return rows
    .filter((row) => row.risk === 'overdue' || row.risk === 'at_risk')
    .slice(0, Math.max(0, limit));
}

export function riskLabel(risk: ForgettingRiskLevel): string {
  switch (risk) {
    case 'overdue': return '复习已过期';
    case 'at_risk': return '可能遗忘';
    case 'due_soon': return '即将到期';
    default: return '保持中';
  }
}

export function confidenceLabel(value: DiagnosisConfidence): string {
  return CONFIDENCE_LABELS[value] ?? value;
}

export function difficultyLabel(value: string | null | undefined): string {
  if (!value) return '';
  return DIFFICULTY_LABELS[value] ?? value;
}

/** One readable line per ladder step; unavailable/no-content steps stay visible with their reason. */
export function formatLadderStep(step: PrescriptionStepView): string {
  if (step.status === 'UNAVAILABLE' || step.status === 'NO_CONTENT') {
    return step.reason ?? '暂不可用';
  }
  if (step.stage === 'review' || step.stage === 'retest') {
    return step.dueInDays != null ? `${step.dueInDays} 天后` : '待安排';
  }
  const parts: string[] = [];
  if (step.questionCount > 0) parts.push(`${step.questionCount} 题`);
  if (step.difficulty) parts.push(difficultyLabel(step.difficulty));
  if (step.minutes != null) parts.push(`约 ${step.minutes} 分钟`);
  if (step.limitedByContent) parts.push('题量受题库限制');
  return parts.join(' · ') || '待安排';
}

/** The recovery headline; null when there is nothing honest to say. */
export function summarizeRecovery(view: ScoreRecoveryView | null, isError: boolean): string | null {
  if (!view || isError) return null;
  if (!view.storeAvailable) return '失分恢复：存储不可用，暂不结算。';
  if (view.dataStatus !== 'OK' || view.summary.questions === 0) return null;
  const { recoveredQuestions, notRecoveredQuestions, awaitingQuestions, observedLossOutstanding } = view.summary;
  if (recoveredQuestions === 0 && notRecoveredQuestions === 0 && awaitingQuestions === 0) return null;
  return `失分恢复：已确认追回 ${recoveredQuestions} 题，仍错 ${notRecoveredQuestions} 题，待重做 ${awaitingQuestions} 题（未追回 ${observedLossOutstanding} 分）`;
}

/** Top outstanding recovery rows for the "还悬着" list. */
export function selectOutstandingRecoveries(rows: ScoreRecoveryView['rows'], limit = 3): ScoreRecoveryView['rows'] {
  return rows
    .filter((row) => row.status !== 'recovered' && row.observedLostScore > 0)
    .slice(0, Math.max(0, limit));
}

/** Student-facing label for a recovery status (shared by home card and drill-down). */
export function recoveryStatusLabel(status: RecoveryStatus): string {
  switch (status) {
    case 'recovered': return '已追回';
    case 'not_recovered': return '重做又错';
    case 'awaiting_reattempt': return '还没重做';
    default: return status;
  }
}

/**
 * Join a recovery row with the diagnostic finding for the SAME node, so the
 * drill-down can say why the question kept losing points. Null when the
 * question's node has no finding in the window — never a guessed reason.
 */
export function reasonForNode(
  findings: DiagnosisView['findings'],
  nodeId: string | null,
): DiagnosisView['findings'][number] | null {
  if (!nodeId) return null;
  return findings.find((finding) => finding.nodeId === nodeId) ?? null;
}

/**
 * Whether the card has anything at all to show. Honesty rule: an unavailable
 * store or an empty projection renders nothing (the student already has the
 * plan), but the caller can distinguish "nothing" from "failed to load".
 */
export function hasRenderableInsight(input: {
  prescription: PrescriptionView | null;
  forgetting: ForgettingRiskView | null;
  recovery: ScoreRecoveryView | null;
}): boolean {
  const { prescription, forgetting, recovery } = input;
  if (prescription && prescription.storeAvailable && prescription.target && prescription.ladder.length > 0) return true;
  if (forgetting && forgetting.storeAvailable && selectForgettingWarnings(forgetting.rows).length > 0) return true;
  if (recovery && recovery.storeAvailable && recovery.dataStatus === 'OK' && recovery.summary.questions > 0) return true;
  return false;
}
