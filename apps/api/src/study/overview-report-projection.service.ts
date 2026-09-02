import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildOverviewReportSnapshot,
  type OverviewGoalFacts,
  type OverviewKnowledgePointFact,
  type OverviewMasteryNodeFact,
  type OverviewPracticeFact,
} from './overview-report.snapshot';
import { OverviewReportSelector } from './overview-report.selector';

export type OverviewWindowKey = 'today' | 'last7d' | 'last30d' | 'allTime';
export type OverviewStatus = 'up' | 'down' | 'flat' | 'insufficient_data';

export interface OverviewWindow {
  key: OverviewWindowKey;
  fromInclusive: string | null;
  toExclusive: string;
  timezone: 'UTC';
}

export interface ProgressMetric {
  metric: 'accuracy' | 'assessment_score';
  window: OverviewWindow | { key: 'assessmentPeriod'; fromInclusive: string | null; toExclusive: string; timezone: 'UTC' };
  current: number | null;
  baseline: number | null;
  delta: number | null;
  sampleSize: number;
  status: OverviewStatus;
  evidence: EvidenceRef[];
}

export interface EvidenceRef {
  kind: string;
  id: string;
  occurredAt?: string;
  idType?: 'knowledgePointId' | 'knowledgeNodeId' | 'questionId' | 'assessmentId' | 'studyTaskId';
  knowledgePointId?: string;
  knowledgeNodeId?: string;
}

export interface OverviewReportV1 {
  contractVersion: 'overview-report-v1';
  userId: string;
  asOf: string;
  generatedAt: string;
  source: 'overview_report_projection' | 'empty';
  windows: Record<OverviewWindowKey, OverviewWindow>;
  summary: {
    goal: OverviewGoalFacts;
    learningState: 'stable' | 'rising' | 'risky' | 'insufficient_data';
    dataQuality: { status: 'ready' | 'insufficient_data'; reasons: string[] };
  };
  mastery: {
    source: 'user_knowledge_mastery' | 'empty';
    averageMastery: number | null;
    nodeCount: number;
    practicedNodeCount: number;
    weakCount: number;
    reviewCount: number;
    masteredCount: number;
    lastUpdatedAt: string | null;
    nodes: Array<{
      knowledgeNodeId: string;
      title: string;
      subject: string;
      chapter: string;
      masteryRate: number | null;
      accuracyRate: number | null;
      attempts: number;
      wrongCount: number;
      status: OverviewMasteryNodeFact['status'];
      evidence: EvidenceRef[];
    }>;
  };
  weaknesses: {
    nodeWeaknesses: Array<{ idType: 'knowledgeNodeId'; knowledgeNodeId: string; title: string; masteryRate: number; weaknessScore: number; attempts: number; wrongCount: number; evidence: EvidenceRef[] }>;
    practiceWeaknesses: Array<{ idType: 'knowledgePointId'; knowledgePointId: string; title: string; accuracyRate: number; wrongCount: number; attempts: number; topReason: string | null; weaknessScore: number; evidence: EvidenceRef[] }>;
    speedRisks: Array<{ idType: 'knowledgePointId'; knowledgePointId: string; title: string; attempts: number; slowCount: number; evidence: EvidenceRef[] }>;
  };
  practicePerformance: Record<OverviewWindowKey, PracticeWindowMetrics>;
  progress: { last7d: ProgressMetric; last30d: ProgressMetric; allTime: ProgressMetric; assessmentScore: ProgressMetric };
  assessmentPerformance: {
    latest: AssessmentMetric | null;
    previous: AssessmentMetric | null;
    trend: OverviewStatus;
    sampleSize: number;
    evidence: EvidenceRef[];
  };
  reviewStatus: OverviewReviewStatus;
  recommendedActions: OverviewRecommendedAction[];
  evidence: { refs: EvidenceRef[]; generatedBy: 'overview_report_projection' };
}

export interface PracticeWindowMetrics {
  window: OverviewWindow;
  attemptCount: number;
  correctCount: number;
  accuracyRate: number | null;
  averageTimeSpentSec: number | null;
  slowAttemptCount: number;
  mistakeReasons: Array<{ reason: string; count: number; share: number }>;
  evidence: EvidenceRef[];
  dataStatus: 'ready' | 'insufficient_data';
}

export interface AssessmentMetric {
  assessmentId: string | null;
  sessionId: string | null;
  score: number;
  accuracyRate: number | null;
  submittedAt: string;
}

export interface OverviewReviewStatus {
  todayDueCount: number;
  overdueCount: number;
  pendingWrongQuestionCount: number;
  reviewedWrongQuestionCount: number;
  resolvedWrongQuestionCount: number;
  reviewAttemptCount: number;
  nextReviewAt: string | null;
  evidence: EvidenceRef[];
  dataStatus: 'ready' | 'insufficient_data';
}

export interface OverviewRecommendedAction {
  actionId: string;
  actionType: 'learn' | 'practice' | 'review' | 'assessment' | 'continue_task';
  title: string;
  reasonCodes: string[];
  target?: { knowledgeNodeId?: string; knowledgePointId?: string; questionIds?: string[]; studyTaskId?: string };
  source: 'recommendation_engine' | 'study_task' | 'review_schedule' | 'fallback';
  evidence: EvidenceRef[];
  status: 'available' | 'completed' | 'blocked' | 'insufficient_data';
}

export interface OverviewProjectionInput {
  userId: string;
  asOf: Date | string;
  goalFacts?: Partial<OverviewGoalFacts> | null;
  practiceRecords?: Array<Partial<Omit<OverviewPracticeFact, 'submittedAt'>> & Pick<OverviewPracticeFact, 'id' | 'questionId' | 'knowledgePointId' | 'correct'> & { submittedAt: Date | string }>;
  knowledgePoints?: Array<Partial<OverviewKnowledgePointFact> & Pick<OverviewKnowledgePointFact, 'id'>>;
  masteryRows?: MasteryInput[];
  assessments?: Array<{ id: string; sessionId?: string | null; score: number; accuracyRate?: number | null; submittedAt: Date | string }>;
  review?: Partial<OverviewReviewStatus> | null;
  actions?: ActionInput[];
}

type MasteryInput = { id?: string; knowledgeNodeId: string; masteryRate?: number | null; mastery?: number; title?: string; subject?: string; chapter?: string; accuracyRate?: number | null; attempts?: number; correctCount?: number; wrongCount?: number; status?: OverviewMasteryNodeFact['status']; updatedAt?: Date | string | null };
type ActionInput = { id: string; actionType: OverviewRecommendedAction['actionType']; title?: string; reasonCodes?: string[]; knowledgeNodeId?: string; knowledgePointId?: string; questionIds?: string[]; studyTaskId?: string; source?: OverviewRecommendedAction['source']; evidence?: EvidenceRef[]; status?: OverviewRecommendedAction['status'] };

export function buildOverviewReportProjection(input: OverviewProjectionInput): OverviewReportV1 {
  const asOf = new Date(input.asOf);
  const asOfIso = asOf.toISOString();
  const windows = buildWindows(asOf);
  const records = (input.practiceRecords ?? []).map((record) => ({
    id: record.id,
    questionId: record.questionId,
    knowledgePointId: record.knowledgePointId,
    submittedAt: new Date(record.submittedAt).toISOString(),
    correct: record.correct,
    timeSpentSec: record.timeSpentSec ?? 0,
    expectedTimeSec: record.expectedTimeSec ?? 0,
    mistakeReason: record.mistakeReason ?? null,
  })).filter((record) => new Date(record.submittedAt).getTime() <= asOf.getTime());
  const points = (input.knowledgePoints ?? []).map((point) => ({
    id: point.id,
    subject: point.subject ?? '',
    chapter: point.chapter ?? '',
    title: point.title ?? point.id,
    importance: point.importance ?? 3,
    frequency: point.frequency ?? 3,
    prerequisites: point.prerequisites ?? [],
  }));
  const masteryNodes = (input.masteryRows ?? []).map(normalizeMasteryRow);
  const snapshot = buildOverviewReportSnapshot({
    userId: input.userId,
    asOf,
    goalFacts: { ...emptyGoal(), ...(input.goalFacts ?? {}) },
    practiceFacts: {
      totalCount: records.length,
      correctCount: records.filter((record) => record.correct).length,
      accuracyRate: records.length ? percent(records.filter((record) => record.correct).length, records.length) : 0,
      averageTimeSpentSec: records.length ? average(records.map((record) => record.timeSpentSec)) : 0,
      records,
    },
    knowledgePointFacts: points,
    masteryFacts: buildMasteryFacts(masteryNodes),
  });
  const selection = new OverviewReportSelector().select(snapshot);
  const pointTitles = new Map(points.map((point) => [point.id, point.title]));
  const mastery = buildMastery(masteryNodes);
  const weaknesses = {
    nodeWeaknesses: selection.masteryWeakCandidates.map((candidate) => {
      const row = masteryNodes.find((item) => item.knowledgeNodeId === candidate.knowledgeNodeId);
      return {
        idType: 'knowledgeNodeId' as const,
        knowledgeNodeId: candidate.knowledgeNodeId,
        title: row?.title ?? candidate.knowledgeNodeId,
        masteryRate: candidate.masteryRate,
        weaknessScore: candidate.weaknessScore,
        attempts: candidate.attempts,
        wrongCount: candidate.wrongCount,
        evidence: row?.id ? [masteryEvidence(row)] : [],
      };
    }),
    practiceWeaknesses: selection.weakPointSelection.candidates.map((candidate) => ({
      idType: 'knowledgePointId' as const,
      knowledgePointId: candidate.knowledgePointId,
      title: pointTitles.get(candidate.knowledgePointId) ?? candidate.knowledgePointId,
      accuracyRate: candidate.accuracyRate,
      wrongCount: candidate.wrongCount,
      attempts: candidate.attempts,
      topReason: candidate.topReason,
      weaknessScore: candidate.weaknessScore,
      evidence: candidate.evidenceRecordIds.map((id) => practiceEvidence(records.find((record) => record.id === id))),
    })),
    speedRisks: selection.speedRiskSelection.candidates.map((candidate) => ({
      idType: 'knowledgePointId' as const,
      knowledgePointId: candidate.knowledgePointId,
      title: pointTitles.get(candidate.knowledgePointId) ?? candidate.knowledgePointId,
      attempts: candidate.attempts,
      slowCount: candidate.slowCount,
      evidence: candidate.evidenceRecordIds.map((id) => practiceEvidence(records.find((record) => record.id === id))),
    })),
  };
  const practicePerformance = buildPracticePerformance(records, windows);
  const assessmentPerformance = buildAssessmentPerformance(input.assessments ?? []);
  const progress = buildProgress(records, windows, assessmentPerformance);
  const reviewStatus = buildReviewStatus(input.review);
  const recommendedActions = (input.actions ?? []).map(toRecommendedAction);
  const refs = uniqueEvidence([
    ...Object.values(mastery).flatMap((value) => Array.isArray(value) ? value.flatMap((item) => item.evidence ?? []) : []),
    ...weaknesses.nodeWeaknesses.flatMap((item) => item.evidence),
    ...weaknesses.practiceWeaknesses.flatMap((item) => item.evidence),
    ...weaknesses.speedRisks.flatMap((item) => item.evidence),
    ...Object.values(practicePerformance).flatMap((metric) => metric.evidence),
    ...assessmentPerformance.evidence,
    ...reviewStatus.evidence,
    ...recommendedActions.flatMap((action) => action.evidence),
  ]);
  const hasData = records.length > 0 || masteryNodes.length > 0 || (input.assessments ?? []).length > 0;
  return {
    contractVersion: 'overview-report-v1',
    userId: input.userId,
    asOf: asOfIso,
    generatedAt: asOfIso,
    source: hasData ? 'overview_report_projection' : 'empty',
    windows,
    summary: {
      goal: snapshot.goalFacts,
      learningState: deriveLearningState(practicePerformance, masteryNodes.length),
      dataQuality: { status: hasData ? 'ready' : 'insufficient_data', reasons: hasData ? [] : ['no_learning_facts'] },
    },
    mastery,
    weaknesses,
    practicePerformance,
    progress,
    assessmentPerformance,
    reviewStatus,
    recommendedActions,
    evidence: { refs, generatedBy: 'overview_report_projection' },
  };
}

@Injectable()
export class OverviewReportProjectionService {
  constructor(private readonly prisma: PrismaService) {}

  async buildOverview(userId: string, asOf = new Date()): Promise<OverviewReportV1> {
    if (!process.env.DATABASE_URL) return buildOverviewReportProjection({ userId, asOf });
    const [user, practiceRows, points, masteryRows, assessments, wrongReviews, schedules, attempts, tasks] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { targetScore: true, currentScore: true, remainingDays: true, studyStage: true, weakestSubject: true } }),
      this.prisma.practiceRecord.findMany({ where: { userId, submittedAt: { lte: asOf } }, select: { id: true, questionId: true, knowledgePointId: true, submittedAt: true, correct: true, timeSpentSec: true, expectedTimeSec: true, mistakeReason: true } }),
      this.prisma.knowledgePoint.findMany({ select: { id: true, subject: true, chapter: true, title: true, importance: true, frequency: true, prerequisites: true } }),
      this.prisma.userKnowledgeMastery.findMany({ where: { userId }, include: { knowledgeNode: { select: { name: true, subject: true, parent: { select: { name: true, parent: { select: { name: true } } } } } } } }),
      this.prisma.assessmentHistoryItem.findMany({ where: { userId, submittedAt: { lte: asOf } }, select: { id: true, sessionId: true, score: true, accuracyRate: true, submittedAt: true } }),
      this.prisma.wrongQuestionReview.findMany({ where: { userId }, select: { id: true, reviewedAt: true, resolved: true, resolvedAt: true } }),
      this.prisma.reviewSchedule.findMany({ where: { userId }, select: { id: true, nextReviewAt: true } }),
      this.prisma.reviewAttempt.findMany({ where: { schedule: { userId }, reviewedAt: { lte: asOf } }, select: { id: true, reviewedAt: true } }),
      this.prisma.studyTask.findMany({ where: { plan: { userId, status: 'ACTIVE' } }, select: { id: true, title: true, mode: true, status: true, completed: true, knowledgeNodeId: true, knowledgePointId: true, reasonCodes: true } }),
    ]);
    const review = buildReviewInput(wrongReviews, schedules, attempts, asOf);
    return buildOverviewReportProjection({
      userId,
      asOf,
      goalFacts: user,
      practiceRecords: practiceRows,
      knowledgePoints: points,
      masteryRows: masteryRows.map((row) => ({ id: row.id, knowledgeNodeId: row.knowledgeNodeId, title: row.knowledgeNode.name, subject: row.knowledgeNode.subject, chapter: row.knowledgeNode.parent?.parent?.name ?? row.knowledgeNode.parent?.name ?? '', mastery: row.mastery, attempts: row.attempts, correctCount: row.correctCount, wrongCount: row.wrongCount, updatedAt: row.updatedAt, status: undefined })),
      assessments,
      review,
      actions: tasks.map((task) => ({ id: task.id, actionType: actionType(task.mode), title: task.title, knowledgeNodeId: task.knowledgeNodeId ?? undefined, knowledgePointId: task.knowledgePointId, reasonCodes: Array.isArray(task.reasonCodes) ? task.reasonCodes as string[] : [], source: 'study_task' as const, status: task.completed ? 'completed' as const : 'available' as const })),
    });
  }
}

function buildWindows(asOf: Date): Record<OverviewWindowKey, OverviewWindow> {
  const day = new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate()));
  const next = addDays(day, 1);
  return {
    today: window('today', day, next),
    last7d: window('last7d', addDays(day, -6), next),
    last30d: window('last30d', addDays(day, -29), next),
    allTime: { key: 'allTime', fromInclusive: null, toExclusive: asOf.toISOString(), timezone: 'UTC' },
  };
}

function window(key: OverviewWindowKey, from: Date, to: Date): OverviewWindow {
  return { key, fromInclusive: from.toISOString(), toExclusive: to.toISOString(), timezone: 'UTC' };
}

function buildPracticePerformance(records: OverviewPracticeFact[], windows: Record<OverviewWindowKey, OverviewWindow>): Record<OverviewWindowKey, PracticeWindowMetrics> {
  return (Object.keys(windows) as OverviewWindowKey[]).reduce((result, key) => {
    const current = records.filter((record) => inWindow(record.submittedAt, windows[key]));
    const reasons = new Map<string, number>();
    current.forEach((record) => record.mistakeReason && reasons.set(record.mistakeReason, (reasons.get(record.mistakeReason) ?? 0) + 1));
    result[key] = {
      window: windows[key],
      attemptCount: current.length,
      correctCount: current.filter((record) => record.correct).length,
      accuracyRate: current.length ? percent(current.filter((record) => record.correct).length, current.length) : null,
      averageTimeSpentSec: current.length ? average(current.map((record) => record.timeSpentSec)) : null,
      slowAttemptCount: current.filter((record) => record.expectedTimeSec > 0 && record.timeSpentSec > record.expectedTimeSec * 1.45).length,
      mistakeReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([reason, count]) => ({ reason, count, share: percent(count, current.length) })),
      evidence: current.map((record) => practiceEvidence(record)),
      dataStatus: current.length ? 'ready' : 'insufficient_data',
    };
    return result;
  }, {} as Record<OverviewWindowKey, PracticeWindowMetrics>);
}

function buildProgress(records: OverviewPracticeFact[], windows: Record<OverviewWindowKey, OverviewWindow>, assessment: OverviewReportV1['assessmentPerformance']): OverviewReportV1['progress'] {
  const metric = (key: 'last7d' | 'last30d' | 'allTime'): ProgressMetric => {
    const currentWindow = windows[key];
    const current = records.filter((record) => inWindow(record.submittedAt, currentWindow));
    const size = key === 'last7d' ? 7 : key === 'last30d' ? 30 : null;
    const baselineWindow = size == null ? null : window(key, addDays(new Date(currentWindow.fromInclusive!), -size), new Date(currentWindow.fromInclusive!));
    const baselineRecords = baselineWindow ? records.filter((record) => inWindow(record.submittedAt, baselineWindow)) : [];
    const currentValue = current.length ? percent(current.filter((record) => record.correct).length, current.length) : null;
    const baselineValue = baselineWindow && baselineRecords.length ? percent(baselineRecords.filter((record) => record.correct).length, baselineRecords.length) : null;
    return { metric: 'accuracy', window: currentWindow, current: currentValue, baseline: baselineValue, delta: currentValue != null && baselineValue != null ? round1(currentValue - baselineValue) : null, sampleSize: current.length, status: currentValue != null && baselineValue != null ? trend(currentValue, baselineValue) : 'insufficient_data', evidence: current.map(practiceEvidence) };
  };
  const assessmentItems = assessment.latest && assessment.previous ? [assessment.latest, assessment.previous] : assessment.latest ? [assessment.latest] : [];
  const assessmentWindow = assessmentItems.length ? { key: 'assessmentPeriod' as const, fromInclusive: assessmentItems[assessmentItems.length - 1].submittedAt, toExclusive: addDays(new Date(assessmentItems[0].submittedAt), 1).toISOString(), timezone: 'UTC' as const } : { key: 'assessmentPeriod' as const, fromInclusive: null, toExclusive: windows.allTime.toExclusive, timezone: 'UTC' as const };
  const assessmentCurrent = assessment.latest?.score ?? null;
  const assessmentBaseline = assessment.previous?.score ?? null;
  return {
    last7d: metric('last7d'),
    last30d: metric('last30d'),
    allTime: metric('allTime'),
    assessmentScore: { metric: 'assessment_score', window: assessmentWindow, current: assessmentCurrent, baseline: assessmentBaseline, delta: assessmentCurrent != null && assessmentBaseline != null ? round1(assessmentCurrent - assessmentBaseline) : null, sampleSize: assessment.sampleSize, status: assessmentCurrent != null && assessmentBaseline != null ? trend(assessmentCurrent, assessmentBaseline) : 'insufficient_data', evidence: assessment.evidence },
  };
}

function buildMasteryFacts(rows: OverviewMasteryNodeFact[]) {
  return { source: rows.length ? 'user_knowledge_mastery' as const : 'empty' as const, nodeCount: rows.length, practicedNodeCount: rows.filter((row) => row.attempts > 0).length, averageMastery: rows.length ? average(rows.map((row) => row.masteryRate)) : 0, weakCount: rows.filter((row) => row.status === 'weak').length, reviewCount: rows.filter((row) => row.status === 'review').length, masteredCount: rows.filter((row) => row.status === 'mastered').length, lastUpdatedAt: rows.map((row) => row.updatedAt).filter(Boolean).sort().at(-1) ?? null, nodes: rows };
}

function buildMastery(rows: ReturnType<typeof normalizeMasteryRow>[]) {
  return { source: rows.length ? 'user_knowledge_mastery' as const : 'empty' as const, averageMastery: rows.length ? average(rows.map((row) => row.masteryRate)) : null, nodeCount: rows.length, practicedNodeCount: rows.filter((row) => row.attempts > 0).length, weakCount: rows.filter((row) => row.status === 'weak').length, reviewCount: rows.filter((row) => row.status === 'review').length, masteredCount: rows.filter((row) => row.status === 'mastered').length, lastUpdatedAt: rows.map((row) => row.updatedAt).filter(Boolean).sort().at(-1) ?? null, nodes: rows.map((row) => ({ knowledgeNodeId: row.knowledgeNodeId, title: row.title, subject: row.subject, chapter: row.chapter, masteryRate: row.masteryRate, accuracyRate: row.accuracyRate, attempts: row.attempts, wrongCount: row.wrongCount, status: row.status, evidence: row.id ? [masteryEvidence(row)] : [] })) };
}

function normalizeMasteryRow(row: MasteryInput): OverviewMasteryNodeFact & { id?: string; title: string; subject: string; chapter: string; accuracyRate: number | null } {
  const raw = row.masteryRate ?? (row.mastery != null ? (row.mastery <= 1 ? row.mastery * 100 : row.mastery) : null);
  const masteryRate = raw == null ? 0 : Math.max(0, Math.min(100, raw));
  const attempts = row.attempts ?? 0;
  const correctCount = row.correctCount ?? Math.max(0, attempts - (row.wrongCount ?? 0));
  return { id: row.id, knowledgeNodeId: row.knowledgeNodeId, title: row.title ?? row.knowledgeNodeId, subject: row.subject ?? '', chapter: row.chapter ?? '', masteryRate, accuracyRate: row.accuracyRate ?? (attempts ? percent(correctCount, attempts) : null), attempts, correctCount, wrongCount: row.wrongCount ?? 0, status: row.status ?? (attempts === 0 ? 'untouched' : masteryRate < 45 ? 'weak' : masteryRate < 75 ? 'review' : 'mastered'), updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null };
}

function buildAssessmentPerformance(items: NonNullable<OverviewProjectionInput['assessments']> = []): OverviewReportV1['assessmentPerformance'] {
  const sorted = [...items].map((item) => ({ ...item, submittedAt: new Date(item.submittedAt).toISOString() })).sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  const toMetric = (item: (typeof sorted)[number]): AssessmentMetric => ({ assessmentId: item.id, sessionId: item.sessionId ?? null, score: item.score, accuracyRate: item.accuracyRate ?? null, submittedAt: item.submittedAt });
  const latest = sorted[0] ? toMetric(sorted[0]) : null;
  const previous = sorted[1] ? toMetric(sorted[1]) : null;
  return { latest, previous, trend: latest && previous ? latest.score > previous.score ? 'up' : latest.score < previous.score ? 'down' : 'flat' : 'insufficient_data', sampleSize: sorted.length, evidence: sorted.slice(0, 2).map((item) => ({ kind: 'assessment_item', id: item.id, idType: 'assessmentId' as const, occurredAt: item.submittedAt })) };
}

function buildReviewStatus(review?: Partial<OverviewReviewStatus> | null): OverviewReviewStatus {
  return { todayDueCount: review?.todayDueCount ?? 0, overdueCount: review?.overdueCount ?? 0, pendingWrongQuestionCount: review?.pendingWrongQuestionCount ?? 0, reviewedWrongQuestionCount: review?.reviewedWrongQuestionCount ?? 0, resolvedWrongQuestionCount: review?.resolvedWrongQuestionCount ?? 0, reviewAttemptCount: review?.reviewAttemptCount ?? 0, nextReviewAt: review?.nextReviewAt ?? null, evidence: review?.evidence ?? [], dataStatus: review?.dataStatus ?? 'ready' };
}

function toRecommendedAction(action: ActionInput): OverviewRecommendedAction {
  const target = { ...(action.knowledgeNodeId ? { knowledgeNodeId: action.knowledgeNodeId } : {}), ...(action.knowledgePointId ? { knowledgePointId: action.knowledgePointId } : {}), ...(action.questionIds ? { questionIds: action.questionIds } : {}), ...((action.studyTaskId || action.source === 'study_task' || !action.source) ? { studyTaskId: action.studyTaskId ?? action.id } : {}) };
  return { actionId: action.id, actionType: action.actionType, title: action.title ?? action.id, reasonCodes: action.reasonCodes ?? [], ...(Object.values(target).some(Boolean) ? { target } : {}), source: action.source ?? 'study_task', evidence: action.evidence ?? [{ kind: action.source === 'recommendation_engine' ? 'recommendation_result' : 'study_task', id: action.id, idType: 'studyTaskId' }], status: action.status ?? 'available' };
}

function buildReviewInput(wrong: Array<{ id: string; reviewedAt: Date; resolved: boolean | null; resolvedAt: Date | null }>, schedules: Array<{ id: string; nextReviewAt: Date }>, attempts: Array<{ id: string; reviewedAt: Date }>, asOf: Date): Partial<OverviewReviewStatus> {
  const dayEnd = addDays(new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())), 1);
  return { todayDueCount: schedules.filter((row) => row.nextReviewAt >= new Date(Date.UTC(asOf.getUTCFullYear(), asOf.getUTCMonth(), asOf.getUTCDate())) && row.nextReviewAt < dayEnd).length, overdueCount: schedules.filter((row) => row.nextReviewAt < asOf).length, pendingWrongQuestionCount: wrong.filter((row) => row.resolved !== true).length, reviewedWrongQuestionCount: wrong.filter((row) => row.reviewedAt <= asOf).length, resolvedWrongQuestionCount: wrong.filter((row) => row.resolved === true).length, reviewAttemptCount: attempts.length, nextReviewAt: schedules.map((row) => row.nextReviewAt).filter((date) => date >= asOf).sort((a, b) => a.getTime() - b.getTime())[0]?.toISOString() ?? null, evidence: [...wrong.map((row) => ({ kind: 'wrong_question_review', id: row.id })), ...schedules.map((row) => ({ kind: 'review_schedule', id: row.id })), ...attempts.map((row) => ({ kind: 'review_attempt', id: row.id }))] };
}

function deriveLearningState(metrics: Record<OverviewWindowKey, PracticeWindowMetrics>, masteryCount: number): OverviewReportV1['summary']['learningState'] {
  if (!metrics.last30d.attemptCount && !masteryCount) return 'insufficient_data';
  if (metrics.last30d.accuracyRate == null) return 'insufficient_data';
  return metrics.last30d.accuracyRate >= 75 ? 'stable' : 'risky';
}

function practiceEvidence(record?: OverviewPracticeFact): EvidenceRef { return { kind: 'practice_record', id: record?.id ?? 'unknown', idType: 'knowledgePointId', knowledgePointId: record?.knowledgePointId }; }
function masteryEvidence(row: { id?: string; knowledgeNodeId: string; updatedAt: string | null }): EvidenceRef { return { kind: 'mastery_row', id: row.id ?? row.knowledgeNodeId, idType: 'knowledgeNodeId', knowledgeNodeId: row.knowledgeNodeId, ...(row.updatedAt ? { occurredAt: row.updatedAt } : {}) }; }
function inWindow(value: string, range: OverviewWindow): boolean { const time = new Date(value).getTime(); return (range.fromInclusive == null || time >= new Date(range.fromInclusive).getTime()) && time < new Date(range.toExclusive).getTime(); }
function emptyGoal(): OverviewGoalFacts { return { targetScore: null, currentScore: null, remainingDays: null, studyStage: null, weakestSubject: null }; }
function percent(numerator: number, denominator: number): number { return Math.round((numerator / denominator) * 1000) / 10; }
function average(values: number[]): number { return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10; }
function round1(value: number): number { return Math.round(value * 10) / 10; }
function trend(current: number, baseline: number): OverviewStatus { return current > baseline ? 'up' : current < baseline ? 'down' : 'flat'; }
function addDays(value: Date, days: number): Date { const result = new Date(value); result.setUTCDate(result.getUTCDate() + days); return result; }
function uniqueEvidence(refs: EvidenceRef[]): EvidenceRef[] { const seen = new Set<string>(); return refs.filter((ref) => { const key = `${ref.kind}:${ref.id}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
function actionType(mode?: string): OverviewRecommendedAction['actionType'] { if (mode === 'review') return 'review'; if (mode === 'assessment') return 'assessment'; if (mode === 'learn') return 'learn'; return 'practice'; }
