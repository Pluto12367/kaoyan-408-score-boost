import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { QuestionsModule } from './questions/questions.module';
import { StudyModule } from './study/study.module';

@Module({
  imports: [AuthModule, PrismaModule, QuestionsModule, StudyModule],
  controllers: [HealthController],
})
export class AppModule {}
