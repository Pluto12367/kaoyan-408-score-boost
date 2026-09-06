/**
 * Effectiveness Module (V6.3) — production read-model surface for the
 * V6/V6.1/V6.2 learning effectiveness derivation layer.
 *
 * Follows the AgentModule composition pattern: the read-model dependency
 * chain (projections → StudentContextQueryService) is registered here
 * directly instead of importing StudyModule (which exports nothing).
 * Every provider only depends on the global PrismaService; projections are
 * stateless, so a module-local instance is safe.
 */

import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { MasterySummaryProjectionService } from '../study/mastery-summary-projection.service';
import { StudentStateProjectionService } from '../study/student-state-projection.service';
import { PracticeProjectionService } from '../study/practice-projection.service';
import { WrongQuestionProjectionService } from '../study/wrong-question-projection.service';
import { TodayPlanProjectionService } from '../study/today-plan-projection.service';
import { AssessmentProjectionService } from '../study/assessment-projection.service';
import { StudentContextQueryService } from '../study/student-context.query.service';
import { TeacherStudentAuthorizationRepository } from '../study/teacher-student-authorization.repository';
import { EffectivenessController } from './effectiveness.controller';
import { EffectivenessService } from './effectiveness.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [EffectivenessController],
  providers: [
    MasterySummaryProjectionService,
    StudentStateProjectionService,
    PracticeProjectionService,
    WrongQuestionProjectionService,
    TodayPlanProjectionService,
    AssessmentProjectionService,
    StudentContextQueryService,
    TeacherStudentAuthorizationRepository,
    EffectivenessService,
  ],
})
export class EffectivenessModule {}
