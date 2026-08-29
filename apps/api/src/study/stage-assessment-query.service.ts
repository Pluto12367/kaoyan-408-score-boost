import { Injectable, Optional } from '@nestjs/common';
import type { LegacyStageAssessmentDto } from './stage-assessment.adapter';
import { toLegacyStageAssessment } from './stage-assessment.adapter';
import { StageAssessmentProjectionService } from './stage-assessment-projection.service';
import { StageAssessmentSelector } from './stage-assessment.selector';
import { StudyService } from './study.service';

// 过渡期兼容层：遗留 /assessments/stage 需要题目池事实（题干/选项/答案剥除），
// 投影链目前没有题目目录 read path（见 docs/phase-2.8.2-stage-assessment-design.md
// §6.2 的 QuestionCatalogQueryService 待办）。投影链达到 parity 前，兼容查询
// 委托遗留实现；selector/adapter 链保留并在 catalog query 就绪后切换。
@Injectable()
export class StageAssessmentQueryService {
  constructor(
    private readonly projection: StageAssessmentProjectionService,
    @Optional() private readonly selector?: StageAssessmentSelector,
    @Optional() private readonly legacy?: StudyService,
  ) {}

  async getStageAssessmentCompat(userId: string, asOf: Date = new Date()): Promise<LegacyStageAssessmentDto> {
    if (this.legacy) {
      return this.legacy.getStageAssessment(userId) as unknown as LegacyStageAssessmentDto;
    }
    const snapshot = await this.projection.getSnapshot(userId, asOf);
    const selector = this.selector ?? new StageAssessmentSelector();
    const selection = selector.select(snapshot);
    return toLegacyStageAssessment(snapshot, selection, asOf.toISOString());
  }
}
