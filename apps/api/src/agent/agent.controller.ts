/**
 * Study Agent Controller (Phase AI-3/AI-4).
 *
 * POST /agent/study/run — runs the study planning agent for the
 * authenticated user. Writes happen only when createTasks=true is
 * explicitly requested (canonical plan writer, idempotent generationKey).
 */

import { BadRequestException, Body, Controller, Post, UseGuards } from '@nestjs/common';
import type { UserProfile } from '@kaoyan408/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/roles.decorator';
import { StudyAgentService } from './study-agent.service';
import { StudyPlannerService } from './study-planner.service';

@Controller()
export class AgentController {
  constructor(
    private readonly studyAgent: StudyAgentService,
    private readonly studyPlanner: StudyPlannerService,
  ) {}

  @Post('agent/study/run')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async runStudyAgent(
    @CurrentUser() user: UserProfile,
    @Body() input: { message?: string; createTasks?: boolean; availableMinutes?: number; scheduledDate?: string; userId?: string },
  ) {
    if (input && 'userId' in input) throw new BadRequestException('userId is not allowed in request body');
    if (!input || typeof input.message !== 'string' || !input.message.trim()) {
      throw new BadRequestException('message is required');
    }
    if (input.createTasks !== undefined && typeof input.createTasks !== 'boolean') {
      throw new BadRequestException('createTasks must be a boolean');
    }
    if (input.availableMinutes !== undefined && ![30, 60, 120, 180].includes(input.availableMinutes)) {
      throw new BadRequestException('availableMinutes must be one of 30, 60, 120, 180');
    }
    if (input.scheduledDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) {
      throw new BadRequestException('scheduledDate must be YYYY-MM-DD');
    }
    return this.studyAgent.run(user.id, {
      message: input.message,
      ...(input.createTasks !== undefined ? { createTasks: input.createTasks } : {}),
      ...(input.availableMinutes !== undefined ? { availableMinutes: input.availableMinutes } : {}),
      ...(input.scheduledDate !== undefined ? { scheduledDate: input.scheduledDate } : {}),
    });
  }

  /**
   * Study Agent V2 planning entry (Phase AI-9): generate → validate →
   * optional execute. Writing requires explicit `execute: true`.
   */
  @Post('agent/study/plan')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async planStudy(
    @CurrentUser() user: UserProfile,
    @Body() input: { goal?: string; availableMinutes?: number; scheduledDate?: string; execute?: boolean; userId?: string },
  ) {
    if (input && 'userId' in input) throw new BadRequestException('userId is not allowed in request body');
    if (input?.execute !== undefined && typeof input.execute !== 'boolean') {
      throw new BadRequestException('execute must be a boolean');
    }
    if (input?.availableMinutes !== undefined && ![30, 60, 120, 180].includes(input.availableMinutes)) {
      throw new BadRequestException('availableMinutes must be one of 30, 60, 120, 180');
    }
    if (input?.scheduledDate !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledDate)) {
      throw new BadRequestException('scheduledDate must be YYYY-MM-DD');
    }
    return this.studyPlanner.generatePlan(user.id, input ?? {}, new Date());
  }
}