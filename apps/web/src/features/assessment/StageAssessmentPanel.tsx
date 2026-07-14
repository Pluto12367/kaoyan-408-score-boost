import { ClipboardCheck } from 'lucide-react';
import type { StageAssessment, StageAssessmentResult } from '../../api';

interface StageAssessmentPanelProps {
  assessment: StageAssessment;
  result: StageAssessmentResult | null;
  status: string;
  onSubmit: () => void;
}

export function StageAssessmentPanel({ assessment, result, status, onSubmit }: StageAssessmentPanelProps) {
  return (
    <section id="assessment" className="panel assessment-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">阶段测评</p><h3>{assessment.title}</h3></div>
        <span>{assessment.questions.length} 题 · 预计 {assessment.estimatedMinutes} 分钟</span>
      </div>
      <p className="task-status">{status}</p>
      <div className="assessment-grid">
        <article><strong>聚焦知识点</strong><div className="tag-list">{assessment.focusKnowledgePoints.map((point) => <span key={point.id}>{point.title}</span>)}</div></article>
        <article><strong>测评说明</strong><p>{assessment.description}</p></article>
        <article><strong>提交后产出</strong><p>系统会同步练习记录、错题本和薄弱点报告，并给出下一步复习建议。</p></article>
      </div>
      <div className="assessment-actions"><button type="button" onClick={onSubmit}><ClipboardCheck size={18} /> 开始阶段测评</button></div>
      {result ? (
        <div className="assessment-result">
          <strong>本次得分 {result.score} / 100</strong>
          <p>{result.adjustment.message}</p>
          <p>下一阶段：{result.adjustment.stage} / {result.adjustment.planPhase}</p>
          <p>答对 {result.correctCount}/{result.totalQuestions} 题，复盘项 {result.reviewItems.length} 个。</p>
          <ul>{result.nextActions.map((action) => <li key={action}>{action}</li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}
