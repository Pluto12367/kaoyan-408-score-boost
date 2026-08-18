import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import type { UserProfile } from '@kaoyan408/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/roles.decorator';
import { ScoreCenterService } from './service';

const ALLOWED_MINUTES = new Set([30, 60, 120, 180]);

@Controller()
export class ScoreCenterController {
  private readonly logger = new Logger(ScoreCenterController.name);

  constructor(private readonly scoreCenterService: ScoreCenterService) {}

  @Get('knowledge/mastery')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getMyMastery(@CurrentUser() user: UserProfile) {
    return this.scoreCenterService.getMyMastery(user.id);
  }

  @Get('mastery-trend')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getMasteryTrend(@CurrentUser() user: UserProfile, @Query('days') days?: string) {
    const parsed = days ? Number.parseInt(days, 10) : 14;
    return this.scoreCenterService.getMasteryTrend(user.id, Number.isNaN(parsed) ? 14 : parsed);
  }

  @Get('knowledge/:id')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getKnowledgeDetail(@CurrentUser() user: UserProfile, @Param('id') id: string) {
    const detail = await this.scoreCenterService.getKnowledgeDetail(user.id, id);
    if (!detail) throw new NotFoundException(`Knowledge point ${id} was not found`);
    return detail;
  }

  @Get('knowledge/:id/quest')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getNodeQuest(@CurrentUser() user: UserProfile, @Param('id') id: string) {
    return this.scoreCenterService.getNodeQuest(user.id, id);
  }

  @Get('wrong-questions/:questionId/exam-links')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getWrongQuestionExamLinks(@CurrentUser() user: UserProfile, @Param('questionId') questionId: string) {
    return this.scoreCenterService.getWrongQuestionExamLinks(questionId);
  }

  @Post('knowledge/:id/quest/complete')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async completeNodeQuest(
    @CurrentUser() user: UserProfile,
    @Param('id') id: string,
    @Body() body: { accuracy?: number },
  ) {
    const accuracy = typeof body.accuracy === 'number' ? body.accuracy : 0;
    const result = await this.scoreCenterService.completeNodeQuest(user.id, id, accuracy);
    if (!result) throw new NotFoundException(`Knowledge point ${id} was not found`);
    return result;
  }

  @Post('score-center/generate')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async generate(
    @CurrentUser() user: UserProfile,
    @Body() body: { targetExamDate?: string; availableMinutes?: number },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (typeof body.availableMinutes !== 'number' || !ALLOWED_MINUTES.has(body.availableMinutes)) {
      throw new BadRequestException('INVALID_AVAILABLE_MINUTES');
    }
    const targetExamDate = parseIsoDate(body.targetExamDate);
    if (!targetExamDate) {
      throw new BadRequestException('INVALID_TARGET_EXAM_DATE');
    }
    try {
      return await this.scoreCenterService.generateDailyPlan(user.id, {
        targetExamDate,
        availableMinutes: body.availableMinutes as 30 | 60 | 120 | 180,
      });
    } catch (error) {
      this.logger.error(
        'Score-center plan generation failed, falling back to the last valid plan',
        error instanceof Error ? error.stack : String(error),
      );
      const fallback = await this.scoreCenterService.getTodayScoreCenterPlan(user.id);
      if (!fallback) throw error;
      res.status(200);
      return { ...fallback, stale: true };
    }
  }
}

function parseIsoDate(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
