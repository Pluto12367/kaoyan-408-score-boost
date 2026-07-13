import type { ReviewResourceRecommendation } from '../../api';
import { reviewResourceTypeLabel } from '../../constants';

export function ReviewResourcesPanel({ resources }: { resources: ReviewResourceRecommendation }) {
  return (
    <section id="review-resources" className="panel review-resources-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">复习资源推荐</p><h3>把薄弱点变成下一步复习动作</h3></div>
        <span>{resources.weakPointCount} 个薄弱点</span>
      </div>
      <p className="task-status">更新时间 {new Date(resources.generatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}，优先处理当前报告和错题本里最容易提分的知识点。</p>
      <div className="review-resource-grid">
        {resources.items.map((item) => (
          <article key={item.id} className={`review-resource-card resource-${item.resourceType}`}>
            <div><span>{reviewResourceTypeLabel[item.resourceType]}</span><small>{item.subject} / {item.difficulty} / {item.estimatedMinutes} 分钟</small></div>
            <strong>{item.title}</strong><p>{item.summary}</p><a href={item.actionAnchor}>{item.actionText}</a>
          </article>
        ))}
      </div>
    </section>
  );
}
