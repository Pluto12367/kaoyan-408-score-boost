/**
 * V9 Phase 1 — Daily Coach endpoint.
 *
 * GET /coach/daily-brief composes the today plan with the canonical
 * StudentContext into a single grounded briefing (see
 * docs/v9-phase1-daily-coach-design.md). Read-only; access mirrors
 * StudyController's resolveUserId pattern.
 */

import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import type { UserProfile } from '@kaoyan408/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/roles.decorator';
import { studyDateKey } from './study-date';
import { buildDailyBrief } from './daily-brief';
import { StudentContextQueryService } from './student-context.query.service';
import { StudyService } from './study.service';

@Controller()
export class DailyBriefController {
  constructor(
    private readonly studyService: StudyService,
    private readonly studentContext: StudentContextQueryService,
  ) {}

  @Get('coach/daily-brief')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getDailyBrief(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    const userId = this.resolveUserId(user, viewUserId);
    const [plan, context] = await Promise.all([
      this.studyService.getTodayPlan(userId),
      this.studentContext.getContext(userId),
    ]);
    return buildDailyBrief({
      dateKey: studyDateKey(new Date()),
      remainingDays: context.exam.remainingDays,
      streak: context.momentum.studyStreak,
      recentAccuracy: {
        status: context.practice.recentAccuracy.status,
        value: context.practice.recentAccuracy.value,
      },
      review: { dueCount: context.review.dueCount, overdueCount: context.review.overdueCount },
      tasks: plan.priorityTasks.map((task) => ({
        title: task.title,
        minutes: task.minutes,
        reason: task.reason,
        completed: Boolean(task.completed),
      })),
      completedTasks: plan.summary.completedTasks,
      totalTasks: plan.summary.totalTasks,
    });
  }

  private resolveUserId(user: UserProfile, viewUserId?: string): string {
    if (!viewUserId || viewUserId === user.id) return user.id;
    if (user.role === 'admin') return viewUserId;
    if (user.role === 'teacher') {
      this.studyService.assertTeacherAuthorizedForStudent(user.id, viewUserId);
      return viewUserId;
    }
    throw new ForbiddenException('You can only access your own data');
  }
}
