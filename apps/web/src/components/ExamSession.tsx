import { useState, useEffect, useRef } from 'react';
import { Clock, Flag, ChevronLeft, ChevronRight, AlertTriangle, CheckCircle, Lightbulb } from 'lucide-react';
import type { ConfidenceLevel } from '@kaoyan408/shared';
import { MISTAKE_SUGGESTIONS } from '@kaoyan408/shared';
import { usePracticeSession } from '../hooks/usePracticeSession';
import type { SessionView, SessionSubmitResult } from '../api/endpoints/sessions';
import type { PracticeAnswerResult } from '../api/endpoints/practice';

interface Props {
  sessionType?: SessionView['type'];
  questionIds: string[];
  questions: Array<{
    id: string;
    stem: string;
    options: string[];
    knowledgePointIds: string[];
    type?: string;
    analysis?: string;
    answer?: string;
    expectedTimeSec?: number;
  }>;
  timeLimitMin?: number;
  resourceId?: string;
  localMode?: boolean;
  learningMode?: boolean;
  onCheckAnswer?: (input: {
    questionId: string;
    selectedAnswer: string;
    timeSpentSec: number;
    confidence?: ConfidenceLevel;
    usedHint?: boolean;
    answerModified?: boolean;
  }) => Promise<PracticeAnswerResult>;
  onExit: () => void;
  onSubmit: (result: SessionSubmitResult) => void;
}

const CONFIDENCE_LEVELS: ConfidenceLevel[] = ['确定', '不确定', '完全不会'];

export function ExamSession({ sessionType = 'paper', questionIds, questions, timeLimitMin = 180, resourceId, localMode = false, learningMode = false, onCheckAnswer, onExit, onSubmit }: Props) {
  const {
    session, saving, submitting, error, saveError, lastSavedAt,
    updateAnswer, setCurrentQuestion, toggleMark, saveNow, submitSession, getActiveElapsedMs,
  } = usePracticeSession({
    type: sessionType,
    questionIds,
    resourceId,
    localMode,
    localQuestions: questions.map((question) => ({
      id: question.id,
      answer: question.answer ?? '',
      subjective: question.type === '综合题',
      expectedTimeSec: question.expectedTimeSec,
    })),
  });

  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [learningFeedback, setLearningFeedback] = useState<Record<string, PracticeAnswerResult>>({});
  const [checkingAnswer, setCheckingAnswer] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [hintVisible, setHintVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const questionStartedAtRef = useRef(0);
  const questionTimeCarryMsRef = useRef(0);
  const totalTimeSec = timeLimitMin * 60;
  const isLearningMode = Boolean(learningMode);
  const isPaperMode = sessionType === 'paper';
  const sessionLabel = isLearningMode
    ? '学习模式'
    : sessionType === 'practice_set' ? '专项练习' : sessionType === 'stage_assessment' ? '阶段测评' : '模拟考试';

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
  const isAnswered = (questionId: string) => Boolean(session?.answers[questionId]?.selectedAnswer.trim());
  const answeredCount = questionIds.filter(isAnswered).length;
  const unansweredQuestions = questionIds.filter((id) => !isAnswered(id));
  const markedCount = session?.markedQuestions.length ?? 0;
  const subjectiveQuestions = questions.filter((question) => question.type === '综合题');
  const missingSubjectiveScores = subjectiveQuestions.filter((question) =>
    isAnswered(question.id) && session?.answers[question.id]?.selfScore === undefined,
  );
  const currentConfidence = session?.answers[currentQuestion?.id ?? '']?.confidence;
  const currentUsedHint = session?.answers[currentQuestion?.id ?? '']?.usedHint ?? false;

  useEffect(() => {
    if (!session) return;
    setElapsedSec(Math.round(session.totalActiveMs / 1000));
    questionStartedAtRef.current = getActiveElapsedMs();
  }, [session?.id]);

  useEffect(() => {
    questionStartedAtRef.current = getActiveElapsedMs();
    questionTimeCarryMsRef.current = 0;
    setHintVisible(false);
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
    const previous = session.answers[currentQuestion.id];
    const previousTime = previous?.timeSpentSec ?? 0;
    const elapsed = consumeQuestionTime();
    const answerModified = Boolean(previous?.selectedAnswer && previous.selectedAnswer !== letter) || Boolean(previous?.answerModified);
    updateAnswer(currentQuestion.id, letter, previousTime + elapsed, previous?.selfScore, previous?.maxScore, {
      confidence: previous?.confidence,
      usedHint: previous?.usedHint,
      answerModified,
    });
  }

  async function handleLearningSelect(optionIndex: number) {
    if (!currentQuestion || !session) return;
    if (learningFeedback[currentQuestion.id] || checkingAnswer) return;
    const letter = String.fromCharCode(65 + optionIndex);
    const previous = session.answers[currentQuestion.id];
    const previousTime = previous?.timeSpentSec ?? 0;
    const elapsed = consumeQuestionTime();
    const timeSpentSec = previousTime + elapsed;
    const answerModified = Boolean(previous?.selectedAnswer && previous.selectedAnswer !== letter) || Boolean(previous?.answerModified);
    updateAnswer(currentQuestion.id, letter, timeSpentSec, previous?.selfScore, previous?.maxScore, {
      confidence: previous?.confidence,
      usedHint: previous?.usedHint,
      answerModified,
    });
    if (!onCheckAnswer) {
      setCheckError('学习模式暂不可用，请稍后重试。');
      return;
    }
    setCheckingAnswer(true);
    setCheckError('');
    try {
      const feedback = await onCheckAnswer({
        questionId: currentQuestion.id,
        selectedAnswer: letter,
        timeSpentSec,
        confidence: previous?.confidence,
        usedHint: previous?.usedHint,
        answerModified,
      });
      setLearningFeedback((current) => ({ ...current, [currentQuestion.id]: feedback }));
    } catch (checkFailure) {
      setCheckError(checkFailure instanceof Error ? `核对失败：${checkFailure.message}` : '核对失败，请检查网络后重试。');
    } finally {
      setCheckingAnswer(false);
    }
  }

  function handleSetConfidence(level: ConfidenceLevel) {
    if (!currentQuestion || !session) return;
    const previous = session.answers[currentQuestion.id];
    updateAnswer(currentQuestion.id, previous?.selectedAnswer ?? '', previous?.timeSpentSec ?? 0, previous?.selfScore, previous?.maxScore, {
      confidence: level,
    });
  }

  function handleShowHint() {
    if (!currentQuestion || !session || currentUsedHint) return;
    const previous = session.answers[currentQuestion.id];
    updateAnswer(currentQuestion.id, previous?.selectedAnswer ?? '', previous?.timeSpentSec ?? 0, previous?.selfScore, previous?.maxScore, {
      usedHint: true,
    });
    setHintVisible(true);
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
    setSubmitError('');
    try {
      flushCurrentQuestionTime();
      const result = await submitSession();
      if (timerRef.current) clearInterval(timerRef.current);
      onSubmit(result);
    } catch (submissionError) {
      setSubmitError(
        submissionError instanceof Error
          ? `提交失败：${submissionError.message}`
          : '提交失败，请检查网络后重试。你的作答已自动保存，不会丢失。',
      );
    }
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
  if (!session) return <div className="panel"><p className="task-status">正在加载{sessionLabel}...</p></div>;

  const timerClass = isLearningMode ? '' : remainingSec < 300 ? 'timer-danger' : remainingSec < 600 ? 'timer-warning' : '';
  const learningFeedbackForCurrent = currentQuestion ? learningFeedback[currentQuestion.id] : undefined;

  return (
    <div className="exam-session">
      {/* Top bar: timer + stats */}
      <header className="exam-header">
        <div className={`exam-timer ${timerClass}`}>
          <Clock size={20} />
          <span>{isLearningMode
            ? `${Math.floor(elapsedSec / 60)}:${String(elapsedSec % 60).padStart(2, '0')}`
            : `${isOvertime ? '+' : ''}${remainingMin}:${String(remainingSecPart).padStart(2, '0')}`}</span>
          {!isLearningMode && isOvertime ? <span className="overtime-badge">超时</span> : null}
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
        {isLearningMode ? (
          <button type="button" className="primary-action" onClick={() => void handleExit()}>完成学习</button>
        ) : (
          <>
            <button type="button" className="secondary-action" onClick={handleExit}>保存并退出</button>
            <button type="button" className="primary-action" disabled={submitting} onClick={() => setShowSubmitConfirm(true)}>
              {sessionType === 'paper' ? '交卷' : '提交'}
            </button>
          </>
        )}
      </header>

      {submitError ? (
        <div className="module-error">
          <span>{submitError}</span>
          <button type="button" className="secondary-action" onClick={() => setSubmitError('')}>知道了</button>
        </div>
      ) : null}

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
                  <small>{isLearningMode ? '学习模式暂不自动判分，综合题请到训练或模拟模式提交自评。' : '评分点将在确认交卷时展示，由你自行核对评分。'}</small>
                </div>
              ) : (
                <div className="question-options">
                  {currentQuestion.options.map((option, i) => {
                    const letter = String.fromCharCode(65 + i);
                    const selected = session.answers[currentQuestion.id]?.selectedAnswer;
                    const locked = isLearningMode && Boolean(learningFeedback[currentQuestion.id]);
                    return (
                      <button
                        key={letter}
                        type="button"
                        className={`option-btn ${selected === letter ? 'selected' : ''}`}
                        disabled={locked || checkingAnswer}
                        onClick={() => (isLearningMode ? void handleLearningSelect(i) : handleSelectAnswer(i))}
                      >
                        <span className="option-letter">{letter}</span>
                        <span>{option}</span>
                        {selected === letter ? <CheckCircle size={16} /> : null}
                      </button>
                    );
                  })}
                </div>
              )}
              {!isPaperMode ? (
                <div className="learning-controls">
                  <div className="confidence-selector" role="group" aria-label="作答自信程度">
                    <span className="control-label">自信程度</span>
                    {CONFIDENCE_LEVELS.map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={currentConfidence === level ? 'active' : ''}
                        onClick={() => handleSetConfidence(level)}
                      >
                        {level}
                      </button>
                    ))}
                  </div>
                  <button type="button" className="secondary-action hint-button" disabled={currentUsedHint} onClick={handleShowHint}>
                    <Lightbulb size={14} /> {currentUsedHint ? '已查看提示' : '查看提示'}
                  </button>
                </div>
              ) : null}
              {hintVisible && currentUsedHint ? (
                <div className="hint-box">提示：先回顾本题所属知识点的定义、公式与典型条件，再核对题干限制条件。</div>
              ) : null}
              {isLearningMode && learningFeedbackForCurrent ? (
                <div className={`answer-result ${learningFeedbackForCurrent.correct ? 'answer-correct' : 'answer-wrong'}`} role="status">
                  <div className="answer-result-head">
                    <strong>{learningFeedbackForCurrent.correct ? '回答正确' : '回答错误'}</strong>
                    <span>你的答案：{session.answers[currentQuestion.id]?.selectedAnswer}</span>
                    <span>正确答案：{learningFeedbackForCurrent.correctAnswer}</span>
                  </div>
                  {learningFeedbackForCurrent.knowledgePointTitle ? (
                    <p className="answer-result-kp"><strong>核心考点</strong>{learningFeedbackForCurrent.knowledgePointTitle}</p>
                  ) : null}
                  {learningFeedbackForCurrent.analysis ? (
                    <div className="answer-result-analysis"><strong>解析</strong><p>{learningFeedbackForCurrent.analysis}</p></div>
                  ) : (
                    <p className="muted">暂无标准解析，可在错题本中查看或使用 AI 答疑。</p>
                  )}
                  {learningFeedbackForCurrent.mistakeReason ? (
                    <p className="answer-result-reason"><strong>本次错因</strong>{learningFeedbackForCurrent.mistakeReason} · {MISTAKE_SUGGESTIONS[learningFeedbackForCurrent.mistakeReason]}</p>
                  ) : null}
                </div>
              ) : null}
              {isLearningMode && checkingAnswer ? <p className="practice-status">正在核对答案...</p> : null}
              {isLearningMode && checkError ? <p className="task-status">{checkError}</p> : null}
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
              const answered = isAnswered(qid);
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
            <h3><AlertTriangle size={20} /> 确认提交{sessionLabel}</h3>
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
                    {isAnswered(question.id) ? (
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
                    ) : <span className="task-status">未作答，不计入自评分。</span>}
                  </div>
                ))}
              </div>
            ) : null}
            {missingSubjectiveScores.length > 0 ? (
              <p className="task-status">请先完成 {missingSubjectiveScores.length} 道综合题评分点自评。</p>
            ) : null}
            {submitError ? <p className="task-status">{submitError}</p> : null}
            <div className="confirm-actions">
              <button type="button" className="secondary-action" onClick={() => setShowSubmitConfirm(false)}>返回检查</button>
              <button type="button" className="primary-action" disabled={submitting || missingSubjectiveScores.length > 0} onClick={handleSubmit}>
                {submitting ? '提交中...' : sessionType === 'paper' ? '确认交卷' : '确认提交'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
