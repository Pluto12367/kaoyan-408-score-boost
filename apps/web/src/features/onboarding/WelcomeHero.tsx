import { ArrowRight, Check, Target, Sparkles } from 'lucide-react';
import { motion, useReducedMotion } from 'framer-motion';
import type { OnboardingProfile } from './onboardingProfile';

interface WelcomeHeroProps { profile: OnboardingProfile; userName: string; onEnterDashboard: () => void; }

export function WelcomeHero({ profile, userName, onEnterDashboard }: WelcomeHeroProps) {
  const reduceMotion = useReducedMotion();
  return (
    <main className="onboarding-screen auth-experience">
      <div className="auth-ambient" aria-hidden="true"><div className="auth-ambient-glow auth-ambient-glow-violet" /><div className="auth-ambient-glow auth-ambient-glow-cyan" /><div className="auth-ambient-grid" /></div>
      <motion.section className="welcome-hero" initial={{ opacity: 0, y: reduceMotion ? 0 : 18 }} animate={{ opacity: 1, y: 0 }}>
        <div className="welcome-mark"><span>408</span><strong>408 OS</strong></div>
        <p className="onboarding-kicker">WELCOME TO 408 OS</p>
        <h1>Welcome back, {userName || profile.name || 'Explorer'}</h1>
        <p className="onboarding-lead">你的专属学习空间已创建。现在，AI 会和你一起把每一次练习变成可见的进步。</p>
        <div className="welcome-profile"><div><span>目标院校</span><strong>{profile.targetSchool || '等待入学诊断'}</strong></div><div><span>考试方向</span><strong>{profile.examType}</strong></div><div><span>目标分数</span><strong>{profile.targetScore ? `${profile.targetScore} 分` : '待设定'}</strong></div></div>
        <div className="welcome-capabilities"><span><Check size={15} />知识地图</span><span><Check size={15} />学习计划</span><span><Check size={15} />AI 推荐</span></div>
        <div className="welcome-actions"><button type="button" onClick={onEnterDashboard}>进入学习空间<ArrowRight size={17} /></button><p><Target size={14} />每天从一条清晰的下一步开始。</p></div>
        <Sparkles className="welcome-sparkle" size={24} aria-hidden="true" />
      </motion.section>
    </main>
  );
}
