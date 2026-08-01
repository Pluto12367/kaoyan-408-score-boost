import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QuestionsController, TeacherQuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ImportBatchService } from './import/import-batch.service';
import { ImportStorageService } from './import/import-storage.service';
import { QuestionImportController } from './import/question-import.controller';
import { QuestionTemplateService } from './import/question-template.service';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [QuestionsController, TeacherQuestionsController, QuestionImportController],
  providers: [QuestionsService, ImportBatchService, ImportStorageService, QuestionTemplateService],
  exports: [QuestionsService],
})
export class QuestionsModule {}
