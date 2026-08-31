import { ArrowRight, BrainCircuit, CircleAlert } from 'lucide-react';
import type { DashboardViewModel } from '../useDashboardViewModel';

export function AIInsightCard({ model, onNavigate }: { model: DashboardViewModel; onNavigate: () => void }) {
  return <section className="dashboard-ai-insight" aria-label="学习建议">
    <div className="dashboard-insight-heading"><span className="dashboard-ai-badge"><BrainCircuit size={16} /></span><div><span className="dashboard-kicker">Learning Insight</span><h3>AI Learning Coach</h3></div><span className="dashboard-insight-live">READY</span></div>
    <p className="dashboard-insight-lead">根据你的学习记录，当前最值得投入的是：</p>
    <div className="dashboard-insight-focus"><CircleAlert size={17} /><strong>{model.weakPointTitle ?? '先完成今日任务，建立第一份学习记录'}</strong></div>
    <p className="dashboard-insight-reason">{model.weakPointReason ?? '完成练习后，系统会逐步识别你的薄弱知识点，并在这里给出下一步建议。'}</p>
    <button type="button" className="dashboard-insight-action" onClick={onNavigate}>查看学习建议 <ArrowRight size={15} /></button>
  </section>;
}
