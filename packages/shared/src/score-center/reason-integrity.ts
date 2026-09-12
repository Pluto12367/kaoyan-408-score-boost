import type { PriorityReasonCode, PriorityResult, TrendDirection } from './types';

/**
 * G1.1 — Reason Integrity (owner decision A1 = APPROVED).
 *
 * ## The defect this module closes
 *
 * `priority.ts` used to guarantee "at least two reasons" by pulling codes out
 * of a generic pool ordered only by breakdown magnitude. Those padded codes
 * were indistinguishable from real triggers downstream: they became
 * `StudyTask.reason`, and the student-facing surfaces printed them under the
 * label 「为什么推荐」. The system therefore told students about causes that had
 * never been observed.
 *
 * ## The taxonomy
 *
 *   EVIDENCED_REASON — fired on the student's own observed data
 *   INFERRED_REASON  — fired on a real content/exam statistic
 *   CONTEXTUAL_FACT  — describes the situation; useful, but not a "why"
 *
 * Only the first two may be presented as reasons. Context facts are shown
 * separately so nothing is lost, and `fallbackReasons` (the old pool) is
 * diagnostics-only and must never reach a student.
 *
 * Pure: zero imports beyond types, no clock, no randomness.
 */

export type ReasonTier = 'EVIDENCED_REASON' | 'INFERRED_REASON' | 'CONTEXTUAL_FACT';

export const REASON_TIERS: Record<PriorityReasonCode, ReasonTier> = {
  // Observed on the student's own attempts.
  LOW_MASTERY: 'EVIDENCED_REASON',
  LOW_ACCURACY: 'EVIDENCED_REASON',
  REPEATED_WRONG: 'EVIDENCED_REASON',
  REVIEW_DUE: 'EVIDENCED_REASON',
  // Observed in the exam/content statistics, not in the student's behaviour.
  HIGH_RECENT_FREQUENCY: 'INFERRED_REASON',
  RISING_TREND: 'INFERRED_REASON',
  PREREQUISITE_GAP: 'INFERRED_REASON',
  // Context about the situation, never a cause of the recommendation.
  EXAM_NEAR: 'CONTEXTUAL_FACT',
  LOW_EVIDENCE: 'CONTEXTUAL_FACT',
};

/** A reason that fired, with the concrete basis that made it fire. */
export interface PriorityReasonDetail {
  readonly code: PriorityReasonCode;
  readonly tier: ReasonTier;
  /** Machine-checkable basis, e.g. `recent3Y.frequency=5 >= 4`. */
  readonly basis: string;
  /** FACT-form sentence for the student; never an inference dressed as a fact. */
  readonly statement: string;
}

/**
 * Concrete values the reason thresholds were evaluated against. Passed in by
 * `priority.ts` so a statement can quote the real number instead of asserting
 * an adjective.
 */
export interface ReasonFacts {
  readonly recent3YFrequency: number;
  readonly mastery: number;
  readonly recentAccuracy: number;
  readonly wrongCount: number;
  readonly forgetting: number;
  readonly trendDirection: TrendDirection;
  readonly daysToExam: number;
  readonly evidenceConfidence: string;
  readonly prerequisiteOfNodeId?: string | null;
}

const percent = (value: number): string => `${Math.round(value * 100)}%`;
const ratio = (value: number): string => `${Math.round(value * 100) / 100}`;

function describe(code: PriorityReasonCode, facts: ReasonFacts): { basis: string; statement: string } {
  switch (code) {
    case 'HIGH_RECENT_FREQUENCY':
      return {
        basis: `recent3Y.frequency=${facts.recent3YFrequency} >= 4`,
        statement: `近 3 年真题里这个考点出现了 ${facts.recent3YFrequency} 次（高频考点）。`,
      };
    case 'LOW_MASTERY':
      return {
        basis: `mastery=${ratio(facts.mastery)} < 0.55`,
        statement: `你在该考点上的练习证据仍然偏低（掌握度 ${ratio(facts.mastery)}）。`,
      };
    case 'LOW_ACCURACY':
      return {
        basis: `recentAccuracy=${ratio(facts.recentAccuracy)} < 0.65`,
        statement: `你近期的相关题正确率偏低（${percent(facts.recentAccuracy)}）。`,
      };
    case 'REPEATED_WRONG':
      return {
        basis: `wrongCount=${facts.wrongCount} >= 3`,
        statement: `你在该考点上已经错 ${facts.wrongCount} 次。`,
      };
    case 'REVIEW_DUE':
      return {
        basis: `forgetting=${ratio(facts.forgetting)} >= 0.55`,
        statement: `该考点已进入遗忘区间（保持率约 ${percent(1 - facts.forgetting)}），到了该复习的时候。`,
      };
    case 'RISING_TREND':
      return {
        basis: 'trend.direction=RISING',
        statement: '该考点的考查趋势在上升。',
      };
    case 'PREREQUISITE_GAP':
      return {
        basis: facts.prerequisiteOfNodeId
          ? `unmetPrerequisiteOf=${facts.prerequisiteOfNodeId}`
          : 'unmetPrerequisite',
        statement: '它的前置知识点还没掌握，先补前置更划算。',
      };
    case 'EXAM_NEAR':
      return {
        basis: `daysToExam=${facts.daysToExam} <= 45`,
        statement: `距离考试 ${facts.daysToExam} 天，已进入冲刺期。`,
      };
    case 'LOW_EVIDENCE':
      return {
        basis: `evidenceConfidence=${facts.evidenceConfidence} = LOW`,
        statement: '这个考点还没有考频数据，系统按中性值让它参与排序，不代表它真的中等薄弱。',
      };
    default:
      return { basis: 'unknown', statement: '' };
  }
}

export function buildReasonDetail(code: PriorityReasonCode, facts: ReasonFacts): PriorityReasonDetail {
  const { basis, statement } = describe(code, facts);
  return { code, tier: REASON_TIERS[code], basis, statement };
}

/**
 * Value-free variant for surfaces that receive only `reasonCodes` (e.g. a
 * persisted StudyTask). It still states a real, checkable threshold — it just
 * does not quote the student's number, because that number is not on the wire.
 * Quoting it would require persisting `reasonDetails`; not worth a schema-adjacent
 * change in G1.
 */
export function reasonStatement(code: PriorityReasonCode): string {
  switch (code) {
    case 'HIGH_RECENT_FREQUENCY':
      return '这个考点近 3 年真题出现频率高（≥4 次）。';
    case 'LOW_MASTERY':
      return '你在该考点上的练习掌握度低于 55%。';
    case 'LOW_ACCURACY':
      return '你在该考点上的近期正确率低于 65%。';
    case 'REPEATED_WRONG':
      return '你在该考点上已经错过 3 次以上。';
    case 'REVIEW_DUE':
      return '该考点已进入遗忘区间，到期该复习了。';
    case 'RISING_TREND':
      return '该考点的考查趋势在上升。';
    case 'PREREQUISITE_GAP':
      return '它的前置知识点还没掌握，先补前置更划算。';
    case 'EXAM_NEAR':
      return '距离考试已不足 45 天，进入冲刺期。';
    case 'LOW_EVIDENCE':
      return '这个考点还没有考频数据，系统按中性值让它参与排序，不代表它真的中等薄弱。';
    default:
      return '';
  }
}

/** Builds a detail from a code alone (no facts) — used when only codes travel. */
export function buildReasonDetailFromCode(code: PriorityReasonCode): PriorityReasonDetail {
  return { code, tier: REASON_TIERS[code], basis: 'code-only', statement: reasonStatement(code) };
}

export interface PriorityReasonView {
  /** EVIDENCED + INFERRED: the only entries a student may read as "why". */
  readonly reasons: readonly PriorityReasonDetail[];
  /** CONTEXTUAL_FACT entries, shown as "当前情况" rather than as causes. */
  readonly contextFacts: readonly PriorityReasonDetail[];
  readonly sufficient: boolean;
  /** Honest replacement text when no real reason fired. */
  readonly insufficientNote: string | null;
  /** Diagnostics only — never rendered. */
  readonly fallbackReasons: readonly PriorityReasonCode[];
}

export const INSUFFICIENT_REASON_NOTE =
  '当前证据不足：这个考点还没有触发任何可解释的推荐原因，系统不会替你编一个。';

/**
 * The single place that decides what a student is allowed to read as a reason.
 * Anything that is not EVIDENCED or INFERRED — including every code that was
 * only added to reach a minimum count — is dropped.
 */
export function resolveShownReasons(
  result: Pick<PriorityResult, 'reasons'> & Partial<Pick<PriorityResult, 'reasonDetails' | 'fallbackReasons'>>,
): PriorityReasonView {
  const details = result.reasonDetails ?? [];
  const byCode = new Map(details.map((detail) => [detail.code, detail]));
  const reasons: PriorityReasonDetail[] = [];
  const contextFacts: PriorityReasonDetail[] = [];
  for (const code of result.reasons) {
    const detail = byCode.get(code) ?? buildReasonDetailFromCode(code);
    if (detail.tier === 'CONTEXTUAL_FACT') contextFacts.push(detail);
    else reasons.push(detail);
  }
  return {
    reasons,
    contextFacts,
    sufficient: reasons.length > 0,
    insufficientNote: reasons.length > 0 ? null : INSUFFICIENT_REASON_NOTE,
    fallbackReasons: result.fallbackReasons ?? [],
  };
}

/** True when the code is a code the UI may print under 「为什么推荐」. */
export function isShownReasonTier(tier: ReasonTier): boolean {
  return tier === 'EVIDENCED_REASON' || tier === 'INFERRED_REASON';
}
