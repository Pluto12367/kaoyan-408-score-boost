import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { QuestionsModule } from './questions/questions.module';
import { StudyModule } from './study/study.module';

@Module({
  imports: [PrismaModule, QuestionsModule, StudyModule],
  controllers: [HealthController],
})
export class AppModule {}
