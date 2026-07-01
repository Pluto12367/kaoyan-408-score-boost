import { Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { AuthService } from '../auth/auth.service';

@Controller('questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get()
  listQuestions(@Query('knowledgePointId') knowledgePointId?: string, @Query('subject') subject?: string, @Query('chapter') chapter?: string) {
    return this.questionsService.listQuestions({
      knowledgePointId,
      subject,
      chapter,
    });
  }

  @Post()
  createQuestion(@Body() input: CreateQuestionDto) {
    return this.questionsService.createQuestion(input);
  }

  @Patch(':questionId')
  updateQuestion(@Param('questionId') questionId: string, @Body() input: Partial<CreateQuestionDto>) {
    return this.questionsService.updateQuestion(questionId, input);
  }

  @Delete(':questionId')
  deleteQuestion(@Param('questionId') questionId: string) {
    return this.questionsService.deleteQuestion(questionId);
  }
}

@Controller('teacher/questions')
export class TeacherQuestionsController {
  constructor(
    private readonly questionsService: QuestionsService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  listTeacherQuestions(@Headers('authorization') authorization?: string) {
    this.authService.requireRole(authorization, ['teacher', 'admin']);
    return this.questionsService.listQuestions();
  }
}
