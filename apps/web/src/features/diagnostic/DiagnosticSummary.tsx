import { Target } from 'lucide-react';
import type { StudyPlan, UserProfile } from '@kaoyan408/shared';

interface DiagnosticSummaryProps {
  student: UserProfile;
  plan: StudyPlan;
  status: string;
  onSubmit: () => void;
}

export function DiagnosticSummary({ student, plan, status, onSubmit }: DiagnosticSummaryProps) {
  return (
    <section className="panel diagnostic-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">入学诊断</p><h3>根据目标和基础生成阶段计划</h3></div>
        <button type="button" className="secondary-action" onClick={onSubmit}><Target size={18} /> 开始入学诊断</button>
      </div>
      <p className="task-status">{status}</p>
      <div className="diagnostic-grid">
        <article><strong>{student.currentScore ?? 0}</strong><span>当前估分</span></article>
        <article><strong>{student.targetScore ?? 0}</strong><span>目标分</span></article>
        <article><strong>{student.weakestSubject ?? '待诊断'}</strong><span>最弱科目</span></article>
        <article><strong>{plan.phase}</strong><span>当前计划阶段</span></article>
      </div>
    </section>
  );
}
