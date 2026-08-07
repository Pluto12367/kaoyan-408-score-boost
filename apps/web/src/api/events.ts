import { API_BASE_URL, fetchWithAuth } from './client';

// 前端细粒度行为埋点：best-effort 上报，失败静默，不打断学习流程。
export async function trackEvent(type: string, payload?: Record<string, unknown>): Promise<void> {
  try {
    await fetchWithAuth(`${API_BASE_URL}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type, payload }),
    });
  } catch {
    // best-effort: 埋点失败不影响用户操作
  }
}
