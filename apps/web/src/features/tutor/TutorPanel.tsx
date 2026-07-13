import { Brain } from 'lucide-react';
import type { AiFollowUp, TutorReply } from '../../api';
import { reviewCardTypeLabel } from '../../constants';

interface TutorPanelProps {
  reply: TutorReply | null;
  followUp: AiFollowUp;
  status: string;
  onAskTutor: () => void;
  onAskFollowUp: (message: string) => void;
}

export function TutorPanel({ reply, followUp, status, onAskTutor, onAskFollowUp }: TutorPanelProps) {
  return (
    <section id="ai" className="panel tutor-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">AI 答疑</p><h3>基于标准解析的助教讲解</h3></div>
        <button type="button" className="secondary-action" onClick={onAskTutor}><Brain size={18} /> 讲解当前题</button>
      </div>
      <p className="task-status">{status}</p>
      <p className="ai-safety-note">AI 解释仅作辅助，最终以标准答案、标准解析和教师审核内容为准。</p>
      <div className="follow-up-actions">
        <button type="button" onClick={() => onAskFollowUp('为什么我选 A 不对？')}>为什么选 A 不对</button>
        <button type="button" onClick={() => onAskFollowUp('这个考点和相邻考点有什么区别？')}>对比易混考点</button>
        <button type="button" onClick={() => onAskFollowUp('帮我整理成复习卡片。')}>生成复习卡片</button>
      </div>
      {reply ? (
        <div className="tutor-result">
          <article><strong>{reply.knowledgePointTitle}</strong><p>{reply.answerCheck}</p></article>
          <article><strong>思路拆解</strong><ol>{reply.explanationSteps.map((step) => <li key={step}>{step}</li>)}</ol></article>
          <article><strong>相似题推荐</strong><div className="similar-list">{reply.similarQuestions.map((question) => <span key={question.id}>{question.source} · {question.difficulty} · {question.stem}</span>)}</div></article>
          <article><strong>下一步</strong><ul>{reply.nextActions.map((action) => <li key={action}>{action}</li>)}</ul></article>
        </div>
      ) : null}
      <div className="follow-up-result">
        <article><strong>{followUp.relatedKnowledgePoint.title}</strong><p>{followUp.message}</p><ol>{followUp.replySteps.map((step) => <li key={step}>{step}</li>)}</ol></article>
        <article><strong>易错点提醒</strong><ul>{followUp.misconceptionTips.map((tip) => <li key={tip}>{tip}</li>)}</ul></article>
        <div className="review-card-list">
          {followUp.reviewCards.map((card) => (
            <article key={card.id} className={`review-card card-${card.type}`}><span>{reviewCardTypeLabel[card.type]}</span><strong>{card.title}</strong><p>{card.content}</p><small>{card.nextAction}</small></article>
          ))}
        </div>
      </div>
    </section>
  );
}
