import type { StageReport } from '@kaoyan408/shared';

const verdictLabels: Record<StageReport['verdict'], string> = {
  improved: '较上阶段提升',
  declined: '较上阶段下降',
  steady: '与上阶段持平',
  insufficient: '数据不足',
};

const verdictClasses: Record<StageReport['verdict'], string> = {
  improved: 'stage-report-badge stage-report-badge-improved',
  declined: 'stage-report-badge stage-report-badge-declined',
  steady: 'stage-report-badge',
  insufficient: 'stage-report-badge stage-report-badge-muted',
};

export function StageReportPanel({ report, onRetry }: { report: StageReport | null; onRetry: () => void }) {
  if (!report) {
    return (
      <section id="stage-report" className="panel">
        <div className="panel-heading">
          <div><p className="eyebrow">阶段报告</p><h3>最近 7 天 vs 上一阶段</h3></div>
        </div>
        <p className="empty-state">阶段报告需要测评历史、掌握度与错题数据，加载完成后自动生成。</p>
        <button type="button" className="secondary-action" onClick={onRetry}>重新加载</button>
      </section>
    );
  }

  const weakest = report.mastery.weakestPoints;
  return (
    <section id="stage-report" className="panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">阶段报告</p>
          <h3>最近 {report.windowDays} 天 vs 上一阶段</h3>
        </div>
        <span className={verdictClasses[report.verdict]}>{verdictLabels[report.verdict]}</span>
      </div>

      <div className="stage-report-grid">
        <article className="stage-report-card">
          <h4>答题表现</h4>
          <strong>{report.current.answeredCount}</strong><span> 题</span>
          <p>正确率 {report.current.accuracyRate ?? '--'}%</p>
          {report.accuracyDelta !== null
            ? <small>较上一阶段 {report.accuracyDelta >= 0 ? '+' : ''}{report.accuracyDelta} 个百分点</small>
            : <small>上一阶段暂无答题记录</small>}
          <small>本阶段活跃 {report.current.activeDays} 天（上一阶段 {report.previous.activeDays} 天）</small>
        </article>

        <article className="stage-report-card">
          <h4>测评趋势</h4>
          <strong>{report.assessmentTrend.latestScore ?? '--'}</strong><span> 分</span>
          {report.assessmentTrend.delta !== null
            ? <small>较上次测评 {report.assessmentTrend.delta >= 0 ? '+' : ''}{report.assessmentTrend.delta} 分</small>
            : <small>暂无两次以上测评记录</small>}
          {report.assessmentTrend.latestDate
            ? <small>最近测评：{new Date(report.assessmentTrend.latestDate).toLocaleDateString('zh-CN')}</small>
            : null}
        </article>

        <article className="stage-report-card">
          <h4>掌握度</h4>
          <p>已掌握 {report.mastery.masteredCount} · 巩固中 {report.mastery.reviewCount} · 薄弱 {report.mastery.weakCount}</p>
          {weakest.length > 0 ? (
            <ul>
              {weakest.map((point) => (
                <li key={point.knowledgePointId}>{point.title}（{point.masteryRate}%）</li>
              ))}
            </ul>
          ) : <small>暂无掌握度数据</small>}
        </article>

        <article className="stage-report-card">
          <h4>错题处理</h4>
          <p>待复盘 {report.wrong.pendingCount} · 已复盘 {report.wrong.reviewedCount} · 已解决 {report.wrong.resolvedCount}</p>
          {report.wrong.resolvedRate !== null
            ? <small>复盘解决率 {report.wrong.resolvedRate}%</small>
            : <small>暂无错题数据</small>}
          <small>连续学习 {report.streakDays} 天</small>
        </article>
      </div>

      <p className="stage-report-summary">{report.summary}</p>
      <p className="stage-report-next"><strong>下一步：</strong>{report.nextAction}</p>
    </section>
  );
}
