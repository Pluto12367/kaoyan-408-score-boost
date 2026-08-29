import {
  deriveMasteryStatus,
  type WrongQuestionMasteryStatus,
} from '@kaoyan408/shared';
import type {
  WrongQuestionDueItemSnapshot,
  WrongQuestionItemSnapshot,
  WrongQuestionSnapshot,
} from './wrong-question.snapshot';

type ReviewStatus = 'pending' | 'reviewed';

export interface LegacyWrongQuestionDto {
  questionId: string;
  stem: string;
  answer?: string;
  analysis?: string;
  knowledgePointId: string;
  knowledgePointTitle: string;
  subject: string;
  chapter: string;
  wrongCount: number;
  latestMistakeReason: string | null;
  latestSubmittedAt: string;
  reviewStatus: ReviewStatus;
  reviewedAt: string | null;
  masteryStatus: WrongQuestionMasteryStatus;
  masteryCriteria: {
    stability: string;
    consecutiveCorrect: number;
    variantCorrectCount: number;
  };
  importance: number;
}

export interface LegacyWrongQuestionSummaryDto {
  userId: string;
  pendingCount: number;
  reviewedCount: number;
  resolvedCount: number;
  totalWrongCount: number;
  masteryStats: Array<{ status: WrongQuestionMasteryStatus; count: number }>;
  mistakeReasonStats: Array<{ reason: string; count: number }>;
  priorityRedoItems: Array<{
    questionId: string;
    stem: string;
    knowledgePointTitle: string;
    wrongCount: number;
    latestMistakeReason: string | null;
    reviewStatus: ReviewStatus;
    nextAction: string;
  }>;
  nextReviewActions: string[];
  generatedAt: string;
}

export interface LegacyDueReviewItemDto {
  questionId: string;
  userId: string;
  selfReportedReason?: string;
  redoCorrect: boolean;
  timeSpentSec: number;
  consecutiveCorrect: number;
  stability: string;
  nextReviewAt: string;
  reviewCount: number;
  lastReviewedAt?: string;
  inferredReason?: string;
  note?: string;
  stem: string;
  knowledgePointTitle: string;
  subject: string;
}

export interface LegacyDueReviewsDto {
  userId: string;
  dueCount: number;
  items: LegacyDueReviewItemDto[];
  nextAction: string;
}

export function toLegacyWrongQuestions(snapshot: WrongQuestionSnapshot): LegacyWrongQuestionDto[] {
  return snapshot.currentWrongItems.map(toLegacyWrongQuestion);
}

export function toLegacyWrongQuestionSummary(
  snapshot: WrongQuestionSnapshot,
  generatedAt = new Date().toISOString(),
): LegacyWrongQuestionSummaryDto {
  const wrongQuestions = toLegacyWrongQuestions(snapshot);
  const pendingCount = wrongQuestions.filter((item) => item.reviewStatus === 'pending').length;
  const reviewedCount = wrongQuestions.filter((item) => item.reviewStatus === 'reviewed').length;
  const resolvedCount = snapshot.resolvedItems.length;
  const priorityRedoItems = [...wrongQuestions]
    .sort((left, right) => right.wrongCount - left.wrongCount)
    .slice(0, 3)
    .map((item) => ({
      questionId: item.questionId,
      stem: item.stem,
      knowledgePointTitle: item.knowledgePointTitle,
      wrongCount: item.wrongCount,
      latestMistakeReason: item.latestMistakeReason,
      reviewStatus: item.reviewStatus,
      nextAction: item.reviewStatus === 'pending'
        ? '先标记复盘，写出错误原因后再重做。'
        : '进入重做模式，确认是否已经真正解决。',
    }));

  return {
    userId: snapshot.userId,
    pendingCount,
    reviewedCount,
    resolvedCount,
    totalWrongCount: wrongQuestions.length,
    masteryStats: (['未掌握', '复习中', '已掌握'] as const).map((status) => ({
      status,
      count: wrongQuestions.filter((item) => item.masteryStatus === status).length,
    })),
    mistakeReasonStats: snapshot.mistakeReasonStats.map((item) => ({ ...item })),
    priorityRedoItems,
    nextReviewActions: [
      pendingCount > 0 ? `先复盘 ${pendingCount} 道待处理错题，补全错因。` : '待复盘错题已清空，可以进入重做验证。',
      priorityRedoItems.length > 0 ? `优先重做 ${priorityRedoItems[0].knowledgePointTitle}，它的错误次数最高。` : '当前没有待重做错题，建议进入限时训练。',
      resolvedCount > 0 ? `已有 ${resolvedCount} 道错题通过重做解决，继续保持闭环。` : '完成一次正确重做后，系统会将该题从错题本移除。',
    ],
    generatedAt,
  };
}

export function toLegacyDueReviews(snapshot: WrongQuestionSnapshot): LegacyDueReviewsDto {
  const items = snapshot.dueItems.map((item) => toLegacyDueReviewItem(snapshot.userId, item));
  return {
    userId: snapshot.userId,
    dueCount: items.length,
    items,
    nextAction: items.length > 0
      ? `今天有 ${items.length} 道错题需要复习，优先从最早到期的开始。`
      : '暂无到期复习任务，可以开始新的练习。',
  };
}

function toLegacyWrongQuestion(item: WrongQuestionItemSnapshot): LegacyWrongQuestionDto {
  return {
    questionId: item.questionId,
    stem: item.stem,
    answer: item.answer ?? undefined,
    analysis: item.analysis ?? undefined,
    knowledgePointId: item.knowledgePointId,
    knowledgePointTitle: item.knowledgePointTitle,
    subject: item.subject,
    chapter: item.chapter,
    wrongCount: item.wrongCount,
    latestMistakeReason: item.latestMistakeReason,
    latestSubmittedAt: item.latestSubmittedAt,
    reviewStatus: item.review.reviewedAt ? 'reviewed' : 'pending',
    reviewedAt: item.review.reviewedAt ?? null,
    masteryStatus: deriveMasteryStatus(item.masteryCriteria),
    masteryCriteria: { ...item.masteryCriteria },
    importance: item.importance,
  };
}

function toLegacyDueReviewItem(userId: string, item: WrongQuestionDueItemSnapshot): LegacyDueReviewItemDto {
  return {
    questionId: item.questionId,
    userId,
    selfReportedReason: item.selfReportedReason ?? undefined,
    redoCorrect: item.redoCorrect,
    timeSpentSec: item.timeSpentSec,
    consecutiveCorrect: item.consecutiveCorrect,
    stability: item.stability,
    nextReviewAt: item.nextReviewAt,
    reviewCount: item.reviewCount,
    lastReviewedAt: item.lastReviewedAt ?? undefined,
    inferredReason: item.inferredReason ?? undefined,
    note: item.note,
    stem: item.stem,
    knowledgePointTitle: item.knowledgePointTitle,
    subject: item.subject,
  };
}
