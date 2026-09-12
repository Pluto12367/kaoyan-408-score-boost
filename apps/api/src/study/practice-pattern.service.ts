import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { resolvePrimaryNodeByQuestion } from './question-node-resolution';
import {
  detectBehaviorSignals,
  type BehaviorSignal,
  type BehaviorSignalInput,
  type PracticeAttemptFact,
} from '@kaoyan408/shared';

/**
 * G1.6 — the one backend read added by G1.
 *
 * It exists because four of the seven behaviour detectors (A repeated familiar
 * questions, B easy-only, C explain-without-submitting, E repeated probe
 * expiry) need attempt-level history that no existing read model exposes.
 * Everything else is derived from data the client already has.
 *
 * ## Boundaries (pinned by test/g1-practice-patterns.test.js)
 *
 *   • READ-ONLY. It never writes; Guidance must not become a second state
 *     system (task §17). There is no guidance table and no guidance master.
 *   • BOUNDED. Every list read carries an explicit `take`; this runs on a 2C2G
 *     box next to the API. Older-than-window history is simply not consulted.
 *   • DELEGATED. All thresholds and all detection live in the shared pure
 *     module (`detectBehaviorSignals`), so the API cannot drift from the UI.
 *   • HONEST ABSENCE. Without `DATABASE_URL` (in-memory/demo mode) it returns
 *     `storeAvailable: false` rather than inventing signals.
 *
 * Node attribution reuses `resolvePrimaryNodeByQuestion`, the V12.1 helper that
 * goes through production's resolver (direct tag → bridge tag → legacy map).
 * Querying `QuestionKnowledgeNodeTag` directly would be blind to every real
 * question in production, which is the exact defect V12.1 fixed.
 */

export interface PracticePatternResult {
  readonly userId: string;
  readonly generatedAt: string;
  readonly storeAvailable: boolean;
  readonly reason?: string;
  readonly windowDays: number;
  readonly signals: BehaviorSignal[];
  /** Echoes the bounded sample so the UI can be honest about its basis. */
  readonly basis: {
    readonly attempts: number;
    readonly sessions: number;
    readonly probeExpired: number;
    readonly probeEvents: number;
    readonly assessments: number;
  };
}

/** Windows and bounds. Kept next to the query so they cannot drift apart. */
export const PRACTICE_PATTERN_WINDOW = {
  windowDays: 14,
  maxAttempts: 400,
  maxSessions: 20,
  maxFeedbackEvents: 50,
  maxSnapshots: 2000,
} as const;

@Injectable()
export class PracticePatternService {
  constructor(private readonly prisma: PrismaService) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL);
  }

  async getPracticePatterns(userId: string, now: Date = new Date()): Promise<PracticePatternResult> {
    const generatedAt = now.toISOString();
    const base: Omit<PracticePatternResult, 'storeAvailable' | 'signals' | 'basis'> = {
      userId,
      generatedAt,
      windowDays: PRACTICE_PATTERN_WINDOW.windowDays,
    };
    if (!this.enabled) {
      return {
        ...base,
        storeAvailable: false,
        reason: 'store_unavailable',
        signals: [],
        basis: { attempts: 0, sessions: 0, probeExpired: 0, probeEvents: 0, assessments: 0 },
      };
    }

    const windowStart = new Date(now.getTime() - PRACTICE_PATTERN_WINDOW.windowDays * 86_400_000);

    const [records, sessions, probeExpired, probeEvents, assessments, feedback, snapshots] = await Promise.all([
      this.prisma.practiceRecord.findMany({
        where: { userId, submittedAt: { gte: windowStart } },
        orderBy: { submittedAt: 'desc' },
        take: PRACTICE_PATTERN_WINDOW.maxAttempts,
        select: { questionId: true, correct: true, submittedAt: true, sessionId: true },
      }),
      this.prisma.learningSession.findMany({
        where: { userId, startedAt: { gte: windowStart } },
        orderBy: { startedAt: 'desc' },
        take: PRACTICE_PATTERN_WINDOW.maxSessions,
        select: { id: true, questionIds: true },
      }),
      this.prisma.recommendationAction.count({
        where: { userId, actionType: 'TRANSFER_PROBE', status: 'EXPIRED' },
      }),
      this.prisma.learningSession.count({ where: { userId, type: 'transfer_probe' } }),
      this.prisma.assessmentHistoryItem.count({ where: { userId } }),
      this.prisma.userEvent.findMany({
        where: { userId, type: 'USER_ACTION_FEEDBACK' },
        orderBy: { createdAt: 'desc' },
        take: PRACTICE_PATTERN_WINDOW.maxFeedbackEvents,
        select: { payload: true },
      }),
      this.prisma.userMasterySnapshot.findMany({
        where: { userId, snapshotDate: { gte: windowStart } },
        orderBy: { snapshotDate: 'asc' },
        take: PRACTICE_PATTERN_WINDOW.maxSnapshots,
        select: { knowledgeNodeId: true, mastery: true, attempts: true },
      }),
    ]);

    const questionIds = [...new Set(records.map((row) => row.questionId))];
    const [questions, earliest] = await Promise.all([
      this.prisma.question.findMany({
        where: { id: { in: questionIds } },
        select: { id: true, difficulty: true },
      }),
      this.prisma.practiceRecord.groupBy({
        by: ['questionId'],
        where: { userId, questionId: { in: questionIds } },
        _min: { submittedAt: true },
      }),
    ]);

    const difficultyByQuestion = new Map(questions.map((row) => [row.id, String(row.difficulty)]));
    const firstSeenAt = new Map(
      earliest.map((row) => [row.questionId, row._min.submittedAt?.getTime() ?? Number.POSITIVE_INFINITY]),
    );
    const nodeByQuestion = await resolvePrimaryNodeByQuestion(this.prisma, questionIds);

    const attempts: PracticeAttemptFact[] = records.map((row) => ({
      questionId: row.questionId,
      nodeId: nodeByQuestion.get(row.questionId)?.nodeId ?? null,
      difficulty: normalizeDifficulty(difficultyByQuestion.get(row.questionId)),
      correct: row.correct,
      submittedAt: row.submittedAt.toISOString(),
      // "First seen inside the window" — the earliest recorded attempt for this
      // student on this question falls within the sampled window.
      firstSeen: (firstSeenAt.get(row.questionId) ?? 0) >= windowStart.getTime(),
    }));

    const submittedBySession = new Map<string, number>();
    for (const row of records) {
      if (!row.sessionId) continue;
      submittedBySession.set(row.sessionId, (submittedBySession.get(row.sessionId) ?? 0) + 1);
    }
    const sessionFacts = sessions.reduce(
      (acc, session) => {
        const total = session.questionIds.length;
        if (total === 0) return acc;
        const submitted = Math.min(total, submittedBySession.get(session.id) ?? 0);
        return {
          count: acc.count + 1,
          totalQuestions: acc.totalQuestions + total,
          abandonedQuestions: acc.abandonedQuestions + (total - submitted),
        };
      },
      { count: 0, totalQuestions: 0, abandonedQuestions: 0 },
    );

    const failuresByKey = new Map<string, number>();
    for (const row of feedback) {
      const payload = row.payload as { signalType?: unknown; targetId?: unknown; actionType?: unknown } | null;
      if (!payload || payload.signalType !== 'NEGATIVE_FEEDBACK') continue;
      if (typeof payload.targetId !== 'string' || typeof payload.actionType !== 'string') continue;
      const key = `${payload.targetId}::${payload.actionType}`;
      failuresByKey.set(key, (failuresByKey.get(key) ?? 0) + 1);
    }
    const failures = [...failuresByKey.entries()].map(([key, count]) => {
      const [nodeId, actionType] = key.split('::');
      return { nodeId, actionType, failures: count };
    });

    const byNode = new Map<string, { first: number; last: number; attempts: number }>();
    for (const row of snapshots) {
      const entry = byNode.get(row.knowledgeNodeId);
      if (!entry) {
        byNode.set(row.knowledgeNodeId, { first: row.mastery, last: row.mastery, attempts: row.attempts });
      } else {
        entry.last = row.mastery;
        entry.attempts = Math.max(entry.attempts, row.attempts);
      }
    }
    const rising = [...byNode.entries()]
      .filter(([, value]) => value.last > value.first)
      .map(([nodeId, value]) => ({ nodeId, attempts: value.attempts }));

    const input: BehaviorSignalInput = {
      asOf: generatedAt,
      windowDays: PRACTICE_PATTERN_WINDOW.windowDays,
      attempts,
      sessions: sessionFacts,
      verification: { probeEvents, probeExpired, assessments },
      recommendations: { failures },
      mastery: { rising, withTransferEvidence: [] },
    };

    return {
      ...base,
      storeAvailable: true,
      signals: detectBehaviorSignals(input),
      basis: {
        attempts: attempts.length,
        sessions: sessionFacts.count,
        probeExpired,
        probeEvents,
        assessments,
      },
    };
  }
}

/**
 * The question bank stores difficulty as a Prisma enum and (historically) as
 * Chinese labels. The shared detector only understands BASIC/MEDIUM/HARD, so the
 * two vocabularies are collapsed here — the same normalization the transfer
 * probe uses (`toDifficultyBucket`), kept local to avoid importing the probe
 * module from an unrelated read path.
 */
function normalizeDifficulty(value: unknown): string {
  const raw = String(value ?? '').toUpperCase();
  if (raw === 'BASIC' || raw === 'EASY' || value === '简单') return 'BASIC';
  if (raw === 'HARD' || value === '困难') return 'HARD';
  return 'MEDIUM';
}
