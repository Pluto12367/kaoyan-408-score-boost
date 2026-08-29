import { Injectable, Optional } from '@nestjs/common';
import type { LegacyDashboardOverviewDto } from './dashboard.adapter';
import { toLegacyDashboardOverview } from './dashboard.adapter';
import { DashboardProjectionService } from './dashboard-projection.service';
import { StudyService } from './study.service';

// 过渡期兼容层：GET /dashboard/overview 的响应结构是遗留契约（integration
// 脚本与 App.tsx 依赖 student.name、stageAssessment.questions、question 目录），
// 而 DashboardProjectionService 尚未提供题目目录 / 完整报告等事实
// （见 docs/phase-2.7.3-dashboard-audit.md：题目池需要未来的 catalog query）。
// 在投影链达到 parity 之前，兼容查询委托遗留实现，保证响应结构不变。
// 新快照链仍然服务于 /student-state 与后续精简 payload 的迁移。
@Injectable()
export class DashboardQueryService {
  constructor(
    private readonly projection: DashboardProjectionService,
    @Optional() private readonly legacy?: StudyService,
  ) {}

  async getDashboardOverviewCompat(userId: string, asOf: Date = new Date()): Promise<LegacyDashboardOverviewDto> {
    if (this.legacy) {
      return this.legacy.getDashboardOverview(userId) as unknown as LegacyDashboardOverviewDto;
    }
    const snapshot = await this.projection.getSnapshot(userId, asOf);
    return toLegacyDashboardOverview(snapshot, asOf.toISOString());
  }
}
