import { useState, useEffect, useRef } from 'react';
import { Clock, Flag, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle } from 'lucide-react';
import { usePracticeSession } from '../hooks/usePracticeSession';
import type { SessionView, SessionSubmitResult } from '../api/endpoints/sessions';

interface Props {
  questionIds: string[];
  questions: Array<{
    id: string;
    stem: string;
    options: string[];
    knowledgePointIds: string[];
    type?: string;
    analysis?: string;
    answer?: string;
  }>;
  timeLimitMin?: number;
  resourceId?: string;
  onExit: () => void;
  onSubmit: (result: SessionSubmitResult) => void;
}

export function ExamSession({ questionIds, questions, timeLimitMin = 180, resourceId, onExit, onSubmit }: Props) {
  const {
    session, saving, submitting, error, saveError, lastSavedAt,
    updateAnswer, setCurrentQuestion, toggleMark, saveNow, submitSession, getActiveElapsedMs,
  } = usePracticeSession({ type: 'paper', questionIds, resourceId });

  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const questionStartedAtRef = useRef(0);
  const questionTimeCarryMsRef = useRef(0);
  const totalTimeSec = timeLimitMin * 60;

  // Timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsedSec(Math.round(getActiveElapsedMs() / 1000));
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [getActiveElapsedMs]);

  const remainingSec = Math.max(0, totalTimeSec - elapsedSec);
  const remainingMin = Math.floor(remainingSec / 60);
  const remainingSecPart = remainingSec % 60;
  const isOvertime = elapsedSec > totalTimeSec;

  const currentIndex = session?.currentIndex ?? 0;
  const currentQuestion = questions.find((q) => q.id === questionIds[currentIndex]);
  const answeredCount = session ? Object.keys(session.answers).length : 0;
  const unansweredQuestions = questionIds.filter((id) => !session?.answers[id]);
  const markedCount = session?.markedQuestions.length ?? 0;
  const subjectiveQuestions = questions.filter((question) => question.type === '综合题');
  const missingSubjectiveScores = subjectiveQuestions.filter((question) => session?.answers[question.id]?.selfScore === undefined);

  useEffect(() => {
    if (!session) return;
    setElapsedSec(Math.round(session.totalActiveMs / 1000));
    questionStartedAtRef.current = getActiveElapsedMs();
  }, [session?.id]);

  useEffect(() => {
    questionStartedAtRef.current = getActiveElapsedMs();
    questionTimeCarryMsRef.current = 0;
  }, [currentIndex, getActiveElapsedMs]);

  function goToQuestion(index: number) {
    flushCurrentQuestionTime();
    setCurrentQuestion(Math.max(0, Math.min(questionIds.length - 1, index)));
  }

  function consumeQuestionTime(finalize = false) {
    const now = getActiveElapsedMs();
    const totalMs = questionTimeCarryMsRef.current + Math.max(0, now - questionStartedAtRef.current);
    const elapsedSec = finalize ? Math.round(totalMs / 1000) : Math.floor(totalMs / 1000);
    questionTimeCarryMsRef.current = finalize ? 0 : totalMs - elapsedSec * 1000;
    questionStartedAtRef.current = now;
    return elapsedSec;
  }

  function handleSelectAnswer(optionIndex: number) {
    if (!currentQuestion || !session) return;
    const letter = String.fromCharCode(65 + optionIndex);
    const previousTime = session.answers[currentQuestion.id]?.timeSpentSec ?? 0;
    const elapsed = consumeQuestionTime();
    updateAnswer(currentQuestion.id, letter, previousTime + elapsed);
  }

  function handleSubjectiveAnswer(value: string) {
    if (!currentQuestion || !session) return;
    const previous = session.answers[currentQuestion.id];
    const elapsed = consumeQuestionTime();
    updateAnswer(currentQuestion.id, value, (previous?.timeSpentSec ?? 0) + elapsed, previous?.selfScore, 10);
  }

  function handleSelfScore(questionId: string, score: number) {
    if (!session) return;
    const previous = session.answers[questionId];
    updateAnswer(questionId, previous?.selectedAnswer ?? '', previous?.timeSpentSec ?? 1, score, 10);
  }

  function flushCurrentQuestionTime() {
    if (!currentQuestion || !session) return;
    const previous = session.answers[currentQuestion.id];
    if (!previous?.selectedAnswer) return;
    const elapsed = consumeQuestionTime(true);
    updateAnswer(
      currentQuestion.id,
      previous.selectedAnswer,
      previous.timeSpentSec + elapsed,
      previous.selfScore,
      previous.maxScore,
    );
  }

  async function handleSubmit() {
    if (missingSubjectiveScores.length > 0) return;
    try {
      flushCurrentQuestionTime();
      const result = await submitSession();
      if (timerRef.current) clearInterval(timerRef.current);
      onSubmit(result);
    } catch { /* error */ }
  }

  async function handleExit() {
    try {
      flushCurrentQuestionTime();
      await saveNow();
      onExit();
    } catch {
      // Keep the exam open when the final save fails.
    }
  }

  if (error) return <div className="panel"><p className="task-status">会话错误: {error}</p></div>;
  if (!session) return <div className="panel"><p className="task-status">加载考试...</p></div>;

  const timerClass = remainingSec < 300 ? 'timer-danger' : remainingSec < 600 ? 'timer-warning' : '';

  return (
    <div className="exam-session">
      {/* Top bar: timer + stats */}
      <header className="exam-header">
        <div className={`exam-timer ${timerClass}`}>
          <Clock size={20} />
          <span>{isOvertime ? '+' : ''}{remainingMin}:{String(remainingSecPart).padStart(2, '0')}</span>
          {isOvertime ? <span className="overtime-badge">超时</span> : null}
        </div>
        <div className="exam-stats">
          <span>{answeredCount}/{questionIds.length} 已答</span>
          {markedCount > 0 ? <span><Flag size={14} /> {markedCount} 标记</span> : null}
          {saving ? (
            <span className="saving-indicator">保存中...</span>
          ) : saveError ? (
            <button type="button" className="save-retry" onClick={() => { void saveNow().catch(() => undefined); }}>
              保存失败，重试
            </button>
          ) : (
            <span className="saved-indicator">{lastSavedAt ? '已自动保存' : '等待首次保存'}</span>
          )}
        </div>
        <button type="button" className="secondary-action" onClick={handleExit}>保存并退出</button>
        <button type="button" className="primary-action" disabled={submitting} onClick={() => setShowSubmitConfirm(true)}>
          交卷
        </button>
      </header>

      <div className="exam-body">
        {/* Question area */}
        <div className="exam-question-area">
          {currentQuestion ? (
            <>
              <div className="question-header">
                <span>第 {currentIndex + 1}/{questionIds.length} 题</span>
                <button
                  type="button"
                  className={session.markedQuestions.includes(currentQuestion.id) ? 'marked' : ''}
                  onClick={() => toggleMark(currentQuestion.id)}
                >
                  <Flag size={14} /> {session.markedQuestions.includes(currentQuestion.id) ? '已标记' : '标记'}
                </button>
              </div>
              <div className="question-stem">
                <strong>{currentQuestion.stem}</strong>
              </div>
              {currentQuestion.type === '综合题' ? (
                <div className="subjective-answer">
                  <label htmlFor={`subjective-${currentQuestion.id}`}>作答内容</label>
                  <textarea
                    id={`subjective-${currentQuestion.id}`}
                    value={session.answers[currentQuestion.id]?.selectedAnswer ?? ''}
                    placeholder="写出推导过程、关键步骤和最终结论"
                    onChange={(event) => handleSubjectiveAnswer(event.target.value)}
                  />
                  <small>评分点将在确认交卷时展示，由你自行核对评分。</small>
                </div>
              ) : (
                <div className="question-options">
                  {currentQuestion.options.map((option, i) => {
                    const letter = String.fromCharCode(65 + i);
                    const selected = session.answers[currentQuestion.id]?.selectedAnswer;
                    return (
                      <button
                        key={letter}
                        type="button"
                        className={`option-btn ${selected === letter ? 'selected' : ''}`}
                        onClick={() => handleSelectAnswer(i)}
                      >
                        <span className="option-letter">{letter}</span>
                        <span>{option}</span>
                        {selected === letter ? <CheckCircle size={16} /> : null}
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="question-nav">
                <button type="button" className="secondary-action" disabled={currentIndex === 0}
                  onClick={() => goToQuestion(currentIndex - 1)}>
                  <ChevronLeft size={16} /> 上一题
                </button>
                <button type="button" className="secondary-action" disabled={currentIndex === questionIds.length - 1}
                  onClick={() => goToQuestion(currentIndex + 1)}>
                  下一题 <ChevronRight size={16} />
                </button>
              </div>
            </>
          ) : (
            <p className="empty-state">没有题目</p>
          )}
        </div>

        {/* Answer sheet sidebar */}
        <aside className="exam-answer-sheet">
          <h4>答题卡</h4>
          <div className="answer-grid">
            {questionIds.map((qid, i) => {
              const answered = !!session.answers[qid];
              const marked = session.markedQuestions.includes(qid);
              return (
                <button
                  key={qid}
                  type="button"
                  className={`answer-cell ${answered ? 'answered' : ''} ${marked ? 'marked' : ''} ${i === currentIndex ? 'current' : ''}`}
                  onClick={() => goToQuestion(i)}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className="answer-legend">
            <span><span className="dot answered" /> 已答</span>
            <span><span className="dot" /> 未答</span>
            <span><span className="dot marked" /> 标记</span>
          </div>
        </aside>
      </div>

      {/* Submit confirmation modal */}
      {showSubmitConfirm ? (
        <div className="submit-confirm-overlay">
          <div className="submit-confirm-panel">
            <h3><AlertTriangle size={20} /> 确认交卷</h3>
            {unansweredQuestions.length > 0 ? (
              <div className="unanswered-warning">
                <p>还有 <strong>{unansweredQuestions.length}</strong> 道题未作答：</p>
                <ul>
                  {unansweredQuestions.slice(0, 5).map((id) => {
                    const q = questions.find((q2) => q2.id === id);
                    return <li key={id}>{q?.stem.slice(0, 30) ?? id}...</li>;
                  })}
                  {unansweredQuestions.length > 5 ? <li>...还有 {unansweredQuestions.length - 5} 道</li> : null}
                </ul>
              </div>
            ) : (
              <p>所有题目已作答，确认提交？</p>
            )}
            {subjectiveQuestions.length > 0 ? (
              <div className="subjective-scoring">
                <strong>综合题评分点自评</strong>
                {subjectiveQuestions.map((question) => (
                  <div key={question.id} className="subjective-score-row">
                    <p>{question.stem}</p>
                    <small>{question.analysis ?? question.answer ?? '请依据标准评分点核对关键步骤。'}</small>
                    <label>
                      自评分
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={session.answers[question.id]?.selfScore ?? ''}
                        onChange={(event) => handleSelfScore(question.id, Number(event.target.value))}
                      />
                      / 10
                    </label>
                  </div>
                ))}
              </div>
            ) : null}
            {missingSubjectiveScores.length > 0 ? (
              <p className="task-status">请先完成 {missingSubjectiveScores.length} 道综合题评分点自评。</p>
            ) : null}
            <div className="confirm-actions">
              <button type="button" className="secondary-action" onClick={() => setShowSubmitConfirm(false)}>返回检查</button>
              <button type="button" className="primary-action" disabled={submitting || missingSubjectiveScores.length > 0} onClick={handleSubmit}>
                {submitting ? '提交中...' : '确认交卷'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
