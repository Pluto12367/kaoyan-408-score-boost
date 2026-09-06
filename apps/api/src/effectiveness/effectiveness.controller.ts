/**
 * V6.3 Effectiveness Controller — read-only HTTP surface for the V6/V6.1/V6.2
 * derivation layer. Additive: no existing route or response shape is touched.
 *
 * Access model mirrors StudyController.resolveUserId: a student only sees
 * their own effectiveness data; teachers need an active authorization for
 * the requested student; admins see everything.
 */

import { ForbiddenException, Get, Query, Controller, UseGuards } from '@nestjs/common';
import type { UserProfile } from '@kaoyan408/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/roles.decorator';
import { TeacherStudentAuthorizationRepository } from '../study/teacher-student-authorization.repository';
import { EffectivenessService } from './effectiveness.service';

const MAX_WINDOW_DAYS = 180;
const DEFAULT_WINDOW_DAYS = 30;

@Controller('effectiveness')
export class EffectivenessController {
  constructor(
    private readonly effectivenessService: EffectivenessService,
    private readonly teacherAuthorizations: TeacherStudentAuthorizationRepository,
  ) {}

  @Get('summary')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getSummary(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
    @Query('windowDays') windowDays?: string,
  ) {
    return this.effectivenessService.getSummary(
      this.resolveUserId(user, viewUserId),
      parseWindowDays(windowDays),
    );
  }

  @Get('outcomes')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getOutcomes(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
    @Query('windowDays') windowDays?: string,
  ) {
    return this.effectivenessService.getOutcomes(
      this.resolveUserId(user, viewUserId),
      parseWindowDays(windowDays),
    );
  }

  @Get('interventions')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getInterventions(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    return this.effectivenessService.getInterventions(this.resolveUserId(user, viewUserId));
  }

  /**
   * Cohort comparison + strategy proposals. Proposal-only: every proposal
   * carries requiresApproval=true and never modifies production strategy.
   */
  @Get('experiments')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  async getExperiments(
    @CurrentUser() user: UserProfile,
    @Query('windowDays') windowDays?: string,
  ) {
    void user;
    return this.effectivenessService.getExperiments(parseWindowDays(windowDays));
  }

  private resolveUserId(user: UserProfile, viewUserId?: string): string {
    if (!viewUserId || viewUserId === user.id) return user.id;
    if (user.role === 'admin') return viewUserId;
    if (user.role === 'teacher') {
      if (!this.teacherAuthorizations.has(user.id, viewUserId)) {
        throw new ForbiddenException('Teacher is not authorized for this student');
      }
      return viewUserId;
    }
    throw new ForbiddenException('You can only access your own data');
  }
}

function parseWindowDays(value?: string): number {
  const parsed = value ? Number.parseInt(value, 10) : DEFAULT_WINDOW_DAYS;
  if (Number.isNaN(parsed) || parsed < 1) return DEFAULT_WINDOW_DAYS;
  return Math.min(parsed, MAX_WINDOW_DAYS);
}
