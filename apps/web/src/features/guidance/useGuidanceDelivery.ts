import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EMPTY_DELIVERY_STATE,
  GUIDANCE_DISMISS_STORAGE_KEY,
  GUIDANCE_DAILY_CAP,
  GUIDANCE_PER_SURFACE_CAP,
  cooldownForTrigger,
  selectDeliverableGuidance,
  type GuidanceCandidate,
  type GuidanceDeliveryState,
} from '@kaoyan408/shared';
import { isStaticDemoMode } from '../../api/env';
import { trackEvent } from '../../api/events';

/**
 * G1.9 — guidance delivery state + telemetry.
 *
 * ## Why this is not a second state system (task §17)
 *
 * The only thing stored here is a *UI preference*: which tips the student has
 * already seen or dismissed, and when. It is kept in localStorage under the same
 * convention as the existing sprite preferences (`kaoyan408:sprite.muted`), it
 * holds no learning fact, and losing it costs at most one repeated tip. Every
 * fact a guide talks about is read from the canonical surfaces at render time.
 *
 * Owner decision A2 deferred a dedicated guidance API, so there is no server
 * side to this — which is exactly why the state must stay trivial and disposable.
 */

interface StoredGuidanceState {
  version: 1;
  seen: string[];
  dismissedAt: Record<string, string>;
  shownAt: Record<string, string>;
  /** Day key (`YYYY-MM-DD`) → items shown that day. */
  shownByDay: Record<string, number>;
  muted: boolean;
  /** The student has read the 7-line learning contract. */
  contractAccepted: boolean;
}

const EMPTY_STORED: StoredGuidanceState = {
  version: 1,
  seen: [],
  dismissedAt: {},
  shownAt: {},
  shownByDay: {},
  muted: false,
  contractAccepted: false,
};

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function readStore(): StoredGuidanceState {
  if (typeof window === 'undefined') return EMPTY_STORED;
  try {
    const raw = window.localStorage.getItem(GUIDANCE_DISMISS_STORAGE_KEY);
    if (!raw) return EMPTY_STORED;
    const parsed = JSON.parse(raw) as Partial<StoredGuidanceState>;
    if (parsed.version !== 1) return EMPTY_STORED;
    return {
      ...EMPTY_STORED,
      ...parsed,
      seen: Array.isArray(parsed.seen) ? parsed.seen : [],
      dismissedAt: parsed.dismissedAt ?? {},
      shownAt: parsed.shownAt ?? {},
      shownByDay: parsed.shownByDay ?? {},
      contractAccepted: parsed.contractAccepted === true,
    };
  } catch {
    // A corrupt preference must never break the learning surface.
    return EMPTY_STORED;
  }
}

function writeStore(state: StoredGuidanceState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(GUIDANCE_DISMISS_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode/quota): guidance simply does not persist.
  }
}

export interface GuidanceDelivery {
  /** True once this trigger has been shown before (permanent one-shot memory). */
  hasSeen(triggerId: string): boolean;
  /** Records a render and reports `guidance.shown`. */
  markShown(triggerId: string, surface: string, payload?: Record<string, unknown>): void;
  /** Records a dismissal and reports `guidance.dismissed`. */
  dismiss(triggerId: string, surface: string): void;
  /** Reports `guidance.accepted` — the student took the correction action. */
  reportAccepted(triggerId: string, action: string, surface: string): void;
  /** Reports `guidance.action_completed` when the action's outcome is observed. */
  reportCompleted(triggerId: string, action: string, outcome: string, surface: string): void;
  muted: boolean;
  setMuted(next: boolean): void;
  /** The student has read the learning contract. */
  contractAccepted: boolean;
  acceptContract(): void;
  /** Candidates this surface is allowed to render right now. */
  selectForSurface(candidates: readonly GuidanceCandidate[], surface: string): GuidanceCandidate[];
}

/**
 * The single delivery hook. `selectForSurface` applies cooldown, the per-surface
 * cap and the daily cap through the shared selector so the UI cannot invent its
 * own frequency rules (task §16).
 */
export function useGuidanceDelivery(): GuidanceDelivery {
  const [state, setState] = useState<StoredGuidanceState>(() => readStore());
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (isStaticDemoMode()) return;
    const onStorage = (event: StorageEvent) => {
      if (event.key === GUIDANCE_DISMISS_STORAGE_KEY) setState(readStore());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const persist = useCallback((mutate: (current: StoredGuidanceState) => StoredGuidanceState) => {
    setState((current) => {
      const next = mutate(current);
      stateRef.current = next;
      writeStore(next);
      return next;
    });
  }, []);

  const emit = useCallback((type: string, payload: Record<string, unknown>) => {
    if (isStaticDemoMode()) return;
    void trackEvent(type, payload);
  }, []);

  const markShown = useCallback((triggerId: string, surface: string, payload?: Record<string, unknown>) => {
    const now = new Date().toISOString();
    const day = todayKey();
    persist((current) => ({
      ...current,
      seen: current.seen.includes(triggerId) ? current.seen : [...current.seen, triggerId],
      shownAt: { ...current.shownAt, [triggerId]: now },
      shownByDay: { ...current.shownByDay, [day]: (current.shownByDay[day] ?? 0) + 1 },
    }));
    emit('guidance.shown', { guidanceId: triggerId, trigger: triggerId, surface, ...(payload ?? {}) });
  }, [emit, persist]);

  const dismiss = useCallback((triggerId: string, surface: string) => {
    const now = new Date().toISOString();
    persist((current) => ({
      ...current,
      dismissedAt: { ...current.dismissedAt, [triggerId]: now },
    }));
    emit('guidance.dismissed', { guidanceId: triggerId, trigger: triggerId, surface });
  }, [emit, persist]);

  const reportAccepted = useCallback((triggerId: string, action: string, surface: string) => {
    emit('guidance.accepted', { guidanceId: triggerId, trigger: triggerId, action, surface });
    emit('guidance.action_started', { guidanceId: triggerId, trigger: triggerId, action, surface });
  }, [emit]);

  const reportCompleted = useCallback((triggerId: string, action: string, outcome: string, surface: string) => {
    emit('guidance.action_completed', { guidanceId: triggerId, trigger: triggerId, action, surface, outcome });
    if (outcome === 'corrected') {
      emit('guidance.correction_success', { guidanceId: triggerId, trigger: triggerId, action, surface });
    }
  }, [emit]);

  const setMuted = useCallback((next: boolean) => {
    persist((current) => ({ ...current, muted: next }));
  }, [persist]);

  const acceptContract = useCallback(() => {
    persist((current) => ({ ...current, contractAccepted: true }));
    emit('guidance.accepted', { guidanceId: 'learning_contract', trigger: 'learning_contract', surface: 'home' });
  }, [emit, persist]);

  const deliveryState: GuidanceDeliveryState = useMemo(() => ({
    dismissedAt: state.dismissedAt,
    shownAt: state.shownAt,
    shownToday: state.shownByDay[todayKey()] ?? 0,
  }), [state]);

  const selectForSurface = useCallback(
    (candidates: readonly GuidanceCandidate[], _surface: string) => {
      if (state.muted) return [];
      return selectDeliverableGuidance(candidates, deliveryState, new Date().toISOString(), {
        perSurfaceCap: GUIDANCE_PER_SURFACE_CAP,
        dailyCap: GUIDANCE_DAILY_CAP,
      });
    },
    [deliveryState, state.muted],
  );

  return {
    hasSeen: (triggerId: string) => state.seen.includes(triggerId),
    markShown,
    dismiss,
    reportAccepted,
    reportCompleted,
    muted: state.muted,
    setMuted,
    contractAccepted: state.contractAccepted,
    acceptContract,
    selectForSurface,
  };
}

export { EMPTY_DELIVERY_STATE, cooldownForTrigger };
