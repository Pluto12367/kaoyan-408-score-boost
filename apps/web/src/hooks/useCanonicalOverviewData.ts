import { useCallback, useEffect, useState } from 'react';
import { fetchCanonicalOverview, type CanonicalOverview } from '../api';
import { isStaticDemoMode } from '../api/env';
import type { ModuleResource } from './moduleResource';

export function useCanonicalOverviewData(enabled: boolean, authKey?: string) {
  const [overview, setOverview] = useState<ModuleResource<CanonicalOverview>>({ data: null, state: 'loading' });
  const refresh = useCallback(async () => {
    if (isStaticDemoMode()) {
      setOverview({ data: null, state: 'ready' });
      return;
    }
    setOverview((current) => ({ ...current, state: 'loading', error: undefined }));
    try {
      setOverview({ data: await fetchCanonicalOverview(), state: 'ready', lastSyncAt: new Date().toISOString() });
    } catch (error) {
      const message = error instanceof Error ? `新版学习总览加载失败：${error.message}` : '新版学习总览加载失败，请稍后重试。';
      setOverview((current) => ({ ...current, state: 'error', error: message }));
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setOverview({ data: null, state: 'loading' });
      return;
    }
    void refresh();
  }, [authKey, enabled, refresh]);

  return { overview, refresh };
}
