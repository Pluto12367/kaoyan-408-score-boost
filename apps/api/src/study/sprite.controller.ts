/**
 * V10-1 Sprite Core endpoint.
 *
 * GET /sprite/state composes the canonical read models (StudentContext, today
 * plan, V4 proactive interventions, V9 ProgressStory) into the companion's
 * presentational state. Read-only; every source is pulled defensively — a
 * failing source is recorded in degraded.unavailableSources and the mood
 * ladder degrades honestly (never disguised as a quiet new user). Access
 * mirrors DailyBriefController's resolveUserId pattern.
 */

import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import type { UserProfile } from '@kaoyan408/shared';
import { CurrentUser } from '../auth/current-user.decorator';
import { RoleGuard } from '../auth/role.guard';
import { Roles } from '../auth/roles.decorator';
import { LearningSignalService } from '../adaptive/learning-signal.service';
import { detectLearningRisks } from '../adaptive/learning-risk';
import { deriveProactiveInterventions } from '../adaptive/proactive-coach';
import { EffectivenessService } from '../effectiveness/effectiveness.service';
import { ScoreCenterService } from '../score-center/service';
import { buildProgressStory } from './progress-narrative';
import { SpriteMemoryService } from './sprite-memory.service';
import { StudentContextQueryService } from './student-context.query.service';
import { StudyService } from './study.service';
import { buildSpriteState } from './sprite-state';
import type { SpriteInterventionLite, SpritePlanLite, SpriteStateInput, SpriteStoryLite } from './sprite-state';

const ACTIVE_SESSION_WINDOW_MS = 2 * 60 * 60 * 1000;
const SPRITE_MEMORY_INPUT_MAX = 500;

@Controller()
export class SpriteController {
  constructor(
    private readonly studyService: StudyService,
    private readonly studentContext: StudentContextQueryService,
    private readonly scoreCenterService?: ScoreCenterService,
    private readonly effectiveness?: EffectivenessService,
    private readonly learningSignals?: LearningSignalService,
    private readonly spriteMemory?: SpriteMemoryService,
  ) {}

  @Get('sprite/state')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getSpriteState(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    const userId = this.resolveUserId(user, viewUserId);
    const now = new Date();
    const unavailableSources: string[] = [];

    const pull = async <T>(source: string, puller: () => Promise<T>): Promise<T | null> => {
      try {
        return await puller();
      } catch {
        unavailableSources.push(source);
        return null;
      }
    };

    const context = await pull('student_context', () => this.studentContext.getContext(userId));
    const planResponse = await pull('today_plan', () => this.studyService.getTodayPlan(userId));
    const story = await pull('progress_story', () => this.buildStoryLite(userId, context));
    const interventions = await this.pullInterventions(userId, unavailableSources);
    const memory = this.spriteMemory && this.spriteMemory.enabled
      ? await pull('sprite_memory', () => this.spriteMemory!.list(userId))
      : null;

    const plan: SpritePlanLite | null = planResponse
      ? {
          completedTasks: planResponse.summary.completedTasks,
          totalTasks: planResponse.summary.totalTasks,
          recoveredFromGap: Boolean(
            (planResponse as { recoveredFromGap?: { carriedCount: number } | null }).recoveredFromGap,
          ),
          carryOverCount:
            (planResponse as { recoveredFromGap?: { carriedCount: number } | null }).recoveredFromGap?.carriedCount ?? 0,
          firstOpenTaskTitle: planResponse.priorityTasks.find((task) => !task.completed)?.title ?? null,
        }
      : null;

    const activeSession = context != null
      ? context.momentum.recentSessions.some(
          (session) =>
            !session.completed &&
            now.getTime() - new Date(session.lastActiveAt).getTime() < ACTIVE_SESSION_WINDOW_MS,
        )
      : false;

    const input: SpriteStateInput = {
      asOf: now.toISOString(),
      userId,
      context: context
        ? {
            momentum: { studyStreak: context.momentum.studyStreak },
            practice: {
              recentAccuracy: {
                status: context.practice.recentAccuracy.status,
                value: context.practice.recentAccuracy.value,
                sampleSize: context.practice.recentAccuracy.sampleSize,
              },
              totalCount: context.practice.totalCount,
            },
            review: { dueCount: context.review.dueCount, overdueCount: context.review.overdueCount },
          }
        : null,
      plan,
      interventions,
      story,
      activeSession,
      unavailableSources,
      memory: memory ?? null,
    };

    return buildSpriteState(input);
  }

  /**
   * V10-4 — the sprite's user-stated memory. Strictly self-only (the session
   * user's own id; viewUserId is deliberately not honoured here).
   */
  @Get('sprite/memory')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getSpriteMemory(@CurrentUser() user: UserProfile) {
    if (!this.spriteMemory) {
      return { userId: user.id, entries: [], disabled: true };
    }
    const entries = await this.spriteMemory.list(user.id);
    return { userId: user.id, entries: entries ?? [], disabled: entries === null };
  }

  @Post('sprite/memory')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async rememberSpriteMemory(
    @CurrentUser() user: UserProfile,
    @Body() input: { text?: string },
  ) {
    const text = typeof input?.text === 'string' ? input.text.trim() : '';
    if (!text) throw new BadRequestException('text is required');
    if (text.length > SPRITE_MEMORY_INPUT_MAX) {
      throw new BadRequestException(`text must be at most ${SPRITE_MEMORY_INPUT_MAX} characters`);
    }
    if (!this.spriteMemory) {
      return { userId: user.id, entries: [], added: [], disabled: true };
    }
    const result = await this.spriteMemory.remember(user.id, text, new Date());
    return { userId: user.id, ...result };
  }

  @Delete('sprite/memory/:memoryId')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async forgetSpriteMemory(
    @CurrentUser() user: UserProfile,
    @Param('memoryId') memoryId: string,
  ) {
    if (!this.spriteMemory) {
      return { userId: user.id, removed: false, disabled: true };
    }
    const result = await this.spriteMemory.forget(user.id, memoryId);
    return { userId: user.id, ...result };
  }

  /**
   * V9 ProgressStory facts reused as celebration evidence — buildProgressStory
   * stays the single owner of the week-delta validity gate (≥2 valid snapshots
   * per half-window); the sprite never recomputes a delta.
   */
  private async buildStoryLite(
    userId: string,
    context: Awaited<ReturnType<StudentContextQueryService['getContext']>> | null,
  ): Promise<SpriteStoryLite | null> {
    if (!context) return null;
    const [trend, interventionsView] = await Promise.all([
      this.scoreCenterService?.getMasteryTrend(userId, 14) ?? Promise.resolve(null),
      this.effectiveness?.getInterventions(userId) ?? Promise.resolve(null),
    ]);
    const gatesPassed = interventionsView
      ? interventionsView.events.filter((view) => view.outcomeCorrelation.matched).length
      : 0;
    const built = buildProgressStory({
      masterySeries: trend?.overall ?? [],
      accuracyTrend: {
        status: context.practice.recentAccuracy.status,
        value: context.practice.recentAccuracy.value,
        baseline: context.practice.recentAccuracy.baseline,
      },
      gatesPassed,
      resolvedCount: context.review.resolvedCount,
      streak: context.momentum.studyStreak,
    });
    return {
      weekDelta: built.weekDelta,
      gatesPassed,
      resolvedCount: context.review.resolvedCount,
      streak: context.momentum.studyStreak,
    };
  }

  /** An empty list means "no risk worth surfacing" (V9 Phase 5); only a throw marks the source unavailable. */
  private async pullInterventions(userId: string, unavailableSources: string[]): Promise<SpriteInterventionLite[]> {
    if (!this.learningSignals) return [];
    try {
      const { signals } = await this.learningSignals.getLearningSignals(userId);
      const risks = detectLearningRisks(signals);
      return deriveProactiveInterventions({ signals, risks, asOf: new Date().toISOString() })
        .slice(0, 2)
        .map((item) => ({
          id: item.id,
          trigger: item.trigger,
          severity: item.severity,
          headline: item.headline,
          actions: item.actions,
          actorHint: item.actorHint,
        }));
    } catch {
      unavailableSources.push('proactive');
      return [];
    }
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
