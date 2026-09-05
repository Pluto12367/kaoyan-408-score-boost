import { useCallback, useEffect, useState } from 'react';
import { fetchStudentContext, type StudentContext } from '../api';
import { isStaticDemoMode } from '../api/env';
import type { ModuleResource } from './moduleResource';

/**
 * Loads the canonical StudentContext read model without providing a mock
 * replacement. Legacy homepage data remains available while this resource is
 * loading or unavailable, and production errors stay visible to the caller.
 */
export function useStudentContextData(enabled: boolean, authKey?: string) {
  const [context, setContext] = useState<ModuleResource<StudentContext>>({ data: null, state: 'loading' });

  const refresh = useCallback(async () => {
    if (isStaticDemoMode()) {
      setContext({ data: null, state: 'ready' });
      return;
    }
    setContext((current) => ({ ...current, state: 'loading', error: undefined }));
    try {
      setContext({ data: await fetchStudentContext(), state: 'ready', lastSyncAt: new Date().toISOString() });
    } catch (error) {
      const message = error instanceof Error ? `学生状态摘要加载失败：${error.message}` : '学生状态摘要加载失败，请稍后重试。';
      setContext((current) => ({ ...current, state: 'error', error: message }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setContext({ data: null, state: 'loading' });
      return;
    }
    void refresh();
  }, [authKey, enabled, refresh]);

  return { context, refresh };
}

