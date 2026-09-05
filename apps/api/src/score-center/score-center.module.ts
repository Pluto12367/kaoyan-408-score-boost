import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScoreCenterController } from './routes';
import { ScoreCenterService } from './service';
import { RecommendationService } from '../study/recommendation.service';
import { RecommendationActionAdapterService } from '../study/recommendation-action-adapter.service';
import { StudyPlanRepository } from '../study/study-plan.repository';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ScoreCenterController],
  providers: [ScoreCenterService, RecommendationService, RecommendationActionAdapterService, StudyPlanRepository],
  exports: [ScoreCenterService, RecommendationService, RecommendationActionAdapterService],
})
export class ScoreCenterModule {}
