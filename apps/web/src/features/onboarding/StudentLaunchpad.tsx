import { useState, type ComponentProps } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { Subject, WeaknessReport } from '@kaoyan408/shared';
import type { LearningCalendar, MasteryMap, WrongQuestionSummary } from '../../api';
import type { GeneratedPaper, PaperSubmitResult } from '../../api';
import type { PrepareExamPaperInput } from '../../api/endpoints/exam';
import type { SessionView } from '../../api/endpoints/sessions';
import { OnboardingWizard } from '../../components/OnboardingWizard';
import { ResumeSessionBanner } from '../../components/ResumeSessionBanner';
import type { RoleSection } from '../../layouts/RoleNavigation';
import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';
import type { TodayPlanTask } from './todayLearningRoute';
import { TodayLearningRoute } from './TodayLearningRouteView';

interface StudentLaunchpadProps {
  showOnboarding: boolean;
  todayPlan: TodayPlanType | null;
  todayPlanLoading: boolean;
  todayPlanError: string;
  todayTaskLaunchingId: string | null;
  todayTaskLaunchError: string;
  latestPaper: GeneratedPaper | null;
  examResult: PaperSubmitResult | null;
  examQuestionCount: number;
  remoteSessionsEnabled: boolean;
  report: WeaknessReport | null;
  masteryMap: MasteryMap | null;
  learningCalendar: LearningCalendar | null;
  wrongQuestionSummary: WrongQuestionSummary | null;
  onOnboardingComplete: ComponentProps<typeof OnboardingWizard>['onComplete'];
  onOpenReview: (questionId: string) => void;
  onResumeSession: (session: SessionView) => void;
  onStartExam: (input: PrepareExamPaperInput) => Promise<void>;
  onNavigate: (section: RoleSection) => void;
  onLaunchTodayTask: (task: TodayPlanTask) => void;
  onRetryTodayPlan: () => void;
  hideFirstStepAction?: boolean;
}

const SUBJECTS: Subject[] = ['数据结构', '计算机组成原理', '操作系统', '计算机网络'];

export function StudentLaunchpad({
  showOnboarding,
  todayPlan,
  todayPlanLoading,
  todayPlanError,
  todayTaskLaunchingId,
  todayTaskLaunchError,
  latestPaper,
  examResult,
  examQuestionCount,
  remoteSessionsEnabled,
  report,
  masteryMap,
  learningCalendar,
  wrongQuestionSummary,
  onOnboardingComplete,
  onOpenReview,
  onResumeSession,
  onStartExam,
  onNavigate,
  onLaunchTodayTask,
  onRetryTodayPlan,
  hideFirstStepAction,
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

  const subjectTones = ['blue', 'teal', 'purple', 'amber'];
  const subjectCards = (masteryMap?.subjects ?? []).map((subject, index) => ({
    title: subject.subject,
    accuracy: subject.averageMastery,
    detail: `${subject.weakCount} 薄弱 · ${subject.reviewCount} 巩固 · ${subject.masteredCount} 掌握`,
    tone: subjectTones[index % subjectTones.length],
  }));

  const focusPoints: Array<{ title: string; rate: string }> = (masteryMap?.weakestPoints ?? []).slice(0, 5)
    .map((point) => ({ title: point.title, rate: `掌握 ${point.masteryRate}%` }));
  if (focusPoints.length === 0) {
    for (const point of (report?.weakPoints ?? []).slice(0, 5)) {
      focusPoints.push({ title: point.title, rate: `正确率 ${point.accuracyRate}%` });
    }
  }

  const recentMistakes = (wrongQuestionSummary?.priorityRedoItems ?? []).slice(0, 4)
    .map((item) => ({ questionId: item.questionId, title: item.knowledgePointTitle || item.stem, count: item.wrongCount }));

  const weekSchedule = todayPlan?.weekProgress?.length
    ? todayPlan.weekProgress.map((day) => ({
        day: day.date.slice(5),
        subjectName: day.focusTitle || `第 ${day.taskCount} 项任务`,
        topic: `${day.completedTasks}/${day.taskCount} 已完成 · ${day.totalMinutes} 分钟`,
      }))
    : (learningCalendar?.days ?? []).map((day) => ({
        day: day.date.slice(5),
        subjectName: `${day.completedTaskCount} 项任务`,
        topic: `${day.practiceCount} 次练习`,
      }));

  const trendDays = (learningCalendar?.days ?? []).slice(-7);
  const trendMaxPractice = Math.max(1, ...trendDays.map((day) => day.practiceCount));
  const currentAverageMastery = masteryMap?.subjects.length
    ? Math.round(masteryMap.subjects.reduce((sum, subject) => sum + subject.averageMastery, 0) / masteryMap.subjects.length)
    : null;
  const masteryTrend = trendDays.map((day) => ({
    label: day.date.slice(5),
    value: Math.max(8, Math.round((day.practiceCount / trendMaxPractice) * 100)),
    practiceCount: day.practiceCount,
    completedTaskCount: day.completedTaskCount,
  }));

  if (showOnboarding) return <OnboardingWizard onComplete={onOnboardingComplete} />;

  return (
    <>
      <TodayLearningRoute
        plan={todayPlan}
        loading={todayPlanLoading}
        error={todayPlanError}
        launchingTaskId={todayTaskLaunchingId}
        launchError={todayTaskLaunchError}
        onRetry={onRetryTodayPlan}
        onLaunch={onLaunchTodayTask}
        onOpenPlan={() => onNavigate('plan')}
        onOpenWrongBook={() => onNavigate('wrong-book')}
        onOpenReport={() => onNavigate('report')}
        hideFirstStepAction={hideFirstStepAction}
      />

      <section className="panel student-subject-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">408 科目模块</p><h3>按科目推进题库训练</h3></div>
          <span>数据用于后续提分报告和错题复盘</span>
        </div>
        <div className="student-subject-grid">
          {subjectCards.length ? subjectCards.map((item) => (
            <article key={item.title} className={`student-subject-card tone-${item.tone}`}>
              <strong>{item.title}</strong>
              <span>平均掌握度 {item.accuracy}%</span>
              <small>{item.detail}</small>
              <div className="progress-bar"><span className="progress-fill" style={{ width: `${item.accuracy}%` }} /></div>
            </article>
          )) : (
            <p className="empty-state">暂无科目掌握度数据，完成练习后自动更新。</p>
          )}
        </div>
      </section>

      <section className="student-focus-grid">
        <div className="panel student-insight-card">
          <div className="panel-heading"><div><p className="eyebrow">薄弱知识点 TOP5</p><h3>优先复盘这些考点</h3></div></div>
          <div className="focus-point-list">
            {focusPoints.length ? focusPoints.map((item, index) => (
              <button type="button" key={item.title} onClick={() => onNavigate('question')}>
                <span>{index + 1}</span>
                <strong>{item.title}</strong>
                <small>{item.rate}</small>
              </button>
            )) : (
              <p className="empty-state">暂无薄弱知识点，完成诊断和练习后自动生成。</p>
            )}
          </div>
        </div>
        <div className="panel student-insight-card">
          <div className="panel-heading"><div><p className="eyebrow">最近错题</p><h3>复盘后再进入同考点训练</h3></div></div>
          <div className="recent-mistake-list">
            {recentMistakes.length ? recentMistakes.map((item) => (
              <button type="button" key={item.questionId} onClick={() => onOpenReview(item.questionId)}>
                <strong>{item.title}</strong>
                <span>错 {item.count} 次 · 点击进入错题详情</span>
              </button>
            )) : (
              <p className="empty-state">暂无近期错题，答错的题目会自动进入这里。</p>
            )}
          </div>
        </div>
        <div className="panel student-schedule-card">
          <div className="panel-heading"><div><p className="eyebrow">本周学习节奏</p><h3>每天只盯一个重点</h3></div></div>
          <div className="week-focus-list">
            {weekSchedule.length ? weekSchedule.map((item) => (
              <article key={item.day}>
                <strong>{item.day}</strong>
                <span>{item.subjectName}</span>
                <small>{item.topic}</small>
              </article>
            )) : (
              <p className="empty-state">暂无本周安排，生成今日计划后自动填充。</p>
            )}
          </div>
        </div>
        <div className="panel student-insight-card">
          <div className="panel-heading"><div><p className="eyebrow">掌握度趋势</p><h3>近 7 天练习节奏</h3></div><button type="button" className="secondary-action" onClick={() => onNavigate('report')}>查看报告</button></div>
          <div className="mastery-trend" aria-label="近 7 天掌握度趋势">
            {masteryTrend.length ? masteryTrend.map((item, index) => (
              <span key={index} style={{ height: `${item.value}%` }} title={`${item.label} · 练习 ${item.practiceCount} 题 · 完成任务 ${item.completedTaskCount} 项`} />
            )) : (
              <p className="empty-state">暂无趋势数据</p>
            )}
          </div>
          <p className="mastery-trend-caption">{currentAverageMastery != null ? `当前平均掌握度 ${currentAverageMastery}%（来自掌握度地图）` : '完成练习后展示平均掌握度'}</p>
        </div>
      </section>

      <ResumeSessionBanner
        enabled={remoteSessionsEnabled}
        allowedTypes={['practice_set', 'stage_assessment', 'paper']}
        onResume={onResumeSession}
        actionClassName="secondary-action"
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
        <button type="button" className="secondary-action" disabled={preparing} onClick={() => void startConfiguredExam()}>
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
