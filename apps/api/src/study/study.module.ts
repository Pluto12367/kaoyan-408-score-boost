import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QuestionsModule } from '../questions/questions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PracticeRecordRepository } from './practice-record.repository';
import { LearningProgressRepository } from './learning-progress.repository';
import { LearningProfileRepository } from './learning-profile.repository';
import { KnowledgePointRepository } from './knowledge-point.repository';
import { RuntimeStateRepository } from './runtime-state.repository';
import { LearningSessionRepository } from './learning-session.repository';
import { StudyController } from './study.controller';
import { StudyService } from './study.service';

@Module({
  imports: [AuthModule, QuestionsModule, PrismaModule],
  controllers: [StudyController],
  providers: [StudyService, PracticeRecordRepository, LearningProgressRepository, LearningProfileRepository, KnowledgePointRepository, RuntimeStateRepository, LearningSessionRepository],
})
export class StudyModule {}
