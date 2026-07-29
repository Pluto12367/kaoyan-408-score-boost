import { useState, useEffect, useCallback } from 'react';
import type { AuthSession, UserProfile, UserRole } from '../api/types';
import {
  loadStoredAuthSession,
  storeAuthSession,
  setActiveAuthSession,
  clearStoredAuthSession,
} from '../api/client';
import {
  loginAsRole,
  loginAccount,
  registerAccount,
  refreshAuthSession,
  logoutAccount,
} from '../api/endpoints/auth';
import { isStaticDemoMode } from '../api/env';
import { roleLabel } from '../constants';

export function useAuth() {
  const [authSession, setAuthSession] = useState<AuthSession | null>(() => loadStoredAuthSession());
  const [sessionUser, setSessionUser] = useState<UserProfile | null>(() => loadStoredAuthSession()?.user ?? null);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [authStatus, setAuthStatus] = useState('请登录后同步学习记录。');

  // Restore session on mount
  useEffect(() => {
    const stored = loadStoredAuthSession();
    if (!stored?.refreshToken) return;
    refreshAuthSession(stored.refreshToken)
      .then((session) => applyAuthenticatedSession(session, '登录状态已恢复。'))
      .catch(() => clearAccountSession('登录已过期，请重新登录。'));
  }, []);

  // Auto-refresh token
  useEffect(() => {
    if (!authSession?.refreshToken || !authSession.expiresIn) return;
    const timeout = window.setTimeout(() => {
      refreshAuthSession(authSession.refreshToken!)
        .then((session) => applyAuthenticatedSession(session, '登录状态已自动续期。'))
        .catch(() => clearAccountSession('登录已过期，请重新登录。'));
    }, Math.max(30_000, (authSession.expiresIn - 60) * 1000));
    return () => window.clearTimeout(timeout);
  }, [authSession?.refreshToken, authSession?.expiresIn]);

  // Listen for session events
  useEffect(() => {
    function handleSessionUpdated(event: Event) {
      const session = (event as CustomEvent<AuthSession>).detail;
      if (!session) return;
      setAuthSession(session);
      setSessionUser(session.user);
    }
    function handleSessionExpired() {
      setAuthSession(null);
      setSessionUser(null);
      setAuthStatus('登录已过期，请重新登录。');
    }
    window.addEventListener('auth-session-updated', handleSessionUpdated);
    window.addEventListener('auth-session-expired', handleSessionExpired);
    return () => {
      window.removeEventListener('auth-session-updated', handleSessionUpdated);
      window.removeEventListener('auth-session-expired', handleSessionExpired);
    };
  }, []);

  function applyAuthenticatedSession(session: AuthSession, message: string) {
    storeAuthSession(session);
    setAuthSession(session);
    setSessionUser(session.user);
    setAuthStatus(message);
  }

  function clearAccountSession(message: string) {
    clearStoredAuthSession();
    setActiveAuthSession(null);
    setAuthSession(null);
    setSessionUser(null);
    setAuthStatus(message);
  }

  const handleRoleSwitch = useCallback(async (role: UserRole) => {
    setAuthStatus('正在切换演示身份...');
    try {
      const session = await loginAsRole(role);
      setActiveAuthSession(session);
      setAuthSession(session);
      setSessionUser(session.user);
      setAuthStatus(`已切换为${roleLabel[session.user.role]}：${session.user.name}。`);
      return 'connected' as const;
    } catch {
      if (isStaticDemoMode() || import.meta.env.DEV) {
        const session = createStaticDemoSession(role);
        setActiveAuthSession(session);
        setAuthSession(session);
        setSessionUser(session.user);
        setAuthStatus(`${roleLabel[session.user.role]} ${session.user.name} 演示身份已启用。`);
        return 'mock' as const;
      }
      setAuthStatus('身份切换失败，当前仍使用本地演示身份。');
      return 'mock' as const;
    }
  }, []);

  const handleAccountSubmit = useCallback(async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const email = String(form.get('email') ?? '');
    const password = String(form.get('password') ?? '');
    const name = String(form.get('name') ?? '');
    setAuthStatus(authMode === 'register' ? '正在创建账号...' : '正在登录...');
    try {
      const session = authMode === 'register'
        ? await registerAccount({ email, password, name })
        : await loginAccount({ email, password });
      applyAuthenticatedSession(session, `${roleLabel[session.user.role]} ${session.user.name} 已登录。`);
      formElement.reset();
    } catch (error) {
      setAuthStatus(error instanceof Error ? error.message : '登录失败，请稍后重试。');
    }
  }, [authMode]);

  const handleLogout = useCallback(async () => {
    const refreshToken = authSession?.refreshToken;
    clearAccountSession('已退出登录。');
    try { await logoutAccount(refreshToken); } catch { setAuthStatus('本地会话已清除。'); }
  }, [authSession?.refreshToken]);

  return {
    authSession,
    sessionUser,
    authMode,
    authStatus,
    setAuthSession,
    setSessionUser,
    setAuthMode,
    setAuthStatus,
    handleRoleSwitch,
    handleAccountSubmit,
    handleLogout,
    applyAuthenticatedSession,
    clearAccountSession,
  };
}

function createStaticDemoSession(role: UserRole): AuthSession {
  const names: Record<UserRole, string> = {
    student: '林同学',
    teacher: '王老师',
    admin: '管理员',
  };

  return {
    token: `static-demo-${role}`,
    accessToken: `static-demo-${role}`,
    expiresIn: 60 * 60,
    user: {
      id: role === 'student' ? 'u-001' : `${role}-001`,
      name: names[role],
      role,
    },
  };
}
