import { Network, Sparkles } from 'lucide-react';
import { EmptyState, SurfaceCard } from '../../../components/ui';
import type { ReviewCenterWeakKnowledge } from '../reviewCenterViewModel';

interface WeakKnowledgeListProps {
  items: ReviewCenterWeakKnowledge[];
  onOpenCatalog?: (nodeId: string) => void;
}

export function WeakKnowledgeList({ items, onOpenCatalog }: WeakKnowledgeListProps) {
  return (
    <SurfaceCard className="review-center-weak-card" data-testid="review-center-weak-knowledge">
      <div className="review-center-section-heading">
        <div>
          <p className="eyebrow">Weak knowledge</p>
          <h3>薄弱知识</h3>
        </div>
        <Sparkles size={17} aria-hidden="true" />
      </div>
      {items.length === 0 ? (
        <EmptyState title="暂无薄弱知识数据" description="掌握度数据同步后，这里会展示需要优先恢复的知识点。" />
      ) : (
        <div className="review-center-weak-list">
          {items.map((item) => (
            <article key={item.knowledgePointId}>
              <div className="review-center-weak-icon" aria-hidden="true"><Network size={15} /></div>
              <div>
                <strong>{item.title}</strong>
                <span>{item.chapter || '暂无章节'} · {item.status} · 错误 {item.wrongCount} 次</span>
                <small>掌握度 {item.masteryLabel}</small>
              </div>
              {onOpenCatalog ? (
                <button type="button" className="ghost-action" onClick={() => onOpenCatalog(item.knowledgePointId)}>查看知识点</button>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </SurfaceCard>
  );
}
