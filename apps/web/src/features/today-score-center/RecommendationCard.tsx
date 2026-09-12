import { filterEvidencedReasonCodes, type PriorityReasonCode } from '@kaoyan408/shared';
import { actionCopy, reasonCopy, subjectCopy } from './reason-copy';
import type { ScoreCenterItem } from './types';

interface RecommendationCardProps {
  item: ScoreCenterItem;
  onExplain: (item: ScoreCenterItem) => void;
  onStart: (item: ScoreCenterItem) => void;
}

export function RecommendationCard({ item, onExplain, onStart }: RecommendationCardProps) {
  const subject = subjectCopy[item.subject] ?? item.subject;
  const action = item.action ? (actionCopy[item.action] ?? item.action) : '练习';
  /**
   * G1 Release Hardening (A1, EVIDENCED_REASON-only): the card chips are the
   * most glanceable "why" in the product, so they carry EVIDENCED reasons only.
   * Exam statistics stay in the drawer under an explicit "not your evidence"
   * heading — this surface is too small to label them honestly.
   */
  const codes = (item.reasonCodes ?? []) as PriorityReasonCode[];
  const reasons = filterEvidencedReasonCodes(codes).slice(0, 3).map((code) => reasonCopy[code] ?? code);
  const hasEvidenced = reasons.length > 0;

  return (
    <article className="panel score-center-card" data-testid="score-center-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{subject}</p>
          <h3>{item.title}</h3>
        </div>
        <span className="score-center-score" aria-label={`学习优先级 ${item.score ?? '未计算'}`}>
          {item.score ?? '—'}
        </span>
      </div>
      <p className="task-status">
        {action} · 建议 {item.estimatedMinutes} 分钟
      </p>
      {/* Missing score/breakdown renders as absent — a literal 0 would read as a real value. */}
      <p className="dashboard-muted score-center-score-note">学习优先级只表示顺序，不表示你必须先学它。</p>
      {hasEvidenced ? (
        <div className="reason-chips" data-testid="card-evidenced-reasons">
          {reasons.map((reason) => (
            <span key={reason} className="reason-chip">{reason}</span>
          ))}
        </div>
      ) : (
        <p className="dashboard-muted score-center-insufficient" data-testid="card-insufficient">
          还没有你自己的作答证据；点「为什么推荐」可以看到排序参考。
        </p>
      )}
      <div className="action-row">
        <button type="button" className="primary-action" onClick={() => onStart(item)}>
          开始练习
        </button>
        <button type="button" className="secondary-action" onClick={() => onExplain(item)}>
          为什么推荐
        </button>
      </div>
    </article>
  );
}
