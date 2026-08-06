import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { Subject, WrongQuestionFilter, WrongQuestionMasteryStatus } from '@kaoyan408/shared';
import { StudyService } from './study.service';
import { CreatePracticeRecordDto } from './dto/create-practice-record.dto';
import { CompleteStudyTaskDto } from './dto/complete-study-task.dto';
import {
  SaveLearningSessionDto,
  StartLearningSessionDto,
  SubmitLearningSessionDto,
} from './dto/learning-session.dto';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserProfile } from '@kaoyan408/shared';

@Controller()
export class StudyController {
  constructor(private readonly studyService: StudyService) {}

  // ---- Student endpoints (require student+ auth) ----
  // All student-facing endpoints use @CurrentUser() — userId NEVER comes from the client

  @Get('knowledge-points')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  listKnowledgePoints() {
    return this.studyService.listKnowledgePoints();
  }

  @Post('knowledge-points')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  createKnowledgePoint(@Body() input: Record<string, unknown>) {
    return this.studyService.createKnowledgePoint(input);
  }

  @Get('dashboard/overview')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getDashboardOverview(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studyService.getDashboardOverview(this.resolveUserId(user, viewUserId));
  }

  @Get('trial-progress')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getTrialProgress(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studyService.getTrialProgress(this.resolveUserId(user, viewUserId));
  }

  @Get('study-reminders')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getStudyReminders(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studyService.getStudyReminders(this.resolveUserId(user, viewUserId));
  }

  @Get('sprint-plan')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getSprintPlan(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studyService.getSprintPlan(this.resolveUserId(user, viewUserId));
  }

  @Get('mastery-map')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getMasteryMap(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studyService.getMasteryMap(this.resolveUserId(user, viewUserId));
  }

  @Get('students/:userId/profile')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getStudentLearningProfile(
    @CurrentUser() user: UserProfile,
    @Param('userId') userId: string,
  ) {
    this.assertAccess(user, userId);
    return this.studyService.getStudentLearningProfile(userId);
  }

  @Get('wrong-questions')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  listWrongQuestions(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
    @Query('subject') subject?: string,
    @Query('chapter') chapter?: string,
    @Query('knowledgePointId') knowledgePointId?: string,
    @Query('mistakeReason') mistakeReason?: string,
    @Query('minWrongCount') minWrongCount?: string,
    @Query('masteryStatus') masteryStatus?: string,
    @Query('reviewedWithinDays') reviewedWithinDays?: string,
    @Query('importance') importance?: string,
  ) {
    return this.studyService.listWrongQuestions(this.resolveUserId(user, viewUserId), this.parseWrongQuestionFilters({
      subject,
      chapter,
      knowledgePointId,
      mistakeReason,
      minWrongCount,
      masteryStatus,
      reviewedWithinDays,
      importance,
    }));
  }

  @Get('wrong-questions/summary')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getWrongQuestionSummary(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studyService.getWrongQuestionSummary(this.resolveUserId(user, viewUserId));
  }

  @Post('wrong-questions/:questionId/review')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  reviewWrongQuestion(
    @CurrentUser() user: UserProfile,
    @Param('questionId') questionId: string,
  ) {
    return this.studyService.reviewWrongQuestion(questionId, user.id);
  }

  @Get('practice-sets/recommended')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getRecommendedPracticeSet(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studyService.getRecommendedPracticeSet(this.resolveUserId(user, viewUserId));
  }

  @Get('review-resources/recommended')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getRecommendedReviewResources(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studyService.getRecommendedReviewResources(this.resolveUserId(user, viewUserId));
  }

  @Post('practice-sets/:practiceSetId/submit')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  submitPracticeSet(
    @CurrentUser() user: UserProfile,
    @Param('practiceSetId') practiceSetId: string,
    @Body() input: {
      answers?: Array<{ questionId: string; selectedAnswer: string; timeSpentSec: number; selfScore?: number; maxScore?: number }>;
    },
  ) {
    return this.studyService.submitPracticeSet(practiceSetId, { ...input, userId: user.id });
  }

  @Get('learning-calendar')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getLearningCalendar(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studyService.getLearningCalendar(this.resolveUserId(user, viewUserId));
  }

  @Get('assessments/stage')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getStageAssessment(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studyService.getStageAssessment(this.resolveUserId(user, viewUserId));
  }

  @Post('assessments/stage/submit')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  submitStageAssessment(
    @CurrentUser() user: UserProfile,
    @Body() input: {
      answers?: Array<{ questionId: string; selectedAnswer: string; timeSpentSec: number }>;
    },
  ) {
    return this.studyService.submitStageAssessment({ ...input, userId: user.id });
  }

  @Post('ai/tutor-reply')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  createTutorReply(
    @CurrentUser() user: UserProfile,
    @Body() input: { questionId: string; selectedAnswer?: string; prompt?: string },
  ) {
    return this.studyService.createTutorReply({ ...input, userId: user.id });
  }

  @Post('ai/follow-up')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  createAiFollowUp(
    @CurrentUser() user: UserProfile,
    @Body() input: { questionId: string; message?: string },
  ) {
    return this.studyService.createAiFollowUp({ ...input, userId: user.id });
  }

  @Post('practice-records')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async createPracticeRecord(
    @CurrentUser() user: UserProfile,
    @Body() input: CreatePracticeRecordDto,
  ) {
    if (input.userId) this.assertAccess(user, input.userId);
    const record = await this.studyService.createPracticeRecord({ ...input, userId: user.id });
    const feedback = await this.studyService.getPracticeFeedback(record.questionId);
    return {
      ...record,
      analysis: feedback.analysis,
      correctAnswer: feedback.correctAnswer,
      knowledgePointTitle: feedback.knowledgePointTitle,
    };
  }

  @Post('study-tasks/:taskId/complete')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  completeStudyTask(
    @CurrentUser() user: UserProfile,
    @Param('taskId') taskId: string,
    @Body() input: CompleteStudyTaskDto,
  ) {
    return this.studyService.completeStudyTask(taskId, { ...input, userId: user.id });
  }

  @Post('diagnostics/profile')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  applyDiagnosticProfile(
    @CurrentUser() user: UserProfile,
    @Body() input: {
      targetScore: number; currentScore: number; remainingDays: number;
      dailyHours: number; weakestSubject: Subject;
    },
  ) {
    return this.studyService.applyDiagnosticProfile(user.id, input);
  }

  // ---- Phase 3: Onboarding & Today's Plan ----

  // ---- Phase 4: Session Management (auto-save & resume) ----

  @Post('sessions/practice/start')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  startPracticeSession(@CurrentUser() user: UserProfile, @Body() input: StartLearningSessionDto) {
    return this.studyService.startPracticeSession(user.id, input);
  }

  @Post('sessions/practice/:sessionId/save')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  savePracticeProgress(
    @CurrentUser() user: UserProfile,
    @Param('sessionId') sessionId: string,
    @Body() input: SaveLearningSessionDto,
  ) {
    return this.studyService.savePracticeProgress(sessionId, user.id, input);
  }

  @Get('sessions/practice/:sessionId')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getPracticeSession(@CurrentUser() user: UserProfile, @Param('sessionId') sessionId: string) {
    return this.studyService.getPracticeSession(sessionId, user.id);
  }

  @Get('sessions/active')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  listActiveSessions(@CurrentUser() user: UserProfile) {
    return this.studyService.listActiveSessions(user.id);
  }

  @Post('sessions/practice/:sessionId/submit')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  submitPracticeSession(
    @CurrentUser() user: UserProfile,
    @Param('sessionId') sessionId: string,
    @Body() input: SubmitLearningSessionDto,
  ) {
    return this.studyService.submitPracticeSession(sessionId, user.id, input);
  }

  @Get('onboarding/status')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getOnboardingStatus(@CurrentUser() user: UserProfile) {
    return this.studyService.getOnboardingStatus(user.id);
  }

  @Post('onboarding/complete')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  completeOnboarding(
    @CurrentUser() user: UserProfile,
    @Body() input: {
      examYear?: number;
      targetScore: number;
      currentScore: number;
      remainingDays: number;
      dailyHours: number;
      weakestSubject: Subject;
    },
  ) {
    return this.studyService.completeOnboarding(user.id, input);
  }

  @Get('today/plan')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getTodayPlan(@CurrentUser() user: UserProfile) {
    return this.studyService.getTodayPlan(user.id);
  }

  @Post('tasks/:taskId/postpone')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  postponeTask(
    @CurrentUser() user: UserProfile,
    @Param('taskId') taskId: string,
  ) {
    return this.studyService.postponeTask(user.id, taskId);
  }

  @Post('tasks/:taskId/start')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  startTask(
    @CurrentUser() user: UserProfile,
    @Param('taskId') taskId: string,
  ) {
    return this.studyService.startTask(user.id, taskId);
  }

  // ---- Phase 5: Spaced Repetition (wrong question review scheduling) ----

  @Post('wrong-questions/:questionId/reason')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  reportWrongReason(
    @CurrentUser() user: UserProfile,
    @Param('questionId') questionId: string,
    @Body() input: {
      selfReportedReason: string;
      redoCorrect: boolean;
      timeSpentSec: number;
      isReview?: boolean;
    },
  ) {
    return this.studyService.reportWrongReason(questionId, user.id, input);
  }

  @Get('review/due')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getDueReviews(@CurrentUser() user: UserProfile) {
    return this.studyService.getDueReviews(user.id);
  }

  @Get('wrong-questions/:questionId/detail')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getWrongQuestionDetail(
    @CurrentUser() user: UserProfile,
    @Param('questionId') questionId: string,
  ) {
    return this.studyService.getWrongQuestionDetail(questionId, user.id);
  }

  @Patch('wrong-questions/:questionId/note')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  updateWrongQuestionNote(
    @CurrentUser() user: UserProfile,
    @Param('questionId') questionId: string,
    @Body('note') note?: string,
  ) {
    return this.studyService.updateWrongQuestionNote(questionId, user.id, note);
  }

  // ---- Phase 6: Mock Exam ----

  @Get('exam/report/:sessionId')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getExamReport(@CurrentUser() user: UserProfile, @Param('sessionId') sessionId: string) {
    return this.studyService.getExamReport(sessionId, user.id);
  }

  @Post('exam/review-tasks/:sessionId')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  generatePostExamReviewTasks(@CurrentUser() user: UserProfile, @Param('sessionId') sessionId: string) {
    return this.studyService.generatePostExamReviewTasks(sessionId, user.id);
  }

  @Get('exam/score-history')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getExamScoreHistory(@CurrentUser() user: UserProfile) {
    return this.studyService.getExamScoreHistory(user.id);
  }

  @Post('exam/papers/prepare')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  prepareExamPaper(
    @CurrentUser() user: UserProfile,
    @Body() input: {
      paperType?: '模拟卷' | '专项卷';
      subject?: Subject;
      questionCount?: number;
    },
  ) {
    return this.studyService.prepareExamPaper(user.id, input);
  }

  @Post('feedback')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  submitFeedback(
    @CurrentUser() user: UserProfile,
    @Body() input?: { rating?: number; scene?: string; message?: string; surveyUrl?: string },
  ) {
    return this.studyService.submitFeedback({
      userId: user.id,
      rating: input?.rating,
      scene: input?.scene,
      message: input?.message,
    });
  }

  @Get('assessment-history')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getAssessmentHistory(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studyService.getAssessmentHistory(this.resolveUserId(user, viewUserId));
  }

  @Get('reports/overview')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getOverviewReport(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studyService.getOverviewReport(this.resolveUserId(user, viewUserId));
  }

  // ---- Paper endpoints ----

  @Get('papers')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  listPapers(@CurrentUser() user: UserProfile) {
    return this.studyService.listPapers(user.role === 'student');
  }

  @Post('papers/generate')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  generatePaper(@Body() input: {
    title?: string; paperType?: '模拟卷' | '阶段卷' | '专项卷';
    knowledgePointIds?: string[]; questionCount?: number; createdBy?: string;
  }) {
    return this.studyService.generatePaper(input);
  }

  @Post('papers/:paperId/submit')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  submitPaper(
    @CurrentUser() user: UserProfile,
    @Param('paperId') paperId: string,
    @Body() input: {
      answers?: Array<{ questionId: string; selectedAnswer: string; timeSpentSec: number }>;
    },
  ) {
    return this.studyService.submitPaper(paperId, { ...input, userId: user.id });
  }

  // ---- Admin endpoints (admin only, no student access) ----

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

  @Get('admin/teacher-authorizations')
  @UseGuards(RoleGuard)
  @Roles('admin')
  listTeacherStudentAuthorizations(@Query('teacherId') teacherId?: string) {
    return this.studyService.listTeacherStudentAuthorizations(teacherId);
  }

  @Post('admin/teacher-authorizations')
  @UseGuards(RoleGuard)
  @Roles('admin')
  grantTeacherStudentAuthorization(@Body() input: { teacherId?: string; studentId?: string }) {
    return this.studyService.grantTeacherStudentAuthorization(input.teacherId, input.studentId);
  }

  @Delete('admin/teacher-authorizations/:teacherId/:studentId')
  @UseGuards(RoleGuard)
  @Roles('admin')
  revokeTeacherStudentAuthorization(@Param('teacherId') teacherId: string, @Param('studentId') studentId: string) {
    return this.studyService.revokeTeacherStudentAuthorization(teacherId, studentId);
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

  @Get('teacher/class-analytics')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  getTeacherClassAnalytics(@CurrentUser() user: UserProfile) {
    return this.studyService.getTeacherClassAnalytics(user.role === 'admin' ? undefined : user.id);
  }

  // ---- Access control helpers ----

  private resolveUserId(user: UserProfile, viewUserId?: string) {
    if (!viewUserId || viewUserId === user.id) return user.id;
    if (user.role === 'admin') return viewUserId;
    if (user.role === 'teacher') {
      this.studyService.assertTeacherAuthorizedForStudent(user.id, viewUserId);
      return viewUserId;
    }
    throw new ForbiddenException('You can only access your own data');
  }

  private assertAccess(user: UserProfile, targetUserId: string) {
    if (user.role === 'admin') return;
    if (user.role === 'teacher') {
      this.studyService.assertTeacherAuthorizedForStudent(user.id, targetUserId);
      return;
    }
    if (user.id !== targetUserId) {
      throw new ForbiddenException('You can only access your own data');
    }
  }

  private parseWrongQuestionFilters(input: {
    subject?: string;
    chapter?: string;
    knowledgePointId?: string;
    mistakeReason?: string;
    minWrongCount?: string;
    masteryStatus?: string;
    reviewedWithinDays?: string;
    importance?: string;
  }): WrongQuestionFilter {
    if (input.masteryStatus && !['未掌握', '复习中', '已掌握'].includes(input.masteryStatus)) {
      throw new BadRequestException('masteryStatus must be one of 未掌握/复习中/已掌握');
    }
    return {
      subject: input.subject,
      chapter: input.chapter,
      knowledgePointId: input.knowledgePointId,
      mistakeReason: input.mistakeReason,
      minWrongCount: parseOptionalPositiveInt(input.minWrongCount, 'minWrongCount'),
      masteryStatus: input.masteryStatus as WrongQuestionMasteryStatus | undefined,
      reviewedWithinDays: parseOptionalPositiveInt(input.reviewedWithinDays, 'reviewedWithinDays'),
      importance: parseOptionalPositiveInt(input.importance, 'importance'),
    };
  }
}

function parseOptionalPositiveInt(value: string | undefined, label: string): number | undefined {
  if (value === undefined || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new BadRequestException(`${label} must be a positive integer`);
  }
  return parsed;
}

