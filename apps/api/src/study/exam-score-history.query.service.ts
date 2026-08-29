import { Injectable, Optional } from '@nestjs/common';
import type { LegacyExamScoreHistoryDto } from './exam-score-history.adapter';
import { toLegacyExamScoreHistory } from './exam-score-history.adapter';
import { ExamScoreHistoryProjectionService } from './exam-score-history.projection.service';

type ExamScoreHistoryAdapter = { toLegacyExamScoreHistory: typeof toLegacyExamScoreHistory };

@Injectable()
export class ExamScoreHistoryQueryService {
  constructor(
    private readonly projection: ExamScoreHistoryProjectionService,
    @Optional() private readonly adapter?: ExamScoreHistoryAdapter,
  ) {}

  async getExamScoreHistoryCompat(userId: string, asOf: Date = new Date()): Promise<LegacyExamScoreHistoryDto> {
    const snapshot = await this.projection.getSnapshot(userId, asOf);
    const adapter = this.adapter ?? { toLegacyExamScoreHistory };
    return adapter.toLegacyExamScoreHistory(snapshot);
  }
}
