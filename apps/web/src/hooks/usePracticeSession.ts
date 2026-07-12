import { useState, useEffect, useRef, useCallback } from 'react';
import { startPracticeSession, savePracticeProgress, getPracticeSession, listActiveSessions, submitPracticeSession, type SessionView, type SessionSubmitResult } from '../api/endpoints/sessions';

const SAVE_INTERVAL_MS = 8000; // Auto-save every 8 seconds
const IDLE_THRESHOLD_MS = 30_000; // 30 seconds of inactivity = idle
const SESSION_STORAGE_KEY = 'kaoyan408.current_session';

interface UsePracticeSessionOptions {
  type: 'practice_set' | 'stage_assessment' | 'paper';
  questionIds: string[];
  resourceId?: string;
  onSubmitted?: (result: SessionSubmitResult) => void;
}

export function usePracticeSession(opts: UsePracticeSessionOptions) {
  const [session, setSession] = useState<SessionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const sessionRef = useRef(session);
  const idleSinceRef = useRef<number | null>(null);
  const lastActivityRef = useRef(Date.now());
  const saveTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  sessionRef.current = session;

  // Start or restore a session
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        // Check for active sessions first
        const activeList = await listActiveSessions();
        const matching = activeList.sessions.find(
          (s) => s.type === opts.type && s.resourceId === opts.resourceId,
        );
        if (matching) {
          if (active) setSession(matching);
          return;
        }

        // Start a new session
        const newSession = await startPracticeSession({
          type: opts.type,
          questionIds: opts.questionIds,
          resourceId: opts.resourceId,
        });
        if (active) setSession(newSession);
        if (typeof window !== 'undefined') {
          window.localStorage.setItem(SESSION_STORAGE_KEY, newSession.id);
        }
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : 'Failed to start session');
      }
    })();
    return () => { active = false; };
  }, [opts.type, opts.resourceId]);

  // Auto-save on interval
  useEffect(() => {
    if (!session) return;
    saveTimerRef.current = setInterval(async () => {
      const current = sessionRef.current;
      if (!current || current.completed) return;
      setSaving(true);
      try {
        const updated = await savePracticeProgress(current.id, {
          answers: current.answers,
          currentIndex: current.currentIndex,
          markedQuestions: current.markedQuestions,
          idleSince: idleSinceRef.current ?? undefined,
        });
        setSession(updated);
        idleSinceRef.current = null;
      } catch { /* silent save failure */ }
      setSaving(false);
    }, SAVE_INTERVAL_MS);

    return () => { if (saveTimerRef.current) clearInterval(saveTimerRef.current); };
  }, [session?.id]);

  // Idle detection: track user activity
  useEffect(() => {
    function onActivity() {
      lastActivityRef.current = Date.now();
      idleSinceRef.current = null;
    }
    function onVisibilityChange() {
      if (document.hidden) {
        idleSinceRef.current = Date.now();
        // Force save when going idle
        if (saveTimerRef.current) {
          clearInterval(saveTimerRef.current);
          saveTimerRef.current = null;
        }
      } else {
        // User returned — restart auto-save
        onActivity();
        if (!saveTimerRef.current && sessionRef.current) {
          saveTimerRef.current = setInterval(async () => {
            const current = sessionRef.current;
            if (!current || current.completed) return;
            try {
              const updated = await savePracticeProgress(current.id, {
                answers: current.answers,
                currentIndex: current.currentIndex,
                markedQuestions: current.markedQuestions,
              });
              setSession(updated);
            } catch { /* silent */ }
          }, SAVE_INTERVAL_MS);
        }
      }
    }

    window.addEventListener('mousemove', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });
    window.addEventListener('touchstart', onActivity, { passive: true });
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.removeEventListener('mousemove', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('touchstart', onActivity);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const updateAnswer = useCallback((questionId: string, selectedAnswer: string, timeSpentSec: number) => {
    setSession((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        answers: { ...prev.answers, [questionId]: { selectedAnswer, timeSpentSec } },
      };
    });
  }, []);

  const setCurrentQuestion = useCallback((index: number) => {
    setSession((prev) => {
      if (!prev) return prev;
      return { ...prev, currentIndex: index };
    });
  }, []);

  const toggleMark = useCallback((questionId: string) => {
    setSession((prev) => {
      if (!prev) return prev;
      const marked = prev.markedQuestions.includes(questionId)
        ? prev.markedQuestions.filter((id) => id !== questionId)
        : [...prev.markedQuestions, questionId];
      return { ...prev, markedQuestions: marked };
    });
  }, []);

  const submitSession = useCallback(async (): Promise<SessionSubmitResult> => {
    if (!sessionRef.current) throw new Error('No active session');
    // Stop auto-save
    if (saveTimerRef.current) { clearInterval(saveTimerRef.current); saveTimerRef.current = null; }

    const answers = Object.entries(sessionRef.current.answers).map(([questionId, answer]) => ({
      questionId,
      selectedAnswer: answer.selectedAnswer,
      timeSpentSec: answer.timeSpentSec,
    }));

    const result = await submitPracticeSession(sessionRef.current.id, { answers });
    setSession((prev) => prev ? { ...prev, completed: true } : prev);
    if (typeof window !== 'undefined') {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
    }
    return result;
  }, []);

  // Restore session on page load (after browser close)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storedId = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!storedId || session) return;
    getPracticeSession(storedId)
      .then((s) => { if (!s.completed) setSession(s); })
      .catch(() => { window.localStorage.removeItem(SESSION_STORAGE_KEY); });
  }, []);

  return {
    session,
    error,
    saving,
    updateAnswer,
    setCurrentQuestion,
    toggleMark,
    submitSession,
  };
}
