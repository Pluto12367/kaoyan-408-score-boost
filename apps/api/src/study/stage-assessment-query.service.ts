import { Injectable, Optional } from '@nestjs/common';
import type { LegacyStageAssessmentDto } from './stage-assessment.adapter';
import { toLegacyStageAssessment } from './stage-assessment.adapter';
import { StageAssessmentProjectionService } from './stage-assessment-projection.service';
import { StageAssessmentSelector } from './stage-assessment.selector';

@Injectable()
export class StageAssessmentQueryService {
  constructor(
    private readonly projection: StageAssessmentProjectionService,
    @Optional() private readonly selector?: StageAssessmentSelector,
  ) {}

  async getStageAssessmentCompat(userId: string, asOf: Date = new Date()): Promise<LegacyStageAssessmentDto> {
    const snapshot = await this.projection.getSnapshot(userId, asOf);
    const selector = this.selector ?? new StageAssessmentSelector();
    const selection = selector.select(snapshot);
    return toLegacyStageAssessment(snapshot, selection, asOf.toISOString());
  }
}
