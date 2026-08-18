import { useState } from 'react';
import { Brain, Send } from 'lucide-react';
import type { AiFollowUp, TutorReply } from '../../api';
import { reviewCardTypeLabel } from '../../constants';
import { AI_TUTOR_FOLLOW_UP_MODES } from '@kaoyan408/shared';

interface TutorPanelProps {
  reply: TutorReply | null;
  followUp: AiFollowUp | null;
  status: string;
  failed?: boolean;
  onRetry?: () => void;
  onAskTutor: () => void;
  onAskFollowUp: (message: string, mode?: string) => void;
}

function isRealModelSource(source: string | undefined): boolean {
  return typeof source === 'string' && source.startsWith('deepseek');
}

export function TutorPanel({ reply, followUp, status, failed = false, onRetry, onAskTutor, onAskFollowUp }: TutorPanelProps) {
  const [expandedLayers, setExpandedLayers] = useState<number[]>([]);
  const [question, setQuestion] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function toggleLayer(level: number) {
    setExpandedLayers((current) => (
      current.includes(level) ? current.filter((item) => item !== level) : [...current, level]
    ));
  }

  function submitQuestion() {
    const text = question.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    try {
      onAskFollowUp(text);
      setQuestion('');
    } finally {
      setSubmitting(false);
    }
  }

  const realModel = isRealModelSource(reply?.source) || isRealModelSource(followUp?.source);

  return (
    <section id="ai" className="panel tutor-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">AI 答疑</p>
          <h3>{realModel ? 'DeepSeek 助教讲解' : '基于标准解析的助教讲解'}</h3>
        </div>
        <button type="button" className="secondary-action" onClick={onAskTutor}><Brain size={18} /> 讲解当前题</button>
      </div>
      <p className="task-status">{status}</p>
      {failed ? (
        <div className="module-error" role="alert">
          <span>AI 请求超时或失败，你的其他学习数据不受影响。可稍后重试，或先查看标准解析。</span>
          {onRetry ? <button type="button" className="secondary-action" onClick={onRetry}>重试</button> : null}
        </div>
      ) : null}
      <p className="ai-safety-note">AI 解释仅作辅助，最终以标准答案、标准解析和教师审核内容为准。</p>
      <div className="follow-up-actions">
        {AI_TUTOR_FOLLOW_UP_MODES.map(({ mode, label }) => (
          <button key={mode} type="button" className="tutor-quick-mode" onClick={() => onAskFollowUp(label, mode)}>{label}</button>
        ))}
      </div>
      <div className="tutor-prompt-row">
        <input
          className="tutor-prompt-input"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') submitQuestion(); }}
          placeholder="输入你的问题，例如：这道题为什么选 B？"
          aria-label="向 AI 助教提问"
        />
        <button type="button" className="primary-action" onClick={submitQuestion} disabled={!question.trim() || submitting}>
          <Send size={16} /> {submitting ? '发送中...' : '提问'}
        </button>
      </div>
      {reply ? (
        <div className="tutor-result">
          <article><strong>{reply.knowledgePointTitle}</strong><p>{reply.answerCheck}</p></article>
          {reply.hintLayers && reply.hintLayers.length > 0 ? (
            <article className="tutor-hint-layers">
              <strong>分层提示</strong>
              {reply.hintLayers.map((layer) => {
                const open = expandedLayers.includes(layer.level);
                return (
                  <div key={layer.level} className={`hint-layer${open ? ' hint-layer-open' : ''}`}>
                    <button
                      type="button"
                      className="hint-layer-toggle"
                      onClick={() => toggleLayer(layer.level)}
                      aria-expanded={open}
                    >
                      <span>第 {layer.level} 层</span><strong>{layer.title}</strong>
                    </button>
                    {open ? <p className="hint-layer-content">{layer.content}</p> : null}
                  </div>
                );
              })}
            </article>
          ) : (
            <article><strong>思路拆解</strong><ol>{reply.explanationSteps.map((step) => <li key={step}>{step}</li>)}</ol></article>
          )}
          <article><strong>相似题推荐</strong><div className="similar-list">{reply.similarQuestions.map((question) => <span key={question.id}>{question.source} · {question.difficulty} · {question.stem}</span>)}</div></article>
          <article><strong>下一步</strong><ul>{reply.nextActions.map((action) => <li key={action}>{action}</li>)}</ul></article>
        </div>
      ) : null}
      {followUp ? <div className="follow-up-result">
        <article><strong>{followUp.relatedKnowledgePoint.title}</strong><p>{followUp.message}</p><ol>{followUp.replySteps.map((step) => <li key={step}>{step}</li>)}</ol></article>
        <article><strong>易错点提醒</strong><ul>{followUp.misconceptionTips.map((tip) => <li key={tip}>{tip}</li>)}</ul></article>
        <div className="review-card-list">
          {followUp.reviewCards.map((card) => (
            <article key={card.id} className={`review-card card-${card.type}`}><span>{reviewCardTypeLabel[card.type]}</span><strong>{card.title}</strong><p>{card.content}</p><small>{card.nextAction}</small></article>
          ))}
        </div>
      </div> : null}
    </section>
  );
}