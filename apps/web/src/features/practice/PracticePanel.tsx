import { isSlowAnswer, type Question } from '@kaoyan408/shared';
import type { PracticeSet, PracticeSetResult } from '../../api';
import { ModuleInlineUnavailable, ModuleResourceMeta } from '../../components/ModuleResourceState';
import type { ModuleResource } from '../../hooks/moduleResource';
import type { PracticeAnswerResult } from '../../api/endpoints/practice';

interface PracticePanelProps {
  question: Question;
  practiceSet: ModuleResource<PracticeSet>;
  practiceSetResult: PracticeSetResult | null;
  taskContext?: {
    title: string;
    subject: string;
    chapter: string;
    mode: string;
    questionCount: number;
    minutes: number;
  } | null;
  redoQuestionId: string | null;
  status: string;
  submitting?: boolean;
  answerResult?: PracticeAnswerResult | null;
  hasNextQuestion?: boolean;
  onSubmitAnswer: (answer: string) => void;
  onNextQuestion?: () => void;
  onSubmitPracticeSet: () => void;
  onStartLearningMode?: () => void;
  onRestartPracticeSet?: () => void;
  onRestartQuestionBank?: () => void;
  onRetryPracticeSet: () => void;
}

function answerLetter(selectedAnswer: string | undefined, question: Question) {
  if (!selectedAnswer) return '未作答';
  const index = selectedAnswer.charCodeAt(0) - 65;
  const option = question.options[index];
  return option ? `${selectedAnswer}. ${option}` : selectedAnswer;
}

export function PracticePanel({
  question,
  practiceSet,
  practiceSetResult,
  taskContext = null,
  redoQuestionId,
  status,
  submitting = false,
  answerResult = null,
  hasNextQuestion = false,
  onSubmitAnswer,
  onNextQuestion,
  onSubmitPracticeSet,
  onStartLearningMode,
  onRestartPracticeSet,
  onRestartQuestionBank,
  onRetryPracticeSet,
}: PracticePanelProps) {
  const set = practiceSet.data;
  const answered = Boolean(answerResult);
  return (
    <article id="question" className="panel">
      <p className="eyebrow">题库训练</p>
      {taskContext ? (
        <div className="today-task-context" role="status">
          <strong>当前任务：{taskContext.title}</strong>
          <span>{taskContext.subject} · {taskContext.chapter} · {taskContext.mode} · {taskContext.questionCount} 题 / {taskContext.minutes} 分钟</span>
          <small>完成后会更新今日进度，并同步错题本和提分报告。</small>
        </div>
      ) : null}
      <h3>{question.stem}</h3>
      <div className="options">
        {question.options.map((option, index) => (
          <button
            key={option}
            type="button"
            disabled={submitting || answered}
            onClick={() => onSubmitAnswer(String.fromCharCode(65 + index))}
          >
            {String.fromCharCode(65 + index)}. {option}
          </button>
        ))}
      </div>
      {redoQuestionId === question.id ? <p className="redo-badge">错题重做模式</p> : null}
      {answerResult ? (
        <div className={`answer-result ${answerResult.correct ? 'answer-correct' : 'answer-wrong'}`} role="status">
          <div className="answer-result-head">
            <strong>{answerResult.correct ? '回答正确' : '回答错误'}</strong>
            <span>你的答案：{answerLetter(answerResult.selectedAnswer, question)}</span>
            {!answerResult.correct && answerResult.correctAnswer ? (
              <span>正确答案：{answerLetter(answerResult.correctAnswer, question)}</span>
            ) : null}
          </div>
          {answerResult.knowledgePointTitle ? (
            <p className="answer-result-kp"><strong>核心考点</strong>{answerResult.knowledgePointTitle}</p>
          ) : null}
          {answerResult.analysis ? (
            <div className="answer-result-analysis"><strong>解析</strong><p>{answerResult.analysis}</p></div>
          ) : (
            <p className="muted">暂无标准解析，可稍后在错题本中查看或使用 AI 答疑。</p>
          )}
          {!answerResult.correct && answerResult.mistakeReason ? (
            <p className="answer-result-reason"><strong>本次错因</strong>{answerResult.mistakeReason}</p>
          ) : null}
          {answerResult.correct
            && answerResult.expectedTimeSec != null
            && isSlowAnswer(answerResult.timeSpentSec, answerResult.expectedTimeSec) ? (
              <p className="answer-result-speed"><strong>用时偏慢</strong>建议控制在 {answerResult.expectedTimeSec} 秒内，避免考场时间压力。</p>
            ) : null}
          <div className="answer-result-actions">
            {hasNextQuestion ? (
              <button type="button" className="primary-action" onClick={onNextQuestion}>下一题</button>
            ) : (
              <span className="muted">当前题库已练完，可在下方开始专项练习或前往错题本。</span>
            )}
            {!hasNextQuestion && onRestartQuestionBank ? (
              <button type="button" className="secondary-action" onClick={onRestartQuestionBank}>重新练习本组</button>
            ) : null}
          </div>
        </div>
      ) : null}
      {!answerResult ? <p className="practice-status">{status}</p> : null}
      {set ? (
        <div className="practice-set">
          <strong>{set.title}</strong>
          <p>{set.focus} · 预计 {set.estimatedMinutes} 分钟</p>
          <ModuleResourceMeta resource={practiceSet} onRetry={onRetryPracticeSet} />
          <span>{set.reason}</span>
          <ol>{set.questions.slice(0, 3).map((item) => <li key={item.id}>{item.stem}</li>)}</ol>
          <div className="practice-set-actions">
            <button type="button" className="secondary-action" onClick={onSubmitPracticeSet}>开始专项练习（训练模式）</button>
            {onStartLearningMode ? <button type="button" className="secondary-action" onClick={onStartLearningMode}>学习模式（边做边看解析）</button> : null}
          </div>
          {practiceSetResult ? (
            <div className="practice-set-result">
              <p>最近一组：答对 {practiceSetResult.correctCount}/{practiceSetResult.totalQuestions}，正确率 {practiceSetResult.accuracyRate}%</p>
              {onRestartPracticeSet ? (
                <button type="button" className="secondary-action" onClick={onRestartPracticeSet}>再来一组（同知识点）</button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : <ModuleInlineUnavailable title="推荐题组" resource={practiceSet} onRetry={onRetryPracticeSet} />}
      <p className="muted">答案解析会由标准解析优先提供，AI 只负责补充讲解和相似题推荐。</p>
    </article>
  );
}
