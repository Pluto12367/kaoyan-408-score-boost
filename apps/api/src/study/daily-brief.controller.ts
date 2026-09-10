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
import { ReviewShadowService } from './review-shadow.service';
import { TaskEvidenceService } from './task-evidence.service';
import { LearningEvidenceService } from './learning-evidence.service';
import { RecommendationExposureService } from './recommendation-exposure.service';
import { ReviewSemanticsShadowService } from './review-semantics-shadow.service';
import { LearningImpactService } from './learning-impact.service';

@Controller()
export class DailyBriefController {
  constructor(
    private readonly studyService: StudyService,
    private readonly studentContext: StudentContextQueryService,
    private readonly scoreCenterService?: ScoreCenterService,
    private readonly effectiveness?: EffectivenessService,
    private readonly learningSignals?: LearningSignalService,
    private readonly feedbackRepository?: FeedbackRepository,
    private readonly reviewShadow?: ReviewShadowService,
    private readonly taskEvidence?: TaskEvidenceService,
    private readonly learningImpact?: LearningImpactService,
    private readonly learningEvidence?: LearningEvidenceService,
    private readonly recommendationExposure?: RecommendationExposureService,
    private readonly reviewSemanticsShadow?: ReviewSemanticsShadowService,
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

  /**
   * LE-V10 F3 — review shadow baseline: how well the CURRENT scheduler
   * retains knowledge, from facts that already exist. Admin/teacher only;
   * the result carries its own sample-size honesty label.
   */
  @Get('coach/review-shadow')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  async getReviewShadow() {
    if (!this.reviewShadow) {
      return {
        generatedAt: new Date().toISOString(),
        shadow: null,
        reason: 'store_unavailable',
      };
    }
    const shadow = await this.reviewShadow.getReviewShadow();
    return {
      generatedAt: new Date().toISOString(),
      shadow,
      reason: shadow == null ? 'store_unavailable' : null,
    };
  }

  /**
   * V11-M2 — learning evidence for the student's recently completed tasks:
   * did capability actually change? Read-only projection over completion +
   * practice + mastery facts; self-only access.
   */
  @Get('coach/task-evidence')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getTaskEvidence(@CurrentUser() user: UserProfile) {
    if (!this.taskEvidence) {
      return { generatedAt: new Date().toISOString(), tasks: [], reason: 'store_unavailable' };
    }
    const result = await this.taskEvidence.getRecentCompletedTaskEvidence(user.id);
    if (result == null) {
      return { generatedAt: new Date().toISOString(), tasks: [], reason: 'store_unavailable' };
    }
    return result;
  }

  /**
   * V12-M1 — the learning evidence ledger.
   *
   * Answers, per recorded action, whether anything was actually OBSERVED:
   * activity markers (task completed / marked reviewed) are listed but are
   * explicitly not ability evidence. Self-only: evidence is personal data and
   * this endpoint never accepts a `userId` override.
   */
  @Get('coach/learning-evidence')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getLearningEvidence(@CurrentUser() user: UserProfile, @Query('limit') limit?: string) {
    if (!this.learningEvidence) {
      return {
        generatedAt: new Date().toISOString(),
        records: [],
        summary: null,
        reason: 'store_unavailable',
      };
    }
    const parsedLimit = limit != null && /^\d+$/.test(limit) ? Number(limit) : undefined;
    const result = await this.learningEvidence.list(user.id, { limit: parsedLimit });
    if (result == null) {
      return {
        generatedAt: new Date().toISOString(),
        records: [],
        summary: null,
        reason: 'store_unavailable',
      };
    }
    return result;
  }

  /**
   * V12-M2a — recommendation exposure funnel (EB-3).
   *
   * Separates "the engine generated a recommendation" from "the student saw
   * it". When exposure telemetry has never arrived the funnel says so and
   * reports no exposure number at all, instead of inventing a zero.
   * Self-only: recommendation history is personal data.
   */
  @Get('coach/recommendation-funnel')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getRecommendationFunnel(
    @CurrentUser() user: UserProfile,
    @Query('windowDays') windowDays?: string,
    @Query('limit') limit?: string,
  ) {
    if (!this.recommendationExposure) {
      return { generatedAt: new Date().toISOString(), funnel: null, reason: 'store_unavailable' };
    }
    const result = await this.recommendationExposure.getFunnel(user.id, {
      windowDays: parsePositiveInt(windowDays),
      limit: parsePositiveInt(limit),
    });
    if (result == null) {
      return { generatedAt: new Date().toISOString(), funnel: null, reason: 'store_unavailable' };
    }
    return result;
  }

  /**
   * V12-M3 Phase B — review semantics shadow (NON-AUTHORITATIVE).
   *
   * Replays a student's observed review history under the PROPOSED unified
   * semantics (reviews feed the same EMA as practice) and compares it with what
   * is stored, plus a time-aware retention against the stored constant.
   * Read-only; switching production semantics needs owner approval.
   * teacher/admin only — this is a model-quality instrument, not student UI.
   */
  @Get('coach/review-semantics-shadow')
  @UseGuards(RoleGuard)
  @Roles('teacher', 'admin')
  async getReviewSemanticsShadow(
    @CurrentUser() user: UserProfile,
    @Query('userId') viewUserId?: string,
    @Query('windowDays') windowDays?: string,
  ) {
    const userId = this.resolveUserId(user, viewUserId);
    if (!this.reviewSemanticsShadow) {
      return { generatedAt: new Date().toISOString(), result: null, reason: 'store_unavailable' };
    }
    const result = await this.reviewSemanticsShadow.getShadow(userId, {
      windowDays: parsePositiveInt(windowDays),
    });
    if (result == null) {
      return { generatedAt: new Date().toISOString(), result: null, reason: 'store_unavailable' };
    }
    return { userId, ...result };
  }

  /** V11-M4.2 — mastery calibration shadow: stored mastery vs observed accuracy. */  @Get('coach/mastery-calibration')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getMasteryCalibration(@CurrentUser() user: UserProfile) {
    if (!this.learningImpact) {
      return { generatedAt: new Date().toISOString(), entries: [], reason: 'store_unavailable' };
    }
    const result = await this.learningImpact.getMasteryCalibration(user.id);
    if (result == null) {
      return { generatedAt: new Date().toISOString(), entries: [], reason: 'store_unavailable' };
    }
    return result;
  }

  /** V11-M4.3 — outcome tracking: did recent recommendations help? */
  @Get('coach/outcome-tracking')
  @UseGuards(RoleGuard)
  @Roles('student', 'teacher', 'admin')
  async getOutcomeTracking(@CurrentUser() user: UserProfile) {
    if (!this.learningImpact) {
      return { generatedAt: new Date().toISOString(), interventions: [], reason: 'store_unavailable' };
    }
    const result = await this.learningImpact.getOutcomeTracking(user.id);
    if (result == null) {
      return { generatedAt: new Date().toISOString(), interventions: [], reason: 'store_unavailable' };
    }
    return result;
  }

  private resolveUserId(user: UserProfile, viewUserId?: string): string {    if (!viewUserId || viewUserId === user.id) return user.id;
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

/** Parse a query-string integer defensively; anything else means "use default". */
function parsePositiveInt(value: string | undefined): number | undefined {
  if (value == null || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}
