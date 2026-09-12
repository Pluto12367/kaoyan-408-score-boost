import { useEffect, useRef, useState } from 'react';
import { isStaticDemoMode } from '../../api/env';
import { submitPracticeSession } from '../../api/endpoints/sessions';
import {
  fetchDueProbes,
  type DueProbeCardView,
} from '../../api/endpoints/transferProbe';
import './transfer-probe.css';

type Stage =
  | { state: 'idle' }
  | { state: 'running'; card: DueProbeCardView; startedAt: number }
  | { state: 'result'; correct: boolean }
  | { state: 'expired' }
  | { state: 'unavailable'; reason: string };

/**
 * S2 Transfer Probe — minimal student surface.
 *
 * Honesty contract:
 *   • the card says what this is: a transfer re-test on a never-seen
 *     question, not ordinary practice
 *   • the result page shows only the student's own outcome — aggregate
 *     TransferRate/Gap never appear here (teacher view + evidence gate only)
 *   • an expired probe is neutral, never a failure; no probe = silent card
 */
export function TransferProbeCard() {
  const [cards, setCards] = useState<DueProbeCardView[]>([]);
  const [stage, setStage] = useState<Stage>({ state: 'idle' });
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const loaded = useRef(false);

  const load = () => {
    if (isStaticDemoMode() || loaded.current) return;
    loaded.current = true;
    fetchDueProbes()
      .then((result) => {
        if (!result.featureEnabled || !result.storeAvailable) return;
        const deliverable = result.cards.filter((card) => card.session);
        setCards(deliverable);
        const expired = result.cards.some((card) => card.reason === 'window_elapsed');
        if (expired && deliverable.length === 0) setStage({ state: 'expired' });
      })
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : '迁移复测加载失败。');
      });
  };

  useEffect(() => {
    if (isStaticDemoMode()) return;
    load();
    const onRefresh = () => {
      loaded.current = false;
      load();
    };
    window.addEventListener('transfer-probe:refresh', onRefresh);
    return () => window.removeEventListener('transfer-probe:refresh', onRefresh);
  }, []);

  if (isStaticDemoMode()) return null;

  const start = (card: DueProbeCardView) => {
    if (!card.session) return;
    setSelected(null);
    setStage({ state: 'running', card, startedAt: Date.now() });
  };

  const submit = async (card: DueProbeCardView, startedAt: number) => {
    if (!card.session || !selected) return;
    try {
      const result = await submitPracticeSession(card.session.sessionId, {
        answers: [
          {
            questionId: card.session.question.id,
            selectedAnswer: selected,
            timeSpentSec: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
          },
        ],
        totalActiveMs: Math.max(1000, Date.now() - startedAt),
      });
      const first = result.records?.[0];
      setStage({ state: 'result', correct: first ? first.correct : false });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '复测提交失败，请重试。');
    }
  };

  if (error) {
    return (
      <section className="transfer-probe" aria-label="迁移复测">
        <p className="transfer-probe-error">{error}</p>
      </section>
    );
  }

  if (stage.state === 'running' && stage.card.session) {
    const question = stage.card.session.question;
    return (
      <section className="transfer-probe transfer-probe-running" aria-label="迁移复测">
        <p className="transfer-probe-banner">迁移复测 · 一道从未见过的新题 · 这不是普通练习</p>
        <p className="transfer-probe-node">{stage.card.nodeName}</p>
        <p className="transfer-probe-stem">{question.stem}</p>
        <div className="transfer-probe-options">
          {question.options.map((option) => (
            <button
              key={option}
              type="button"
              className={`transfer-probe-option${selected === option ? ' selected' : ''}`}
              aria-pressed={selected === option}
              onClick={() => setSelected(option)}
            >
              {option}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="transfer-probe-submit"
          disabled={!selected}
          onClick={() => submit(stage.card, stage.startedAt)}
        >
          提交复测
        </button>
      </section>
    );
  }

  if (stage.state === 'result') {
    return (
      <section className="transfer-probe" aria-label="迁移复测结果">
        <p className="transfer-probe-banner">本次复测：{stage.correct ? '答对' : '答错'}</p>
        <p className="transfer-probe-muted">这道新题的结果已计入你的学习记录。</p>
      </section>
    );
  }

  if (stage.state === 'expired') {
    return (
      <section className="transfer-probe" aria-label="迁移复测">
        <p className="transfer-probe-muted">本次复测窗口已过期——这不是失败，下次学习后还会有新的复测。</p>
      </section>
    );
  }

  if (cards.length === 0) return null;

  return (
    <section className="transfer-probe" aria-label="迁移复测">
      <p className="transfer-probe-banner">迁移复测 · 检验学习是否迁移到新题</p>
      {cards.map((card) => (
        <div key={card.probeId} className="transfer-probe-card">
          <span className="transfer-probe-node">{card.nodeName || card.nodeId}</span>
          <button type="button" className="transfer-probe-start" onClick={() => start(card)}>
            开始复测（约 5 分钟）
          </button>
        </div>
      ))}
    </section>
  );
}
