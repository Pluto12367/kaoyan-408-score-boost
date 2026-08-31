import { ArrowUpRight, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import type { DashboardViewModel } from '../useDashboardViewModel';

export function DashboardHero({ model, onNavigate }: { model: DashboardViewModel; onNavigate: () => void }) {
  return (
    <motion.section className="dashboard-home-hero" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
      <div className="dashboard-hero-copy">
        <span className="dashboard-kicker">408 OS · 学习驾驶舱</span>
        <h2>Welcome back, {model.greetingName} <span aria-hidden="true">👋</span></h2>
        <p>今天继续推进你的 {model.stage} 学习路径，系统会把最重要的一步放在这里。</p>
        <div className="dashboard-hero-stats">
          <div><strong>{model.remainingDays ?? '--'}</strong><span>距离考试（天）</span></div>
          <div><strong>{model.dailyHours ?? '--'}<small>h</small></strong><span>今日学习目标</span></div>
          <div><strong>{model.targetSchool}</strong><span>目标院校</span></div>
        </div>
      </div>
      <button type="button" className="dashboard-ai-orbit" onClick={onNavigate} aria-label="打开 AI 学习辅导">
        <span className="dashboard-orbit-ring dashboard-orbit-ring-one" />
        <span className="dashboard-orbit-ring dashboard-orbit-ring-two" />
        <span className="dashboard-ai-core"><Sparkles size={24} /><small>AI COACH</small></span>
        <span className="dashboard-ai-ready">AI Coach Ready <ArrowUpRight size={14} /></span>
      </button>
    </motion.section>
  );
}
