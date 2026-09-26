import { useCallback, useEffect, useMemo, useState } from 'react';
import { collectIntraSessionRetries, estimateCatchUpDays } from '@kaoyan408/shared';
import {
  fetchMemoryCardSession,
  fetchMemoryCardPracticeCandidate,
  reviewMemoryCard,
  type CardSelfRatingValue,
  type MemoryCardPracticeCandidate,
  type MemoryCardQueueItem,
  type MemoryCardSession,
} from '../../api/endpoints/memoryCard';
import { isStaticDemoMode } from '../../api/env';
import {
  cardTypeLabel,
  hasRenderableQueue,
  phaseLabel,
  progressLabel,
  RATING_OPTIONS,
  retentionLabel,
} from './memoryCardView';
import './memory-card.css';
import 'katex/dist/katex.min.css';
import { renderMathText } from './mathText';

/**
 * V14-② 记忆卡复习面 — 自取数（self-scope），翻卡 + 三档自评。
 * 卡片内容不可伪造：演示模式显式拒绝，失败显式展示，绝不回退演示数据。
 * 面上的「保持率」是卡片域排程事实，不是掌握度，更不是分数。
 *
 * 节点过滤（roadmap §2）：从知识抽屉进入时带 nodeId，只看该节点的卡片；
 * 会话内重现（roadmap §2）：本会话「没记住」的卡在主队列结束后重现一轮，
 * 每卡最多一次；重现不改变任何已持久化的排程。
 */

export interface MemoryCardWorkspaceProps {
  nodeId?: string | null;
  onClearNodeFilter?: () => void;
  /** S2 卡片→做题回流：点击入口后走既有题库练习链（App 复用抽屉同款处理器）。 */
  onPracticeCandidate?: (questionId: string, title: string) => void;
}

type ReviewFeedback = {
  cardId: string;
  rating: CardSelfRatingValue;
  nextLabel: string;
};

type Phase = { kind: 'main' } | { kind: 'retry' } | { kind: 'done' };

export function MemoryCardWorkspace({ nodeId, onClearNodeFilter, onPracticeCandidate }: MemoryCardWorkspaceProps = {}) {
  const [session, setSession] = useState<MemoryCardSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [retryIndex, setRetryIndex] = useState(0);
  const [evaluations, setEvaluations] = useState<Array<{ cardId: string; rating: CardSelfRatingValue }>>([]);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [lastFeedback, setLastFeedback] = useState<ReviewFeedback | null>(null);
  // S2: per-node practice candidate cache — undefined=not fetched, null=no candidate.
  const [candidates, setCandidates] = useState<Record<string, MemoryCardPracticeCandidate['candidate'] | null | undefined>>({});

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIndex(0);
    setRetryIndex(0);
    setEvaluations([]);
    setRevealed(false);
    fetchMemoryCardSession(undefined, nodeId ?? undefined)
      .then((data) => {
        if (!cancelled) {
          setSession(data);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [nodeId]);

  useEffect(() => load(), [load]);

  const queue: MemoryCardQueueItem[] = session?.queue ?? [];
  const retryIds = useMemo(() => collectIntraSessionRetries(evaluations), [evaluations]);
  const retryQueue = useMemo(() => queue.filter((item) => retryIds.includes(item.cardId)), [queue, retryIds]);

  const mainDone = index >= queue.length;
  const retryDone = retryIndex >= retryQueue.length;
  const phase: Phase = !mainDone ? { kind: 'main' } : retryQueue.length > 0 && !retryDone ? { kind: 'retry' } : { kind: 'done' };
  const current = phase.kind === 'main' ? queue[index] : phase.kind === 'retry' ? retryQueue[retryIndex] : null;

  // S2 lazy candidate fetch: only after flip, cached per node. This entry is an
  // ENHANCEMENT — its own failure hides just the link (comment: the main review
  // chain keeps explicit error reporting above).
  useEffect(() => {
    const targetNodeId = revealed ? current?.knowledgeNodeId : undefined;
    if (!targetNodeId || candidates[targetNodeId] !== undefined) return;
    let cancelled = false;
    fetchMemoryCardPracticeCandidate(targetNodeId)
      .then((result) => {
        if (!cancelled) setCandidates((prev) => ({ ...prev, [targetNodeId]: result.candidate }));
      })
      .catch(() => {
        if (!cancelled) setCandidates((prev) => ({ ...prev, [targetNodeId]: null }));
      });
    return () => {
      cancelled = true;
    };
  }, [revealed, current?.knowledgeNodeId, candidates]);

  const practiceCandidate = current ? candidates[current.knowledgeNodeId] : undefined;

  const submitRating = (rating: CardSelfRatingValue) => {
    if (!current || submitting) return;
    const activeCard = current;
    setSubmitting(true);
    setReviewError(null);
    reviewMemoryCard(activeCard.cardId, {
      rating,
      idempotencyKey: `mc-${activeCard.cardId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
      .then((result) => {
        setSubmitting(false);
        setEvaluations((list) => [...list, { cardId: activeCard.cardId, rating }]);
        const next = new Date(result.state.nextReviewAt ?? Date.now());
        setLastFeedback({
          cardId: activeCard.cardId,
          rating,
          nextLabel: Number.isNaN(next.getTime())
            ? '已记录'
            : `下次复习：${next.toLocaleDateString()}${result.state.stabilityDays != null ? ` · 稳定性 ${result.state.stabilityDays} 天` : ''}`,
        });
        setRevealed(false);
        if (phase.kind === 'main') setIndex((value) => value + 1);
        else setRetryIndex((value) => value + 1);
      })
      .catch((cause: unknown) => {
        setSubmitting(false);
        setReviewError(cause instanceof Error ? cause.message : String(cause));
      });
  };

  if (isStaticDemoMode()) {
    return (
      <div className="panel memory-card-panel" data-testid="memory-card-workspace">
        <div className="panel-heading"><div><p className="eyebrow">记忆卡</p><h3>需要连接后端使用</h3></div></div>
        <p className="empty-state">记忆卡内容来自审定的卡片库，演示模式无法伪造卡片内容。</p>
      </div>
    );
  }

  const nodeName = queue[0]?.nodeName ?? null;
  const reviewedCount = evaluations.length;
  const retriedCount = phase.kind === 'retry' || phase.kind === 'done' ? retryQueue.length : 0;
  const catchUpDays = session ? estimateCatchUpDays(session.summary.dueCount, session.summary.sessionCap) : null;

  return (
    <div className="memory-card-workspace" data-testid="memory-card-workspace">
      <header className="memory-card-header">
        <h2>记忆卡</h2>
        <p className="muted">
          按考点的结论与公式卡，翻卡自评（记住 / 模糊 / 没记住）。距考越近，复习排得越密；卡片复习只安排卡片重现，不改变掌握度。
        </p>
        {nodeId && nodeName ? (
          <p className="memory-card-node-filter" data-testid="memory-card-node-filter">
            只看节点：{nodeName}
            {onClearNodeFilter ? (
              <button type="button" className="memory-card-node-filter-clear" onClick={onClearNodeFilter}>
                查看全部卡片
              </button>
            ) : null}
          </p>
        ) : null}
        {session ? (
          <p className="memory-card-exam-context" data-testid="memory-card-exam-context">{session.examContext.label}</p>
        ) : null}
      </header>

      {loading ? <p className="muted">加载中…</p> : null}
      {error ? (
        <div className="panel memory-card-panel">
          <p className="memory-card-error" role="alert">加载失败：{error}</p>
          <button type="button" className="memory-card-retry" onClick={load}>重试</button>
        </div>
      ) : null}

      {!loading && !error && session && (!hasRenderableQueue(queue) || phase.kind === 'done') ? (
        <div className="panel memory-card-panel">
          <p className="empty-state" data-testid="memory-card-empty">
            {phase.kind === 'done' && reviewedCount > 0
              ? `本轮完成：已自评 ${reviewedCount} 张${retriedCount > 0 ? `（含重现 ${retriedCount} 张）` : ''}，当前没有到期卡片。`
              : nodeId
                ? '该节点暂无卡片：结论卡与公式卡由教研内容轨逐步补充。'
                : '卡片库暂无待复习内容：到期卡片会在这里出现；新卡由教研内容轨逐步补充。'}
          </p>
          {lastFeedback ? <p className="muted">{lastFeedback.nextLabel}</p> : null}
        </div>
      ) : null}

      {!loading && !error && current ? (
        <section className="memory-card-stage" aria-label="记忆卡复习">
          <div className="memory-card-meta">
            <span className="memory-card-progress">
              {phase.kind === 'main'
                ? progressLabel(index, queue.length)
                : `重现 ${Math.min(retryIndex + 1, retryQueue.length)} / ${retryQueue.length}`}
            </span>
            <span className="memory-card-phase">{phase.kind === 'retry' ? '没记住重现' : phaseLabel(current)}</span>
            <span className="memory-card-node">{current.nodeName ?? '未命名考点'}</span>
            <span className="memory-card-type">{cardTypeLabel(current.cardType)}</span>
            {current.phase === 'due' ? (
              <span className="memory-card-retention">{retentionLabel(current.retention)}</span>
            ) : null}
          </div>

          <button
            type="button"
            className="memory-card-flip"
            data-testid="memory-card-flip"
            onClick={() => setRevealed((value) => !value)}
          >
            <span className="memory-card-front">{current.front}</span>
            {revealed ? (
              <span
                className="memory-card-back"
                data-testid="memory-card-back"
                // $..$ math segments render via KaTeX; plain segments are
                // HTML-escaped inside renderMathText (see mathText.ts).
                dangerouslySetInnerHTML={{ __html: renderMathText(current.back) }}
              />
            ) : (
              <span className="memory-card-hint">点击翻面查看结论 / 公式</span>
            )}
          </button>

          {revealed ? (
            <div className="memory-card-ratings" data-testid="memory-card-ratings">
              {RATING_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`memory-card-rating memory-card-rating-${option.value}`}
                  disabled={submitting}
                  onClick={() => submitRating(option.value)}
                >
                  <strong>{option.label}</strong>
                  <small>{option.hint}</small>
                </button>
              ))}
            </div>
          ) : null}

          {revealed && practiceCandidate && onPracticeCandidate ? (
            <button
              type="button"
              className="memory-card-practice-link"
              data-testid="memory-card-practice-link"
              onClick={() => onPracticeCandidate(practiceCandidate.questionId, practiceCandidate.stem.slice(0, 40))}
            >
              做一道「{current.nodeName ?? '该考点'}」的题验证 →
            </button>
          ) : null}

          {reviewError ? <p className="memory-card-error" role="alert">自评提交失败：{reviewError}</p> : null}
        </section>
      ) : null}

      {session && hasRenderableQueue(queue) ? (
        <footer className="memory-card-summary muted">
          到期 {session.summary.dueCount} 张 · 新卡 {session.summary.newCount} 张 · 本次已自评 {reviewedCount} 张
          {retriedCount > 0 ? `（含重现 ${retriedCount} 张）` : ''}
          {catchUpDays ? ` · 到期较多：本轮先复习最紧急的 ${session.summary.sessionCap} 张，约还需 ${catchUpDays} 天清完` : ''}
          {lastFeedback ? ` · 上一张（${RATING_LABELS[lastFeedback.rating]}）：${lastFeedback.nextLabel}` : ''}
        </footer>
      ) : null}
    </div>
  );
}

const RATING_LABELS: Record<CardSelfRatingValue, string> = {
  remembered: '记住',
  fuzzy: '模糊',
  forgot: '没记住',
};
