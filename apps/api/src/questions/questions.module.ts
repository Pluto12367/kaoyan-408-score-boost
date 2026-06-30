import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QuestionsController, TeacherQuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';

@Module({
  imports: [AuthModule],
  controllers: [QuestionsController, TeacherQuestionsController],
  providers: [QuestionsService],
  exports: [QuestionsService],
})
export class QuestionsModule {}
