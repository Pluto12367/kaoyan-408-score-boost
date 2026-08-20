import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';
import type { MasteryMap } from '../../api';

export interface FirstDayLearningInput {
  todayPlan: TodayPlanType | null;
  wrongQuestionSummary: { pendingCount: number } | null;
  masteryMap: Pick<MasteryMap, 'weakestPoints'> | { weakPoints?: Array<{ title: string }> } | null;
  hasCompletedDiagnostic: boolean;
}

export interface FirstDayLearningAction {
  label: string;
  targetSection: 'plan' | 'question' | 'wrong-book' | 'report' | 'dashboard';
}

export interface FirstDayLearningResult {
  headline: string;
  reason: string;
  primaryAction: FirstDayLearningAction;
  secondaryAction?: FirstDayLearningAction;
  status: 'diagnostic' | 'ready' | 'wrong-book' | 'report';
}

export function firstDayLearning({
  todayPlan,
  wrongQuestionSummary,
  masteryMap,
  hasCompletedDiagnostic,
}: FirstDayLearningInput): FirstDayLearningResult {
  const pendingWrongCount = wrongQuestionSummary?.pendingCount ?? 0;
  const weakPoint = (masteryMap && 'weakestPoints' in masteryMap)
    ? masteryMap.weakestPoints?.[0]?.title ?? null
    : masteryMap?.weakPoints?.[0]?.title ?? null;

  if (!hasCompletedDiagnostic) {
    return {
      headline: '完成入学诊断',
      reason: '登录后系统需要先完成入学诊断，生成个性化今日计划和薄弱点报告。',
      primaryAction: { label: '完成入学诊断', targetSection: 'plan' },
      secondaryAction: { label: '稍后完成', targetSection: 'dashboard' },
      status: 'diagnostic',
    };
  }

  const firstTask = todayPlan?.priorityTasks.find((task) => task.status !== 'completed' && !task.completed) ?? null;
  if (firstTask) {
    return {
      headline: '开始今日优先任务',
      reason: `今天最重要的一步是${firstTask.title} · ${firstTask.subject} · ${firstTask.chapter} · ${firstTask.minutes} 分钟`,
      primaryAction: { label: '开始今日任务', targetSection: 'question' },
      secondaryAction: { label: '直接练题', targetSection: 'question' },
      status: 'ready',
    };
  }

  if (pendingWrongCount > 0) {
    return {
      headline: '复盘错题',
      reason: `今日任务已处理，还有 ${pendingWrongCount} 道错题待复盘，先把漏洞补上。`,
      primaryAction: { label: '去错题本', targetSection: 'wrong-book' },
      secondaryAction: { label: '查看报告', targetSection: 'report' },
      status: 'wrong-book',
    };
  }

  if (todayPlan) {
    return {
      headline: '查看学习变化',
      reason: weakPoint
        ? `今日任务已完成，建议查看学习报告确认 ${weakPoint} 的变化。`
        : '今日任务已完成，可以查看学习报告确认掌握度变化和下一步建议。',
      primaryAction: { label: '查看学习报告', targetSection: 'report' },
      secondaryAction: { label: '继续薄弱点练习', targetSection: 'question' },
      status: 'report',
    };
  }

  return {
    headline: '今日计划准备好后会显示',
    reason: '完成入学诊断后，系统会生成今日学习路线并显示唯一主行动。',
    primaryAction: { label: '查看学习报告', targetSection: 'report' },
    secondaryAction: { label: '稍后完成', targetSection: 'dashboard' },
    status: 'ready',
  };
}
