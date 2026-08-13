import { isSlowAnswer, type Question, type UserProfile } from '@kaoyan408/shared';
import type { PracticeSet, PracticeSetResult } from '../../api';
import { ModuleInlineUnavailable, ModuleResourceMeta } from '../../components/ModuleResourceState';
import type { ModuleResource } from '../../hooks/moduleResource';
import type { PracticeAnswerResult } from '../../api/endpoints/practice';
import type { TodayTaskNextStep } from '../onboarding/todayLearningRoute';
import type { RoleSection } from '../../layouts/RoleNavigation';
import { GoalProgressInsight } from '../student/GoalProgressInsight';
import { RecommendationEvidence } from '../student/RecommendationEvidence';

interface PracticePanelProps {
  question: Question;
  practiceSet: ModuleResource<PracticeSet>;
  practiceSetResult: PracticeSetResult | null;
  student?: UserProfile | null;
  targetWeakPointTitle?: string | null;
  taskContext?: {
    title: string;
    subject: string;
    chapter: string;
    mode: string;
    questionCount: number;
    minutes: number;
  } | null;
  taskNextStep?: TodayTaskNextStep | null;
  redoQuestionId: string | null;
  status: string;
  submitting?: boolean;
  answerResult?: PracticeAnswerResult | null;
  questionProgress: { current: number; total: number };
  hasNextQuestion?: boolean;
  taskReachedTarget?: boolean;
  onSubmitAnswer: (answer: string) => void;
  onNextQuestion?: () => void;
  onTaskNextStep?: () => void;
  onSubmitPracticeSet: () => void;
  onStartLearningMode?: () => void;
  onRestartPracticeSet?: () => void;
  onRestartQuestionBank?: () => void;
  onNavigate?: (section: RoleSection) => void;
  onRetryPracticeSet: () => void;
}

function answerLetter(selectedAnswer: string | undefined, question: Question) {
  if (!selectedAnswer) return '未作答';
  const index = selectedAnswer.charCodeAt(0) - 65;
  const option = question.options[index];
  return option ? `${selectedAnswer}. ${option}` : selectedAnswer;
}

function buildPracticeSetVerdict(result: PracticeSetResult) {
  if (result.accuracyRate >= 85) return '本组训练基本达标，可以继续加速巩固。';
  if (result.accuracyRate >= 70) return '本组训练接近达标，建议补齐错题后再练一组。';
  return '本组训练还不稳，先复盘错题，再回到同知识点训练。';
}

export function PracticePanel({
  question,
  practiceSet,
  practiceSetResult,
  student = null,
  targetWeakPointTitle = null,
  taskContext = null,
  taskNextStep = null,
  redoQuestionId,
  status,
  submitting = false,
  answerResult = null,
  questionProgress,
  hasNextQuestion = false,
  taskReachedTarget = false,
  onSubmitAnswer,
  onNextQuestion,
  onTaskNextStep,
  onSubmitPracticeSet,
  onStartLearningMode,
  onRestartPracticeSet,
  onRestartQuestionBank,
  onNavigate,
  onRetryPracticeSet,
}: PracticePanelProps) {
  const set = practiceSet.data;
  const answered = Boolean(answerResult);
  const showTaskNextStep = Boolean(answerResult && taskContext && taskNextStep && taskReachedTarget);
  const answerNextAction = answerResult?.correct
    ? '继续下一题，巩固当前知识点。'
    : '先看解析，确认错因；本题会进入错题复盘。';
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
      <p className="practice-question-progress">第 {questionProgress.current} / {questionProgress.total} 题</p>
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
          <div className="answer-impact-card">
            <strong>本题影响</strong>
            <p><span>知识点</span>{answerResult.knowledgePointTitle ?? '当前题目关联考点'}</p>
            <p>
              <span>学习变化</span>
              {answerResult.correct
                ? '本次会帮助提升该知识点掌握度。'
                : '本题会进入错题复盘，并暴露该知识点薄弱点。'}
            </p>
          </div>
          <RecommendationEvidence
            title="本题反馈依据"
            reason={answerResult.correct ? '本题答对，系统会把它作为当前考点的正向练习记录。' : '本题答错，系统会把它作为错题复盘和薄弱点判断依据。'}
            evidence={`答案结果：${answerResult.correct ? '正确' : '错误'}；考点：${answerResult.knowledgePointTitle ?? '当前题目关联考点'}`}
            impact={answerResult.correct ? '会提升该考点掌握度，并计入今日练习进度。' : '会进入错题本，并影响薄弱点和后续训练推荐。'}
            confidence={answerResult.knowledgePointTitle ? 'medium' : 'low'}
            nextDataHint="继续完成同考点题目，系统会用更多记录校准掌握度。"
          />
          <GoalProgressInsight
            student={student}
            taskTitle={taskContext?.title ?? answerResult.knowledgePointTitle ?? '本次题库训练'}
            taskSubject={taskContext?.subject ?? null}
            taskChapter={taskContext?.chapter ?? answerResult.knowledgePointTitle ?? targetWeakPointTitle}
            actionLabel="本次训练推进目标"
            compact
          />
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
          {taskContext ? (
            <div className="task-progress-feedback">
              <strong>今日任务反馈</strong>
              <span>本题会计入今日任务进度，达标后系统会推荐下一步。</span>
            </div>
          ) : null}
          <div className="answer-next-action-card">
            <strong>下一步建议</strong>
            <span>{answerNextAction}</span>
          </div>
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
          {showTaskNextStep && taskNextStep ? (
            <div className="today-task-next-step" role="status" aria-label="任务完成后的下一步">
              <strong>任务完成后的下一步</strong>
              <span>{taskNextStep.message}</span>
              {onTaskNextStep ? (
                <button type="button" className="primary-action" onClick={onTaskNextStep}>{taskNextStep.actionLabel}</button>
              ) : null}
            </div>
          ) : null}
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
              <div className="practice-set-action-panel" role="status" aria-label="专项训练完成后的下一步">
                <article>
                  <span>训练结论</span>
                  <p>{buildPracticeSetVerdict(practiceSetResult)}</p>
                </article>
                <article>
                  <span>本组薄弱点</span>
                  <p>{set.focus}：本组还有 {practiceSetResult.totalQuestions - practiceSetResult.correctCount} 道需要复盘，先把错误转成下一轮练习。</p>
                </article>
                <article>
                  <span>下一步行动</span>
                  <p>按“复盘 → 再练 → 看报告”的顺序，把本组结果接回今日学习闭环。</p>
                </article>
                <RecommendationEvidence
                  title="专项训练结果依据"
                  reason={practiceSetResult.accuracyRate >= 70 ? '本组正确率接近达标，适合复盘后继续巩固。' : '本组正确率偏低，需要先处理错题再继续推进。'}
                  evidence={`本组答对 ${practiceSetResult.correctCount}/${practiceSetResult.totalQuestions}，正确率 ${practiceSetResult.accuracyRate}%`}
                  impact="会更新练习记录、错题本、薄弱点报告和后续推荐。"
                  confidence={practiceSetResult.totalQuestions >= 5 ? 'high' : 'medium'}
                  nextDataHint="再完成一组同考点训练，可以判断是否真正稳定。"
                />
                <GoalProgressInsight
                  student={student}
                  taskTitle={set.title}
                  taskChapter={set.focus}
                  actionLabel="本次训练推进目标"
                  compact
                />
                <div className="practice-set-action-grid">
                  {onRestartPracticeSet ? (
                    <button type="button" className="primary-action" aria-label="再来一组（同知识点）" onClick={onRestartPracticeSet}>再练一组</button>
                  ) : null}
                  <button type="button" className="secondary-action" onClick={() => onNavigate?.('wrong-book')} disabled={!onNavigate}>错题复盘</button>
                  <button type="button" className="secondary-action" onClick={() => onNavigate?.('plan')} disabled={!onNavigate}>回到今日计划</button>
                  <button type="button" className="secondary-action" onClick={() => onNavigate?.('report')} disabled={!onNavigate}>查看报告</button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : <ModuleInlineUnavailable title="推荐题组" resource={practiceSet} onRetry={onRetryPracticeSet} />}
      <p className="muted">答案解析会由标准解析优先提供，AI 只负责补充讲解和相似题推荐。</p>
    </article>
  );
}
