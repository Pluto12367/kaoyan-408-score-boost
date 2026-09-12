/**
 * S2 Transfer Probe — orchestration service.
 *
 * Owns probe SCHEDULING and DELIVERY only. Hard boundaries (source-level
 * asserted in tests):
 *   • never imports any mastery write primitive — probe attempts reach
 *     mastery exclusively through the ordinary practice submission path (C3)
 *   • never writes ReviewSchedule/ReviewAttempt — transfer ≠ review
 *   • never feeds the ranking — the transfer projection is terminal (§21)
 *
 * Identity (C1 α + C2): RecommendationAction(actionType='TRANSFER_PROBE')
 * + 1:1 StudyTask in a dedicated source='transfer-probe' plan. The plan
 * source isolates probes from the daily mission lifecycle:
 * archiveScoreCenterPlans only archives source='score-center', and
 * loadTodayScoreCenterPlan only reads source='score-center'.
 *
 * Delivery is LAZY (no cron): GET /coach/transfer-probes runs the scan —
 * compensate missing schedules, expire stale ones, deliver due ones (select
 * a never-seen question, create the probe session). All idempotent.
 */
import { Injectable, Optional } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { TransferPracticeAccuracyFact, TransferProbeEventFact, TransferProjectionRow } from '@kaoyan408/shared';
import {
  TRANSFER_PROBE_ACTION_TYPE,
  TRANSFER_PROBE_EVIDENCE_KIND,
  TRANSFER_PROBE_PLAN_SOURCE,
  TRANSFER_PROBE_POOL_SOURCE,
  TRANSFER_PROBE_REASON,
  TRANSFER_PROBE_SESSION_TYPE,
  TRANSFER_PROBE_TASK_MODE,
  TRANSFER_PROBE_WINDOWS,
  buildTransferProjection,
  deriveProbeCreationKey,
  deriveProbeScheduleFacts,
  evaluateProbeEligibility,
  TRANSFER_PROBE_GATE,
  type DifficultyBucket,
  type IsomorphismLevel,
  type ProbeKind,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RecommendationActionAdapterService } from '../study/recommendation-action-adapter.service';
import { StudyPlanRepository } from '../study/study-plan.repository';
import { LearningSessionRepository } from '../study/learning-session.repository';
import { QuestionsService } from '../questions/questions.service';
import { StudyService } from '../study/study.service';

const DAY = 86_400_000;

/** The shape the probe selector needs from a pool question (Prisma row). */
type PoolQuestion = {
  id: string;
  stem: string;
  options: string[];
  type: string;
  difficulty: string;
  expectedTimeSec: number;
  familyId: string;
  source: string;
};

export interface DueProbeCard {
  probeId: string;
  taskId: string;
  nodeId: string;
  nodeName: string;
  dueDate: string;
  bucket: DifficultyBucket;
  isomorphism: IsomorphismLevel;
  kind: ProbeKind;
  session: {
    sessionId: string;
    question: {
      id: string;
      stem: string;
      options: string[];
      type: string;
      difficulty: string;
      expectedTimeSec: number;
    };
  } | null;
  reason?: string;
}

@Injectable()
export class TransferProbeService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly actionAdapter?: RecommendationActionAdapterService,
    @Optional() private readonly studyPlanRepository?: StudyPlanRepository,
    @Optional() private readonly learningSessions?: LearningSessionRepository,
    @Optional() private readonly questionsService?: QuestionsService,
    @Optional() private readonly studyService?: StudyService,
  ) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  /** Rollback switch: unset/unknown = off (scheduling AND delivery stop). */
  get featureEnabled(): boolean {
    return process.env.TRANSFER_PROBE_ENABLED === 'true';
  }

  // ---------------------------------------------------------------------------
  // S2.1 — scheduling (identity = probe Action + StudyTask)
  // ---------------------------------------------------------------------------

  /**
   * Schedule a probe for a completed intervention task. Idempotent by
   * creationKey; skips when a pending probe exists for the node or when the
   * node was probed within the minimum spacing window.
   */
  async scheduleProbeForCompletedTask(
    userId: string,
    task: { id: string; knowledgeNodeId: string; completedAt: Date },
  ): Promise<{ probeId: string; taskId: string; duplicate: boolean } | { skipped: string } | null> {
    if (!this.enabled || !this.featureEnabled || !this.actionAdapter || !this.studyPlanRepository) return null;
    const nodeId = task.knowledgeNodeId;
    const now = new Date();

    // C3 precondition: the intervention must have produced observed practice
    // on its node (a completion marker alone never schedules a probe).
    const windowStart = new Date(task.completedAt.getTime() - TRANSFER_PROBE_WINDOWS.interventionWindowDays * DAY);
    const windowEnd = new Date(task.completedAt.getTime() + TRANSFER_PROBE_WINDOWS.interventionWindowDays * DAY);
    const observed = await this.prisma.practiceRecord.count({
      where: {
        userId,
        gradingMode: 'objective',
        submittedAt: { gte: windowStart, lte: windowEnd },
        question: { knowledgeNodeTags: { some: { knowledgeNodeId: nodeId, role: 'PRIMARY' } } },
      },
    });
    if (observed === 0) { console.error('[tp-debug] no evidence', nodeId); return { skipped: 'no_intervention_evidence' }; }

    // One pending probe per node; minimum spacing between probes per node.
    const pending = await this.prisma.recommendationAction.findFirst({
      where: { userId, actionType: TRANSFER_PROBE_ACTION_TYPE, targetId: nodeId, status: { in: ['CREATED', 'STARTED'] } },
      select: { id: true },
    });
    if (pending) return { skipped: 'pending_probe_exists' };
    const recent = await this.prisma.recommendationAction.findFirst({
      where: {
        userId,
        actionType: TRANSFER_PROBE_ACTION_TYPE,
        targetId: nodeId,
        createdAt: { gte: new Date(now.getTime() - TRANSFER_PROBE_WINDOWS.minDaysBetweenProbesPerNode * DAY) },
      },
      select: { id: true },
    });
    if (recent) return { skipped: 'recent_probe_exists' };

    const scheduledDate = deriveProbeScheduleFacts(task.completedAt.toISOString(), now.toISOString()).scheduledDate;
    const creationKey = deriveProbeCreationKey(userId, nodeId, scheduledDate);
    const interventionAction = await this.prisma.recommendationAction.findFirst({
      where: { studyTaskId: task.id },
      select: { id: true },
    });

    // The adapter's creationKey embeds the deterministic generation key, so a
    // pre-read by key gives the honest duplicate signal before the upsert.
    const existing = await this.prisma.recommendationAction.findFirst({
      where: { userId, creationKey: { contains: creationKey } },
      select: { id: true },
    });

    const action = await this.actionAdapter.createOrGetAction({
      userId,
      scheduledDate,
      generationKey: creationKey,
      actionType: TRANSFER_PROBE_ACTION_TYPE,
      targetType: 'KNOWLEDGE_NODE',
      targetId: nodeId,
      reason: TRANSFER_PROBE_REASON,
      evidenceRefs: [{
        kind: 'transfer-probe',
        taskId: task.id,
        interventionActionId: interventionAction?.id ?? null,
        interventionCompletedAt: task.completedAt.toISOString(),
      }],
    });

    const task2 = await this.prisma.studyTask.create({
      data: {
        planId: await this.ensureProbePlan(userId),
        knowledgePointId: await this.resolvePrimaryKnowledgePointId(nodeId),
        knowledgeNodeId: nodeId,
        subject: '',
        chapter: '',
        title: `迁移复测：${await this.nodeName(nodeId)}`,
        mode: TRANSFER_PROBE_TASK_MODE,
        minutes: 6,
        questionCount: 1,
        scheduledDate,
        priority: '中',
        reason: TRANSFER_PROBE_REASON,
        nextAction: TRANSFER_PROBE_TASK_MODE,
        status: 'pending',
      },
      select: { id: true },
    });
    if (!existing) {
      await this.actionAdapter.bindStudyTask(action.id, task2.id);
    }

    return { probeId: action.id, taskId: task2.id, duplicate: existing != null };
  }

  // ---------------------------------------------------------------------------
  // S2.4 — lazy scan: compensate, expire, deliver
  // ---------------------------------------------------------------------------

  /**
   * The probe inbox. Running it is idempotent: it compensates missing
   * schedules, expires stale probes, and delivers due ones (daily cap).
   * Read model + scheduling facts only — never mastery, never ranking.
   */
  async getDueProbes(userId: string): Promise<{
    storeAvailable: boolean;
    featureEnabled: boolean;
    cards: DueProbeCard[];
    deliveredCount: number;
  }> {
    const empty = { storeAvailable: this.enabled, featureEnabled: this.featureEnabled, cards: [] as DueProbeCard[], deliveredCount: 0 };
    if (!this.enabled || !this.learningSessions) return { ...empty, storeAvailable: this.enabled };
    if (!this.featureEnabled) return empty;

    await this.compensateSchedules(userId);
    await this.expireStaleProbes(userId);

    const pending = await this.prisma.recommendationAction.findMany({
      where: { userId, actionType: TRANSFER_PROBE_ACTION_TYPE, status: 'CREATED' },
      take: 20,
      orderBy: { createdAt: 'asc' },
      include: { studyTask: true },
    });

    const cards: DueProbeCard[] = [];
    let deliveredCount = 0;
    for (const action of pending) {
      const task = action.studyTask;
      if (!task) continue;
      const completedAt = readInterventionCompletedAt(action.evidenceRefs);
      if (!completedAt) continue;
      const facts = deriveProbeScheduleFacts(completedAt, new Date().toISOString());
      if (facts.isExpired) {
        await this.expireProbe(action.id, task.id, 'window_elapsed');
        continue;
      }
      if (!facts.canDeliverNow || !facts.withinGrace) continue;
      if (deliveredCount >= TRANSFER_PROBE_WINDOWS.maxDeliveriesPerDay) {
        cards.push(this.pendingCard(action, task, 'daily_cap_reached'));
        continue;
      }
      const delivery = await this.deliverProbe(userId, action, task);
      if (delivery) {
        cards.push(delivery.card);
        deliveredCount += 1;
      } else {
        cards.push(this.pendingCard(action, task, 'no_probe_available'));
      }
    }
    return { storeAvailable: true, featureEnabled: true, cards, deliveredCount };
  }

  private pendingCard(action: { id: string; targetId: string }, task: { id: string; scheduledDate: string }, reason: string): DueProbeCard {
    return {
      probeId: action.id,
      taskId: task.id,
      nodeId: action.targetId,
      nodeName: '',
      dueDate: task.scheduledDate,
      bucket: 'MEDIUM',
      isomorphism: 'verified',
      kind: 'practice_difficulty',
      session: null,
      reason,
    };
  }

  private async compensateSchedules(userId: string): Promise<void> {
    const since = new Date(Date.now() - 30 * DAY);
    const tasks = await this.prisma.studyTask.findMany({
      where: { plan: { userId }, completed: true, knowledgeNodeId: { not: null }, completedAt: { gte: since } },
      orderBy: { completedAt: 'desc' },
      take: 50,
      select: { id: true, knowledgeNodeId: true, completedAt: true },
    });
    if (tasks.length === 0) return;
    const probeActions = await this.prisma.recommendationAction.findMany({
      where: { userId, actionType: TRANSFER_PROBE_ACTION_TYPE },
      select: { targetId: true, createdAt: true },
      take: 200,
    });
    for (const task of tasks) {
      if (!task.knowledgeNodeId || !task.completedAt) continue;
      const latest = probeActions
        .filter((row) => row.targetId === task.knowledgeNodeId)
        .reduce<number | null>((max, row) => (max == null || row.createdAt.getTime() > max ? row.createdAt.getTime() : max), null);
      if (latest != null && latest >= task.completedAt.getTime()) continue;
      const scheduled = await this.scheduleProbeForCompletedTask(userId, {
        id: task.id,
        knowledgeNodeId: task.knowledgeNodeId,
        completedAt: task.completedAt,
      });
    }
  }

  private async expireStaleProbes(userId: string): Promise<void> {
    const pending = await this.prisma.recommendationAction.findMany({
      where: { userId, actionType: TRANSFER_PROBE_ACTION_TYPE, status: 'CREATED' },
      take: 50,
      select: { id: true, evidenceRefs: true },
    });
    for (const action of pending) {
      const completedAt = readInterventionCompletedAt(action.evidenceRefs);
      if (!completedAt) continue;
      const facts = deriveProbeScheduleFacts(completedAt, new Date().toISOString());
      if (facts.isExpired) {
        await this.expireProbe(action.id, null, 'window_elapsed');
      }
    }
  }

  private async expireProbe(actionId: string, taskId: string | null, reason: string): Promise<void> {
    await this.prisma.recommendationAction.update({
      where: { id: actionId },
      data: { status: 'EXPIRED', reason: `${TRANSFER_PROBE_REASON}（${reason}）` },
    });
    if (taskId) {
      await this.prisma.studyTask.update({ where: { id: taskId }, data: { status: 'postponed' } }).catch(() => {});
    }
  }

  // ---------------------------------------------------------------------------
  // Delivery — select a never-seen question and open the probe session
  // ---------------------------------------------------------------------------

  private async deliverProbe(
    userId: string,
    action: { id: string; targetId: string },
    task: { id: string; scheduledDate: string },
  ): Promise<{ card: DueProbeCard } | null> {
    const nodeId = action.targetId;
    const [{ bucket, kinds }, nodeName] = await Promise.all([
      this.interventionFacts(userId, nodeId),
      this.nodeName(nodeId),
    ]);
    if (!bucket || kinds.length === 0) return null;

    const selected = await this.selectProbeQuestion(userId, nodeId, bucket, kinds);
    if (!selected) return null;
    // The snapshot must be the DOMAIN question (answer/knowledgePointIds) so
    // the canonical submit path can judge it exactly like any practice.
    const domainQuestion = await this.questionsService?.findQuestionById(selected.question.id);
    if (!domainQuestion) return null;

    const session = await this.learningSessions!.createFromAction({
      id: `probe-${randomUUID()}`,
      userId,
      actionId: action.id,
      type: TRANSFER_PROBE_SESSION_TYPE,
      questionIds: [selected.question.id],
      questionSnapshot: [domainQuestion as never],
      answers: {},
      markedQuestions: [],
      currentIndex: 0,
      revision: 0,
      startedAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      totalActiveMs: 0,
      lastResumeAt: Date.now(),
      completed: false,
    } as never);
    this.studyService?.registerExternalSession(session as never);

    await this.prisma.recommendationAction.update({
      where: { id: action.id },
      data: { status: 'STARTED', startedAt: new Date() },
    });

    return {
      card: {
        probeId: action.id,
        taskId: task.id,
        nodeId,
        nodeName,
        dueDate: task.scheduledDate,
        bucket: selected.bucket,
        isomorphism: selected.isomorphism,
        kind: 'practice_difficulty',
        session: {
          sessionId: session.id,
          question: {
            id: domainQuestion.id,
            stem: domainQuestion.stem,
            options: domainQuestion.options,
            type: String(domainQuestion.type),
            difficulty: String(domainQuestion.difficulty),
            expectedTimeSec: domainQuestion.expectedTimeSec,
          },
        },
      },
    };
  }

  /**
   * Selection: verified pool first (isomorphism=verified), then the honest
   * unverified fallback (same node/type/bucket, pool-external, clearly
   * labeled — never presented as verified). Eligibility E2-E6 is enforced
   * identically on both paths.
   */
  private async selectProbeQuestion(
    userId: string,
    nodeId: string,
    bucket: DifficultyBucket,
    interventionTypes: string[],
  ): Promise<{ question: PoolQuestion; bucket: DifficultyBucket; isomorphism: IsomorphismLevel } | null> {
    const trySelect = async (poolOnly: boolean): Promise<{ question: PoolQuestion; isomorphism: IsomorphismLevel } | null> => {
      const candidates = await this.prisma.question.findMany({
        where: {
          isCurrent: true,
          difficulty: bucket,
          source: poolOnly ? TRANSFER_PROBE_POOL_SOURCE : { not: TRANSFER_PROBE_POOL_SOURCE },
          knowledgeNodeTags: { some: { knowledgeNodeId: nodeId, role: 'PRIMARY' } },
        },
        orderBy: { createdAt: 'desc' },
        take: 10,
      });
      for (const candidate of candidates) {
        if (interventionTypes.length > 0 && !interventionTypes.includes(candidate.type)) continue;
        const facts = await this.eligibilityFacts(userId, candidate);
        const verdict = evaluateProbeEligibility({ ...facts, inPool: true, bucketMatch: true, typeMatch: true });
        if (verdict.eligible) {
          return { question: candidate, isomorphism: poolOnly ? 'verified' : 'unverified' };
        }
      }
      return null;
    };
    const verified = await trySelect(true);
    if (verified) return { ...verified, bucket };
    const unverified = await trySelect(false);
    if (unverified) return { ...unverified, bucket };
    return null;
  }

  /** E2-E6 facts for one candidate (E1 handled by the query, bucket/type by the caller). */
  private async eligibilityFacts(userId: string, candidate: { id: string; familyId: string }) {
    const [priorAttempt, priorExposure, familyQuestionIds] = await Promise.all([
      this.prisma.practiceRecord.findFirst({ where: { userId, questionId: candidate.id }, select: { id: true } }),
      this.prisma.learningSession.findFirst({ where: { userId, questionIds: { has: candidate.id } }, select: { id: true } }),
      this.prisma.question.findMany({ where: { familyId: candidate.familyId }, select: { id: true } }),
    ]);
    const familyIds = familyQuestionIds.map((row) => row.id);
    const [familyAttempt, familyExposure, priorProbe] = await Promise.all([
      familyIds.length > 0
        ? this.prisma.practiceRecord.findFirst({ where: { userId, questionId: { in: familyIds } }, select: { id: true } })
        : null,
      familyIds.length > 0
        ? this.prisma.learningSession.findFirst({ where: { userId, questionIds: { hasSome: familyIds } }, select: { id: true } })
        : null,
      this.prisma.userEvent.findFirst({
        where: {
          userId,
          type: 'EVIDENCE_RECORDED',
          AND: [
            { payload: { path: ['detail', 'kind'], equals: TRANSFER_PROBE_EVIDENCE_KIND } },
            { payload: { path: ['detail', 'questionId'], equals: candidate.id } },
          ],
        },
        select: { id: true },
      }),
    ]);
    const reviewAttempt = await this.prisma.reviewAttempt.findFirst({
      where: { schedule: { userId, questionId: candidate.id } },
      select: { id: true },
    });
    return {
      hasPriorAttempt: priorAttempt != null || reviewAttempt != null,
      hasPriorExposure: priorExposure != null,
      sameFamilySeen: familyAttempt != null || familyExposure != null,
      previouslyUsedAsProbe: priorProbe != null,
    };
  }

  /** The intervention facts decide the probe bucket and acceptable types. */
  private async interventionFacts(userId: string, nodeId: string): Promise<{ bucket: DifficultyBucket | null; kinds: string[] }> {
    const records = await this.prisma.practiceRecord.findMany({
      where: {
        userId,
        gradingMode: 'objective',
        variantQuestionId: null,
        question: { knowledgeNodeTags: { some: { knowledgeNodeId: nodeId, role: 'PRIMARY' } } },
      },
      orderBy: { submittedAt: 'desc' },
      take: 20,
      select: { question: { select: { difficulty: true, type: true } } },
    });
    if (records.length === 0) return { bucket: null, kinds: [] };
    const counts = new Map<string, number>();
    const kinds = new Set<string>();
    for (const record of records) {
      const bucket = String(record.question.difficulty);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
      kinds.add(record.question.type);
    }
    const bucket = [...counts.entries()].sort((left, right) => right[1] - left[1])[0][0] as DifficultyBucket;
    return { bucket, kinds: [...kinds] };
  }

  private async ensureProbePlan(userId: string): Promise<string> {
    const generationKey = `transfer-probe-plan:${userId}`;
    const plan = await this.studyPlanRepository!.createOrGetByGenerationKey({
      userId,
      generationKey,
      phase: 'transfer-probe',
      targetScore: 115,
      remainingDays: 96,
      dailyHours: 3.5,
      checkpoint: 'transfer-probe',
      source: TRANSFER_PROBE_PLAN_SOURCE,
      modelVersion: 'transfer-probe-v1',
      targetExamDate: null,
      availableMinutes: 60,
      stale: false,
      status: 'ACTIVE',
      tasks: [],
    } as never);
    return plan.id;
  }

  private async resolvePrimaryKnowledgePointId(nodeId: string): Promise<string> {
    const mapping = await this.prisma.knowledgePointNodeMap.findFirst({
      where: { knowledgeNodeId: nodeId, mappingType: 'PRIMARY' },
      select: { knowledgePointId: true },
    });
    return mapping?.knowledgePointId ?? nodeId;
  }

  private async nodeName(nodeId: string): Promise<string> {
    const node = await this.prisma.knowledgeNode.findUnique({ where: { id: nodeId }, select: { name: true } });
    return node?.name ?? nodeId;
  }
}

function readInterventionCompletedAt(evidenceRefs: Prisma.JsonValue | null): string | null {
  if (!Array.isArray(evidenceRefs)) return null;
  for (const ref of evidenceRefs) {
    if (ref && typeof ref === 'object' && (ref as Record<string, unknown>).kind === 'transfer-probe') {
      const value = (ref as Record<string, unknown>).interventionCompletedAt;
      if (typeof value === 'string') return value;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// S2.7 — read-only transfer observation projection (never writes anything)
// ---------------------------------------------------------------------------

export interface TransferProbeEventView {
  probeId: string | null;
  nodeId: string | null;
  questionId: string | null;
  bucket: string | null;
  isomorphism: string | null;
  correct: boolean | null;
  recordedAt: string | null;
}

@Injectable()
export class TransferProbeProjection {
  constructor(private readonly prisma: PrismaService) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  private async loadProbeEvents(userId?: string, take = 1000): Promise<TransferProbeEventFact[]> {
    const rows = await this.prisma.userEvent.findMany({
      where: {
        type: 'EVIDENCE_RECORDED',
        ...(userId ? { userId } : {}),
        payload: { path: ['detail', 'kind'], equals: TRANSFER_PROBE_EVIDENCE_KIND },
      },
      orderBy: { createdAt: 'desc' },
      take,
      select: { payload: true },
    });
    return rows.map((row) => {
      const payload = row.payload as Record<string, unknown>;
      const detail = (payload.detail ?? {}) as Record<string, unknown>;
      return {
        key: String(payload.eventKey ?? payload.recordedAt ?? Math.random()),
        nodeId: String(detail.nodeId ?? ''),
        kind: (String(detail.kind_probe ?? 'practice_difficulty') as ProbeKind),
        bucket: (String(detail.bucket ?? 'MEDIUM') as DifficultyBucket),
        isomorphism: (String(detail.isomorphism ?? 'unverified') as IsomorphismLevel),
        attempts: Number((payload.metrics as Record<string, unknown> | undefined)?.attempts ?? 0),
        correct: Number((payload.metrics as Record<string, unknown> | undefined)?.correctCount ?? 0),
        invalidated: detail.invalidated === true,
      };
    });
  }

  private async practiceAccuracyByNode(nodeIds: readonly string[]): Promise<Record<string, TransferPracticeAccuracyFact>> {
    const result: Record<string, TransferPracticeAccuracyFact> = {};
    for (const nodeId of nodeIds) {
      const records = await this.prisma.practiceRecord.findMany({
        where: {
          gradingMode: 'objective',
          variantQuestionId: null,
          question: { knowledgeNodeTags: { some: { knowledgeNodeId: nodeId, role: 'PRIMARY' } } },
          OR: [{ sessionId: null }, { session: { is: { type: { not: TRANSFER_PROBE_SESSION_TYPE } } } }],
        },
        orderBy: { submittedAt: 'desc' },
        take: 500,
        select: { correct: true },
      });
      result[nodeId] = {
        nodeId,
        attempts: records.length,
        correct: records.filter((row) => row.correct).length,
      };
    }
    return result;
  }

  /** Student-facing: own probe events only — aggregates stay behind the gate. */
  async getTransferObservation(userId: string) {
    const events = await this.loadProbeEvents(userId, 50);
    const rows = await this.prisma.userEvent.findMany({
      where: {
        userId,
        type: 'EVIDENCE_RECORDED',
        payload: { path: ['detail', 'kind'], equals: TRANSFER_PROBE_EVIDENCE_KIND },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { payload: true, createdAt: true },
    });
    const views: TransferProbeEventView[] = rows.map((row) => {
      const payload = row.payload as Record<string, unknown>;
      const detail = (payload.detail ?? {}) as Record<string, unknown>;
      return {
        probeId: typeof detail.probeId === 'string' ? detail.probeId : null,
        nodeId: typeof detail.nodeId === 'string' ? detail.nodeId : null,
        questionId: typeof detail.questionId === 'string' ? detail.questionId : null,
        bucket: typeof detail.bucket === 'string' ? detail.bucket : null,
        isomorphism: typeof detail.isomorphism === 'string' ? detail.isomorphism : null,
        correct: Number((payload.metrics as Record<string, unknown> | undefined)?.correctCount ?? 0) > 0,
        recordedAt: row.createdAt.toISOString(),
      };
    });
    return {
      userId,
      events: views,
      authoritative: false,
      note: '聚合迁移结论（TransferRate/Gap）在证据门（每节点 n≥5）满足后由教师/管理员视图提供；个人视角只呈现自己的探针事件。',
    };
  }

  /** Teacher/admin node aggregates. Read-only: zero writes of any kind. */
  async getTransferSummary() {
    const events = await this.loadProbeEvents(undefined, 1000);
    const nodeIds = [...new Set(events.map((event) => event.nodeId).filter(Boolean))];
    const practiceAccuracyByNode = await this.practiceAccuracyByNode(nodeIds);
    const rows = buildTransferProjection(events, practiceAccuracyByNode);
    console.error('[tp-debug] rows', JSON.stringify(rows));

    const poolRemaining: Record<string, Record<string, number>> = {};
    for (const nodeId of nodeIds) {
      poolRemaining[nodeId] = {};
      for (const bucket of ['BASIC', 'MEDIUM', 'HARD'] as const) {
        poolRemaining[nodeId][bucket] = await this.prisma.question.count({
          where: {
            isCurrent: true,
            source: TRANSFER_PROBE_POOL_SOURCE,
            difficulty: bucket,
            knowledgeNodeTags: { some: { knowledgeNodeId: nodeId, role: 'PRIMARY' } },
          },
        });
      }
    }

    return {
      generatedAt: new Date().toISOString(),
      authoritative: false,
      rows,
      poolRemainingByBucket: poolRemaining,
      gateNote: `样本下限 ${TRANSFER_PROBE_GATE.minSampleSize}：未达门槛的节点只报 insufficient_data，不出数值。`,
    };
  }
}
