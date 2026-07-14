import { useCallback, useEffect, useState, type SetStateAction } from 'react';
import { createMockOverview, fetchDashboardOverview, type DashboardOverview } from '../api';
import { isMockAllowed, isStaticDemoMode } from '../api/env';
import type { ModuleResource } from './moduleResource';

function initialOverview(): ModuleResource<DashboardOverview> {
  return isStaticDemoMode()
    ? { data: createMockOverview(), state: 'mock' }
    : { data: null, state: 'loading' };
}

export function useDashboardOverviewData(enabled: boolean, authKey?: string) {
  const [overview, setOverviewResource] = useState<ModuleResource<DashboardOverview>>(initialOverview);

  const refreshOverview = useCallback(async () => {
    if (isStaticDemoMode()) {
      setOverviewResource((current) => current.data ? current : { data: createMockOverview(), state: 'mock' });
      return;
    }

    setOverviewResource((current) => ({ ...current, state: 'loading', error: undefined }));
    try {
      const data = await fetchDashboardOverview();
      setOverviewResource({ data, state: 'ready', lastSyncAt: new Date().toISOString() });
    } catch (error) {
      const message = error instanceof Error ? `学习概览加载失败：${error.message}` : '学习概览加载失败，请稍后重试。';
      if (isMockAllowed()) {
        setOverviewResource({ data: createMockOverview(), state: 'mock', error: message });
      } else {
        setOverviewResource((current) => ({ ...current, state: 'error', error: message }));
      }
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      if (!isMockAllowed()) setOverviewResource({ data: null, state: 'loading' });
      return;
    }
    if (!isMockAllowed()) setOverviewResource({ data: null, state: 'loading' });
    void refreshOverview();
  }, [authKey, enabled, refreshOverview]);

  const setOverview = useCallback((action: SetStateAction<DashboardOverview>) => {
    setOverviewResource((current) => {
      const base = current.data ?? createMockOverview();
      const data = typeof action === 'function' ? action(base) : action;
      return {
        data,
        state: current.state === 'mock' ? 'mock' : 'ready',
        lastSyncAt: current.state === 'mock' ? current.lastSyncAt : new Date().toISOString(),
      };
    });
  }, []);

  return { overview, refreshOverview, setOverview };
}
