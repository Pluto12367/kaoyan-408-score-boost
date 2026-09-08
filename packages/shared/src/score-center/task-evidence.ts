/**
 * V11-M2 — Learning Evidence Projection (pure module).
 *
 * Closes audit P1-1: "completing a task produces no capability evidence".
 * This projection joins a completed task with the practice/mastery facts on
 * its OWN questions and nodes, then states honestly whether capability
 * changed:
 *   - the completion marker alone is never evidence (insufficient_data)
 *   - practice after completion on the task's questions plus a mastery rise
 *     on its nodes → improved (numbers attached)
 *   - practice with no mastery movement → practiced (no gain claimed)
 *   - practice without any mastery snapshot → practiced, snapshot absence
 *     stated
 * Pure module: zero imports, deterministic; the service owns all IO.
 */

export interface TaskEvidenceAttempt {
  readonly questionId: string;
  readonly submittedAt: string;
  readonly correct: boolean;
}

export interface TaskEvidenceInput {
  readonly taskId: string;
  readonly title: string;
  readonly completedDate: string | null;
  readonly nodeIds: readonly string[];
  /** Practices on this task's questions around completion (service-bounded). */
  readonly attempts: readonly TaskEvidenceAttempt[];
  /** nodeId → mastery at completion (nearest snapshot before) vs current. */
  readonly masteryByNode: Readonly<
    Record<string, { readonly atCompletion: number | null; readonly current: number | null }>
  >;
  readonly asOf: string;
}

export interface TaskMasteryDelta {
  readonly nodeId: string;
  readonly before: number | null;
  readonly current: number | null;
  readonly delta: number | null;
}

export interface TaskEvidence {
  readonly taskId: string;
  readonly title: string;
  readonly completedDate: string | null;
  readonly completionState: 'completed' | 'pending';
  readonly practice: {
    readonly attempts: number;
    readonly correctCount: number;
    readonly accuracyRate: number | null;
  };
  readonly masteryDeltas: readonly TaskMasteryDelta[];
  readonly verdict: 'improved' | 'practiced' | 'practiced_no_gain' | 'insufficient_data';
  readonly verdictBasis: string;
  readonly source: 'derived';
}

export function buildTaskEvidence(input: TaskEvidenceInput): TaskEvidence {
  const completed = input.completedDate != null;
  const attempts = input.attempts;
  const correctCount = attempts.filter((row) => row.correct).length;
  const accuracyRate =
    attempts.length > 0 ? Math.round((correctCount / attempts.length) * 100) : null;

  const masteryDeltas: TaskMasteryDelta[] = input.nodeIds
    .map((nodeId) => {
      const row = input.masteryByNode[nodeId];
      if (!row) return null;
      const delta =
        row.atCompletion != null && row.current != null
          ? Math.round((row.current - row.atCompletion) * 100) / 100
          : null;
      return { nodeId, before: row.atCompletion, current: row.current, delta };
    })
    .filter((row): row is TaskMasteryDelta => row != null);

  const { verdict, verdictBasis } = resolveVerdict({
    completed,
    attempts: attempts.length,
    accuracyRate,
    correctCount,
    masteryDeltas,
  });

  return {
    taskId: input.taskId,
    title: input.title,
    completedDate: input.completedDate,
    completionState: completed ? 'completed' : 'pending',
    practice: {
      attempts: attempts.length,
      correctCount,
      accuracyRate,
    },
    masteryDeltas,
    verdict,
    verdictBasis,
    source: 'derived',
  };
}

function resolveVerdict(facts: {
  completed: boolean;
  attempts: number;
  accuracyRate: number | null;
  correctCount: number;
  masteryDeltas: readonly TaskMasteryDelta[];
}): { verdict: TaskEvidence['verdict']; verdictBasis: string } {
  if (!facts.completed) {
    return { verdict: 'insufficient_data', verdictBasis: '任务未完成，不存在完成后的能力证据。' };
  }
  if (facts.attempts === 0) {
    return {
      verdict: 'insufficient_data',
      verdictBasis: '任务已完成，但完成标记≠能力证据：任务知识点上没有练习记录。',
    };
  }

  const rising = facts.masteryDeltas.filter((row) => (row.delta ?? 0) > 0);
  if (rising.length > 0) {
    const total = rising.reduce((sum, row) => sum + (row.delta ?? 0), 0);
    return {
      verdict: 'improved',
      verdictBasis: `完成后练习正确率 ${facts.accuracyRate ?? '—'}%，${rising.length} 个节点掌握度上升（合计 +${Math.round(total * 100) / 100}）。`,
    };
  }

  const hasSnapshot = facts.masteryDeltas.length > 0;
  if (facts.accuracyRate != null && facts.accuracyRate >= 60) {
    return {
      verdict: 'practiced',
      verdictBasis: hasSnapshot
        ? `练习正确率 ${facts.accuracyRate}%，掌握度未见上升——建议复盘错题后再练一组验证。`
        : '练习事实已记录；该任务知识点暂无掌握度快照，暂无法判断能力变化。',
    };
  }
  return {
    verdict: 'practiced_no_gain',
    verdictBasis: `练习正确率 ${facts.accuracyRate ?? 0}%，掌握度未见上升——建议按错因复盘后再验证。`,
  };
}
