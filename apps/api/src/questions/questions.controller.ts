import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';
import { ConfirmAiVariantDto, GenerateAiVariantDto } from './dto/ai-variant.dto';
import { AiVariantService } from './ai-variant.service';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { toStudentQuestions } from './question-view';
import type { UserProfile } from '@kaoyan408/shared';

@Controller('questions')
export class QuestionsController {
  constructor(
    private readonly questionsService: QuestionsService,
    private readonly aiVariantService: AiVariantService,
  ) {}

  @Get()
  listQuestions(@Query('knowledgePointId') knowledgePointId?: string, @Query('subject') subject?: string, @Query('chapter') chapter?: string) {
    return toStudentQuestions(this.questionsService.listQuestions({
      knowledgePointId,
      subject,
      chapter,
    }));
  }

  @Post()
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  createQuestion(@Body() input: CreateQuestionDto) {
    return this.questionsService.createQuestion(input);
  }

  @Post(':questionId/ai-variant')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  generateAiVariant(
    @CurrentUser() user: UserProfile,
    @Param('questionId') questionId: string,
    @Body() input: GenerateAiVariantDto,
  ) {
    return this.aiVariantService.generate(user.id, questionId, input.count ?? 1);
  }

  @Post(':questionId/ai-variant/confirm')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  confirmAiVariant(
    @CurrentUser() user: UserProfile,
    @Param('questionId') questionId: string,
    @Body() input: ConfirmAiVariantDto,
  ) {
    return this.aiVariantService.confirm(user.id, questionId, input);
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
  listTeacherQuestions(@Query('knowledgePointId') knowledgePointId?: string, @Query('subject') subject?: string, @Query('chapter') chapter?: string) {
    return this.questionsService.listQuestions({
      knowledgePointId,
      subject,
      chapter,
    });
  }
}
