/**
 * AI Metrics Controller (Phase AI-12).
 *
 * GET /ai/metrics — live snapshot of the AI observability window.
 * Dashboard-facing data contract is documented in
 * docs/ai-learning-agent-production-final-report.md §AI-12.
 */

import { Controller, Get, UseGuards } from '@nestjs/common';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/roles.decorator';
import { AiMetricsService } from './ai-metrics.service';

@Controller()
export class AiMetricsController {
  constructor(private readonly metrics: AiMetricsService) {}

  @Get('ai/metrics')
  @UseGuards(RoleGuard)
  @Roles('admin')
  getMetrics() {
    return this.metrics.snapshot();
  }
}