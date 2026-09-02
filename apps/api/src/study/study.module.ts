import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QuestionsModule } from '../questions/questions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PracticeRecordRepository } from './practice-record.repository';
import { AnswerReceiptRepository } from './answer-receipt.repository';
import { LearningProgressRepository } from './learning-progress.repository';
import { LearningProfileRepository } from './learning-profile.repository';
import { KnowledgePointRepository } from './knowledge-point.repository';
import { AssessmentHistoryRepository } from './assessment-history.repository';
import { PaperRepository } from './paper.repository';
import { SystemConfigRepository } from './system-config.repository';
import { RuntimeStateRepository } from './runtime-state.repository';
import { LearningSessionRepository } from './learning-session.repository';
import { ReviewScheduleRepository } from './review-schedule.repository';
import { ExamReviewPlanRepository } from './exam-review-plan.repository';
import { OnboardingPlanRepository } from './onboarding-plan.repository';
import { StudentStateProjectionService } from './student-state-projection.service';
import { StudentStateQueryService } from './student-state-query.service';
import { StudentStateReminderQueryService } from './student-state-reminder-query.service';
import { StudentStateSprintPlanQueryService } from './student-state-sprint-plan-query.service';
import { StudentStateTrialProgressQueryService } from './student-state-trial-progress-query.service';
import { StudentStateLearningCalendarQueryService } from './student-state-learning-calendar-query.service';
import { ActivityProjectionService } from './activity-projection.service';
import { PracticeProjectionService } from './practice-projection.service';
import { MasterySummaryProjectionService } from './mastery-summary-projection.service';
import { WrongQuestionProjectionService } from './wrong-question-projection.service';
import { WrongQuestionQueryService } from './wrong-question-query.service';
import { TodayPlanQueryService } from './today-plan-query.service';
import { TodayPlanProjectionService } from './today-plan-projection.service';
import { DashboardQueryService } from './dashboard-query.service';
import { DashboardProjectionService } from './dashboard-projection.service';
import { AssessmentProjectionService } from './assessment-projection.service';
import { StageAssessmentProjectionService } from './stage-assessment-projection.service';
import { StageAssessmentQueryService } from './stage-assessment-query.service';
import { AssessmentHistoryProjectionService } from './assessment-history-projection.service';
import { AssessmentHistoryQueryService } from './assessment-history-query.service';
import { ExamScoreHistoryProjectionService } from './exam-score-history.projection.service';
import { ExamScoreHistoryQueryService } from './exam-score-history.query.service';
import { StudyController } from './study.controller';
import { StudyService } from './study.service';
import { AiTutorService } from './ai-tutor.service';
import { AiTutorLogRepository } from './ai-tutor-log.repository';
import { BetaMetricsService } from './beta-metrics.service';
import { TeacherStudentAuthorizationRepository } from './teacher-student-authorization.repository';
import { AdminUserRepository } from './admin-user.repository';
import { FeedbackRepository } from './feedback.repository';
import { UserEventRepository } from './user-event.repository';
import { ScoreCenterModule } from '../score-center/score-center.module';
import { LearningLoopTriggerService } from './learning-loop-trigger.service';
import { LearningLoopRepository } from './learning-loop.repository';
import { ContextualCoachService } from './contextual-coach.service';
import { ContextualCoachContextAssembler } from './contextual-coach-context-assembler.service';
import { OverviewReportProjectionService } from './overview-report-projection.service';
import { OverviewQueryService } from './overview-query.service';

@Module({
  imports: [AuthModule, QuestionsModule, PrismaModule, ScoreCenterModule],
  controllers: [StudyController],
  providers: [StudyService, OverviewReportProjectionService, OverviewQueryService, StudentStateProjectionService, StudentStateQueryService, StudentStateReminderQueryService, StudentStateSprintPlanQueryService, StudentStateTrialProgressQueryService, StudentStateLearningCalendarQueryService, ActivityProjectionService, PracticeProjectionService, MasterySummaryProjectionService, WrongQuestionProjectionService, WrongQuestionQueryService, TodayPlanProjectionService, TodayPlanQueryService, DashboardProjectionService, DashboardQueryService, AssessmentProjectionService, StageAssessmentProjectionService, StageAssessmentQueryService, AssessmentHistoryProjectionService, AssessmentHistoryQueryService, ContextualCoachService, ContextualCoachContextAssembler, ExamScoreHistoryQueryService, {
    provide: ExamScoreHistoryProjectionService,
    useFactory: (sessions: LearningSessionRepository, practiceRecords: PracticeRecordRepository) =>
      new ExamScoreHistoryProjectionService({ sessions, practiceRecords }),    inject: [LearningSessionRepository, PracticeRecordRepository],
  }, AiTutorService, AiTutorLogRepository, BetaMetricsService, TeacherStudentAuthorizationRepository, AdminUserRepository, FeedbackRepository, UserEventRepository, LearningLoopRepository, LearningLoopTriggerService, PracticeRecordRepository, AnswerReceiptRepository, LearningProgressRepository, LearningProfileRepository, KnowledgePointRepository, AssessmentHistoryRepository, PaperRepository, SystemConfigRepository, RuntimeStateRepository, LearningSessionRepository, ReviewScheduleRepository, ExamReviewPlanRepository, OnboardingPlanRepository],
})
export class StudyModule {}
