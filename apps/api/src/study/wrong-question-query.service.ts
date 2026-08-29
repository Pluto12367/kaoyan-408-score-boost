import { Injectable } from '@nestjs/common';
import type { WrongQuestionFilter, WrongQuestionMasteryStatus } from '@kaoyan408/shared';
import {
  toLegacyDueReviews,
  toLegacyWrongQuestionSummary,
  toLegacyWrongQuestions,
  type LegacyDueReviewsDto,
  type LegacyWrongQuestionDto,
  type LegacyWrongQuestionSummaryDto,
} from './wrong-question.adapter';
import { WrongQuestionProjectionService } from './wrong-question-projection.service';

type ReviewStatusFilter = 'pending' | 'reviewed';

export type WrongQuestionCompatFilter = WrongQuestionFilter & {
  reviewStatus?: ReviewStatusFilter;
};

@Injectable()
export class WrongQuestionQueryService {
  constructor(private readonly projection: WrongQuestionProjectionService) {}

  async getWrongQuestionsCompat(
    userId: string,
    filters: WrongQuestionCompatFilter = {},
  ): Promise<LegacyWrongQuestionDto[]> {
    const snapshot = await this.projection.getSnapshot(userId);
    return filterWrongQuestionDtos(toLegacyWrongQuestions(snapshot), filters);
  }

  async getWrongQuestionSummaryCompat(userId: string): Promise<LegacyWrongQuestionSummaryDto> {
    const snapshot = await this.projection.getSnapshot(userId);
    return toLegacyWrongQuestionSummary(snapshot);
  }

  async getDueReviewsCompat(userId: string): Promise<LegacyDueReviewsDto> {
    const snapshot = await this.projection.getSnapshot(userId);
    return toLegacyDueReviews(snapshot);
  }
}

function filterWrongQuestionDtos(
  items: LegacyWrongQuestionDto[],
  filters: WrongQuestionCompatFilter,
): LegacyWrongQuestionDto[] {
  const reviewedCutoff = filters.reviewedWithinDays == null
    ? null
    : Date.now() - filters.reviewedWithinDays * 86_400_000;

  return items.filter((item) => {
    if (filters.subject && item.subject !== filters.subject) return false;
    if (filters.chapter && item.chapter !== filters.chapter) return false;
    if (filters.knowledgePointId && item.knowledgePointId !== filters.knowledgePointId) return false;
    if (filters.mistakeReason && item.latestMistakeReason !== filters.mistakeReason) return false;
    if (filters.minWrongCount != null && item.wrongCount < filters.minWrongCount) return false;
    if (filters.masteryStatus && item.masteryStatus !== filters.masteryStatus as WrongQuestionMasteryStatus) return false;
    if (filters.reviewStatus && item.reviewStatus !== filters.reviewStatus) return false;
    if (filters.importance != null && item.importance < filters.importance) return false;
    if (reviewedCutoff != null) {
      if (!item.reviewedAt) return false;
      if (Date.parse(item.reviewedAt) < reviewedCutoff) return false;
    }
    return true;
  });
}
