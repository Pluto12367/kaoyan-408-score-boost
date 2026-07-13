import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  createMockLearningProfile,
  createMockMasteryMap,
  createMockStudyReminders,
  createMockSprintPlan,
  createMockTrialProgress,
  fetchLearningProfile,
  fetchMasteryMap,
  fetchStudyReminders,
  fetchSprintPlan,
  fetchTrialProgress,
  type LearningProfile,
  type MasteryMap,
  type StudyReminders,
  type SprintPlan,
  type TrialProgress,
} from '../api';
import { isMockAllowed, isStaticDemoMode } from '../api/env';

export type ModuleLoadState = 'loading' | 'ready' | 'mock' | 'error';

export interface ModuleResource<T> {
  data: T | null;
  state: ModuleLoadState;
  lastSyncAt?: string;
  error?: string;
}

function initialResource<T>(mockFactory: () => T): ModuleResource<T> {
  if (isStaticDemoMode()) {
    return { data: mockFactory(), state: 'mock' };
  }
  return { data: null, state: 'loading' };
}

function errorMessage(error: unknown, label: string) {
  return error instanceof Error ? `${label}加载失败：${error.message}` : `${label}加载失败，请稍后重试。`;
}

export function useStudentProgressData(userId: string, enabled: boolean) {
  const [trialProgress, setTrialProgress] = useState(() => initialResource(createMockTrialProgress));
  const [studyReminders, setStudyReminders] = useState(() => initialResource(createMockStudyReminders));
  const [sprintPlan, setSprintPlan] = useState(() => initialResource(createMockSprintPlan));
  const [masteryMap, setMasteryMap] = useState(() => initialResource(createMockMasteryMap));
  const [learningProfile, setLearningProfile] = useState(() => initialResource(createMockLearningProfile));

  const loadResource = useCallback(async <T,>(
    label: string,
    loader: () => Promise<T>,
    mockFactory: () => T,
    setter: Dispatch<SetStateAction<ModuleResource<T>>>,
  ) => {
    if (isStaticDemoMode()) {
      setter({ data: mockFactory(), state: 'mock' });
      return;
    }

    setter((current) => ({ ...current, state: 'loading', error: undefined }));
    try {
      const data = await loader();
      setter({ data, state: 'ready', lastSyncAt: new Date().toISOString() });
    } catch (error) {
      if (isMockAllowed()) {
        setter({ data: mockFactory(), state: 'mock', error: errorMessage(error, label) });
      } else {
        setter((current) => ({ ...current, state: 'error', error: errorMessage(error, label) }));
      }
    }
  }, []);

  const refreshTrialProgress = useCallback(
    () => loadResource('试用进度', fetchTrialProgress, createMockTrialProgress, setTrialProgress),
    [loadResource],
  );
  const refreshStudyReminders = useCallback(
    () => loadResource('学习提醒', fetchStudyReminders, createMockStudyReminders, setStudyReminders),
    [loadResource],
  );
  const refreshSprintPlan = useCallback(
    () => loadResource('冲刺计划', fetchSprintPlan, createMockSprintPlan, setSprintPlan),
    [loadResource],
  );
  const refreshMasteryMap = useCallback(
    () => loadResource('掌握度地图', fetchMasteryMap, createMockMasteryMap, setMasteryMap),
    [loadResource],
  );
  const refreshLearningProfile = useCallback(
    () => loadResource('学习档案', () => fetchLearningProfile(userId), createMockLearningProfile, setLearningProfile),
    [loadResource, userId],
  );

  const refreshAll = useCallback(async () => {
    if (!enabled) return;
    await Promise.allSettled([
      refreshTrialProgress(),
      refreshStudyReminders(),
      refreshSprintPlan(),
      refreshMasteryMap(),
      refreshLearningProfile(),
    ]);
  }, [enabled, refreshLearningProfile, refreshMasteryMap, refreshSprintPlan, refreshStudyReminders, refreshTrialProgress]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  return {
    trialProgress,
    studyReminders,
    sprintPlan,
    masteryMap,
    learningProfile,
    refreshTrialProgress,
    refreshStudyReminders,
    refreshSprintPlan,
    refreshMasteryMap,
    refreshLearningProfile,
    refreshAll,
  };
}
