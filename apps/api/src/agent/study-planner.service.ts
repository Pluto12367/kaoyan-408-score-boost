/**
 * Study Planner (Phase AI-9) — Study Agent V2 planning entry.
 *
 * Pipeline: User Goal → Analyze Student State (memory) → Generate Plan
 * (recommendation engine preview via the tool registry) → Validate Plan
 * (pure validator: capacity/duplicates/mastered/learn-limit) → Execute
 * (only when explicitly requested; canonical writer via createStudyTask
 * tool) → Return result with full audit trail.
 *
 * The planner adds NO new write path: execution delegates to the same
 * createStudyTask tool the agent uses (generationKey idempotent).
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { validatePlan, type PlanDraftItem, type PlanValidationResult } from './plan-validator';
import { LearningMemoryService } from './learning-memory.service';
import { StudyAgentToolRegistry } from './agent-tools';

export interface PlannerInput {
  goal?: string;
  availableMinutes?: number;
  scheduledDate?: string;
  /** Execute (write) only when explicitly true; default is validate-only. */
  execute?: boolean;
}

export interface PlannerResult {
  goal: string;
  scheduledDate: string;
  memoryBrief: string | null;
  draftItemCount: number;
  validation: {
    validItemCount: number;
    totalMinutes: number;
    removed: readonly { title: string; knowledgeNodeId: string; reason: string }[];
    violations: readonly string[];
  };
  execution: {
    executed: boolean;
    planId: string | null;
    taskCount: number;
    reason?: string;
  };
  focusNodes: string[];
  steps: { tool: string; ok: boolean; summary: string }[];
}

const DEFAULT_MINUTES = 60;

@Injectable()
export class StudyPlannerService {
  private readonly logger = new Logger(StudyPlannerService.name);

  constructor(
    private readonly tools: StudyAgentToolRegistry,
    @Optional() private readonly memory?: LearningMemoryService,
  ) {}

  async generatePlan(userId: string, input: PlannerInput, now: Date = new Date()): Promise<PlannerResult> {
    const scheduledDate = input.scheduledDate ?? now.toISOString().slice(0, 10);
    const availableMinutes = input.availableMinutes ?? DEFAULT_MINUTES;
    const steps: PlannerResult['steps'] = [];
    const toolArgs = { availableMinutes, scheduledDate };

    // Step 1: analyze student state (memory, read-only).
    let memoryBrief: string | null = null;
    let masteredNodeIds: string[] = [];
    if (this.memory) {
      try {
        const memory = await this.memory.getLearningMemory(userId);
        memoryBrief = memory.brief;
      } catch (error) {
        this.logger.warn(`planner memory load failed (non-blocking): ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    // Mastered nodes come from the canonical context via the read-only tool.
    const contextResult = await this.tools.execute(userId, 'getStudentContext', {}, now);
    steps.push({ tool: 'getStudentContext', ok: contextResult.ok, summary: contextResult.ok ? 'student state analyzed' : `failed: ${contextResult.error}` });
    if (contextResult.ok) {
      const mastery = (contextResult.data as { mastery?: { masteredPoints?: readonly { knowledgeNodeId: string; mastery: number }[] } }).mastery;
      masteredNodeIds = (mastery?.masteredPoints ?? [])
        .filter((node) => node.mastery >= 0.85)
        .map((node) => node.knowledgeNodeId);
    }

    // Step 2: generate plan draft (engine preview, read-only).
    const previewResult = await this.tools.execute(userId, 'generateStudyPlan', toolArgs, now);
    steps.push({ tool: 'generateStudyPlan', ok: previewResult.ok, summary: previewResult.ok ? 'plan draft generated' : `failed: ${previewResult.error}` });
    const draftItems: PlanDraftItem[] = previewResult.ok
      ? ((previewResult.data as { items?: PlanDraftItem[] }).items ?? [])
      : [];

    // Step 3: validate the plan.
    const validation: PlanValidationResult = validatePlan({
      items: draftItems,
      availableMinutes,
      masteredNodeIds,
    });
    for (const removed of validation.removed) {
      steps.push({ tool: 'validatePlan', ok: true, summary: `removed "${removed.item.title}" (${removed.reason})` });
    }
    if (validation.violations.length > 0) {
      steps.push({ tool: 'validatePlan', ok: true, summary: `violations: ${validation.violations.join(',')}` });
    }

    // Step 4: execute through the canonical writer — only when authorized.
    let execution: PlannerResult['execution'] = { executed: false, planId: null, taskCount: 0, reason: 'not_requested' };
    if (input.execute === true) {
      if (validation.validItems.length === 0) {
        execution = { executed: false, planId: null, taskCount: 0, reason: 'validation_left_no_items' };
      } else {
        const createResult = await this.tools.execute(userId, 'createStudyTask', toolArgs, now);
        steps.push({ tool: 'createStudyTask', ok: createResult.ok, summary: createResult.ok ? `created plan for ${scheduledDate}` : `failed: ${createResult.error}` });
        execution = createResult.ok
          ? {
              executed: true,
              planId: (createResult.data as { planId?: string }).planId ?? null,
              taskCount: (createResult.data as { taskCount?: number }).taskCount ?? 0,
            }
          : { executed: false, planId: null, taskCount: 0, reason: `writer_failed: ${createResult.error}` };
      }
    }

    const focusNodes = validation.validItems
      .map((item) => (item.title))
      .slice(0, 5);

    return {
      goal: input.goal?.trim() || `安排 ${scheduledDate} 的 408 学习`,
      scheduledDate,
      memoryBrief,
      draftItemCount: draftItems.length,
      validation: {
        validItemCount: validation.validItems.length,
        totalMinutes: validation.totalMinutes,
        removed: validation.removed.map(({ item, reason }) => ({ title: item.title, knowledgeNodeId: item.knowledgeNodeId, reason })),
        violations: validation.violations,
      },
      execution,
      focusNodes,
      steps,
    };
  }
}