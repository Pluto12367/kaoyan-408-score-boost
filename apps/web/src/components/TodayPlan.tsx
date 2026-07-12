import { Clock, CheckCircle2, AlertCircle, BookOpen } from 'lucide-react';
import { completeStudyTask } from '../api/endpoints/practice';
import { postponeTask, type TodayPlan as TodayPlanType } from '../api/endpoints/onboarding';

interface Props {
  plan: TodayPlanType;
  onRefresh: () => void;
}

export function TodayPlan({ plan, onRefresh }: Props) {
  async function handleComplete(taskId: string) {
    try {
      await completeStudyTask({ taskId });
      onRefresh();
    } catch { /* error shown in parent */ }
  }

  async function handlePostpone(taskId: string) {
    try {
      await postponeTask(taskId);
      onRefresh();
    } catch { /* error shown in parent */ }
  }

  const { summary, priorityTasks } = plan;
  const progressPercent = summary.totalTasks > 0
    ? Math.round((summary.completedTasks / summary.totalTasks) * 100)
    : 0;

  return (
    <section id="plan" className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{plan.phase}</p>
          <h3>今日学习</h3>
        </div>
        <span>{summary.completedTasks}/{summary.totalTasks} 已完成</span>
      </div>

      {/* Progress bar */}
      <div className="today-progress">
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="progress-stats">
          <span><CheckCircle2 size={14} /> 正确率 {summary.todayAccuracyRate}%</span>
          <span><Clock size={14} /> 连续 {summary.streakDays} 天</span>
          {plan.reviewDue > 0 ? (
            <span className="review-due"><AlertCircle size={14} /> {plan.reviewDue} 道错题待复习</span>
          ) : null}
        </div>
      </div>

      {/* Priority tasks */}
      <div className="priority-tasks">
        <h4>优先任务</h4>
        {priorityTasks.length === 0 ? (
          <p className="empty-state">今日任务已完成！继续保持节奏。</p>
        ) : (
          priorityTasks.map((task) => (
            <article key={task.id} className={`task-card ${task.completed ? 'completed' : ''}`}>
              <div className="task-info">
                <div className="task-header">
                  <span className={`priority-badge priority-${task.priority === '高' ? 'high' : task.priority === '中' ? 'medium' : 'low'}`}>
                    {task.priority}
                  </span>
                  <strong>{task.title}</strong>
                </div>
                <p>{task.subject} · {task.chapter} · {task.mode}</p>
                <div className="task-meta">
                  <span><Clock size={12} /> {task.minutes} 分钟</span>
                  <span><BookOpen size={12} /> {task.questionCount} 题</span>
                </div>
                <p className="task-reason">{task.reason}</p>
              </div>
              <div className="task-actions">
                <button
                  type="button"
                  className="primary-action"
                  disabled={task.completed}
                  onClick={() => handleComplete(task.id)}
                >
                  {task.completed ? '已完成' : '完成'}
                </button>
                {!task.completed ? (
                  <button
                    type="button"
                    className="secondary-action"
                    onClick={() => handlePostpone(task.id)}
                  >
                    延后
                  </button>
                ) : null}
              </div>
            </article>
          ))
        )}
      </div>

      {/* Checkpoint reminder */}
      <div className="checkpoint-banner">
        <AlertCircle size={16} />
        <span>{plan.checkpoint}</span>
      </div>
    </section>
  );
}
