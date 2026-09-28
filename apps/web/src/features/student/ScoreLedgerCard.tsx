import { useEffect, useState } from 'react';
import { fetchRecoveryEvidence, type RecoveryEvidenceResponse } from '../../api/endpoints/recoveryEvidence';

/**
 * V14 ①（D-V-1′/D-V-2/D-V-3 批准 2026-09-27）— 提分账本卡。
 *
 * 两层口径分列（OBSERVED 同题追回 / PROXY 同节点与 AI·自评判分）；
 * 样本 < 3 → insufficient_data 空态（"系统在为你记账"文案本身即价值，D-V-3）；
 * 语义脚注固定输出（RULE-11：测量值，不是成绩预测）。
 */

export function ScoreLedgerCard() {
  const [data, setData] = useState<RecoveryEvidenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchRecoveryEvidence(30)
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setLoading(false);
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : '提分账本加载失败');
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="muted">正在汇总提分账本…</p>;
  if (error) return <p className="real-exam-error" role="alert">提分账本加载失败：{error}</p>;
  if (!data?.storeAvailable) return null;

  return (
    <section className="score-ledger-card" aria-label="提分账本">
      <h3>提分账本（近 {data.windowDays} 天）</h3>
      {data.summary.insufficient ? (
        <p className="muted">
          复测样本不足（{data.summary.recoveredCandidates}/{data.summary.minSamples}）——继续训练与复测，
          系统会在这里记下你追回的每一分。
        </p>
      ) : (
        <>
          <div className="score-ledger-summary">
            <span className="score-ledger-primary">
              挽回（可验证）：<strong>{data.summary.observedRecovered}</strong> 分
            </span>
            <span className="score-ledger-secondary">
              挽回（含估计）：<strong>{data.summary.proxyRecovered}</strong> 分
              {data.summary.unpricedRecovered > 0 ? ` · 另有 ${data.summary.unpricedRecovered} 题未定价只计数` : ''}
            </span>
          </div>
          <ul className="score-ledger-claims">
            {data.claims.slice(0, 5).map((claim, index) => (
              <li key={`${claim.questionId}-${index}`}>
                <span className={claim.kind === 'OBSERVED' ? 'ledger-badge-observed' : 'ledger-badge-proxy'}>{claim.kind}</span>
                {' '}{claim.nodeName ?? claim.nodeId ?? '未归因节点'}
                {claim.recoveredScore != null ? ` +${claim.recoveredScore} 分` : ''}
                <small> — {claim.note}</small>
              </li>
            ))}
          </ul>
          {data.proxyClaims.length > 0 ? (
            <p className="muted">另有 {data.proxyClaims.length} 条估计口径（PROXY）明细。</p>
          ) : null}
        </>
      )}
      <p className="score-ledger-footnote">{data.footnote}</p>
    </section>
  );
}
