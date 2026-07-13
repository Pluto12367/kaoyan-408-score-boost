import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QuestionsController, TeacherQuestionsController } from './questions.controller';
import { QuestionsService } from './questions.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [QuestionsController, TeacherQuestionsController],
  providers: [QuestionsService],
  exports: [QuestionsService],
})
export class QuestionsModule {}
