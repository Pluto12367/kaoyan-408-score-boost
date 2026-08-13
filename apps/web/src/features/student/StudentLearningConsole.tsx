import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';
import type { LearningCalendar, MasteryMap, WrongQuestionSummary } from '../../api';
import type { RoleSection } from '../../layouts/RoleNavigation';
import { deriveTodayTaskNextStep, type TodayPlanTask } from '../onboarding/todayLearningRoute';

export interface StudentLearningConsoleProps {
  todayPlan: TodayPlanType | null;
  todayPlanLoading: boolean;
  todayPlanError: string;
  wrongQuestionSummary: WrongQuestionSummary | null;
  masteryMap: MasteryMap | null;
  learningCalendar: LearningCalendar | null;
  onNavigate: (section: RoleSection) => void;
  onLaunchTodayTask: (task: TodayPlanTask) => void;
}

function firstUnfinishedTask(plan: TodayPlanType | null) {
  return plan?.priorityTasks.find((task) => task.status !== 'completed' && !task.completed) ?? null;
}

function weakestPointTitle(masteryMap: MasteryMap | null) {
  return masteryMap?.weakestPoints?.[0]?.title ?? null;
}

function completedTaskTitles(plan: TodayPlanType | null) {
  return plan?.priorityTasks
    .filter((task) => task.status === 'completed' || task.completed)
    .map((task) => task.title) ?? [];
}

function latestCompletedTaskId(plan: TodayPlanType | null) {
  return plan?.priorityTasks
    .filter((task) => task.status === 'completed' || task.completed)
    .at(-1)?.id ?? null;
}

export function StudentLearningConsole({
  todayPlan,
  todayPlanLoading,
  todayPlanError,
  wrongQuestionSummary,
  masteryMap,
  learningCalendar,
  onNavigate,
  onLaunchTodayTask,
}: StudentLearningConsoleProps) {
  const task = firstUnfinishedTask(todayPlan);
  const dueWrongCount = wrongQuestionSummary?.pendingCount ?? null;
  const weakPoint = weakestPointTitle(masteryMap);
  const completedTitles = completedTaskTitles(todayPlan);
  const completedNextStep = completedTitles.length
    ? deriveTodayTaskNextStep(todayPlan, latestCompletedTaskId(todayPlan), dueWrongCount ?? 0)
    : null;
  const completionText = todayPlan
    ? `${todayPlan.summary.completedTasks}/${todayPlan.summary.totalTasks}`
    : todayPlanLoading
      ? '加载中'
      : '--';
  const nextSuggestion = task
    ? `先完成最高优先级任务：${task.title}`
    : dueWrongCount && dueWrongCount > 0
      ? `下一步：继续复盘错题（${dueWrongCount} 道待处理）`
      : '今日任务完成后，可以继续薄弱点练习或查看学习报告';
  const completedSummary = completedTitles.length
    ? `已完成：${completedTitles.slice(0, 2).join('、')}${completedTitles.length > 2 ? ' 等' : ''}`
    : null;

  const pathItems = [
    {
      title: task ? '第 1 步：开始今日优先任务' : '第 1 步：确认今日计划',
      description: task ? `${task.subject} · ${task.chapter} · ${task.minutes} 分钟` : (todayPlanError || '今日计划准备好后会显示优先任务'),
      action: '开始今日任务',
      onClick: () => {
        if (task) {
          onLaunchTodayTask(task);
        } else {
          onNavigate('plan');
        }
      },
    },
    {
      title: '第 2 步：复盘错题',
      description: dueWrongCount != null ? `${dueWrongCount} 道错题待复盘` : '错题数据加载后显示数量',
      action: '去错题本',
      onClick: () => onNavigate('wrong-book'),
    },
    {
      title: '第 3 步：薄弱点练习',
      description: weakPoint ? `当前优先：${weakPoint}` : '暂无薄弱点时使用推荐题组',
      action: '开始练习',
      onClick: () => onNavigate('question'),
    },
  ];

  const selfStudyRecommendations: Array<{ title: string; description: string; action: string; targetSection: RoleSection }> = [
    { title: '薄弱知识点', description: weakPoint ? `当前优先巩固：${weakPoint}` : '暂无明确薄弱点时，先用推荐题组热身', action: '去练薄弱点', targetSection: 'question' },
    { title: '错题复盘', description: dueWrongCount != null ? `${dueWrongCount} 道错题等待复盘` : '查看错因、重做和同考点变式', action: '去错题本', targetSection: 'wrong-book' },
    { title: '专项训练', description: '进入题库训练，按当前目标继续刷题', action: '开始专项练习', targetSection: 'question' },
    { title: '报告查看', description: '查看掌握度、趋势和下一步建议', action: '查看学习报告', targetSection: 'report' },
  ];

  const todayOutcomeItems = [
    { title: '更新掌握度', description: task ? `完成今日任务后会同步 ${task.subject} 学习进度` : '完成练习后会更新你的掌握度变化' },
    { title: '减少待复盘', description: dueWrongCount != null ? `复盘后待处理错题会减少，当前还有 ${dueWrongCount} 道` : '复盘错题会帮助清理待处理队列' },
    { title: '推进薄弱点', description: weakPoint ? `当前重点推进：${weakPoint}` : '专项训练会帮助你发现并推进薄弱点' },
    { title: '明确下一步', description: '查看报告后，可以确认下一轮学习方向' },
  ];

  const recentLearningFeedback = completedTitles.length
    ? {
      action: `已完成：${completedTitles.at(-1)}`,
      recorded: '系统已记录本次任务进度，并用于更新今日完成情况',
      next: completedNextStep ? completedNextStep.message : '建议下一步：查看学习报告',
    }
    : task
      ? {
        action: `待完成：${task.title}`,
        recorded: '系统会在你完成练习后同步掌握度和今日任务进度',
        next: `建议下一步：先完成 ${task.subject} · ${task.chapter}`,
      }
      : dueWrongCount && dueWrongCount > 0
        ? {
          action: `错题复盘：还有 ${dueWrongCount} 道`,
          recorded: '系统会记录复盘结果，并减少待处理错题数',
          next: '建议下一步：去错题本完成复盘',
        }
        : {
          action: '暂无新的学习反馈',
          recorded: '开始练习或复盘后，系统会在这里显示记录结果',
          next: '建议下一步：开始今日任务或专项训练',
        };

  return (
    <section className="panel student-learning-console" aria-label="学生学习中控台">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">学习中控台</p>
          <h3>今天先做什么，一眼看清</h3>
        </div>
        <span>{nextSuggestion}</span>
      </div>

      <div className="learning-console-status" aria-label="当前状态">
        <article><span>今日完成</span><strong>{completionText}</strong></article>
        <article><span>今日正确率</span><strong>{todayPlan ? `${todayPlan.summary.todayAccuracyRate}%` : '--'}</strong></article>
        <article><span>连续学习</span><strong>{todayPlan?.summary.streakDays ?? learningCalendar?.streakDays ?? '--'} 天</strong></article>
        <article><span>待复盘错题</span><strong>{dueWrongCount ?? '--'} 道</strong></article>
      </div>

      {completedSummary ? (
        <div className="learning-console-next-step" role="status">
          <strong>{completedSummary}</strong>
          <span>{completedNextStep ? completedNextStep.message : '下一步：查看学习报告'}</span>
          {completedNextStep ? (
            <button type="button" className="secondary-action" onClick={() => onNavigate(completedNextStep.targetSection)}>{completedNextStep.actionLabel}</button>
          ) : null}
        </div>
      ) : null}

      <div className="learning-outcome-card">
        <h4>今天完成后，你会得到</h4>
        <div className="learning-outcome-grid">
          {todayOutcomeItems.map((item) => (
            <article key={item.title}>
              <strong>{item.title}</strong>
              <span>{item.description}</span>
            </article>
          ))}
        </div>
      </div>

      <div className="recent-learning-feedback-card">
        <h4>最近一次学习反馈</h4>
        <div className="recent-learning-feedback-grid">
          <article><span>最近动作</span><strong>{recentLearningFeedback.action}</strong></article>
          <article><span>系统已记录</span><strong>{recentLearningFeedback.recorded}</strong></article>
          <article><span>建议下一步</span><strong>{recentLearningFeedback.next}</strong></article>
        </div>
      </div>

      <div className="learning-console-grid">
        <div className="learning-path-card">
          <h4>今日学习路径</h4>
          {pathItems.map((item) => (
            <article key={item.title}>
              <div><strong>{item.title}</strong><span>{item.description}</span></div>
              <button type="button" className="secondary-action" onClick={item.onClick}>{item.action}</button>
            </article>
          ))}
        </div>
        <div className="self-study-card">
          <h4>自主学习推荐区</h4>
          <div className="self-study-recommendation-grid">
            {selfStudyRecommendations.map((item) => (
              <button type="button" key={item.title} onClick={() => onNavigate(item.targetSection)}>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
                <em>{item.action}</em>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
