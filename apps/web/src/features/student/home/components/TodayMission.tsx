import { useEffect, useState } from 'react';
import { ArrowRight, Check, Circle } from 'lucide-react';
import { REASON_LABELS } from '@kaoyan408/shared';
import type { TodayPlanTask } from '../../../onboarding/todayLearningRoute';
import type { DashboardTaskViewModel, DashboardViewModel } from '../useDashboardViewModel';
import { fetchTaskEvidence } from '../../../../api/endpoints/dashboard';
import { reportRecommendationExposed } from '../../../recommendation/recommendationExposure';
import '../../../report/task-evidence.css';

function reasonLine(task: DashboardTaskViewModel): string | null {
  const codes = task.source.reasonCodes ?? [];
  if (codes.length > 0) {
    return codes.slice(0, 2).map((code) => REASON_LABELS[code as keyof typeof REASON_LABELS] ?? code).join(' · ');
  }
  return task.source.reason || null;
}

/** V11-M2 — per-completed-task capability verdict chips (honest, evidence-backed). */
function useTaskEvidenceChips(tasks: DashboardTaskViewModel[]) {
  const [chips, setChips] = useState<Record<string, string>>({});
  const completedIds = tasks.filter((task) => task.completed).map((task) => task.id).join(',');
  useEffect(() => {
    if (!completedIds) {
      setChips({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const response = await fetchTaskEvidence();
        if (cancelled) return;
        const next: Record<string, string> = {};
        for (const task of response.tasks ?? []) {
          if (task.verdict === 'improved') next[task.taskId] = '掌握度 ↑';
          else if (task.verdict === 'practiced_no_gain') next[task.taskId] = '已练·未见提升';
          else if (task.verdict === 'practiced') next[task.taskId] = '已练习';
        }
        setChips(next);
      } catch {
        // ambient chips: failure simply leaves rows unadorned
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [completedIds]);
  return chips;
}

export function TodayMission({ model, loading, error, onLaunch, onRefresh }: { model: DashboardViewModel; loading: boolean; error: string; onLaunch: (task: TodayPlanTask) => void; onRefresh: () => void }) {
  const chips = useTaskEvidenceChips(model.tasks.filter((task) => task.completed));
  // V12-M2a (EB-3): today's tasks ARE the recommendations the engine produced.
  // Report the set this surface actually rendered, de-duplicated per day.
  const exposedTaskIds = model.tasks.map((task) => task.id).join(',');
  useEffect(() => {
    if (model.tasks.length === 0 || loading || error) return;
    reportRecommendationExposed('today_mission', model.tasks.map((task) => ({ taskId: task.id })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exposedTaskIds, loading, error]);
  const completionRate = model.completionRate == null ? null : `${model.completionRate}%`;
  const completionCount = model.completedTaskCount == null || model.totalTaskCount == null
    ? '--/--'
    : `${model.completedTaskCount}/${model.totalTaskCount}`;
  return <section className="dashboard-section dashboard-mission-section" aria-label="今日学习任务">
    <div className="dashboard-section-heading"><div><span className="dashboard-kicker">Daily Mission</span><h3>今日学习计划</h3></div><button type="button" className="dashboard-text-button" onClick={onRefresh}>刷新</button></div>
    {loading ? <p className="dashboard-muted">正在同步今日任务...</p> : error ? <p className="dashboard-inline-error">{error}</p> : model.tasks.length ? <>
      <div className="dashboard-mission-progress"><span>今日完成 {completionCount}</span><strong>{completionRate ?? '--'}</strong><div><i style={{ width: `${model.completionRate ?? 0}%` }} /></div></div>
      <div className="dashboard-task-list">{model.tasks.map((task) => <button type="button" className={`dashboard-task-row ${task.completed ? 'is-complete' : ''}`} key={task.id} onClick={() => onLaunch(task.source)}>
        <span className="dashboard-task-check">{task.completed ? <Check size={14} /> : <Circle size={14} />}</span><span className="dashboard-task-copy"><strong>{task.title}</strong><small>{task.subject} · {task.detail}</small>{reasonLine(task) ? <small className="dashboard-task-reason">为什么：{reasonLine(task)}</small> : null}{chips[task.id] ? <small className="dashboard-task-evidence">{chips[task.id]}</small> : null}</span><span className="dashboard-task-count">{task.progressText}</span><ArrowRight size={15} />
      </button>)}</div>
    </> : <p className="dashboard-muted">完成入学引导后，这里会显示你的今日任务。</p>}
  </section>;
}
