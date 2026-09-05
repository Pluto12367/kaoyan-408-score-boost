/**
 * Learning Signal Engine (V4-2) — pure derivation over the canonical
 * StudentContext.
 *
 * Eight signal kinds (mission contract): mastery_change, accuracy_trend,
 * wrong_streak, review_overdue, task_completion, study_consistency,
 * knowledge_regression, exam_performance.
 *
 * Signals are READ-ONLY derivations: never persisted, never a source of
 * truth, fully rebuildable from the same StudentContext (+ optional
 * baseline). Baseline-requiring signals degrade gracefully (present=false
 * with reason) when no baseline is provided — the engine never invents
 * history.
 */

export const SIGNAL_KINDS = [
  'mastery_change',
  'accuracy_trend',
  'wrong_streak',
  'review_overdue',
  'task_completion',
  'study_consistency',
  'knowledge_regression',
  'exam_performance',
] as const;

export type LearningSignalKind = (typeof SIGNAL_KINDS)[number];
export type SignalSeverity = 'info' | 'warning' | 'critical';

export interface SignalNode {
  knowledgeNodeId: string;
  title: string;
  subject: string;
  mastery: number;
  attempts: number;
  wrongCount: number;
}

export interface SignalBaseline {
  capturedAt: string;
  nodeMastery: Record<string, number>;
  exam?: { lastScorePercent?: number; trend?: 'up' | 'down' | 'flat' };
}

export interface SignalBaseline {
  capturedAt: string;
  nodeMastery: Record<string, number>;
  exam?: { lastScorePercent?: number; trend?: 'up' | 'down' | 'flat' };
}

export interface SignalStudentContextInput {
  asOf: string;
  mastery: {
    weakNodes: readonly SignalNode[];
    improvingNodes: readonly SignalNode[];
    masteredNodes: readonly SignalNode[];
  };
  practice: {
    recentAccuracy: { status: string; value: number | null };
    totalCount: number;
    latestSubmittedAt: string | null;
  };
  review: {
    dueCount: number;
    overdueCount: number;
    highRiskQuestions: readonly { questionId: string; wrongCount: number; overdue: boolean }[];
  };
  plan: { completionRate: number | null; openTaskCount: number };
  momentum: { studyStreak: number; isActiveToday: boolean; activeDaysLast7: number };
  /** Optional historical baseline enabling mastery_change / knowledge_regression / exam_performance. */
  baseline?: SignalBaseline;
}

export interface LearningSignal {
  kind: LearningSignalKind;
  present: boolean;
  severity: SignalSeverity;
  evidence: Record<string, unknown>;
}

export const SIGNAL_SEVERITY_ORDER: Record<SignalSeverity, number> = { info: 0, warning: 1, critical: 2 };

const INACTIVITY_DAYS_LIMIT = 3;
const LOW_COMPLETION_THRESHOLD = 0.3;
const WRONG_STREAK_RATIO = 0.7;
const REGRESSION_DROP = 0.1;

function signal(kind: LearningSignalKind, present: boolean, severity: SignalSeverity, evidence: Record<string, unknown>): LearningSignal {
  return { kind, present, severity, evidence };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/**
 * Derive all eight signals from a canonical StudentContext snapshot.
 * Pure: identical input → identical output.
 */
export function deriveLearningSignals(input: SignalStudentContextInput): LearningSignal[] {
  const signals: LearningSignal[] = [];
  // V4-13: null/undefined/non-object input must not crash.
  const safeInput = (input && typeof input === "object" ? input : {}) as SignalStudentContextInput;
  const weak = safeInput.mastery?.weakNodes ?? [];
  const improving = safeInput.mastery?.improvingNodes ?? [];
  const mastered = safeInput.mastery?.masteredNodes ?? [];
  const dueCount = safeInput.review?.dueCount ?? 0;
  const overdueCount = safeInput.review?.overdueCount ?? 0;

  // ---- accuracy_trend ----
  const accuracyValue = safeInput.practice?.recentAccuracy?.value ?? null;
  const accuracyStatus = safeInput.practice?.recentAccuracy?.status ?? 'insufficient_data';
  signals.push(signal('accuracy_trend', accuracyStatus === 'sufficient' && accuracyValue != null, accuracyValue != null && accuracyValue < 0.5 ? 'warning' : 'info', {
    recentAccuracy: accuracyValue,
    status: accuracyStatus,
  }));

  // ---- review_overdue ----
  if (overdueCount > 0) {
    signals.push(signal('review_overdue', true, 'warning', { overdueCount, dueCount }));
  } else if (dueCount > 0) {
    signals.push(signal('review_overdue', true, 'info', { overdueCount: 0, dueCount }));
  } else {
    signals.push(signal('review_overdue', false, 'info', { overdueCount: 0, dueCount: 0 }));
  }

  // ---- study_consistency ----
  // Absent momentum object = unknown (present=false, info).
  // Known + zero streak/today-inactive = warning; otherwise info.
  const momentum = safeInput.momentum;
  const momentumKnown = momentum != null && (
    typeof momentum.studyStreak === 'number' || typeof momentum.activeDaysLast7 === 'number' || typeof momentum.isActiveToday === 'boolean'
  );
  if (!momentumKnown) {
    signals.push(signal('study_consistency', false, 'info', { reason: 'no_momentum' }));
  } else {
    const inactive = !momentum.isActiveToday && (momentum.activeDaysLast7 ?? 0) <= 1;
    signals.push(signal('study_consistency', true, inactive ? 'warning' : 'info', { studyStreak: momentum.studyStreak ?? 0, activeDaysLast7: momentum.activeDaysLast7 ?? 0 }));
  }

  // ---- task_completion ----
  const completionRate = safeInput.plan?.completionRate ?? null;
  if (completionRate != null && completionRate < LOW_COMPLETION_THRESHOLD && safeInput.plan?.openTaskCount > 0) {
    signals.push(signal('task_completion', true, 'warning', { completionRate: round4(completionRate), openTaskCount: safeInput.plan?.openTaskCount ?? 0 }));
  } else {
    signals.push(signal('task_completion', false, 'info', { completionRate: completionRate == null ? null : round4(completionRate), openTaskCount: safeInput.plan?.openTaskCount ?? 0 }));
  }

  // ---- wrong_streak ----
  const wrongTotals = [...weak, ...improving].map((node) => ({
    knowledgeNodeId: node.knowledgeNodeId,
    title: node.title,
    ratio: node.attempts > 0 ? node.wrongCount / node.attempts : 0,
  }));
  const worst = wrongTotals.sort((left, right) => right.ratio - left.ratio)[0];
  const highRiskCount = safeInput.review?.highRiskQuestions?.length ?? 0;
  if (worst && worst.ratio >= WRONG_STREAK_RATIO) {
    signals.push(signal('wrong_streak', true, 'warning', {
      weakWrongRatio: round4(worst.ratio),
      worstNode: worst.knowledgeNodeId,
      highRiskCount,
    }));
  } else {
    signals.push(signal('wrong_streak', false, 'info', { weakWrongRatio: worst ? round4(worst.ratio) : 0, highRiskCount }));
  }

  // ---- mastery_change / knowledge_regression / exam_performance (baseline-gated) ----
  const baseline = safeInput.baseline;
  if (!baseline || !baseline.nodeMastery) {
    signals.push(signal('mastery_change', false, 'info', { reason: 'no_baseline' }));
    signals.push(signal('knowledge_regression', false, 'info', { reason: 'no_baseline' }));
  } else {
    const current = [...weak, ...improving, ...mastered];
    const drops = current
      .filter((node) => baseline.nodeMastery[node.knowledgeNodeId] != null)
      .map((node) => ({
        knowledgeNodeId: node.knowledgeNodeId,
        title: node.title,
        from: baseline.nodeMastery[node.knowledgeNodeId],
        to: node.mastery,
        delta: round4(node.mastery - baseline.nodeMastery[node.knowledgeNodeId]),
      }))
      .sort((left, right) => left.delta - right.delta);
    const significantDrops = drops.filter((drop) => drop.delta <= -REGRESSION_DROP);
    signals.push(signal('mastery_change', drops.length > 0, significantDrops.length > 0 ? 'critical' : 'info', {
      direction: significantDrops.length > 0 ? 'down' : drops.length > 0 ? 'mixed' : 'flat',
      biggestDrop: drops[0] ?? null,
      comparedTo: baseline.capturedAt,
    }));
    signals.push(signal('knowledge_regression', significantDrops.length > 0, 'critical', {
      regressedNodes: significantDrops.map((drop) => drop.knowledgeNodeId),
      comparedTo: baseline.capturedAt,
    }));
  }
  const examBaseline = baseline?.exam;
  if (examBaseline && examBaseline.lastScorePercent != null) {
    const score = examBaseline.lastScorePercent;
    signals.push(signal('exam_performance', true, score < 60 ? 'warning' : 'info', { lastScorePercent: score, trend: examBaseline.trend ?? 'flat' }));
  } else {
    signals.push(signal('exam_performance', false, 'info', { reason: 'no_exam_baseline' }));
  }

  return signals;
}

/**
 * Compact brief for prompt injection (bounded).
 */
export function buildSignalBrief(signals: readonly LearningSignal[]): string {
  const active = signals.filter((signal) => signal.present);
  if (active.length === 0) return '无活跃学习信号。';
  return active
    .map((signal) => {
      const evidence = Object.entries(signal.evidence)
        .map(([key, value]) => `${key}=${String(value)}`)
        .join(' ');
      return `${signal.kind}(${signal.severity}): ${evidence}`;
    })
    .join(' | ')
    .slice(0, 900);
}