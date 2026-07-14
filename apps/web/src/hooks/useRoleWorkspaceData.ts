import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  createMockAdminMetrics,
  createMockAdminUserManagement,
  createMockFeedbackList,
  createMockOverview,
  createMockReviewQueue,
  createMockSystemConfig,
  createMockTeacherClassAnalytics,
  fetchAdminMetrics,
  fetchAdminUsers,
  fetchFeedbackList,
  fetchQuestions,
  fetchReviewQueue,
  fetchSystemConfig,
  fetchTeacherClassAnalytics,
  type AdminMetrics,
  type AdminUserManagement,
  type FeedbackList,
  type Question,
  type ReviewQueue,
  type SystemConfig,
  type TeacherClassAnalytics,
} from '../api';
import { isMockAllowed, isStaticDemoMode } from '../api/env';
import type { UserRole } from '@kaoyan408/shared';
import type { ModuleResource } from './moduleResource';

function initialResource<T>(mockFactory: () => T): ModuleResource<T> {
  return isStaticDemoMode()
    ? { data: mockFactory(), state: 'mock' }
    : { data: null, state: 'loading' };
}

function errorMessage(error: unknown, label: string) {
  return error instanceof Error ? `${label}加载失败：${error.message}` : `${label}加载失败，请稍后重试。`;
}

function updateResourceData<T>(
  setter: Dispatch<SetStateAction<ModuleResource<T>>>,
  action: SetStateAction<T>,
) {
  setter((current) => {
    if (!current.data) return current;
    return {
      ...current,
      data: typeof action === 'function'
        ? (action as (value: T) => T)(current.data)
        : action,
      lastSyncAt: current.state === 'ready' ? new Date().toISOString() : current.lastSyncAt,
    };
  });
}

export function useRoleWorkspaceData(role?: UserRole, authKey?: string) {
  const [questions, setQuestions] = useState(() => initialResource<Question[]>(() => createMockOverview().questions));
  const [classAnalytics, setClassAnalytics] = useState(() => initialResource(createMockTeacherClassAnalytics));
  const [adminMetrics, setAdminMetrics] = useState(() => initialResource(createMockAdminMetrics));
  const [adminUsers, setAdminUsers] = useState(() => initialResource(createMockAdminUserManagement));
  const [reviewQueue, setReviewQueue] = useState(() => initialResource(createMockReviewQueue));
  const [systemConfig, setSystemConfig] = useState(() => initialResource(createMockSystemConfig));
  const [feedback, setFeedback] = useState(() => initialResource(createMockFeedbackList));

  const loadResource = useCallback(async <T,>(
    label: string,
    request: () => Promise<T>,
    mockFactory: () => T,
    setter: Dispatch<SetStateAction<ModuleResource<T>>>,
  ) => {
    if (isStaticDemoMode()) {
      setter((current) => current.data ? current : { data: mockFactory(), state: 'mock' });
      return;
    }

    setter((current) => ({ ...current, state: 'loading', error: undefined }));
    try {
      const data = await request();
      setter({ data, state: 'ready', lastSyncAt: new Date().toISOString() });
    } catch (error) {
      const message = errorMessage(error, label);
      if (isMockAllowed()) {
        setter({ data: mockFactory(), state: 'mock', error: message });
      } else {
        setter((current) => ({ ...current, state: 'error', error: message }));
      }
    }
  }, []);

  const refreshQuestions = useCallback(
    () => loadResource('题库', fetchQuestions, () => createMockOverview().questions, setQuestions),
    [loadResource],
  );
  const refreshClassAnalytics = useCallback(
    () => loadResource('班级学情', fetchTeacherClassAnalytics, createMockTeacherClassAnalytics, setClassAnalytics),
    [loadResource],
  );
  const refreshAdminMetrics = useCallback(
    () => loadResource('运营指标', fetchAdminMetrics, createMockAdminMetrics, setAdminMetrics),
    [loadResource],
  );
  const refreshAdminUsers = useCallback(
    () => loadResource('用户管理', fetchAdminUsers, createMockAdminUserManagement, setAdminUsers),
    [loadResource],
  );
  const refreshReviewQueue = useCallback(
    () => loadResource('审核队列', fetchReviewQueue, createMockReviewQueue, setReviewQueue),
    [loadResource],
  );
  const refreshSystemConfig = useCallback(
    () => loadResource('系统配置', fetchSystemConfig, createMockSystemConfig, setSystemConfig),
    [loadResource],
  );
  const refreshFeedback = useCallback(
    () => loadResource('内测反馈', fetchFeedbackList, createMockFeedbackList, setFeedback),
    [loadResource],
  );

  useEffect(() => {
    if (role === 'teacher') {
      if (!isMockAllowed()) {
        setQuestions({ data: null, state: 'loading' });
        setClassAnalytics({ data: null, state: 'loading' });
      }
      void Promise.allSettled([refreshQuestions(), refreshClassAnalytics()]);
    } else if (role === 'admin') {
      if (!isMockAllowed()) {
        setAdminMetrics({ data: null, state: 'loading' });
        setAdminUsers({ data: null, state: 'loading' });
        setReviewQueue({ data: null, state: 'loading' });
        setSystemConfig({ data: null, state: 'loading' });
        setFeedback({ data: null, state: 'loading' });
      }
      void Promise.allSettled([
        refreshAdminMetrics(),
        refreshAdminUsers(),
        refreshReviewQueue(),
        refreshSystemConfig(),
        refreshFeedback(),
      ]);
    }
  }, [authKey, role, refreshAdminMetrics, refreshAdminUsers, refreshClassAnalytics, refreshFeedback, refreshQuestions, refreshReviewQueue, refreshSystemConfig]);

  return {
    questions,
    classAnalytics,
    adminMetrics,
    adminUsers,
    reviewQueue,
    systemConfig,
    feedback,
    refreshQuestions,
    refreshClassAnalytics,
    refreshAdminMetrics,
    refreshAdminUsers,
    refreshReviewQueue,
    refreshSystemConfig,
    refreshFeedback,
    setQuestions: (action: SetStateAction<Question[]>) => updateResourceData(setQuestions, action),
    setAdminMetrics: (action: SetStateAction<AdminMetrics>) => updateResourceData(setAdminMetrics, action),
    setAdminUsers: (action: SetStateAction<AdminUserManagement>) => updateResourceData(setAdminUsers, action),
    setReviewQueue: (action: SetStateAction<ReviewQueue>) => updateResourceData(setReviewQueue, action),
    setSystemConfig: (action: SetStateAction<SystemConfig>) => updateResourceData(setSystemConfig, action),
    setFeedback: (action: SetStateAction<FeedbackList>) => updateResourceData(setFeedback, action),
  };
}
