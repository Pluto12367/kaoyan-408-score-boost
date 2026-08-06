import type { AuthSession } from './types';

export type RefreshFn = (refreshToken: string) => Promise<AuthSession>;

// P1-01: single-flight refresh gate.
// 当多个请求同时收到 401 时，只发起一次 refresh 调用，其余调用共享同一个 Promise，
// 避免一次性 refresh token 被并发消费（先撤销再签发的轮换策略下，后到的刷新必然失败）。
let inFlight: Promise<AuthSession> | null = null;

export function refreshSessionOnce(refreshToken: string, refresh: RefreshFn): Promise<AuthSession> {
  if (!inFlight) {
    inFlight = refresh(refreshToken).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export function hasRefreshInFlight(): boolean {
  return inFlight !== null;
}
