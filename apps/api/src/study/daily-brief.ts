/**
 * V9 Phase 1 — DailyBrief: the coach's single grounded daily briefing.
 *
 * Pure derivation (Strava-recap pattern): aggregate verified facts from the
 * today plan + StudentContext, compose them with fixed templates. No LLM in
 * this slice; insufficient_data propagates (no accuracy claim without a
 * sufficient sample, no fabricated time estimates for reviews).
 */

export interface BriefTask {
  title: string;
  minutes: number;
  reason: string;
  completed: boolean;
}

export interface DailyBriefInput {
  dateKey: string;
  remainingDays: number | null;
  streak: number;
  recentAccuracy: { status: string; value: number | null };
  review: { dueCount: number; overdueCount: number };
  tasks: readonly BriefTask[];
  completedTasks: number;
  totalTasks: number;
}

export interface BriefPriority {
  title: string;
  minutes: number | null;
  reason: string;
  kind: 'task' | 'review';
}

export interface DailyBrief {
  dateKey: string;
  headline: string;
  stateLines: string[];
  priorities: BriefPriority[];
  followUpNote: string | null;
}

export function buildDailyBrief(input: DailyBriefInput): DailyBrief {
  const openTasks = input.tasks.filter((task) => !task.completed);
  const firstOpen = openTasks[0] ?? null;
  const { overdueCount, dueCount } = input.review;

  let headline: string;
  if (firstOpen) {
    headline = `先完成「${firstOpen.title}」`;
  } else if (overdueCount > 0) {
    headline = `计划已清空，先清 ${overdueCount} 道逾期复习`;
  } else if (dueCount > 0) {
    headline = `计划已清空，先做今天到期的 ${dueCount} 道复习`;
  } else {
    headline = '今日计划已清空，做一组推荐练习保持手感';
  }

  const stateLines: string[] = [];
  if (input.remainingDays != null) stateLines.push(`距离考试 ${input.remainingDays} 天`);
  if (overdueCount > 0) stateLines.push(`逾期复习 ${overdueCount} 道（先清债）`);
  else if (dueCount > 0) stateLines.push(`今日到期复习 ${dueCount} 道`);
  else stateLines.push('复习计划已清零');
  if (input.recentAccuracy.status === 'sufficient' && input.recentAccuracy.value != null) {
    stateLines.push(`近 30 天正确率 ${Math.round(input.recentAccuracy.value * 100)}%`);
  } else {
    stateLines.push('练习量还不足以评估正确率（继续积累）');
  }
  stateLines.push(`连续学习 ${input.streak} 天`);

  const priorities: BriefPriority[] = openTasks.slice(0, 3).map((task) => ({
    title: task.title,
    minutes: task.minutes,
    reason: task.reason,
    kind: 'task' as const,
  }));
  if (priorities.length < 3 && overdueCount > 0) {
    priorities.push({
      title: `清 ${overdueCount} 道逾期复习`,
      minutes: null,
      reason: '逾期复习正在遗忘窗口里流失，优先恢复',
      kind: 'review',
    });
  }

  let followUpNote: string | null = null;
  if (input.totalTasks > 0 && input.completedTasks >= input.totalTasks) {
    followUpNote = '今日计划全部完成——去「努力与效果」看看这周的变化。';
  } else if (input.completedTasks > 0) {
    followUpNote = `今日已完成 ${input.completedTasks}/${input.totalTasks}，完成剩余后回来复盘。`;
  }

  return { dateKey: input.dateKey, headline, stateLines, priorities, followUpNote };
}
