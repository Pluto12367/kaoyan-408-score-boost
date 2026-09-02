import type { UserProfile, WeaknessReport } from '@kaoyan408/shared';
import type { CanonicalOverview, LearningCalendar, MasteryMap, WrongQuestionSummary } from '../../../api';
import type { TodayPlan as TodayPlanType } from '../../../api/endpoints/onboarding';

export interface DashboardSubjectViewModel {
  id: string;
  name: string;
  value: number;
  status: 'weak' | 'review' | 'mastered' | 'unknown';
  deltaText: string;
}

export interface DashboardTaskViewModel {
  id: string;
  title: string;
  subject: string;
  detail: string;
  completed: boolean;
  progressText: string;
  source: NonNullable<TodayPlanType>['priorityTasks'][number];
}

export interface DashboardViewModel {
  greetingName: string;
  targetSchool: string;
  remainingDays: number | null;
  dailyHours: number | null;
  stage: string;
  averageMastery: number | null;
  subjects: DashboardSubjectViewModel[];
  tasks: DashboardTaskViewModel[];
  completedTaskCount: number;
  totalTaskCount: number;
  completionRate: number;
  weakPointTitle: string | null;
  weakPointReason: string | null;
  pendingWrongCount: number | null;
  trend: Array<{ label: string; value: number; practiceCount: number; active: boolean }>;
}

const SUBJECTS = [
  { id: 'ds', name: '数据结构' },
  { id: 'os', name: '操作系统' },
  { id: 'co', name: '计算机组成原理' },
  { id: 'net', name: '计算机网络' },
] as const;

function subjectStatus(value: number): DashboardSubjectViewModel['status'] {
  if (value >= 80) return 'mastered';
  if (value >= 60) return 'review';
  return 'weak';
}

function subjectId(name: string) {
  if (name.includes('数据')) return 'ds';
  if (name.includes('操作')) return 'os';
  if (name.includes('组成')) return 'co';
  return 'net';
}

export function useDashboardViewModel(input: {
  student: UserProfile;
  todayPlan: TodayPlanType | null;
  masteryMap: MasteryMap | null;
  report: WeaknessReport;
  wrongQuestionSummary: WrongQuestionSummary | null;
  learningCalendar: LearningCalendar | null;
  canonicalOverview?: CanonicalOverview | null;
}): DashboardViewModel {
  const { student, todayPlan, masteryMap, report, wrongQuestionSummary, learningCalendar, canonicalOverview } = input;
  const canonicalMasteryBySubject = new Map<string, number[]>();
  for (const node of canonicalOverview?.mastery.nodes ?? []) {
    const values = canonicalMasteryBySubject.get(subjectId(node.subject)) ?? [];
    if (node.masteryRate != null) values.push(node.masteryRate);
    canonicalMasteryBySubject.set(subjectId(node.subject), values);
  }
  const masteryBySubject = canonicalOverview
    ? new Map([...canonicalMasteryBySubject.entries()].map(([id, values]) => [id, values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null]))
    : new Map((masteryMap?.subjects ?? []).map((item) => [subjectId(item.subject), item.averageMastery]));
  const subjects = SUBJECTS.map((subject) => {
    const value = masteryBySubject.get(subject.id);
    return {
      ...subject,
      value: value ?? 0,
      status: value == null ? 'unknown' : subjectStatus(value),
      deltaText: value == null ? '等待学习数据' : value >= 70 ? '保持节奏' : '建议优先巩固',
    };
  });
  const tasks = (todayPlan?.priorityTasks ?? []).slice(0, 5).map((task) => ({
    id: task.id,
    title: task.title,
    subject: task.subject,
    detail: `${task.chapter} · ${task.minutes} 分钟`,
    completed: Boolean(task.completed || task.status === 'completed'),
    progressText: task.progress?.reachedTarget
      ? `${task.progress.completedQuestionCount}/${task.questionCount} 题`
      : `${task.questionCount} 题`,
    source: task,
  }));
  const completedTaskCount = todayPlan?.summary.completedTasks ?? tasks.filter((task) => task.completed).length;
  const totalTaskCount = todayPlan?.summary.totalTasks ?? tasks.length;
  const completionRate = todayPlan?.summary.completionRate ?? (totalTaskCount ? Math.round((completedTaskCount / totalTaskCount) * 100) : 0);
  const trend = (learningCalendar?.days ?? []).slice(-7).map((day) => ({
    label: day.date.slice(5),
    value: day.completedTaskCount * 24 + day.practiceCount * 8,
    practiceCount: day.practiceCount,
    active: day.isActive,
  }));

  return {
    greetingName: student.name,
    targetSchool: student.targetSchool ?? '目标院校待设置',
    remainingDays: student.remainingDays ?? null,
    dailyHours: student.dailyHours ?? null,
    stage: student.stage ?? '基础阶段',
    averageMastery: canonicalOverview
      ? canonicalOverview.mastery.averageMastery
      : masteryMap?.subjects.length
      ? Math.round(masteryMap.subjects.reduce((sum, item) => sum + item.averageMastery, 0) / masteryMap.subjects.length)
      : null,
    subjects,
    tasks,
    completedTaskCount,
    totalTaskCount,
    completionRate,
    weakPointTitle: canonicalOverview
      ? canonicalOverview.weaknesses.nodeWeaknesses[0]?.title ?? null
      : masteryMap?.weakestPoints[0]?.title ?? report.weakPoints[0]?.title ?? null,
    weakPointReason: canonicalOverview
      ? (canonicalOverview.weaknesses.nodeWeaknesses[0] ? '基于节点掌握度证据' : null)
      : report.weakPoints[0]?.suggestion ?? null,
    pendingWrongCount: canonicalOverview?.reviewStatus.pendingWrongQuestionCount ?? wrongQuestionSummary?.pendingCount ?? null,
    trend,
  };
}
