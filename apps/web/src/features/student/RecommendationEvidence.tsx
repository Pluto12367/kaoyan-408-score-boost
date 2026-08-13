export type RecommendationConfidence = 'high' | 'medium' | 'low';

interface RecommendationEvidenceProps {
  title: string;
  reason: string;
  evidence: string;
  impact: string;
  confidence: RecommendationConfidence;
  nextDataHint?: string;
}

const TEXT = {
  ariaLabel: '\u63a8\u8350\u4f9d\u636e\u4e0e\u6570\u636e\u53ef\u4fe1\u5ea6',
  reason: '\u4e3a\u4ec0\u4e48\u63a8\u8350',
  evidence: '\u4f9d\u636e\u6765\u81ea',
  confidence: '\u6570\u636e\u53ef\u4fe1\u5ea6',
  impact: '\u505a\u5b8c\u4f1a\u66f4\u65b0',
  nextDataHint: '\u5982\u4f55\u8ba9\u5224\u65ad\u66f4\u51c6',
};

const confidenceLevelLabel: Record<RecommendationConfidence, string> = {
  high: '\u9ad8\uff1a\u5df2\u6709\u591a\u9879\u5b66\u4e60\u8bb0\u5f55\u652f\u6491',
  medium: '\u4e2d\uff1a\u6709\u90e8\u5206\u8bb0\u5f55\uff0c\u5efa\u8bae\u7ee7\u7eed\u7ec3\u4e60\u9a8c\u8bc1',
  low: '\u4f4e\uff1a\u6570\u636e\u8fd8\u5c11\uff0c\u5148\u5b8c\u6210\u51e0\u9053\u9898\u518d\u5224\u65ad',
};

export function RecommendationEvidence({
  title,
  reason,
  evidence,
  impact,
  confidence,
  nextDataHint,
}: RecommendationEvidenceProps) {
  return (
    <aside className={`recommendation-evidence confidence-${confidence}`} aria-label={TEXT.ariaLabel}>
      <div className="recommendation-evidence-head">
        <strong>{title}</strong>
        <span>{TEXT.confidence}：{confidenceLevelLabel[confidence]}</span>
      </div>
      <div className="recommendation-evidence-grid">
        <p><span>{TEXT.reason}</span>{reason}</p>
        <p><span>{TEXT.evidence}</span>{evidence}</p>
        <p><span>{TEXT.impact}</span>{impact}</p>
        {nextDataHint ? <p><span>{TEXT.nextDataHint}</span>{nextDataHint}</p> : null}
      </div>
    </aside>
  );
}
