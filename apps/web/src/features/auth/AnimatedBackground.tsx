import { motion, useReducedMotion } from 'framer-motion';

export function AnimatedBackground() {
  const shouldReduceMotion = useReducedMotion();
  return (
    <div className="auth-ambient" aria-hidden="true">
      <motion.span
        className="auth-ambient-glow auth-ambient-glow-violet"
        animate={shouldReduceMotion ? undefined : { x: [0, 24, 0], y: [0, -16, 0] }}
        transition={{ duration: 12, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.span
        className="auth-ambient-glow auth-ambient-glow-cyan"
        animate={shouldReduceMotion ? undefined : { x: [0, -18, 0], y: [0, 20, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: 'easeInOut' }}
      />
      <span className="auth-ambient-grid" />
    </div>
  );
}
