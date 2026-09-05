/**
 * AI Metrics Module (Phase AI-12) — global so agent/rag/coach can record
 * without extra wiring; exposes the admin snapshot endpoint.
 */

import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AiMetricsService } from './ai-metrics.service';
import { AiMetricsController } from './ai-metrics.controller';

@Global()
@Module({
  imports: [AuthModule],
  controllers: [AiMetricsController],
  providers: [AiMetricsService],
  exports: [AiMetricsService],
})
export class AiMetricsModule {}