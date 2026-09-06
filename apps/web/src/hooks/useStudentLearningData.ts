import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import {
  createMockAssessmentHistory,
  createMockPracticeSet,
  createMockReviewResourceRecommendations,
  createMockWrongQuestionSummary,
  fetchAssessmentHistory,
  fetchRecommendedPracticeSet,
  fetchReviewResourceRecommendations,
  fetchWrongQuestionSummary,
  type AssessmentHistory,
  type PracticeSet,
  type ReviewResourceRecommendation,
  type WrongQuestionSummary,
} from '../api';
import { isMockAllowed, isStaticDemoMode } from '../api/env';
import type { ModuleResource } from './moduleResource';

function initialResource<T>(mockFactory: () => T): ModuleResource<T> {
  return isStaticDemoMode()
    ? { data: mockFactory(), state: 'mock' }
    : { data: null, state: 'loading' };
}

function errorMessage(error: unknown, label: string) {
  return error instanceof Error ? `${label}加载失败：${error.message}` : `${label}加载失败，请稍后重试。`;
}

export function useStudentLearningData(enabled: boolean, authKey?: string) {
  const [practiceSet, setPracticeSet] = useState(() => initialResource(createMockPracticeSet));
  const [reviewResources, setReviewResources] = useState(() => initialResource(createMockReviewResourceRecommendations));
  const [wrongQuestionSummary, setWrongQuestionSummary] = useState(() => initialResource(createMockWrongQuestionSummary));
  const [assessmentHistory, setAssessmentHistory] = useState(() => initialResource(createMockAssessmentHistory));

  const loadResource = useCallback(async <T,>(
    label: string,
    loader: () => Promise<T>,
    mockFactory: () => T,
    setter: Dispatch<SetStateAction<ModuleResource<T>>>,
  ) => {
    if (isStaticDemoMode()) {
      setter((current) => current.data ? current : { data: mockFactory(), state: 'mock' });
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

  const refreshPracticeSet = useCallback(
    (minutesBudget?: number) => loadResource('推荐题组', () => fetchRecommendedPracticeSet(minutesBudget), createMockPracticeSet, setPracticeSet),
    [loadResource],
  );
  const refreshReviewResources = useCallback(
    () => loadResource('复习资源', fetchReviewResourceRecommendations, createMockReviewResourceRecommendations, setReviewResources),
    [loadResource],
  );
  const refreshWrongQuestionSummary = useCallback(
    () => loadResource('错题摘要', fetchWrongQuestionSummary, createMockWrongQuestionSummary, setWrongQuestionSummary),
    [loadResource],
  );
  const refreshAssessmentHistory = useCallback(
    () => loadResource('测评历史', fetchAssessmentHistory, createMockAssessmentHistory, setAssessmentHistory),
    [loadResource],
  );

  const refreshAll = useCallback(async () => {
    if (!enabled) return;
    await Promise.allSettled([
      refreshPracticeSet(),
      refreshReviewResources(),
      refreshWrongQuestionSummary(),
      refreshAssessmentHistory(),
    ]);
  }, [authKey, enabled, refreshAssessmentHistory, refreshPracticeSet, refreshReviewResources, refreshWrongQuestionSummary]);

  useEffect(() => {
    if (!enabled) {
      if (!isMockAllowed()) {
        setPracticeSet({ data: null, state: 'loading' });
        setReviewResources({ data: null, state: 'loading' });
        setWrongQuestionSummary({ data: null, state: 'loading' });
        setAssessmentHistory({ data: null, state: 'loading' });
      }
      return;
    }
    if (!isMockAllowed()) {
      setPracticeSet({ data: null, state: 'loading' });
      setReviewResources({ data: null, state: 'loading' });
      setWrongQuestionSummary({ data: null, state: 'loading' });
      setAssessmentHistory({ data: null, state: 'loading' });
    }
    void refreshAll();
  }, [authKey, enabled, refreshAll]);

  const updateAssessmentHistory = useCallback((updater: (history: AssessmentHistory) => AssessmentHistory) => {
    setAssessmentHistory((current) => current.data
      ? { ...current, data: updater(current.data) }
      : current);
  }, []);

  return {
    practiceSet,
    reviewResources,
    wrongQuestionSummary,
    assessmentHistory,
    refreshPracticeSet,
    refreshReviewResources,
    refreshWrongQuestionSummary,
    refreshAssessmentHistory,
    updateAssessmentHistory,
  };
}
