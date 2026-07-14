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
  let response: Response;
  try {
    response = await fetch(url, withAuthHeader(init, session));
  } catch (error) {
    reportNetworkError(url, init, error);
    throw error;
  }
  if (response.status !== 401 || !session?.refreshToken) return reportFailedResponse(url, init, response);

  let refreshed: AuthSession;
  try {
    const { refreshAuthSession } = await import('./endpoints/auth');
    refreshed = await refreshAuthSession(session.refreshToken);
    storeAuthSession(refreshed);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent<AuthSession>('auth-session-updated', { detail: refreshed }));
    }
  } catch {
    clearStoredAuthSession();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth-session-expired'));
    }
    return reportFailedResponse(url, init, response);
  }

  try {
    const retried = await fetch(url, withAuthHeader(init, refreshed));
    return reportFailedResponse(url, init, retried);
  } catch (error) {
    reportNetworkError(url, init, error);
    throw error;
  }
}

function reportFailedResponse(url: string, init: RequestInit, response: Response) {
  if (!response.ok) {
    console.error('[API request failed]', {
      method: init.method ?? 'GET',
      url,
      status: response.status,
      requestId: response.headers.get('x-request-id'),
    });
  }
  return response;
}

function reportNetworkError(url: string, init: RequestInit, error: unknown) {
  console.error('[API network error]', {
    method: init.method ?? 'GET',
    url,
    message: error instanceof Error ? error.message : String(error),
  });
}

function withAuthHeader(init: RequestInit, session: AuthSession | null): RequestInit {
  const headers = new Headers(init.headers);
  const token = session?.accessToken ?? session?.token;
  if (token && !headers.has('authorization')) headers.set('authorization', `Bearer ${token}`);
  return { ...init, headers };
}

/**
 * Like fetch() but automatically adds the Authorization header.
 * Use this for ALL student-facing API calls. Backend Phase 1 requires auth on every endpoint.
 */
export function fetchWithAuth(url: string, init: RequestInit = {}): Promise<Response> {
  return authenticatedFetch(url, init);
}

export function isStaticDemoMode(): boolean {
  return typeof window !== 'undefined'
    && window.location.hostname.endsWith('github.io')
    && !import.meta.env.VITE_API_BASE_URL;
}
