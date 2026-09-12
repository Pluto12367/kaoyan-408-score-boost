import {
  COMPLETION_BOUNDARY_NOTE,
  NEXT_ACTIONS,
  PREDICTION_BOUNDARY_NOTE,
  VERIFICATION_HEADLINE,
  VERIFICATION_MOCK_RESULT,
  VERIFICATION_NEEDS_TRANSFER,
  VERIFICATION_NO_PROBE_AVAILABLE,
  VERIFICATION_PENDING_ABILITY,
  VERIFICATION_PRACTICE_EVIDENCE,
  VERIFICATION_TRANSFER_EXPIRED,
  VERIFICATION_TRANSFER_FAILED,
  VERIFICATION_TRANSFER_PASSED,
  statement,
  type GuidanceStatement,
  type NextActionSpec,
  type VerificationDomain,
} from './guidance-copy';
import {
  buildReasonDetailFromCode,
  resolveShownReasons,
  type PriorityReasonDetail,
} from '../score-center/reason-integrity';
import type { PriorityReasonCode } from '../score-center/types';

/**
 * G1.2 Today Mission contract + G1.4 verification + G1.5 NEXT.
 *
 * These three live together because they are one conversation with the student:
 * "do this → this is what happened → therefore do that". Splitting them would
 * let a surface render a NEXT without the evidence that justifies it.
 *
 * Pure: no IO, no clock. Everything the caller needs is passed in.
 */

// ------------------------------------------------------------- G1.2 TODAY

export interface TodayMissionTaskFact {
  readonly id: string;
  readonly title: string;
  readonly subject: string;
  readonly chapter: string;
  readonly minutes: number;
  readonly questionCount: number;
  readonly completed: boolean;
  readonly reasonCodes?: readonly string[] | null;
  readonly reason?: string | null;
}

export interface TodayMissionInput {
  readonly asOf: string;
  readonly dateKey: string;
  readonly tasks: readonly TodayMissionTaskFact[];
  readonly reviewDue: number;
  readonly verification: {
    /** A transfer probe is deliverable right now. */
    readonly probeDue: boolean;
    /** The probe feature is on but no eligible question exists. */
    readonly probeUnavailable: boolean;
    /** Assessment / mock records available for verification. */
    readonly assessments: number;
  };
}

export interface TodayMissionContract {
  readonly today: string;
  readonly what: {
    readonly taskId: string;
    readonly title: string;
    readonly subject: string;
    readonly chapter: string;
    readonly section: 'question';
  } | null;
  /** EVIDENCED + INFERRED only (G1.1 taxonomy). */
  readonly why: readonly PriorityReasonDetail[];
  /** CONTEXTUAL_FACT: the situation, never presented as a cause. */
  readonly context: readonly PriorityReasonDetail[];
  readonly whySufficient: boolean;
  readonly insufficientNote: string | null;
  readonly time: string | null;
  readonly verify: string;
  readonly next: NextActionSpec;
  readonly nextReason: string;
  readonly boundary: string;
}

function toPriorityCodes(codes: readonly string[] | null | undefined): PriorityReasonCode[] {
  return (codes ?? []) as PriorityReasonCode[];
}

/**
 * The single primary learning action for today, with its four mandatory
 * answers (task §5: 今天应该做什么 / 为什么 / 预计多久 / 做完怎么验证).
 */
export function buildTodayMissionContract(input: TodayMissionInput): TodayMissionContract {
  const pending = input.tasks.filter((task) => !task.completed);
  const primary = pending[0] ?? null;
  const whyView = primary
    ? resolveShownReasons({
        reasons: toPriorityCodes(primary.reasonCodes),
        reasonDetails: toPriorityCodes(primary.reasonCodes).map(buildReasonDetailFromCode),
      })
    : { reasons: [], contextFacts: [], sufficient: false, insufficientNote: null, fallbackReasons: [] };

  const verify = primary
    ? `完成后系统会看：该考点上是否出现新的判分作答，以及掌握度是否变化。判定会写在任务卡上，包含「证据不足」这一种可能。`
    : '还没有可执行的任务，因此没有可验证的动作。';

  const next = resolveNextAction({
    hasPendingTask: pending.length > 0,
    reviewDue: input.reviewDue,
    probeDue: input.verification.probeDue,
    probeUnavailable: input.verification.probeUnavailable,
    assessments: input.verification.assessments,
    probeEvents: 0,
  });

  return {
    today: input.dateKey,
    what: primary
      ? {
          taskId: primary.id,
          title: primary.title,
          subject: primary.subject,
          chapter: primary.chapter,
          section: 'question',
        }
      : null,
    why: whyView.reasons,
    context: whyView.contextFacts,
    whySufficient: whyView.sufficient,
    insufficientNote: whyView.insufficientNote,
    time: primary ? `约 ${primary.minutes} 分钟 · ${primary.questionCount} 题` : null,
    verify,
    next: next.action,
    nextReason: next.reason,
    boundary: COMPLETION_BOUNDARY_NOTE,
  };
}

// ------------------------------------------------------- G1.5 NEXT resolver

export interface NextResolutionInput {
  readonly hasPendingTask: boolean;
  readonly reviewDue: number;
  readonly probeDue: boolean;
  readonly probeUnavailable?: boolean;
  readonly assessments: number;
  readonly probeEvents: number;
  readonly lastProbeOutcome?: 'passed' | 'failed' | 'expired' | 'no_probe_available' | null;
  readonly mockJustFinished?: boolean;
  readonly verdict?: 'improved' | 'practiced' | 'practiced_no_gain' | 'insufficient_data' | null;
  readonly hasWrongQuestions?: boolean;
}

export interface NextResolution {
  readonly action: NextActionSpec;
  /** Always present. When no reliable action exists it says why. */
  readonly reason: string;
  /** True when the resolver had to fall back to an explicit “no next”. */
  readonly honestNoNext: boolean;
}

/**
 * Deterministic precedence. Every branch names a real product entry point, so
 * §11's "no '暂无操作'" rule holds by construction: the fallback is an explicit
 * statement of *why* there is nothing reliable to suggest.
 */
export function resolveNextAction(input: NextResolutionInput): NextResolution {
  if (input.mockJustFinished) {
    return {
      action: NEXT_ACTIONS.analyze_mock_loss,
      reason: NEXT_ACTIONS.analyze_mock_loss.reason,
      honestNoNext: false,
    };
  }
  if (input.lastProbeOutcome === 'failed') {
    return {
      action: NEXT_ACTIONS.review_wrong_questions,
      reason: '迁移没通过，说明方法还没稳；先把这道新题的错因处理掉。',
      honestNoNext: false,
    };
  }
  if (input.lastProbeOutcome === 'passed') {
    return {
      action: NEXT_ACTIONS.take_assessment,
      reason: '迁移已经成立，下一步是用一次测评确认它在考试形态下也成立。',
      honestNoNext: false,
    };
  }
  if (input.probeDue) {
    return {
      action: NEXT_ACTIONS.do_transfer_probe,
      reason: NEXT_ACTIONS.do_transfer_probe.reason,
      honestNoNext: false,
    };
  }
  if (input.hasPendingTask) {
    return {
      action: NEXT_ACTIONS.continue_training,
      reason: '今天的任务还没做完，先完成它再考虑加量。',
      honestNoNext: false,
    };
  }
  if (input.reviewDue > 0) {
    return {
      action: NEXT_ACTIONS.review_wrong_questions,
      reason: `有 ${input.reviewDue} 项到期复习，先清掉它们再开始新内容。`,
      honestNoNext: false,
    };
  }
  if (input.verdict === 'practiced_no_gain' || input.verdict === 'insufficient_data') {
    return {
      action: NEXT_ACTIONS.check_evidence,
      reason: '上一次的结果还不能判断能力变化，先看清系统观测到了什么。',
      honestNoNext: false,
    };
  }
  if (input.hasWrongQuestions) {
    return {
      action: NEXT_ACTIONS.review_wrong_questions,
      reason: '还有待复盘的错题，先处理它们。',
      honestNoNext: false,
    };
  }
  if (input.assessments === 0 && input.probeEvents === 0) {
    return {
      action: NEXT_ACTIONS.take_assessment,
      reason: '目前只有练习记录，没有任何测量记录；没有测量就无法验证训练是否有效。',
      honestNoNext: false,
    };
  }
  return {
    action: NEXT_ACTIONS.none_available,
    reason: NEXT_ACTIONS.none_available.reason,
    honestNoNext: true,
  };
}

// ------------------------------------------------------ G1.4 VERIFICATION

export type ProbeOutcome = 'passed' | 'failed' | 'expired' | 'no_probe_available';

export interface VerificationInput {
  readonly domain: VerificationDomain;
  /** Evidence strength observed for this action (from the evidence ledger). */
  readonly strength?: 'strong' | 'weak' | 'none' | null;
  readonly verdict?: 'improved' | 'practiced' | 'practiced_no_gain' | 'insufficient_data' | null;
  readonly attempts?: number | null;
  readonly accuracyRate?: number | null;
  readonly masteryDelta?: number | null;
  readonly probeOutcome?: ProbeOutcome | null;
  readonly hasTransferEvidence?: boolean;
}

export interface VerificationView {
  readonly heading: string;
  /** FACT statements about what was observed. */
  readonly facts: readonly GuidanceStatement[];
  /** INFERENCE / UNVERIFIED statements about what it means. */
  readonly meaning: readonly GuidanceStatement[];
  readonly boundary: string;
  readonly next: NextActionSpec;
  readonly nextReason: string;
}

/**
 * The one place that turns an action's outcome into honest language. It never
 * claims ability from an activity marker, and it always yields a NEXT.
 */
export function describeVerification(input: VerificationInput): VerificationView {
  const heading = VERIFICATION_HEADLINE[input.domain];
  const facts: GuidanceStatement[] = [];
  const meaning: GuidanceStatement[] = [];

  if (input.attempts != null && input.attempts > 0) {
    facts.push(statement('FACT', `本次记录 ${input.attempts} 次判分作答。`));
  }
  if (input.accuracyRate != null) {
    facts.push(statement('FACT', `本次正确率 ${input.accuracyRate}%。`));
  }
  if (input.masteryDelta != null) {
    const sign = input.masteryDelta > 0 ? '+' : '';
    facts.push(statement('FACT', `该考点掌握度变化 ${sign}${Math.round(input.masteryDelta * 100) / 100}。`));
  }

  if (input.domain === 'transfer_probe') {
    const outcome = input.probeOutcome ?? 'no_probe_available';
    if (outcome === 'passed') {
      meaning.push(statement('UNVERIFIED', VERIFICATION_TRANSFER_PASSED));
    } else if (outcome === 'failed') {
      meaning.push(statement('FACT', VERIFICATION_TRANSFER_FAILED));
    } else if (outcome === 'expired') {
      meaning.push(statement('FACT', VERIFICATION_TRANSFER_EXPIRED));
    } else {
      meaning.push(statement('INSUFFICIENT_DATA', VERIFICATION_NO_PROBE_AVAILABLE));
    }
  } else if (input.domain === 'mock') {
    meaning.push(statement('INFERENCE', VERIFICATION_MOCK_RESULT));
  } else {
    // Activity happened; was anything actually observed?
    const hasObservation = input.strength === 'strong' || input.strength === 'weak'
      || (input.attempts != null && input.attempts > 0);
    if (!hasObservation) {
      meaning.push(statement('INSUFFICIENT_DATA', VERIFICATION_PENDING_ABILITY));
    } else if (input.strength === 'weak') {
      meaning.push(statement('UNVERIFIED', '这条记录来自你的自评，系统没有验证它，因此不作为能力依据。'));
    } else {
      meaning.push(statement('FACT', VERIFICATION_PRACTICE_EVIDENCE));
      if (input.hasTransferEvidence === false) {
        meaning.push(statement('INFERENCE', VERIFICATION_NEEDS_TRANSFER));
      }
    }
    if (input.verdict === 'practiced_no_gain') {
      meaning.push(statement('INFERENCE', '这次练习没有带来掌握度变化——建议按错因复盘后换一种练法，而不是重复同一组。'));
    } else if (input.verdict === 'insufficient_data') {
      meaning.push(statement('INSUFFICIENT_DATA', '该知识点上没有足够的判分作答，系统拒绝据此判断能力变化。'));
    }
  }

  const next = resolveNextAction({
    hasPendingTask: false,
    reviewDue: 0,
    probeDue: false,
    assessments: 0,
    probeEvents: input.hasTransferEvidence ? 1 : 0,
    lastProbeOutcome: input.domain === 'transfer_probe' ? (input.probeOutcome ?? null) : null,
    mockJustFinished: input.domain === 'mock',
    verdict: input.verdict ?? null,
    hasWrongQuestions: input.verdict === 'practiced_no_gain' || input.verdict === 'insufficient_data',
  });

  const boundary = input.domain === 'mock' ? PREDICTION_BOUNDARY_NOTE : COMPLETION_BOUNDARY_NOTE;

  return { heading, facts, meaning, boundary, next: next.action, nextReason: next.reason };
}
