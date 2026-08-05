import { useState, type ComponentProps } from 'react';
import { ClipboardCheck } from 'lucide-react';
import type { Subject } from '@kaoyan408/shared';
import type { GeneratedPaper, PaperSubmitResult } from '../../api';
import type { PrepareExamPaperInput } from '../../api/endpoints/exam';
import type { SessionView } from '../../api/endpoints/sessions';
import { OnboardingWizard } from '../../components/OnboardingWizard';
import { ResumeSessionBanner } from '../../components/ResumeSessionBanner';
import { TodayPlan } from '../../components/TodayPlan';
import type { RoleSection } from '../../layouts/RoleNavigation';
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
  onRefreshTodayPlan: () => Promise<void>;
  onOpenReview: (questionId: string) => void;
  onResumeSession: (session: SessionView) => void;
  onStartExam: (input: PrepareExamPaperInput) => Promise<void>;
  onNavigate: (section: RoleSection) => void;
}

const SUBJECTS: Subject[] = ['数据结构', '计算机组成原理', '操作系统', '计算机网络'];
const subjectCards = [
  { title: '数据结构', accuracy: 78, done: '328/420', tone: 'blue' },
  { title: '计算机组成原理', accuracy: 72, done: '305/420', tone: 'teal' },
  { title: '操作系统', accuracy: 68, done: '287/420', tone: 'purple' },
  { title: '计算机网络', accuracy: 75, done: '312/420', tone: 'amber' },
];

const focusPoints = [
  ['中缀表达式求值', '45%'],
  ['虚拟存储器', '52%'],
  ['指令流水线', '55%'],
  ['死锁的预防与避免', '58%'],
  ['子网划分', '60%'],
];

const recentMistakes = [
  'Cache 的访问过程',
  '二叉树的遍历',
  '死锁检测',
  'DHCP 协议',
];

const kpiCards = [
  ['今日任务', '7/10', '建议先完成 2 组专项题'],
  ['连续学习', '12 天', '保持节奏比临时冲刺更稳'],
  ['预计提分', '+18', '来自错题和薄弱点修复'],
  ['待复盘', '24 题', '优先处理近 7 天错题'],
];

const quickActions = [
  ['开始专项训练', '按当前薄弱科目生成一组短练习', 'primary'],
  ['查看错题复盘', '回到错因、解析和同考点练习', 'soft'],
  ['生成提分报告', '查看四科掌握度和下一步建议', 'soft'],
];

const weekSchedule = [
  ['周一', '数据结构', '树与图'],
  ['周二', '组成原理', 'Cache'],
  ['周三', '操作系统', '同步互斥'],
  ['周四', '计算机网络', 'TCP/IP'],
  ['周五', '混合训练', '限时刷题'],
];

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
  onNavigate,
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
      <section className="panel student-dashboard-hero">
        <div className="student-hero-copy">
          <p className="eyebrow">学习总览</p>
          <h3>把今天该做的事先做清楚</h3>
          <p>围绕 408 四科，把计划、刷题、错题和提分报告收在一个工作台里。</p>
          <div className="student-hero-actions">
            <button type="button" className="primary-action" onClick={() => void startConfiguredExam()}>
              <ClipboardCheck size={18} /> 继续刷题
            </button>
            <span>今日任务进度 70% · 已完成 7 / 10</span>
          </div>
        </div>
        <div className="student-plan-ring" aria-label="今日计划进度">
          <strong>70%</strong>
          <span>今日计划</span>
        </div>
      </section>

      <section className="student-kpi-strip" aria-label="学习关键指标">
        {kpiCards.map(([label, value, helper]) => (
          <article key={label} className="student-insight-card">
            <span>{label}</span>
            <strong>{value}</strong>
            <small>{helper}</small>
          </article>
        ))}
      </section>

      <section className="student-action-grid" aria-label="常用学习动作">
        {quickActions.map(([title, description, tone], index) => (
          <article key={title} className={`student-action-card tone-${tone}`}>
            <div>
              <strong>{title}</strong>
              <span>{description}</span>
            </div>
            <button
              type="button"
              className={tone === 'primary' ? 'primary-action' : 'secondary-action'}
              onClick={() => {
                if (index === 0) void startConfiguredExam();
                if (index === 1) onNavigate('wrong-book');
                if (index === 2) onNavigate('report');
              }}
            >
              {index === 0 ? '立即开始' : '查看'}
            </button>
          </article>
        ))}
      </section>

      <section className="panel student-subject-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">408 科目模块</p><h3>按科目推进题库训练</h3></div>
          <span>数据用于后续提分报告和错题复盘</span>
        </div>
        <div className="student-subject-grid">
          {subjectCards.map((item) => (
            <article key={item.title} className={`student-subject-card tone-${item.tone}`}>
              <strong>{item.title}</strong>
              <span>正确率 {item.accuracy}%</span>
              <small>已学 {item.done} 题</small>
              <div className="progress-bar"><span className="progress-fill" style={{ width: `${item.accuracy}%` }} /></div>
            </article>
          ))}
        </div>
      </section>

      <section className="student-focus-grid">
        <div className="panel student-insight-card">
          <div className="panel-heading"><div><p className="eyebrow">薄弱知识点 TOP5</p><h3>优先复盘这些考点</h3></div></div>
          <div className="focus-point-list">
            {focusPoints.map(([title, rate], index) => (
              <article key={title}>
                <span>{index + 1}</span>
                <strong>{title}</strong>
                <small>{rate}</small>
              </article>
            ))}
          </div>
        </div>
        <div className="panel student-insight-card">
          <div className="panel-heading"><div><p className="eyebrow">最近错题</p><h3>复盘后再进入同考点训练</h3></div></div>
          <div className="recent-mistake-list">
            {recentMistakes.map((item) => <span key={item}>× {item}</span>)}
          </div>
        </div>
        <div className="panel student-schedule-card">
          <div className="panel-heading"><div><p className="eyebrow">本周学习节奏</p><h3>每天只盯一个重点</h3></div></div>
          <div className="week-focus-list">
            {weekSchedule.map(([day, subjectName, topic]) => (
              <article key={day}>
                <strong>{day}</strong>
                <span>{subjectName}</span>
                <small>{topic}</small>
              </article>
            ))}
          </div>
        </div>
        <div className="panel student-insight-card">
          <div className="panel-heading"><div><p className="eyebrow">掌握度趋势</p><h3>近 7 天</h3></div></div>
          <div className="mastery-trend" aria-label="掌握度趋势">
            {[38, 42, 50, 49, 64, 62, 75].map((value, index) => (
              <span key={index} style={{ height: `${value}%` }} />
            ))}
          </div>
        </div>
      </section>

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
