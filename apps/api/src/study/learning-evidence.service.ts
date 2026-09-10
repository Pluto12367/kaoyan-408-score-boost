/**
 * V12-M1 — Learning Evidence Service.
 *
 * Owns all IO for the learning-evidence layer:
 *   • records evidence for actions that previously produced none (EB-1 / EB-2)
 *   • persists it through the canonical event writer (idempotent, append-only,
 *     zero migration — see docs/v12-m1-evidence-foundation.md for why)
 *   • answers "what evidence exists for this student" honestly
 *
 * Hard boundaries (enforced by test/v12-evidence-boundary.test.js):
 *   • never writes UserKnowledgeMastery — the single writer is still
 *     ScoreCenterService.applyAttempts/applyReview
 *   • never fabricates a number: a missing observation stays null
 *   • a completion marker or a "reviewed" tick is activity, not ability
 */

import { Injectable, Optional } from '@nestjs/common';
import {
  buildLearningEvidence,
  summarizeLearningEvidence,
  learningEvidenceKey,
  type LearningEvidenceRecord,
  type LearningEvidenceSummary,
  type LearningActionType,
  type EvidenceKind,
  type EvidenceStrength,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CanonicalEventWriterService } from './canonical-event-writer.service';
import { UserEventRepository } from './user-event.repository';

/** The canonical event type that carries an evidence record. */
export const LEARNING_EVIDENCE_EVENT_TYPE = 'EVIDENCE_RECORDED';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;
/** Window around task completion in which practice counts as its outcome. */
const TASK_OUTCOME_WINDOW_MS = 3 * 86_400_000;
const MAX_OBSERVED_ROWS = 200;

export interface LearningEvidenceListResult {
  readonly generatedAt: string;
  readonly records: LearningEvidenceRecord[];
  readonly summary: LearningEvidenceSummary;
}

export interface TaskCompletionEvidenceResult {
  /** What the student reported (weak at best; a completion marker alone is none). */
  readonly selfReported: LearningEvidenceRecord;
  /**
   * Objective observations the system made on the task's own content around
   * completion — the only thing that may support an ability claim. null when
   * nothing was observed (honest absence, never a zero).
   */
  readonly observed: LearningEvidenceRecord | null;
}

@Injectable()
export class LearningEvidenceService {
  constructor(
    @Optional() private readonly canonicalEvents?: CanonicalEventWriterService,
    @Optional() private readonly userEvents?: UserEventRepository,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  get enabled(): boolean {
    return Boolean(this.canonicalEvents && this.userEvents?.enabled);
  }

  /**
   * EB-1 — a completed task now yields evidence.
   *
   * Only numbers the student actually supplied are recorded; when the student
   * reported nothing, the evidence says so rather than assuming a value.
   */
  async recordTaskCompletion(
    userId: string,
    input: {
      taskId: string;
      completedDate: string;
      completedQuestionCount?: number | null;
      correctCount?: number | null;
      minutesSpent?: number | null;
      selfRating?: number | null;
    },
  ): Promise<LearningEvidenceRecord> {
    return this.record(
      {
        userId,
        action: 'task.completed',
        sourceId: input.taskId,
        recordedAt: new Date().toISOString(),
        scope: input.completedDate,
        selfReportedQuestionCount: normalize(input.completedQuestionCount),
        selfReportedCorrectCount: normalize(input.correctCount),
        minutesSpent: normalize(input.minutesSpent),
        selfRating: normalize(input.selfRating),
      },
      input.completedDate,
    );
  }

  /**
   * EB-2 — "marked as reviewed" now yields evidence too.
   *
   * It yields *activity* evidence: the tick is recorded and auditable, but the
   * service states plainly that no recall was observed, so nothing here may be
   * used to claim ability. Unifying this with the mastery write path is V12-M3
   * and requires owner approval (it changes production write semantics).
   */
  async recordReviewMarked(
    userId: string,
    input: { questionId: string; reviewedAt: string; scope?: string },
  ): Promise<LearningEvidenceRecord> {
    const scope = input.scope ?? input.reviewedAt.slice(0, 10);
    return this.record(
      {
        userId,
        action: 'review.marked',
        sourceId: input.questionId,
        recordedAt: input.reviewedAt,
        scope,
      },
      scope,
    );
  }

  /** A review whose redo/recall outcome was actually observed. */
  async recordReviewRecall(
    userId: string,
    input: {
      questionId: string;
      redoCorrect: boolean;
      timeSpentSec?: number | null;
      recordedAt: string;
      scope?: string;
      actionId?: string | null;
    },
  ): Promise<LearningEvidenceRecord> {
    const scope = input.scope ?? input.recordedAt.slice(0, 10);
    return this.record(
      {
        userId,
        action: 'review.recalled',
        sourceId: input.questionId,
        actionId: input.actionId ?? null,
        recordedAt: input.recordedAt,
        scope,
        recallObserved: true,
        recallCorrect: input.redoCorrect,
        minutesSpent:
          typeof input.timeSpentSec === 'number' && Number.isFinite(input.timeSpentSec)
            ? Math.round((input.timeSpentSec / 60) * 100) / 100
            : null,
      },
      scope,
    );
  }

  /** Graded practice/assessment attempts observed in the source-of-truth tables. */
  async recordObservedPerformance(
    userId: string,
    input: {
      action: Extract<LearningActionType, 'practice.answered' | 'assessment.submitted'>;
      sourceId: string;
      observedAttempts: number;
      observedCorrectCount: number;
      recordedAt: string;
      scope?: string;
      actionId?: string | null;
      /** Structured detail carried verbatim (e.g. a rubric-scored breakdown). */
      detail?: Readonly<Record<string, unknown>> | null;
    },
  ): Promise<LearningEvidenceRecord> {
    const scope = input.scope ?? input.recordedAt.slice(0, 10);
    return this.record(
      {
        userId,
        action: input.action,
        sourceId: input.sourceId,
        actionId: input.actionId ?? null,
        recordedAt: input.recordedAt,
        scope,
        observedAttempts: input.observedAttempts,
        observedCorrectCount: input.observedCorrectCount,
        detail: input.detail ?? null,
      },
      scope,
    );
  }

  /**
   * EB-1 — a completed task now yields evidence, in two honest parts:
   *
   *  1. the completion marker plus whatever the student reported (never strong);
   *  2. any graded practice the system actually OBSERVED on the task's own
   *     knowledge nodes around the completion moment — this is the only part
   *     that can support an ability claim, and it is recorded as such.
   *
   * When nothing was observed, part 2 is null: the absence is the finding.
   */
  async recordTaskCompletionEvidence(
    userId: string,
    input: {
      taskId: string;
      completedDate: string;
      completedQuestionCount?: number | null;
      correctCount?: number | null;
      minutesSpent?: number | null;
      selfRating?: number | null;
      completedAt?: string | null;
    },
  ): Promise<TaskCompletionEvidenceResult> {
    const selfReported = await this.recordTaskCompletion(userId, input);
    const observed = await this.recordTaskOutcomeIfObserved(userId, input);
    return { selfReported, observed };
  }

  /**
   * Look for objective observations on the completed task's content. This is a
   * read of the practice source of truth; it never writes mastery.
   */
  private async recordTaskOutcomeIfObserved(
    userId: string,
    input: { taskId: string; completedDate: string; completedAt?: string | null },
  ): Promise<LearningEvidenceRecord | null> {
    try {
      if (!this.prisma || !this.canonicalEvents) return null;
      const task = await this.prisma.studyTask.findUnique({
        where: { id: input.taskId },
        select: { knowledgeNodeId: true, knowledgePointId: true },
      });
      if (!task) return null;

      const nodeIds = [task.knowledgeNodeId].filter((id): id is string => Boolean(id));
      const questionIds = await this.resolveTaskQuestionIds(nodeIds, task.knowledgePointId);
      if (questionIds.length === 0) return null;

      const anchor = input.completedAt ? new Date(input.completedAt) : new Date();
      const rows = await this.prisma.practiceRecord.findMany({
        where: {
          userId,
          questionId: { in: questionIds },
          submittedAt: {
            gte: new Date(anchor.getTime() - TASK_OUTCOME_WINDOW_MS).toISOString(),
            lte: new Date(anchor.getTime() + TASK_OUTCOME_WINDOW_MS).toISOString(),
          },
        },
        select: { correct: true },
        take: MAX_OBSERVED_ROWS,
      });
      if (rows.length === 0) return null;

      return await this.recordObservedPerformance(userId, {
        action: 'practice.answered',
        sourceId: input.taskId,
        observedAttempts: rows.length,
        observedCorrectCount: rows.filter((row) => row.correct).length,
        recordedAt: anchor.toISOString(),
        scope: input.completedDate,
      });
    } catch {
      // Observed-outcome lookup is best-effort: if it fails we still keep the
      // recorded self-report, and the absence stays visible as no strong
      // evidence rather than being invented.
      return null;
    }
  }

  private async resolveTaskQuestionIds(
    nodeIds: readonly string[],
    knowledgePointId: string | null,
  ): Promise<string[]> {
    const db = this.prisma!;
    if (nodeIds.length > 0) {
      const tags = await db.questionKnowledgeNodeTag.findMany({
        where: { knowledgeNodeId: { in: [...nodeIds] } },
        select: { questionId: true },
      });
      const ids = [...new Set(tags.map((row) => row.questionId))];
      if (ids.length > 0) return ids.slice(0, MAX_OBSERVED_ROWS);
    }
    if (!knowledgePointId) return [];
    const links = await db.questionKnowledgePoint.findMany({
      where: { knowledgePointId },
      select: { questionId: true },
      take: MAX_OBSERVED_ROWS,
    });
    return [...new Set(links.map((row) => row.questionId))];
  }

  /** null = store unavailable (honestly absent, never an empty success). */
  async list(
    userId: string,
    options: { limit?: number } = {},
  ): Promise<LearningEvidenceListResult | null> {
    if (!this.enabled) return null;
    const limit = clampLimit(options.limit);
    const rows = await this.userEvents!.listByType(userId, LEARNING_EVIDENCE_EVENT_TYPE, limit);
    const records = rows
      .map((row) => toEvidenceRecord(userId, row.payload))
      .filter((row): row is LearningEvidenceRecord => row != null);
    return {
      generatedAt: new Date().toISOString(),
      records,
      summary: summarizeLearningEvidence(records),
    };
  }

  private async record(
    input: Parameters<typeof buildLearningEvidence>[0],
    scope: string,
  ): Promise<LearningEvidenceRecord> {
    const record = buildLearningEvidence(input);
    const eventKey = learningEvidenceKey({
      userId: record.userId,
      action: record.action,
      sourceId: record.sourceId,
      scope,
    });
    const stored = await this.canonicalEvents?.recordCanonicalEvent({
      userId: record.userId,
      type: LEARNING_EVIDENCE_EVENT_TYPE,
      eventKey,
      payload: { ...record, id: eventKey },
    });
    // When the store is unavailable the record is still returned so callers can
    // render the honest verdict; durability is what is missing, not the meaning.
    void stored;
    return { ...record, id: eventKey };
  }
}

function normalize(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

function clampLimit(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return DEFAULT_LIST_LIMIT;
  return Math.min(Math.floor(value), MAX_LIST_LIMIT);
}

const KNOWN_ACTIONS: readonly LearningActionType[] = [
  'practice.answered',
  'task.completed',
  'review.marked',
  'review.recalled',
  'assessment.submitted',
];
const KNOWN_KINDS: readonly EvidenceKind[] = [
  'none',
  'self_reported',
  'recall_outcome',
  'objective_performance',
];
const KNOWN_STRENGTHS: readonly EvidenceStrength[] = ['none', 'weak', 'strong'];

/** Defensive decode: anything unrecognisable is skipped, never guessed at. */
function toEvidenceRecord(userId: string, payload: unknown): LearningEvidenceRecord | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const row = payload as Record<string, unknown>;
  const action = row.action;
  const kind = row.kind;
  const strength = row.strength;
  if (typeof action !== 'string' || !KNOWN_ACTIONS.includes(action as LearningActionType)) return null;
  if (typeof kind !== 'string' || !KNOWN_KINDS.includes(kind as EvidenceKind)) return null;
  if (typeof strength !== 'string' || !KNOWN_STRENGTHS.includes(strength as EvidenceStrength)) {
    return null;
  }
  const metrics = (row.metrics ?? {}) as Record<string, unknown>;
  return {
    id: typeof row.id === 'string' ? row.id : '',
    userId,
    action: action as LearningActionType,
    kind: kind as EvidenceKind,
    strength: strength as EvidenceStrength,
    canInfluenceMastery: row.canInfluenceMastery === true,
    basis: typeof row.basis === 'string' ? row.basis : '',
    metrics: {
      attempts: numberOrNull(metrics.attempts),
      correctCount: numberOrNull(metrics.correctCount),
      accuracyRate: numberOrNull(metrics.accuracyRate),
      minutesSpent: numberOrNull(metrics.minutesSpent),
      selfRating: numberOrNull(metrics.selfRating),
      selfReported: metrics.selfReported === true,
    },
    sourceId: typeof row.sourceId === 'string' ? row.sourceId : null,
    actionId: typeof row.actionId === 'string' ? row.actionId : null,
    recordedAt: typeof row.recordedAt === 'string' ? row.recordedAt : '',
    source: 'derived',
    detail: row.detail && typeof row.detail === 'object' && !Array.isArray(row.detail)
      ? (row.detail as Record<string, unknown>)
      : null,
  };
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
