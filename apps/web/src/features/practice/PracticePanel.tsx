import type { Question } from '@kaoyan408/shared';
import type { PracticeSet, PracticeSetResult } from '../../api';

interface PracticePanelProps {
  question: Question;
  practiceSet: PracticeSet;
  practiceSetResult: PracticeSetResult | null;
  redoQuestionId: string | null;
  status: string;
  onSubmitAnswer: (answer: string) => void;
  onSubmitPracticeSet: () => void;
}

export function PracticePanel({ question, practiceSet, practiceSetResult, redoQuestionId, status, onSubmitAnswer, onSubmitPracticeSet }: PracticePanelProps) {
  return (
    <article id="question" className="panel">
      <p className="eyebrow">题库训练</p>
      <h3>{question.stem}</h3>
      <div className="options">
        {question.options.map((option, index) => (
          <button key={option} type="button" onClick={() => onSubmitAnswer(String.fromCharCode(65 + index))}>
            {String.fromCharCode(65 + index)}. {option}
          </button>
        ))}
      </div>
      {redoQuestionId === question.id ? <p className="redo-badge">错题重做模式</p> : null}
      <p className="practice-status">{status}</p>
      <div className="practice-set">
        <strong>{practiceSet.title}</strong>
        <p>{practiceSet.focus} · 预计 {practiceSet.estimatedMinutes} 分钟</p>
        <span>{practiceSet.reason}</span>
        <ol>{practiceSet.questions.slice(0, 3).map((item) => <li key={item.id}>{item.stem}</li>)}</ol>
        <button type="button" className="secondary-action" onClick={onSubmitPracticeSet}>提交演示题组</button>
        {practiceSetResult ? <p>最近一组：答对 {practiceSetResult.correctCount}/{practiceSetResult.totalQuestions}，正确率 {practiceSetResult.accuracyRate}%</p> : null}
      </div>
      <p className="muted">答案解析会由标准解析优先提供，AI 只负责补充讲解和相似题推荐。</p>
    </article>
  );
}
