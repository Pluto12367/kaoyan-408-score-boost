import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
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

  @Get('learning-calendar')
  getLearningCalendar(@Query('userId') userId?: string) {
    return this.studyService.getLearningCalendar(userId);
  }

  @Get('assessments/stage')
  getStageAssessment(@Query('userId') userId?: string) {
    return this.studyService.getStageAssessment(userId);
  }

  @Post('assessments/stage/submit')
  submitStageAssessment(@Body() input: {
    userId?: string;
    answers?: Array<{
      questionId: string;
      selectedAnswer: string;
      timeSpentSec: number;
    }>;
  }) {
    return this.studyService.submitStageAssessment(input);
  }

  @Post('practice-records')
  createPracticeRecord(@Body() input: CreatePracticeRecordDto) {
    return this.studyService.createPracticeRecord(input);
  }

  @Post('study-tasks/:taskId/complete')
  completeStudyTask(@Param('taskId') taskId: string, @Body('userId') userId?: string) {
    return this.studyService.completeStudyTask(taskId, userId);
  }

  @Post('diagnostics/plan')
  generatePlan() {
    return this.studyService.generatePlan();
  }
}
