import { useEffect, useState } from 'react';
import { Check, Database, Network, Orbit, Sparkles } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { OnboardingProfile } from './onboardingProfile';

interface InitializationCoreProps { profile: OnboardingProfile; onComplete: () => void; }

const stages = ['正在加载408知识体系', '正在建立 Student State', '正在分析知识掌握模型', '正在生成个性化学习计划', 'AI 学习空间创建完成'];
const nodes = ['数据结构', '操作系统', '计算机组成', '计算机网络'];

export function InitializationCore({ profile, onComplete }: InitializationCoreProps) {
  const [stage, setStage] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const timers = stages.slice(1).map((_, index) => window.setTimeout(() => setStage(index + 1), (index + 1) * 1200));
    const done = window.setTimeout(onComplete, 6600);
    return () => { timers.forEach(window.clearTimeout); window.clearTimeout(done); };
  }, [onComplete]);

  return (
    <main className="onboarding-screen auth-experience">
      <div className="auth-ambient" aria-hidden="true"><div className="auth-ambient-glow auth-ambient-glow-violet" /><div className="auth-ambient-glow auth-ambient-glow-cyan" /><div className="auth-ambient-grid" /></div>
      <motion.section className="initialization-core" initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.96 }} animate={{ opacity: 1, scale: 1 }}>
        <p className="onboarding-kicker">408 OS · PERSONAL LEARNING SPACE</p>
        <h1>AI 正在初始化你的 408 学习系统</h1>
        <p className="onboarding-lead">{profile.name || 'Explorer'} 的学习空间正在建立，稍后会带你进入第一条学习路径。</p>
        <div className="initialization-visual" aria-label="AI 知识系统初始化">
          <div className="initialization-orbit initialization-orbit-one" /><div className="initialization-orbit initialization-orbit-two" />
          {nodes.map((node, index) => <motion.span className={`initialization-node initialization-node-${index}`} key={node} initial={{ opacity: 0, scale: 0.7 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: reduceMotion ? 0 : index * 0.18 }}><span>{index === 0 ? <Database size={14} /> : index === 1 ? <Network size={14} /> : index === 2 ? <Orbit size={14} /> : <Sparkles size={14} />}</span>{node}</motion.span>)}
          <motion.div className="initialization-ai-core" animate={reduceMotion ? undefined : { boxShadow: ['0 22px 60px rgba(99,102,241,.28)', '0 28px 72px rgba(139,92,246,.5)', '0 22px 60px rgba(99,102,241,.28)'] }} transition={{ duration: 2.4, repeat: Infinity }}><Sparkles size={32} /><small>AI CORE</small></motion.div>
        </div>
        <div className="initialization-status" aria-live="polite"><AnimatePresence mode="wait"><motion.p key={stages[stage]} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>{stage === stages.length - 1 ? <Check size={16} /> : <span className="initialization-spinner" />}{stages[stage]}</motion.p></AnimatePresence><div className="initialization-progress"><motion.span animate={{ width: `${((stage + 1) / stages.length) * 100}%` }} transition={{ duration: 0.55 }} /></div></div>
        <div className="initialization-checklist">{nodes.map((node, index) => <span className={index <= stage ? 'ready' : ''} key={node}>{index <= stage ? <Check size={13} /> : <i />}{node}</span>)}</div>
      </motion.section>
    </main>
  );
}
