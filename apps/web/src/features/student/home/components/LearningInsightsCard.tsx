import { useEffect, useState } from 'react';
import { ArrowRight, Clock, Target } from 'lucide-react';
import { isStaticDemoMode } from '../../../../api/env';
import {
  fetchErrorDiagnosis,
  fetchForgettingRisk,
  fetchScoreRecovery,
  fetchTrainingPrescription,
} from '../../../../api/endpoints/learningInsights';
import {
  confidenceLabel,
  formatLadderStep,
  hasRenderableInsight,
  riskLabel,
  selectForgettingWarnings,
  selectOutstandingRecoveries,
  summarizeRecovery,
  type DiagnosisView,
  type ForgettingRiskView,
  type PrescriptionView,
  type ScoreRecoveryView,
} from '../learningInsightsView';

/**
 * PHASE 10 (frontend consumption) — "今天先解决什么" card.
 *
 * Renders what the backend already decided, and nothing else:
 *   处方   — the training ladder for the top diagnostic finding
 *   遗忘   — overdue / at-risk learned nodes (top 3)
 *   失分恢复 — recovered vs outstanding summary + the still-open questions
 *
 * Read-only: four GET projections, zero writes, zero local thresholds. In the
 * static demo it renders nothing; a failed load renders an explicit line (never
 * a mock, per AGENTS §4). When the projections are simply empty the card stays
 * silent — the student already has the daily plan.
 */

interface CardState {
  diagnosis: DiagnosisView | null;
  prescription: PrescriptionView | null;
  forgetting: ForgettingRiskView | null;
  recovery: ScoreRecoveryView | null;
  failed: boolean;
}

export function LearningInsightsCard({ onNavigate }: { onNavigate?: (section: 'dashboard' | 'wrong-book' | 'question' | 'knowledge-catalog') => void }) {
  const [state, setState] = useState<CardState>({ diagnosis: null, prescription: null, forgetting: null, recovery: null, failed: false });

  useEffect(() => {
    if (isStaticDemoMode()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [diagnosis, prescription, forgetting, recovery] = await Promise.all([
          fetchErrorDiagnosis(7),
          fetchTrainingPrescription(7),
          fetchForgettingRisk(),
          fetchScoreRecovery(30),
        ]);
        if (cancelled) return;
        setState({
          diagnosis: diagnosis as DiagnosisView,
          prescription: prescription as PrescriptionView,
          forgetting: forgetting as ForgettingRiskView,
          recovery: recovery as ScoreRecoveryView,
          failed: false,
        });
      } catch {
        if (!cancelled) setState((prev) => ({ ...prev, failed: true }));
      }
    };
    void load();
    const onRefresh = () => void load();
    window.addEventListener('daily-brief:refresh', onRefresh);
    return () => {
      cancelled = true;
      window.removeEventListener('daily-brief:refresh', onRefresh);
    };
  }, []);

  if (isStaticDemoMode()) return null;
  if (state.failed && !state.prescription && !state.forgetting && !state.recovery) {
    return (
      <section className="dashboard-section learning-insights-section" aria-label="学习处方与提醒">
        <p className="dashboard-muted" role="status">处方与提醒暂时加载失败，请稍后刷新。</p>
      </section>
    );
  }
  if (!hasRenderableInsight(state)) return null;

  const { diagnosis, prescription, forgetting, recovery } = state;
  const ladder = prescription?.ladder ?? [];
  const warnings = forgetting ? selectForgettingWarnings(forgetting.rows) : [];
  const outstanding = recovery ? selectOutstandingRecoveries(recovery.rows) : [];
  const recoveryLine = summarizeRecovery(recovery, state.failed);
  const topFinding = diagnosis?.findings?.[0] ?? null;

  const goTo = (section: 'dashboard' | 'wrong-book' | 'question' | 'knowledge-catalog') => {
    if (onNavigate) onNavigate(section);
    else if (typeof window !== 'undefined') window.location.hash = `#/${section}`;
  };

  return (
    <section className="dashboard-section learning-insights-section" aria-label="学习处方与提醒">
      {prescription?.target ? (
        <div className="learning-insights-block" data-testid="learning-insights-prescription">
          <div className="dashboard-section-heading">
            <div>
              <span className="dashboard-kicker">Training Prescription</span>
              <h3>今天先解决这个</h3>
            </div>
            {topFinding ? <span>{confidenceLabel(topFinding.confidence)}</span> : null}
          </div>
          <p className="learning-insights-reason">{prescription.reason}</p>
          <ol className="learning-insights-ladder">
            {ladder.map((step) => (
              <li key={`${step.order}-${step.stage}`} className={`learning-insights-step status-${step.status.toLowerCase()}`}>
                <strong>{step.label}</strong>
                <small>{formatLadderStep(step)}</small>
              </li>
            ))}
          </ol>
          <button type="button" className="learning-insights-go" onClick={() => goTo('knowledge-catalog')}>
            去练这个考点 <ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="learning-insights-block" data-testid="learning-insights-forgetting">
          <div className="dashboard-section-heading">
            <div>
              <span className="dashboard-kicker">Forgetting Defense</span>
              <h3>会了但快忘了</h3>
            </div>
            <span>{warnings.length} 项</span>
          </div>
          <ul className="learning-insights-list">
            {warnings.map((row) => (
              <li key={row.nodeId}>
                <Clock size={13} aria-hidden="true" />
                <span>
                  <strong>{row.nodeName ?? row.nodeId}</strong>
                  <small>{riskLabel(row.risk)} · {row.finding}</small>
                </span>
              </li>
            ))}
          </ul>
          <button type="button" className="learning-insights-go" onClick={() => goTo('wrong-book')}>
            去复习 <ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {recoveryLine ? (
        <div className="learning-insights-block" data-testid="learning-insights-recovery">
          <div className="dashboard-section-heading">
            <div>
              <span className="dashboard-kicker">Score Recovery</span>
              <h3>丢的分追回来了吗</h3>
            </div>
            <Target size={14} aria-hidden="true" />
          </div>
          <p className="learning-insights-reason">{recoveryLine}</p>
          {outstanding.length > 0 ? (
            <ul className="learning-insights-list">
              {outstanding.map((row) => (
                <li key={row.questionId}>
                  <span>
                    <strong>{row.status === 'not_recovered' ? '重做又错' : '还没重做'}</strong>
                    <small>未追回 {row.observedLossOutstanding} 分 · 已重做 {row.reattemptCount} 次</small>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          <button type="button" className="learning-insights-go" onClick={() => goTo('wrong-book')}>
            去处理失分题 <ArrowRight size={13} aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </section>
  );
}
