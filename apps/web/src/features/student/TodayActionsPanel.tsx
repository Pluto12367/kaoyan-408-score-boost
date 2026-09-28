import { useEffect, useState } from 'react';
import { fetchTodayActions, type TodayAction, type TodayActionsResponse } from '../../api/endpoints/todayActions';

/**
 * V14 ③（D-T-1/2 批准 2026-09-27）— 「今天做什么」动作卡。
 *
 * 数据来自 `GET /coach/today-actions`（处方 + 到期复习 + 错题到期合并，带原因串）。
 * 只读投影 + 内存完成态（D-T-1）；启动复用既有链路（practice_set 显式题单 /
 * due review 跳转 / 错题本跳转）——零新会话语义。
 *
 * 失败显式展示（无静默兜底）；空态显示 nothingReason（诚实引导）。
 */

const KIND_LABELS: Record<TodayAction['kind'], string> = {
  prescription_step: '处方训练',
  review_due: '到期复习',
  wrong_due: '错题复盘',
};

export function TodayActionsPanel({
  onNavigate,
  onStartPracticeFromNode,
  refreshKey = 0,
}: {
  onNavigate: (section: 'question' | 'wrong') => void;
  onStartPracticeFromNode?: (title: string, questionIds: string[]) => void;
  refreshKey?: number;
}) {
  const [data, setData] = useState<TodayActionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchTodayActions(3)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '今日动作加载失败');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [refreshKey]);

  function handleStart(action: TodayAction) {
    setCompletedIds((current) => new Set(current).add(action.id));
    if (action.launch.type === 'practice_set' && onStartPracticeFromNode && action.launch.nodeId) {
      // 显式题单走 App 层 freePracticeContext（既有练习流，零新语义）。
      onStartPracticeFromNode(action.title, []);
      return;
    }
    if (action.launch.type === 'due_review') onNavigate('question');
    else if (action.launch.type === 'wrong_book') onNavigate('wrong');
  }

  if (loading) return <p className="muted">正在生成今日动作…</p>;
  if (error) return <p className="real-exam-error" role="alert">今日动作加载失败：{error}</p>;
  if (!data) return null;

  if (data.actions.length === 0) {
    return (
      <section className="today-actions" aria-label="今天做什么">
        <p className="muted">{data.nothingReason ?? '暂无待办动作。'}</p>
      </section>
    );
  }

  return (
    <section className="today-actions" aria-label="今天做什么">
      <h3>今天做什么</h3>
      <div className="today-actions-grid">
        {data.actions.map((action) => (
          <article
            key={action.id}
            className={`today-action-card${completedIds.has(action.id) ? ' done' : ''}`}
          >
            <span className="today-action-kind">{KIND_LABELS[action.kind]}</span>
            <strong>{action.title}</strong>
            <small className="today-action-reason">{action.reason}</small>
            <button
              type="button"
              className={completedIds.has(action.id) ? 'secondary-action' : 'primary-action'}
              onClick={() => handleStart(action)}
            >
              {completedIds.has(action.id) ? '已完成 ✓' : '开始 →'}
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
