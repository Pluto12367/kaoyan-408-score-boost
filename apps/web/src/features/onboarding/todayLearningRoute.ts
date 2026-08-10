import type { TodayPlan } from '../../api/endpoints/onboarding';

export type TodayPlanTask = TodayPlan['priorityTasks'][number];
export type TodayTaskDestination = 'question' | 'wrong-book' | 'plan';

export interface TodayRouteState {
  orderedTasks: TodayPlanTask[];
  currentTask: TodayPlanTask | null;
  nextAvailableAt: string | null;
  allCompleted: boolean;
}

export interface TodayTaskLaunchContext {
  taskId: string;
  knowledgePointId: string;
  destination: Exclude<TodayTaskDestination, 'plan'>;
}

interface LaunchableQuestion {
  id: string;
  knowledgePointIds: string[];
}

interface LaunchableWrongQuestion {
  questionId: string;
  knowledgePointId: string;
}

export type TodayTaskPreflight =
  | { kind: 'ready'; context: TodayTaskLaunchContext }
  | { kind: 'navigate-plan'; taskId: string }
  | { kind: 'error'; message: string };

const PRIORITY_WEIGHT = { 高: 0, 中: 1, 低: 2 } as const;
const QUESTION_MODES = new Set(['基础例题', '专项训练', '阶段巩固']);
const REVIEW_MODES = new Set(['诊断复盘', '考后复盘']);
const MAX_TIMER_DELAY_MS = 2_147_483_647;

function isCompleted(task: TodayPlanTask) {
  return task.status === 'completed' || task.completed === true;
}

function isActionable(task: TodayPlanTask, nowMs: number) {
  if (isCompleted(task)) return false;
  if (task.status === 'pending' || task.status === 'in_progress') return true;
  if (task.status !== 'postponed' || !task.nextAvailableAt) return false;
  const availableAt = Date.parse(task.nextAvailableAt);
  return Number.isFinite(availableAt) && availableAt <= nowMs;
}

export function resolveTodayRoute(tasks: TodayPlanTask[], nowMs = Date.now()): TodayRouteState {
  const orderedTasks = tasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) =>
      PRIORITY_WEIGHT[left.task.priority] - PRIORITY_WEIGHT[right.task.priority]
      || left.index - right.index)
    .map(({ task }) => task);
  const currentTask = orderedTasks.find((task) => isActionable(task, nowMs)) ?? null;
  const futureTimes = orderedTasks
    .filter((task) => !isCompleted(task) && task.status === 'postponed' && task.nextAvailableAt)
    .map((task) => task.nextAvailableAt as string)
    .filter((value) => Number.isFinite(Date.parse(value)) && Date.parse(value) > nowMs)
    .sort((left, right) => Date.parse(left) - Date.parse(right));

  return {
    orderedTasks,
    currentTask,
    nextAvailableAt: currentTask ? null : futureTimes[0] ?? null,
    allCompleted: orderedTasks.every(isCompleted),
  };
}

export function getTodayRouteRefreshDelay(nextAvailableAt: string | null, nowMs = Date.now()) {
  if (!nextAvailableAt) return null;
  const availableAt = Date.parse(nextAvailableAt);
  if (!Number.isFinite(availableAt) || availableAt <= nowMs) return null;
  return Math.min(MAX_TIMER_DELAY_MS, availableAt - nowMs + 25);
}

export function shouldClearTodayTaskLaunch(previousUserId?: string, nextUserId?: string) {
  return Boolean(previousUserId) && previousUserId !== nextUserId;
}

export async function startTodayTaskIfCurrent(
  taskId: string,
  start: (taskId: string) => Promise<unknown>,
  isCurrent: () => boolean,
) {
  await start(taskId);
  return isCurrent();
}

export function resolveTodayTaskDestination(mode: string): TodayTaskDestination {
  if (QUESTION_MODES.has(mode)) return 'question';
  if (REVIEW_MODES.has(mode)) return 'wrong-book';
  return 'plan';
}

export function getTodayTaskActionLabel(task: TodayPlanTask, destination: TodayTaskDestination) {
  if (destination === 'plan') return '查看任务';
  const verb = task.status === 'in_progress' ? '继续' : '开始';
  return `${verb}${destination === 'question' ? '练习' : '复盘'}`;
}

export function preflightTodayTaskLaunch(
  task: TodayPlanTask,
  questions: LaunchableQuestion[],
  wrongQuestions: LaunchableWrongQuestion[],
): TodayTaskPreflight {
  const destination = resolveTodayTaskDestination(task.mode);
  if (destination === 'plan') return { kind: 'navigate-plan', taskId: task.id };
  const hasContent = destination === 'question'
    ? questions.some((question) => question.knowledgePointIds.includes(task.knowledgePointId))
    : wrongQuestions.some((question) => question.knowledgePointId === task.knowledgePointId);

  if (!hasContent) {
    return {
      kind: 'error',
      message: destination === 'question'
        ? '该知识点暂无可用题目，请先调整今日计划。'
        : '该知识点暂无待复盘错题，请先调整今日计划。',
    };
  }

  return {
    kind: 'ready',
    context: { taskId: task.id, knowledgePointId: task.knowledgePointId, destination },
  };
}
