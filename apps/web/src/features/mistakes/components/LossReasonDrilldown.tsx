import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { isStaticDemoMode } from '../../../api/env';
import { fetchErrorDiagnosis, fetchScoreRecovery } from '../../../api/endpoints/learningInsights';
import {
  confidenceLabel,
  reasonForNode,
  recoveryStatusLabel,
  selectOutstandingRecoveries,
  summarizeRecovery,
  type DiagnosisView,
  type ScoreRecoveryView,
} from '../../student/home/learningInsightsView';

/**
 * PHASE 10b — wrong-book drill-down: "这道题为什么还在丢分".
 *
 * The home card tells the student how much loss is still outstanding; this
 * panel is where the student ACTS on it: each outstanding question is joined
 * with the diagnostic finding for its node (the same read-only projections the
 * home card uses) and opens the EXISTING wrong-question detail via
 * `onOpenDetail` — no new backend surface, no local thresholds, no invented
 * reasons (a question whose node has no finding shows no reason line).
 */

interface DrilldownState {
  diagnosis: DiagnosisView | null;
  recovery: ScoreRecoveryView | null;
  failed: boolean;
}

export function LossReasonDrilldown({
  onOpenDetail,
  limit = 5,
}: {
  onOpenDetail: (questionId: string) => void;
  limit?: number;
}) {
  const [state, setState] = useState<DrilldownState>({ diagnosis: null, recovery: null, failed: false });

  useEffect(() => {
    if (isStaticDemoMode()) return;
    let cancelled = false;
    const load = async () => {
      try {
        const [diagnosis, recovery] = await Promise.all([fetchErrorDiagnosis(7), fetchScoreRecovery(30)]);
        if (cancelled) return;
        setState({ diagnosis: diagnosis as DiagnosisView, recovery: recovery as ScoreRecoveryView, failed: false });
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
  if (state.failed && !state.recovery) {
    return (
      <section className="wrong-loss-drilldown" aria-label="失分与错因">
        <p className="task-status" role="status">失分与错因暂时加载失败，请稍后刷新。</p>
      </section>
    );
  }
  if (!state.recovery || !state.recovery.storeAvailable || state.recovery.dataStatus !== 'OK') return null;

  const outstanding = selectOutstandingRecoveries(state.recovery.rows, limit);
  const summaryLine = summarizeRecovery(state.recovery, state.failed);
  const findings = state.diagnosis?.findings ?? [];
  if (!summaryLine && outstanding.length === 0) return null;

  return (
    <section className="wrong-loss-drilldown" aria-label="失分与错因" data-testid="wrong-loss-drilldown">
      <div className="wrong-loss-head">
        <div>
          <strong>失分与错因（逐题）</strong>
          <span>这里只列还有失分证据的题：点开即可进入该题复盘，重做正确后它才会从「未追回」里消失。</span>
        </div>
      </div>
      {summaryLine ? <p className="wrong-loss-summary">{summaryLine}</p> : null}
      {outstanding.length > 0 ? (
        <ul className="wrong-loss-list">
          {outstanding.map((row) => {
            const reason = reasonForNode(findings, row.nodeId);
            return (
              <li key={row.questionId} className="wrong-loss-item">
                <div className="wrong-loss-item-main">
                  <strong>题 {shortQuestionId(row.questionId)}</strong>
                  <span className={`wrong-loss-status status-${row.status}`}>{recoveryStatusLabel(row.status)}</span>
                  <span className="wrong-loss-amount">未追回 {row.observedLossOutstanding} 分 · 已重做 {row.reattemptCount} 次</span>
                </div>
                {reason ? (
                  <p className="wrong-loss-reason">
                    <AlertTriangle size={12} aria-hidden="true" />
                    {reason.questionSubtypeLabel} · {reason.reasonLabel} · 近 7 天 {reason.count} 次
                    {reason.observedLostScore > 0 ? ` · OBSERVED 失 ${reason.observedLostScore} 分` : ''}
                    <small>{reason.finding}</small>
                  </p>
                ) : (
                  <p className="wrong-loss-reason no-finding">该题所属考点近 7 天没有可归因的错因证据。</p>
                )}
                <button type="button" className="wrong-loss-action" onClick={() => onOpenDetail(row.questionId)}>
                  打开这道题复盘 <ArrowRight size={12} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {findings.length > 0 ? (
        <div className="wrong-loss-patterns">
          <strong>主要错因模式</strong>
          <ul>
            {findings.slice(0, 3).map((finding) => (
              <li key={`${finding.nodeId}-${finding.reasonLabel}`}>
                <span>{finding.finding}</span>
                <small>{confidenceLabel(finding.confidence)}</small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function shortQuestionId(questionId: string): string {
  // Seeded/imported ids look like `cal-q-a-abcd1234`; keep the tail readable
  // without claiming a title the API did not provide.
  const parts = questionId.split('-');
  return parts.length > 2 ? parts.slice(-2).join('-') : questionId;
}
