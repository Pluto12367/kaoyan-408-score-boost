/**
 * Plan Validation (Phase AI-9) — pure functions.
 *
 * Guards an agent-proposed study plan BEFORE it reaches the canonical
 * writer. Four rules, each producing explicit removals:
 *
 *   already_mastered — node the student has already mastered (mastery ≥ 0.85)
 *   duplicate        — same node proposed twice with the same action
 *   over_capacity    — total minutes exceed the available budget (drop lowest-scored tail)
 *   learn_limit      — at most MAX_LEARN_TASKS new-learning items (cognitive load)
 *
 * The validator never mutates the plan source; it returns the filtered set
 * plus an audit trail so the agent can explain every removal.
 */

export interface PlanDraftItem {
  knowledgeNodeId: string;
  title: string;
  action: string;
  score: number;
  estimatedMinutes: number;
  reasonCodes?: readonly string[];
}

export interface PlanValidationInput {
  items: readonly PlanDraftItem[];
  availableMinutes: number;
  /** Node ids already mastered per StudentContext (mastery bucket + ≥0.85). */
  masteredNodeIds: readonly string[];
  maxLearnTasks?: number;
}

export interface RemovedPlanItem {
  item: PlanDraftItem;
  reason: 'already_mastered' | 'duplicate' | 'over_capacity' | 'learn_limit';
}

export interface PlanValidationResult {
  validItems: readonly PlanDraftItem[];
  removed: readonly RemovedPlanItem[];
  violations: string[];
  totalMinutes: number;
}

const DEFAULT_MAX_LEARN_TASKS = 3;

export function validatePlan(input: PlanValidationInput): PlanValidationResult {
  const removed: RemovedPlanItem[] = [];
  const violations: string[] = [];
  const mastered = new Set(input.masteredNodeIds);
  const maxLearn = input.maxLearnTasks ?? DEFAULT_MAX_LEARN_TASKS;

  // Pass 1: already mastered + dedupe (keep highest score per node+action).
  const bestByNodeAction = new Map<string, PlanDraftItem>();
  for (const item of input.items) {
    if (mastered.has(item.knowledgeNodeId)) {
      removed.push({ item, reason: 'already_mastered' });
      continue;
    }
    const key = `${item.knowledgeNodeId}:${item.action}`;
    const existing = bestByNodeAction.get(key);
    if (!existing) {
      bestByNodeAction.set(key, item);
    } else if (item.score > existing.score) {
      bestByNodeAction.set(key, item);
      removed.push({ item: existing, reason: 'duplicate' });
    } else {
      removed.push({ item, reason: 'duplicate' });
    }
  }

  // Pass 2: cognitive load — cap new-learning items (keep highest scored).
  const learnItems = [...bestByNodeAction.values()]
    .filter((item) => item.action === 'LEARN')
    .sort((left, right) => right.score - left.score);
  const learnKeep = new Set(learnItems.slice(0, maxLearn).map((item) => `${item.knowledgeNodeId}:${item.action}`));
  for (const item of learnItems.slice(maxLearn)) {
    bestByNodeAction.delete(`${item.knowledgeNodeId}:${item.action}`);
    removed.push({ item, reason: 'learn_limit' });
  }

  // Pass 3: capacity — drop lowest-scored items until the budget holds.
  let kept = [...bestByNodeAction.values()].sort((left, right) => right.score - left.score);
  const totalOf = (items: readonly PlanDraftItem[]) => items.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  while (kept.length > 0 && totalOf(kept) > input.availableMinutes) {
    const dropped = kept[kept.length - 1];
    kept = kept.slice(0, -1);
    bestByNodeAction.delete(`${dropped.knowledgeNodeId}:${dropped.action}`);
    removed.push({ item: dropped, reason: 'over_capacity' });
  }

  if (input.items.length === 0) violations.push('empty_plan');
  if (kept.length === 0 && input.items.length > 0) violations.push('nothing_left_after_validation');
  if (totalOf(kept) > input.availableMinutes) violations.push('over_capacity'); // defensive; pass 3 prevents this

  return {
    validItems: kept,
    removed,
    violations,
    totalMinutes: totalOf(kept),
  };
}