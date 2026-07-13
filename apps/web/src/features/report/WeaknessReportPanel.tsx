import type { WeaknessReport } from '@kaoyan408/shared';

export function WeaknessReportPanel({ report }: { report: WeaknessReport }) {
  return (
    <article id="report" className="panel">
      <p className="eyebrow">提分报告</p>
      <h3>{report.summary}</h3>
      <div className="weak-list">
        {report.weakPoints.map((point) => (
          <div key={point.knowledgePointId}><strong>{point.title}</strong><span>{point.topReason ?? '待诊断'} · {point.suggestion}</span></div>
        ))}
      </div>
    </article>
  );
}
