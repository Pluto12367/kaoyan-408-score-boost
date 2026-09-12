import { useEffect, useRef, useState } from 'react';
import { isStaticDemoMode } from '../../api/env';
import { trackEvent } from '../../api/events';
import { submitPracticeSession } from '../../api/endpoints/sessions';
import {
  fetchDueProbes,
  type DueProbeCardView,
} from '../../api/endpoints/transferProbe';
import {
  HOW_GUIDANCE,
  describeVerification,
  resolveNextAction,
} from '@kaoyan408/shared';
import type { RoleSection } from '../../layouts/RoleNavigation';
import './transfer-probe.css';

type Stage =
  | { state: 'idle' }
  | { state: 'running'; card: DueProbeCardView; startedAt: number }
  | { state: 'result'; correct: boolean; card: DueProbeCardView }
  | { state: 'expired' }
  | { state: 'unavailable'; reason: string };

/**
 * S2 Transfer Probe — student surface, productized in G1.7.
 *
 * Honesty contract (unchanged):
 *   • the card says what this is: a transfer re-test on a never-seen question,
 *     not ordinary practice
 *   • the result page shows only the student's own outcome — aggregate
 *     TransferRate/Gap never appear here (teacher view + evidence gate only)
 *   • an expired probe is neutral, never a failure; no probe = silent card
 *
 * G1.7 additions:
 *   • a first-use explanation (task §13) taken from the shared HOW copy, so the
 *     student learns what a transfer probe is the first time one appears
 *   • the mandatory closing sentence: the result feeds transfer evidence but is
 *     not an exam score
 *   • a NEXT for every terminal state, so a failed probe is not a dead end
 */
export function TransferProbeCard({
  onNavigate,
  mount = 'report',
}: {
  onNavigate?: (section: RoleSection) => void;
  mount?: 'report' | 'today';
}) {
  const [cards, setCards] = useState<DueProbeCardView[]>([]);
  const [stage, setStage] = useState<Stage>({ state: 'idle' });
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [explained, setExplained] = useState(false);
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

  const surface = mount === 'today' ? 'today_probe' : 'report_probe';

  const start = (card: DueProbeCardView) => {
    if (!card.session) return;
    setSelected(null);
    setStage({ state: 'running', card, startedAt: Date.now() });
    void trackEvent('guidance.accepted', {
      guidanceId: 'first_transfer_probe',
      trigger: 'first_transfer_probe',
      action: 'start_probe',
      surface,
    });
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
      setStage({ state: 'result', correct: first ? first.correct : false, card });
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
        <p className="transfer-probe-muted">不看解析、一次提交、约 5 分钟——按真实考试节奏做。</p>
      </section>
    );
  }

  if (stage.state === 'result') {
    const view = describeVerification({
      domain: 'transfer_probe',
      probeOutcome: stage.correct ? 'passed' : 'failed',
    });
    return (
      <section className="transfer-probe" aria-label="迁移复测结果" data-testid="probe-result">
        <p className="transfer-probe-banner">本次复测：{stage.correct ? '答对' : '答错'}</p>
        <p className="transfer-probe-muted">这道新题的结果已计入你的学习记录。</p>
        {view.meaning.map((line) => <p key={line.text} className="transfer-probe-muted">{line.text}</p>)}
        <p className="transfer-probe-muted" data-testid="probe-not-score">
          这次结果会进入你的迁移证据，但不会直接等同于考试分数。
        </p>
        {onNavigate ? (
          <button
            type="button"
            className="transfer-probe-start"
            data-testid="probe-next"
            onClick={() => onNavigate(view.next.section)}
          >
            {view.next.label}
          </button>
        ) : null}
        <p className="transfer-probe-muted">{view.nextReason}</p>
      </section>
    );
  }

  if (stage.state === 'expired') {
    return (
      <section className="transfer-probe" aria-label="迁移复测">
        <p className="transfer-probe-muted">本次复测窗口已过期——这不是失败，下次学习后还会有新的复测。</p>
        <p className="transfer-probe-muted">它不算失败、不影响你的任何记录；只是系统还没拿到「新题会不会做」的证据。</p>
      </section>
    );
  }

  if (cards.length === 0) return null;

  const guide = HOW_GUIDANCE.first_transfer_probe;
  const next = resolveNextAction({
    hasPendingTask: false, reviewDue: 0, probeDue: true, assessments: 1, probeEvents: 0,
  });

  return (
    <section
      className="transfer-probe"
      aria-label="迁移复测"
      data-testid={mount === 'today' ? 'probe-card-today' : 'probe-card-report'}
    >
      <p className="transfer-probe-banner">迁移复测 · 检验学习是否迁移到新题</p>
      {!explained ? (
        <div className="transfer-probe-intro" data-testid="probe-first-use">
          <p className="transfer-probe-stem">{guide.why}</p>
          <ul className="transfer-probe-how">
            {guide.how.map((step) => <li key={step}>{step}</li>)}
          </ul>
          <p className="transfer-probe-muted">{guide.after}</p>
          <button
            type="button"
            className="transfer-probe-start"
            onClick={() => {
              setExplained(true);
              void trackEvent('guidance.shown', {
                guidanceId: 'first_transfer_probe',
                trigger: 'first_transfer_probe',
                surface,
              });
            }}
          >
            明白了
          </button>
        </div>
      ) : null}
      {cards.map((card) => (
        <div key={card.probeId} className="transfer-probe-card">
          <span className="transfer-probe-node">{card.nodeName || card.nodeId}</span>
          <button type="button" className="transfer-probe-start" onClick={() => start(card)}>
            开始复测（约 5 分钟）
          </button>
        </div>
      ))}
      {onNavigate ? <p className="transfer-probe-muted">为什么现在做：{next.reason}</p> : null}
    </section>
  );
}
