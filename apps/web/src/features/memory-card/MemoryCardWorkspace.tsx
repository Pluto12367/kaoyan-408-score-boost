import { useCallback, useEffect, useState } from 'react';
import {
  fetchMemoryCardSession,
  reviewMemoryCard,
  type CardSelfRatingValue,
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

/**
 * V14-② 记忆卡复习面 — 自取数（self-scope），翻卡 + 三档自评。
 * 卡片内容不可伪造：演示模式显式拒绝，失败显式展示，绝不回退演示数据。
 * 面上的「保持率」是卡片域排程事实，不是掌握度，更不是分数。
 */

type ReviewFeedback = {
  cardId: string;
  rating: CardSelfRatingValue;
  nextLabel: string;
};

export function MemoryCardWorkspace() {
  const [session, setSession] = useState<MemoryCardSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [lastFeedback, setLastFeedback] = useState<ReviewFeedback | null>(null);

  const load = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setIndex(0);
    setRevealed(false);
    fetchMemoryCardSession()
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
  }, []);

  useEffect(() => load(), [load]);

  const queue: MemoryCardQueueItem[] = session?.queue ?? [];
  const current = queue[index] ?? null;

  const submitRating = (rating: CardSelfRatingValue) => {
    if (!current || submitting) return;
    setSubmitting(true);
    setReviewError(null);
    reviewMemoryCard(current.cardId, {
      rating,
      idempotencyKey: `mc-${current.cardId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    })
      .then((result) => {
        setSubmitting(false);
        setReviewedCount((count) => count + 1);
        const next = new Date(result.state.nextReviewAt ?? Date.now());
        setLastFeedback({
          cardId: current.cardId,
          rating,
          nextLabel: Number.isNaN(next.getTime())
            ? '已记录'
            : `下次复习：${next.toLocaleDateString()} ${result.state.stabilityDays != null ? `· 稳定性 ${result.state.stabilityDays} 天` : ''}`,
        });
        setRevealed(false);
        setIndex((value) => value + 1);
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

  return (
    <div className="memory-card-workspace" data-testid="memory-card-workspace">
      <header className="memory-card-header">
        <h2>记忆卡</h2>
        <p className="muted">
          按考点的结论与公式卡，翻卡自评（记住 / 模糊 / 没记住）。距考越近，复习排得越密；卡片复习只安排卡片重现，不改变掌握度。
        </p>
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

      {!loading && !error && session && !hasRenderableQueue(queue) ? (
        <div className="panel memory-card-panel">
          <p className="empty-state" data-testid="memory-card-empty">
            {session.summary.dueCount === 0 && reviewedCount > 0
              ? `本轮完成：已自评 ${reviewedCount} 张，当前没有到期卡片。`
              : '卡片库暂无待复习内容：到期卡片会在这里出现；新卡由教研内容轨逐步补充。'}
          </p>
          {lastFeedback ? <p className="muted">{lastFeedback.nextLabel}</p> : null}
        </div>
      ) : null}

      {!loading && !error && current ? (
        <section className="memory-card-stage" aria-label="记忆卡复习">
          <div className="memory-card-meta">
            <span className="memory-card-progress">{progressLabel(index, queue.length)}</span>
            <span className="memory-card-phase">{phaseLabel(current)}</span>
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
              <span className="memory-card-back" data-testid="memory-card-back">{current.back}</span>
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

          {reviewError ? <p className="memory-card-error" role="alert">自评提交失败：{reviewError}</p> : null}
        </section>
      ) : null}

      {session && queue.length > 0 ? (
        <footer className="memory-card-summary muted">
          到期 {session.summary.dueCount} 张 · 新卡 {session.summary.newCount} 张 · 本次已自评 {reviewedCount} 张
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
