import type { TodayPlan } from '../../../../api/endpoints/onboarding';
import {
  resolveTodayRoute,
  resolveTodayTaskDestination,
  type TodayPlanTask,
} from '../../../onboarding/todayLearningRoute';
import type { StudentAction } from '../studentAction';

function toStudentActionDestination(task: TodayPlanTask): Extract<StudentAction, { type: 'today_task' }>['destination'] {
  switch (resolveTodayTaskDestination(task.mode)) {
    case 'question': return 'practice';
    case 'wrong-book': return 'review';
    case 'plan': return 'home';
  }
}

export function buildTodayAction(
  plan: Pick<TodayPlan, 'priorityTasks'>,
  nowMs?: number,
): StudentAction | null {
  const currentTask = resolveTodayRoute(plan.priorityTasks, nowMs).currentTask;
  if (!currentTask) return null;

  return {
    id: `today-task:${currentTask.id}`,
    type: 'today_task',
    title: currentTask.title,
    destination: toStudentActionDestination(currentTask),
    source: 'today-plan',
    reason: currentTask.reason,
    priority: currentTask.priority,
    context: {
      taskId: currentTask.id,
      knowledgeNodeId: currentTask.knowledgePointId,
    },
  };
}
