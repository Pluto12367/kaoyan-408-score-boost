/**
 * S1 Score Anchor — Score Ledger API.
 *
 * Routes live under /coach/score-evidence (the coach family). Writes are
 * SELF-ONLY: a user records evidence about their own scores, with provenance
 * derived from their role rather than from the request body. Teachers and
 * admins may view another student's evidence through the same resolveUserId
 * discipline every coach endpoint uses (teacher requires an authorization
 * record). Outcome verification is a separate teacher/admin action, never a
 * field on a student request.
 *
 * Every response honestly reports store availability: without a database the
 * endpoints return store_unavailable instead of pretending.
 */

import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/roles.decorator';
import type { UserProfile } from '@kaoyan408/shared';
import {
  RecordScoreAssessmentDto,
  RecordScoreCorrectionDto,
  RecordScoreOutcomeDto,
  RecordScorePredictionDto,
  SetExamDateDto,
} from './dto/score-evidence.dto';
import { ScoreAnchorService, type ScoreAnchorActor } from './score-anchor.service';
import { ScoreLossService } from './score-loss.service';

@Controller()
export class ScoreAnchorController {
  constructor(
    private readonly scoreAnchor: ScoreAnchorService,
    private readonly scoreLoss: ScoreLossService,
  ) {}

  @Post('coach/score-evidence/predictions')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async recordPrediction(
    @CurrentUser() user: UserProfile,
    @Body() dto: RecordScorePredictionDto,
  ) {
    // Self-only: a prediction belongs to the account it was generated for.
    const result = await this.scoreAnchor.recordPrediction(user.id, dto);
    if (!result) return { storeAvailable: false, reason: 'store_unavailable' };
    return { storeAvailable: true, ...result };
  }

  @Post('coach/score-evidence/assessments')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async recordAssessment(
    @CurrentUser() user: UserProfile,
    @Body() dto: RecordScoreAssessmentDto,
  ) {
    const result = await this.scoreAnchor.recordAssessment(
      this.actor(user),
      dto,
    );
    if (!result) return { storeAvailable: false, reason: 'store_unavailable' };
    return { storeAvailable: true, ...result };
  }

  @Post('coach/score-evidence/outcomes')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async recordOutcome(
    @CurrentUser() user: UserProfile,
    @Body() dto: RecordScoreOutcomeDto,
  ) {
    const result = await this.scoreAnchor.recordOutcome(this.actor(user), dto);
    if (!result) return { storeAvailable: false, reason: 'store_unavailable' };
    return { storeAvailable: true, ...result };
  }

  @Post('coach/score-evidence/outcomes/:id/verify')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  async verifyOutcome(
    @CurrentUser() user: UserProfile,
    @Param('id') outcomeId: string,
  ) {
    const result = await this.scoreAnchor.verifyOutcome(this.actor(user), outcomeId);
    if (!result) return { storeAvailable: false, reason: 'store_unavailable' };
    return { storeAvailable: true, ...result };
  }

  @Post('coach/score-evidence/corrections')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async recordCorrection(
    @CurrentUser() user: UserProfile,
    @Body() dto: RecordScoreCorrectionDto,
  ) {
    const result = await this.scoreAnchor.recordCorrection(this.actor(user), dto);
    if (!result) return { storeAvailable: false, reason: 'store_unavailable' };
    return { storeAvailable: true, ...result };
  }

  @Get('coach/score-evidence')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getScoreEvidence(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    // The service enforces the access discipline (admin any, teacher with an
    // authorization record, student self-only) — the controller does not
    // restate it.
    const evidence = await this.scoreAnchor.getScoreEvidence(
      this.actor(user),
      viewUserId && viewUserId !== user.id ? viewUserId : user.id,
    );
    if (!evidence) {
      return { userId: user.id, generatedAt: new Date().toISOString(), storeAvailable: false, reason: 'store_unavailable' };
    }
    return evidence;
  }

  /**
   * S1-P1 (API-1) — per-question score loss projection. Read-only and DERIVED:
   * rows are system-derived at paper-submission time, never hand-entered. The
   * service enforces the access spine (student self-only, teacher with an
   * authorization record, admin any).
   */
  @Get('coach/score-loss')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getScoreLoss(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    const loss = await this.scoreLoss.getScoreLoss(
      { userId: user.id, role: user.role },
      viewUserId && viewUserId !== user.id ? viewUserId : user.id,
    );
    if (!loss) {
      return { userId: user.id, storeAvailable: false, reason: 'store_unavailable' };
    }
    return loss;
  }

  /**
   * S1-P1 (API-2) — light anchor-availability summary: each ledger layer's
   * latest anchor plus the canonical exam timeline. Deliberately lighter than
   * GET /coach/score-evidence; the access spine is the same.
   */
  @Get('coach/score-anchor-summary')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getScoreAnchorSummary(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    const summary = await this.scoreAnchor.getScoreAnchorSummary(
      this.actor(user),
      viewUserId && viewUserId !== user.id ? viewUserId : user.id,
    );
    if (!summary) {
      return { userId: user.id, storeAvailable: false, reason: 'store_unavailable' };
    }
    return summary;
  }

  /**
   * G1.8 — exam-date entry (owner decision A6). SELF-ONLY: the handler never
   * reads a target user from the body, so a caller can only set their own date.
   * Format validation, the past-date refusal and the `remainingDays` derivation
   * all happen inside the service via the shared helper.
   */
  @Post('coach/exam-date')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async setExamDate(
    @CurrentUser() user: UserProfile,
    @Body() dto: SetExamDateDto,
  ) {
    const result = await this.scoreAnchor.setExamDate(user.id, { examDate: dto.examDate ?? null });
    if (!result) return { storeAvailable: false, reason: 'store_unavailable' };
    return { storeAvailable: true, ...result };
  }

  private actor(user: UserProfile): ScoreAnchorActor {
    return { userId: user.id, role: user.role };
  }
}