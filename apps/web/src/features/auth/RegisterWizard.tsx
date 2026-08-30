import { useState, type FormEventHandler } from 'react';
import { ArrowRight, Check, ChevronLeft, LockKeyhole, Sparkles } from 'lucide-react';
import type { OnboardingProfile } from '../onboarding/onboardingProfile';
import { emptyOnboardingProfile, saveOnboardingProfile } from '../onboarding/onboardingProfile';

interface RegisterWizardProps {
  status: string;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onBackToLogin: () => void;
}

const steps = ['账号信息', '考研目标', '当前状态', '学习习惯'];
const levels = ['基础', '熟悉', '进阶'];

export function RegisterWizard({ status, onSubmit, onBackToLogin }: RegisterWizardProps) {
  const [step, setStep] = useState(0);
  const [profile, setProfile] = useState<OnboardingProfile>({ ...emptyOnboardingProfile });
  const [validationMessage, setValidationMessage] = useState('');
  const visibleStatus = status === '请登录后同步学习记录。' ? '' : status;

  function update<K extends keyof OnboardingProfile>(key: K, value: OnboardingProfile[K]) {
    setProfile((current) => {
      const next = { ...current, [key]: value };
      saveOnboardingProfile(next);
      return next;
    });
    setValidationMessage('');
  }

  function canContinue() {
    const requiredByStep: Array<Array<keyof OnboardingProfile>> = [
      ['inviteCode', 'name', 'email'],
      ['targetSchool', 'targetScore'],
      ['dataStructureLevel', 'operatingSystemLevel', 'computerOrganizationLevel', 'networkLevel'],
      ['dailyStudyTime', 'studyMode'],
    ];
    const missing = requiredByStep[step].some((key) => !String(profile[key] ?? '').trim());
    if (missing) {
      setValidationMessage('请完成当前步骤后继续。');
      return false;
    }
    return true;
  }

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  function nextStep() {
    if (step === 0 && (!password.trim() || password !== confirmPassword)) {
      setValidationMessage(password ? '两次输入的密码不一致。' : '请设置一个登录密码。');
      return;
    }
    if (!canContinue()) return;
    if (step < steps.length - 1) setStep((current) => current + 1);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    saveOnboardingProfile(profile);
    onSubmit(event);
  }

  return (
    <section className="auth-login-card auth-register-wizard" aria-label="创建学习档案">
      <div className="auth-wizard-heading">
        <div>
          <p className="eyebrow">CREATE YOUR LEARNING PROFILE</p>
          <h3>创建你的 408 学习档案</h3>
          <p className="auth-panel-subtitle">让 AI 认识你的目标、节奏与起点</p>
        </div>
        <Sparkles size={20} aria-hidden="true" />
      </div>

      <div className="auth-wizard-progress" aria-label={`Step ${step + 1} / 4`}>
        <div className="auth-wizard-progress-line"><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>
        <span>Step {step + 1} / 4</span>
      </div>
      <div className="auth-wizard-steps" aria-label="注册步骤">
        {steps.map((label, index) => (
          <span className={index <= step ? 'active' : ''} key={label}><i>{index < step ? <Check size={11} /> : index + 1}</i>{label}</span>
        ))}
      </div>

      <form className="auth-wizard-form" onSubmit={submit}>
        {step === 0 ? (
          <div className="auth-wizard-fields">
            <label><span>邀请码</span><input value={profile.inviteCode} onChange={(event) => update('inviteCode', event.target.value)} autoComplete="one-time-code" /></label>
            <label><span>昵称</span><input value={profile.name} onChange={(event) => update('name', event.target.value)} autoComplete="name" /></label>
            <label><span>邮箱</span><input type="email" value={profile.email} onChange={(event) => update('email', event.target.value)} autoComplete="email" /></label>
            <label><span>密码</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" /></label>
            <label><span>确认密码</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" /></label>
          </div>
        ) : null}
        {step === 1 ? (
          <div className="auth-wizard-fields">
            <label><span>目标院校</span><input value={profile.targetSchool} onChange={(event) => update('targetSchool', event.target.value)} placeholder="例如：清华大学" /></label>
            <label><span>考试类型</span><select value={profile.examType} onChange={(event) => update('examType', event.target.value)}><option value="11408">统考 11408</option><option value="自命题">自命题 408 方向</option></select></label>
            <label><span>目标分数</span><input type="number" min="1" max="500" value={profile.targetScore} onChange={(event) => update('targetScore', event.target.value)} placeholder="例如：380" /></label>
          </div>
        ) : null}
        {step === 2 ? (
          <div className="auth-wizard-fields auth-wizard-subjects">
            {([['dataStructureLevel', '数据结构水平'], ['operatingSystemLevel', '操作系统水平'], ['computerOrganizationLevel', '计组水平'], ['networkLevel', '网络水平']] as const).map(([key, label]) => (
              <label key={key}><span>{label}</span><select value={profile[key]} onChange={(event) => update(key, event.target.value)}>{levels.map((level) => <option key={level}>{level}</option>)}</select></label>
            ))}
          </div>
        ) : null}
        {step === 3 ? (
          <div className="auth-wizard-fields">
            <label><span>每天学习时间</span><select value={profile.dailyStudyTime} onChange={(event) => update('dailyStudyTime', event.target.value)}><option>1 小时以内</option><option>2-3 小时</option><option>4-6 小时</option><option>6 小时以上</option></select></label>
            <label><span>学习方式</span><select value={profile.studyMode} onChange={(event) => update('studyMode', event.target.value)}><option>理解与练习结合</option><option>先听课再练习</option><option>以真题复盘为主</option></select></label>
            <p className="auth-wizard-note"><LockKeyhole size={14} />你的学习档案仅保存在当前浏览器，之后可在系统内继续完善。</p>
            <input type="hidden" name="inviteCode" value={profile.inviteCode} />
            <input type="hidden" name="name" value={profile.name} />
            <input type="hidden" name="email" value={profile.email} />
            <input type="hidden" name="password" value={password} />
            <input type="hidden" name="confirmPassword" value={confirmPassword} />
          </div>
        ) : null}
        {validationMessage || visibleStatus ? <p className="task-status">{validationMessage || visibleStatus}</p> : null}
        <div className="auth-wizard-actions">
          <button type="button" className="auth-wizard-back" onClick={step === 0 ? onBackToLogin : () => setStep((current) => current - 1)}><ChevronLeft size={16} />{step === 0 ? '返回登录' : '上一步'}</button>
          {step < steps.length - 1 ? <button type="button" className="auth-wizard-next" onClick={nextStep}>下一步<ArrowRight size={16} /></button> : <button type="submit" className="auth-wizard-next">创建学习空间<Sparkles size={16} /></button>}
        </div>
      </form>
    </section>
  );
}
