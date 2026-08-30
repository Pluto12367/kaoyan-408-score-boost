import { Brain, Send } from 'lucide-react';
import { useState } from 'react';
import { requestContextualCoach } from '../api/endpoints/tutor';
import type { ContextualCoachRequest, ContextualCoachResponse } from '../api/types';

interface ContextualCoachProps {
  request: ContextualCoachRequest;
  title?: string;
  prompt?: string;
}

export function ContextualCoach({ request, title = 'Contextual AI Coach', prompt = '基于当前学习事实，给我一个可执行的复盘建议。' }: ContextualCoachProps) {
  const [message, setMessage] = useState(request.message ?? '');
  const [response, setResponse] = useState<ContextualCoachResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const input = message.trim() ? { ...request, message: message.trim() } : { ...request, message: prompt };
      setResponse(await requestContextualCoach(input));
    } catch (requestError) {
      setResponse(null);
      setError('AI 教练暂时无法响应，请稍后重试。');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel tutor-panel contextual-coach" aria-label={title}>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">AI 教练</p>
          <h3>{title}</h3>
        </div>
        <button type="button" className="secondary-action" onClick={() => void handleSubmit()} disabled={loading}>
          <Brain size={18} /> {loading ? '整理中...' : '开始辅导'}
        </button>
      </div>
      <p className="ai-safety-note">AI 教练只解释当前学习事实，不会修改你的学习状态或自动生成计划。</p>
      <div className="tutor-prompt-row">
        <input
          className="tutor-prompt-input"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => { if (event.key === 'Enter') void handleSubmit(); }}
          placeholder={prompt}
          aria-label="向 AI 教练提问"
        />
        <button type="button" className="primary-action" onClick={() => void handleSubmit()} disabled={loading}>
          <Send size={16} /> 提问
        </button>
      </div>
      {loading ? <p className="task-status" role="status">正在整理辅导内容...</p> : null}
      {error ? <p className="task-status" role="alert">{error}</p> : null}
      {response ? (
        <div className="follow-up-result">
          <article><strong>当前结论</strong><p>{response.summary}</p></article>
          <article><strong>辅导步骤</strong><ol>{response.replySteps.map((step) => <li key={step}>{step}</li>)}</ol></article>
          <article><strong>易错点提醒</strong><ul>{response.misconceptionTips.map((tip) => <li key={tip}>{tip}</li>)}</ul></article>
          <div className="review-card-list">
            {response.reviewCards.map((card) => (
              <article key={card.id} className={`review-card card-${card.type}`}>
                <strong>{card.title}</strong><p>{card.content}</p><small>{card.nextAction}</small>
              </article>
            ))}
          </div>
          <article><strong>下一步</strong><ul>{response.nextActions.map((action) => <li key={action}>{action}</li>)}</ul></article>
          <div className="task-status" aria-label="AI 回答状态">
            <p>来源：{response.source}</p>
            {response.fallbackReason ? <p>当前回答使用备用方案。原因：{response.fallbackReason}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
