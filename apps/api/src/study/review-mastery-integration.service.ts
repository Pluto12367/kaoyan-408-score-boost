/**
 * V12-M3-C — Review Observation → Evidence → Authoritative Mastery.
 *
 * ## Why this service exists
 *
 * The M3 gap was that an observed redo outcome — STRONG evidence by V12-M1 —
 * never reached the ability estimate: `applyReview` spreads `...current`
 * unchanged and writes only retention/stability/timestamps. The approved repair
 * is NOT to let `applyReview` assign mastery directly (that would bypass the
 * evidence layer). Instead this service makes the production chain literal:
 *
 *   1. the observation is recorded as an evidence receipt, keyed by its stable
 *      per-occurrence identity (the ReviewAttempt row id, V12-M3-A);
 *   2. the receipt is projected into an observation by the SAME pure
 *      `projectReviewEvidence` the shadow used — so production and shadow cannot
 *      drift into two 口径;
 *   3. only an ELIGIBLE receipt may proceed (no receipt, no ability inference);
 *   4. an exactly-once marker is claimed for that receipt;
 *   5. the mastery transition is applied by `ScoreCenterService`, which reuses
 *      `applyMasterySemantics` — the same engine practice uses.
 *
 * ## Two independent variables
 *
 * The review→mastery wiring and the C1 direction guard are deliberately
 * independent. This service enables nothing: it calls the audited switch and
 * records which semantics ran, so with `MASTERY_SEMANTICS` unset the legacy
 * production EMA runs, bit for bit. Turning C1 on would change the transition,
 * not whether review evidence participates.
 *
 * ## Atomicity and exactly-once
 *
 * Everything runs inside the caller's transaction (the review attempt's own),
 * so the attempt, its receipt, the marker and the mastery write commit or roll
 * back together. A duplicate therefore cannot double-apply:
 *   • the HTTP path short-circuits on the idempotency key, and
 *   • even if two transactions race, the marker's unique event key makes the
 *     second one abort — rolling its mastery write back with it.
 * Aborting is the intended safe outcome, not an error to paper over.
 */

import { Injectable, Optional } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  projectReviewEvidence,
  type ProjectedReviewObservation,
  type ReviewEvidenceProjection,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ScoreCenterService, type ReviewMasteryApplication } from '../score-center/service';
import { CanonicalEventWriterService } from './canonical-event-writer.service';
import { LearningEvidenceService } from './learning-evidence.service';

/** The canonical event type that claims "this evidence reached mastery". */
export const REVIEW_MASTERY_APPLIED_EVENT_TYPE = 'REVIEW_MASTERY_APPLIED';

/**
 * The exactly-once claim key. Derived from the evidence receipt, so one receipt
 * can be applied at most once even across processes and restarts.
 */
export function reviewMasteryMarkerKey(input: { userId: string; evidenceEventKey: string }): string {
  return `${REVIEW_MASTERY_APPLIED_EVENT_TYPE}:${input.userId}:${input.evidenceEventKey}`;
}

export type ReviewMasteryIntegrationReason =
  | 'applied'
  | 'store_unavailable'
  | 'evidence_not_persisted'
  | 'not_eligible'
  | 'no_knowledge_node'
  | 'already_applied'
  | 'mastery_writer_unavailable';

export interface ReviewMasteryIntegrationResult {
  readonly applied: boolean;
  readonly reason: ReviewMasteryIntegrationReason;
  readonly evidenceEventKey: string | null;
  readonly occurrence: string | null;
  readonly markerKey: string | null;
  readonly observation: ProjectedReviewObservation | null;
  readonly application: ReviewMasteryApplication | null;
  readonly basis: string;
}

export interface ReviewObservationInput {
  /** V12-M3-A — the stable per-occurrence identity (ReviewAttempt row id). */
  readonly attemptId: string;
  readonly scheduleId: string;
  readonly questionId: string;
  readonly reviewedAt: Date;
  readonly redoCorrect: boolean;
  readonly timeSpentSec?: number | null;
  readonly actionId?: string | null;
  /** The caller's declaration; null when unknown (historical callers). */
  readonly isReview?: boolean | null;
}

@Injectable()
export class ReviewMasteryIntegrationService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly evidence?: LearningEvidenceService,
    @Optional() private readonly events?: CanonicalEventWriterService,
    @Optional() private readonly scoreCenter?: ScoreCenterService,
  ) {}

  get enabled(): boolean {
    return Boolean(this.prisma && this.evidence?.enabled && this.events && this.scoreCenter?.enabled);
  }

  /**
   * Projects ONE observed review into authoritative mastery, inside `tx`.
   *
   * Returns a structured verdict rather than throwing on the "declined" paths:
   * a declined projection is a legitimate, auditable outcome (the score-loop and
   * the E2E assert on it), and never silently becomes a zero.
   */
  async applyFromReviewObservation(
    userId: string,
    input: ReviewObservationInput,
    tx?: Prisma.TransactionClient,
  ): Promise<ReviewMasteryIntegrationResult> {
    const declined = (
      reason: ReviewMasteryIntegrationReason,
      basis: string,
      extra: { evidenceEventKey?: string | null; observation?: ProjectedReviewObservation | null } = {},
    ): ReviewMasteryIntegrationResult => ({
      applied: false,
      reason,
      evidenceEventKey: extra.evidenceEventKey ?? null,
      occurrence: input.attemptId,
      markerKey: null,
      observation: extra.observation ?? null,
      application: null,
      basis,
    });

    if (!this.enabled) {
      return declined('store_unavailable', '证据层或掌握度写方不可用，复习观测不进入能力估计（拒绝以不完整链路作推断）。');
    }
    const db = tx ?? this.prisma!;

    // 1 — the receipt. Recorded BEFORE any mastery decision, and its durability
    // is checked: an observation the ledger failed to persist must not move the
    // estimate, because then no later audit could explain the change.
    const durable = await this.evidence!.recordReviewRecallDurable(
      userId,
      {
        questionId: input.questionId,
        redoCorrect: input.redoCorrect,
        timeSpentSec: input.timeSpentSec ?? null,
        recordedAt: input.reviewedAt.toISOString(),
        actionId: input.actionId ?? null,
        occurrence: input.attemptId,
      },
      tx,
    );
    const evidenceEventKey = durable.record.id;
    if (!durable.persisted) {
      return declined(
        'evidence_not_persisted',
        `复习观测未能写入证据台账（回执 ${evidenceEventKey} 未持久化），按边界规则不进入能力估计。`,
        { evidenceEventKey },
      );
    }

    // 2/3 — the projection, using the same pure implementation as the shadow.
    const resolved = await this.resolvePrimaryNode(db, input.questionId);
    const projection: ReviewEvidenceProjection = projectReviewEvidence({
      events: [{
        reviewEventId: `review-attempt:${input.attemptId}`,
        occurrence: input.attemptId,
        scheduleId: input.scheduleId,
        questionId: input.questionId,
        nodeId: resolved?.nodeId ?? null,
        reviewedAt: input.reviewedAt.toISOString(),
        redoCorrect: input.redoCorrect,
        difficulty: resolved?.difficulty ?? 3,
        scheduledReview: input.isReview ?? null,
      }],
      receipts: [{
        receiptId: evidenceEventKey,
        action: 'review.recalled',
        questionId: input.questionId,
        recordedAt: input.reviewedAt.toISOString(),
        scope: input.reviewedAt.toISOString().slice(0, 10),
        occurrence: input.attemptId,
        kind: durable.record.kind,
        strength: durable.record.strength,
        canInfluenceMastery: durable.record.canInfluenceMastery,
      }],
    });
    const observation = projection.observations[0] ?? null;
    if (!observation) {
      return declined(
        'no_knowledge_node',
        `该题没有可解析的知识节点，无能力估计对象（回执 ${evidenceEventKey} 已记录，观测保留但不作用于掌握度）。`,
        { evidenceEventKey },
      );
    }
    if (!observation.eligibleForMastery) {
      return declined(
        'not_eligible',
        `证据判定为不可支撑能力推断（${observation.evidenceKind}/${observation.evidenceStrength}），不进入掌握度。`,
        { evidenceEventKey, observation },
      );
    }

    // 4 — the exactly-once claim.
    const markerKey = reviewMasteryMarkerKey({ userId, evidenceEventKey });
    const alreadyApplied = await this.events!.findCanonicalEvent(userId, markerKey, tx);
    if (alreadyApplied) {
      return {
        applied: false,
        reason: 'already_applied',
        evidenceEventKey,
        occurrence: input.attemptId,
        markerKey,
        observation,
        application: null,
        basis: `回执 ${evidenceEventKey} 已被投影到权威掌握度（认领事件 ${markerKey} 已存在），本次不重复应用。`,
      };
    }

    // 5 — the transition, through the single mastery writer.
    const application = await this.scoreCenter!.applyReviewObservation(
      userId,
      {
        questionId: input.questionId,
        isCorrect: input.redoCorrect,
        occurredAt: input.reviewedAt,
        evidenceEventKey,
      },
      tx,
    );
    if (!application) {
      return declined('mastery_writer_unavailable', '掌握度写方未生效（无可解析节点或存储不可用），本次未改变权威掌握度。', { evidenceEventKey, observation });
    }

    await this.events!.recordCanonicalEvent({
      userId,
      type: REVIEW_MASTERY_APPLIED_EVENT_TYPE,
      eventKey: markerKey,
      payload: {
        evidenceEventKey,
        occurrence: input.attemptId,
        questionId: input.questionId,
        isCorrect: input.redoCorrect,
        semantics: application.semantics,
        nodes: application.nodes.map((node) => ({ ...node })),
        authoritative: true,
      },
      tx,
    });

    return {
      applied: true,
      reason: 'applied',
      evidenceEventKey,
      occurrence: input.attemptId,
      markerKey,
      observation,
      application,
      basis: `复习观测经证据回执 ${evidenceEventKey} 投影为 ${application.nodes.length} 个节点的权威掌握度更新（语义 ${application.semantics}）。`,
    };
  }

  /**
   * PRIMARY tag wins, matching both the shadow's resolution and production's
   * ordering, so the projected observation describes the same node the
   * authoritative writer will move first.
   */
  private async resolvePrimaryNode(
    db: Prisma.TransactionClient | PrismaService,
    questionId: string,
  ): Promise<{ nodeId: string; difficulty: number } | null> {
    const tags = await db.questionKnowledgeNodeTag.findMany({
      where: { questionId },
      select: { knowledgeNodeId: true, role: true },
    });
    if (tags.length === 0) return null;
    const ordered = [...tags].sort((left, right) => rankRole(left.role) - rankRole(right.role));
    const nodeId = ordered[0].knowledgeNodeId;
    const node = await db.knowledgeNode.findUnique({
      where: { id: nodeId },
      select: { difficulty: true },
    });
    return { nodeId, difficulty: Number(node?.difficulty ?? 3) || 3 };
  }
}

function rankRole(role: string): number {
  return role === 'PRIMARY' ? 0 : 1;
}
