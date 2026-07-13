import type { AssessmentHistory } from '../../api';

export function AssessmentHistoryPanel({ history }: { history: AssessmentHistory }) {
  return (
    <section id="assessment-history" className="panel assessment-history-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">测评历史</p><h3>最近测评与复盘建议</h3></div>
        <span>{history.summary.improvementText}</span>
      </div>
      <div className="assessment-history-summary">
        <article><strong>{history.summary.attemptCount}</strong><span>最近测评</span></article>
        <article><strong>{history.summary.bestScore}</strong><span>最高得分</span></article>
        <article><strong>{history.summary.latestAccuracyRate}%</strong><span>最近正确率</span></article>
        <article><strong>{history.items[0]?.unansweredCount ?? 0}</strong><span>最近未答</span></article>
      </div>
      {history.items.length ? (
        <div className="assessment-history-list">
          {history.items.slice(0, 4).map((item, index) => (
            <article key={item.id} className={index === 0 ? 'latest' : ''}>
              <div><strong>{item.title}</strong><span>{new Date(item.submittedAt).toLocaleDateString('zh-CN')} · 用时 {Math.round(item.elapsedSec / 60)} 分钟 · 未答 {item.unansweredCount} 题</span></div>
              <div className="assessment-score"><strong>{item.score}/{item.totalScore}</strong><span>正确率 {item.accuracyRate}%</span></div>
              <p>薄弱点：{item.weakPointTitle}</p><small>{item.reviewSuggestion}</small>
            </article>
          ))}
        </div>
      ) : <p className="empty-state">完成一套模拟卷后，这里会沉淀得分、耗时、薄弱点和下一步复盘建议。</p>}
    </section>
  );
}
