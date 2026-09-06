import { useEffect, useState } from 'react';
import type { TodayPlan } from '../../api/endpoints/onboarding';
import {
  getTodayRouteRefreshDelay,
  getTodayTaskActionLabel,
  resolveTodayRoute,
  resolveTodayTaskDestination,
  type TodayPlanTask,
} from './todayLearningRoute';

export interface TodayLearningRouteProps {
  plan: TodayPlan | null;
  loading: boolean;
  error: string;
  launchingTaskId: string | null;
  launchError: string;
  onRetry: () => void;
  onLaunch: (task: TodayPlanTask) => void;
  onOpenPlan: () => void;
  onOpenWrongBook: () => void;
  onOpenReport: () => void;
  /** V8 #8: the home canonical action card already headlines this task —
   * show a pointer instead of a second competing start button. */
  hideFirstStepAction?: boolean;
}

export function TodayLearningRoute(props: TodayLearningRouteProps) {
  const [clockTick, setClockTick] = useState(0);
  const route = props.plan ? resolveTodayRoute(props.plan.priorityTasks) : null;
  const refreshDelay = getTodayRouteRefreshDelay(route?.nextAvailableAt ?? null);

  useEffect(() => {
    if (refreshDelay === null) return;
    const timer = window.setTimeout(() => setClockTick((value) => value + 1), refreshDelay);
    return () => window.clearTimeout(timer);
  }, [clockTick, refreshDelay]);

  if (props.loading) {
    return <section className="panel today-route" aria-label="今日学习路线">
      <div className="today-route-skeleton" role="status">正在加载今日学习路线…</div>
    </section>;
  }

  if (props.error) {
    return <section className="panel today-route" aria-label="今日学习路线">
      <p role="status">{props.error}</p>
      <button type="button" className="text-button" onClick={props.onRetry}>重新加载</button>
    </section>;
  }

  if (!props.plan || !route) {
    return <section className="panel today-route" aria-label="今日学习路线">
      <p>完成入学引导和诊断后生成今日路线。</p>
    </section>;
  }

  const totalMinutes = props.plan.priorityTasks.reduce((sum, task) => sum + task.minutes, 0);
  const completedMinutes = props.plan.priorityTasks.reduce(
    (sum, task) => sum + ((task.status === 'completed' || task.completed) ? task.minutes : task.progress?.minutesSpent ?? 0),
    0,
  );

  const firstTask = route.currentTask;
  const firstTaskProgress = firstTask?.progress?.completedQuestionCount ?? 0;
  const firstTaskBenefits = firstTask
    ? `任务名：${firstTask.title} · ${firstTask.questionCount} 题 · 预计收益：完成后更新掌握度、错题和下一步建议`
    : '当前没有可执行任务，请先查看计划或等待可开始时间。';

  return <section className="panel today-route" aria-labelledby="today-route-title">
    <header className="today-route-header">
      <div>
        <span className="eyebrow">今天先完成最重要的一件事</span>
        <h2 id="today-route-title">今日学习路线</h2>
      </div>
      <div className="today-route-summary">预计 {totalMinutes} 分钟 · 已完成 {completedMinutes} 分钟</div>
      <button type="button" className="text-button" onClick={props.onOpenPlan}>调整计划</button>
    </header>

    {firstTask ? (
      <div className="today-route-first-action" role="status" aria-label="今日第一步主行动">
        {props.hideFirstStepAction ? (
          <>
            <strong>今日第一步：{firstTask.title}</strong>
            <span>这一步已显示在页面上方「首页核心行动」，直接在那里开始即可。</span>
          </>
        ) : (
          <>
            <strong>今日第一步：{firstTask.title}</strong>
            <span>{firstTaskBenefits}</span>
            <div className="today-route-first-action-meta">
              <span>{firstTask.subject} · {firstTask.chapter}</span>
              <span>{firstTaskProgress}/{firstTask.questionCount} 题</span>
            </div>
            <button
              type="button"
              className="primary-action today-route-primary"
              disabled={props.launchingTaskId === firstTask.id}
              onClick={() => props.onLaunch(firstTask)}
            >{props.launchingTaskId === firstTask.id ? '正在启动…' : getTodayTaskActionLabel(firstTask, resolveTodayTaskDestination(firstTask.mode))}</button>
          </>
        )}
      </div>
    ) : null}

    <div className="today-route-live" role="status" aria-live="polite" aria-atomic="true">
      {props.launchError}
    </div>

    {route.allCompleted && <div className="today-route-terminal">
      <strong>今日任务已完成</strong>
      <p>今天的核心路线已经走完，可以查看报告或复习错题。</p>
      <div className="today-route-secondary-actions">
        <button type="button" className="text-button" onClick={props.onOpenReport}>查看报告</button>
        <button type="button" className="text-button" onClick={props.onOpenWrongBook}>复习错题</button>
      </div>
    </div>}

    {!route.allCompleted && !route.currentTask && route.nextAvailableAt && <div className="today-route-terminal">
      <strong>当前任务正在等待</strong>
      <p>下一项任务可开始时间：{new Intl.DateTimeFormat('zh-CN', {
        month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
      }).format(new Date(route.nextAvailableAt))}</p>
    </div>}

    {!route.allCompleted && !route.currentTask && !route.nextAvailableAt && <div className="today-route-terminal today-route-unavailable" role="status">
      <strong>任务时间暂不可用</strong>
      <p>延期任务缺少有效的可开始时间，请调整今日计划后再继续。</p>
    </div>}

    <ol className="today-route-list">
      {route.orderedTasks.map((task) => {
        const isCurrent = task.id === route.currentTask?.id;
        const destination = resolveTodayTaskDestination(task.mode);
        const completed = task.status === 'completed' || task.completed;
        const statusText = completed ? '已完成' : task.status === 'in_progress' ? '进行中' : task.status === 'postponed' ? '已延后' : '待开始';

        return <li key={task.id} className={isCurrent ? 'today-route-item is-current' : 'today-route-item'}>
          <div className="today-route-content">
            <div className="today-route-task-heading">
              <h3>{task.title}</h3>
              <span className={`today-route-status status-${task.status}`}>{statusText}</span>
            </div>
            {isCurrent && <>
              <p className="today-route-meta">{task.subject} · {task.chapter} · {task.minutes} 分钟</p>
              <p className="today-route-reason">{task.reason}</p>
              <p className="today-route-progress">
                {task.progress?.completedQuestionCount ?? 0}/{task.questionCount} 题
                {task.progress ? ` · 已学习 ${task.progress.minutesSpent} 分钟` : ''}
              </p>
              <div className="today-route-first-step" aria-label="今日第一步">
                <strong>今日第一步</strong>
                <span>先做 {task.questionCount} 题，完成后系统会更新掌握度、错题和下一步建议。</span>
              </div>
              <button
                type="button"
                className="primary-action today-route-primary"
                disabled={props.launchingTaskId === task.id}
                onClick={() => props.onLaunch(task)}
              >{props.launchingTaskId === task.id ? '正在启动…' : getTodayTaskActionLabel(task, destination)}</button>
            </>}
          </div>
        </li>;
      })}
    </ol>
  </section>;
}
