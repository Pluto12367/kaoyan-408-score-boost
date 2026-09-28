import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';
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

/**
 * V14 体验批次 B（D3/O-1）：stale-while-revalidate 判定。
 * data 存在且 lastSyncAt 距今 < swrMs → 可直接复用（秒开，不置 loading）。
 * Pure: 确定性，便于单测。
 */
export function isCacheFresh(lastSyncAt: string | undefined, now: number, swrMs: number): boolean {
  if (!lastSyncAt || swrMs <= 0) return false;
  const at = new Date(lastSyncAt).getTime();
  if (!Number.isFinite(at)) return false;
  return now - at < swrMs;
}

export function useStudentLearningData(enabled: boolean, authKey?: string) {
  const [practiceSet, setPracticeSet] = useState(() => initialResource(createMockPracticeSet));
  const [reviewResources, setReviewResources] = useState(() => initialResource(createMockReviewResourceRecommendations));
  const [wrongQuestionSummary, setWrongQuestionSummary] = useState(() => initialResource(createMockWrongQuestionSummary));
  const [assessmentHistory, setAssessmentHistory] = useState(() => initialResource(createMockAssessmentHistory));
  // D3：各资源最近成功同步时刻（用于 SWR 新鲜度判定；跨渲染可读）。
  const lastSyncRef = useRef(new Map<string, string>());

  const loadResource = useCallback(async <T,>(
    label: string,
    loader: () => Promise<T>,
    mockFactory: () => T,
    setter: Dispatch<SetStateAction<ModuleResource<T>>>,
    options?: { swrMs?: number },
  ) => {
    if (isStaticDemoMode()) {
      setter((current) => current.data ? current : { data: mockFactory(), state: 'mock' });
      return;
    }
    // D3：缓存新鲜 → 直接复用（不置 loading、不重新请求）；过期但有 data → 后台静默刷新
    //（不闪 loading，失败保留旧数据）；无 data → 原路径（loading → ready/error）。
    const swrMs = options?.swrMs ?? 0;
    if (isCacheFresh(lastSyncRef.current.get(label), Date.now(), swrMs)) return;

    setter((current) => {
      // 有旧数据：后台静默刷新（保持 ready，不闪 loading）。
      if (current.data != null) return { ...current, state: 'ready', error: undefined };
      return { ...current, state: 'loading', error: undefined };
    });
    try {
      const data = await loader();
      lastSyncRef.current.set(label, new Date().toISOString());
      setter({ data, state: 'ready', lastSyncAt: new Date().toISOString() });
    } catch (error) {
      // D3：后台静默刷新失败时保留旧数据（不置 error——数据仍可用）；仅无 data 时才报错。
      setter((current) => current.data
        ? { ...current, state: 'ready', error: undefined }
        : (() => {
          if (isMockAllowed()) {
            return { data: mockFactory(), state: 'mock', error: errorMessage(error, label) };
          }
          return { data: null, state: 'error', error: errorMessage(error, label) };
        })());
    }
  }, []);

  const refreshPracticeSet = useCallback(
    (minutesBudget?: number, mode?: string) => loadResource('推荐题组', () => fetchRecommendedPracticeSet(minutesBudget, mode), createMockPracticeSet, setPracticeSet),
    [loadResource],
  );
  const refreshReviewResources = useCallback(
    () => loadResource('复习资源', fetchReviewResourceRecommendations, createMockReviewResourceRecommendations, setReviewResources, { swrMs: 60_000 }),
    [loadResource],
  );
  const refreshWrongQuestionSummary = useCallback(
    () => loadResource('错题摘要', fetchWrongQuestionSummary, createMockWrongQuestionSummary, setWrongQuestionSummary, { swrMs: 30_000 }),
    [loadResource],
  );
  const refreshAssessmentHistory = useCallback(
    () => loadResource('测评历史', fetchAssessmentHistory, createMockAssessmentHistory, setAssessmentHistory, { swrMs: 120_000 }),
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
