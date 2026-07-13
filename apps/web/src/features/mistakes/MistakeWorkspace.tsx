import type { WrongQuestion, WrongQuestionSummary } from '../../api';
import { WrongQuestionDetailView } from '../../components/WrongQuestionDetail';

interface MistakeWorkspaceProps {
  wrongQuestions: WrongQuestion[];
  summary: WrongQuestionSummary;
  status: string;
  detailQuestionId: string | null;
  onOpenDetail: (questionId: string) => void;
  onCloseDetail: () => void;
  onReview: (questionId: string) => void;
  onRedo: (questionId: string, knowledgePointTitle?: string) => void;
}

export function MistakeWorkspace({ wrongQuestions, summary, status, detailQuestionId, onOpenDetail, onCloseDetail, onReview, onRedo }: MistakeWorkspaceProps) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">错题本</p><h3>自动收集需要回炉的题目</h3></div>
        <span>{wrongQuestions.length} 道待复盘</span>
      </div>
      <p className="task-status">{status}</p>
      <div className="wrong-summary-grid">
        <article><strong>{summary.pendingCount}</strong><span>待复盘</span></article>
        <article><strong>{summary.reviewedCount}</strong><span>已复盘</span></article>
        <article><strong>{summary.resolvedCount}</strong><span>重做解决</span></article>
        <article><strong>{summary.totalWrongCount}</strong><span>当前错题</span></article>
      </div>
      <div className="wrong-loop-panel">
        <article><strong>高频错因</strong><div className="mistake-stat-list">{summary.mistakeReasonStats.map((item) => <span key={item.reason}>{item.reason} · {item.count}</span>)}</div></article>
        <article>
          <strong>优先重做</strong>
          {summary.priorityRedoItems[0]
            ? <p>{summary.priorityRedoItems[0].knowledgePointTitle} · 错 {summary.priorityRedoItems[0].wrongCount} 次 · {summary.priorityRedoItems[0].nextAction}</p>
            : <p>当前没有待重做错题，可以进入限时训练。</p>}
        </article>
        <article><strong>闭环建议</strong><ul>{summary.nextReviewActions.map((action) => <li key={action}>{action}</li>)}</ul></article>
      </div>
      <div className="wrong-list">
        {wrongQuestions.map((item) => (
          <article key={item.questionId} className="wrong-row">
            <div>
              <strong>{item.knowledgePointTitle}</strong>
              <p>{item.subject} / {item.chapter} / 错 {item.wrongCount} 次 / {item.latestMistakeReason ?? '待诊断'}</p>
              <small>{item.reviewStatus === 'reviewed' ? '已复盘' : '待复盘'}{item.reviewedAt ? ` · ${item.reviewedAt.slice(0, 10)}` : ''}</small>
              <span>{item.stem}</span>
            </div>
            <button type="button" onClick={() => onOpenDetail(item.questionId)}>详情与笔记</button>
            <button type="button" disabled={item.reviewStatus === 'reviewed'} onClick={() => onReview(item.questionId)}>{item.reviewStatus === 'reviewed' ? '已复盘' : '标记复盘'}</button>
            <button type="button" onClick={() => onRedo(item.questionId, item.knowledgePointTitle)}>重做</button>
          </article>
        ))}
      </div>
      {detailQuestionId ? <WrongQuestionDetailView questionId={detailQuestionId} onClose={onCloseDetail} onRedo={(questionId) => onRedo(questionId)} /> : null}
    </section>
  );
}
