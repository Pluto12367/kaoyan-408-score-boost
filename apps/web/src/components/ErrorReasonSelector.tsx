import { useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { reportWrongReason } from '../api/endpoints/review';

interface Props {
  questionId: string;
  correct: boolean;
  timeSpentSec: number;
  onReported: (result: Awaited<ReturnType<typeof reportWrongReason>>) => void;
  onClose: () => void;
}

const REASONS = [
  { value: '概念不清', label: '概念不清', hint: '公式、定义或原理理解有误' },
  { value: '知识点混淆', label: '知识点混淆', hint: '把相似考点或相邻知识搞混了' },
  { value: '审题问题', label: '审题问题', hint: '没注意到限制条件或关键词' },
  { value: '计算失误', label: '计算失误', hint: '中间步骤出错或单位没换算' },
  { value: '速度偏慢', label: '速度/超时', hint: '能做对但花的时间太长' },
];

export function ErrorReasonSelector({ questionId, correct, timeSpentSec, onReported, onClose }: Props) {
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('');

  async function handleSubmit() {
    if (!reason) return;
    setStatus('提交中...');
    try {
      const result = await reportWrongReason(questionId, {
        selfReportedReason: reason,
        redoCorrect: correct,
        timeSpentSec,
      });
      onReported(result);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '提交失败');
    }
  }

  return (
    <div className="error-reason-overlay">
      <div className="error-reason-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">错题复盘</p>
            <h3>{correct ? '你做对了，但答题速度如何？' : '这道题为什么做错了？'}</h3>
          </div>
          <button type="button" className="secondary-action" onClick={onClose}>跳过</button>
        </div>

        <p className="step-description">
          系统会根据你的自评 + 实际用时 + 历史正确率来安排下次复习时间。
        </p>

        <div className="reason-list">
          {REASONS.map((r) => (
            <label key={r.value} className={`reason-option ${reason === r.value ? 'selected' : ''}`}>
              <input
                type="radio"
                name="errorReason"
                value={r.value}
                checked={reason === r.value}
                onChange={() => setReason(r.value)}
              />
              <div>
                <strong>{r.label}</strong>
                <span>{r.hint}</span>
              </div>
              {reason === r.value ? <CheckCircle2 size={16} /> : null}
            </label>
          ))}
        </div>

        {status ? <p className="task-status">{status}</p> : null}

        <div className="onboarding-actions">
          <button type="button" className="primary-action" disabled={!reason || !!status} onClick={handleSubmit}>
            <AlertTriangle size={16} /> {status || '提交错因并加入复习计划'}
          </button>
        </div>

        <div className="review-hint">
          <p>连续正确 3 次→7 天后复习→14 天后复习→标记为稳定掌握</p>
        </div>
      </div>
    </div>
  );
}
