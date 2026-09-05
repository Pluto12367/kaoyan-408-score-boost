import { ArrowRight, RotateCcw } from 'lucide-react';
import { EmptyState, SurfaceCard } from '../../../components/ui';
import type { ReviewCenterPriorityItem } from '../reviewCenterViewModel';

interface PriorityReviewCardProps {
  item: ReviewCenterPriorityItem | null;
  onOpenReview: (questionId: string) => void;
  onRedo: (questionId: string, knowledgePointTitle?: string) => void;
}

export function PriorityReviewCard({ item, onOpenReview, onRedo }: PriorityReviewCardProps) {
  return (
    <SurfaceCard className="review-center-priority-card" data-testid="review-center-priority">
      <div className="review-center-section-heading">
        <div>
          <p className="eyebrow">Today&apos;s focus</p>
          <h3>今天最该恢复什么</h3>
        </div>
        <span className="review-center-source-badge">{sourceLabel(item?.source)}</span>
      </div>
      {item ? (
        <>
          <div className="review-center-priority-main">
            <div>
              <strong>{item.knowledgePointTitle}</strong>
              <span>{item.subject} · {item.statusLabel}</span>
            </div>
            <span className="review-center-mastery-label">掌握度 {item.masteryLabel}</span>
          </div>
          <p className="review-center-priority-reason">{item.reason}</p>
          <div className="review-center-priority-meta">
            <span>错误 {item.wrongCount ?? '暂无数据'} 次</span>
            <span>{item.nextReviewAt ? `复习时间 ${formatDate(item.nextReviewAt)}` : '暂无复习时间'}</span>
          </div>
          <p className="review-center-priority-action">下一步：{item.suggestedAction}</p>
          <div className="review-center-actions">
            <button type="button" className="primary-action" onClick={() => onOpenReview(item.questionId)}>
              开始复习 <ArrowRight size={14} aria-hidden="true" />
            </button>
            <button type="button" className="secondary-action" onClick={() => onRedo(item.questionId, item.knowledgePointTitle)}>
              <RotateCcw size={14} aria-hidden="true" /> 重做
            </button>
          </div>
        </>
      ) : (
        <EmptyState title="当前没有可优先恢复的项目" description="到期复习和待复盘错题会出现在这里。" />
      )}
    </SurfaceCard>
  );
}

function sourceLabel(source: ReviewCenterPriorityItem['source'] | undefined) {
  if (source === 'review-due') return '到期复习';
  if (source === 'priority-redo') return '优先重做';
  if (source === 'display-fallback') return '错题展示';
  return '等待数据';
}

function formatDate(value: string) {
  return value.slice(0, 10);
}
