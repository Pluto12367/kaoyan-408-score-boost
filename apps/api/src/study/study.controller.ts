import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { StudyService } from './study.service';
import { CreatePracticeRecordDto } from './dto/create-practice-record.dto';

@Controller()
export class StudyController {
  constructor(private readonly studyService: StudyService) {}

  @Get('knowledge-points')
  listKnowledgePoints() {
    return this.studyService.listKnowledgePoints();
  }

  @Get('reports/overview')
  getOverviewReport() {
    return this.studyService.getOverviewReport();
  }

  @Get('dashboard/overview')
  getDashboardOverview() {
    return this.studyService.getDashboardOverview();
  }

  @Get('wrong-questions')
  listWrongQuestions(@Query('userId') userId?: string) {
    return this.studyService.listWrongQuestions(userId);
  }

  @Post('practice-records')
  createPracticeRecord(@Body() input: CreatePracticeRecordDto) {
    return this.studyService.createPracticeRecord(input);
  }

  @Post('diagnostics/plan')
  generatePlan() {
    return this.studyService.generatePlan();
  }
}
