import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QuestionsController, TeacherQuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ImportBatchService } from './import/import-batch.service';
import { ImportStorageService } from './import/import-storage.service';
import { QuestionImportController } from './import/question-import.controller';
import { QuestionTemplateService } from './import/question-template.service';
import { ImportCleanupInterceptor } from './import/import-cleanup.interceptor';
import { loadImportConfig, QUESTION_IMPORT_CONFIG } from './import/import-config';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [QuestionsController, TeacherQuestionsController, QuestionImportController],
  providers: [QuestionsService, ImportBatchService, { provide: QUESTION_IMPORT_CONFIG, useFactory: loadImportConfig }, ImportStorageService, QuestionTemplateService, ImportCleanupInterceptor],
  exports: [QuestionsService],
})
export class QuestionsModule {}
