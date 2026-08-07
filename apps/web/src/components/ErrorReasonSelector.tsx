import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2 } from 'lucide-react';
import { reportWrongReason } from '../api/endpoints/review';
import { normalizeMistakeReason } from '@kaoyan408/shared';
import { useOverlayDialog } from '../hooks/useOverlayDialog';

interface Props {
  questionId: string;
  correct: boolean;
  timeSpentSec: number;
  isReview: boolean;
  inferredReason?: string | null;
  onReported: (result: Awaited<ReturnType<typeof reportWrongReason>>) => void;
  onClose: () => void;
}

const REASONS = [
  { value: '知识点没学过', label: '知识点没学过', hint: '还没学到这个考点，需要先补基础' },
  { value: '概念混淆', label: '概念混淆', hint: '公式、定义或原理理解有误' },
  { value: '公式记错', label: '公式记错', hint: '公式本身记错了或记混了' },
  { value: '计算错误', label: '计算错误', hint: '中间步骤出错或单位没换算' },
  { value: '审题错误', label: '审题错误', hint: '没注意到限制条件或关键词' },
  { value: '推理过程错误', label: '推理过程错误', hint: '思路对但中间推理跳步或出错' },
  { value: '时间不足', label: '时间不足', hint: '能做对但时间不够或超时' },
  { value: '蒙题', label: '蒙题', hint: '凭感觉或猜测作答' },
];

const REDO_CORRECT_REASON = { value: '已完成复盘', label: '已完成复盘', hint: '重做/复测通过，无需填写错因' };

export function ErrorReasonSelector({ questionId, correct, timeSpentSec, isReview, inferredReason, onReported, onClose }: Props) {
  const normalizedInferred = normalizeMistakeReason(inferredReason);
  const [reason, setReason] = useState(() => (normalizedInferred ?? (correct ? REDO_CORRECT_REASON.value : '')));
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  useOverlayDialog({ rootRef: overlayRef, onClose });

  async function handleSubmit() {
    if (!reason) return;
    setStatus('提交中...');
    setSubmitting(true);
    try {
      const result = await reportWrongReason(questionId, {
        selfReportedReason: reason,
        redoCorrect: correct,
        timeSpentSec,
        isReview,
      });
      onReported(result);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div ref={overlayRef} className="error-reason-overlay" role="dialog" aria-modal="true" aria-label="错因自评">
      <div className="error-reason-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">错题复盘</p>
            <h3>{correct ? '重做已答对，确认本次复盘结果' : '这道题为什么做错了？'}</h3>
          </div>
          <button type="button" className="secondary-action" onClick={onClose}>跳过</button>
        </div>

        <p className="step-description">
          系统会根据你的自评 + 实际用时 + 历史正确率来安排下次复习时间。
        </p>
        {normalizedInferred ? (
          <p className="task-status">
            系统判断本次错因为「{normalizedInferred}」，如符合可直接提交，也可以改为更贴切的原因。
          </p>
        ) : null}

        <div className="reason-list">
          {correct ? (
            <label key={REDO_CORRECT_REASON.value} className={`reason-option ${reason === REDO_CORRECT_REASON.value ? 'selected' : ''}`}>
              <input
                type="radio"
                name="errorReason"
                value={REDO_CORRECT_REASON.value}
                checked={reason === REDO_CORRECT_REASON.value}
                onChange={() => setReason(REDO_CORRECT_REASON.value)}
              />
              <div>
                <strong>{REDO_CORRECT_REASON.label}</strong>
                <span>{REDO_CORRECT_REASON.hint}</span>
              </div>
              {reason === REDO_CORRECT_REASON.value ? <CheckCircle2 size={16} /> : null}
            </label>
          ) : null}
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
          <button type="button" className="primary-action" disabled={!reason || submitting} onClick={handleSubmit}>
            <AlertTriangle size={16} /> {submitting ? '提交中...' : isReview ? '提交重做结果' : '提交错因并加入复习计划'}
          </button>
        </div>

        <div className="review-hint">
          <p>首次答错次日复习，连续重做正确后依次延长到 3、7、14 天。</p>
        </div>
      </div>
    </div>
  );
}
