import { useCallback, useEffect, useReducer, useRef } from 'react';
import { gradePracticeSessionAnswers, type SessionGradingQuestion } from '@kaoyan408/shared';
import {
  getPracticeSession,
  listActiveSessions,
  savePracticeProgress,
  startPracticeSession,
  submitPracticeSession,
  type SessionSubmitResult,
  type SessionView,
} from '../api/endpoints/sessions';
import { shouldQueueSessionSave } from '../studentSessionPolicy';

const SAVE_INTERVAL_MS = 8_000;
const SAVE_DEBOUNCE_MS = 600;
const SESSION_STORAGE_KEY = 'kaoyan408.current_session';

interface UsePracticeSessionOptions {
  type: 'practice_set' | 'stage_assessment' | 'paper';
  questionIds: string[];
  resourceId?: string;
  localMode?: boolean;
  localQuestions?: SessionGradingQuestion[];
  onSubmitted?: (result: SessionSubmitResult) => void;
}

interface SaveOptions {
  keepalive?: boolean;
  pauseClock?: boolean;
}

interface PracticeSessionState {
  session: SessionView | null;
  error: string | null;
  saveError: string | null;
  saving: boolean;
  submitting: boolean;
  lastSavedAt: string | null;
}

type PracticeSessionAction = {
  type: 'patch';
  value: Partial<PracticeSessionState>;
};

const initialPracticeSessionState: PracticeSessionState = {
  session: null,
  error: null,
  saveError: null,
  saving: false,
  submitting: false,
  lastSavedAt: null,
};

export function practiceSessionReducer(state: PracticeSessionState, action: PracticeSessionAction): PracticeSessionState {
  if (action.type === 'patch') return { ...state, ...action.value };
  return state;
}

export function usePracticeSession(opts: UsePracticeSessionOptions) {
  const [state, dispatch] = useReducer(practiceSessionReducer, initialPracticeSessionState);
  const { session, error, saveError, saving, submitting, lastSavedAt } = state;

  const sessionRef = useRef<SessionView | null>(null);
  const revisionRef = useRef(0);
  const saveRevisionRef = useRef(0);
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
      saveRevisionRef.current = next.revision;
      activeBaseMsRef.current = next.totalActiveMs;
      activeSegmentStartedAtRef.current = pageIsVisible() ? monotonicNow() : null;
    } else {
      activeBaseMsRef.current = Math.max(activeBaseMsRef.current, next.totalActiveMs);
      saveRevisionRef.current = Math.max(saveRevisionRef.current, next.revision);
    }
    sessionRef.current = next;
    if (mountedRef.current) dispatch({ type: 'patch', value: { session: next, error: null } });
    if (typeof window !== 'undefined' && !next.completed) {
      window.localStorage.setItem(SESSION_STORAGE_KEY, next.id);
    }
  }, []);

  const performSave = useCallback(async (options: SaveOptions = {}): Promise<SessionView | null> => {
    const current = sessionRef.current;
    if (!current || current.completed || submittingRef.current) return current;
    const saveRevision = saveRevisionRef.current + 1;
    saveRevisionRef.current = saveRevision;
    if (opts.localMode) {
      const updated = updateSessionSummary({
        ...current,
        revision: saveRevision,
        totalActiveMs: rollActiveClock(Boolean(options.pauseClock)),
        lastActiveAt: new Date().toISOString(),
      });
      sessionRef.current = updated;
      persistLocalSession(updated);
      if (mountedRef.current) {
        dispatch({ type: 'patch', value: { session: updated, saveError: null, lastSavedAt: updated.lastActiveAt } });
      }
      return updated;
    }
    const hasInFlightSave = Boolean(saveInFlightRef.current);
    if (shouldQueueSessionSave(hasInFlightSave, Boolean(options.keepalive))) {
      saveQueuedRef.current = true;
      return saveInFlightRef.current;
    }

    const revisionAtStart = revisionRef.current;
    const payload = {
      revision: saveRevision,
      answers: { ...current.answers },
      currentIndex: current.currentIndex,
      markedQuestions: [...current.markedQuestions],
      totalActiveMs: rollActiveClock(Boolean(options.pauseClock)),
    };
    const trackRequest = !hasInFlightSave;
    if (trackRequest && mountedRef.current) dispatch({ type: 'patch', value: { saving: true } });

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
        saveRevisionRef.current = Math.max(saveRevisionRef.current, updated.revision);
        sessionRef.current = merged;
        if (mountedRef.current) {
          dispatch({
            type: 'patch',
            value: { session: merged, saveError: null, lastSavedAt: new Date().toISOString() },
          });
        }
        return merged;
      })
      .catch((saveFailure: unknown) => {
        if (mountedRef.current) {
          dispatch({
            type: 'patch',
            value: { saveError: saveFailure instanceof Error ? saveFailure.message : '学习进度保存失败，请重试。' },
          });
        }
        throw saveFailure;
      });
    if (!trackRequest) return request;

    const trackedRequest = request.finally(() => {
      saveInFlightRef.current = null;
      if (mountedRef.current) dispatch({ type: 'patch', value: { saving: false } });
      if (saveQueuedRef.current && !submittingRef.current) {
        saveQueuedRef.current = false;
        queueMicrotask(() => { void performSave().catch(() => undefined); });
      }
    });

    saveInFlightRef.current = trackedRequest;
    return trackedRequest;
  }, [opts.localMode, rollActiveClock]);

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
      dispatch({ type: 'patch', value: { error: null } });
      const storedId = typeof window === 'undefined' ? null : window.localStorage.getItem(SESSION_STORAGE_KEY);
      if (opts.localMode) {
        const stored = storedId ? loadLocalSession(storedId) : null;
        if (stored && !stored.completed && sessionMatches(stored, opts.type, opts.resourceId, opts.questionIds)) {
          adoptSession(stored);
          return;
        }
        const created = createLocalSession(opts.type, opts.questionIds, opts.resourceId);
        persistLocalSession(created);
        if (active) adoptSession(created);
        return;
      }
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
          dispatch({
            type: 'patch',
            value: { error: initializationFailure instanceof Error ? initializationFailure.message : '学习会话加载失败，请重试。' },
          });
        }
      }
    }

    void initialize();
    return () => { active = false; };
  }, [adoptSession, opts.localMode, opts.resourceId, opts.type, questionKey]);

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
    dispatch({ type: 'patch', value: { session: next } });
    scheduleSave();
  }, [scheduleSave]);

  const setCurrentQuestion = useCallback((index: number) => {
    const current = sessionRef.current;
    if (!current || current.completed) return;
    const next = { ...current, currentIndex: index };
    revisionRef.current += 1;
    sessionRef.current = next;
    dispatch({ type: 'patch', value: { session: next } });
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
    dispatch({ type: 'patch', value: { session: next } });
    scheduleSave();
  }, [scheduleSave]);

  const submitSession = useCallback(async (): Promise<SessionSubmitResult> => {
    const current = sessionRef.current;
    if (!current) throw new Error('No active session');
    if (submittingRef.current) throw new Error('Session submission is already in progress');
    submittingRef.current = true;
    dispatch({ type: 'patch', value: { submitting: true, saveError: null } });
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    const answers = Object.entries(current.answers).map(([questionId, answer]) => ({
      questionId,
      selectedAnswer: answer.selectedAnswer,
      timeSpentSec: answer.timeSpentSec,
      selfScore: answer.selfScore,
      maxScore: answer.maxScore,
    }));

    try {
      if (opts.localMode) {
        const totalActiveMs = rollActiveClock(true);
        const grading = gradePracticeSessionAnswers({
          questions: opts.localQuestions ?? opts.questionIds.map((id) => ({ id, answer: '' })),
          answers: current.answers,
        });
        const completed = updateSessionSummary({ ...current, completed: true, totalActiveMs });
        const result: SessionSubmitResult = {
          sessionId: current.id,
          completed: true,
          totalQuestions: current.totalQuestions,
          correctCount: grading.correctCount,
          accuracyRate: grading.accuracyRate,
          totalActiveMs,
          records: grading.records,
        };
        sessionRef.current = completed;
        removeLocalSession(current.id);
        dispatch({ type: 'patch', value: { session: completed, saveError: null } });
        if (typeof window !== 'undefined') window.localStorage.removeItem(SESSION_STORAGE_KEY);
        opts.onSubmitted?.(result);
        return result;
      }
      const result = await submitPracticeSession(current.id, {
        answers,
        totalActiveMs: rollActiveClock(true),
      });
      const completed = { ...current, completed: true, totalActiveMs: result.totalActiveMs };
      sessionRef.current = completed;
      dispatch({ type: 'patch', value: { session: completed, saveError: null } });
      if (typeof window !== 'undefined') window.localStorage.removeItem(SESSION_STORAGE_KEY);
      opts.onSubmitted?.(result);
      return result;
    } catch (submissionFailure) {
      if (pageIsVisible()) activeSegmentStartedAtRef.current = monotonicNow();
      dispatch({
        type: 'patch',
        value: { saveError: submissionFailure instanceof Error ? submissionFailure.message : '提交失败，请重试。' },
      });
      throw submissionFailure;
    } finally {
      submittingRef.current = false;
      dispatch({ type: 'patch', value: { submitting: false } });
    }
  }, [opts.localMode, opts.localQuestions, opts.onSubmitted, opts.questionIds, rollActiveClock]);

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

function createLocalSession(type: SessionView['type'], questionIds: string[], resourceId?: string): SessionView {
  const now = new Date().toISOString();
  return {
    id: `demo-${type}-${Date.now()}`,
    type,
    resourceId,
    questionIds,
    answers: {},
    markedQuestions: [],
    currentIndex: 0,
    revision: 0,
    totalQuestions: questionIds.length,
    answeredCount: 0,
    startedAt: now,
    lastActiveAt: now,
    totalActiveMs: 0,
    completed: false,
    progressRate: 0,
  };
}

function updateSessionSummary(session: SessionView): SessionView {
  const answeredCount = session.questionIds.filter((id) => Boolean(session.answers[id]?.selectedAnswer.trim())).length;
  return {
    ...session,
    answeredCount,
    progressRate: session.totalQuestions === 0 ? 0 : Math.round((answeredCount / session.totalQuestions) * 100),
  };
}

function localSessionKey(sessionId: string) {
  return `kaoyan408.demo.session.${sessionId}`;
}

function persistLocalSession(session: SessionView) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(localSessionKey(session.id), JSON.stringify(session));
}

function loadLocalSession(sessionId: string): SessionView | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(localSessionKey(sessionId));
    return value ? JSON.parse(value) as SessionView : null;
  } catch {
    return null;
  }
}

function removeLocalSession(sessionId: string) {
  if (typeof window !== 'undefined') window.localStorage.removeItem(localSessionKey(sessionId));
}
