import type { AuthSession } from './types';

const AUTH_STORAGE_KEY = 'kaoyan408.auth.session';
let activeAuthSession: AuthSession | null = null;

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:3000';

// ---- Auth session management ----

export function loadStoredAuthSession(): AuthSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(AUTH_STORAGE_KEY);
    if (!value) return null;
    const session = JSON.parse(value) as Partial<AuthSession>;
    if (!isAuthSession(session)) return null;
    activeAuthSession = session;
    return session;
  } catch {
    return null;
  }
}

function isAuthSession(value: Partial<AuthSession>): value is AuthSession {
  return typeof value.token === 'string'
    && Boolean(value.user)
    && typeof value.user?.id === 'string'
    && typeof value.user?.name === 'string'
    && (value.user?.role === 'student' || value.user?.role === 'teacher' || value.user?.role === 'admin');
}

export function storeAuthSession(session: AuthSession) {
  activeAuthSession = session;
  if (typeof window !== 'undefined') window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
}

export function setActiveAuthSession(session: AuthSession | null) {
  activeAuthSession = session;
}

export function clearStoredAuthSession() {
  activeAuthSession = null;
  if (typeof window !== 'undefined') window.localStorage.removeItem(AUTH_STORAGE_KEY);
}

export function getActiveAuthSession(): AuthSession | null {
  return activeAuthSession;
}

// ---- HTTP helpers ----

export async function authenticatedFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const session = getActiveAuthSession();
  const response = await fetch(url, withAuthHeader(init, session));
  if (response.status !== 401 || !session?.refreshToken) return response;

  try {
    const { refreshAuthSession } = await import('./endpoints/auth');
    const refreshed = await refreshAuthSession(session.refreshToken);
    storeAuthSession(refreshed);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<AuthSession>('auth-session-updated', { detail: refreshed }));
    }
    return fetch(url, withAuthHeader(init, refreshed));
  } catch {
    clearStoredAuthSession();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth-session-expired'));
    }
    return response;
  }
}

function withAuthHeader(init: RequestInit, session: AuthSession | null): RequestInit {
  const headers = new Headers(init.headers);
  const token = session?.accessToken ?? session?.token;
  if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
  return { ...init, headers };
}

export function isStaticDemoMode(): boolean {
  return typeof window !== 'undefined'
    && window.location.hostname.endsWith('github.io')
    && !import.meta.env.VITE_API_BASE_URL;
}
