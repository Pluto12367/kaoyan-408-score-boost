import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';

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
}
