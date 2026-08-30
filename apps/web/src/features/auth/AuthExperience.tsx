import { motion, useReducedMotion } from 'framer-motion';
import type { AccountPanelProps } from './AccountPanel';
import { AnimatedBackground } from './AnimatedBackground';
import { LoginCard } from './LoginCard';
import { LoginHero } from './LoginHero';
import { RegisterWizard } from './RegisterWizard';
import './auth-experience.css';

export function AuthExperience(props: AccountPanelProps) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <main className="auth-experience">
      <AnimatedBackground />
      <div className="auth-experience-layout">
        <motion.section
          className="auth-experience-hero"
          initial={{ opacity: 0, x: shouldReduceMotion ? 0 : -28 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.65, ease: [0.22, 1, 0.36, 1] }}
        >
          <LoginHero registration={props.authMode === 'register' && !props.user && !props.staticDemoMode} />
        </motion.section>
        <section className="auth-experience-form" aria-label="账号登录">
          {props.authMode === 'register' && !props.user && !props.staticDemoMode
            ? <RegisterWizard status={props.status} onSubmit={props.onSubmit} onBackToLogin={props.onToggleMode} />
            : <LoginCard {...props} />}
        </section>
      </div>
    </main>
  );
}
