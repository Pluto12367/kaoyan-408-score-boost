import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ScoreCenterController } from './routes';
import { ScoreCenterService } from './service';
import { RecommendationService } from '../study/recommendation.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [ScoreCenterController],
  providers: [ScoreCenterService, RecommendationService],
  exports: [ScoreCenterService, RecommendationService],
})
export class ScoreCenterModule {}
