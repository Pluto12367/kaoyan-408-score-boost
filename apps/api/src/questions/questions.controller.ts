import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/roles.decorator';

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
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  createQuestion(@Body() input: CreateQuestionDto) {
    return this.questionsService.createQuestion(input);
  }

  @Patch(':questionId')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  updateQuestion(@Param('questionId') questionId: string, @Body() input: Partial<CreateQuestionDto>) {
    return this.questionsService.updateQuestion(questionId, input);
  }

  @Delete(':questionId')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  deleteQuestion(@Param('questionId') questionId: string) {
    return this.questionsService.deleteQuestion(questionId);
  }
}

@Controller('teacher/questions')
@UseGuards(RoleGuard)
@Roles('teacher', 'admin')
export class TeacherQuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get()
  listTeacherQuestions() {
    return this.questionsService.listQuestions();
  }
}
