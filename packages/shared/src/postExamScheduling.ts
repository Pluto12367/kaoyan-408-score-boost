export interface SchedulableStudyTask {
  id: string;
  scheduledDate: string;
  priority: '\u9ad8' | '\u4e2d' | '\u4f4e';
  status: 'pending' | 'in_progress' | 'postponed' | 'completed';
  mode: string;
}

const REVIEW_MODE = '\u8003\u540e\u590d\u76d8';
const PRIORITY_RANK: Record<SchedulableStudyTask['priority'], number> = {
  '\u9ad8': 3,
  '\u4e2d': 2,
  '\u4f4e': 1,
};

export function postExamTaskId(sessionId: string, dayIndex: number): string {
  return `exam-review-${sessionId}-day-${dayIndex}`;
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function dateCount<T extends SchedulableStudyTask>(tasks: readonly T[], date: string): number {
  return tasks.filter((task) => task.scheduledDate === date).length;
}

function nearestFreeDate<T extends SchedulableStudyTask>(tasks: readonly T[], date: string): string {
  let candidate = nextDate(date);
  while (dateCount(tasks, candidate) >= 3) candidate = nextDate(candidate);
  return candidate;
}

function displacementCandidate<T extends SchedulableStudyTask>(tasks: readonly T[], date: string): number {
  let selected = -1;
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    if (
      task.scheduledDate !== date
      || !['pending', 'postponed'].includes(task.status)
      || task.mode === REVIEW_MODE
    ) continue;

    if (
      selected === -1
      || PRIORITY_RANK[task.priority] < PRIORITY_RANK[tasks[selected].priority]
      || PRIORITY_RANK[task.priority] === PRIORITY_RANK[tasks[selected].priority]
    ) selected = index;
  }
  return selected;
}

function normalizeExistingTasks<T extends SchedulableStudyTask>(tasks: T[]): void {
  while (true) {
    const dates = [...new Set(tasks.map((task) => task.scheduledDate))].sort();
    const overCapacityDate = dates.find((date) => dateCount(tasks, date) > 3);
    if (!overCapacityDate) return;

    const candidateIndex = displacementCandidate(tasks, overCapacityDate);
    if (candidateIndex === -1) {
      throw new Error(
        `Cannot schedule post-exam review: protected tasks exceed daily capacity on ${overCapacityDate}`,
      );
    }
    tasks[candidateIndex] = {
      ...tasks[candidateIndex],
      scheduledDate: nearestFreeDate(tasks, overCapacityDate),
    };
  }
}

export function mergePostExamTasks<T extends SchedulableStudyTask>(
  currentTasks: readonly T[],
  reviewTasks: readonly T[],
): T[] {
  const result = currentTasks.map((task) => ({ ...task }));
  normalizeExistingTasks(result);

  for (const reviewTask of reviewTasks) {
    if (result.some((task) => task.id === reviewTask.id)) continue;

    const targetDate = reviewTask.scheduledDate;
    if (dateCount(result, targetDate) >= 3) {
      const candidateIndex = displacementCandidate(result, targetDate);
      if (candidateIndex === -1) {
        result.push({ ...reviewTask, scheduledDate: nearestFreeDate(result, targetDate) });
        continue;
      }
      result[candidateIndex] = {
        ...result[candidateIndex],
        scheduledDate: nearestFreeDate(result, targetDate),
      };
    }

    result.push({ ...reviewTask, scheduledDate: targetDate });
  }

  return result;
}
