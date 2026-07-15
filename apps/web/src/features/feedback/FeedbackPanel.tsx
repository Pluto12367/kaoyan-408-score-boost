import { useState, type FormEvent } from 'react';
import {
  FEEDBACK_SCENES,
  countUnicodeCharacters,
  validateFeedbackDraft,
  type FeedbackDraft,
  type FeedbackDraftErrors,
  type FeedbackScene,
} from '@kaoyan408/shared';

const SURVEY_URL = 'https://wj.qq.com/s2/27160624/40fe/';

const SCENE_LABELS: Record<FeedbackScene, string> = {
  diagnostic: '入学诊断',
  today_plan: '今日计划',
  practice: '专项练习',
  mistakes: '错题复盘',
  exam: '阶段测评与模考',
  overall: '整体体验',
};

interface FeedbackPanelProps {
  status: string;
  onSubmit: (draft: FeedbackDraft) => Promise<boolean>;
}

export function FeedbackPanel({ status, onSubmit }: FeedbackPanelProps) {
  const [scene, setScene] = useState<FeedbackScene>('overall');
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<FeedbackDraftErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const messageLength = countUnicodeCharacters(message);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;

    const validation = validateFeedbackDraft({ rating, scene, message });
    if (!validation.valid) {
      setErrors(validation.errors);
      return;
    }

    setErrors({});
    setIsSubmitting(true);
    try {
      const succeeded = await onSubmit(validation.value);
      if (succeeded) setMessage('');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section id="feedback" className="panel feedback-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">体验反馈</p><h3>把真实使用感受告诉我们</h3></div>
        <a className="secondary-link" href={SURVEY_URL} target="_blank" rel="noreferrer">填写腾讯问卷</a>
      </div>

      <form className="feedback-form" onSubmit={handleSubmit} noValidate>
        <div className="feedback-fields">
          <label>
            <span>反馈场景</span>
            <select
              value={scene}
              onChange={(event) => {
                setScene(event.target.value as FeedbackScene);
                setErrors((current) => ({ ...current, scene: undefined }));
              }}
              disabled={isSubmitting}
            >
              {FEEDBACK_SCENES.map((value) => <option key={value} value={value}>{SCENE_LABELS[value]}</option>)}
            </select>
          </label>

          <fieldset className="feedback-rating" disabled={isSubmitting}>
            <legend>体验评分</legend>
            <div role="radiogroup" aria-describedby={errors.rating ? 'feedback-rating-error' : undefined}>
              {[1, 2, 3, 4, 5].map((value) => (
                <label key={value} className={rating === value ? 'selected' : ''}>
                  <input
                    type="radio"
                    name="feedback-rating"
                    value={value}
                    checked={rating === value}
                    onChange={() => {
                      setRating(value);
                      setErrors((current) => ({ ...current, rating: undefined }));
                    }}
                  />
                  <span>{value} 分</span>
                </label>
              ))}
            </div>
            {errors.rating ? <p id="feedback-rating-error" className="feedback-error">{errors.rating}</p> : null}
          </fieldset>
        </div>

        <label className="feedback-message">
          <span>反馈正文</span>
          <textarea
            value={message}
            onChange={(event) => {
              setMessage(event.target.value);
              setErrors((current) => ({ ...current, message: undefined }));
            }}
            rows={6}
            placeholder="请描述你遇到的问题、喜欢的部分，或希望如何改进。"
            aria-describedby="feedback-message-help feedback-message-count"
            aria-invalid={Boolean(errors.message)}
            disabled={isSubmitting}
          />
          <span id="feedback-message-help" className="feedback-field-help">去除首尾空格后需填写 10-1000 个字符</span>
          <span id="feedback-message-count" className={messageLength > 1000 ? 'feedback-count over-limit' : 'feedback-count'}>{messageLength}/1000</span>
          {errors.message ? <span className="feedback-error">{errors.message}</span> : null}
        </label>

        <aside className="feedback-privacy" role="note">
          <strong>提交前请检查敏感信息</strong>
          <p>站内反馈正文请勿填写身份证号、准考证号、账号密码、手机号、微信号或其他联系方式。</p>
          <p>反馈数据仅用于定位内测问题、分析学习流程体验和改进产品，不会在学生端展示反馈内容或全局统计。</p>
        </aside>

        <div className="feedback-submit-row">
          <p className="task-status" aria-live="polite">{status}</p>
          <button type="submit" className="primary-action" disabled={isSubmitting}>
            {isSubmitting ? '正在提交...' : '提交反馈'}
          </button>
        </div>
      </form>
    </section>
  );
}
