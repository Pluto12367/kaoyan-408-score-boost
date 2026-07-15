import { useState, type ComponentProps } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { Subject } from '@kaoyan408/shared';
import type { GeneratedPaper, PaperSubmitResult } from '../../api';
import type { PrepareExamPaperInput } from '../../api/endpoints/exam';
import type { SessionView } from '../../api/endpoints/sessions';
import { OnboardingWizard } from '../../components/OnboardingWizard';
import { ResumeSessionBanner } from '../../components/ResumeSessionBanner';
import { TodayPlan } from '../../components/TodayPlan';
import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';
import { ModuleUnavailable } from '../../components/ModuleResourceState';

interface StudentLaunchpadProps {
  showOnboarding: boolean;
  todayPlan: TodayPlanType | null;
  todayPlanLoading: boolean;
  todayPlanError: string;
  latestPaper: GeneratedPaper | null;
  examResult: PaperSubmitResult | null;
  examQuestionCount: number;
  remoteSessionsEnabled: boolean;
  onOnboardingComplete: ComponentProps<typeof OnboardingWizard>['onComplete'];
  onRefreshTodayPlan: () => void;
  onOpenReview: (questionId: string) => void;
  onResumeSession: (session: SessionView) => void;
  onStartExam: (input: PrepareExamPaperInput) => Promise<void>;
}

const SUBJECTS: Subject[] = ['数据结构', '计算机组成原理', '操作系统', '计算机网络'];

export function StudentLaunchpad({
  showOnboarding,
  todayPlan,
  todayPlanLoading,
  todayPlanError,
  latestPaper,
  examResult,
  examQuestionCount,
  remoteSessionsEnabled,
  onOnboardingComplete,
  onRefreshTodayPlan,
  onOpenReview,
  onResumeSession,
  onStartExam,
}: StudentLaunchpadProps) {
  const [paperType, setPaperType] = useState<PrepareExamPaperInput['paperType']>('模拟卷');
  const [subject, setSubject] = useState<Subject>('数据结构');
  const [questionCount, setQuestionCount] = useState(40);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState('');

  async function startConfiguredExam() {
    setPreparing(true);
    setPrepareError('');
    try {
      await onStartExam({ paperType, subject: paperType === '专项卷' ? subject : undefined, questionCount });
    } catch (error) {
      setPrepareError(error instanceof Error ? error.message : '试卷准备失败，请重试。');
    } finally {
      setPreparing(false);
    }
  }

  if (showOnboarding) return <OnboardingWizard onComplete={onOnboardingComplete} />;

  return (
    <>
      {todayPlan ? <TodayPlan plan={todayPlan} onRefresh={onRefreshTodayPlan} onOpenReview={onOpenReview} /> : null}
      {!todayPlan && (todayPlanLoading || todayPlanError) ? (
        <ModuleUnavailable
          title="今日计划"
          resource={{ data: null, state: todayPlanLoading ? 'loading' : 'error', error: todayPlanError || undefined }}
          onRetry={onRefreshTodayPlan}
        />
      ) : null}
      <ResumeSessionBanner
        enabled={remoteSessionsEnabled}
        allowedTypes={['practice_set', 'stage_assessment', 'paper']}
        onResume={onResumeSession}
      />
      <section className="panel exam-entry-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">408 模拟考试</p><h3>{latestPaper?.title ?? '当前题库模拟卷'}</h3></div>
          <span>{latestPaper ? `${examQuestionCount} 题` : '待生成'} · 180 分钟</span>
        </div>
        <div className="exam-config-grid">
          <div className="segmented-control" aria-label="试卷类型">
            <button type="button" className={paperType === '模拟卷' ? 'active' : ''} onClick={() => { setPaperType('模拟卷'); setQuestionCount(40); }}>完整模拟卷</button>
            <button type="button" className={paperType === '专项卷' ? 'active' : ''} onClick={() => { setPaperType('专项卷'); setQuestionCount(15); }}>科目专项卷</button>
          </div>
          {paperType === '专项卷' ? (
            <label>训练科目
              <select value={subject} onChange={(event) => setSubject(event.target.value as Subject)}>
                {SUBJECTS.map((item) => <option key={item} value={item}>{item}</option>)}
              </select>
            </label>
          ) : null}
          <label>题目数量
            <input type="number" min="1" max="50" value={questionCount} onChange={(event) => setQuestionCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} />
          </label>
        </div>
        {prepareError ? <p className="task-status">{prepareError}</p> : null}
        <button type="button" className="primary-action" disabled={preparing} onClick={() => void startConfiguredExam()}>
          <ClipboardCheck size={18} /> {preparing ? '正在准备试卷...' : '生成并开始考试'}
        </button>
        {examResult && latestPaper && examResult.paperId === latestPaper.id ? (
          <div className="exam-completion-summary" role="status">
            <strong>本次模拟：{examResult.score} 分</strong>
            <span>正确率 {examResult.accuracyRate}%</span>
            <span>用时 {Math.max(1, Math.round(examResult.examSession.elapsedSec / 60))} 分钟</span>
            <p>{examResult.nextActions[0] ?? '根据失分知识点安排下一轮复盘。'}</p>
          </div>
        ) : null}
      </section>
    </>
  );
}
