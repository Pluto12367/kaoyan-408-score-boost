import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuestionsModule } from './questions/questions.module';
import { StudyModule } from './study/study.module';
import { OperationsModule } from './operations/operations.module';
import { ScoreCenterModule } from './score-center/score-center.module';
import { RagModule } from './rag/rag.module';
import { AgentModule } from './agent/agent.module';
import { AiMetricsModule } from './ai-metrics/ai-metrics.module';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    OperationsModule,
    AiMetricsModule,
    AuthModule,
    QuestionsModule,
    StudyModule,
    ScoreCenterModule,
    RagModule,
    AgentModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
