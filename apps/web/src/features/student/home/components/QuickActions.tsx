import { ArrowUpRight, BookOpen, Brain, ClipboardCheck, Network, RotateCcw } from 'lucide-react';
import type { RoleSection } from '../../../../layouts/RoleNavigation';

const actions: Array<{ title: string; detail: string; target: RoleSection; icon: typeof BookOpen }> = [
  { title: '知识地图', detail: '查看掌握路径', target: 'knowledge-catalog', icon: Network },
  { title: '开始训练', detail: '进入题库练习', target: 'question', icon: BookOpen },
  { title: '错题复习', detail: '处理待复盘题目', target: 'wrong-book', icon: RotateCcw },
  { title: '模拟测试', detail: '检验阶段成果', target: 'test', icon: ClipboardCheck },
];

export function QuickActions({ onNavigate }: { onNavigate: (section: RoleSection) => void }) {
  return <section className="dashboard-section dashboard-quick-section" aria-label="快捷入口">
    <div className="dashboard-section-heading"><div><span className="dashboard-kicker">Quick Entry</span><h3>继续你的学习</h3></div><Brain size={18} className="dashboard-quick-mark" /></div>
    <div className="dashboard-quick-grid">{actions.map(({ title, detail, target, icon: Icon }) => <button type="button" key={target} onClick={() => onNavigate(target)}><span className="dashboard-quick-icon"><Icon size={18} /></span><span><strong>{title}</strong><small>{detail}</small></span><ArrowUpRight size={15} /></button>)}</div>
  </section>;
}
