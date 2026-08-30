import { motion, useReducedMotion } from 'framer-motion';
import { AccountPanel, type AccountPanelProps } from './AccountPanel';

export function LoginCard(props: AccountPanelProps) {
  const shouldReduceMotion = useReducedMotion();
  return (
    <motion.div
      className="auth-login-card-wrap"
      initial={{ opacity: 0, scale: shouldReduceMotion ? 1 : 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.55, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
    >
      <AccountPanel {...props} variant="login-card" />
    </motion.div>
  );
}
