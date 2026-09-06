/**
 * V6.3 Effectiveness Service — production read-model for the V6/V6.1/V6.2
 * derivation layer.
 *
 * READ-ONLY by design: every method derives views from existing tables
 * (PracticeRecord, KnowledgePointNodeMap, UserMasterySnapshot/UserKnowledgeMastery,
 * RecommendationAction, StudyTask, StudyTaskCompletion, ReviewSchedule).
 * No new tables, no writes, fully rebuildable per request.
 *
 * Honesty contract: a student/node/intervention without enough evidence is
 * reported as insufficient_data, never fabricated.
 */

import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiMetricsService } from '../ai-metrics/ai-metrics.service';
import { StudentContextQueryService } from '../study/student-context.query.service';
import {
  classifyStudent,
  generateStrategyProposals,
  runExperiment,
  type ExperimentResult,
  type StrategyProposal,
} from './learning-effectiveness.js';
import {
  correlateOutcome,
  correlateUserAction,
  deriveInterventionEvents,
  type InterventionEvent,
  type RawActionRow,
  type RawCompletionRow,
  type RawReviewRow,
  type RawTaskRow,
} from './intervention-event.js';
import type { RawPracticeFact } from './outcome-pipeline.js';
import {
  classifyProfile,
  deriveNodeOutcomes,
  pickMasteryBounds,
  resolvePointToNodeMap,
  toPracticeFacts,
  toProfileInput,
  type MasteryBounds,
  type NodeOutcomeView,
  type ProfileInput,
  type RawMasterySnapshotRow,
  type RawNodeMapRow,
  type RawPracticeRecordRow,
} from './effectiveness.assembly.js';

const MAX_PRACTICE_ROWS = 2000;
const MAX_ACTION_ROWS = 200;
const MAX_COMPLETION_ROWS = 500;
const MAX_REVIEW_ROWS = 200;
const MAX_EXPERIMENT_USERS = 50;

export interface OutcomeQueryResult {
  userId: string;
  windowStart: string;
  windowEnd: string;
  windowDays: number;
  hasLearningData: boolean;
  outcomes: NodeOutcomeView[];
  summary: {
    nodesEvaluated: number;
    gatePassed: number;
    gateBlocked: number;
  };
}

export interface InterventionEventView {
  event: InterventionEvent;
  actionCorrelation: ReturnType<typeof correlateUserAction>;
  outcomeCorrelation: ReturnType<typeof correlateOutcome>;
}

export interface InterventionQueryResult {
  userId: string;
  asOf: string;
  hasSourceFacts: boolean;
  events: InterventionEventView[];
  byStatus: Record<string, number>;
}

export interface ProfileQueryResult {
  userId: string;
  hasLearningData: boolean;
  profile: ReturnType<typeof classifyStudent> | null;
  inputs: ProfileInput | null;
  reason?: 'no_learning_data';
}

export interface ExperimentQueryResult {
  design: 'observational_cohort';
  windowDays: number;
  cohorts: Array<{ archetype: string; userCount: number }>;
  experiment: ExperimentResult;
  proposals: StrategyProposal[];
}

interface PracticeFactBundle {
  facts: RawPracticeFact[];
  unmappedRecordCount: number;
  bounds: Map<string, MasteryBounds>;
}

@Injectable()
export class EffectivenessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly studentContext: StudentContextQueryService,
    @Optional() private readonly metrics?: AiMetricsService,
  ) {}

  async getOutcomes(userId: string, windowDays = 30, asOf = new Date()): Promise<OutcomeQueryResult> {
    const windowEnd = asOf;
    const windowStart = new Date(asOf.getTime() - windowDays * 86_400_000);
    const bundle = await this.loadPracticeFacts(userId, windowStart, windowEnd);

    const views = deriveNodeOutcomes({
      facts: bundle.facts,
      bounds: bundle.bounds,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    });

    const gatePassed = views.filter((view) => view.evidenceGate.passed).length;
    this.metrics?.recordEffectivenessDerivation({
      surface: 'outcomes',
      nodesEvaluated: views.length,
      gatePassed,
      gateInsufficient: views.length - gatePassed,
    });

    return {
      userId,
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      windowDays,
      hasLearningData: bundle.facts.length > 0,
      outcomes: views,
      summary: {
        nodesEvaluated: views.length,
        gatePassed,
        gateBlocked: views.length - gatePassed,
      },
    };
  }

  async getInterventions(userId: string, asOf = new Date()): Promise<InterventionQueryResult> {
    if (!this.enabled) {
      return { userId, asOf: asOf.toISOString(), hasSourceFacts: false, events: [], byStatus: {} };
    }
    const db = this.db();
    const [actions, completions, reviews] = await Promise.all([
      db.recommendationAction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: MAX_ACTION_ROWS,
        select: { id: true, userId: true, actionType: true, status: true, creationKey: true, studyTaskId: true, createdAt: true, updatedAt: true },
      }),
      db.studyTaskCompletion.findMany({
        where: { userId },
        orderBy: { completedAt: 'desc' },
        take: MAX_COMPLETION_ROWS,
        select: { taskId: true, completedDate: true, completedAt: true },
      }),
      db.reviewSchedule.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: MAX_REVIEW_ROWS,
        select: { id: true, userId: true, questionId: true, stability: true, consecutiveCorrect: true, nextReviewAt: true, createdAt: true },
      }),
    ]);

    const taskIds = [...new Set(actions.map((action) => action.studyTaskId).filter((id): id is string => id != null))];
    const tasks = taskIds.length > 0
      ? await db.studyTask.findMany({
          where: { id: { in: taskIds } },
          select: { id: true, knowledgeNodeId: true, knowledgePointId: true, title: true, status: true, scheduledDate: true, completed: true, completedAt: true, startedAt: true, planId: true },
        })
      : [];

    const events = deriveInterventionEvents({
      actions: actions as RawActionRow[],
      tasks: tasks as RawTaskRow[],
      completions: completions as RawCompletionRow[],
      reviews: reviews as RawReviewRow[],
      asOf: asOf.toISOString(),
    });

    const [practiceRecords, outcomes] = await Promise.all([
      db.practiceRecord.findMany({
        where: { userId },
        orderBy: { submittedAt: 'desc' },
        take: MAX_PRACTICE_ROWS,
        select: { questionId: true, submittedAt: true },
      }),
      this.getOutcomes(userId, 30, asOf),
    ]);

    const outcomeMatches = outcomes.outcomes.map((view) => ({
      knowledgeNodeId: view.knowledgeNodeId,
      interventionId: null as string | null,
      deltas: { masteryGain: view.masteryGain },
    }));

    const practiceViews = practiceRecords.map((record) => ({
      questionId: record.questionId,
      submittedAt: record.submittedAt.toISOString(),
    }));

    const views: InterventionEventView[] = events.map((event) => ({
      event,
      actionCorrelation: correlateUserAction(event, practiceViews),
      outcomeCorrelation: correlateOutcome(event, outcomeMatches),
    }));

    const byStatus: Record<string, number> = {};
    for (const view of views) {
      byStatus[view.event.status] = (byStatus[view.event.status] ?? 0) + 1;
    }
    this.metrics?.recordEffectivenessDerivation({
      surface: 'interventions',
      nodesEvaluated: views.length,
      gatePassed: 0,
      gateInsufficient: 0,
    });

    return {
      userId,
      asOf: asOf.toISOString(),
      hasSourceFacts: actions.length > 0 || reviews.length > 0,
      events: views,
      byStatus,
    };
  }

  async getProfile(userId: string, asOf = new Date()): Promise<ProfileQueryResult> {
    if (!this.enabled) {
      return { userId, hasLearningData: false, profile: null, inputs: null, reason: 'no_learning_data' };
    }
    const db = this.db();
    const context = await this.studentContext.getContext(userId, asOf);
    const [masteryAggregate, recentRecords] = await Promise.all([
      db.userKnowledgeMastery.aggregate({
        where: { userId },
        _avg: { mastery: true },
      }),
      db.practiceRecord.findMany({
        where: { userId },
        orderBy: { submittedAt: 'desc' },
        take: 20,
        select: { correct: true },
      }),
    ]);

    const avgMastery = masteryAggregate._avg.mastery ?? null;
    const hasLearningData = recentRecords.length > 0 || avgMastery != null;
    if (!hasLearningData) {
      return { userId, hasLearningData: false, profile: null, inputs: null, reason: 'no_learning_data' };
    }

    const input = toProfileInput(
      {
        overdueCount: context.review.overdueCount,
        studyStreak: context.momentum.studyStreak,
        openTaskCount: context.plan.todayTasks.filter((task) => !task.completed).length,
        examDaysRemaining: context.exam.remainingDays,
      },
      {
        avgMastery,
        recentAccuracy: accuracyOf(recentRecords.map((record) => record.correct)),
      },
    );
    const classified = classifyProfile(input);
    this.metrics?.recordEffectivenessDerivation({
      surface: 'summary',
      nodesEvaluated: 1,
      gatePassed: 0,
      gateInsufficient: 0,
    });
    return { userId, hasLearningData: true, profile: classified.profile, inputs: classified.inputs };
  }

  async getSummary(userId: string, windowDays = 30, asOf = new Date()) {
    const [profile, outcomes, interventions] = await Promise.all([
      this.getProfile(userId, asOf),
      this.getOutcomes(userId, windowDays, asOf),
      this.getInterventions(userId, asOf),
    ]);
    return {
      userId,
      generatedAt: asOf.toISOString(),
      windowDays,
      profile,
      outcomes: { hasLearningData: outcomes.hasLearningData, summary: outcomes.summary, outcomes: outcomes.outcomes },
      interventions: { hasSourceFacts: interventions.hasSourceFacts, byStatus: interventions.byStatus },
    };
  }

  /**
   * Observational cohort comparison across student archetypes — NOT a
   * controlled experiment. Arms are the two largest archetype cohorts;
   * runExperiment's minSampleSize gate keeps tiny populations honest.
   */
  async getExperiments(windowDays = 30, asOf = new Date()): Promise<ExperimentQueryResult> {
    const empty: ExperimentQueryResult = {
      design: 'observational_cohort',
      windowDays,
      cohorts: [],
      experiment: {
        armA: 'n/a', armB: 'n/a', sampleSizeA: 0, sampleSizeB: 0, metric: 'masteryGain',
        avgA: null, avgB: null, delta: null, confidence: 'insufficient_data', verdict: 'insufficient_data',
      },
      proposals: [],
    };
    if (!this.enabled) return empty;
    const db = this.db();
    const students = await db.user.findMany({
      where: { role: 'STUDENT' },
      select: { id: true },
      take: MAX_EXPERIMENT_USERS,
      orderBy: { createdAt: 'asc' },
    });
    if (students.length === 0) return empty;

    // Statistical unit = one student: each user contributes a single outcome
    // whose masteryGain is the mean over that user's nodes with a gain.
    const cohorts = new Map<string, { users: number; gains: number[] }>();
    for (const student of students) {
      const [profile, outcomes] = await Promise.all([
        this.getProfile(student.id, asOf),
        this.getOutcomes(student.id, windowDays, asOf),
      ]);
      if (!profile.profile) continue;
      const gains = outcomes.outcomes
        .map((view) => view.masteryGain)
        .filter((gain): gain is number => gain != null);
      const archetype = profile.profile.archetype;
      const bucket = cohorts.get(archetype) ?? { users: 0, gains: [] };
      bucket.users += 1;
      if (gains.length > 0) {
        bucket.gains.push(Math.round((gains.reduce((sum, gain) => sum + gain, 0) / gains.length) * 10000) / 10000);
      }
      cohorts.set(archetype, bucket);
    }

    const ranked = [...cohorts.entries()]
      .map(([archetype, bucket]) => ({ archetype, ...bucket }))
      .sort((left, right) => right.users - left.users);

    if (ranked.length < 2) {
      this.metrics?.recordEffectivenessDerivation({ surface: 'experiments', nodesEvaluated: ranked.length, gatePassed: 0, gateInsufficient: 0 });
      return { ...empty, cohorts: ranked.map(({ archetype, users }) => ({ archetype, userCount: users })) };
    }

    const experiment = runExperiment({
      armA: { name: ranked[0].archetype, outcomes: cohortOutcomeViews(ranked[0].gains) },
      armB: { name: ranked[1].archetype, outcomes: cohortOutcomeViews(ranked[1].gains) },
      metric: 'masteryGain',
      minSampleSize: 3,
    });
    const proposals = generateStrategyProposals([experiment]);
    this.metrics?.recordEffectivenessDerivation({
      surface: 'experiments',
      nodesEvaluated: ranked.length,
      gatePassed: experiment.confidence === 'sufficient' ? 1 : 0,
      gateInsufficient: experiment.confidence === 'sufficient' ? 0 : 1,
    });

    return {
      design: 'observational_cohort',
      windowDays,
      cohorts: ranked.map(({ archetype, users }) => ({ archetype, userCount: users })),
      experiment,
      proposals,
    };
  }

  private get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  private db() {
    return this.prisma as PrismaService & Record<string, any>;
  }

  /**
   * Load practice records in window and resolve knowledgePointId → nodeId via
   * KnowledgePointNodeMap (PRIMARY mapping preferred), plus per-node mastery
   * before/after from daily snapshots (fallback: current UserKnowledgeMastery
   * row as "after" when the node has no snapshot yet).
   */
  private async loadPracticeFacts(userId: string, windowStart: Date, windowEnd: Date): Promise<PracticeFactBundle> {
    if (!this.enabled) return { facts: [], unmappedRecordCount: 0, bounds: new Map() };
    const db = this.db();
    const records = await db.practiceRecord.findMany({
      where: { userId, submittedAt: { gte: windowStart, lte: windowEnd } },
      orderBy: { submittedAt: 'asc' },
      take: MAX_PRACTICE_ROWS,
      select: { questionId: true, knowledgePointId: true, correct: true, submittedAt: true },
    }) as RawPracticeRecordRow[];

    const pointIds = [...new Set(records.map((record) => record.knowledgePointId))];
    if (pointIds.length === 0) return { facts: [], unmappedRecordCount: 0, bounds: new Map() };

    const mapRows = await db.knowledgePointNodeMap.findMany({
      where: { knowledgePointId: { in: pointIds } },
      select: { knowledgePointId: true, knowledgeNodeId: true, mappingType: true },
    }) as RawNodeMapRow[];
    const nodeByPoint = resolvePointToNodeMap(mapRows);
    const facts = toPracticeFacts(records, nodeByPoint);
    const unmappedRecordCount = records.length - facts.length;
    const nodeIds = [...new Set(
      facts
        .map((fact) => fact.knowledgeNodeId)
        .filter((id): id is string => id != null),
    )];

    if (nodeIds.length === 0) return { facts, unmappedRecordCount, bounds: new Map() };

    const [snapshots, currentMastery] = await Promise.all([
      db.userMasterySnapshot.findMany({
        where: { userId, knowledgeNodeId: { in: nodeIds } },
        orderBy: { snapshotDate: 'asc' },
        select: { knowledgeNodeId: true, mastery: true, snapshotDate: true },
      }) as unknown as RawMasterySnapshotRow[],
      db.userKnowledgeMastery.findMany({
        where: { userId, knowledgeNodeId: { in: nodeIds } },
        select: { knowledgeNodeId: true, mastery: true },
      }) as unknown as Array<{ knowledgeNodeId: string; mastery: number }>,
    ]);

    const bounds = pickMasteryBounds(snapshots, nodeIds, windowStart.getTime(), windowEnd.getTime());
    // Nodes touched in the window but without any snapshot yet fall back to
    // the current mastery row as "after"; "before" stays null (unknown).
    const currentByNode = new Map(currentMastery.map((row) => [row.knowledgeNodeId, row.mastery]));
    for (const nodeId of nodeIds) {
      if (bounds.has(nodeId)) continue;
      const current = currentByNode.get(nodeId);
      if (current != null) bounds.set(nodeId, { before: null, after: current });
    }

    return { facts, unmappedRecordCount, bounds };
  }
}

function accuracyOf(correctFlags: boolean[]): number | null {
  if (correctFlags.length === 0) return null;
  const correct = correctFlags.filter(Boolean).length;
  return Math.round((correct / correctFlags.length) * 10000) / 10000;
}

/** Wrap plain mastery gains into the minimal LearningOutcome shape runExperiment reads. */
function cohortOutcomeViews(gains: number[]) {
  return gains.map((gain, index) => ({
    userId: 'cohort',
    knowledgeNodeId: null,
    interventionId: `cohort-${index}`,
    before: { mastery: null, accuracy: null, reviewSuccessRate: null, taskCompletionRate: null, practiceEfficiency: null, examScorePercent: null },
    after: { mastery: null, accuracy: null, reviewSuccessRate: null, taskCompletionRate: null, practiceEfficiency: null, examScorePercent: null },
    windowDays: 0,
    sampleSize: 1,
    confidence: 'low' as const,
    timestamp: new Date(0).toISOString(),
    deltas: {
      masteryGain: gain,
      accuracyGain: null,
      retentionDelta: null,
      reviewSuccessDelta: null,
      completionDelta: null,
      practiceEfficiencyDelta: null,
      examScoreDelta: null,
    },
  }));
}
