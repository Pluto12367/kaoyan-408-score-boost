import { Injectable, Optional } from '@nestjs/common';
import type { LegacyAssessmentHistoryDto } from './assessment-history.adapter';
import { toLegacyAssessmentHistory } from './assessment-history.adapter';
import { AssessmentHistoryProjectionService } from './assessment-history-projection.service';

type AssessmentHistoryAdapter = { toLegacyAssessmentHistory: typeof toLegacyAssessmentHistory };

@Injectable()
export class AssessmentHistoryQueryService {
  constructor(
    private readonly projection: AssessmentHistoryProjectionService,
    @Optional() private readonly adapter?: AssessmentHistoryAdapter,
  ) {}

  async getAssessmentHistoryCompat(userId: string, asOf: Date = new Date()): Promise<LegacyAssessmentHistoryDto> {
    const snapshot = await this.projection.getSnapshot(userId, asOf);
    const adapter = this.adapter ?? { toLegacyAssessmentHistory };
    return adapter.toLegacyAssessmentHistory(snapshot);
  }
}
