import {
  GUIDANCE_COOLDOWN_DAYS,
  NEXT_ACTIONS,
  statement,
  type GuidancePriority,
  type GuidanceStatement,
  type NextActionSpec,
} from './guidance-copy';

/**
 * G1.3 — high-confidence wrong-usage detection (task §8, patterns A–G).
 *
 * Contract for every signal (task §9):
 *   Detection → Explanation → Correction Action → Verification
 * A signal that cannot supply all four is not emitted. Nothing here writes any
 * state: the detectors are pure functions over an already-bounded read model,
 * so Guidance never becomes a second source of truth (task §17).
 *
 * Thresholds are declared constants so they can be pre-registered and reviewed;
 * they live here rather than being tuned per surface.
 *
 * Pure: no clock, no IO, no randomness. `asOf` and the window arrive as input.
 */

export const BEHAVIOR_SIGNAL_IDS = [
  'A_repeat_familiar',
  'B_easy_only',
  'C_explain_only',
  'D_practice_without_verification',
  'E_probe_expired',
  'F_recommendation_failed',
  'G_mastery_without_transfer',
] as const;

export type BehaviorSignalId = (typeof BEHAVIOR_SIGNAL_IDS)[number];

export const BEHAVIOR_THRESHOLDS = {
  /** A — need enough volume before "mostly repeats" means anything. */
  repeatMinAttempts: 8,
  repeatRatio: 0.5,
  repeatMaxDistinctFirstSeen: 5,
  /** B — "only easy" needs both a big sample and a near-absent hard band. */
  easyMinAttempts: 10,
  easyMediumShareCeiling: 0.3,
  /** C — one session that was mostly never submitted. */
  explainMinQuestions: 4,
  explainAbandonRatio: 0.5,
  /** D — volume without any measurement at all. */
  verifyMinAttempts: 60,
  /** E — repeated expiries become a teaching moment, never a penalty. */
  probeExpiredCount: 3,
  /** F — two consecutive failures of the same (node, action) pattern. */
  recommendationFailures: 2,
  /** G — need enough practice evidence before "mastery is rising" is claimable. */
  masteryRisingMinAttempts: 5,
} as const;

export interface PracticeAttemptFact {
  readonly questionId: string;
  readonly nodeId: string | null;
  /** Normalized bucket: BASIC | MEDIUM | HARD. */
  readonly difficulty: string;
  readonly correct: boolean;
  readonly submittedAt: string;
  /** True when this is the student's first-ever attempt on that questionId. */
  readonly firstSeen: boolean;
}

export interface BehaviorSignalInput {
  readonly asOf: string;
  readonly windowDays: number;
  /** Bounded recent graded attempts (the service owns the bound). */
  readonly attempts: readonly PracticeAttemptFact[];
  readonly sessions: {
    readonly count: number;
    readonly totalQuestions: number;
    readonly abandonedQuestions: number;
  };
  readonly verification: {
    /** Transfer-probe evidence events observed for this student. */
    readonly probeEvents: number;
    /** Probes whose delivery window elapsed unsubmitted. */
    readonly probeExpired: number;
    /** Assessment / mock-exam records. */
    readonly assessments: number;
  };
  readonly recommendations: {
    readonly failures: readonly { nodeId: string; actionType: string; failures: number }[];
  };
  readonly mastery: {
    /** Nodes whose mastery rose in the window, with their evidence volume. */
    readonly rising: readonly { nodeId: string; attempts: number }[];
    /** Nodes that already carry transfer-probe evidence. */
    readonly withTransferEvidence: readonly string[];
  };
}

export interface BehaviorSignal {
  readonly id: BehaviorSignalId;
  readonly priority: GuidancePriority;
  readonly cooldownDays: number;
  /** Short headline. */
  readonly title: string;
  /** FACT — the observation, with real numbers. */
  readonly fact: GuidanceStatement;
  /** INFERENCE — what it might mean. Never stated as fact. */
  readonly inference: GuidanceStatement;
  /** Correction Action — an existing entry point (never a toast). */
  readonly action: NextActionSpec;
  /** How the student (and the system) will know the correction worked. */
  readonly verification: string;
  /** Machine-readable evidence for telemetry and tests. */
  readonly evidence: Readonly<Record<string, number | string | boolean>>;
}

const HARD = 'HARD';
const MEDIUM = 'MEDIUM';

function ratio(part: number, whole: number): number {
  return whole > 0 ? part / whole : 0;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * A — repeated familiar questions.
 * Repeated *review* attempts are excluded upstream (review lives on its own
 * chain), so anything counted here is a genuine re-attempt of a seen question.
 */
function detectRepeatFamiliar(input: BehaviorSignalInput): BehaviorSignal | null {
  const attempts = input.attempts;
  if (attempts.length < BEHAVIOR_THRESHOLDS.repeatMinAttempts) return null;
  const distinct = new Set(attempts.map((attempt) => attempt.questionId));
  const repeated = new Set(
    [...distinct].filter((questionId) => attempts.filter((row) => row.questionId === questionId).length >= 2),
  );
  const firstSeen = new Set(attempts.filter((row) => row.firstSeen).map((row) => row.questionId));
  const repeatRatio = ratio(repeated.size, distinct.size);
  if (repeatRatio < BEHAVIOR_THRESHOLDS.repeatRatio) return null;
  if (firstSeen.size > BEHAVIOR_THRESHOLDS.repeatMaxDistinctFirstSeen) return null;
  return {
    id: 'A_repeat_familiar',
    priority: 'P1',
    cooldownDays: GUIDANCE_COOLDOWN_DAYS.A_repeat_familiar,
    title: '你在重复做已经见过的题',
    fact: statement(
      'FACT',
      `最近 ${input.windowDays} 天的 ${distinct.size} 道题里，有 ${repeated.size} 道是重复做的（${pct(repeatRatio)}），新题只有 ${firstSeen.size} 道。`,
    ),
    inference: statement(
      'INFERENCE',
      '重复能提高熟悉度，但不能验证迁移——熟练和会做新题是两件事。',
    ),
    action: NEXT_ACTIONS.do_transfer_probe,
    verification: '下一次复测用一道你从未见过的新题来验证；练习正确率本身不算验证。',
    evidence: {
      distinctQuestions: distinct.size,
      repeatedQuestions: repeated.size,
      firstSeenQuestions: firstSeen.size,
      repeatRatio: Math.round(repeatRatio * 100) / 100,
    },
  };
}

/** B — only easy questions; the exam band is absent. */
function detectEasyOnly(input: BehaviorSignalInput): BehaviorSignal | null {
  const attempts = input.attempts;
  if (attempts.length < BEHAVIOR_THRESHOLDS.easyMinAttempts) return null;
  const hard = attempts.filter((row) => row.difficulty === HARD).length;
  const medium = attempts.filter((row) => row.difficulty === MEDIUM).length;
  const mediumShare = ratio(medium, attempts.length);
  if (hard > 0) return null;
  if (mediumShare >= BEHAVIOR_THRESHOLDS.easyMediumShareCeiling) return null;
  return {
    id: 'B_easy_only',
    priority: 'P1',
    cooldownDays: GUIDANCE_COOLDOWN_DAYS.B_easy_only,
    title: '你一直在做基础难度的题',
    fact: statement(
      'FACT',
      `最近 ${input.windowDays} 天做了 ${attempts.length} 道题：困难 0 道，中等 ${medium} 道（${pct(mediumShare)}）。`,
    ),
    inference: statement(
      'INFERENCE',
      '基础题做得多不代表考试题会做。408 的失分通常出现在中等和困难题上。',
    ),
    action: NEXT_ACTIONS.continue_training,
    verification: '之后出现的作答里有中等或困难难度的题，且正确率不是靠基础题撑起来的。',
    evidence: { attempts: attempts.length, hard, medium, mediumShare: Math.round(mediumShare * 100) / 100 },
  };
}

/** C — opened explanations without submitting answers. */
function detectExplainOnly(input: BehaviorSignalInput): BehaviorSignal | null {
  const { count, totalQuestions, abandonedQuestions } = input.sessions;
  if (count === 0) return null;
  if (totalQuestions < BEHAVIOR_THRESHOLDS.explainMinQuestions) return null;
  const abandonRatio = ratio(abandonedQuestions, totalQuestions);
  if (abandonRatio < BEHAVIOR_THRESHOLDS.explainAbandonRatio) return null;
  return {
    id: 'C_explain_only',
    priority: 'P0',
    cooldownDays: GUIDANCE_COOLDOWN_DAYS.C_explain_only,
    title: '你有题目没有提交作答',
    fact: statement(
      'FACT',
      `最近的练习会话里有 ${abandonedQuestions}/${totalQuestions} 道题没有提交作答（${pct(abandonRatio)}）。`,
    ),
    inference: statement(
      'INFERENCE',
      '阅读解析不会自动产生掌握证据；系统只承认被判分的作答。',
    ),
    action: NEXT_ACTIONS.continue_training,
    verification: '把这些题提交作答后，系统会为它们记录一条观测证据。',
    evidence: { sessions: count, totalQuestions, abandonedQuestions, abandonRatio: Math.round(abandonRatio * 100) / 100 },
  };
}

/** D — a lot of practice, no measurement at all. */
function detectPracticeWithoutVerification(input: BehaviorSignalInput): BehaviorSignal | null {
  if (input.attempts.length < BEHAVIOR_THRESHOLDS.verifyMinAttempts) return null;
  const { probeEvents, assessments } = input.verification;
  if (probeEvents > 0 || assessments > 0) return null;
  return {
    id: 'D_practice_without_verification',
    priority: 'P0',
    cooldownDays: GUIDANCE_COOLDOWN_DAYS.D_practice_without_verification,
    title: '练了很多，但还没有测量过',
    fact: statement(
      'FACT',
      `最近 ${input.windowDays} 天完成了 ${input.attempts.length} 次判分作答，其中迁移复测 0 次、测评 0 次。`,
    ),
    inference: statement(
      'INFERENCE',
      '练习告诉你「做过」，测量才告诉你「会不会」。没有测量，系统无法判断训练是否有效。',
    ),
    action: NEXT_ACTIONS.take_assessment,
    verification: '出现至少一次测评或迁移复测记录。',
    evidence: { attempts: input.attempts.length, probeEvents, assessments },
  };
}

/**
 * E — repeated probe expiry.
 *
 * Honesty note: S2's formal design §7 declares `probe_expired` is NOT a failure
 * and must not produce negative student feedback. This detector therefore only
 * *explains why the re-test exists*; it never counts a failure, never blocks,
 * and never blames. Owner decision for G1 explicitly asked for the explanation.
 */
function detectProbeExpired(input: BehaviorSignalInput): BehaviorSignal | null {
  const expired = input.verification.probeExpired;
  if (expired < BEHAVIOR_THRESHOLDS.probeExpiredCount) return null;
  return {
    id: 'E_probe_expired',
    priority: 'P2',
    cooldownDays: GUIDANCE_COOLDOWN_DAYS.E_probe_expired,
    title: '有几次迁移复测没有做',
    fact: statement('FACT', `有 ${expired} 次迁移复测在窗口内没有被提交。`),
    inference: statement(
      'INFERENCE',
      '这不计入失败，也不影响你的任何记录；只是系统还没拿到「新题会不会做」的证据，所以只能继续按练习表现估计你。',
    ),
    action: NEXT_ACTIONS.do_transfer_probe,
    verification: '窗口内完成一次复测即可；完成后系统会记录一条迁移证据。',
    evidence: { probeExpired: expired, countsAsFailure: false },
  };
}

/** F — the same recommendation keeps failing. */
function detectRecommendationFailed(input: BehaviorSignalInput): BehaviorSignal | null {
  const hit = input.recommendations.failures.find(
    (row) => row.failures >= BEHAVIOR_THRESHOLDS.recommendationFailures,
  );
  if (!hit) return null;
  return {
    id: 'F_recommendation_failed',
    priority: 'P1',
    cooldownDays: GUIDANCE_COOLDOWN_DAYS.F_recommendation_failed,
    title: '同一种任务连续没有效果',
    fact: statement(
      'FACT',
      `「${hit.nodeId}」上的「${hit.actionType}」已经连续 ${hit.failures} 次没有带来提升。`,
    ),
    inference: statement(
      'INFERENCE',
      '这不是你的问题，是手段不匹配。系统会按错因换一种干预方式，而不是把同一个任务再排一次。',
    ),
    action: NEXT_ACTIONS.review_wrong_questions,
    verification: '换手段之后的新任务不再以「已练习·未见提升」结束。',
    evidence: { nodeId: hit.nodeId, actionType: hit.actionType, failures: hit.failures },
  };
}

/** G — mastery is moving, but nothing has verified transfer. */
function detectMasteryWithoutTransfer(input: BehaviorSignalInput): BehaviorSignal | null {
  const verified = new Set(input.mastery.withTransferEvidence);
  const candidate = input.mastery.rising.find(
    (row) => row.attempts >= BEHAVIOR_THRESHOLDS.masteryRisingMinAttempts && !verified.has(row.nodeId),
  );
  if (!candidate) return null;
  return {
    id: 'G_mastery_without_transfer',
    priority: 'P1',
    cooldownDays: GUIDANCE_COOLDOWN_DAYS.G_mastery_without_transfer,
    title: '掌握度在改善，但还缺陌生题验证',
    fact: statement(
      'FACT',
      `「${candidate.nodeId}」上已有 ${candidate.attempts} 次判分作答，练习证据充分，但没有任何迁移复测记录。`,
    ),
    inference: statement(
      'INFERENCE',
      '练习证据只说明同源题做得好，不说明新题会做。',
    ),
    action: NEXT_ACTIONS.do_transfer_probe,
    verification: '该考点出现一条迁移复测记录（答对即迁移成立，答错则进入针对性复盘）。',
    evidence: { nodeId: candidate.nodeId, attempts: candidate.attempts, hasTransferEvidence: false },
  };
}

const DETECTORS: ReadonlyArray<(input: BehaviorSignalInput) => BehaviorSignal | null> = [
  detectExplainOnly,
  detectPracticeWithoutVerification,
  detectRepeatFamiliar,
  detectEasyOnly,
  detectRecommendationFailed,
  detectMasteryWithoutTransfer,
  detectProbeExpired,
];

/**
 * Returns every signal that fired, strongest first. Ordering is deterministic
 * (priority, then declaration order) so a surface never flip-flops between runs.
 */
export function detectBehaviorSignals(input: BehaviorSignalInput): BehaviorSignal[] {
  const order: Record<GuidancePriority, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return DETECTORS
    .map((detector, index) => ({ signal: detector(input), index }))
    .filter((entry): entry is { signal: BehaviorSignal; index: number } => entry.signal != null)
    .sort((left, right) => order[left.signal.priority] - order[right.signal.priority] || left.index - right.index)
    .map((entry) => entry.signal);
}
