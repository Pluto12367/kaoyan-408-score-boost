/**
 * S2 Transfer Probe — pure domain primitives.
 *
 * Formal design: docs/s2-transfer-probe-formal-design.md
 *
 * S2 answers one question the system has never been able to answer:
 *   "does practice performance on a node TRANSFER to a never-seen
 *    isomorphic question?"
 *
 * Ownership discipline (C1-C4, frozen):
 *   • probe identity   = RecommendationAction(actionType='TRANSFER_PROBE') + 1:1 StudyTask
 *   • probe attempts   = PracticeRecord via LearningSession(type='transfer_probe')
 *   • probe evidence   = EVIDENCE_RECORDED with detail.kind='transfer_probe'
 *   • measurement      = the read-only projection in THIS module
 * No new SoT anywhere; no mastery writer here; no ranking consumer here.
 *
 * Pure: deterministic; timezone-aware day keys mirror the API's studyDateKey
 * default (Asia/Shanghai) so scheduledDate strings agree across the system.
 */

export const TRANSFER_PROBE_ACTION_TYPE = 'TRANSFER_PROBE';
export const TRANSFER_PROBE_PLAN_SOURCE = 'transfer-probe';
export const TRANSFER_PROBE_SESSION_TYPE = 'transfer_probe';
export const TRANSFER_PROBE_POOL_SOURCE = 'transfer_probe_pool';
export const TRANSFER_PROBE_EVIDENCE_KIND = 'transfer_probe';
export const TRANSFER_PROBE_TASK_MODE = '复测';
export const TRANSFER_PROBE_REASON = '迁移复测：检验学习是否迁移到未见过的新题';

/** Preregistered windows (formal design §8). Day granularity is the C2 cost. */
export const TRANSFER_PROBE_WINDOWS = {
  targetDaysAfter: 2,
  minElapsedHours: 36,
  graceDays: 7,
  maxDeliveriesPerDay: 3,
  minDaysBetweenProbesPerNode: 14,
  interventionWindowDays: 3,
} as const;

/** Preregistered gate (formal design §12) — sample-size bands, never prediction quality. */
export const TRANSFER_PROBE_GATE = {
  minSampleSize: 5,
  mediumSampleSize: 20,
  highSampleSize: 50,
} as const;

export type DifficultyBucket = 'BASIC' | 'MEDIUM' | 'HARD';
export type ProbeKind = 'practice_difficulty' | 'exam_difficulty';
export type IsomorphismLevel = 'verified' | 'unverified';
export type TransferSampleConfidence = 'low' | 'medium' | 'high';

const DIFFICULTY_BUCKETS: readonly string[] = ['BASIC', 'MEDIUM', 'HARD'];

/** The question bank stores difficulty in two vocabularies (Prisma enum and
 * the legacy Chinese labels); probes normalize to the bucket enum. */
const DIFFICULTY_TO_BUCKET: Readonly<Record<string, DifficultyBucket>> = {
  BASIC: 'BASIC', MEDIUM: 'MEDIUM', HARD: 'HARD',
  简单: 'BASIC', 中等: 'MEDIUM', 困难: 'HARD',
};

export function toDifficultyBucket(value: string): DifficultyBucket {
  return DIFFICULTY_TO_BUCKET[value] ?? 'MEDIUM';
}

function probeDayKey(iso: string, timeZone = 'Asia/Shanghai'): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error('invalid probe date');
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) throw new Error('invalid probe date');
  return `${year}-${month}-${day}`;
}

function shiftDayKey(dayKey: string, days: number): string {
  const date = new Date(`${dayKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Schedule windows
// ---------------------------------------------------------------------------

export interface ProbeScheduleFacts {
  /** D+2, the StudyTask.scheduledDate for the probe task. */
  readonly scheduledDate: string;
  /** scheduledDate + graceDays — after this the probe expires honestly. */
  readonly expireDate: string;
  readonly elapsedHours: number;
  readonly canDeliverNow: boolean;
  readonly withinGrace: boolean;
  readonly isExpired: boolean;
}

export function deriveProbeScheduleFacts(
  interventionCompletedAtISO: string,
  nowISO: string,
): ProbeScheduleFacts {
  const completed = new Date(interventionCompletedAtISO).getTime();
  const now = new Date(nowISO).getTime();
  if (Number.isNaN(completed) || Number.isNaN(now)) throw new Error('invalid probe schedule date');
  const elapsedHours = Math.max(0, (now - completed) / 3_600_000);
  const completedDay = probeDayKey(interventionCompletedAtISO);
  const scheduledDate = shiftDayKey(completedDay, TRANSFER_PROBE_WINDOWS.targetDaysAfter);
  const expireDate = shiftDayKey(scheduledDate, TRANSFER_PROBE_WINDOWS.graceDays);
  const nowDay = probeDayKey(nowISO);
  const dueDateReached = nowDay >= scheduledDate;
  const canDeliverNow = dueDateReached && elapsedHours >= TRANSFER_PROBE_WINDOWS.minElapsedHours;
  return {
    scheduledDate,
    expireDate,
    elapsedHours: Math.round(elapsedHours * 10) / 10,
    canDeliverNow,
    withinGrace: nowDay <= expireDate,
    isExpired: nowDay > expireDate,
  };
}

export function deriveProbeCreationKey(userId: string, nodeId: string, scheduledDate: string): string {
  return `TRANSFER_PROBE:${userId}:${nodeId}:${scheduledDate}`;
}

// ---------------------------------------------------------------------------
// Eligibility — every unprovable condition is a hard reject (no fallback)
// ---------------------------------------------------------------------------

export interface ProbeEligibilityFacts {
  /** Question.source === TRANSFER_PROBE_POOL_SOURCE (content-audited pool). */
  readonly inPool: boolean;
  /** PracticeRecord ∪ ReviewAttempt history for (student, question). */
  readonly hasPriorAttempt: boolean;
  /** LearningSession.questionIds exposure for (student, question), incl. unsubmitted. */
  readonly hasPriorExposure: boolean;
  /** Any attempt/exposure on the candidate's question FAMILY for this student. */
  readonly sameFamilySeen: boolean;
  /** A prior transfer-probe evidence event used this question for this student. */
  readonly previouslyUsedAsProbe: boolean;
  /** Candidate difficulty === target probe bucket. */
  readonly bucketMatch: boolean;
  /** Candidate type ∈ intervention question types. */
  readonly typeMatch: boolean;
}

export type ProbeEligibilityReject =
  | 'not_in_pool'
  | 'prior_attempt'
  | 'prior_exposure'
  | 'same_family_seen'
  | 'previously_used_as_probe'
  | 'difficulty_mismatch'
  | 'type_mismatch';

export type ProbeEligibilityVerdict =
  | { readonly eligible: true; readonly reject: null }
  | { readonly eligible: false; readonly reject: ProbeEligibilityReject };

export function evaluateProbeEligibility(facts: ProbeEligibilityFacts): ProbeEligibilityVerdict {
  if (!facts.inPool) return { eligible: false, reject: 'not_in_pool' };
  if (facts.hasPriorAttempt) return { eligible: false, reject: 'prior_attempt' };
  if (facts.hasPriorExposure) return { eligible: false, reject: 'prior_exposure' };
  if (facts.sameFamilySeen) return { eligible: false, reject: 'same_family_seen' };
  if (facts.previouslyUsedAsProbe) return { eligible: false, reject: 'previously_used_as_probe' };
  if (!facts.bucketMatch) return { eligible: false, reject: 'difficulty_mismatch' };
  if (!facts.typeMatch) return { eligible: false, reject: 'type_mismatch' };
  return { eligible: true, reject: null };
}

// ---------------------------------------------------------------------------
// Transfer measurement projection
// ---------------------------------------------------------------------------

export interface TransferProbeEventFact {
  readonly key: string;
  readonly nodeId: string;
  readonly kind: ProbeKind;
  readonly bucket: DifficultyBucket;
  readonly isomorphism: IsomorphismLevel;
  readonly attempts: number;
  readonly correct: number;
  /** Data-quality invalidation: excluded from strata entirely (kept for audit). */
  readonly invalidated?: boolean;
}

export interface TransferPracticeAccuracyFact {
  readonly nodeId: string;
  readonly attempts: number;
  readonly correct: number;
}

export interface TransferProjectionRow {
  readonly nodeId: string;
  readonly kind: ProbeKind;
  readonly bucket: DifficultyBucket;
  readonly isomorphism: IsomorphismLevel;
  readonly probeAttempts: number;
  readonly probeCorrect: number;
  /** null when the gate is not met — honest absence, never zero. */
  readonly transferRate: number | null;
  readonly practiceAttempts: number;
  readonly practiceCorrect: number;
  readonly practiceAccuracy: number | null;
  /** transfer − practice, in percentage points; negative = transfer decay. */
  readonly transferGap: number | null;
  readonly sampleConfidence: TransferSampleConfidence | null;
  readonly gate: 'insufficient_data' | 'reported';
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function ratePercent(correct: number, attempts: number): number {
  return attempts > 0 ? round1((correct / attempts) * 100) : 0;
}

/**
 * Stratified transfer projection. Strata are keyed by
 * (node, kind, bucket, isomorphism) and are NEVER merged — the verified
 * stratum carries the primary conclusion; the unverified stratum is
 * diagnostic only. Observations flagged invalidated are excluded entirely.
 */
export function buildTransferProjection(
  events: readonly TransferProbeEventFact[],
  practiceAccuracyByNode: Readonly<Record<string, TransferPracticeAccuracyFact>>,
): TransferProjectionRow[] {
  const strata = new Map<string, {
    nodeId: string; kind: ProbeKind; bucket: DifficultyBucket; isomorphism: IsomorphismLevel;
    attempts: number; correct: number;
  }>();
  for (const event of events) {
    if (event.invalidated) continue;
    if (!DIFFICULTY_BUCKETS.includes(event.bucket)) continue;
    const key = `${event.nodeId}|${event.kind}|${event.bucket}|${event.isomorphism}`;
    const stratum = strata.get(key) ?? {
      nodeId: event.nodeId, kind: event.kind, bucket: event.bucket, isomorphism: event.isomorphism,
      attempts: 0, correct: 0,
    };
    stratum.attempts += event.attempts;
    stratum.correct += event.correct;
    strata.set(key, stratum);
  }

  const rows: TransferProjectionRow[] = [];
  for (const stratum of strata.values()) {
    const gateMet = stratum.attempts >= TRANSFER_PROBE_GATE.minSampleSize;
    const transferRate = gateMet ? ratePercent(stratum.correct, stratum.attempts) : null;
    const practice = practiceAccuracyByNode[stratum.nodeId];
    const practiceAccuracy = practice && practice.attempts > 0
      ? ratePercent(practice.correct, practice.attempts)
      : null;
    const sampleConfidence: TransferSampleConfidence | null = !gateMet
      ? null
      : stratum.attempts >= TRANSFER_PROBE_GATE.highSampleSize
        ? 'high'
        : stratum.attempts >= TRANSFER_PROBE_GATE.mediumSampleSize
          ? 'medium'
          : 'low';
    const transferGap = transferRate != null && practiceAccuracy != null
      ? round1(transferRate - practiceAccuracy)
      : null;
    rows.push({
      nodeId: stratum.nodeId,
      kind: stratum.kind,
      bucket: stratum.bucket,
      isomorphism: stratum.isomorphism,
      probeAttempts: stratum.attempts,
      probeCorrect: stratum.correct,
      transferRate,
      practiceAttempts: practice?.attempts ?? 0,
      practiceCorrect: practice?.correct ?? 0,
      practiceAccuracy,
      transferGap,
      sampleConfidence,
      gate: gateMet ? 'reported' : 'insufficient_data',
    });
  }
  return rows.sort((left, right) =>
    left.nodeId.localeCompare(right.nodeId)
    || left.kind.localeCompare(right.kind)
    || left.bucket.localeCompare(right.bucket)
    || left.isomorphism.localeCompare(right.isomorphism));
}
