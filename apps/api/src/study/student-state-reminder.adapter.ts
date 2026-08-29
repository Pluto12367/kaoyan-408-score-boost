import type {
  StudentTaskSnapshot,
  StudentWeakPointSnapshot,
} from './student-state.snapshot';

export interface StudyReminderDto {
  id: string;
  type: 'weakness' | 'wrong-question' | 'daily-task' | 'habit' | 'trial' | 'feedback';
  priority: 'high' | 'medium' | 'low';
  title: string;
  reason: string;
  actionText: string;
  actionAnchor: string;
}

export interface StudyRemindersDto {
  userId: string;
  title: string;
  generatedAt: string;
  items: StudyReminderDto[];
}

export interface StudentReminderTrialSnapshot {
  completedCount: number;
  totalCount: number;
}

export interface StudentReminderActivitySnapshot {
  streakDays: number;
  todayPracticeCount: number;
}

export interface StudentReminderWrongQuestionSnapshot {
  questionId: string;
  knowledgePointTitle: string;
  wrongCount: number;
  reviewStatus: 'pending' | 'reviewed';
}

export type StudentReminderTaskSnapshot = Pick<
  StudentTaskSnapshot,
  'id' | 'title' | 'completed'
> & {
  reason?: string | null;
};

export interface BuildStudyRemindersInput {
  userId: string;
  generatedAt?: Date | string;
  weakPoints: StudentWeakPointSnapshot[];
  wrongQuestion: StudentReminderWrongQuestionSnapshot | null;
  todayTasks: StudentReminderTaskSnapshot[];
  activity: StudentReminderActivitySnapshot;
  trial: StudentReminderTrialSnapshot;
}

const PRIORITY_ORDER: Record<StudyReminderDto['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function buildStudyRemindersDto(input: BuildStudyRemindersInput): StudyRemindersDto {
  const reminders: StudyReminderDto[] = [];
  const topWeakPoint = input.weakPoints[0];
  const nextTask = input.todayTasks.find((task) => !task.completed) ?? input.todayTasks[0];

  if (topWeakPoint) {
    reminders.push({
      id: `weakness-${topWeakPoint.knowledgeNodeId}`,
      type: 'weakness',
      priority: 'high',
      title: `优先补强 ${topWeakPoint.title}`,
      reason: `当前正确率 ${topWeakPoint.accuracyRate}%，提分空间较大。`,
      actionText: '去练推荐题组',
      actionAnchor: '#question',
    });
  }

  if (input.wrongQuestion) {
    reminders.push({
      id: `wrong-${input.wrongQuestion.questionId}`,
      type: 'wrong-question',
      priority: input.wrongQuestion.reviewStatus === 'pending' ? 'high' : 'medium',
      title: input.wrongQuestion.reviewStatus === 'pending' ? '先复盘一道错题' : '重新检查已复盘错题',
      reason: `${input.wrongQuestion.knowledgePointTitle} 已累计 ${input.wrongQuestion.wrongCount} 次错误记录。`,
      actionText: input.wrongQuestion.reviewStatus === 'pending' ? '去复盘' : '去错题本',
      actionAnchor: '#wrong-book',
    });
  }

  if (nextTask) {
    reminders.push({
      id: `task-${nextTask.id}`,
      type: 'daily-task',
      priority: nextTask.completed ? 'low' : 'medium',
      title: nextTask.completed ? '今日任务已有进度' : `完成今日任务：${nextTask.title}`,
      reason: nextTask.reason ?? '根据当前阶段和薄弱点推荐。',
      actionText: '去看计划',
      actionAnchor: '#plan',
    });
  }

  if (input.activity.streakDays === 0 || input.activity.todayPracticeCount === 0) {
    reminders.push({
      id: 'calendar-activity',
      type: 'habit',
      priority: 'medium',
      title: '今天还需要一次有效练习',
      reason: '学习日历会记录任务和练习，帮助你保持复习节奏。',
      actionText: '去刷题',
      actionAnchor: '#question',
    });
  }

  if (input.trial.completedCount < input.trial.totalCount) {
    reminders.push({
      id: 'trial-progress',
      type: 'trial',
      priority: 'medium',
      title: '完成剩余体验任务',
      reason: `还有 ${input.trial.totalCount - input.trial.completedCount} 个核心流程待体验，便于后续填问卷。`,
      actionText: '去体验',
      actionAnchor: '#trial',
    });
  } else {
    reminders.push({
      id: 'feedback-followup',
      type: 'feedback',
      priority: 'low',
      title: '试用完成后记得补充建议',
      reason: '你已走完核心流程，可以将真实备考需求写入问卷。',
      actionText: '去反馈',
      actionAnchor: '#feedback',
    });
  }

  return {
    userId: input.userId,
    title: '今日提分提醒',
    generatedAt: toIso(input.generatedAt ?? new Date()),
    items: reminders
      .map((item, index) => ({ item, index }))
      .sort((left, right) =>
        PRIORITY_ORDER[left.item.priority] - PRIORITY_ORDER[right.item.priority]
        || left.index - right.index,
      )
      .slice(0, 5)
      .map(({ item }) => item),
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
