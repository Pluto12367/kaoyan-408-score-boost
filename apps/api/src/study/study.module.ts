import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { QuestionsModule } from '../questions/questions.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PracticeRecordRepository } from './practice-record.repository';
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
import { StudyController } from './study.controller';
import { StudyService } from './study.service';
import { AiTutorService } from './ai-tutor.service';
import { AiTutorLogRepository } from './ai-tutor-log.repository';
import { BetaMetricsService } from './beta-metrics.service';
import { TeacherStudentAuthorizationRepository } from './teacher-student-authorization.repository';
import { AdminUserRepository } from './admin-user.repository';
import { FeedbackRepository } from './feedback.repository';

@Module({
  imports: [AuthModule, QuestionsModule, PrismaModule],
  controllers: [StudyController],
  providers: [StudyService, AiTutorService, AiTutorLogRepository, BetaMetricsService, TeacherStudentAuthorizationRepository, AdminUserRepository, FeedbackRepository, PracticeRecordRepository, LearningProgressRepository, LearningProfileRepository, KnowledgePointRepository, AssessmentHistoryRepository, PaperRepository, SystemConfigRepository, RuntimeStateRepository, LearningSessionRepository, ReviewScheduleRepository, ExamReviewPlanRepository, OnboardingPlanRepository],
})
export class StudyModule {}
