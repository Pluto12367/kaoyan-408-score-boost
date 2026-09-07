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
import { buildProgressStory } from './progress-narrative';
import { StudentContextQueryService } from './student-context.query.service';
import { StudyService } from './study.service';
import { ScoreCenterService } from '../score-center/service';
import { EffectivenessService } from '../effectiveness/effectiveness.service';
import { LearningSignalService } from '../adaptive/learning-signal.service';
import { detectLearningRisks } from '../adaptive/learning-risk';
import { deriveProactiveInterventions } from '../adaptive/proactive-coach';
import { assignExperimentArm, deriveFeedbackInsights } from './coach-experiments';
import { FeedbackRepository } from './feedback.repository';

@Controller()
export class DailyBriefController {
  constructor(
    private readonly studyService: StudyService,
    private readonly studentContext: StudentContextQueryService,
    private readonly scoreCenterService?: ScoreCenterService,
    private readonly effectiveness?: EffectivenessService,
    private readonly learningSignals?: LearningSignalService,
    private readonly feedbackRepository?: FeedbackRepository,
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

  /**
   * V9 Phase 5 — proactive coach: risks derived from the canonical student
   * context become at most 2 grounded interventions (headline + actions,
   * evidence-carrying). Pull-based: nothing is pushed; an empty result means
   * "no risk worth surfacing" and the UI stays quiet.
   */
  @Get('coach/proactive')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getProactiveCoach(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    const userId = this.resolveUserId(user, viewUserId);
    const generatedAt = new Date().toISOString();
    if (!this.learningSignals) {
      return { userId, generatedAt, count: 0, interventions: [], hasRisks: false };
    }
    const { signals } = await this.learningSignals.getLearningSignals(userId);
    const risks = detectLearningRisks(signals);
    const interventions = deriveProactiveInterventions({ signals, risks, asOf: generatedAt }).slice(0, 2);
    return {
      userId,
      generatedAt,
      count: interventions.length,
      hasRisks: risks.length > 0,
      interventions,
    };
  }

  /**
   * V9 Phase 6 — deterministic A/B arm for the current user + experiment.
   * Sticky by hash; the endpoint only labels — features decide what varies.
   */
  @Get('coach/experiment-assignment')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  getExperimentAssignment(
    @CurrentUser() user: UserProfile,
    @Query('key') experimentKey?: string,
    @Query('arms') armsParam?: string,
  ) {
    const key = experimentKey?.trim() || 'default';
    const arms = (armsParam ?? '').split(',').map((arm) => arm.trim()).filter(Boolean);
    const arm = assignExperimentArm(user.id, key, arms.length >= 2 ? arms : ['control', 'variant']);
    return { key, arm };
  }

  /**
   * V9 Phase 6 — feedback reflow: scenes with repeated low ratings become
   * experiment candidates. A signal for the owner, never an auto-change.
   */
  @Get('coach/feedback-insight')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  async getFeedbackInsight() {
    const records = (await this.feedbackRepository?.list()) ?? [];
    const { candidates, all } = deriveFeedbackInsights(records.map((record) => ({
      scene: record.scene,
      rating: record.rating,
    })));
    return { generatedAt: new Date().toISOString(), total: records.length, candidates, all };
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

  /** V9 Phase 3 — coach-voiced week-over-week progress story. */
  @Get('coach/progress-narrative')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getProgressNarrative(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
  ) {
    const userId = this.resolveUserId(user, viewUserId);
    const [context, trend, interventions] = await Promise.all([
      this.studentContext.getContext(userId),
      this.scoreCenterService?.getMasteryTrend(userId, 14) ?? null,
      this.effectiveness?.getInterventions(userId) ?? null,
    ]);
    const story = buildProgressStory({
      masterySeries: trend?.overall ?? [],
      accuracyTrend: {
        status: context.practice.recentAccuracy.status,
        value: context.practice.recentAccuracy.value,
        baseline: context.practice.recentAccuracy.baseline,
      },
      gatesPassed: interventions
        ? interventions.events.filter((view) => view.outcomeCorrelation.matched).length
        : 0,
      resolvedCount: context.review.resolvedCount,
      streak: context.momentum.studyStreak,
    });
    return { userId, generatedAt: new Date().toISOString(), ...story };
  }
}
