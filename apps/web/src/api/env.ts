/**
 * Phase 2: Production safety — mock data is NEVER allowed in production.
 *
 * - Development (npm run dev):   mock fallback allowed
 * - GitHub Pages (static demo):  mock fallback allowed (no backend available)
 * - Production (staging/prod):   mock fallback DISABLED — API failures show error UI
 */

export function isMockAllowed(): boolean {
  // GitHub Pages static demo — no backend, mock is the only option
  if (isStaticDemoMode()) return true;

  // Local development — mock is convenient
  if (import.meta.env.DEV) return true;

  // Explicit staging flag
  if (import.meta.env.VITE_ALLOW_MOCK === 'true') return true;

  // Production — NEVER use mock data
  return false;
}

export function isStaticDemoMode(): boolean {
  return typeof window !== 'undefined'
    && window.location.hostname.endsWith('github.io')
    && !import.meta.env.VITE_API_BASE_URL;
}

export function isProduction(): boolean {
  return import.meta.env.PROD && !isStaticDemoMode() && import.meta.env.VITE_ALLOW_MOCK !== 'true';
}
