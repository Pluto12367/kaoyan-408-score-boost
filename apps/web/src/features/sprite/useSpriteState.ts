import { useCallback, useEffect, useRef, useState } from 'react';
import { API_BASE_URL, fetchWithAuth } from '../../api/client';
import { isStaticDemoMode } from '../../api/env';

/**
 * V10-2 — pulls the sprite's derived state (GET /sprite/state, V10-1).
 *
 * Ambient-surface honesty (V9 ProactiveCoachCard precedent): static demo mode
 * and hard fetch failures keep the surface hidden — the sprite never becomes
 * an error banner; API-level degradation arrives as the backend's own honest
 * lines. Lifecycle guards follow useStudentContextData: a request sequence
 * number drops out-of-order responses, `cancelled` stops unmount writes, and
 * an account switch clears state before refetching.
 */

export interface SpriteEvidenceRefView {
  readonly source: string;
  readonly field: string;
  readonly detail: string;
}

export interface SpriteLineView {
  readonly id: string;
  readonly text: string;
  readonly tone: string;
  readonly evidenceRefs: readonly SpriteEvidenceRefView[];
  readonly action?: {
    readonly kind: 'deep_link';
    readonly target: string;
    readonly label: string;
  };
}

export interface SpriteStateView {
  readonly version: string;
  readonly userId: string;
  readonly asOf: string;
  readonly mood: string;
  readonly moodReason: {
    readonly kind: string;
    readonly detail: string;
    readonly evidenceRefs: readonly SpriteEvidenceRefView[];
  };
  readonly presence: {
    readonly visible: boolean;
    readonly mode: 'normal' | 'quiet';
    readonly reason: string;
  };
  readonly lines: readonly SpriteLineView[];
  readonly bond: {
    readonly streakDays: number | null;
    readonly recoveredFromGap: boolean;
    readonly milestones: readonly {
      readonly kind: string;
      readonly label: string;
      readonly evidenceRef: SpriteEvidenceRefView;
    }[];
  };
  readonly degraded: {
    readonly unavailableSources: readonly string[];
    readonly contextAvailable: boolean;
  };
  readonly memory: {
    readonly entries: readonly { readonly id: string; readonly text: string }[];
  };
  readonly source: string;
}

const MUTE_STORAGE_KEY = 'kaoyan408:sprite.muted';
const BUBBLE_STORAGE_KEY = 'kaoyan408:sprite.bubble';

export function readSpriteMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Local natural-day key for the one-proactive-bubble-per-day quota. */
export function spriteDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Storage unavailable counts as consumed — when in doubt, interrupt less. */
export function readBubbleQuotaUsed(date = new Date()): boolean {
  try {
    return window.localStorage.getItem(BUBBLE_STORAGE_KEY) === spriteDateKey(date);
  } catch {
    return true;
  }
}

export function consumeBubbleQuota(date = new Date()): void {
  try {
    window.localStorage.setItem(BUBBLE_STORAGE_KEY, spriteDateKey(date));
  } catch {
    // already treated as consumed by the read side
  }
}

export function useSpriteState(accountKey: string | null) {
  const [state, setState] = useState<SpriteStateView | null>(null);
  const [muted, setMuted] = useState<boolean>(() => readSpriteMuted());
  const requestIdRef = useRef(0);
  const reloadRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (isStaticDemoMode()) return;
    let cancelled = false;

    const run = async () => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      try {
        const response = await fetchWithAuth(`${API_BASE_URL}/sprite/state`);
        if (!response.ok || cancelled) return;
        const payload = (await response.json()) as SpriteStateView;
        if (cancelled || requestId !== requestIdRef.current) return;
        setState(payload);
      } catch {
        // ambient surface: network failure keeps the sprite hidden (never a banner)
      }
    };

    reloadRef.current = () => void run();
    setState(null);
    void run();

    const onRefresh = () => reloadRef.current();
    window.addEventListener('daily-brief:refresh', onRefresh);
    window.addEventListener('focus', onRefresh);
    document.addEventListener('visibilitychange', onRefresh);
    return () => {
      cancelled = true;
      reloadRef.current = () => {};
      window.removeEventListener('daily-brief:refresh', onRefresh);
      window.removeEventListener('focus', onRefresh);
      document.removeEventListener('visibilitychange', onRefresh);
    };
  }, [accountKey]);

  const toggleMuted = useCallback(() => {
    setMuted((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(MUTE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // storage unavailable: the preference simply does not persist
      }
      return next;
    });
  }, []);

  return { state, muted, toggleMuted };
}
