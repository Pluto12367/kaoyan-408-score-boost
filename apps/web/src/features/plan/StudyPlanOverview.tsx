import type { StudyPlan } from '@kaoyan408/shared';
import type { TaskCompletionAdjustment } from '../../api';

interface StudyPlanOverviewProps {
  plan: StudyPlan;
  taskAdjustment: TaskCompletionAdjustment | null;
  taskStatus: string;
  assessmentStatus: string;
  onCompleteTask: (taskId: string) => void;
}

export function StudyPlanOverview({
  plan,
  taskAdjustment,
  taskStatus,
  assessmentStatus,
  onCompleteTask,
}: StudyPlanOverviewProps) {
  return (
    <section id="plan" className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">{plan.phase}</p><h3>今日推荐任务</h3></div>
        <span>{plan.completedTaskCount ?? 0}/{plan.totalTaskCount ?? plan.dailyTasks.length} 已完成 · {plan.completionRate ?? 0}%</span>
      </div>
      <p className="task-status">{taskStatus} {assessmentStatus}</p>
      {taskAdjustment ? (
        <div className={`task-adjustment intensity-${taskAdjustment.intensity}`}>
          <div>
            <strong>{taskAdjustment.focusTitle}</strong>
            <span>完成正确率 {taskAdjustment.accuracyRate}% · 明日 {taskAdjustment.tomorrowQuestionTarget} 题 · 复盘 {taskAdjustment.reviewTarget} 题</span>
          </div>
          <ul>{taskAdjustment.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
          <p>{taskAdjustment.nextActions.join(' ')}</p>
        </div>
      ) : null}
      <div className="task-list">
        {plan.dailyTasks.map((task) => (
          <article key={task.id} className={`task-row ${task.completed ? 'completed' : ''}`}>
            <div>
              <strong>{task.title}</strong>
              <p>{task.subject} / {task.chapter} / {task.mode}</p>
              <div className="task-reason"><span className={`priority priority-${task.priority}`}>{task.priority}优先级</span><span>{task.reason}</span></div>
              <small>{task.nextAction}</small>
            </div>
            <div className="task-actions">
              <span>{task.minutes} 分钟 · {task.questionCount} 题</span>
              <button type="button" disabled={task.completed} onClick={() => onCompleteTask(task.id)}>{task.completed ? '已完成' : '完成'}</button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
