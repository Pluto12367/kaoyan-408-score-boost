import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import type { KnowledgePoint, Subject } from '@kaoyan408/shared';
import { StudyService } from './study.service';
import { CreatePracticeRecordDto } from './dto/create-practice-record.dto';

@Controller()
export class StudyController {
  constructor(private readonly studyService: StudyService) {}

  @Get('knowledge-points')
  listKnowledgePoints() {
    return this.studyService.listKnowledgePoints();
  }

  @Post('knowledge-points')
  createKnowledgePoint(@Body() input: Partial<KnowledgePoint>) {
    return this.studyService.createKnowledgePoint(input);
  }

  @Get('reports/overview')
  getOverviewReport() {
    return this.studyService.getOverviewReport();
  }

  @Get('dashboard/overview')
  getDashboardOverview() {
    return this.studyService.getDashboardOverview();
  }

  @Get('admin/metrics')
  getAdminMetrics() {
    return this.studyService.getAdminMetrics();
  }

  @Get('admin/review-queue')
  getReviewQueue() {
    return this.studyService.getReviewQueue();
  }

  @Post('admin/review-queue/:reviewItemId/approve')
  approveReviewItem(@Param('reviewItemId') reviewItemId: string, @Body('reviewerId') reviewerId?: string) {
    return this.studyService.approveReviewItem(reviewItemId, reviewerId);
  }

  @Get('admin/system-config')
  getSystemConfig() {
    return this.studyService.getSystemConfig();
  }

  @Post('admin/system-config')
  updateSystemConfig(@Body() input: {
    recommendation?: Partial<{
      stageAssessmentQuestionLimit: number;
      dailyTargetQuestionCount: number;
      speedRiskMultiplier: number;
    }>;
    updatedBy?: string;
  }) {
    return this.studyService.updateSystemConfig(input);
  }

  @Get('papers')
  listPapers() {
    return this.studyService.listPapers();
  }

  @Post('papers/generate')
  generatePaper(@Body() input: {
    title?: string;
    paperType?: '模拟卷' | '阶段卷' | '专项卷';
    knowledgePointIds?: string[];
    questionCount?: number;
    createdBy?: string;
  }) {
    return this.studyService.generatePaper(input);
  }

  @Get('wrong-questions')
  listWrongQuestions(@Query('userId') userId?: string) {
    return this.studyService.listWrongQuestions(userId);
  }

  @Get('practice-sets/recommended')
  getRecommendedPracticeSet(@Query('userId') userId?: string) {
    return this.studyService.getRecommendedPracticeSet(userId);
  }

  @Post('practice-sets/:practiceSetId/submit')
  submitPracticeSet(@Param('practiceSetId') practiceSetId: string, @Body() input: {
    userId?: string;
    answers?: Array<{
      questionId: string;
      selectedAnswer: string;
      timeSpentSec: number;
    }>;
  }) {
    return this.studyService.submitPracticeSet(practiceSetId, input);
  }

  @Post('wrong-questions/:questionId/review')
  reviewWrongQuestion(@Param('questionId') questionId: string, @Body('userId') userId?: string) {
    return this.studyService.reviewWrongQuestion(questionId, userId);
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

  @Post('ai/tutor-reply')
  createTutorReply(@Body() input: {
    userId?: string;
    questionId: string;
    selectedAnswer?: string;
    prompt?: string;
  }) {
    return this.studyService.createTutorReply(input);
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

  @Post('diagnostics/profile')
  applyDiagnosticProfile(@Body() input: {
    targetScore: number;
    currentScore: number;
    remainingDays: number;
    dailyHours: number;
    weakestSubject: Subject;
  }) {
    return this.studyService.applyDiagnosticProfile(input);
  }
}
