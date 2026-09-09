/**
 * LE/V11-M4.3 — Learning Outcome Tracking (pure).
 *
 * For a recommendation intervention, compares BEFORE (the 14 days up to its
 * creation) with AFTER (creation → +14 days or now) on the SAME knowledge
 * node: practice accuracy, mastery (snapshot facts), and error reduction
 * (wrong practices before vs after).
 *
 * Verdict rules (honest):
 *   - after-practice < 3 attempts → insufficient_data (window too thin)
 *   - accuracy +10pt and/or mastery +0.1 → improved
 *   - otherwise → no_change (never negative-spin)
 */

export interface OutcomeIntervention {
  readonly actionId: string;
  readonly actionType: string;
  readonly nodeId: string | null;
  readonly createdAt: string;
}

export interface OutcomeAttempt {
  readonly questionId: string;
  readonly submittedAt: string;
  readonly correct: boolean;
  readonly nodeIds: readonly string[];
}

export interface OutcomeMasteryPoint {
  readonly nodeId: string;
  readonly mastery: number;
  readonly at: string;
}

export interface OutcomeTrackingInput {
  readonly intervention: OutcomeIntervention;
  readonly attempts: readonly OutcomeAttempt[];
  readonly masteryPoints: readonly OutcomeMasteryPoint[];
}

export interface OutcomeWindowFact {
  readonly attempts: number;
  readonly correctCount: number;
  readonly accuracyRate: number | null;
  readonly wrongCount: number;
  readonly mastery: number | null;
}

export interface OutcomeTrackingResult {
  readonly actionId: string;
  readonly actionType: string;
  readonly nodeId: string | null;
  readonly before: OutcomeWindowFact;
  readonly after: OutcomeWindowFact;
  readonly errorReduction: { readonly wrongBefore: number; readonly wrongAfter: number; readonly reduced: boolean };
  readonly verdict: 'improved' | 'no_change' | 'insufficient_data';
  readonly basis: string;
  readonly source: 'derived';
}

const OUTCOME_WINDOW_DAYS = 14;
const DAY_MS = 86_400_000;

function accuracyOf(attempts: readonly { correct: boolean }[]): number | null {
  if (attempts.length === 0) return null;
  const correct = attempts.filter((row) => row.correct).length;
  return Math.round((correct / attempts.length) * 100);
}

export function buildOutcomeTracking(input: OutcomeTrackingInput): OutcomeTrackingResult {
  const { intervention } = input;
  const nodeId = intervention.nodeId;
  const createdMs = new Date(intervention.createdAt).getTime();
  const beforeStart = createdMs - OUTCOME_WINDOW_DAYS * DAY_MS;

  const inNode = (attempt: OutcomeAttempt): boolean =>
    nodeId == null || attempt.nodeIds.includes(nodeId);
  const inBefore = (attempt: OutcomeAttempt): boolean => {
    const ms = new Date(attempt.submittedAt).getTime();
    return ms >= beforeStart && ms < createdMs && inNode(attempt);
  };
  const inAfter = (attempt: OutcomeAttempt): boolean => {
    const ms = new Date(attempt.submittedAt).getTime();
    return ms >= createdMs && inNode(attempt);
  };

  const beforeAttempts = input.attempts.filter(inBefore);
  const afterAttempts = input.attempts.filter(inAfter);

  // Mastery: latest snapshot fact per window — the projection never interpolates.
  const latestIn = (fromMs: number, toMs: number): number | null => {
    let latest: number | null = null;
    let latestMs = -1;
    for (const point of input.masteryPoints) {
      if (nodeId != null && point.nodeId !== nodeId) continue;
      const ms = new Date(point.at).getTime();
      if (ms >= fromMs && ms <= toMs && ms > latestMs) {
        latest = point.mastery;
        latestMs = ms;
      }
    }
    return latest;
  };
  const beforeMastery = latestIn(beforeStart, createdMs);
  const afterMastery = latestIn(createdMs, createdMs + OUTCOME_WINDOW_DAYS * DAY_MS);

  const buildFacts = (attempts: readonly OutcomeAttempt[], mastery: number | null): OutcomeWindowFact => ({
    attempts: attempts.length,
    correctCount: attempts.filter((row) => row.correct).length,
    accuracyRate: accuracyOf(attempts),
    wrongCount: attempts.filter((row) => !row.correct).length,
    mastery,
  });

  const before = buildFacts(beforeAttempts, beforeMastery);
  const after = buildFacts(afterAttempts, afterMastery);

  const errorReduction = {
    wrongBefore: before.wrongCount,
    wrongAfter: after.wrongCount,
    reduced: after.wrongCount < before.wrongCount,
  };

  if (after.attempts < 3) {
    return {
      actionId: intervention.actionId,
      actionType: intervention.actionType,
      nodeId,
      before,
      after,
      errorReduction,
      verdict: 'insufficient_data',
      basis: '干预后窗口内练习不足 3 次——样本太薄，不做效果结论。',
      source: 'derived',
    };
  }

  const rateLift = before.accuracyRate != null && after.accuracyRate != null
    ? after.accuracyRate - before.accuracyRate
    : null;
  const masteryLift = before.mastery != null && after.mastery != null
    ? Math.round((after.mastery - before.mastery) * 100) / 100
    : null;

  if ((rateLift != null && rateLift >= 10) || (masteryLift != null && masteryLift >= 0.1)) {
    const parts: string[] = [];
    if (rateLift != null) parts.push(`正确率 ${before.accuracyRate}% → ${after.accuracyRate}%`);
    if (masteryLift != null) parts.push(`掌握度 ${before.mastery} → ${after.mastery}`);
    return {
      actionId: intervention.actionId,
      actionType: intervention.actionType,
      nodeId,
      before,
      after,
      errorReduction,
      verdict: 'improved',
      basis: `干预后见效：${parts.join('；')}。`,
      source: 'derived',
    };
  }

  const ratePart = rateLift != null ? `正确率 ${before.accuracyRate}% → ${after.accuracyRate}%` : '';
  const masteryPart = masteryLift != null ? `掌握度 ${before.mastery} → ${after.mastery}` : '';
  return {
    actionId: intervention.actionId,
    actionType: intervention.actionType,
    nodeId,
    before,
    after,
    errorReduction,
    verdict: 'no_change',
    basis: `未见统计意义的变化：${[ratePart, masteryPart].filter(Boolean).join('；') || '两个窗口数据不足'}。`,
    source: 'derived',
  };
}
