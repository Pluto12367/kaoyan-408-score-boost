import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPracticeSession,
  listActiveSessions,
  savePracticeProgress,
  startPracticeSession,
  submitPracticeSession,
  type SessionSubmitResult,
  type SessionView,
} from '../api/endpoints/sessions';

const SAVE_INTERVAL_MS = 8_000;
const SAVE_DEBOUNCE_MS = 600;
const SESSION_STORAGE_KEY = 'kaoyan408.current_session';

interface UsePracticeSessionOptions {
  type: 'practice_set' | 'stage_assessment' | 'paper';
  questionIds: string[];
  resourceId?: string;
  onSubmitted?: (result: SessionSubmitResult) => void;
}

interface SaveOptions {
  keepalive?: boolean;
  pauseClock?: boolean;
}

export function usePracticeSession(opts: UsePracticeSessionOptions) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);

  const sessionRef = useRef<SessionView | null>(null);
  const revisionRef = useRef(0);
  const mountedRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveInFlightRef = useRef<Promise<SessionView | null> | null>(null);
  const saveQueuedRef = useRef(false);
  const submittingRef = useRef(false);
  const clockSessionIdRef = useRef<string | null>(null);
  const activeBaseMsRef = useRef(0);
  const activeSegmentStartedAtRef = useRef<number | null>(null);
  const questionKey = opts.questionIds.join('\u0001');

  const currentActiveMs = useCallback(() => {
    const segmentStartedAt = activeSegmentStartedAtRef.current;
    const segmentMs = segmentStartedAt == null ? 0 : Math.max(0, monotonicNow() - segmentStartedAt);
    return Math.round(activeBaseMsRef.current + segmentMs);
  }, []);

  const rollActiveClock = useCallback((pause: boolean) => {
    activeBaseMsRef.current = currentActiveMs();
    activeSegmentStartedAtRef.current = pause || !pageIsVisible() ? null : monotonicNow();
    return activeBaseMsRef.current;
  }, [currentActiveMs]);

  const adoptSession = useCallback((next: SessionView) => {
    if (clockSessionIdRef.current !== next.id) {
      clockSessionIdRef.current = next.id;
      activeBaseMsRef.current = next.totalActiveMs;
      activeSegmentStartedAtRef.current = pageIsVisible() ? monotonicNow() : null;
    } else {
      activeBaseMsRef.current = Math.max(activeBaseMsRef.current, next.totalActiveMs);
    }
    sessionRef.current = next;
    if (mountedRef.current) setSession(next);
    if (typeof window !== 'undefined' && !next.completed) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, next.id);
    }
  }, []);

  const performSave = useCallback(async (options: SaveOptions = {}): Promise<SessionView | null> => {
    const current = sessionRef.current;
    if (!current || current.completed || submittingRef.current) return current;
    if (saveInFlightRef.current) {
      saveQueuedRef.current = true;
      return saveInFlightRef.current;
    }

    const revisionAtStart = revisionRef.current;
    const payload = {
      answers: { ...current.answers },
      currentIndex: current.currentIndex,
      markedQuestions: [...current.markedQuestions],
      totalActiveMs: rollActiveClock(Boolean(options.pauseClock)),
    };
    if (mountedRef.current) setSaving(true);

    const request = savePracticeProgress(current.id, payload, { keepalive: options.keepalive })
      .then((updated) => {
        const latest = sessionRef.current;
        const merged = latest && latest.id === updated.id && revisionRef.current !== revisionAtStart
          ? {
              ...updated,
              answers: latest.answers,
              currentIndex: latest.currentIndex,
              markedQuestions: latest.markedQuestions,
            }
          : updated;
        activeBaseMsRef.current = Math.max(activeBaseMsRef.current, updated.totalActiveMs);
        sessionRef.current = merged;
        if (mountedRef.current) {
          setSession(merged);
          setSaveError(null);
          setLastSavedAt(new Date().toISOString());
        }
        return merged;
      })
      .catch((saveFailure: unknown) => {
        if (mountedRef.current) {
          setSaveError(saveFailure instanceof Error ? saveFailure.message : '学习进度保存失败，请重试。');
        }
        throw saveFailure;
      })
      .finally(() => {
        saveInFlightRef.current = null;
        if (mountedRef.current) setSaving(false);
        if (saveQueuedRef.current && !submittingRef.current) {
          saveQueuedRef.current = false;
          queueMicrotask(() => { void performSave().catch(() => undefined); });
        }
      });

    saveInFlightRef.current = request;
    return request;
  }, [rollActiveClock]);

  const scheduleSave = useCallback(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null;
      void performSave().catch(() => undefined);
    }, SAVE_DEBOUNCE_MS);
  }, [performSave]);

  useEffect(() => {
    mountedRef.current = true;
    let active = true;

    async function initialize() {
      setError(null);
      const storedId = typeof window === 'undefined' ? null : window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (storedId) {
        try {
          const stored = await getPracticeSession(storedId);
          if (active && !stored.completed && sessionMatches(stored, opts.type, opts.resourceId, opts.questionIds)) {
            adoptSession(stored);
            return;
          }
        } catch {
          if (typeof window !== 'undefined') window.localStorage.removeItem(SESSION_STORAGE_KEY);
        }
      }

      try {
        const activeList = await listActiveSessions();
        const matching = activeList.sessions.find((candidate) =>
          sessionMatches(candidate, opts.type, opts.resourceId, opts.questionIds),
        );
        if (!active) return;
        if (matching) {
          adoptSession(matching);
          return;
        }
        const created = await startPracticeSession({
          type: opts.type,
          questionIds: opts.questionIds,
          resourceId: opts.resourceId,
        });
        if (active) adoptSession(created);
      } catch (initializationFailure) {
        if (active) {
          setError(initializationFailure instanceof Error ? initializationFailure.message : '学习会话加载失败，请重试。');
        }
      }
    }

    void initialize();
    return () => { active = false; };
  }, [adoptSession, opts.resourceId, opts.type, questionKey]);

  useEffect(() => {
    if (!session?.id || session.completed) return;
    saveTimerRef.current = setInterval(() => {
      void performSave().catch(() => undefined);
    }, SAVE_INTERVAL_MS);
    return () => {
      if (saveTimerRef.current) clearInterval(saveTimerRef.current);
      saveTimerRef.current = null;
    };
  }, [performSave, session?.completed, session?.id]);

  useEffect(() => {
    function onVisibilityChange() {
      if (document.hidden) {
        void performSave({ keepalive: true, pauseClock: true }).catch(() => undefined);
      } else if (activeSegmentStartedAtRef.current == null && !sessionRef.current?.completed) {
        activeSegmentStartedAtRef.current = monotonicNow();
      }
    }
    function onPageHide() {
      void performSave({ keepalive: true, pauseClock: true }).catch(() => undefined);
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [performSave]);

  useEffect(() => () => {
    mountedRef.current = false;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (saveTimerRef.current) clearInterval(saveTimerRef.current);
  }, []);

  const updateAnswer = useCallback((questionId: string, selectedAnswer: string, timeSpentSec: number, selfScore?: number, maxScore?: number) => {
    const current = sessionRef.current;
    if (!current || current.completed) return;
    const next = {
      ...current,
      answers: { ...current.answers, [questionId]: { selectedAnswer, timeSpentSec, selfScore, maxScore } },
    };
    revisionRef.current += 1;
    sessionRef.current = next;
    setSession(next);
    scheduleSave();
  }, [scheduleSave]);

  const setCurrentQuestion = useCallback((index: number) => {
    const current = sessionRef.current;
    if (!current || current.completed) return;
    const next = { ...current, currentIndex: index };
    revisionRef.current += 1;
    sessionRef.current = next;
    setSession(next);
    scheduleSave();
  }, [scheduleSave]);

  const toggleMark = useCallback((questionId: string) => {
    const current = sessionRef.current;
    if (!current || current.completed) return;
    const markedQuestions = current.markedQuestions.includes(questionId)
      ? current.markedQuestions.filter((id) => id !== questionId)
      : [...current.markedQuestions, questionId];
    const next = { ...current, markedQuestions };
    revisionRef.current += 1;
    sessionRef.current = next;
    setSession(next);
    scheduleSave();
  }, [scheduleSave]);

  const submitSession = useCallback(async (): Promise<SessionSubmitResult> => {
    const current = sessionRef.current;
    if (!current) throw new Error('No active session');
    if (submittingRef.current) throw new Error('Session submission is already in progress');
    submittingRef.current = true;
    setSubmitting(true);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    const answers = Object.entries(current.answers).map(([questionId, answer]) => ({
      questionId,
      selectedAnswer: answer.selectedAnswer,
      timeSpentSec: answer.timeSpentSec,
      selfScore: answer.selfScore,
      maxScore: answer.maxScore,
    }));

    try {
      const result = await submitPracticeSession(current.id, {
        answers,
        totalActiveMs: rollActiveClock(true),
      });
      const completed = { ...current, completed: true, totalActiveMs: result.totalActiveMs };
      sessionRef.current = completed;
      setSession(completed);
      setSaveError(null);
      if (typeof window !== 'undefined') window.localStorage.removeItem(SESSION_STORAGE_KEY);
      opts.onSubmitted?.(result);
      return result;
    } catch (submissionFailure) {
      if (pageIsVisible()) activeSegmentStartedAtRef.current = monotonicNow();
      setSaveError(submissionFailure instanceof Error ? submissionFailure.message : '提交失败，请重试。');
      throw submissionFailure;
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [opts.onSubmitted, rollActiveClock]);

  return {
    session,
    error,
    saveError,
    saving,
    submitting,
    lastSavedAt,
    updateAnswer,
    setCurrentQuestion,
    toggleMark,
    saveNow: performSave,
    submitSession,
    getActiveElapsedMs: currentActiveMs,
  };
}

function sessionMatches(
  session: SessionView,
  type: SessionView['type'],
  resourceId: string | undefined,
  questionIds: string[],
) {
  return session.type === type
    && session.resourceId === resourceId
    && session.questionIds.length === questionIds.length
    && session.questionIds.every((questionId, index) => questionId === questionIds[index]);
}

function pageIsVisible() {
  return typeof document === 'undefined' || !document.hidden;
}

function monotonicNow() {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
