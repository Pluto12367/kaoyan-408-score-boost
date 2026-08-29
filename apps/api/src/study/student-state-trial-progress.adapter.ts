import type { StudentStateSnapshot } from './student-state.snapshot';

export interface TrialProgressItemDto {
  id: 'diagnostic' | 'daily-task' | 'practice-set' | 'wrong-review' | 'feedback';
  title: string;
  description: string;
  completed: boolean;
  actionAnchor: string;
}

export interface TrialProgressDto {
  userId: string;
  title: string;
  completedCount: number;
  totalCount: number;
  completionRate: number;
  items: TrialProgressItemDto[];
  nextAction: string;
}

export interface BuildTrialProgressInput {
  snapshot: StudentStateSnapshot;
  completedTaskCount: number;
  completedPracticeSetCount: number;
  wrongReviewCount: number;
  feedbackCount: number;
}

export function buildTrialProgressDto(input: BuildTrialProgressInput): TrialProgressDto {
  const { snapshot } = input;
  const items: TrialProgressItemDto[] = [
    {
      id: 'diagnostic',
      title: '提交入学诊断',
      description: '生成目标分、当前阶段和第一版学习计划。',
      completed: Boolean(snapshot.goal.diagnosis || snapshot.goal.onboardingCompletedAt),
      actionAnchor: '#dashboard',
    },
    {
      id: 'daily-task',
      title: '完成一个今日任务',
      description: '体验每日计划如何记录完成度和下一步建议。',
      completed: snapshot.studyTasks.counts.completed > 0 || input.completedTaskCount > 0,
      actionAnchor: '#plan',
    },
    {
      id: 'practice-set',
      title: '提交推荐题组',
      description: '体验系统按薄弱点生成题组并同步报告。',
      completed: input.completedPracticeSetCount > 0,
      actionAnchor: '#question',
    },
    {
      id: 'wrong-review',
      title: '标记一次错题复盘',
      description: '体验错题状态、相似题和复盘建议。',
      completed: snapshot.wrongQuestionSummary.reviewed > 0 || input.wrongReviewCount > 0,
      actionAnchor: '#wrong-book',
    },
    {
      id: 'feedback',
      title: '提交体验反馈',
      description: '提交站内反馈或打开问卷补充建议。',
      completed: input.feedbackCount > 0,
      actionAnchor: '#feedback',
    },
  ];
  const completedCount = items.filter((item) => item.completed).length;

  return {
    userId: snapshot.userId,
    title: '15 分钟体验任务',
    completedCount,
    totalCount: items.length,
    completionRate: Math.round((completedCount / items.length) * 100),
    items,
    nextAction: items.find((item) => !item.completed)?.title ?? '已完成全部体验任务，可以邀请同学填写问卷。',
  };
}
