import { ClipboardCheck, RefreshCw } from 'lucide-react';
import type { StageAssessment, StageAssessmentResult } from '../../api';
import type { RoleSection } from '../../layouts/RoleNavigation';

interface StageAssessmentPanelProps {
  assessment: StageAssessment;
  result: StageAssessmentResult | null;
  status: string;
  onSubmit: () => void;
  onGenerate?: () => void;
  onNavigate?: (section: RoleSection) => void;
}

const resultActions: Array<{
  label: string;
  detail: string;
  target: RoleSection;
}> = [
  { label: '去错题本复盘', detail: '先处理本次暴露的错误与混淆点。', target: 'wrong-book' },
  { label: '去专项训练', detail: '用相近题型巩固薄弱知识点。', target: 'question' },
  { label: '回到今日计划', detail: '把测评后的任务接回今天安排。', target: 'plan' },
  { label: '查看学习报告', detail: '确认分数变化和下一步方向。', target: 'report' },
];

function buildAssessmentVerdict(result: StageAssessmentResult) {
  if (result.score >= 85) return '当前阶段基本达标，可以进入下一轮巩固。';
  if (result.score >= 70) return '当前阶段接近达标，建议先补齐错题和薄弱点。';
  return '当前阶段还不稳，先别急着进入下一阶段。';
}

export function StageAssessmentPanel({ assessment, result, status, onSubmit, onGenerate, onNavigate }: StageAssessmentPanelProps) {
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
      <div className="assessment-actions">
        {onGenerate ? (
          <button type="button" className="secondary-action" onClick={onGenerate}>
            <RefreshCw size={18} /> 生成阶段测评
          </button>
        ) : null}
        <button type="button" onClick={onSubmit}><ClipboardCheck size={18} /> 开始阶段测评</button>
      </div>
      {result ? (
        <div className="assessment-result">
          <strong>本次得分 {result.score} / 100</strong>
          <div className="assessment-action-panel">
            <article>
              <span>测评结论</span>
              <p>{buildAssessmentVerdict(result)}</p>
            </article>
            <article>
              <span>下一步行动</span>
              <p>本次答对 {result.correctCount}/{result.totalQuestions} 题，需复盘 {result.reviewItems.length} 项。先把测评暴露的问题转成练习、复盘和报告证据。</p>
            </article>
            <div className="assessment-action-grid">
              {resultActions.map((action) => (
                <button
                  key={action.target}
                  type="button"
                  className="secondary-action assessment-action-button"
                  onClick={() => onNavigate?.(action.target)}
                  disabled={!onNavigate}
                >
                  <strong>{action.label}</strong>
                  <span>{action.detail}</span>
                </button>
              ))}
            </div>
          </div>
          <p>{result.adjustment.message}</p>
          <p>下一阶段：{result.adjustment.stage} / {result.adjustment.planPhase}</p>
          <p>答对 {result.correctCount}/{result.totalQuestions} 题，复盘项 {result.reviewItems.length} 个。</p>
          <ul>{result.nextActions.map((action) => <li key={action}>{action}</li>)}</ul>
        </div>
      ) : null}
    </section>
  );
}
