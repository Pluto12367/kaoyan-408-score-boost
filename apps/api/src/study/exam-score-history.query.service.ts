import { Injectable, Optional } from '@nestjs/common';
import type { LegacyExamScoreHistoryDto } from './exam-score-history.adapter';
import { toLegacyExamScoreHistory } from './exam-score-history.adapter';
import { ExamScoreHistoryProjectionService } from './exam-score-history.projection.service';

type ExamScoreHistoryAdapter = { toLegacyExamScoreHistory: typeof toLegacyExamScoreHistory };

/**
 * Slim by contract (test/exam-score-history-query.test.js): this service may
 * only compose the projection with the adapter — no database client, no shared
 * module, no calculations of its own. PHASE 11's loss section therefore lives
 * in the dedicated ExamLossTrendService and is composed at the controller.
 */
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
