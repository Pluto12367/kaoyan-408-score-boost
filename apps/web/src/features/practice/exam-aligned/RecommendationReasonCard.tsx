import { formatStars, gainEstimateText } from './examAlignmentView';
import type { PracticeSetExamAlignmentItem } from '../../../api/types';
import './exam-aligned.css';

/**
 * LE-V10 F1 — per-question "why this question" card. Every line renders from
 * the alignment projection; the estimate line only exists when the backend
 * emitted one (LOW confidence → hidden), and always carries the 估算 marker.
 */
export function RecommendationReasonCard({ item }: { item: PracticeSetExamAlignmentItem }) {
  if (!item.primaryNode) return null;
  const estimate = gainEstimateText(item);
  return (
    <div className="exam-alignment-card" role="note" aria-label="真题对标推荐理由">
      <p className="exam-alignment-stars">
        {item.stars > 0 ? `★${formatStars(item.stars)} ${frequencyLabelFor(item.stars)}` : '暂无真题数据'}
      </p>
      {item.recent5Frequency != null ? (
        <p>近 5 年出现：{item.recent5Frequency} 次 · 最近 {item.lastSeenYear ?? '—'} 年</p>
      ) : null}
      <p>你的当前掌握度：{item.mastery == null ? '尚未练习' : `${Math.round(item.mastery * 100)}%`}</p>
      {estimate ? <p className="exam-alignment-estimate">{estimate}</p> : null}
      {item.examHits.length > 0 ? (
        <p className="exam-alignment-hits">
          关联真题：{item.examHits.map((hit) => `${hit.year} ${hit.subject} 第${hit.questionNo}题`).join(' / ')}
        </p>
      ) : null}
    </div>
  );
}

function frequencyLabelFor(stars: number): string {
  if (stars >= 5) return '高频考点';
  if (stars >= 4) return '常考考点';
  return '偶考考点';
}
