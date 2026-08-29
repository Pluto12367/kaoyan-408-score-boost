import { Injectable } from '@nestjs/common';
import type { NodeMasteryMap } from '@kaoyan408/shared';
import {
  MasterySummaryProjectionService,
  toMasteryMapDto,
} from './mastery-summary-projection.service';

@Injectable()
export class StudentStateQueryService {
  constructor(private readonly masterySummaryProjection: MasterySummaryProjectionService) {}

  async getMasteryMapCompat(userId: string, generatedAt: Date = new Date()): Promise<NodeMasteryMap> {
    const projection = await this.masterySummaryProjection.getProjection(userId, generatedAt);
    return toMasteryMapDto(projection);
  }
}
