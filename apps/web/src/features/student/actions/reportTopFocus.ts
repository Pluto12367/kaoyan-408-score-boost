/**
 * V8 backlog #9 — report-side arbitration for the "single most important
 * thing". The home page already arbitrates via selectCanonicalNextAction
 * (session → today → review → redo → assessment); this module applies the
 * same precedence to the report headline so no two pages name different
 * first steps. Weakness remains visible as the AFTER line — it is never a
 * competing headline while an open today task exists.
 */

export interface ReportTopFocusInput {
  todayPlan: { priorityTasks: Array<{ title: string; completed?: boolean; status?: string }> } | null;
  canonicalNodeWeakness: { title: string; masteryRate: number } | null;
  topMasteryWeakPoint: { title: string; masteryRate: number } | null;
  /** Point-level practice weakness (accuracy-based) — below node weakness. */
  practiceWeakness?: { title: string; accuracyRate: number } | null;
}

export interface ReportTopFocus {
  headline: string;
  /** Caliber label so the basis of the decision is explicit. */
  basis: 'today-plan+node-weakness' | 'node-weakness' | 'mastery-map' | 'maintenance';
  afterLine: string | null;
}

function isOpen(task: { completed?: boolean; status?: string }): boolean {
  return !task.completed && task.status !== 'done' && task.status !== 'completed';
}

export function resolveReportTopFocus(input: ReportTopFocusInput): ReportTopFocus {
  const weaknessRate = (weak: { title: string; masteryRate: number } | null): string | null => {
    if (!weak) return null;
    return `${weak.title}（掌握 ${Math.round(weak.masteryRate)}%）`;
  };

  const openTask = input.todayPlan?.priorityTasks.find(isOpen) ?? null;
  const nodeWeakness = input.canonicalNodeWeakness
    ? weaknessRate(input.canonicalNodeWeakness)
    : null;

  if (openTask) {
    return {
      headline: `先完成今日任务「${openTask.title}」`,
      basis: 'today-plan+node-weakness',
      afterLine: nodeWeakness ? `完成后再优先补强 ${nodeWeakness}` : null,
    };
  }

  if (nodeWeakness && input.canonicalNodeWeakness) {
    return {
      headline: `优先补强「${input.canonicalNodeWeakness.title}」`,
      basis: 'node-weakness',
      afterLine: null,
    };
  }

  if (input.practiceWeakness) {
    return {
      headline: `优先训练「${input.practiceWeakness.title}」（正确率 ${Math.round(input.practiceWeakness.accuracyRate)}% · Point 练习表现）`,
      basis: 'node-weakness',
      afterLine: null,
    };
  }

  if (input.topMasteryWeakPoint) {
    return {
      headline: `优先补强「${input.topMasteryWeakPoint.title}」`,
      basis: 'mastery-map',
      afterLine: null,
    };
  }

  return {
    headline: '暂无薄弱信号：用推荐练习保持节奏',
    basis: 'maintenance',
    afterLine: null,
  };
}
