import { useState, useEffect, useRef, useCallback } from 'react';
import { Clock, Flag, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle } from 'lucide-react';
import { usePracticeSession } from '../hooks/usePracticeSession';
import type { SessionView, SessionSubmitResult } from '../api/endpoints/sessions';

interface Props {
  questionIds: string[];
  questions: Array<{ id: string; stem: string; options: string[]; knowledgePointIds: string[] }>;
  timeLimitMin?: number;
  onExit: () => void;
  onSubmit: (result: SessionSubmitResult) => void;
}

export function ExamSession({ questionIds, questions, timeLimitMin = 180, onExit, onSubmit }: Props) {
  const {
    session, saving, error,
    updateAnswer, setCurrentQuestion, toggleMark, submitSession,
  } = usePracticeSession({ type: 'paper', questionIds });

  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const totalTimeSec = timeLimitMin * 60;

  // Timer
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  const remainingSec = Math.max(0, totalTimeSec - elapsedSec);
  const remainingMin = Math.floor(remainingSec / 60);
  const remainingSecPart = remainingSec % 60;
  const isOvertime = elapsedSec > totalTimeSec;

  const currentIndex = session?.currentIndex ?? 0;
  const currentQuestion = questions.find((q) => q.id === questionIds[currentIndex]);
  const answeredCount = session ? Object.keys(session.answers).length : 0;
  const unansweredQuestions = questionIds.filter((id) => !session?.answers[id]);
  const markedCount = session?.markedQuestions.length ?? 0;

  const goToQuestion = useCallback((index: number) => {
    setCurrentQuestion(Math.max(0, Math.min(questionIds.length - 1, index)));
  }, [questionIds.length, setCurrentQuestion]);

  function handleSelectAnswer(optionIndex: number) {
    if (!currentQuestion || !session) return;
    const letter = String.fromCharCode(65 + optionIndex);
    updateAnswer(currentQuestion.id, letter, 0);
  }

  async function handleSubmit() {
    try {
      const result = await submitSession();
      if (timerRef.current) clearInterval(timerRef.current);
      onSubmit(result);
    } catch { /* error */ }
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
          {saving ? <span className="saving-indicator">保存中...</span> : <span className="saved-indicator">已保存</span>}
        </div>
        <button type="button" className="primary-action" onClick={() => setShowSubmitConfirm(true)}>
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
            <div className="confirm-actions">
              <button type="button" className="secondary-action" onClick={() => setShowSubmitConfirm(false)}>返回检查</button>
              <button type="button" className="primary-action" onClick={handleSubmit}>确认交卷</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
