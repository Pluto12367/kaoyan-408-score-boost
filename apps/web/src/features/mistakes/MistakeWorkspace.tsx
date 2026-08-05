import type { WrongQuestion, WrongQuestionSummary } from '../../api';
import { WrongQuestionDetailView } from '../../components/WrongQuestionDetail';
import { ModuleInlineUnavailable, ModuleResourceMeta } from '../../components/ModuleResourceState';
import type { ModuleResource } from '../../hooks/moduleResource';

interface MistakeWorkspaceProps {
  wrongQuestions: WrongQuestion[];
  summary: ModuleResource<WrongQuestionSummary>;
  status: string;
  detailQuestionId: string | null;
  onOpenDetail: (questionId: string) => void;
  onCloseDetail: () => void;
  onReview: (questionId: string) => void;
  onRedo: (questionId: string, knowledgePointTitle?: string) => void;
  onRetrySummary: () => void;
}

export function MistakeWorkspace({ wrongQuestions, summary, status, detailQuestionId, onOpenDetail, onCloseDetail, onReview, onRedo, onRetrySummary }: MistakeWorkspaceProps) {
  const summaryData = summary.data;
  return (
    <section id="wrong-book" className="panel">
      <div className="panel-heading">
        <div><p className="eyebrow">错题本</p><h3>自动收集需要回炉的题目</h3></div>
        <span>{wrongQuestions.length} 道待复盘</span>
      </div>
      <p className="task-status">{status}</p>
      {summaryData ? <ModuleResourceMeta resource={summary} onRetry={onRetrySummary} /> : null}
      {summaryData ? <>
      <div className="wrong-summary-grid">
        <article><strong>{summaryData.pendingCount}</strong><span>待复盘</span></article>
        <article><strong>{summaryData.reviewedCount}</strong><span>已复盘</span></article>
        <article><strong>{summaryData.resolvedCount}</strong><span>重做解决</span></article>
        <article><strong>{summaryData.totalWrongCount}</strong><span>当前错题</span></article>
      </div>
      <div className="wrong-loop-panel">
        <article><strong>高频错因</strong><div className="mistake-stat-list">{summaryData.mistakeReasonStats.map((item) => <span key={item.reason}>{item.reason} · {item.count}</span>)}</div></article>
        <article>
          <strong>优先重做</strong>
          {summaryData.priorityRedoItems[0]
            ? <p>{summaryData.priorityRedoItems[0].knowledgePointTitle} · 错 {summaryData.priorityRedoItems[0].wrongCount} 次 · {summaryData.priorityRedoItems[0].nextAction}</p>
            : <p>当前没有待重做错题，可以进入限时训练。</p>}
        </article>
        <article><strong>闭环建议</strong><ul>{summaryData.nextReviewActions.map((action) => <li key={action}>{action}</li>)}</ul></article>
      </div>
      </> : <ModuleInlineUnavailable title="错题摘要" resource={summary} onRetry={onRetrySummary} />}
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
