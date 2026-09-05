import {
  createInsufficientTrend,
  createSufficientTrend,
  STUDENT_CONTEXT_VERSION,
  type StudentContext,
  type StudentContextEvidence,
  type StudentContextFreshness,
  type StudentContextHighRiskQuestion,
  type StudentContextMastery,
  type StudentContextNodeMastery,
  type StudentContextPlan,
  type StudentContextPractice,
  type StudentContextPracticeWeakness,
  type StudentContextReview,
  type StudentContextSession,
  type StudentContextTask,
  type StudentContextTrend,
  type StudentContextWindow,
} from './student-context.contract';

export interface StudentContextTimeWindow {
  readonly startAt: string;
  readonly endAt: string;
  readonly baselineStartAt?: string;
  readonly baselineEndAt?: string;
}

export interface StudentContextWindows {
  readonly last7d: StudentContextTimeWindow;
  readonly last30d: StudentContextTimeWindow;
  readonly activity: StudentContextTimeWindow;
}

export interface StudentContextUserFacts {
  readonly name?: string | null;
  readonly role?: string | null;
  readonly targetSchool?: string | null;
  readonly weakestSubject?: string | null;
  readonly diagnosis?: string | null;
  readonly examYear?: number | null;
  readonly targetScore?: number | null;
  readonly currentScore?: number | null;
  readonly remainingDays?: number | null;
  readonly studyStage?: string | null;
}

export interface StudentContextMasteryNodeFact {
  readonly knowledgeNodeId: string;
  readonly subject?: string;
  readonly chapter?: string;
  readonly title?: string;
  readonly mastery: number;
  readonly accuracy?: number | null;
  readonly attempts: number;
  readonly correctCount?: number;
  readonly wrongCount: number;
  readonly status?: string;
  readonly updatedAt?: string | Date | null;
}

export interface StudentContextPracticeRecordFact {
  readonly id?: string;
  readonly knowledgePointId?: string | null;
  readonly subject?: string | null;
  readonly chapter?: string | null;
  readonly title?: string | null;
  readonly submittedAt: string | Date;
  readonly correct: boolean;
  readonly timeSpentSec?: number;
  readonly mistakeReason?: string | null;
}

export interface StudentContextReviewItemFact {
  readonly questionId: string;
  readonly knowledgePointId?: string | null;
  readonly dueAt: string | Date;
  readonly overdue?: boolean;
  readonly wrongCount?: number;
  readonly stability?: string | null;
  readonly reviewedAt?: string | Date | null;
  readonly resolved?: boolean | null;
}

export interface StudentContextTaskFact {
  readonly studyTaskId: string;
  readonly actionId?: string | null;
  readonly planId?: string | null;
  readonly title?: string;
  readonly status?: string;
  readonly scheduledDate: string;
  readonly completed?: boolean;
  readonly completedAt?: string | Date | null;
  readonly knowledgePointId?: string | null;
  readonly knowledgeNodeId?: string | null;
  readonly minutes?: number;
  readonly questionCount?: number;
}

export interface StudentContextSessionFact {
  readonly learningSessionId: string;
  readonly actionId?: string | null;
  readonly type: string;
  readonly startedAt: string | Date;
  readonly lastActiveAt: string | Date;
  readonly completed: boolean;
}

export interface StudentContextActivityDayFact {
  readonly date: string;
  readonly completedTaskCount?: number;
  readonly practiceCount?: number;
  readonly isActive: boolean;
}

export interface StudentContextSourceFacts {
  readonly user?: StudentContextUserFacts | null;
  readonly masteryNodes?: readonly StudentContextMasteryNodeFact[];
  readonly practiceRecords?: readonly StudentContextPracticeRecordFact[];
  readonly reviewItems?: readonly StudentContextReviewItemFact[];
  readonly tasks?: readonly StudentContextTaskFact[];
  readonly sessions?: readonly StudentContextSessionFact[];
  readonly activityDays?: readonly StudentContextActivityDayFact[];
  readonly recommendationEvidence?: readonly StudentContextEvidence[];
}

export interface BuildStudentContextInput {
  readonly userId: string;
  readonly asOf: string | Date;
  readonly todayDate: string;
  readonly windows: StudentContextWindows;
  readonly sourceFacts?: StudentContextSourceFacts;
}

export function buildStudentContext(input: BuildStudentContextInput): StudentContext {
  const asOf = toIso(input.asOf);
  const facts = input.sourceFacts ?? {};
  const masteryNodes = [...(facts.masteryNodes ?? [])];
  const practiceRecords = [...(facts.practiceRecords ?? [])];
  const reviewItems = [...(facts.reviewItems ?? [])];
  const tasks = [...(facts.tasks ?? [])];
  const sessions = [...(facts.sessions ?? [])];
  const activityDays = [...(facts.activityDays ?? [])];

  return {
    version: STUDENT_CONTEXT_VERSION,
    userId: input.userId,
    asOf,
    freshness: buildFreshness(asOf, facts),
    profile: {
      userId: input.userId,
      name: facts.user?.name ?? null,
      role: facts.user?.role ?? null,
      targetSchool: facts.user?.targetSchool ?? null,
      weakestSubject: facts.user?.weakestSubject ?? null,
      diagnosis: facts.user?.diagnosis ?? null,
    },
    exam: {
      examYear: facts.user?.examYear ?? null,
      targetScore: facts.user?.targetScore ?? null,
      currentScore: facts.user?.currentScore ?? null,
      remainingDays: facts.user?.remainingDays ?? null,
      studyStage: facts.user?.studyStage ?? null,
    },
    mastery: buildMastery(masteryNodes, practiceRecords),
    practice: buildPractice(practiceRecords, input.windows),
    review: buildReview(reviewItems, asOf),
    plan: buildPlan(tasks, input.todayDate, input.windows),
    momentum: buildMomentum(sessions, activityDays, input.windows),
    recommendationEvidence: normalizeEvidence(facts.recommendationEvidence ?? []),
  };
}

function buildMastery(
  rows: StudentContextMasteryNodeFact[],
  practiceRecords: StudentContextPracticeRecordFact[],
): StudentContextMastery {
  const nodes = rows
    .map(toNodeMastery)
    .sort((left, right) => left.mastery - right.mastery || left.knowledgeNodeId.localeCompare(right.knowledgeNodeId));
  const weakNodes = nodes.filter((node) => node.status === 'weak');
  // improvingPoints keeps the historical contract name. It includes
  // review-stage mastery nodes because deriveMasteryStatus() exposes
  // "review" as the active intermediate mastery state; without this union
  // those nodes would vanish from every bucket (P-1 contract hardening).
  const improvingPoints = nodes.filter((node) => node.status === 'improving' || node.status === 'review');
  const masteredPoints = nodes.filter((node) => node.status === 'mastered');
  const lastUpdatedAt = nodes
    .map((node) => node.updatedAt)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  return {
    source: nodes.length ? 'user_knowledge_mastery' : 'empty',
    weakNodes,
    weakPoints: buildPracticeWeaknesses(practiceRecords),
    improvingPoints,
    masteredPoints,
    lastUpdatedAt,
  };
}

function toNodeMastery(row: StudentContextMasteryNodeFact): StudentContextNodeMastery {
  const attempts = Math.max(0, row.attempts);
  return {
    knowledgeNodeId: row.knowledgeNodeId,
    subject: row.subject ?? '',
    chapter: row.chapter ?? '',
    title: row.title ?? row.knowledgeNodeId,
    mastery: row.mastery,
    accuracy: row.accuracy ?? (attempts > 0 && row.correctCount != null ? row.correctCount / attempts : null),
    attempts,
    wrongCount: Math.max(0, row.wrongCount),
    status: row.status ?? deriveMasteryStatus(row.mastery, attempts),
    updatedAt: toIsoOrNull(row.updatedAt),
  };
}

function buildPracticeWeaknesses(records: StudentContextPracticeRecordFact[]): StudentContextPracticeWeakness[] {
  const groups = new Map<string, { subject: string; chapter: string; title: string; attempts: number; wrongCount: number; latestAt: string | null }>();
  for (const record of records) {
    const knowledgePointId = record.knowledgePointId ?? null;
    if (!knowledgePointId) continue;
    const current = groups.get(knowledgePointId) ?? {
      subject: record.subject ?? '',
      chapter: record.chapter ?? '',
      title: record.title ?? knowledgePointId,
      attempts: 0,
      wrongCount: 0,
      latestAt: null,
    };
    current.attempts += 1;
    if (!record.correct) current.wrongCount += 1;
    const submittedAt = toIso(record.submittedAt);
    if (!current.latestAt || submittedAt > current.latestAt) current.latestAt = submittedAt;
    groups.set(knowledgePointId, current);
  }
  return [...groups.entries()]
    .filter(([, value]) => value.wrongCount > 0)
    .map(([knowledgePointId, value]) => ({
      knowledgePointId,
      subject: value.subject,
      chapter: value.chapter,
      title: value.title,
      attempts: value.attempts,
      wrongCount: value.wrongCount,
      accuracy: value.attempts ? (value.attempts - value.wrongCount) / value.attempts : null,
      latestAt: value.latestAt,
    }))
    .sort((left, right) => right.wrongCount - left.wrongCount || left.knowledgePointId.localeCompare(right.knowledgePointId))
    // Bounded top-20 weakness list: the summary surfaces the most-wrong
    // points; full per-point history stays in report-specific projections.
    .slice(0, 20);
}

function buildPractice(records: StudentContextPracticeRecordFact[], windows: StudentContextWindows): StudentContextPractice {
  const current = inWindow(records, windows.last7d).sort(comparePractice);
  const baseline = inBaselineWindow(records, windows.last7d).sort(comparePractice);
  const last30d = inWindow(records, windows.last30d);
  return {
    source: records.length ? 'practice_record' : 'empty',
    recentAccuracy: buildRatioTrend('last7d', current, baseline),
    recentVolume: buildCountTrend('last7d', current.length, baseline.length, current.length > 0 && baseline.length > 0),
    subjectDistribution: buildSubjectDistribution(last30d),
    totalCount: records.length,
    latestSubmittedAt: records.map((record) => toIso(record.submittedAt)).sort().at(-1) ?? null,
  };
}

function buildRatioTrend(
  window: StudentContextWindow,
  current: StudentContextPracticeRecordFact[],
  baseline: StudentContextPracticeRecordFact[],
): StudentContextTrend<number> {
  if (current.length === 0 || baseline.length === 0) return createInsufficientTrend<number>(window);
  return createSufficientTrend(window, ratio(current), ratio(baseline), current.length);
}

function buildCountTrend(
  window: StudentContextWindow,
  value: number,
  baseline: number,
  sufficient: boolean,
): StudentContextTrend<number> {
  if (!sufficient) return createInsufficientTrend<number>(window);
  return createSufficientTrend(window, value, baseline, value);
}

function buildSubjectDistribution(records: StudentContextPracticeRecordFact[]) {
  const counts = new Map<string, number>();
  for (const record of records) {
    const subject = record.subject ?? '未分类';
    counts.set(subject, (counts.get(subject) ?? 0) + 1);
  }
  if (records.length === 0) return { status: 'insufficient_data' as const, items: [] as const };
  const items = [...counts.entries()]
    .map(([subject, count]) => ({ subject, count, share: round4(count / records.length) }))
    .sort((left, right) => right.count - left.count || left.subject.localeCompare(right.subject));
  return { status: 'sufficient' as const, items };
}

function buildReview(items: StudentContextReviewItemFact[], asOf: string): StudentContextReview {
  const due = items
    .filter((item) => item.stability !== 'mastered' && toIso(item.dueAt) <= asOf)
    .sort(compareReview);
  const highRiskQuestions: StudentContextHighRiskQuestion[] = due
    .slice(0, 10)
    .map((item) => ({
      questionId: item.questionId,
      knowledgePointId: item.knowledgePointId ?? null,
      wrongCount: item.wrongCount ?? 0,
      overdue: item.overdue ?? toIso(item.dueAt) < asOf,
      nextReviewAt: toIso(item.dueAt),
      stability: item.stability ?? null,
    }));
  return {
    source: items.length ? 'review_schedule' : 'empty',
    dueCount: due.length,
    overdueCount: due.filter((item) => item.overdue ?? toIso(item.dueAt) < asOf).length,
    reviewedCount: items.filter((item) => item.reviewedAt != null).length,
    resolvedCount: items.filter((item) => item.resolved === true).length,
    highRiskQuestions,
    nextReviewAt: items.map((item) => toIso(item.dueAt)).filter((date) => date > asOf).sort()[0] ?? null,
  };
}

function buildPlan(tasks: StudentContextTaskFact[], todayDate: string, windows: StudentContextWindows): StudentContextPlan {
  const todayTasks = tasks
    .filter((task) => task.scheduledDate === todayDate)
    .sort((left, right) => left.studyTaskId.localeCompare(right.studyTaskId))
    .map(toTask);
  const completedCount = todayTasks.filter((task) => task.completed || task.status === 'completed').length;
  const totalCount = todayTasks.length;
  const baselineStartDate = windows.last7d.baselineStartAt?.slice(0, 10);
  const baselineEndDate = windows.last7d.baselineEndAt?.slice(0, 10);
  const baselineTasks = baselineStartDate && baselineEndDate
    ? tasks.filter((task) => task.scheduledDate >= baselineStartDate && task.scheduledDate < baselineEndDate)
    : [];
  const baselineCompleted = baselineTasks.filter((task) => task.completed || task.status === 'completed').length;
  const rate = totalCount > 0 && baselineTasks.length > 0
    ? createSufficientTrend('last7d', completedCount / totalCount, baselineTasks.length ? baselineCompleted / baselineTasks.length : 0, totalCount)
    : createInsufficientTrend<number>('last7d');
  return {
    source: tasks.length ? 'study_plan' : 'empty',
    planId: tasks.find((task) => task.planId)?.planId ?? null,
    todayTasks,
    completion: { completedCount, totalCount, rate },
  };
}

function toTask(task: StudentContextTaskFact): StudentContextTask {
  return {
    studyTaskId: task.studyTaskId,
    actionId: task.actionId ?? null,
    title: task.title ?? task.studyTaskId,
    status: task.status ?? (task.completed ? 'completed' : 'pending'),
    scheduledDate: task.scheduledDate,
    completed: task.completed ?? task.status === 'completed',
    completedAt: toIsoOrNull(task.completedAt),
    knowledgePointId: task.knowledgePointId ?? null,
    knowledgeNodeId: task.knowledgeNodeId ?? null,
    minutes: task.minutes ?? 0,
    questionCount: task.questionCount ?? 0,
  };
}

function buildMomentum(
  sessions: StudentContextSessionFact[],
  activityDays: StudentContextActivityDayFact[],
  windows: StudentContextWindows,
) {
  const orderedDays = [...activityDays].sort((left, right) => left.date.localeCompare(right.date));
  let studyStreak = 0;
  for (const day of [...orderedDays].reverse()) {
    if (!day.isActive) break;
    studyStreak += 1;
  }
  const currentActiveDays = orderedDays.filter((day) => day.date >= windows.activity.startAt.slice(0, 10) && day.date < windows.activity.endAt.slice(0, 10) && day.isActive).length;
  const baselineActiveDays = orderedDays.filter((day) => windows.activity.baselineStartAt && windows.activity.baselineEndAt && day.date >= windows.activity.baselineStartAt.slice(0, 10) && day.date < windows.activity.baselineEndAt.slice(0, 10) && day.isActive).length;
  const activityTrend = currentActiveDays > 0 && baselineActiveDays > 0
    ? createSufficientTrend('activity', currentActiveDays, baselineActiveDays, currentActiveDays)
    : createInsufficientTrend<number>('activity');
  const recentSessions: StudentContextSession[] = [...sessions]
    .sort((left, right) => toIso(right.lastActiveAt).localeCompare(toIso(left.lastActiveAt)) || left.learningSessionId.localeCompare(right.learningSessionId))
    .slice(0, 10)
    .map((session) => ({
      learningSessionId: session.learningSessionId,
      actionId: session.actionId ?? null,
      type: session.type,
      startedAt: toIso(session.startedAt),
      lastActiveAt: toIso(session.lastActiveAt),
      completed: session.completed,
    }));
  return { studyStreak, recentSessions, activityTrend };
}

function buildFreshness(asOf: string, facts: StudentContextSourceFacts): StudentContextFreshness {
  const sources = [
    sourceFreshness('user', facts.user ? asOf : null),
    sourceFreshness('mastery', latestDate(facts.masteryNodes?.map((row) => row.updatedAt) ?? [])),
    sourceFreshness('practice', latestDate(facts.practiceRecords?.map((row) => row.submittedAt) ?? [])),
    sourceFreshness('review', latestDate(facts.reviewItems?.map((row) => row.reviewedAt ?? row.dueAt) ?? [])),
    sourceFreshness('plan', asOfOrNull(facts.tasks?.map((row) => row.completedAt) ?? [])),
    sourceFreshness('sessions', latestDate(facts.sessions?.map((row) => row.lastActiveAt) ?? [])),
  ];
  return { asOf, status: sources.some((source) => source.status === 'available') ? 'sufficient' : 'insufficient_data', sources };
}

function sourceFreshness(source: string, observedAt: string | null) {
  return { source, observedAt, status: observedAt ? 'available' as const : 'unavailable' as const };
}

const EVIDENCE_FIELDS = ['timestamp', 'knowledgeNodeId', 'knowledgePointId', 'actionId', 'studyTaskId', 'referenceId'] as const;

function normalizeEvidence(evidence: readonly StudentContextEvidence[]): StudentContextEvidence[] {
  // Defensive normalization (SC-5 TASK 3): evidence rows may originate from a
  // JSON column; malformed entries must never fail the request. Non-object
  // rows are dropped, source falls back to an explicit 'unknown', only
  // contract fields survive, and the section stays a bounded provenance
  // window of the 60 most recent rows (SC-5 TASK 2).
  const objectRows = evidence.filter(
    (item) => typeof item === 'object' && item !== null,
  ) as unknown as Record<string, unknown>[];
  return objectRows
    .map((item) => {
      const row: Record<string, string> = {
        source: typeof item.source === 'string' && item.source ? item.source : 'unknown',
      };
      for (const field of EVIDENCE_FIELDS) {
        if (typeof item[field] === 'string') row[field] = item[field] as string;
      }
      return row as unknown as StudentContextEvidence;
    })
    .sort((left, right) => (right.timestamp ?? '').localeCompare(left.timestamp ?? '') || left.source.localeCompare(right.source) || (left.referenceId ?? '').localeCompare(right.referenceId ?? ''))
    .slice(0, 60);
}

function inWindow(records: StudentContextPracticeRecordFact[], window: StudentContextTimeWindow): StudentContextPracticeRecordFact[] {
  return records.filter((record) => {
    const submittedAt = toIso(record.submittedAt);
    return submittedAt >= window.startAt && submittedAt < window.endAt;
  });
}

function inBaselineWindow(records: StudentContextPracticeRecordFact[], window: StudentContextTimeWindow): StudentContextPracticeRecordFact[] {
  if (!window.baselineStartAt || !window.baselineEndAt) return [];
  return records.filter((record) => {
    const submittedAt = toIso(record.submittedAt);
    return submittedAt >= window.baselineStartAt! && submittedAt < window.baselineEndAt!;
  });
}

function comparePractice(left: StudentContextPracticeRecordFact, right: StudentContextPracticeRecordFact): number {
  return toIso(left.submittedAt).localeCompare(toIso(right.submittedAt)) || (left.id ?? '').localeCompare(right.id ?? '');
}

function compareReview(left: StudentContextReviewItemFact, right: StudentContextReviewItemFact): number {
  const leftOverdue = left.overdue ?? false;
  const rightOverdue = right.overdue ?? false;
  return Number(rightOverdue) - Number(leftOverdue)
    || (right.wrongCount ?? 0) - (left.wrongCount ?? 0)
    || toIso(left.dueAt).localeCompare(toIso(right.dueAt))
    || left.questionId.localeCompare(right.questionId);
}

function ratio(records: StudentContextPracticeRecordFact[]): number {
  return records.filter((record) => record.correct).length / records.length;
}

function deriveMasteryStatus(mastery: number, attempts: number): string {
  if (attempts === 0) return 'untouched';
  if (mastery < 0.45) return 'weak';
  if (mastery < 0.75) return 'review';
  return 'mastered';
}

function latestDate(values: readonly (string | Date | null | undefined)[]): string | null {
  return values.map(toIsoOrNull).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function asOfOrNull(values: readonly (string | Date | null | undefined)[]): string | null {
  return latestDate(values);
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: string | Date | null | undefined): string | null {
  return value == null ? null : toIso(value);
}

function round4(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}
