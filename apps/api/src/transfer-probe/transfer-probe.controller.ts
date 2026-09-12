/**
 * S2 Transfer Probe — API surface.
 *
 * GET /coach/transfer-probes    self — the probe inbox; running it performs
 *                               the lazy schedule/expire/deliver scan (the
 *                               ONLY write surface in S2, all of it probe-local)
 * GET /coach/transfer-observation self — own probe events; aggregates stay
 *                               behind the evidence gate (never shown here)
 * GET /coach/transfer-summary   teacher/admin — node aggregates + pool backlog
 *
 * Zero-Writing guarantee for the two projection endpoints: they execute no
 * mastery/evidence/task/recommendation writes (source-asserted in tests).
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/roles.decorator';
import type { UserProfile } from '@kaoyan408/shared';
import { TransferProbeProjection } from './transfer-probe.service';
import { TransferProbeService } from './transfer-probe.service';

@Controller()
export class TransferProbeController {
  constructor(
    private readonly transferProbe: TransferProbeService,
    private readonly projection: TransferProbeProjection,
  ) {}

  @Get('coach/transfer-probes')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getDueProbes(@CurrentUser() user: UserProfile) {
    const result = await this.transferProbe.getDueProbes(user.id);
    return { userId: user.id, ...result };
  }

  @Get('coach/transfer-observation')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getTransferObservation(@CurrentUser() user: UserProfile) {
    if (!this.projection.enabled) {
      return { userId: user.id, storeAvailable: false, reason: 'store_unavailable', events: [] };
    }
    return this.projection.getTransferObservation(user.id);
  }

  @Get('coach/transfer-summary')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  async getTransferSummary(@CurrentUser() user: UserProfile) {
    if (!this.projection.enabled) {
      return { generatedAt: new Date().toISOString(), storeAvailable: false, reason: 'store_unavailable', rows: [] };
    }
    return this.projection.getTransferSummary();
  }
}
