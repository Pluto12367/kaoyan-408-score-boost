import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';
import type { LearningCalendar, MasteryMap, WrongQuestionSummary } from '../../api';
import type { RoleSection } from '../../layouts/RoleNavigation';
import type { TodayPlanTask } from '../onboarding/todayLearningRoute';

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

  const selfStudyActions: Array<{ title: string; description: string; section: RoleSection }> = [
    { title: '按薄弱点练', description: weakPoint ?? '使用推荐题组开始专项练习', section: 'question' },
    { title: '按科目练', description: '进入题库训练，自主选择练习方向', section: 'question' },
    { title: '错题复盘', description: dueWrongCount != null ? `${dueWrongCount} 道待处理` : '查看错因和同考点练习', section: 'wrong-book' },
    { title: '阶段测验', description: '用阶段测评检查最近学习效果', section: 'score-center' },
    { title: '学习报告', description: '查看掌握度、趋势和下一步建议', section: 'report' },
    { title: '知识图谱', description: '浏览 408 原子知识点目录', section: 'knowledge-catalog' },
  ];

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
          <span>{dueWrongCount && dueWrongCount > 0 ? '下一步：继续复盘错题' : weakPoint ? '下一步：继续薄弱点练习' : '下一步：查看学习报告'}</span>
        </div>
      ) : null}

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
          <h4>自主学习</h4>
          <div className="self-study-action-grid">
            {selfStudyActions.map((item) => (
              <button type="button" key={item.title} onClick={() => onNavigate(item.section)}>
                <strong>{item.title}</strong>
                <span>{item.description}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
