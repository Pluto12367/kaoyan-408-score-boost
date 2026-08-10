import { useState, useEffect } from 'react';
import { Clock, CheckCircle2, AlertCircle, BookOpen, RotateCcw } from 'lucide-react';
import { completeStudyTask } from '../api/endpoints/practice';
import {
  postponeTask,
  rebalanceTasks,
  rescheduleTask,
  startTask,
  type TodayPlan as TodayPlanType,
} from '../api/endpoints/onboarding';
import { fetchDueReviews, type DueReviewItem } from '../api/endpoints/review';
import { validateTaskCompletionDraft, type TaskCompletionDraft } from '../features/plan/taskCompletionDraft';
import { trackEvent } from '../api/events';

interface Props {
  plan: TodayPlanType;
  focusTaskId?: string | null;
  onRefresh: () => Promise<void>;
  onOpenReview?: (questionId: string) => void;
}

function getTaskStatusLabel(task: TodayPlanType['priorityTasks'][number]) {
  if (task.completed || task.status === 'completed') return '已完成';
  if (task.status === 'in_progress') return '进行中';
  if (task.status === 'postponed') return '已延后';
  return '待开始';
}

export function TodayPlan({ plan, focusTaskId, onRefresh, onOpenReview }: Props) {
  const [dueReviews, setDueReviews] = useState<DueReviewItem[]>([]);
  const [dueReviewError, setDueReviewError] = useState('');
  const [actionError, setActionError] = useState('');
  const [activeActionTaskId, setActiveActionTaskId] = useState<string | null>(null);
  const [completionDrafts, setCompletionDrafts] = useState<Record<string, TaskCompletionDraft>>({});
  const [rescheduleDates, setRescheduleDates] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!focusTaskId) return;
    const task = document.getElementById(`today-task-${focusTaskId}`);
    task?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusTaskId]);

  function loadDueReviews() {
    setDueReviewError('');
    fetchDueReviews()
      .then((r) => setDueReviews(r.items))
      .catch(() => setDueReviewError('到期复习加载失败，请重试。'));
  }

  useEffect(() => {
    loadDueReviews();
  }, [plan.generatedAt]);
  async function handleComplete(taskId: string) {
    const task = plan.priorityTasks.find((item) => item.id === taskId);
    if (!task) return;
    const result = validateTaskCompletionDraft(completionDrafts[taskId] ?? {});
    if (!result.valid) {
      setActionError(result.error);
      return;
    }
    setActionError('');
    setActiveActionTaskId(taskId);
    try {
      await completeStudyTask({ taskId, ...result.value });
      await onRefresh();
      void trackEvent('task.manual_complete', { taskId });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '任务完成状态保存失败，请重试。');
    } finally {
      setActiveActionTaskId(null);
    }
  }

  async function handleStart(taskId: string) {
    setActionError('');
    setActiveActionTaskId(taskId);
    try {
      await startTask(taskId);
      await onRefresh();
      void trackEvent('task.start', { taskId });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '任务开始失败，请重试。');
    } finally {
      setActiveActionTaskId(null);
    }
  }

  async function handlePostpone(taskId: string) {
    setActionError('');
    setActiveActionTaskId(taskId);
    try {
      await postponeTask(taskId);
      await onRefresh();
      void trackEvent('task.postpone', { taskId });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '任务延期失败，请重试。');
    } finally {
      setActiveActionTaskId(null);
    }
  }

  async function handleReschedule(taskId: string) {
    const scheduledDate = rescheduleDates[taskId];
    if (!scheduledDate) {
      setActionError('请先选择要重新安排的日期。');
      return;
    }
    setActionError('');
    setActiveActionTaskId(taskId);
    try {
      await rescheduleTask(taskId, scheduledDate);
      await onRefresh();
      void trackEvent('task.reschedule', { taskId, scheduledDate });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '任务重新安排失败，请重试。');
    } finally {
      setActiveActionTaskId(null);
    }
  }

  async function handleRebalance(mode: 'reduce' | 'priority_only') {
    setActionError('');
    setActiveActionTaskId('rebalance');
    try {
      await rebalanceTasks(mode);
      await onRefresh();
      void trackEvent('task.rebalance', { mode });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '计划调整失败，请重试。');
    } finally {
      setActiveActionTaskId(null);
    }
  }

  function updateCompletionDraft(taskId: string, field: keyof TaskCompletionDraft, value: number | undefined) {
    setCompletionDrafts((current) => ({
      ...current,
      [taskId]: {
        ...current[taskId],
        [field]: value,
      },
    }));
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

      {plan.weekProgress.length ? (
        <div className="week-plan-strip" aria-label="七天计划进度">
          {plan.weekProgress.map((day, index) => (
            <article key={day.date} className={index === 0 ? 'active' : ''}>
              <strong>第 {index + 1} 天</strong>
              <span>{day.date.slice(5)} · {day.completedTasks}/{day.taskCount} 项</span>
              {day.focusTitle ? <small>{day.focusTitle}</small> : null}
              <small>{day.totalMinutes} 分钟</small>
            </article>
          ))}
        </div>
      ) : null}

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
            <article key={task.id} id={`today-task-${task.id}`} className={`task-card ${task.completed ? 'completed' : ''} ${focusTaskId === task.id ? 'focused' : ''}`}>
              <div className="task-info">
                <div className="task-header">
                  <span className={`priority-badge priority-${task.priority === '高' ? 'high' : task.priority === '中' ? 'medium' : 'low'}`}>
                    {task.priority}
                  </span>
                  <span className="task-status-label">{getTaskStatusLabel(task)}</span>
                  <strong>{task.title}</strong>
                </div>
                <p>{task.subject} · {task.chapter} · {task.mode}</p>
                <div className="task-meta">
                  <span><Clock size={12} /> {task.minutes} 分钟</span>
                  <span><BookOpen size={12} /> {task.questionCount} 题</span>
                </div>
                {task.progress && (task.progress.completedQuestionCount > 0 || task.progress.reachedTarget) ? (
                  <div className="task-progress">
                    <div className="progress-bar">
                      <div
                        className="progress-fill"
                        style={{ width: `${Math.min(100, Math.round((task.progress.completedQuestionCount / task.questionCount) * 100))}%` }}
                      />
                    </div>
                    <span>已答 {task.progress.completedQuestionCount}/{task.questionCount} 题 · 正确 {task.progress.correctCount} 题</span>
                  </div>
                ) : null}
                <p className="task-reason">{task.reason}</p>
              </div>
              <div className="task-actions">
                {task.status === 'in_progress' ? (
                  <div className="task-completion-fields">
                    {task.progress && task.progress.completedQuestionCount > 0 ? (
                      <p className="muted">练习记录已自动累计，可补录差额后确认完成。</p>
                    ) : null}
                    <label><span>完成题数</span><input type="number" min={0} max={200} placeholder={`计划 ${task.questionCount} 题`} value={completionDrafts[task.id]?.completedQuestionCount ?? ''} onChange={(event) => updateCompletionDraft(task.id, 'completedQuestionCount', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
                    <label><span>正确题数</span><input type="number" min={0} max={completionDrafts[task.id]?.completedQuestionCount ?? 200} value={completionDrafts[task.id]?.correctCount ?? ''} onChange={(event) => updateCompletionDraft(task.id, 'correctCount', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
                    <label><span>实际分钟</span><input type="number" min={1} max={600} placeholder={`计划 ${task.minutes} 分钟`} value={completionDrafts[task.id]?.minutesSpent ?? ''} onChange={(event) => updateCompletionDraft(task.id, 'minutesSpent', event.target.value === '' ? undefined : Number(event.target.value))} /></label>
                    <label><span>掌握自评</span><select value={completionDrafts[task.id]?.selfRating ?? ''} onChange={(event) => updateCompletionDraft(task.id, 'selfRating', event.target.value === '' ? undefined : Number(event.target.value))}><option value="" disabled>请选择</option><option value={1}>1 · 不会</option><option value={2}>2 · 较弱</option><option value={3}>3 · 一般</option><option value={4}>4 · 熟练</option><option value={5}>5 · 掌握</option></select></label>
                    <button type="button" className="primary-action" disabled={activeActionTaskId === task.id} onClick={() => handleComplete(task.id)}>{activeActionTaskId === task.id ? '保存中' : '完成并调整计划'}</button>
                  </div>
                ) : task.completed || task.status === 'completed' ? (
                  <button type="button" className="primary-action" disabled>已完成</button>
                ) : (
                  <button type="button" className="primary-action" disabled={activeActionTaskId === task.id} onClick={() => handleStart(task.id)}>{activeActionTaskId === task.id ? '启动中' : '开始'}</button>
                )}
                {!task.completed ? (
                  <button
                    type="button"
                    className="secondary-action"
                    disabled={activeActionTaskId === task.id}
                    onClick={() => handlePostpone(task.id)}
                  >
                    延后
                  </button>
                ) : null}
              </div>
              {!task.completed && task.status !== 'completed' ? (
                <div className="task-adjust-row" aria-label="计划调整">
                  <input
                    type="date"
                    aria-label="重新安排日期"
                    value={rescheduleDates[task.id] ?? ''}
                    onChange={(event) => setRescheduleDates((current) => ({ ...current, [task.id]: event.target.value }))}
                  />
                  <button type="button" className="secondary-action" disabled={activeActionTaskId === task.id} onClick={() => handleReschedule(task.id)}>重新安排</button>
                  <button type="button" className="secondary-action" disabled={activeActionTaskId === task.id} onClick={() => handleRebalance('reduce')}>降低本周任务量</button>
                  <button type="button" className="secondary-action" disabled={activeActionTaskId === task.id} onClick={() => handleRebalance('priority_only')}>只保留高优先级</button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>

      {actionError ? <div className="module-error"><span>{actionError}</span></div> : null}

      {/* Due reviews */}
      {dueReviews.length > 0 ? (
        <div className="due-reviews">
          <h4><RotateCcw size={16} /> 到期复习 ({dueReviews.length})</h4>
          {dueReviews.slice(0, 3).map((item) => (
            <div key={item.questionId} className={`review-row stability-${item.stability}`}>
              <div>
                <strong>{item.knowledgePointTitle}</strong>
                <span>{item.subject} · 已复习 {item.reviewCount} 次</span>
                <p className="review-stem">{item.stem.slice(0, 40)}...</p>
              </div>
              <span className="stability-badge">
                {item.stability === 'mastered' ? '已掌握' : item.stability === 'review' ? '巩固' : '学习'}
              </span>
              {onOpenReview ? (
                <button type="button" className="secondary-action" onClick={() => onOpenReview(item.questionId)}>
                  开始复习
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      {dueReviewError ? (
        <div className="module-error">
          <span>{dueReviewError}</span>
          <button type="button" className="secondary-action" onClick={loadDueReviews}>重新加载</button>
        </div>
      ) : null}

      {/* Checkpoint reminder */}
      <div className="checkpoint-banner">
        <AlertCircle size={16} />
        <span>{plan.checkpoint}</span>
      </div>
    </section>
  );
}
