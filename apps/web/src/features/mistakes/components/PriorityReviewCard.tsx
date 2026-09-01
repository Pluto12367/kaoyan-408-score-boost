import type { StudentAction } from '../../student/actions/studentAction';

type ReviewAction = Extract<StudentAction, { type: 'review_due' | 'redo_wrong_question' }>;

interface PriorityReviewCardProps {
  action: StudentAction;
  priority?: {
    priority: string;
    reason: string;
    suggestedAction: string;
  } | null;
  onReview: (action: ReviewAction) => void;
  onRedo: (action: ReviewAction) => void;
  onOpenDetail: (action: ReviewAction) => void;
}

export function PriorityReviewCard({ action, priority, onReview, onRedo, onOpenDetail }: PriorityReviewCardProps) {
  if (action.type !== 'review_due' && action.type !== 'redo_wrong_question') return null;

  const isFallback = action.source === 'wrong-summary-fallback';
  const displayReason = isFallback
    ? '当前没有可用的到期复习或优先重做依据，先处理这道错题。'
    : priority?.reason ?? action.reason ?? '根据当前复盘队列安排下一步。';
  const displayHint = isFallback
    ? '完成这道展示兜底错题后，再用变式题验证。'
    : priority?.suggestedAction ?? action.reason ?? '完成这一步后，再用变式题验证。';

  return (
    <div className="wrong-today-task-panel" role="status" aria-label="今日最该复盘">
      <div className="wrong-today-task-head">
        <strong>{action.type === 'review_due' ? '今日最该复盘' : '优先重做'}：{action.title}</strong>
        <span>{isFallback ? '展示兜底' : priority?.priority ?? '待处理'}</span>
      </div>
      <p>{displayReason}</p>
      <div className="wrong-today-task-actions">
        <button type="button" className="primary-action" onClick={() => onReview(action)}>先复盘这题</button>
        <button type="button" className="secondary-action" onClick={() => onRedo(action)}>重做这题</button>
        <button type="button" className="secondary-action" onClick={() => onOpenDetail(action)}>看详情与笔记</button>
      </div>
      <p className="wrong-today-task-hint">{displayHint}</p>
    </div>
  );
}
