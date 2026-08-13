import type { StudyPlan } from '@kaoyan408/shared';

interface StudyPlanOverviewProps {
  plan: StudyPlan;
}

export function StudyPlanOverview({ plan }: StudyPlanOverviewProps) {
  return (
    <section id="plan-preview" className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">{plan.phase}</p><h3>今日任务预览</h3></div>
        <span>演示数据 · 登录后记录真实进度</span>
      </div>
      <div className="plan-action-summary">
        <article>
          <span>今日定位</span>
          <strong>优先处理高优先级薄弱点</strong>
        </article>
        <article>
          <span>本周目标</span>
          <strong>按计划完成任务并保持复盘节奏</strong>
        </article>
        <article>
          <span>完成后</span>
          <strong>回到报告查看掌握度变化</strong>
        </article>
      </div>
      <div className="task-list">
        {plan.dailyTasks.map((task) => (
          <article key={task.id} className="task-row">
            <div>
              <strong>{task.title}</strong>
              <p>{task.subject} / {task.chapter} / {task.mode}</p>
              <div className="task-reason">
                <span className={`priority priority-${task.priority}`}>{task.priority}优先级</span>
                <span>{task.reason}</span>
              </div>
              <small>{task.nextAction}</small>
            </div>
            <div className="task-actions"><span>{task.minutes} 分钟 · {task.questionCount} 题</span></div>
          </article>
        ))}
      </div>
    </section>
  );
}
