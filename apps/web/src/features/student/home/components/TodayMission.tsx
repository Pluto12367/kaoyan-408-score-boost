import { useEffect, useMemo, useState } from 'react';
import { ArrowRight, Check, Circle } from 'lucide-react';
import {
  COMPLETION_BOUNDARY_NOTE,
  buildReasonDetailFromCode,
  resolveNextAction,
  resolveShownReasons,
  type PriorityReasonCode,
} from '@kaoyan408/shared';
import type { TodayPlanTask } from '../../../onboarding/todayLearningRoute';
import type { DashboardTaskViewModel, DashboardViewModel } from '../useDashboardViewModel';
import { fetchTaskEvidence } from '../../../../api/endpoints/dashboard';
import { reportRecommendationExposed } from '../../../recommendation/recommendationExposure';
import '../../../report/task-evidence.css';

/**
 * G1.1 / G1.2 / G1.4 / G1.5 — the today task list.
 *
 * The 「为什么：」 line used to print every code the engine returned, including
 * codes that had only been added to pad the list to two.
 *
 * G1 Release Hardening (owner decision A1, EVIDENCED_REASON-only): the line now
 * shows EVIDENCED reasons only. Inferred codes are real statistics about the exam
 * but not observations about this student, so they are labelled as sorting
 * reference and never borrowed as the reason. With no evidenced reason the row
 * says so instead of implying one.
 *
 * Completed rows also carry the capability verdict and the boundary note, so
 * "完成 ≠ 学会" is visible where the completion actually happens.
 */
function whyView(task: DashboardTaskViewModel) {
  const codes = (task.source.reasonCodes ?? []) as PriorityReasonCode[];
  return resolveShownReasons({
    reasons: codes,
    reasonDetails: codes.map(buildReasonDetailFromCode),
  });
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
          else if (task.verdict === 'insufficient_data') next[task.taskId] = '完成·无作答证据';
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

export function TodayMission({ model, loading, error, onLaunch, onRefresh, onNavigate }: {
  model: DashboardViewModel;
  loading: boolean;
  error: string;
  onLaunch: (task: TodayPlanTask) => void;
  onRefresh: () => void;
  onNavigate?: (section: 'wrong-book' | 'test' | 'question' | 'dashboard') => void;
}) {
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
  const hasCompleted = model.tasks.some((task) => task.completed);

  /**
   * G1.5 — the NEXT under the list is resolved by the shared resolver, so it can
   * never disagree with the primary action card. `null` means the resolver had
   * nothing reliable to suggest; it still returns an explained no-next.
   */
  const nextResolution = useMemo(() => resolveNextAction({
    hasPendingTask: model.tasks.some((task) => !task.completed),
    reviewDue: model.reviewDueCount ?? 0,
    probeDue: false,
    assessments: 0,
    probeEvents: 0,
    verdict: hasCompleted ? null : undefined,
  }), [model.tasks, model.reviewDueCount, hasCompleted]);

  return <section className="dashboard-section dashboard-mission-section" aria-label="今日学习任务">
    <div className="dashboard-section-heading"><div><span className="dashboard-kicker">Daily Mission</span><h3>今日学习计划</h3></div><button type="button" className="dashboard-text-button" onClick={onRefresh}>刷新</button></div>
    {loading ? <p className="dashboard-muted">正在同步今日任务...</p> : error ? <p className="dashboard-inline-error">{error}</p> : model.tasks.length ? <>
      <div className="dashboard-mission-progress"><span>今日完成 {completionCount}</span><strong>{completionRate ?? '--'}</strong><div><i style={{ width: `${model.completionRate ?? 0}%` }} /></div></div>
      <div className="dashboard-task-list">{model.tasks.map((task) => {
        const why = whyView(task);
        return <button type="button" className={`dashboard-task-row ${task.completed ? 'is-complete' : ''}`} key={task.id} onClick={() => onLaunch(task.source)}>
          <span className="dashboard-task-check">{task.completed ? <Check size={14} /> : <Circle size={14} />}</span>
          <span className="dashboard-task-copy">
            <strong>{task.title}</strong>
            <small>{task.subject} · {task.detail}</small>
            {why.reasons.length > 0 ? (
              <small className="dashboard-task-reason" data-testid={`task-why-${task.id}`}>
                为什么（你的学习证据）：{why.reasons.map((entry) => entry.statement || entry.code).join('；')}
              </small>
            ) : null}
            {why.reasons.length === 0 && why.insufficientNote ? (
              <small className="dashboard-task-reason dashboard-task-insufficient">{why.insufficientNote}</small>
            ) : null}
            {why.inferred.length > 0 ? (
              <small className="dashboard-task-sorting" data-testid={`task-sorting-${task.id}`}>
                排序参考（考试统计，不是你的证据）：{why.inferred.map((entry) => entry.statement || entry.code).join('；')}
              </small>
            ) : null}
            {why.contextFacts.length > 0 ? (
              <small className="dashboard-task-context">当前情况：{why.contextFacts.map((entry) => entry.statement || entry.code).join('；')}</small>
            ) : null}
            {chips[task.id] ? <small className="dashboard-task-evidence">{chips[task.id]}</small> : null}
          </span>
          <span className="dashboard-task-count">{task.progressText}</span><ArrowRight size={15} />
        </button>;
      })}</div>
      <p className="dashboard-muted" data-testid="today-mission-boundary">{COMPLETION_BOUNDARY_NOTE}</p>
    </> : <p className="dashboard-muted">完成入学引导后，这里会显示你的今日任务。</p>}
    <div className="dashboard-task-next" data-testid="today-mission-next">
      {onNavigate ? (
        <button type="button" className="dashboard-text-button" onClick={() => onNavigate(nextResolution.action.section as 'wrong-book')}>
          下一步：{nextResolution.action.label}
        </button>
      ) : null}
      <small className="dashboard-muted">{nextResolution.reason}</small>
    </div>
  </section>;
}
