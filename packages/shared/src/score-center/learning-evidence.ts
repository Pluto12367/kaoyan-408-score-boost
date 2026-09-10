/**
 * V12-M1 — Learning Evidence Foundation (pure module).
 *
 * ## Why this module exists
 *
 * V12-0 audit found two broken links (EB-1 / EB-2): the system recorded that a
 * student *completed a task* and that a student *marked a question reviewed*,
 * but neither action produced anything that could support an inference about
 * ability. The activity was logged; the learning was not.
 *
 * The root cause was a missing distinction. This module draws it explicitly:
 *
 *   ACTIVITY  — something happened.      e.g. task.completed, review.marked
 *   EVIDENCE  — something was OBSERVED.   e.g. 4/5 correct, redo failed
 *   ABILITY   — what we infer (mastery).  NOT computed here.
 *
 * An activity marker is never evidence. A self-report is evidence but weak. Only
 * an objective observation may claim to influence mastery — and even then this
 * module does not write mastery; the single writer remains
 * `ScoreCenterService.applyAttempts/applyReview`.
 *
 * ## Contract
 *
 * Pure: zero imports, no clock, no randomness, deterministic. All IO belongs to
 * the service layer. `null` means "not observed" and is never rendered as 0.
 */

export type LearningActionType =
  | 'practice.answered'
  | 'task.completed'
  | 'review.marked'
  | 'review.recalled'
  | 'assessment.submitted';

/**
 * `none`      — activity only; no observation of performance exists.
 * `self_reported` — the student declared numbers; unverified.
 * `recall_outcome` — a recall/redo was observed and graded.
 * `objective_performance` — graded attempts were observed.
 */
export type EvidenceKind = 'none' | 'self_reported' | 'recall_outcome' | 'objective_performance';

export type EvidenceStrength = 'none' | 'weak' | 'strong';

export interface LearningActionFacts {
  readonly action: LearningActionType;
  /** Graded attempts actually observed in the source-of-truth tables. */
  readonly observedAttempts?: number;
  readonly observedCorrectCount?: number;
  /** Numbers the student typed in; unverified by construction. */
  readonly selfReportedQuestionCount?: number | null;
  readonly selfReportedCorrectCount?: number | null;
  /** Whether a recall/redo outcome was actually observed. */
  readonly recallObserved?: boolean;
  readonly recallCorrect?: boolean;
  readonly minutesSpent?: number | null;
  readonly selfRating?: number | null;
}

export interface LearningActionVerdict {
  readonly action: LearningActionType;
  readonly kind: EvidenceKind;
  readonly strength: EvidenceStrength;
  readonly isActivity: true;
  readonly isEvidence: boolean;
  readonly canInfluenceMastery: boolean;
  readonly basis: string;
}

export interface LearningEvidenceMetrics {
  readonly attempts: number | null;
  readonly correctCount: number | null;
  /** Integer percent, only when an observation exists. */
  readonly accuracyRate: number | null;
  readonly minutesSpent: number | null;
  readonly selfRating: number | null;
  readonly selfReported: boolean;
}

export interface LearningEvidenceRecord {
  readonly id: string;
  readonly userId: string;
  readonly action: LearningActionType;
  readonly kind: EvidenceKind;
  readonly strength: EvidenceStrength;
  readonly canInfluenceMastery: boolean;
  readonly basis: string;
  readonly metrics: LearningEvidenceMetrics;
  readonly sourceId: string | null;
  readonly actionId: string | null;
  readonly recordedAt: string;
  readonly source: 'derived';
}

export interface LearningEvidenceSummary {
  readonly total: number;
  readonly strong: number;
  readonly weak: number;
  readonly none: number;
  readonly abilityEvidenceCount: number;
  readonly hasAbilityEvidence: boolean;
  readonly basis: string;
}

export interface LearningEvidenceInput extends LearningActionFacts {
  readonly userId: string;
  readonly sourceId?: string | null;
  readonly actionId?: string | null;
  readonly recordedAt: string;
  /** Distinguishes repeated occurrences of the same action on the same source. */
  readonly scope?: string | null;
}

/**
 * The published taxonomy. Exported so docs, endpoints and UI can render the
 * same rules the engine applies instead of re-describing them (which is how
 * the two mastery口径 drifted apart in the first place).
 */
export const LEARNING_ACTION_TAXONOMY: readonly LearningActionVerdict[] = [
  {
    action: 'practice.answered',
    kind: 'objective_performance',
    strength: 'strong',
    isActivity: true,
    isEvidence: true,
    canInfluenceMastery: true,
    basis: '已判分的练习事实是可观测表现，构成强证据，可支撑能力推断。',
  },
  {
    action: 'task.completed',
    kind: 'self_reported',
    strength: 'weak',
    isActivity: true,
    isEvidence: true,
    canInfluenceMastery: false,
    basis: '自评题量/对错未经系统观测，仅作弱证据；不构成能力判定。',
  },
  {
    action: 'review.marked',
    kind: 'none',
    strength: 'none',
    isActivity: true,
    isEvidence: false,
    canInfluenceMastery: false,
    basis: '“标记已复习”只表明动作发生，未观测回忆结果，不构成学习证据。',
  },
  {
    action: 'review.recalled',
    kind: 'recall_outcome',
    strength: 'strong',
    isActivity: true,
    isEvidence: true,
    canInfluenceMastery: true,
    basis: '已观测的重做/回忆结果构成强证据，可支撑保持度与能力推断。',
  },
  {
    action: 'assessment.submitted',
    kind: 'objective_performance',
    strength: 'strong',
    isActivity: true,
    isEvidence: true,
    canInfluenceMastery: true,
    basis: '测评产生的已判分作答是可观测表现，构成强证据。',
  },
] as const;

/** The activity-only baseline: no observation has been made yet. */
const ACTIVITY_ONLY_BASIS = '完成标记≠学习发生：该动作只证明行为发生，未观测任何表现，不构成学习证据。';

export function classifyLearningAction(facts: LearningActionFacts): LearningActionVerdict {
  const observedAttempts = normalizeCount(facts.observedAttempts);

  if (facts.action === 'review.recalled') {
    if (facts.recallObserved === true) {
      return verdictFor(facts.action, 'recall_outcome', 'strong', true);
    }
    return {
      action: facts.action,
      kind: 'none',
      strength: 'none',
      isActivity: true,
      isEvidence: false,
      canInfluenceMastery: false,
      basis: '复习记录了结果声明，但未观测到实际重做结果，不构成学习证据。',
    };
  }

  if (observedAttempts > 0) {
    return verdictFor(facts.action, 'objective_performance', 'strong', true);
  }

  if (facts.action === 'practice.answered' || facts.action === 'assessment.submitted') {
    return {
      action: facts.action,
      kind: 'none',
      strength: 'none',
      isActivity: true,
      isEvidence: false,
      canInfluenceMastery: false,
      basis: '该动作登记了作答，但没有任何已判分的观测事实，不构成学习证据。',
    };
  }

  if (facts.action === 'review.marked') {
    return {
      action: facts.action,
      kind: 'none',
      strength: 'none',
      isActivity: true,
      isEvidence: false,
      canInfluenceMastery: false,
      basis: '“标记已复习”只表明动作发生，未观测回忆结果，不构成学习证据。',
    };
  }

  // task.completed — the completion marker is the canonical activity case.
  const selfReported = hasSelfReport(facts);
  if (selfReported) {
    return verdictFor('task.completed', 'self_reported', 'weak', false);
  }
  return {
    action: 'task.completed',
    kind: 'none',
    strength: 'none',
    isActivity: true,
    isEvidence: false,
    canInfluenceMastery: false,
    basis: ACTIVITY_ONLY_BASIS,
  };
}

export function buildLearningEvidence(input: LearningEvidenceInput): LearningEvidenceRecord {
  const verdict = classifyLearningAction(input);
  const observedAttempts = normalizeCount(input.observedAttempts);
  const observedCorrect = normalizeCount(input.observedCorrectCount, observedAttempts);
  const selfReported = hasSelfReport(input);

  // Honest numbers: observed facts win; self-report is used only when nothing
  // was observed, and is flagged so downstream consumers can weigh it.
  const useObserved = observedAttempts > 0;
  const attempts = useObserved
    ? observedAttempts
    : selfReported
      ? normalizeCount(input.selfReportedQuestionCount)
      : null;
  const correctCount = useObserved
    ? observedCorrect
    : selfReported
      ? normalizeCount(input.selfReportedCorrectCount, attempts ?? 0)
      : null;

  const accuracyRate =
    attempts != null && attempts > 0 && correctCount != null
      ? Math.round((correctCount / attempts) * 100)
      : null;

  return {
    id: learningEvidenceKey({
      userId: input.userId,
      action: input.action,
      sourceId: input.sourceId ?? null,
      scope: input.scope ?? undefined,
    }),
    userId: input.userId,
    action: input.action,
    kind: verdict.kind,
    strength: verdict.strength,
    canInfluenceMastery: verdict.canInfluenceMastery,
    basis: verdict.basis,
    metrics: {
      attempts,
      correctCount,
      accuracyRate,
      minutesSpent: normalizeOptionalNumber(input.minutesSpent),
      selfRating: normalizeOptionalNumber(input.selfRating),
      selfReported: !useObserved && selfReported,
    },
    sourceId: input.sourceId ?? null,
    actionId: input.actionId ?? null,
    recordedAt: input.recordedAt,
    source: 'derived',
  };
}

export function learningEvidenceKey(input: {
  readonly userId: string;
  readonly action: LearningActionType;
  readonly sourceId?: string | null;
  /** Distinguishes repeated occurrences of the same action on the same source. */
  readonly scope?: string | null;
}): string {
  const source = input.sourceId ?? 'none';
  const scope = input.scope ? `:${input.scope}` : '';
  return `LEARNING_EVIDENCE:${input.userId}:${input.action}:${source}${scope}`;
}

export function summarizeLearningEvidence(
  records: readonly LearningEvidenceRecord[],
): LearningEvidenceSummary {
  const strong = records.filter((row) => row.strength === 'strong').length;
  const weak = records.filter((row) => row.strength === 'weak').length;
  const none = records.filter((row) => row.strength === 'none').length;
  const abilityEvidenceCount = records.filter((row) => row.canInfluenceMastery).length;
  const hasAbilityEvidence = abilityEvidenceCount > 0;

  const basis = records.length === 0
    ? '尚无学习证据记录：系统不会在缺少证据时给出能力判断。'
    : hasAbilityEvidence
      ? `共 ${records.length} 条证据，其中 ${abilityEvidenceCount} 条为可支撑能力推断的观测证据。`
      : `共 ${records.length} 条记录，但没有可支撑能力推断的观测证据（强证据 0 条）——系统拒绝据此判断能力变化。`;

  return {
    total: records.length,
    strong,
    weak,
    none,
    abilityEvidenceCount,
    hasAbilityEvidence,
    basis,
  };
}

function verdictFor(
  action: LearningActionType,
  kind: EvidenceKind,
  strength: EvidenceStrength,
  canInfluenceMastery: boolean,
): LearningActionVerdict {
  const published = LEARNING_ACTION_TAXONOMY.find((row) => row.action === action && row.kind === kind);
  const basis = published
    ? published.basis
    : '该动作产生了可观测表现，构成学习证据。';
  return {
    action,
    kind,
    strength,
    isActivity: true,
    isEvidence: strength !== 'none',
    canInfluenceMastery,
    basis,
  };
}

function hasSelfReport(facts: LearningActionFacts): boolean {
  return normalizeCount(facts.selfReportedQuestionCount) > 0
    || normalizeCount(facts.selfReportedCorrectCount) > 0;
}

function normalizeCount(value: number | null | undefined, cap?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  const floored = Math.floor(value);
  return cap != null ? Math.min(floored, cap) : floored;
}

function normalizeOptionalNumber(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}
