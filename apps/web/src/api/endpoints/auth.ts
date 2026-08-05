import { API_BASE_URL, fetchWithAuth } from '../client';
import type { AuthSession, ChangePasswordInput, UserRole } from '../types';

export async function loginAsRole(role: UserRole): Promise<AuthSession> {
  const response = await fetch(`${API_BASE_URL}/auth/demo-login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) throw new Error(`Login failed with ${response.status}`);
  return response.json() as Promise<AuthSession>;
}

export async function registerAccount(input: { inviteCode: string; email: string; password: string; name: string }): Promise<AuthSession> {
  return requestAuthSession('/auth/register', input);
}

export async function loginAccount(input: { email: string; password: string }): Promise<AuthSession> {
  return requestAuthSession('/auth/login', input);
}

export async function refreshAuthSession(refreshToken: string): Promise<AuthSession> {
  return requestAuthSession('/auth/refresh', { refreshToken });
}

export async function logoutAccount(refreshToken?: string): Promise<void> {
  if (!refreshToken) return;
  const response = await fetch(`${API_BASE_URL}/auth/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) throw new Error(`Logout failed with ${response.status}`);
}

export async function changePassword(input: ChangePasswordInput): Promise<AuthSession> {
  const response = await fetchWithAuth(`${API_BASE_URL}/auth/change-password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? `Authentication failed with ${response.status}`);
  }
  return response.json() as Promise<AuthSession>;
}

async function requestAuthSession(path: string, body: object): Promise<AuthSession> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? `Authentication failed with ${response.status}`);
  }
  return response.json() as Promise<AuthSession>;
}
