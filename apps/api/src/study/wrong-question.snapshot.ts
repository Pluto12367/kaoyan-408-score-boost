// WrongQuestionSnapshot is a read-only contract for wrong-question facts.
// It is derived from PracticeRecord, WrongQuestionReview, ReviewSchedule,
// ReviewAttempt, Question, and KnowledgePoint rows. It must not contain
// presentation actions, recommendations, filters, or runtime wiring.
//
// Membership contract:
// - currentWrongItems comes only from PracticeRecord groups whose latest
//   attempt for a question is incorrect. WrongQuestionReview.resolved does
//   not remove an item when the latest PracticeRecord is wrong.
// - resolvedItems comes only from PracticeRecord groups that had at least
//   one incorrect attempt and whose latest attempt is correct. This preserves
//   the legacy resolvedCount rule and is intentionally separate from
//   WrongQuestionReview.resolved.
// - dueItems comes only from ReviewSchedule rows whose nextReviewAt is at or
//   before asOf and whose stability is not mastered. It does not depend on
//   currentWrongItems membership.
// - mistakeReasonStats counts every incorrect PracticeRecord, including
//   records for questions that are now resolved.
//
// Fact-source boundaries:
// - PracticeRecord owns attempt history, latest correctness, wrong counts,
//   latest mistake reason, submittedAt, and variantCorrectCount.
// - WrongQuestionReview owns reviewedAt and lifecycle resolved/resolvedAt.
// - ReviewSchedule owns stability, consecutiveCorrect, nextReviewAt,
//   reviewCount, note, reported/inferred reasons, and due review facts.
// - ReviewAttempt owns reviewHistory facts only.
// - Question and KnowledgePoint only provide stable display metadata.

export interface WrongQuestionPracticeRecordRow {
  id?: string | null;
  questionId: string;
  knowledgePointId: string;
  selectedAnswer?: string | null;
  correct: boolean;
  timeSpentSec: number;
  mistakeReason?: string | null;
  submittedAt: Date | string;
  variantQuestionId?: string | null;
}

export interface WrongQuestionReviewRow {
  questionId: string;
  reviewedAt: Date | string | null;
  resolved?: boolean | null;
  resolvedAt?: Date | string | null;
}

export interface WrongQuestionReviewScheduleRow {
  questionId: string;
  stability: string;
  consecutiveCorrect: number;
  nextReviewAt: Date | string;
  reviewCount: number;
  lastReviewedAt?: Date | string | null;
  selfReportedReason?: string | null;
  inferredReason?: string | null;
  note?: string | null;
  redoCorrect?: boolean | null;
  timeSpentSec?: number | null;
}

export interface WrongQuestionReviewAttemptRow {
  questionId: string;
  redoCorrect: boolean;
  timeSpentSec: number;
  reportedReason?: string | null;
  inferredReason?: string | null;
  nextIntervalDays: number;
  reviewedAt: Date | string;
}

export interface WrongQuestionReviewAttemptSnapshot {
  redoCorrect: boolean;
  timeSpentSec: number;
  reportedReason: string | null;
  inferredReason: string | null;
  nextIntervalDays: number;
  reviewedAt: string;
}

export interface WrongQuestionCatalogQuestionRow {
  id: string;
  stem: string;
  answer?: string | null;
  analysis?: string | null;
  knowledgePointIds?: string[];
}

export interface WrongQuestionKnowledgePointRow {
  id: string;
  title: string;
  subject: string;
  chapter: string;
  importance: number;
}

export interface WrongQuestionAttemptSnapshot {
  date: string;
  selectedAnswer: string | null;
  correct: boolean;
  mistakeReason: string | null;
  timeSpentSec: number;
}

export interface WrongQuestionReviewSnapshot {
  reviewedAt: string | null;
  resolved: boolean | null;
  resolvedAt: string | null;
}

export interface WrongQuestionMasteryCriteriaSnapshot {
  stability: string;
  consecutiveCorrect: number;
  variantCorrectCount: number;
}

export interface WrongQuestionItemSnapshot {
  questionId: string;
  stem: string;
  answer: string | null;
  analysis: string | null;
  knowledgePointId: string;
  knowledgePointTitle: string;
  subject: string;
  chapter: string;
  importance: number;
  latestCorrect: boolean;
  latestMistakeReason: string | null;
  latestSubmittedAt: string;
  wrongCount: number;
  attemptCount: number;
  attemptHistory: WrongQuestionAttemptSnapshot[];
  review: WrongQuestionReviewSnapshot;
  reviewHistory: WrongQuestionReviewAttemptSnapshot[];
  masteryCriteria: WrongQuestionMasteryCriteriaSnapshot;
}

export interface WrongQuestionResolvedItemSnapshot extends WrongQuestionItemSnapshot {
  latestCorrect: true;
  resolvedBy: 'latest_correct';
}

export interface WrongQuestionDueItemSnapshot {
  questionId: string;
  stem: string;
  knowledgePointId: string | null;
  knowledgePointTitle: string;
  subject: string;
  stability: string;
  consecutiveCorrect: number;
  nextReviewAt: string;
  reviewCount: number;
  lastReviewedAt: string | null;
  selfReportedReason: string | null;
  inferredReason: string | null;
  note: string;
  redoCorrect: boolean;
  timeSpentSec: number;
}

export interface WrongQuestionMistakeReasonStatSnapshot {
  reason: string;
  count: number;
}

export interface WrongQuestionSnapshot {
  source: 'practice_record_wrong_question_review_review_schedule';
  userId: string;
  asOf: string;
  currentWrongItems: WrongQuestionItemSnapshot[];
  resolvedItems: WrongQuestionResolvedItemSnapshot[];
  dueItems: WrongQuestionDueItemSnapshot[];
  mistakeReasonStats: WrongQuestionMistakeReasonStatSnapshot[];
}

export interface BuildWrongQuestionSnapshotInput {
  userId: string;
  asOf: Date | string;
  practiceRecords: WrongQuestionPracticeRecordRow[];
  wrongQuestionReviews: WrongQuestionReviewRow[];
  reviewSchedules: WrongQuestionReviewScheduleRow[];
  reviewAttempts?: WrongQuestionReviewAttemptRow[];
  questions: WrongQuestionCatalogQuestionRow[];
  knowledgePoints: WrongQuestionKnowledgePointRow[];
}

export function buildWrongQuestionSnapshot(input: BuildWrongQuestionSnapshotInput): WrongQuestionSnapshot {
  const asOf = toIso(input.asOf);
  const records = [...input.practiceRecords].sort(compareRecords);
  const recordsByQuestion = groupBy(records, (record) => record.questionId);
  const reviewsByQuestion = indexBy(input.wrongQuestionReviews, (review) => review.questionId);
  const schedulesByQuestion = indexBy(input.reviewSchedules, (schedule) => schedule.questionId);
  const attemptsByQuestion = groupBy(input.reviewAttempts ?? [], (attempt) => attempt.questionId);
  const questionsById = indexBy(input.questions, (question) => question.id);
  const pointsById = indexBy(input.knowledgePoints, (point) => point.id);

  const currentWrongItems: WrongQuestionItemSnapshot[] = [];
  const resolvedItems: WrongQuestionResolvedItemSnapshot[] = [];

  for (const [questionId, questionRecords] of recordsByQuestion) {
    const hadWrong = questionRecords.some((record) => !record.correct);
    const latestRecord = questionRecords.at(-1);
    if (!hadWrong || !latestRecord) continue;

    const item = buildItem({
      questionId,
      records: questionRecords,
      review: reviewsByQuestion.get(questionId) ?? null,
      schedule: schedulesByQuestion.get(questionId) ?? null,
      attempts: attemptsByQuestion.get(questionId) ?? [],
      question: questionsById.get(questionId) ?? null,
      pointsById,
      variantCorrectCount: records.filter((record) => record.variantQuestionId === questionId && record.correct).length,
    });

    if (latestRecord.correct) {
      resolvedItems.push({ ...item, latestCorrect: true, resolvedBy: 'latest_correct' });
    } else {
      currentWrongItems.push(item);
    }
  }

  return {
    source: 'practice_record_wrong_question_review_review_schedule',
    userId: input.userId,
    asOf,
    currentWrongItems,
    resolvedItems,
    dueItems: buildDueItems(input.reviewSchedules, asOf, questionsById, pointsById),
    mistakeReasonStats: buildMistakeReasonStats(records),
  };
}

function buildItem(input: {
  questionId: string;
  records: WrongQuestionPracticeRecordRow[];
  review: WrongQuestionReviewRow | null;
  schedule: WrongQuestionReviewScheduleRow | null;
  attempts: WrongQuestionReviewAttemptRow[];
  question: WrongQuestionCatalogQuestionRow | null;
  pointsById: Map<string, WrongQuestionKnowledgePointRow>;
  variantCorrectCount: number;
}): WrongQuestionItemSnapshot {
  const latestRecord = input.records.at(-1)!;
  const knowledgePointId = latestRecord.knowledgePointId ?? input.question?.knowledgePointIds?.[0] ?? '';
  const point = input.pointsById.get(knowledgePointId) ?? null;
  const stability = input.schedule?.stability ?? 'learning';
  const consecutiveCorrect = input.schedule?.consecutiveCorrect ?? 0;

  return {
    questionId: input.questionId,
    stem: input.question?.stem ?? input.questionId,
    answer: input.question?.answer ?? null,
    analysis: input.question?.analysis ?? null,
    knowledgePointId,
    knowledgePointTitle: point?.title ?? knowledgePointId,
    subject: point?.subject ?? '未分类',
    chapter: point?.chapter ?? '未分类',
    importance: point?.importance ?? 0,
    latestCorrect: latestRecord.correct,
    latestMistakeReason: latestRecord.mistakeReason ?? null,
    latestSubmittedAt: toIso(latestRecord.submittedAt),
    wrongCount: input.records.filter((record) => !record.correct).length,
    attemptCount: input.records.length,
    attemptHistory: input.records.map((record) => ({
      date: toIso(record.submittedAt),
      selectedAnswer: record.selectedAnswer ?? null,
      correct: record.correct,
      mistakeReason: record.mistakeReason ?? null,
      timeSpentSec: record.timeSpentSec,
    })),
    review: {
      reviewedAt: toIsoOrNull(input.review?.reviewedAt ?? null),
      resolved: input.review?.resolved ?? null,
      resolvedAt: toIsoOrNull(input.review?.resolvedAt ?? null),
    },
    reviewHistory: input.attempts.sort(compareAttempts).map((attempt) => ({
      redoCorrect: attempt.redoCorrect,
      timeSpentSec: attempt.timeSpentSec,
      reportedReason: attempt.reportedReason ?? null,
      inferredReason: attempt.inferredReason ?? null,
      nextIntervalDays: attempt.nextIntervalDays,
      reviewedAt: toIso(attempt.reviewedAt),
    })),
    masteryCriteria: {
      stability,
      consecutiveCorrect,
      variantCorrectCount: input.variantCorrectCount,
    },
  };
}

function buildDueItems(
  schedules: WrongQuestionReviewScheduleRow[],
  asOf: string,
  questionsById: Map<string, WrongQuestionCatalogQuestionRow>,
  pointsById: Map<string, WrongQuestionKnowledgePointRow>,
): WrongQuestionDueItemSnapshot[] {
  return schedules
    .filter((schedule) => schedule.stability !== 'mastered')
    .filter((schedule) => toIso(schedule.nextReviewAt) <= asOf)
    .sort((left, right) => toIso(left.nextReviewAt).localeCompare(toIso(right.nextReviewAt)) || left.questionId.localeCompare(right.questionId))
    .map((schedule) => {
      const question = questionsById.get(schedule.questionId) ?? null;
      const knowledgePointId = question?.knowledgePointIds?.[0] ?? null;
      const point = knowledgePointId ? pointsById.get(knowledgePointId) ?? null : null;
      return {
        questionId: schedule.questionId,
        stem: question?.stem ?? schedule.questionId,
        knowledgePointId,
        knowledgePointTitle: point?.title ?? '未知考点',
        subject: point?.subject ?? '未分类',
        stability: schedule.stability,
        consecutiveCorrect: schedule.consecutiveCorrect,
        nextReviewAt: toIso(schedule.nextReviewAt),
        reviewCount: schedule.reviewCount,
        lastReviewedAt: toIsoOrNull(schedule.lastReviewedAt ?? null),
        selfReportedReason: schedule.selfReportedReason ?? null,
        inferredReason: schedule.inferredReason ?? null,
        note: schedule.note ?? '',
        redoCorrect: schedule.redoCorrect ?? false,
        timeSpentSec: schedule.timeSpentSec ?? 0,
      };
    });
}

function buildMistakeReasonStats(records: WrongQuestionPracticeRecordRow[]): WrongQuestionMistakeReasonStatSnapshot[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    if (record.correct) continue;
    const reason = record.mistakeReason ?? '待归因';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => right.count - left.count);
}

function groupBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFor(item);
    const bucket = result.get(key) ?? [];
    bucket.push(item);
    result.set(key, bucket);
  }
  return result;
}

function indexBy<T>(items: T[], keyFor: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [keyFor(item), item]));
}

function compareRecords(left: WrongQuestionPracticeRecordRow, right: WrongQuestionPracticeRecordRow): number {
  return toIso(left.submittedAt).localeCompare(toIso(right.submittedAt))
    || String(left.id ?? '').localeCompare(String(right.id ?? ''));
}

function compareAttempts(left: WrongQuestionReviewAttemptRow, right: WrongQuestionReviewAttemptRow): number {
  return toIso(left.reviewedAt).localeCompare(toIso(right.reviewedAt));
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toIsoOrNull(value: Date | string | null): string | null {
  return value == null ? null : toIso(value);
}
