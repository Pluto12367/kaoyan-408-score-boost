import { useState, type FormEvent } from 'react';
import { Target, Clock, BookOpen, TrendingUp } from 'lucide-react';
import type { Subject } from '@kaoyan408/shared';
import { completeOnboarding } from '../api/endpoints/onboarding';

interface Props {
  onComplete: (result: Awaited<ReturnType<typeof completeOnboarding>>) => void;
}

const SUBJECTS: Subject[] = ['数据结构', '计算机组成原理', '操作系统', '计算机网络'];

export function OnboardingWizard({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    examYear: new Date().getFullYear() + 1,
    targetScore: 110,
    currentScore: 65,
    remainingDays: 120,
    dailyHours: 3,
    weakestSubject: '计算机组成原理' as Subject,
  });

  function update(field: string, value: string | number) {
    setStatus('');
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function goNext() {
    if (step === 0 && (form.targetScore < 60 || form.targetScore > 150)) {
      setStatus('408 目标分数需要在 60 到 150 分之间。');
      return;
    }
    if (step === 1 && (form.currentScore < 0 || form.currentScore > form.targetScore)) {
      setStatus('当前估分不能高于目标分数。');
      return;
    }
    if (step === 2 && (form.remainingDays < 1 || form.dailyHours < 0.5 || form.dailyHours > 12)) {
      setStatus('请检查剩余天数和每日学习时间。');
      return;
    }
    setStatus('');
    setStep((current) => current + 1);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setStatus('正在生成你的专属学习计划...');
    try {
      const result = await completeOnboarding(form);
      onComplete(result);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : '提交失败，请重试');
    } finally {
      setSubmitting(false);
    }
  }

  const steps = [
    {
      icon: <Target size={20} />,
      title: '考试目标',
      description: '408 满分 150 分，设定合理目标',
      fields: (
        <>
          <label><span>考试年份</span>
            <input type="number" value={form.examYear} min={2025} max={2030}
              onChange={(e) => update('examYear', Number(e.target.value))} /></label>
          <label><span>目标分数（建议 100-130）</span>
            <input type="number" value={form.targetScore} min={60} max={150}
              onChange={(e) => update('targetScore', Number(e.target.value))} /></label>
        </>
      ),
    },
    {
      icon: <TrendingUp size={20} />,
      title: '当前基础',
      description: '诚实评估才能生成有效计划',
      fields: (
        <>
          <label><span>当前估分</span>
            <input type="number" value={form.currentScore} min={0} max={150}
              onChange={(e) => update('currentScore', Number(e.target.value))} /></label>
          <label><span>最薄弱科目</span>
            <select value={form.weakestSubject} onChange={(e) => update('weakestSubject', e.target.value)}>
              {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
        </>
      ),
    },
    {
      icon: <Clock size={20} />,
      title: '学习节奏',
      description: '根据可用时间安排每日任务',
      fields: (
        <>
          <label><span>距离考试天数</span>
            <input type="number" value={form.remainingDays} min={1} max={365}
              onChange={(e) => update('remainingDays', Number(e.target.value))} /></label>
          <label><span>每日学习小时</span>
            <input type="number" value={form.dailyHours} min={0.5} max={12} step={0.5}
              onChange={(e) => update('dailyHours', Number(e.target.value))} /></label>
        </>
      ),
    },
    {
      icon: <BookOpen size={20} />,
      title: '确认计划',
      description: `目标 ${form.targetScore} 分，优先补强 ${form.weakestSubject}`,
      fields: (
        <div className="onboarding-summary">
          <div><span>考试年份</span><strong>{form.examYear}年</strong></div>
          <div><span>目标分数</span><strong>{form.targetScore} 分</strong></div>
          <div><span>当前估分</span><strong>{form.currentScore} 分</strong></div>
          <div><span>剩余天数</span><strong>{form.remainingDays} 天</strong></div>
          <div><span>每日学习</span><strong>{form.dailyHours} 小时</strong></div>
          <div><span>优先补强</span><strong>{form.weakestSubject}</strong></div>
        </div>
      ),
    },
  ];

  const s = steps[step];

  return (
    <section className="onboarding-wizard panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">408 提分系统</p>
          <h3>首次使用 · {step + 1}/{steps.length} 步生成学习计划</h3>
        </div>
      </div>

      <div className="onboarding-progress">
        {steps.map((_, i) => (
          <div key={i} className={`step-dot ${i === step ? 'active' : i < step ? 'done' : ''}`} />
        ))}
      </div>

      <form onSubmit={handleSubmit}>
        <p className="step-description">{s.description}</p>
        <div className="onboarding-fields">{s.fields}</div>

        {status ? <p className="task-status">{status}</p> : null}

        <div className="onboarding-actions">
          {step > 0 ? (
            <button type="button" className="secondary-action" onClick={() => setStep(step - 1)}>上一步</button>
          ) : null}
          {step < steps.length - 1 ? (
            <button type="button" className="primary-action" onClick={goNext}>下一步</button>
          ) : (
            <button type="submit" className="primary-action" disabled={submitting}>
              {submitting ? '正在生成...' : '生成我的学习计划'}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
