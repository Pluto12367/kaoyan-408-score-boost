import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { KnowledgePoint, Subject } from '@kaoyan408/shared';
import { StudyService } from './study.service';
import { CreatePracticeRecordDto } from './dto/create-practice-record.dto';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/roles.decorator';

@Controller()
export class StudyController {
  constructor(private readonly studyService: StudyService) {}

  @Get('knowledge-points')
  listKnowledgePoints() {
    return this.studyService.listKnowledgePoints();
  }

  @Post('knowledge-points')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
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

  @Get('trial-progress')
  getTrialProgress(@Query('userId') userId?: string) {
    return this.studyService.getTrialProgress(userId);
  }

  @Get('study-reminders')
  getStudyReminders(@Query('userId') userId?: string) {
    return this.studyService.getStudyReminders(userId);
  }

  @Get('sprint-plan')
  getSprintPlan(@Query('userId') userId?: string) {
    return this.studyService.getSprintPlan(userId);
  }

  @Get('mastery-map')
  getMasteryMap(@Query('userId') userId?: string) {
    return this.studyService.getMasteryMap(userId);
  }

  @Get('students/:userId/profile')
  getStudentLearningProfile(@Param('userId') userId: string) {
    return this.studyService.getStudentLearningProfile(userId);
  }

  @Get('admin/metrics')
  @UseGuards(RoleGuard)
  @Roles('admin')
  getAdminMetrics() {
    return this.studyService.getAdminMetrics();
  }

  @Get('admin/users')
  @UseGuards(RoleGuard)
  @Roles('admin')
  getAdminUsers() {
    return this.studyService.getAdminUsers();
  }

  @Post('admin/users/:userId/trial-status')
  @UseGuards(RoleGuard)
  @Roles('admin')
  updateAdminUserTrialStatus(@Param('userId') userId: string, @Body('trialStatus') trialStatus?: string) {
    return this.studyService.updateAdminUserTrialStatus(userId, trialStatus);
  }

  @Get('admin/feedback')
  @UseGuards(RoleGuard)
  @Roles('admin')
  getFeedbackList() {
    return this.studyService.getFeedbackList();
  }

  @Get('admin/review-queue')
  @UseGuards(RoleGuard)
  @Roles('admin')
  getReviewQueue() {
    return this.studyService.getReviewQueue();
  }

  @Post('admin/review-queue/:reviewItemId/approve')
  @UseGuards(RoleGuard)
  @Roles('admin')
  approveReviewItem(@Param('reviewItemId') reviewItemId: string, @Body('reviewerId') reviewerId?: string) {
    return this.studyService.approveReviewItem(reviewItemId, reviewerId);
  }

  @Post('admin/review-queue/:reviewItemId/recheck')
  @UseGuards(RoleGuard)
  @Roles('admin')
  markReviewItemNeedsRecheck(@Param('reviewItemId') reviewItemId: string, @Body('reviewerId') reviewerId?: string) {
    return this.studyService.markReviewItemNeedsRecheck(reviewItemId, reviewerId);
  }

  @Get('admin/system-config')
  @UseGuards(RoleGuard)
  @Roles('admin')
  getSystemConfig() {
    return this.studyService.getSystemConfig();
  }

  @Get('teacher/class-analytics')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  getTeacherClassAnalytics() {
    return this.studyService.getTeacherClassAnalytics();
  }

  @Post('admin/system-config')
  @UseGuards(RoleGuard)
  @Roles('admin')
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

  @Post('feedback')
  submitFeedback(@Body() input: {
    userId?: string;
    rating?: number;
    scene?: string;
    message?: string;
    surveyUrl?: string;
  }) {
    return this.studyService.submitFeedback(input);
  }

  @Get('papers')
  listPapers() {
    return this.studyService.listPapers();
  }

  @Get('assessment-history')
  getAssessmentHistory(@Query('userId') userId?: string) {
    return this.studyService.getAssessmentHistory(userId);
  }

  @Post('papers/generate')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  generatePaper(@Body() input: {
    title?: string;
    paperType?: '模拟卷' | '阶段卷' | '专项卷';
    knowledgePointIds?: string[];
    questionCount?: number;
    createdBy?: string;
  }) {
    return this.studyService.generatePaper(input);
  }

  @Post('papers/:paperId/submit')
  submitPaper(@Param('paperId') paperId: string, @Body() input: {
    userId?: string;
    answers?: Array<{
      questionId: string;
      selectedAnswer: string;
      timeSpentSec: number;
    }>;
  }) {
    return this.studyService.submitPaper(paperId, input);
  }

  @Get('wrong-questions')
  listWrongQuestions(@Query('userId') userId?: string) {
    return this.studyService.listWrongQuestions(userId);
  }

  @Get('wrong-questions/summary')
  getWrongQuestionSummary(@Query('userId') userId?: string) {
    return this.studyService.getWrongQuestionSummary(userId);
  }

  @Get('practice-sets/recommended')
  getRecommendedPracticeSet(@Query('userId') userId?: string) {
    return this.studyService.getRecommendedPracticeSet(userId);
  }

  @Get('review-resources/recommended')
  getRecommendedReviewResources(@Query('userId') userId?: string) {
    return this.studyService.getRecommendedReviewResources(userId);
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

  @Post('ai/follow-up')
  createAiFollowUp(@Body() input: {
    userId?: string;
    questionId: string;
    message?: string;
  }) {
    return this.studyService.createAiFollowUp(input);
  }

  @Post('practice-records')
  createPracticeRecord(@Body() input: CreatePracticeRecordDto) {
    return this.studyService.createPracticeRecord(input);
  }

  @Post('study-tasks/:taskId/complete')
  completeStudyTask(@Param('taskId') taskId: string, @Body() input: {
    userId?: string;
    completedQuestionCount?: number;
    correctCount?: number;
    minutesSpent?: number;
    selfRating?: number;
  }) {
    return this.studyService.completeStudyTask(taskId, input);
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
