import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { deriveExamDateState } from '@kaoyan408/shared';
import { isStaticDemoMode } from '../../api/env';
import { fetchScoreEvidence } from '../../api/endpoints/scores';
import { saveExamDate } from '../../api/endpoints/guidance';
import './exam-date.css';

/**
 * G1.8 — exam-date entry (owner decision A6).
 *
 * Before this the product told the student "可在个人信息中录入" while no entry
 * existed anywhere, and `remainingDays` was a hand-typed number the student
 * could not trace.
 *
 * Rules implemented here:
 *   • the meaning of the date is stated up front (what it drives);
 *   • the same shared derivation the API uses validates it, so the client can
 *     never accept something the server would reject;
 *   • "距离考试 X 天" is derived from `examDate`, never from a hand-typed value;
 *   • with nothing set, the card says so instead of showing a guess.
 */
export function ExamDateCard() {
  const [storedDate, setStoredDate] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isStaticDemoMode()) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    fetchScoreEvidence()
      .then((bundle) => {
        if (cancelled) return;
        const value = bundle.examDate ? bundle.examDate.slice(0, 10) : null;
        setStoredDate(value);
        setInput(value ?? '');
      })
      .catch(() => {
        if (!cancelled) setError('考试日期读取失败，可稍后重试。');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isStaticDemoMode()) return null;

  const state = deriveExamDateState({
    examDate: input.trim().length > 0 ? input.trim() : storedDate,
    todayIso: new Date().toISOString(),
  });

  async function submit(next: string | null) {
    setSaving(true);
    setError('');
    setStatus('');
    try {
      const result = await saveExamDate(next);
      if (!result.storeAvailable) {
        setError('数据存储未就绪，暂时无法保存考试日期。');
        return;
      }
      setStoredDate(result.examDate);
      setInput(result.examDate ?? '');
      setStatus(result.examDate ? `已保存：${result.daysLabel}` : '已清除考试日期。');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '保存失败，请重试。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="exam-date-panel panel" aria-label="考试设置" data-testid="exam-date-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">个人信息 · 考试设置</p>
          <h3>我的考试日期</h3>
        </div>
        <CalendarDays size={18} aria-hidden="true" />
      </div>

      <p className="exam-date-meaning">{state.meaningNote}</p>

      <label className="exam-date-field">
        <span>考试日期</span>
        <input
          type="date"
          value={input}
          aria-label="考试日期"
          data-testid="exam-date-input"
          onChange={(event) => {
            setInput(event.target.value);
            setStatus('');
          }}
        />
      </label>

      {/* The derivation is shown even before saving, so the student sees exactly
          what the system would store and what it would count. */}
      <p className="exam-date-derived" data-testid="exam-date-derived">
        {state.error
          ? state.error
          : state.daysLabel ?? '未设置考试日期：系统不会替你编一个。'}
      </p>

      <div className="exam-date-actions">
        <button
          type="button"
          className="primary-action"
          disabled={saving || Boolean(state.error) || input.trim().length === 0}
          data-testid="exam-date-save"
          onClick={() => void submit(input.trim())}
        >
          {saving ? '保存中...' : '保存考试日期'}
        </button>
        <button
          type="button"
          className="secondary-action"
          disabled={saving || storedDate == null}
          onClick={() => void submit(null)}
        >
          清除
        </button>
      </div>

      {status ? <p className="task-status" role="status">{status}</p> : null}
      {error ? <p className="task-status" role="alert">{error}</p> : null}
      {loading ? <p className="dashboard-muted">正在读取考试日期...</p> : null}
    </section>
  );
}
