import { CheckCircle2, CircleDashed, TrendingUp } from 'lucide-react';
import { motion } from 'framer-motion';
import type { DashboardSubjectViewModel, DashboardViewModel } from '../useDashboardViewModel';

const accents = ['violet', 'amber', 'mint', 'blue'];

function MasteryRing({ subject, index }: { subject: DashboardSubjectViewModel; index: number }) {
  const radius = 25;
  const circumference = 2 * Math.PI * radius;
  const value = subject.value ?? 0;
  const dash = `${(value / 100) * circumference} ${circumference}`;
  return <div className={`dashboard-mastery-ring dashboard-accent-${accents[index]}`}>
    <svg viewBox="0 0 64 64" aria-label={subject.value == null ? `${subject.name}暂无数据` : `${subject.name}${subject.value}%`} role="img">
      <circle className="dashboard-ring-track" cx="32" cy="32" r={radius} />
      <circle className="dashboard-ring-value" cx="32" cy="32" r={radius} strokeDasharray={dash} />
    </svg>
    <strong>{subject.value == null ? '--' : subject.value}<small>{subject.value == null ? '' : '%'}</small></strong>
  </div>;
}

export function StudentStateCard({ model, onNavigate }: { model: DashboardViewModel; onNavigate: () => void }) {
  return <section className="dashboard-section dashboard-state-section" aria-label="知识掌握情况">
    <div className="dashboard-section-heading"><div><span className="dashboard-kicker">Student State</span><h3>408 四科掌握情况</h3></div><button type="button" className="dashboard-text-button" onClick={onNavigate}>查看详细地图 <TrendingUp size={14} /></button></div>
    <div className="dashboard-state-summary"><strong>{model.averageMastery ?? '--'}<small>%</small></strong><span>综合掌握度<br /><em>基于当前学习记录</em></span></div>
    <div className="dashboard-subject-grid">
      {model.subjects.map((subject, index) => <motion.article className={`dashboard-subject-card dashboard-accent-${accents[index]}`} key={subject.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.06 }}>
        <div className="dashboard-subject-header"><span className="dashboard-subject-icon">{subject.status === 'mastered' ? <CheckCircle2 size={15} /> : <CircleDashed size={15} />}</span><strong>{subject.name}</strong></div>
        <MasteryRing subject={subject} index={index} />
        <span className="dashboard-subject-status">{subject.status === 'mastered' ? '掌握稳定' : subject.status === 'review' ? '持续巩固' : subject.status === 'weak' ? '需要补强' : '暂无数据'}</span>
        <small>{subject.deltaText}</small>
      </motion.article>)}
    </div>
  </section>;
}
