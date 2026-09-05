import { Injectable, Optional } from '@nestjs/common';
import type { LegacyMasteryMap } from '@kaoyan408/shared';
import {
  MasterySummaryProjectionService,
  toMasteryMapDto,
} from './mastery-summary-projection.service';
import { StudyService } from './study.service';

// 过渡期兼容层：GET /mastery-map 的遗留契约（subjects[].points[] 携带
// knowledgePointId / practiceCount / 任务关联）尚未由 MasterySummaryProjection
// 完整覆盖（缺少任务质量等事实）。投影链达到 parity 前，兼容查询委托遗留实现。
// 该投影链继续服务于 /student-state 与后续切换。
@Injectable()
export class StudentStateQueryService {
  constructor(
    private readonly masterySummaryProjection: MasterySummaryProjectionService,
    @Optional() private readonly legacy?: StudyService,
  ) {}

  async getMasteryMapCompat(userId: string, generatedAt: Date = new Date()): Promise<LegacyMasteryMap> {
    if (this.legacy) {
      return this.legacy.getMasteryMap(userId) as LegacyMasteryMap;
    }
    const projection = await this.masterySummaryProjection.getProjection(userId, generatedAt);
    return toMasteryMapDto(projection);
  }
}
