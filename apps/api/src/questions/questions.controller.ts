import { Body, Controller, Get, Post } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { CreateQuestionDto } from './dto/create-question.dto';

@Controller('questions')
export class QuestionsController {
  constructor(private readonly questionsService: QuestionsService) {}

  @Get()
  listQuestions() {
    return this.questionsService.listQuestions();
  }

  @Post()
  createQuestion(@Body() input: CreateQuestionDto) {
    return this.questionsService.createQuestion(input);
  }
}
