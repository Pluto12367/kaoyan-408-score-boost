import type { StudentAction } from '../../student/actions/studentAction';

type ReviewAction = Extract<StudentAction, { type: 'review_due' | 'redo_wrong_question' }>;

interface ReviewQueueProps {
  actions: StudentAction[];
  onOpenReview: (action: ReviewAction) => void;
  onRedo: (action: ReviewAction) => void;
  onOpenDetail: (action: ReviewAction) => void;
}

export function ReviewQueue({ actions, onOpenReview, onRedo, onOpenDetail }: ReviewQueueProps) {
  if (actions.length === 0) return null;

  return (
    <section className="wrong-review-queue wrong-review-loop-card" aria-label="复盘行动队列">
      <div className="wrong-review-loop-head">
        <strong>复盘行动队列</strong>
        <span>按到期复习、优先重做和展示兜底顺序排列。</span>
      </div>
      <div className="wrong-list">
        {actions.map((action) => {
          if (action.type !== 'review_due' && action.type !== 'redo_wrong_question') return null;

          const isFallback = action.source === 'wrong-summary-fallback';
          const displayReason = isFallback
            ? '当前没有可用的到期复习或优先重做依据，先处理这道错题。'
            : action.reason;
          return (
            <article key={action.id} className="wrong-row">
              <div>
                <small>{isFallback ? '展示兜底' : `来源：${action.source}`}</small>
                <strong>{action.title}</strong>
                {displayReason ? <p>{displayReason}</p> : null}
              </div>
              {action.type === 'review_due' ? (
                <button type="button" className="primary-action" onClick={() => onOpenReview(action)}>开始复习</button>
              ) : (
                <button type="button" className="primary-action" onClick={() => onRedo(action)}>重做</button>
              )}
              <button type="button" className="secondary-action" onClick={() => onRedo(action)}>重做</button>
              <button type="button" className="secondary-action" onClick={() => onOpenDetail(action)}>详情与笔记</button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
