/**
 * F4 V1 — large-question endpoints.
 *
 *   GET  /questions/:questionId/rubric                the rubric as authored
 *   POST /questions/:questionId/subjective-attempt    offline-scored attempt
 *
 * Kept in its own controller rather than growing study.controller.ts (already
 * 900+ lines). Access is any authenticated role: the rubric is study material
 * for students and reference material for teachers, and the scoring result is
 * scoped to the caller's own evidence ledger.
 */

import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { UserProfile } from '@kaoyan408/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/roles.decorator';
import { LargeQuestionService } from './large-question.service';

@Controller()
export class LargeQuestionController {
  constructor(private readonly largeQuestions: LargeQuestionService) {}

  @Get('questions/:questionId/rubric')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getRubric(@Param('questionId') questionId: string) {
    return this.largeQuestions.getRubric(questionId);
  }

  @Post('questions/:questionId/subjective-attempt')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  submitAttempt(
    @CurrentUser() user: UserProfile,
    @Param('questionId') questionId: string,
    @Body() body: { answerText?: string },
  ) {
    return this.largeQuestions.submitAttempt(user.id, questionId, body?.answerText ?? '');
  }
}
