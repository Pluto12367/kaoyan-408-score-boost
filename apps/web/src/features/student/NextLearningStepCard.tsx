import type { RoleSection } from '../../layouts/RoleNavigation';
import type { WeaknessReport } from '@kaoyan408/shared';
import type { WrongQuestionSummary } from '../../api';
import type { TodayPlan as TodayPlanType } from '../../api/endpoints/onboarding';

export interface NextLearningStepAction {
  label: string;
  targetSection: RoleSection;
}

export interface NextLearningStep {
  contextLabel: string;
  title: string;
  reason: string;
  primaryAction: NextLearningStepAction;
  secondaryAction: NextLearningStepAction;
}

export interface NextLearningStepCardProps {
  step: NextLearningStep;
  onNavigate: (section: RoleSection) => void;
  compact?: boolean;
}

export function NextLearningStepCard({ step, onNavigate, compact = false }: NextLearningStepCardProps) {
  return (
    <section className={`next-learning-step-card ${compact ? 'compact' : ''}`} aria-label={step.contextLabel}>
      <div className="next-learning-step-copy">
        <p className="eyebrow">{step.contextLabel}</p>
        <h4>{step.title}</h4>
        <p><span>为什么推荐</span>{step.reason}</p>
      </div>
      <div className="next-learning-step-actions">
        <button type="button" className="primary-action" onClick={() => onNavigate(step.primaryAction.targetSection)}>
          {step.primaryAction.label}
        </button>
        <button type="button" className="secondary-action" onClick={() => onNavigate(step.secondaryAction.targetSection)}>
          {step.secondaryAction.label}
        </button>
      </div>
    </section>
  );
}

function firstUnfinishedTask(plan: TodayPlanType | null) {
  return plan?.priorityTasks.find((task) => task.status !== 'completed' && !task.completed) ?? null;
}

function firstWeakPoint(report: WeaknessReport | null) {
  return report?.weakPoints[0]?.title ?? null;
}

export function buildDashboardNextLearningStep({
  todayPlan,
  wrongQuestionSummary,
  report,
}: {
  todayPlan: TodayPlanType | null;
  wrongQuestionSummary: WrongQuestionSummary | null;
  report: WeaknessReport | null;
}): NextLearningStep {
  const unfinishedTask = firstUnfinishedTask(todayPlan);
  const pendingWrongCount = wrongQuestionSummary?.pendingCount ?? 0;
  const weakPoint = firstWeakPoint(report);

  if (unfinishedTask) {
    return {
      contextLabel: '首页下一步',
      title: '下一步：完成今日任务',
      reason: `当前还有未完成任务：${unfinishedTask.title}`,
      primaryAction: { label: '去今日任务', targetSection: 'plan' },
      secondaryAction: { label: '直接练题', targetSection: 'question' },
    };
  }
  if (pendingWrongCount > 0) {
    return {
      contextLabel: '首页下一步',
      title: '下一步：错题复盘',
      reason: `今日任务已处理，仍有 ${pendingWrongCount} 道错题待复盘`,
      primaryAction: { label: '去错题本', targetSection: 'wrong-book' },
      secondaryAction: { label: '查看报告', targetSection: 'report' },
    };
  }
  if (weakPoint) {
    return {
      contextLabel: '首页下一步',
      title: '下一步：薄弱点训练',
      reason: `当前报告显示优先巩固：${weakPoint}`,
      primaryAction: { label: '去练习', targetSection: 'question' },
      secondaryAction: { label: '查看报告', targetSection: 'report' },
    };
  }
  return {
    contextLabel: '首页下一步',
    title: '下一步：学习报告',
    reason: '当前没有明显待处理压力，可以查看报告确认下一轮方向',
    primaryAction: { label: '查看报告', targetSection: 'report' },
    secondaryAction: { label: '继续训练', targetSection: 'question' },
  };
}

export function buildPlanNextLearningStep(plan: TodayPlanType): NextLearningStep {
  const unfinishedTask = firstUnfinishedTask(plan);
  if (unfinishedTask) {
    return {
      contextLabel: '今日任务下一步',
      title: unfinishedTask.status === 'in_progress' ? '下一步：继续当前任务' : '下一步：开始最高优先级任务',
      reason: `${unfinishedTask.subject} · ${unfinishedTask.chapter} · ${unfinishedTask.questionCount} 题`,
      primaryAction: { label: '去练题', targetSection: 'question' },
      secondaryAction: { label: '回首页', targetSection: 'dashboard' },
    };
  }
  if (plan.reviewDue > 0) {
    return {
      contextLabel: '今日任务下一步',
      title: '下一步：处理到期复盘',
      reason: `今日任务已完成，还有 ${plan.reviewDue} 道到期复习`,
      primaryAction: { label: '去错题本', targetSection: 'wrong-book' },
      secondaryAction: { label: '查看报告', targetSection: 'report' },
    };
  }
  return {
    contextLabel: '今日任务下一步',
    title: '下一步：确认学习变化',
    reason: '今日任务已完成，建议查看报告确认掌握度变化',
    primaryAction: { label: '查看报告', targetSection: 'report' },
    secondaryAction: { label: '继续训练', targetSection: 'question' },
  };
}

export function buildPracticeNextLearningStep({
  correct,
  hasNextQuestion = false,
  knowledgePointTitle = null,
}: {
  correct?: boolean | null;
  hasNextQuestion?: boolean;
  knowledgePointTitle?: string | null;
}): NextLearningStep {
  if (correct === false) {
    return {
      contextLabel: '训练结果下一步',
      title: '下一步：复盘本题错因',
      reason: `本题暴露了${knowledgePointTitle ? `「${knowledgePointTitle}」` : '当前考点'}的薄弱处`,
      primaryAction: { label: '去错题本', targetSection: 'wrong-book' },
      secondaryAction: { label: hasNextQuestion ? '继续下一题' : '继续训练', targetSection: 'question' },
    };
  }
  return {
    contextLabel: '训练结果下一步',
    title: hasNextQuestion ? '下一步：继续下一题' : '下一步：继续专项训练',
    reason: correct === true ? '本题已形成正向练习记录，继续同节奏巩固' : '完成本组训练后继续推进薄弱点',
    primaryAction: { label: '继续训练', targetSection: 'question' },
    secondaryAction: { label: '查看报告', targetSection: 'report' },
  };
}

export function buildWrongBookNextLearningStep({
  pendingCount,
  filteredKnowledgePointTitle = null,
}: {
  pendingCount: number;
  filteredKnowledgePointTitle?: string | null;
}): NextLearningStep {
  if (pendingCount > 0) {
    return {
      contextLabel: '错题本下一步',
      title: '下一步：继续复盘',
      reason: `仍有 ${pendingCount} 道错题待处理${filteredKnowledgePointTitle ? `，当前聚焦 ${filteredKnowledgePointTitle}` : ''}`,
      primaryAction: { label: '继续复盘', targetSection: 'wrong-book' },
      secondaryAction: { label: '再练同考点', targetSection: 'question' },
    };
  }
  return {
    contextLabel: '错题本下一步',
    title: '下一步：验证复盘效果',
    reason: '当前待复盘压力降低，可以通过训练或报告确认掌握变化',
    primaryAction: { label: '再练同考点', targetSection: 'question' },
    secondaryAction: { label: '查看报告', targetSection: 'report' },
  };
}

export function buildReportNextLearningStep(report: WeaknessReport): NextLearningStep {
  const weakPoint = firstWeakPoint(report);
  if (weakPoint) {
    return {
      contextLabel: '报告下一步',
      title: '下一步：把报告结论落到训练',
      reason: `当前最优先补强：${weakPoint}`,
      primaryAction: { label: '去练薄弱点', targetSection: 'question' },
      secondaryAction: { label: '去错题本', targetSection: 'wrong-book' },
    };
  }
  return {
    contextLabel: '报告下一步',
    title: '下一步：回到今日任务',
    reason: '暂未形成明确薄弱点，先继续积累今日任务和训练记录',
    primaryAction: { label: '回首页', targetSection: 'dashboard' },
    secondaryAction: { label: '继续训练', targetSection: 'question' },
  };
}
