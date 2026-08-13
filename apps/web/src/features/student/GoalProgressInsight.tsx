import type { UserProfile, WeaknessReport } from '@kaoyan408/shared';
import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';

export interface GoalProgressInsightProps {
  student?: UserProfile | null;
  report?: WeaknessReport | null;
  todayPlan?: TodayPlanType | null;
  taskTitle?: string | null;
  taskSubject?: string | null;
  taskChapter?: string | null;
  actionLabel?: string;
  compact?: boolean;
}

function formatScore(value: number | undefined) {
  return typeof value === 'number' ? `${value} 分` : '--';
}

function getWeekFocus(report?: WeaknessReport | null, todayPlan?: TodayPlanType | null, taskChapter?: string | null) {
  return taskChapter
    ?? todayPlan?.weekProgress.find((day) => day.focusTitle)?.focusTitle
    ?? report?.weakPoints[0]?.title
    ?? '完成今日任务，积累下一轮推荐数据';
}

function getTaskContribution(todayPlan?: TodayPlanType | null, taskTitle?: string | null, taskSubject?: string | null) {
  if (taskTitle) return `${taskTitle}${taskSubject ? ` · ${taskSubject}` : ''}`;
  const task = todayPlan?.priorityTasks.find((item) => item.status !== 'completed' && !item.completed)
    ?? todayPlan?.priorityTasks[0]
    ?? null;
  if (!task) return '完成今日计划后，系统会更新掌握度、错题复盘和报告建议';
  return `${task.title} · ${task.subject} · ${task.chapter}`;
}

export function GoalProgressInsight({
  student = null,
  report = null,
  todayPlan = null,
  taskTitle = null,
  taskSubject = null,
  taskChapter = null,
  actionLabel = '目标进度',
  compact = false,
}: GoalProgressInsightProps) {
  const currentScore = student?.currentScore;
  const targetScore = student?.targetScore;
  const scoreGap = typeof currentScore === 'number' && typeof targetScore === 'number'
    ? Math.max(0, targetScore - currentScore)
    : null;
  const weekFocus = getWeekFocus(report, todayPlan, taskChapter);
  const taskContribution = getTaskContribution(todayPlan, taskTitle, taskSubject);
  const completedTasks = todayPlan?.summary.completedTasks ?? 0;
  const totalTasks = todayPlan?.summary.totalTasks ?? 0;
  const estimatedGain = report?.estimatedGain;
  const targetName = student?.targetSchool ? `目标院校：${student.targetSchool}` : '目标来自入学诊断';

  return (
    <section className={`goal-progress-insight ${compact ? 'compact' : ''}`} aria-label={actionLabel}>
      <div className="goal-progress-main">
        <div>
          <p className="eyebrow">目标进度</p>
          <h4>这一步如何接近目标</h4>
          <span>{targetName}</span>
        </div>
        <strong>{scoreGap === null ? '--' : `${scoreGap} 分`}</strong>
      </div>
      <div className="goal-progress-grid">
        <article>
          <span>当前估分</span>
          <strong>{formatScore(currentScore)}</strong>
        </article>
        <article>
          <span>目标分</span>
          <strong>{formatScore(targetScore)}</strong>
        </article>
        <article>
          <span>还差</span>
          <strong>{scoreGap === null ? '--' : `${scoreGap} 分`}</strong>
        </article>
        <article>
          <span>剩余天数</span>
          <strong>{student?.remainingDays != null ? `${student.remainingDays} 天` : '--'}</strong>
        </article>
      </div>
      <div className="goal-progress-pill">
        <span>本周推进</span>
        <strong>{weekFocus}</strong>
      </div>
      <div className="goal-progress-pill">
        <span>今天任务贡献</span>
        <strong>{taskContribution}</strong>
      </div>
      <p>
        {estimatedGain != null
          ? `当前报告预估可提升 ${estimatedGain} 分；本卡只解释学习方向，不承诺单题立即涨分。`
          : `已完成 ${completedTasks}/${totalTasks} 项今日任务；继续完成后，系统会用真实练习记录校准目标差距。`}
      </p>
    </section>
  );
}
