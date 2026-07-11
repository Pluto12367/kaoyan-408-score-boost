import { Module } from '@nestjs/common';
import { QuestionsModule } from '../questions/questions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PracticeRecordRepository } from './practice-record.repository';
import { StudyController } from './study.controller';
import { StudyService } from './study.service';

@Module({
  imports: [QuestionsModule, PrismaModule],
  controllers: [StudyController],
  providers: [StudyService, PracticeRecordRepository],
})
export class StudyModule {}
