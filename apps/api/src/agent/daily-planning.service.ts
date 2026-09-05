/**
 * Daily AI Study Agent (Phase PX-2).
 *
 * Generates a DailyStudyPlan per student:
 *   StudentContext → evidence analysis → adaptive difficulty (pure rules)
 *   → engine draft (via tools) → plan validation → optional canonical write.
 *
 * Trigger model (Design Gate): exposed as an idempotent endpoint
 * (POST /agent/daily/plan, generationKey DAILY:{userId}:{date}:v1) to be
 * invoked by an external scheduler / the app's own daily entry — no new
 * scheduler dependency; multiple invocations per day collapse to one plan
 * through the StudyPlan generationKey unique constraint.
 *
 * The agent layer never touches the database: all reads go through tools,
 * the only write goes through the canonical createStudyTask tool.
 */

import { Injectable, Logger } from '@nestjs/common';
import { deriveDifficultyAdjustment, type DifficultyAdjustment } from './adaptive-difficulty';
import { validatePlan, type PlanDraftItem } from './plan-validator';
import { StudyAgentToolRegistry } from './agent-tools';
import { AiMetricsService } from '../ai-metrics/ai-metrics.service';

export interface DailyPlanningInput {
  availableMinutes?: 30 | 60 | 120 | 180;
  scheduledDate?: string;
  /** Execute (write today's plan) — default validate/preview only. */
  execute?: boolean;
}

export interface DailyStudyPlan {
  date: string;
  adjustment: DifficultyAdjustment;
  goals: string[];
  recommendedTasks: Array<{ title: string; knowledgeNodeId: string; action: string; minutes: number; score: number }>;
  reviewTasks: Array<{ title: string; questionId: string; wrongCount: number; overdue: boolean }>;
  riskAlerts: string[];
  execution: { executed: boolean; planId: string | null; taskCount: number; reason?: string };
  evidence: {
    recentAccuracyPercent: number | null;
    completionRatePercent: number | null;
    weakNodeCount: number;
    dueCount: number;
    overdueCount: number;
  };
  steps: { tool: string; ok: boolean; summary: string }[];
}

@Injectable()
export class DailyPlanningService {
  private readonly logger = new Logger(DailyPlanningService.name);

  constructor(
    private readonly tools: StudyAgentToolRegistry,
    private readonly metrics?: AiMetricsService,
  ) {}

  async generateDailyPlan(userId: string, input: DailyPlanningInput, now: Date = new Date()): Promise<DailyStudyPlan> {
    const startedAt = Date.now();
    const date = input.scheduledDate ?? now.toISOString().slice(0, 10);
    const baseMinutes = input.availableMinutes ?? 60;
    const steps: DailyStudyPlan['steps'] = [];

    // Step 1: canonical student state via the read-only tool.
    const contextResult = await this.tools.execute(userId, 'getStudentContext', {}, now);
    steps.push({ tool: 'getStudentContext', ok: contextResult.ok, summary: contextResult.ok ? 'student state loaded' : `failed: ${contextResult.error}` });
    const context = contextResult.ok ? (contextResult.data as Record<string, any>) : null;

    // Step 2: evidence extraction (mastery evidence, never LLM judgement).
    const evidence = {
      recentAccuracy: (context?.practice?.recentAccuracy?.value ?? null) as number | null,
      completionRate: (context?.plan?.completion?.rate?.value ?? null) as number | null,
      weakNodeCount: (context?.mastery?.weakNodes?.length ?? 0) as number,
      dueCount: (context?.review?.dueCount ?? 0) as number,
      overdueCount: (context?.review?.overdueCount ?? 0) as number,
    };
    const adjustment = deriveDifficultyAdjustment(evidence, baseMinutes);

    // Goals: derived from weak nodes and review pressure.
    const goals: string[] = [];
    const weakTitles = (context?.mastery?.weakNodes ?? []).slice(0, 2).map((node: { title?: string }) => String(node.title ?? '')).filter(Boolean);
    if (weakTitles.length > 0) goals.push(`巩固薄弱知识点：${weakTitles.join('、')}`);
    if (evidence.dueCount > 0) goals.push(`完成 ${evidence.dueCount} 项到期复习`);
    if (goals.length === 0) goals.push('按推荐引擎优先级推进今日练习');

    // Step 3: engine draft (read-only preview) with the adjusted budget.
    const previewResult = await this.tools.execute(userId, 'generateStudyPlan', { availableMinutes: adjustment.availableMinutes, scheduledDate: date }, now);
    steps.push({ tool: 'generateStudyPlan', ok: previewResult.ok, summary: previewResult.ok ? `draft generated at ${adjustment.availableMinutes} min` : `failed: ${previewResult.error}` });
    const draftItems: PlanDraftItem[] = previewResult.ok ? ((previewResult.data as { items?: PlanDraftItem[] }).items ?? []) : [];

    // Step 4: validation (capacity/duplicates/mastered/learn-limit).
    const masteredNodeIds = (context?.mastery?.masteredPoints ?? [])
      .filter((node: { mastery?: number }) => (node.mastery ?? 0) >= 0.85)
      .map((node: { knowledgeNodeId?: string }) => String(node.knowledgeNodeId ?? ''));
    const validation = validatePlan({ items: draftItems, availableMinutes: adjustment.availableMinutes, masteredNodeIds });
    steps.push({ tool: 'validatePlan', ok: true, summary: `kept ${validation.validItems.length}/${draftItems.length} items (${validation.removed.length} removed)` });

    // Step 5: review tasks from due/high-risk evidence.
    const reviewTasks = (context?.review?.highRiskQuestions ?? []).slice(0, 3).map((item: { questionId?: string; wrongCount?: number; overdue?: boolean }, index: number) => ({
      title: `错题重做 #${item.questionId ?? index + 1}`,
      questionId: String(item.questionId ?? ''),
      wrongCount: item.wrongCount ?? 0,
      overdue: Boolean(item.overdue),
    }));

    // Step 6: risk alerts.
    const riskAlerts: string[] = [];
    if (evidence.overdueCount > 0) riskAlerts.push(`${evidence.overdueCount} 项复习已逾期，优先处理`);
    if (evidence.recentAccuracy != null && evidence.recentAccuracy < 0.5) riskAlerts.push('近期正确率偏低，建议先复盘错因再刷新题');
    const stale = context?.practice?.latestSubmittedAt ? Date.now() - new Date(context.practice.latestSubmittedAt).getTime() : 0;
    if (stale > 3 * 86_400_000) riskAlerts.push('已超过 3 天没有练习记录，保持手感很重要');

    // Step 7: optional canonical write.
    let execution: DailyStudyPlan['execution'] = { executed: false, planId: null, taskCount: 0, reason: 'not_requested' };
    if (input.execute === true) {
      if (validation.validItems.length === 0) {
        execution = { executed: false, planId: null, taskCount: 0, reason: 'validation_left_no_items' };
      } else {
        const createResult = await this.tools.execute(userId, 'createStudyTask', { scheduledDate: date, availableMinutes: adjustment.availableMinutes }, now);
        steps.push({ tool: 'createStudyTask', ok: createResult.ok, summary: createResult.ok ? `plan written for ${date}` : `failed: ${createResult.error}` });
        execution = createResult.ok
          ? { executed: true, planId: (createResult.data as { planId?: string }).planId ?? null, taskCount: (createResult.data as { taskCount?: number }).taskCount ?? 0 }
          : { executed: false, planId: null, taskCount: 0, reason: `writer_failed: ${createResult.error}` };
      }
    }

    this.metrics?.recordAgentRun({
      mode: 'workflow',
      failed: steps.some((step) => !step.ok),
      toolCalls: steps.length,
      failedTools: steps.filter((step) => !step.ok).length,
      durationMs: Date.now() - startedAt,
    });

    return {
      date,
      adjustment,
      goals,
      recommendedTasks: validation.validItems.map((item) => ({
        title: item.title,
        knowledgeNodeId: item.knowledgeNodeId,
        action: item.action,
        minutes: item.estimatedMinutes,
        score: item.score,
      })),
      reviewTasks,
      riskAlerts,
      execution,
      evidence: {
        recentAccuracyPercent: evidence.recentAccuracy == null ? null : Math.round(evidence.recentAccuracy * 100),
        completionRatePercent: evidence.completionRate == null ? null : Math.round(evidence.completionRate * 100),
        weakNodeCount: evidence.weakNodeCount,
        dueCount: evidence.dueCount,
        overdueCount: evidence.overdueCount,
      },
      steps,
    };
  }
}