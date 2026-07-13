import type { FeedbackList } from '../../api';

interface FeedbackPanelProps {
  feedback: FeedbackList;
  status: string;
  onSubmit: () => void;
}

export function FeedbackPanel({ feedback, status, onSubmit }: FeedbackPanelProps) {
  return (
    <section id="feedback" className="panel feedback-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">体验反馈</p><h3>邀请备考同学试用后收集改进建议</h3></div>
        <div className="panel-actions">
          <button type="button" className="secondary-action" onClick={onSubmit}>提交演示反馈</button>
          <a className="secondary-link" href={feedback.surveyUrl} target="_blank" rel="noreferrer">打开问卷</a>
        </div>
      </div>
      <p className="task-status">{status}</p>
      <div className="feedback-grid">
        <article><strong>{feedback.totalCount}</strong><span>反馈数量</span></article>
        <article><strong>{feedback.averageRating}</strong><span>平均评分</span></article>
        <article><strong>{feedback.items[0]?.scene ?? '待收集'}</strong><span>最近场景</span></article>
      </div>
      {feedback.items[0] ? <p className="feedback-note">{feedback.items[0].message}</p> : null}
    </section>
  );
}
