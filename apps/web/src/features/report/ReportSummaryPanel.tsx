import { useMemo } from 'react';
import { estimatePredictedScore } from '@kaoyan408/shared';
import type { StageReport, UserProfile, WeaknessReport } from '@kaoyan408/shared';
import type { MasteryMap } from '../../api';

const verdictLabels: Record<StageReport['verdict'], string> = {
  improved: '较上阶段提升',
  declined: '较上阶段下降',
  steady: '与上阶段持平',
  insufficient: '数据不足',
};

interface ReportSummaryPanelProps {
  student: UserProfile;
  report: WeaknessReport;
  stageReport: StageReport | null;
  masteryMap: MasteryMap | null;
  onRetry: () => void;
}

export function ReportSummaryPanel({ student, report, stageReport, masteryMap, onRetry }: ReportSummaryPanelProps) {
  const averageMastery = useMemo(() => {
    if (!masteryMap || masteryMap.subjects.length === 0) return null;
    const total = masteryMap.subjects.reduce((sum, subject) => sum + subject.averageMastery, 0);
    return Math.round(total / masteryMap.subjects.length);
  }, [masteryMap]);

  const hasEnoughData = report.completionRate > 0
    || report.weakPoints.length > 0
    || (masteryMap?.subjects.some((subject) => subject.points.length > 0) ?? false);

  const predicted = useMemo(() => {
    if (!hasEnoughData) return null;
    return estimatePredictedScore({
      currentScore: student.currentScore ?? 0,
      targetScore: student.targetScore ?? 100,
      accuracyRate: report.accuracyRate,
      averageMastery: averageMastery ?? report.accuracyRate,
      remainingDays: student.remainingDays ?? 0,
      scoreTrend: stageReport?.assessmentTrend.delta ?? undefined,
    });
  }, [averageMastery, hasEnoughData, report.accuracyRate, stageReport?.assessmentTrend.delta, student.currentScore, student.remainingDays, student.targetScore]);

  const improvements: string[] = [];
  if (stageReport?.verdict === 'improved' && stageReport.accuracyDelta !== null) {
    improvements.push(`正确率较上一阶段提升 ${stageReport.accuracyDelta} 个百分点`);
  }
  if (stageReport?.assessmentTrend.delta != null && stageReport.assessmentTrend.delta > 0) {
    improvements.push(`最近测评较上次提升 ${stageReport.assessmentTrend.delta} 分`);
  }
  if ((stageReport?.streakDays ?? 0) >= 2) {
    improvements.push(`已连续学习 ${stageReport?.streakDays} 天`);
  }
  if (improvements.length === 0) improvements.push('暂无足够对比数据，坚持一周学习后自动生成');

  const risks: string[] = [];
  if (stageReport?.verdict === 'declined' && stageReport.accuracyDelta !== null) {
    risks.push(`本阶段正确率较上一阶段下降 ${Math.abs(stageReport.accuracyDelta)} 个百分点`);
  }
  if (stageReport?.assessmentTrend.delta != null && stageReport.assessmentTrend.delta < 0) {
    risks.push(`最近测评较上次下降 ${Math.abs(stageReport.assessmentTrend.delta)} 分`);
  }
  if (report.speedRisks.length > 0) {
    risks.push(`${report.speedRisks.length} 个考点存在“耗时过长”风险，需限时训练`);
  }
  if ((stageReport?.wrong.pendingCount ?? 0) > 0) {
    risks.push(`还有 ${stageReport?.wrong.pendingCount} 道错题待复盘`);
  }
  if (risks.length === 0) risks.push('当前无明显风险，保持现有节奏即可');

  const topTask = report.weakPoints[0]
    ? `优先补强「${report.weakPoints[0].title}」（${report.weakPoints[0].chapter}）：${report.weakPoints[0].suggestion}`
    : stageReport?.nextAction
      ? stageReport.nextAction
      : '先完成今日推荐练习，积累数据后再生成建议';

  const longTermWeakPoints = useMemo(() => {
    const weak = (masteryMap?.subjects ?? []).flatMap((subject) =>
      subject.points
        .filter((point) => point.status === 'weak')
        .map((point) => ({ title: point.title, rate: `掌握 ${point.masteryRate}%` })),
    );
    if (weak.length > 0) return weak.slice(0, 3);
    return report.weakPoints.slice(0, 3).map((point) => ({ title: point.title, rate: `正确率 ${point.accuracyRate}%` }));
  }, [masteryMap, report.weakPoints]);

  return (
    <section id="report-summary" className="panel report-summary-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">报告结论</p><h3>先看结论，再看数据</h3></div>
        {stageReport ? <span className="stage-report-badge">{verdictLabels[stageReport.verdict]}</span> : null}
      </div>

      <div className="report-summary-grid">
        <article className="report-conclusion-card">
          <h4>本周预计提升</h4>
          {predicted
            ? <><strong>{predicted.minScore}–{predicted.maxScore} 分</strong><p>参考值 {predicted.bestEstimate} 分 · {predicted.basis}</p></>
            : <><strong>--</strong><p>完成练习后基于正确率、掌握度与剩余天数生成</p></>}
        </article>

        <article className="report-conclusion-card">
          <h4>主要进步</h4>
          <ul className="report-conclusion-list">
            {improvements.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </article>

        <article className="report-conclusion-card">
          <h4>当前风险</h4>
          <ul className="report-conclusion-list">
            {risks.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </article>

        <article className="report-conclusion-card">
          <h4>下周最重要任务</h4>
          <p className="report-top-task">{topTask}</p>
        </article>

        <article className="report-conclusion-card">
          <h4>长期薄弱点</h4>
          {longTermWeakPoints.length
            ? <ul className="report-conclusion-list">{longTermWeakPoints.map((item) => <li key={item.title}>{item.title}（{item.rate}）</li>)}</ul>
            : <p>暂无薄弱点数据，完成诊断与练习后自动生成</p>}
        </article>
      </div>

      <p className="report-summary-footer">
        {predicted
          ? `预测分数${predicted.disclaimer}，实际结果受题目难度、复习质量与临场状态影响。`
          : '完成诊断与练习后，系统将基于正确率、掌握度和剩余天数生成预测分数。'}
        {' '}<button type="button" className="secondary-action" onClick={onRetry}>刷新报告数据</button>
      </p>
    </section>
  );
}