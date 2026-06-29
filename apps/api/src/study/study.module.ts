import { Module } from '@nestjs/common';
import { QuestionsModule } from '../questions/questions.module';
import { StudyController } from './study.controller';
import { StudyService } from './study.service';

@Module({
  imports: [QuestionsModule],
  controllers: [StudyController],
  providers: [StudyService],
})
export class StudyModule {}
