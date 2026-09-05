import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { studyDateKey } from './study-date';
import { AssessmentProjectionService } from './assessment-projection.service';
import { PracticeProjectionService } from './practice-projection.service';
import { StudentStateProjectionService } from './student-state-projection.service';
import { TodayPlanProjectionService } from './today-plan-projection.service';
import { WrongQuestionProjectionService } from './wrong-question-projection.service';
import {
  buildStudentContext,
  type StudentContextActivityDayFact,
  type StudentContextMasteryNodeFact,
  type StudentContextPracticeRecordFact,
  type StudentContextReviewItemFact,
  type StudentContextSessionFact,
  type StudentContextSourceFacts,
  type StudentContextTaskFact,
  type StudentContextWindows,
} from './student-context.selector';
import type { StudentContext, StudentContextEvidence } from './student-context.contract';

interface SupplementalFacts {
  user?: { name: string; role: string } | null;
  masteryNodes: StudentContextMasteryNodeFact[];
  sessions: StudentContextSessionFact[];
  taskCompletions: Array<{ completedDate: string; completedAt: string | Date }>;
  actions: Array<{ id: string; studyTaskId: string | null; createdAt: string | Date; evidenceRefs: unknown }>;
  pointSubjects: Map<string, { subject: string; chapter: string; title: string }>;
}

@Injectable()
export class StudentContextQueryService {
  constructor(
    private readonly studentStateProjection: StudentStateProjectionService,
    private readonly practiceProjection: PracticeProjectionService,
    private readonly wrongQuestionProjection: WrongQuestionProjectionService,
    private readonly todayPlanProjection: TodayPlanProjectionService,
    private readonly assessmentProjection: AssessmentProjectionService,
    @Optional() private readonly prisma?: PrismaService,
  ) {}

  async getStudentContext(userId: string, asOf: Date | string = new Date()): Promise<StudentContext> {
    return this.getContext(userId, asOf);
  }

  async getContext(userId: string, asOf: Date | string = new Date()): Promise<StudentContext> {
    const resolvedAsOf = resolveAsOf(asOf);
    const [state, practice, wrong, plan, assessment] = await Promise.all([
      this.studentStateProjection.getSnapshot(userId, resolvedAsOf),
      this.practiceProjection.getFacts(userId, resolvedAsOf),
      this.wrongQuestionProjection.getSnapshot(userId, resolvedAsOf),
      this.todayPlanProjection.getSnapshot(userId, resolvedAsOf),
      this.assessmentProjection.getFacts(userId, resolvedAsOf),
    ]);
    // Point annotation only needs the catalog rows referenced by practice
    // records; deriving the id set here keeps the supplemental query bounded.
    const pointIds = [...new Set(
      practice.records
        .map((record) => record.knowledgePointId)
        .filter((id): id is string => Boolean(id)),
    )];
    const supplemental = await this.loadSupplementalFacts(userId, resolvedAsOf, pointIds);

    const windows = buildWindows(resolvedAsOf);
    const planTasks = extractPlanTasks(plan, supplemental.actions);
    const practiceRecords = practice.records.map((record) => {
      const point = record.knowledgePointId ? supplemental.pointSubjects.get(record.knowledgePointId) : undefined;
      return {
        id: record.id,
        knowledgePointId: record.knowledgePointId,
        subject: point?.subject,
        chapter: point?.chapter,
        title: point?.title,
        submittedAt: record.submittedAt,
        correct: record.correct,
        timeSpentSec: record.timeSpentSec,
        mistakeReason: record.mistakeReason,
      } satisfies StudentContextPracticeRecordFact;
    });
    const sourceFacts: StudentContextSourceFacts = {
      user: {
        name: supplemental.user?.name ?? null,
        role: supplemental.user?.role ?? null,
        targetSchool: state.goal.targetSchool,
        weakestSubject: state.goal.weakestSubject,
        diagnosis: state.goal.diagnosis,
        examYear: state.goal.examYear,
        targetScore: state.goal.targetScore,
        currentScore: state.goal.currentScore,
        remainingDays: state.goal.remainingDays,
        studyStage: state.goal.stage,
      },
      masteryNodes: supplemental.masteryNodes.length > 0
        ? supplemental.masteryNodes
        : state.weakPoints.map(toMasteryNodeFact),
      practiceRecords,
      reviewItems: extractReviewItems(wrong),
      tasks: planTasks,
      sessions: supplemental.sessions,
      activityDays: buildActivityDays(resolvedAsOf, practiceRecords, supplemental.taskCompletions),
      recommendationEvidence: buildRecommendationEvidence(supplemental.actions),
    };
    void assessment;
    return buildStudentContext({
      userId,
      asOf: resolvedAsOf,
      todayDate: studyDateKey(resolvedAsOf),
      windows,
      sourceFacts,
    });
  }

  private async loadSupplementalFacts(userId: string, asOf: Date, pointIds: string[]): Promise<SupplementalFacts> {
    const empty: SupplementalFacts = { masteryNodes: [], sessions: [], taskCompletions: [], actions: [], pointSubjects: new Map() };
    if (!this.prisma || !process.env.DATABASE_URL) return empty;
    const db = this.prisma as PrismaService & Record<string, any>;
    // Read bounds (SC-5 TASK 1): sessions only feed recentSessions (top 10),
    // completions only feed the 7-day activity window (8d margin for date-key
    // edges), actions feed the bounded evidence window; the catalog annotation
    // query is scoped to the points actually practiced.
    const activityWindowStart = new Date(asOf.getTime() - 8 * 86_400_000);
    const [user, masteryRows, sessions, taskCompletions, actions, points] = await Promise.all([
      db.user?.findUnique?.({ where: { id: userId }, select: { name: true, role: true } }),
      db.userKnowledgeMastery?.findMany?.({
        where: { userId },
        orderBy: { knowledgeNodeId: 'asc' },
        select: {
          knowledgeNodeId: true,
          mastery: true,
          attempts: true,
          correctCount: true,
          wrongCount: true,
          updatedAt: true,
          knowledgeNode: {
            select: {
              subject: true,
              name: true,
              parent: { select: { name: true, parent: { select: { name: true } } } },
            },
          },
        },
      }) ?? [],
      db.learningSession?.findMany?.({ where: { userId, startedAt: { lte: asOf } }, orderBy: { lastActiveAt: 'desc' }, take: 10, select: { id: true, actionId: true, type: true, startedAt: true, lastActiveAt: true, completed: true } }) ?? [],
      db.studyTaskCompletion?.findMany?.({ where: { userId, completedAt: { lte: asOf, gte: activityWindowStart } }, orderBy: { completedAt: 'asc' }, select: { completedDate: true, completedAt: true } }) ?? [],
      db.recommendationAction?.findMany?.({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 200, select: { id: true, studyTaskId: true, createdAt: true, evidenceRefs: true } }) ?? [],
      db.knowledgePoint?.findMany?.({ where: { id: { in: pointIds } }, select: { id: true, subject: true, chapter: true, title: true } }) ?? [],
    ]);
    const pointSubjects = new Map<string, { subject: string; chapter: string; title: string }>();
    for (const point of points ?? []) pointSubjects.set(point.id, { subject: point.subject, chapter: point.chapter, title: point.title });
    return {
      user: user ? { name: user.name, role: String(user.role) } : null,
      masteryNodes: (masteryRows ?? []).map((row: any) => ({
        knowledgeNodeId: row.knowledgeNodeId,
        subject: row.knowledgeNode?.subject ?? '',
        chapter: row.knowledgeNode?.parent?.parent?.name ?? row.knowledgeNode?.parent?.name ?? '',
        title: row.knowledgeNode?.name ?? row.knowledgeNodeId,
        mastery: row.mastery,
        accuracy: row.attempts > 0 ? row.correctCount / row.attempts : null,
        attempts: row.attempts,
        correctCount: row.correctCount,
        wrongCount: row.wrongCount,
        updatedAt: row.updatedAt,
      })),
      sessions: (sessions ?? []).map((session: any) => ({
        learningSessionId: session.id,
        actionId: session.actionId ?? null,
        type: session.type,
        startedAt: session.startedAt,
        lastActiveAt: session.lastActiveAt,
        completed: session.completed,
      })),
      taskCompletions: (taskCompletions ?? []).map((completion: any) => ({ completedDate: completion.completedDate, completedAt: completion.completedAt })),
      actions: (actions ?? []).map((action: any) => ({ id: action.id, studyTaskId: action.studyTaskId ?? null, createdAt: action.createdAt, evidenceRefs: action.evidenceRefs })),
      pointSubjects,
    };
  }
}

function resolveAsOf(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid asOf');
  return date;
}

function buildWindows(asOf: Date): StudentContextWindows {
  const endAt = asOf.toISOString();
  return {
    last7d: buildTimeWindow(asOf, 7),
    last30d: buildTimeWindow(asOf, 30),
    activity: buildTimeWindow(asOf, 7),
  };

  function buildTimeWindow(end: Date, days: number) {
    const start = new Date(end.getTime() - days * 86_400_000);
    const baselineEnd = start.toISOString();
    const baselineStart = new Date(start.getTime() - days * 86_400_000).toISOString();
    return { startAt: start.toISOString(), endAt, baselineStartAt: baselineStart, baselineEndAt: baselineEnd };
  }
}

function toMasteryNodeFact(point: {
  knowledgeNodeId: string;
  subject: string;
  chapter: string;
  title: string;
  masteryRate: number;
  accuracyRate: number;
  attempts: number;
  wrongCount: number;
}) : StudentContextMasteryNodeFact {
  return {
    knowledgeNodeId: point.knowledgeNodeId,
    subject: point.subject,
    chapter: point.chapter,
    title: point.title,
    mastery: point.masteryRate / 100,
    accuracy: point.accuracyRate / 100,
    attempts: point.attempts,
    correctCount: Math.max(0, point.attempts - point.wrongCount),
    wrongCount: point.wrongCount,
    status: 'weak',
  };
}

function extractReviewItems(snapshot: any): StudentContextReviewItemFact[] {
  return (snapshot.dueItems ?? []).map((item: any) => ({
    questionId: item.questionId,
    knowledgePointId: item.knowledgePointId ?? null,
    dueAt: item.nextReviewAt,
    overdue: item.nextReviewAt <= snapshot.asOf,
    wrongCount: item.consecutiveCorrect === 0 ? 1 : 0,
    stability: item.stability,
  }));
}

function extractPlanTasks(snapshot: any, actions: SupplementalFacts['actions']): StudentContextTaskFact[] {
  const actionByTask = new Map(actions.filter((action) => action.studyTaskId).map((action) => [action.studyTaskId!, action.id]));
  const planId = snapshot.planFacts?.planId ?? null;
  return (snapshot.taskFacts?.todayTasks ?? []).map((task: any) => ({
    studyTaskId: task.id,
    actionId: actionByTask.get(task.id) ?? null,
    planId,
    title: task.title,
    status: task.status,
    scheduledDate: task.scheduledDate,
    completed: task.completed,
    completedAt: task.completedAt,
    knowledgePointId: task.knowledgePointId ?? null,
    knowledgeNodeId: task.knowledgeNodeId ?? null,
    minutes: task.minutes,
    questionCount: task.questionCount,
  }));
}

function buildActivityDays(asOf: Date, records: StudentContextPracticeRecordFact[], completions: SupplementalFacts['taskCompletions']): StudentContextActivityDayFact[] {
  const days: StudentContextActivityDayFact[] = [];
  const anchor = new Date(asOf);
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(anchor.getTime() - offset * 86_400_000);
    const dateKey = studyDateKey(date);
    const practiceCount = records.filter((record) => studyDateKey(record.submittedAt) === dateKey).length;
    const completedTaskCount = completions.filter((completion) => completion.completedDate === dateKey).length;
    days.push({ date: dateKey, practiceCount, completedTaskCount, isActive: practiceCount + completedTaskCount > 0 });
  }
  return days;
}

function buildRecommendationEvidence(actions: SupplementalFacts['actions']): StudentContextEvidence[] {
  const evidence: StudentContextEvidence[] = [];
  for (const action of actions) {
    evidence.push({ source: 'recommendation_action', timestamp: toIso(action.createdAt), actionId: action.id, studyTaskId: action.studyTaskId ?? undefined, referenceId: action.id });
    if (!Array.isArray(action.evidenceRefs)) continue;
    for (const ref of action.evidenceRefs) {
      if (typeof ref !== 'object' || ref === null || Array.isArray(ref)) continue;
      const value = ref as Record<string, unknown>;
      evidence.push({
        source: String(value.source ?? value.kind ?? 'recommendation_action'),
        timestamp: typeof value.timestamp === 'string' ? value.timestamp : typeof value.occurredAt === 'string' ? value.occurredAt : toIso(action.createdAt),
        actionId: action.id,
        studyTaskId: action.studyTaskId ?? undefined,
        knowledgeNodeId: typeof value.knowledgeNodeId === 'string' ? value.knowledgeNodeId : undefined,
        knowledgePointId: typeof value.knowledgePointId === 'string' ? value.knowledgePointId : undefined,
        referenceId: typeof value.referenceId === 'string' ? value.referenceId : typeof value.id === 'string' ? value.id : undefined,
      });
    }
  }
  return evidence;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}
