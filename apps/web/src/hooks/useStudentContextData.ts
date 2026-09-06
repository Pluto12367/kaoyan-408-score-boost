import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchStudentContext, type StudentContext } from '../api';
import { isStaticDemoMode } from '../api/env';
import type { ModuleResource } from './moduleResource';

/**
 * Loads the canonical StudentContext read model without providing a mock
 * replacement. Legacy homepage data remains available while this resource is
 * loading or unavailable, and production errors stay visible to the caller.
 *
 * Concurrency contract: only the latest request may write state — a late
 * response (or late failure) from an older request is discarded. Switching
 * authKey invalidates every in-flight request and clears cross-account data
 * immediately; disabling the hook invalidates in-flight requests and manual
 * refresh becomes a no-op.
 */
export function useStudentContextData(enabled: boolean, authKey?: string) {
  const [context, setContext] = useState<ModuleResource<StudentContext>>({ data: null, state: 'loading' });
  const requestSeq = useRef(0);
  const dataAuthKey = useRef<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    if (isStaticDemoMode()) {
      setContext({ data: null, state: 'ready' });
      return;
    }
    if (!enabled) return;
    const requestId = requestSeq.current + 1;
    requestSeq.current = requestId;
    const accountChanged = dataAuthKey.current !== authKey;
    dataAuthKey.current = authKey;
    setContext(accountChanged
      ? { data: null, state: 'loading' }
      : (current) => ({ ...current, state: 'loading', error: undefined }));
    try {
      const data = await fetchStudentContext();
      if (requestId !== requestSeq.current) return;
      setContext({ data, state: 'ready', lastSyncAt: new Date().toISOString() });
    } catch (error) {
      if (requestId !== requestSeq.current) return;
      const message = error instanceof Error ? `学生状态摘要加载失败：${error.message}` : '学生状态摘要加载失败，请稍后重试。';
      setContext((current) => ({ ...current, state: 'error', error: message }));
    }
  }, [authKey, enabled]);

  useEffect(() => {
    if (!enabled) {
      requestSeq.current += 1;
      dataAuthKey.current = undefined;
      setContext({ data: null, state: 'loading' });
      return () => {
        requestSeq.current += 1;
      };
    }
    void refresh();
    return () => {
      requestSeq.current += 1;
    };
  }, [authKey, enabled, refresh]);

  // Render-time derivation: after an auth switch (or while disabled) the
  // previous account's data must not even be visible for the one paint before
  // the effect resets the stored state.
  const accountChanged = dataAuthKey.current !== authKey;
  const visibleContext: ModuleResource<StudentContext> = !enabled || accountChanged
    ? { data: null, state: 'loading' }
    : context;

  return { context: visibleContext, refresh };
}
