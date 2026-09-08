import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Headers, Param, Patch, Post, Query, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import type { AiTutorFollowUpMode, Subject, WrongQuestionFilter, WrongQuestionMasteryStatus } from '@kaoyan408/shared';
import { StudyService } from './study.service';
import { ExamDiagnosisService } from './exam-diagnosis.service';
import { AdminDataQualityService } from './admin-data-quality.service';
import { StudentStateProjectionService } from './student-state-projection.service';
import { StudentStateQueryService } from './student-state-query.service';
import { StudentStateReminderQueryService } from './student-state-reminder-query.service';
import { StudentStateSprintPlanQueryService } from './student-state-sprint-plan-query.service';
import { StudentStateTrialProgressQueryService } from './student-state-trial-progress-query.service';
import { StudentStateLearningCalendarQueryService } from './student-state-learning-calendar-query.service';
import { WrongQuestionQueryService } from './wrong-question-query.service';
import { TodayPlanQueryService } from './today-plan-query.service';
import { DashboardQueryService } from './dashboard-query.service';
import { StageAssessmentQueryService } from './stage-assessment-query.service';
import { AssessmentHistoryQueryService } from './assessment-history-query.service';
import { ExamScoreHistoryQueryService } from './exam-score-history.query.service';
import { CreatePracticeRecordDto } from './dto/create-practice-record.dto';
import { CompleteStudyTaskDto } from './dto/complete-study-task.dto';
import {
  ImportAssessmentHistoryDto,
  RebalanceTasksDto,
  RescheduleTaskDto,
} from './dto/plan-adjustment.dto';
import { RecordUserEventDto } from './dto/user-event.dto';
import {
  SaveLearningSessionDto,
  StartLearningSessionDto,
  SubmitLearningSessionDto,
} from './dto/learning-session.dto';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import type { UserProfile } from '@kaoyan408/shared';
import { ContextualCoachService } from './contextual-coach.service';
import type { ContextualCoachRequest } from './contextual-coach.types';
import { OverviewQueryService } from './overview-query.service';
import { RecommendationActionService, toHttpActionError } from './recommendation-action.service';
import { LearningSessionActionService } from './learning-session-action.service';
import { ActionOutcomeAuditService } from './action-outcome-audit.service';
import { ActionLearningSignalService } from './action-learning-signal.service';
import { RecommendationFeedbackService } from './recommendation-feedback.service';
import { isReservedCanonicalEventType, isTelemetryEventType } from './canonical-event-writer.service';
import { parseMinutesBudget } from './quick-session';
import { StudentContextQueryService } from './student-context.query.service';

@Controller()
export class StudyController {
  constructor(
    private readonly studyService: StudyService,
    private readonly studentStateProjection: StudentStateProjectionService,
    private readonly studentStateQuery: StudentStateQueryService,
    private readonly studentStateReminderQuery: StudentStateReminderQueryService,
    private readonly studentStateSprintPlanQuery: StudentStateSprintPlanQueryService,
    private readonly studentStateTrialProgressQuery: StudentStateTrialProgressQueryService,
    private readonly studentStateLearningCalendarQuery: StudentStateLearningCalendarQueryService,
    private readonly wrongQuestionQuery: WrongQuestionQueryService,
    private readonly todayPlanQuery: TodayPlanQueryService,
    private readonly dashboardQuery: DashboardQueryService,
    private readonly stageAssessmentQuery: StageAssessmentQueryService,
    private readonly assessmentHistoryQuery: AssessmentHistoryQueryService,
    private readonly examScoreHistoryQuery: ExamScoreHistoryQueryService,
    private readonly contextualCoachService: ContextualCoachService,
    private readonly overviewQuery: OverviewQueryService,
    private readonly recommendationActionService: RecommendationActionService,
    private readonly learningSessionActionService: LearningSessionActionService,
    private readonly actionOutcomeAuditService: ActionOutcomeAuditService,
    private readonly actionLearningSignalService: ActionLearningSignalService,
    private readonly recommendationFeedbackService: RecommendationFeedbackService,
    private readonly studentContextQuery: StudentContextQueryService,
    private readonly examDiagnosis: ExamDiagnosisService,
    private readonly adminDataQuality: AdminDataQualityService,
  ) {}

  @Post('recommendation-actions')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async createRecommendationAction(@CurrentUser() user: UserProfile, @Body() input: Record<string, unknown>) {
    try {
      return await this.recommendationActionService.createAction({ ...input, userId: user.id } as never);
    } catch (error) { throw toHttpActionError(error); }
  }

  @Post('recommendation-actions/:id/start')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async startRecommendationAction(@CurrentUser() user: UserProfile, @Param('id') actionId: string, @Body() input: { expectedVersion?: number }) {
    try { return await this.recommendationActionService.startAction({ userId: user.id, actionId, expectedVersion: input.expectedVersion as number }); } catch (error) { throw toHttpActionError(error); }
  }

  @Post('recommendation-actions/:id/complete')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async completeRecommendationAction(@CurrentUser() user: UserProfile, @Param('id') actionId: string, @Body() input: { expectedVersion?: number }) {
    try { return await this.recommendationActionService.completeAction({ userId: user.id, actionId, expectedVersion: input.expectedVersion as number }); } catch (error) { throw toHttpActionError(error); }
  }

  @Post('recommendation-actions/:id/cancel')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async cancelRecommendationAction(@CurrentUser() user: UserProfile, @Param('id') actionId: string, @Body() input: { expectedVersion?: number }) {
    try { return await this.recommendationActionService.cancelAction({ userId: user.id, actionId, expectedVersion: input.expectedVersion as number }); } catch (error) { throw toHttpActionError(error); }
  }

  @Post('learning-sessions/from-action')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async createLearningSessionFromAction(@CurrentUser() user: UserProfile, @Body() input: { actionId: string; resourceId: string; metadata?: Record<string, unknown> }) {
    try { return await this.learningSessionActionService.createLearningSessionFromAction({ ...input, userId: user.id }); } catch (error) { throw toHttpActionError(error); }
  }

  @Get('recommendation-actions/:id/outcome')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getRecommendationActionOutcome(@CurrentUser() user: UserProfile, @Param('id') actionId: string) {
    try { return await this.actionOutcomeAuditService.buildOutcome(user.id, actionId); } catch (error) { throw toHttpActionError(error); }
  }

  @Get('recommendation-actions/:id/learning-signal')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getRecommendationActionLearningSignal(@CurrentUser() user: UserProfile, @Param('id') actionId: string) {
    try { return await this.actionLearningSignalService.buildSignal(user.id, actionId); } catch (error) { throw toHttpActionError(error); }
  }

  @Get('recommendation-actions/:id/feedback')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getRecommendationActionFeedback(@CurrentUser() user: UserProfile, @Param('id') actionId: string) {
    try { return await this.recommendationFeedbackService.getFeedback(user.id, actionId); } catch (error) { throw toHttpActionError(error); }
  }

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
    return this.dashboardQuery.getDashboardOverviewCompat(this.resolveUserId(user, viewUserId));
  }

  @Get('overview/canonical')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getCanonicalOverview(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
    @Query('asOf') asOfValue?: string,
  ) {
    const asOf = asOfValue ? new Date(asOfValue) : new Date();
    return this.overviewQuery.getCanonicalOverview(
      this.resolveUserId(user, viewUserId),
      Number.isNaN(asOf.getTime()) ? new Date() : asOf,
    );
  }

  @Get('student-state')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getStudentStateSnapshot(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studentStateProjection.getSnapshot(this.resolveUserId(user, viewUserId));
  }

  @Get('student-context')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getStudentContext(
    @CurrentUser() user: UserProfile,
    @Query('asOf') asOfValue?: string,
  ) {
    const asOf = asOfValue ? new Date(asOfValue) : new Date();
    if (Number.isNaN(asOf.getTime())) throw new BadRequestException('Invalid asOf');
    return this.studentContextQuery.getContext(user.id, asOf);
  }

  @Get('trial-progress')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getTrialProgress(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studentStateTrialProgressQuery.getTrialProgressCompat(this.resolveUserId(user, viewUserId));
  }

  @Get('study-reminders')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getStudyReminders(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studentStateReminderQuery.getStudyRemindersCompat(this.resolveUserId(user, viewUserId));
  }

  @Get('sprint-plan')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getSprintPlan(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studentStateSprintPlanQuery.getSprintPlanCompat(this.resolveUserId(user, viewUserId));
  }

  @Get('mastery-map')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getMasteryMap(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.studentStateQuery.getMasteryMapCompat(this.resolveUserId(user, viewUserId));
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
    return this.wrongQuestionQuery.getWrongQuestionsCompat(this.resolveUserId(user, viewUserId), this.parseWrongQuestionFilters({
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
    return this.wrongQuestionQuery.getWrongQuestionSummaryCompat(this.resolveUserId(user, viewUserId));
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
    @Query('minutes') minutes?: string,
    @Query('mode') mode?: string,
  ) {
    return this.studyService.getRecommendedPracticeSet(this.resolveUserId(user, viewUserId), parseMinutesBudget(minutes), mode);
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
    return this.studentStateLearningCalendarQuery.getLearningCalendarCompat(this.resolveUserId(user, viewUserId));
  }

  @Get('assessments/stage')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getStageAssessment(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.stageAssessmentQuery.getStageAssessmentCompat(this.resolveUserId(user, viewUserId));
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
    @Body() input: { questionId: string; message?: string; mode?: AiTutorFollowUpMode },
  ) {
    return this.studyService.createAiFollowUp({ ...input, userId: user.id });
  }

  @Post('ai/contextual-coach')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  createContextualCoach(
    @CurrentUser() user: UserProfile,
    @Body() input: ContextualCoachRequest & { userId?: string },
  ) {
    if (input && 'userId' in input) throw new BadRequestException('userId is not allowed in request body');
    return this.contextualCoachService.contextualCoach(user.id, input);
  }

  @Post('practice-records')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async createPracticeRecord(
    @CurrentUser() user: UserProfile,
    @Body() input: CreatePracticeRecordDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (input.userId) this.assertAccess(user, input.userId);
    const trimmedKey = idempotencyKey?.trim();
    if (!trimmedKey) throw new BadRequestException('Idempotency-Key is required');
    if (trimmedKey.length > 255) throw new BadRequestException('Idempotency-Key is too long');
    const record = await this.studyService.createPracticeRecord(
      { ...input, userId: user.id },
      { idempotencyKey: trimmedKey },
    );
    if ('analysis' in record && 'correctAnswer' in record && 'knowledgePointTitle' in record) return record;
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
    return this.todayPlanQuery.getTodayPlanCompat(user.id);
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

  @Post('tasks/:taskId/reschedule')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  rescheduleTask(
    @CurrentUser() user: UserProfile,
    @Param('taskId') taskId: string,
    @Body() input: RescheduleTaskDto,
  ) {
    return this.studyService.rescheduleTask(user.id, taskId, input.scheduledDate);
  }

  @Post('tasks/rebalance')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  rebalanceTasks(@CurrentUser() user: UserProfile, @Body() input: RebalanceTasksDto) {
    return this.studyService.rebalanceTasks(user.id, input.mode);
  }

  @Post('assessment-history/import')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  importAssessmentHistory(@CurrentUser() user: UserProfile, @Body() input: ImportAssessmentHistoryDto) {
    return this.studyService.importAssessmentHistory(user.id, input);
  }

  @Post('events')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  recordUserEvent(@CurrentUser() user: UserProfile, @Body() input: RecordUserEventDto) {
    if (isReservedCanonicalEventType(input.type)) {
      throw new ForbiddenException('Canonical events are server-only');
    }
    if (!isTelemetryEventType(input.type)) {
      throw new BadRequestException('Unsupported telemetry event type');
    }
    return this.studyService.recordUserEvent(user.id, input.type, input.payload);
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
  async reportWrongReason(
    @CurrentUser() user: UserProfile,
    @Param('questionId') questionId: string,
    @Body() input: {
      selfReportedReason: string;
      redoCorrect: boolean;
      timeSpentSec: number;
      isReview?: boolean;
      actionId?: string;
      idempotencyKey?: string;
    },
  ) {
    try { return await this.studyService.reportWrongReason(questionId, user.id, input); } catch (error) { throw toHttpActionError(error); }
  }

  @Get('review/due')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getDueReviews(@CurrentUser() user: UserProfile) {
    return this.wrongQuestionQuery.getDueReviewsCompat(user.id);
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

  /** LE-V10 F2 — mock-exam diagnosis: score-150 estimate, node-loss
   * attribution with exam frequency, target gap, recovery closure. */
  @Get('exam/diagnosis/:sessionId')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getExamDiagnosis(
    @CurrentUser() user: UserProfile,
    @Param('sessionId') sessionId: string,
  ) {
    if (!this.examDiagnosis) {
      throw new ServiceUnavailableException('Exam diagnosis is unavailable without a database');
    }
    return this.examDiagnosis.getExamDiagnosis(sessionId, user.id);
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
    return this.examScoreHistoryQuery.getExamScoreHistoryCompat(user.id);
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
    return this.assessmentHistoryQuery.getAssessmentHistoryCompat(this.resolveUserId(user, viewUserId));
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

  /** V11-M1 — catalog data-quality observability (audit B4/B6/B13). */
  @Get('admin/data-quality')
  @UseGuards(RoleGuard)
  @Roles('admin')
  async getAdminDataQuality() {
    if (!this.adminDataQuality) {
      throw new ServiceUnavailableException('Data quality report is unavailable without a database');
    }
    return this.adminDataQuality.getDataQualityReport();
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
