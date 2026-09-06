import { ArrowRight, Check, Circle } from 'lucide-react';
import type { TodayPlanTask } from '../../../onboarding/todayLearningRoute';
import type { DashboardViewModel } from '../useDashboardViewModel';

export function TodayMission({ model, loading, error, onLaunch, onRefresh }: { model: DashboardViewModel; loading: boolean; error: string; onLaunch: (task: TodayPlanTask) => void; onRefresh: () => void }) {
  const completionRate = model.completionRate == null ? null : `${model.completionRate}%`;
  const completionCount = model.completedTaskCount == null || model.totalTaskCount == null
    ? '--/--'
    : `${model.completedTaskCount}/${model.totalTaskCount}`;
  return <section className="dashboard-section dashboard-mission-section" aria-label="今日学习任务">
    <div className="dashboard-section-heading"><div><span className="dashboard-kicker">Daily Mission</span><h3>今日学习计划</h3></div><button type="button" className="dashboard-text-button" onClick={onRefresh}>刷新</button></div>
    {loading ? <p className="dashboard-muted">正在同步今日任务...</p> : error ? <p className="dashboard-inline-error">{error}</p> : model.tasks.length ? <>
      <div className="dashboard-mission-progress"><span>今日完成 {completionCount}</span><strong>{completionRate ?? '--'}</strong><div><i style={{ width: `${model.completionRate ?? 0}%` }} /></div></div>
      <div className="dashboard-task-list">{model.tasks.map((task) => <button type="button" className={`dashboard-task-row ${task.completed ? 'is-complete' : ''}`} key={task.id} onClick={() => onLaunch(task.source)}>
        <span className="dashboard-task-check">{task.completed ? <Check size={14} /> : <Circle size={14} />}</span><span className="dashboard-task-copy"><strong>{task.title}</strong><small>{task.subject} · {task.detail}</small>{task.source.reason ? <small className="dashboard-task-reason">为什么：{task.source.reason}</small> : null}</span><span className="dashboard-task-count">{task.progressText}</span><ArrowRight size={15} />
      </button>)}</div>
    </> : <p className="dashboard-muted">完成入学引导后，这里会显示你的今日任务。</p>}
  </section>;
}
