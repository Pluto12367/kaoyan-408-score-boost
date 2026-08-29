import type { TodayPlanSnapshot, TodayPlanTaskFact } from './today-plan.snapshot';

export interface LegacyTodayPlanDto {
  userId: string;
  phase: string;
  generatedAt: string;
  summary: {
    completedTasks: number;
    totalTasks: number;
    completionRate: number;
    todayAccuracyRate: number;
    streakDays: number;
  };
  priorityTasks: Array<{
    id: string;
    knowledgePointId: string;
    questionIds?: string[];
    subject: string;
    chapter: string;
    title: string;
    minutes: number;
    questionCount: number;
    mode: string;
    priority: string;
    reason: string;
    nextAction: string;
    scheduledDate: string;
    status: 'pending' | 'in_progress' | 'postponed' | 'completed';
    postponeCount: number;
    startedAt?: string;
    nextAvailableAt?: string;
    completed?: boolean;
    progress?: {
      completedQuestionCount: number;
      correctCount: number;
      minutesSpent: number;
      reachedTarget: boolean;
    };
  }>;
  weekProgress: Array<{
    date: string;
    taskCount: number;
    completedTasks: number;
    totalMinutes: number;
    focusTitle?: string;
    focusCompleted?: boolean;
  }>;
  reviewDue: number;
  checkpoint: string;
  scoreCenter: unknown | null;
}

export function toLegacyTodayPlan(
  snapshot: TodayPlanSnapshot,
  generatedAt = snapshot.asOf,
): LegacyTodayPlanDto {
  const tasks = [...snapshot.taskFacts.todayTasks].sort(compareTasks);
  const completedTasks = snapshot.taskFacts.todayTasks.filter((task) => task.completed || task.status === 'completed').length;
  const totalTasks = snapshot.taskFacts.todayTasks.length;

  return {
    userId: snapshot.userId,
    phase: snapshot.planFacts.phase,
    generatedAt,
    summary: {
      completedTasks,
      totalTasks,
      completionRate: totalTasks ? Math.round((completedTasks / totalTasks) * 100) : 0,
      todayAccuracyRate: accuracyRate(tasks),
      streakDays: snapshot.activityFacts.streakDays,
    },
    priorityTasks: tasks.map(toLegacyTask),
    weekProgress: snapshot.taskFacts.weekDays.map((day) => ({
      date: day.date,
      taskCount: day.taskCount,
      completedTasks: day.completedTasks,
      totalMinutes: day.totalMinutes,
      ...(day.focusKnowledgePointId ? { focusTitle: day.focusKnowledgePointId } : {}),
      ...(day.focusCompleted == null ? {} : { focusCompleted: day.focusCompleted }),
    })),
    reviewDue: snapshot.reviewFacts.dueCount,
    checkpoint: snapshot.planFacts.checkpointState ?? '',
    scoreCenter: snapshot.scoreFacts.available ? snapshot.scoreFacts.raw : null,
  };
}

function toLegacyTask(task: TodayPlanTaskFact): LegacyTodayPlanDto['priorityTasks'][number] {
  return {
    id: task.id,
    knowledgePointId: task.knowledgePointId,
    ...(task.questionIds ? { questionIds: [...task.questionIds] } : {}),
    subject: task.subject,
    chapter: task.chapter,
    title: task.title,
    minutes: task.minutes,
    questionCount: task.questionCount,
    mode: task.mode,
    priority: task.priority,
    reason: task.status === 'completed' ? '任务已完成。' : '按当前计划完成该任务。',
    nextAction: task.status === 'completed' ? '查看完成记录。' : '开始今日任务。',
    scheduledDate: task.scheduledDate,
    status: normalizeStatus(task.status),
    postponeCount: task.postponeCount,
    ...(task.startedAt ? { startedAt: task.startedAt } : {}),
    ...(task.nextAvailableAt ? { nextAvailableAt: task.nextAvailableAt } : {}),
    completed: task.completed,
    ...(task.progress ? { progress: { ...task.progress } } : {}),
  };
}

function compareTasks(left: TodayPlanTaskFact, right: TodayPlanTaskFact): number {
  const rank = (priority: string) => priority === '高' ? 0 : priority === '中' ? 1 : 2;
  return rank(left.priority) - rank(right.priority) || left.id.localeCompare(right.id);
}

function normalizeStatus(status: string): LegacyTodayPlanDto['priorityTasks'][number]['status'] {
  if (status === 'in_progress' || status === 'postponed' || status === 'completed') return status;
  return 'pending';
}

function accuracyRate(tasks: TodayPlanTaskFact[]): number {
  const progress = tasks.map((task) => task.progress).filter((value): value is NonNullable<typeof value> => value !== null);
  const attempts = progress.reduce((sum, item) => sum + item.completedQuestionCount, 0);
  const correct = progress.reduce((sum, item) => sum + item.correctCount, 0);
  return attempts ? Math.round((correct / attempts) * 100) : 0;
}
