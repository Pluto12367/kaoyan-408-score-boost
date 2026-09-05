import { useState } from 'react';
import { ArrowRight, CalendarClock, CircleAlert, RotateCcw } from 'lucide-react';
import { EmptyState, SurfaceCard } from '../../../components/ui';
import type { ReviewCenterQueueItem, ReviewQueueBucket } from '../reviewCenterViewModel';

interface ReviewQueueProps {
  queue: Record<ReviewQueueBucket, ReviewCenterQueueItem[]>;
  loading: boolean;
  error: string;
  onRetry: () => void;
  onOpenReview: (questionId: string) => void;
}

const TABS: Array<{ id: ReviewQueueBucket; label: string; icon: typeof CalendarClock }> = [
  { id: 'today', label: '今天', icon: CalendarClock },
  { id: 'overdue', label: '已逾期', icon: CircleAlert },
  { id: 'upcoming', label: '即将到期', icon: RotateCcw },
];

export function ReviewQueue({ queue, loading, error, onRetry, onOpenReview }: ReviewQueueProps) {
  const [activeTab, setActiveTab] = useState<ReviewQueueBucket>('today');
  const items = queue[activeTab];
  const panelId = `review-queue-panel-${activeTab}`;

  return (
    <SurfaceCard className="review-center-queue-card" data-testid="review-center-queue">
      <div className="review-center-section-heading">
        <div>
          <p className="eyebrow">Review queue</p>
          <h3>复习队列</h3>
        </div>
        <span>{loading ? '同步中' : `${queue.today.length + queue.overdue.length} 项待处理`}</span>
      </div>
      <div className="review-center-tabs" role="tablist" aria-label="复习时间队列">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            aria-controls={`review-queue-panel-${id}`}
            className={activeTab === id ? 'is-active' : ''}
            onClick={() => setActiveTab(id)}
          >
            <Icon size={15} aria-hidden="true" />
            {label}
            <span>{queue[id].length}</span>
          </button>
        ))}
      </div>
      <div id={panelId} role="tabpanel" className="review-center-queue-list" aria-label={`${activeTab}复习项目`}>
        {error ? (
          <div className="module-error">
            <span>复习队列加载失败，请重试。</span>
            <button type="button" className="secondary-action" onClick={onRetry}>重新加载</button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState
            title={activeTab === 'upcoming' ? '暂无即将到期的数据' : activeTab === 'overdue' ? '没有已逾期复习' : '今天没有到期复习'}
            description={activeTab === 'upcoming' ? '当前已有接口只提供到期复习记录。' : '新的复习安排会根据已有学习记录出现在这里。'}
          />
        ) : (
          items.slice(0, 5).map((item) => (
            <article key={item.questionId} className={`review-center-queue-item queue-${item.bucket}`}>
              <div className="review-center-queue-item-icon" aria-hidden="true"><RotateCcw size={16} /></div>
              <div className="review-center-queue-item-copy">
                <strong>{item.knowledgePointTitle}</strong>
                <span>{item.subject} · {item.statusLabel} · 掌握度 {item.masteryLabel}</span>
                <small>{item.nextReviewAt ? `复习时间 ${item.nextReviewAt.slice(0, 10)}` : '暂无复习时间'}{item.reviewCount != null ? ` · 已复习 ${item.reviewCount} 次` : ''}</small>
              </div>
              <button type="button" className="secondary-action" onClick={() => onOpenReview(item.questionId)}>
                开始复习 <ArrowRight size={13} aria-hidden="true" />
              </button>
            </article>
          ))
        )}
      </div>
    </SurfaceCard>
  );
}
