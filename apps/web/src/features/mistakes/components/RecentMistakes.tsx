import { ArrowRight, BookOpen, RotateCcw } from 'lucide-react';
import { EmptyState, SurfaceCard } from '../../../components/ui';
import type { WrongQuestion } from '../../../api';

interface RecentMistakesProps {
  items: WrongQuestion[];
  onOpenDetail: (questionId: string) => void;
  onRedo: (questionId: string, knowledgePointTitle?: string) => void;
}

export function RecentMistakes({ items, onOpenDetail, onRedo }: RecentMistakesProps) {
  return (
    <SurfaceCard className="review-center-recent-card" data-testid="review-center-recent-mistakes">
      <div className="review-center-section-heading">
        <div>
          <p className="eyebrow">Recent mistakes</p>
          <h3>最近错题</h3>
        </div>
        <BookOpen size={17} aria-hidden="true" />
      </div>
      {items.length === 0 ? (
        <EmptyState title="还没有错题记录" description="答错的题目会自动进入复习中心。" />
      ) : (
        <div className="review-center-recent-list">
          {items.map((item) => (
            <article key={item.questionId}>
              <div>
                <strong>{item.knowledgePointTitle}</strong>
                <span>{item.subject} · {item.latestMistakeReason ?? '待诊断'} · 错 {item.wrongCount} 次</span>
              </div>
              <div className="review-center-recent-actions">
                <button type="button" className="ghost-action" onClick={() => onOpenDetail(item.questionId)}>详情 <ArrowRight size={13} aria-hidden="true" /></button>
                <button type="button" className="secondary-action" onClick={() => onRedo(item.questionId, item.knowledgePointTitle)}><RotateCcw size={13} aria-hidden="true" /> 重做</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}
