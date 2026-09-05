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
import { DailyPlanningService } from './daily-planning.service';
import { ExamSimulatorService } from './exam-simulator.service';
import { SupervisorAgentService } from './supervisor.service';

@Controller()
export class AgentController {
  constructor(
    private readonly studyAgent: StudyAgentService,
    private readonly studyPlanner: StudyPlannerService,
    private readonly dailyPlanning: DailyPlanningService,
    private readonly examSimulator: ExamSimulatorService,
    private readonly supervisor: SupervisorAgentService,
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

  /**
   * PX-2 Daily AI Study Agent: evidence-based adaptive daily plan.
   * Designed for an external daily scheduler (idempotent per user+date
   * through the canonical generationKey); execute=true writes the plan.
   */
  @Post('agent/daily/plan')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async planDaily(
    @CurrentUser() user: UserProfile,
    @Body() input: { availableMinutes?: number; scheduledDate?: string; execute?: boolean; userId?: string },
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
    const availableMinutes = input?.availableMinutes;
    return this.dailyPlanning.generateDailyPlan(user.id, {
      ...(input?.execute !== undefined ? { execute: input.execute } : {}),
      ...(input?.scheduledDate !== undefined ? { scheduledDate: input.scheduledDate } : {}),
      ...(availableMinutes !== undefined ? { availableMinutes: availableMinutes as 30 | 60 | 120 | 180 } : {}),
    }, new Date());
  }

  /** PX-3 exam generation: real nodes + real question bank, LLM-free content. */
  @Post('agent/exam/generate')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async generateExam(
    @CurrentUser() user: UserProfile,
    @Body() input: { subject?: string; questionCount?: number; userId?: string },
  ) {
    if (input && 'userId' in input) throw new BadRequestException('userId is not allowed in request body');
    if (input?.subject !== undefined && !['DS', 'CO', 'OS', 'CN'].includes(input.subject)) {
      throw new BadRequestException('subject must be one of DS, CO, OS, CN');
    }
    return this.examSimulator.generateExam(user.id, {
      ...(input?.subject !== undefined ? { subject: input.subject as 'DS' | 'CO' | 'OS' | 'CN' } : {}),
      ...(input?.questionCount !== undefined ? { questionCount: input.questionCount } : {}),
    });
  }

  /** PX-3 exam analysis: deterministic per-point analysis + optional plan. */
  @Post('agent/exam/analyze')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async analyzeExam(
    @CurrentUser() user: UserProfile,
    @Body() input: { facts?: Array<{ questionId?: string; knowledgePointIds?: string[]; correct?: boolean }>; includePlan?: boolean; userId?: string },
  ) {
    if (input && 'userId' in input) throw new BadRequestException('userId is not allowed in request body');
    const facts = (input?.facts ?? [])
      .filter((fact) => typeof fact.questionId === 'string' && Array.isArray(fact.knowledgePointIds))
      .map((fact) => ({
        questionId: String(fact.questionId),
        knowledgePointIds: fact.knowledgePointIds!.map(String),
        correct: fact.correct === true,
      }));
    if (facts.length === 0) throw new BadRequestException('facts with questionId and knowledgePointIds are required');
    return this.examSimulator.analyzeExam(user.id, {
      facts,
      ...(input?.includePlan !== undefined ? { includePlan: input.includePlan } : {}),
    });
  }

  /** PX-5 supervisor entry: routes the message to the right specialist agent. */
  @Post('agent/supervisor/run')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async runSupervisor(
    @CurrentUser() user: UserProfile,
    @Body() input: { message?: string; intent?: string; payload?: Record<string, unknown>; userId?: string },
  ) {
    if (input && 'userId' in input) throw new BadRequestException('userId is not allowed in request body');
    if (!input || typeof input.message !== 'string' || !input.message.trim()) {
      throw new BadRequestException('message is required');
    }
    const intent = input.intent !== undefined && ['tutor', 'plan', 'exam', 'coach'].includes(input.intent)
      ? (input.intent as 'tutor' | 'plan' | 'exam' | 'coach')
      : undefined;
    return this.supervisor.run(user.id, {
      message: input.message,
      ...(intent ? { intent } : {}),
      ...(input.payload ? { payload: input.payload } : {}),
    });
  }
}