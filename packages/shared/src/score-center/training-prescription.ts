/**
 * V13 PHASE 5 — Training Prescription (pure).
 *
 * Turns ONE Diagnostic Finding into an executable training ladder:
 *
 *   basic → same_type → variant → review(24h) → retest(3d)
 *
 * Every parameter derives from evidence — never the same for every student:
 *   • difficulty anchor: node mastery / recent accuracy (unknown → BASIC, stated)
 *   • volume: finding severity (repeated / observed lost score / count), bounded
 *   • content: REAL availability of matching questions (scarcity adjusts counts
 *     and flags it; absence yields NO_CONTENT instead of invented questions)
 *   • timings: the SAME review-interval constants the scheduler uses
 *   • retention risk: explicit review-emphasis flag
 *
 * The module is pure and read-only by construction: it receives facts and
 * returns a plan. It never writes mastery, never computes recommendation
 * priority, never invents questions.
 */

import type { ErrorReasonCode } from './error-reason';
import type { QuestionSubtypeCode } from './question-subtype';

export type PrescriptionStage = 'basic' | 'same_type' | 'variant' | 'review' | 'retest';
export type PrescriptionStepStatus = 'READY' | 'UNAVAILABLE' | 'NO_CONTENT';
export type PrescriptionDataStatus = 'OK' | 'LIMITED_CONTENT' | 'NO_CONTENT' | 'EMPTY';

export interface PrescriptionTarget {
  subject: string | null;
  nodeId: string;
  questionSubtype: QuestionSubtypeCode | 'unknown';
  questionSubtypeLabel: string;
  reasonCode: ErrorReasonCode;
  reasonLabel: string;
}

export interface PrescriptionFindingInput {
  subject: string | null;
  nodeId: string;
  questionSubtype: QuestionSubtypeCode | 'unknown';
  questionSubtypeLabel?: string;
  reasonCode: ErrorReasonCode;
  reasonLabel: string;
  count: number;
  recentCount: number;
  trend: 'up' | 'down' | 'flat' | 'no_data';
  repeated: boolean;
  observedLostScore: number;
  proxyLostScore: number;
  confidence: 'high' | 'medium' | 'low';
}

export interface PrescriptionMasteryState {
  mastery: number;
  recentAccuracy: number;
  retention: number | null;
  attempts: number;
}

export interface PrescriptionAvailability {
  /** Matching current questions at BASIC difficulty (node + subtype). */
  basic: number;
  medium: number;
  hard: number;
  /** Matching current questions of the finding's subtype at any difficulty. */
  sameSubtype: number;
}

export interface PrescriptionLadderStep {
  order: number;
  stage: PrescriptionStage;
  label: string;
  status: PrescriptionStepStatus;
  questionCount: number;
  difficulty: 'BASIC' | 'MEDIUM' | 'HARD' | null;
  minutes: number | null;
  dueInDays: number | null;
  limitedByContent: boolean;
  reason: string | null;
}

export interface TrainingPrescription {
  dataStatus: PrescriptionDataStatus;
  target: PrescriptionTarget | null;
  reason: string;
  difficultyAnchor: 'BASIC' | 'MEDIUM' | null;
  reviewEmphasis: boolean;
  ladder: PrescriptionLadderStep[];
}

export interface BuildTrainingPrescriptionInput {
  now: string;
  windowDays: number;
  finding: PrescriptionFindingInput | null;
  masteryState: PrescriptionMasteryState | null;
  available: PrescriptionAvailability;
  /** Whether a variant capability exists (e.g. AI variant with configured key). */
  variantAvailable: boolean;
  /** The real review-interval ladder (shared REVIEW_INTERVAL_DAYS); injected for testability. */
  reviewIntervalDays: readonly number[];
}

const MINUTES_PER_QUESTION = 3;

function anchorFrom(state: PrescriptionMasteryState | null): 'BASIC' | 'MEDIUM' {
  if (!state) return 'BASIC';
  if (state.mastery >= 0.8 && state.recentAccuracy >= 0.75) return 'MEDIUM';
  return 'BASIC';
}

export function buildTrainingPrescription(input: BuildTrainingPrescriptionInput): TrainingPrescription {
  const empty: TrainingPrescription = {
    dataStatus: 'EMPTY',
    target: null,
    reason: '当前窗口内没有可处方的诊断发现。',
    difficultyAnchor: null,
    reviewEmphasis: false,
    ladder: [],
  };
  const finding = input.finding;
  if (!finding || finding.count <= 0) return empty;

  const severe = finding.repeated || finding.count >= 4 || finding.observedLostScore >= 4;
  const verySevere = finding.count >= 6 || finding.observedLostScore >= 8;
  const anchor = anchorFrom(input.masteryState);
  const reviewEmphasis = input.masteryState?.retention != null && input.masteryState.retention < 0.5;

  const basePool = anchor === 'BASIC'
    ? input.available.basic + input.available.medium
    : input.available.medium + input.available.hard;
  const baseTarget = 3 + (severe ? 1 : 0) + (verySevere ? 1 : 0);
  const baseCount = Math.min(baseTarget, basePool);
  const baseLimited = baseCount < baseTarget;

  const sameTarget = 2 + (severe ? 1 : 0);
  const sameCount = Math.min(sameTarget, input.available.sameSubtype);
  const sameLimited = sameCount < sameTarget;

  const anyContent = basePool > 0 || input.available.sameSubtype > 0;
  const anyLimited = baseLimited || sameLimited;

  const subtypeLabel = finding.questionSubtypeLabel ?? (finding.questionSubtype === 'unknown' ? '未知题型' : finding.questionSubtype);
  const reasonParts = [
    `近 ${input.windowDays} 天「${subtypeLabel}·${finding.reasonLabel}」错误 ${finding.count} 次`,
  ];
  if (finding.repeated) reasonParts.push('跨周期重复出现');
  if (finding.observedLostScore > 0) reasonParts.push(`OBSERVED 失 ${finding.observedLostScore} 分`);
  if (finding.proxyLostScore > 0) reasonParts.push(`PROXY 失 ${finding.proxyLostScore} 分（自评口径）`);

  const ladder: PrescriptionLadderStep[] = [];
  ladder.push({
    order: 1,
    stage: 'basic',
    label: '基础训练',
    status: baseCount > 0 ? 'READY' : 'NO_CONTENT',
    questionCount: baseCount,
    difficulty: anchor,
    minutes: baseCount * MINUTES_PER_QUESTION,
    dueInDays: null,
    limitedByContent: baseLimited,
    reason: baseCount > 0 ? null : '题库中没有该节点/题型的可练题目。',
  });
  ladder.push({
    order: 2,
    stage: 'same_type',
    label: '同型训练',
    status: sameCount > 0 ? 'READY' : 'NO_CONTENT',
    questionCount: sameCount,
    difficulty: anchor === 'BASIC' ? 'MEDIUM' : 'HARD',
    minutes: sameCount * MINUTES_PER_QUESTION,
    dueInDays: null,
    limitedByContent: sameLimited,
    reason: sameCount > 0 ? null : '题库中该题型的同型题目不足。',
  });
  ladder.push({
    order: 3,
    stage: 'variant',
    label: '变式训练',
    status: !input.variantAvailable ? 'UNAVAILABLE' : anyContent ? 'READY' : 'NO_CONTENT',
    questionCount: input.variantAvailable && anyContent ? 1 : 0,
    difficulty: anchor === 'BASIC' ? 'MEDIUM' : 'HARD',
    minutes: input.variantAvailable && anyContent ? MINUTES_PER_QUESTION : null,
    dueInDays: null,
    limitedByContent: false,
    reason: !input.variantAvailable
      ? '变式能力未配置（AI 变式未启用）；该步骤显式不可用而非静默跳过。'
      : anyContent ? null : '没有可用于变式的基础题目。',
  });
  const reviewDays = input.reviewIntervalDays[0] ?? 1;
  const retestDays = input.reviewIntervalDays[1] ?? 3;
  ladder.push({
    order: 4,
    stage: 'review',
    label: reviewEmphasis ? '复习（保持率偏低，重点执行）' : '复习',
    status: 'READY',
    questionCount: 0,
    difficulty: null,
    minutes: MINUTES_PER_QUESTION,
    dueInDays: reviewDays,
    limitedByContent: false,
    reason: null,
  });
  ladder.push({
    order: 5,
    stage: 'retest',
    label: '复测',
    status: 'READY',
    questionCount: 0,
    difficulty: null,
    minutes: MINUTES_PER_QUESTION,
    dueInDays: retestDays,
    limitedByContent: false,
    reason: null,
  });

  return {
    dataStatus: anyContent ? (anyLimited ? 'LIMITED_CONTENT' : 'OK') : 'NO_CONTENT',
    target: {
      subject: finding.subject,
      nodeId: finding.nodeId,
      questionSubtype: finding.questionSubtype,
      questionSubtypeLabel: subtypeLabel,
      reasonCode: finding.reasonCode,
      reasonLabel: finding.reasonLabel,
    },
    reason: `${reasonParts.join('，')}。`,
    difficultyAnchor: anchor,
    reviewEmphasis,
    ladder,
  };
}
