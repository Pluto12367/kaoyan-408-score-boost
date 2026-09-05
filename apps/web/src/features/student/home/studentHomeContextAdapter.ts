/**
 * Presentation-only adapter for the StudentHome summary.
 *
 * StudentContext remains the canonical read model. This module deliberately
 * does not fetch, recalculate domain facts, read the clock, or mutate input.
 * The legacy TodayPlan task objects stay outside this adapter because their
 * question/mode fields are still required to launch a task.
 */

export type StudentHomeSummaryStatus = 'sufficient' | 'insufficient_data';

export interface StudentContextTrendLike<T> {
  readonly window: string;
  readonly baseline: T | null;
  readonly sampleSize: number;
  readonly status: StudentHomeSummaryStatus;
  readonly value: T | null;
}

export interface StudentContextNodeLike {
  readonly knowledgeNodeId: string;
  readonly subject?: string;
  readonly title?: string;
  readonly mastery: number;
  readonly status?: string;
}

export interface StudentContextForHome {
  readonly asOf: string;
  readonly freshness: { readonly status: StudentHomeSummaryStatus };
  readonly mastery: {
    readonly source: string;
    readonly weakNodes: readonly StudentContextNodeLike[];
    readonly improvingPoints: readonly StudentContextNodeLike[];
    readonly masteredPoints: readonly StudentContextNodeLike[];
  };
  readonly practice: {
    readonly source: string;
    readonly recentAccuracy: StudentContextTrendLike<number>;
    readonly recentVolume: StudentContextTrendLike<number>;
  };
  readonly review: {
    readonly source: string;
    readonly dueCount: number;
    readonly overdueCount: number;
  };
  readonly plan: {
    readonly source: string;
    readonly todayTasks: readonly unknown[];
    readonly completion: {
      readonly rate: StudentContextTrendLike<number>;
      readonly completedCount: number;
      readonly totalCount: number;
    };
  };
  readonly momentum: {
    readonly studyStreak: number;
    readonly activityTrend: StudentContextTrendLike<number>;
  };
  readonly recommendationEvidence?: readonly unknown[];
}

export interface StudentHomeSubjectSummary {
  readonly id: string;
  readonly name: string;
  readonly value: number | null;
  readonly status: 'weak' | 'review' | 'mastered' | 'unknown';
}

export interface StudentHomeSummary {
  readonly asOf: string;
  readonly status: StudentHomeSummaryStatus;
  readonly mastery: {
    readonly averageMastery: number | null;
    readonly subjects: readonly StudentHomeSubjectSummary[];
    readonly weakNode: { readonly knowledgeNodeId: string; readonly title: string } | null;
  };
  readonly practice: {
    readonly recentAccuracy: number | null;
    readonly recentVolume: number | null;
    readonly window: string;
    readonly sampleSize: number;
    readonly status: StudentHomeSummaryStatus;
  };
  readonly review: {
    readonly dueCount: number | null;
    readonly overdueCount: number | null;
    readonly status: StudentHomeSummaryStatus;
  };
  readonly plan: {
    readonly completedTaskCount: number | null;
    readonly totalTaskCount: number | null;
    readonly completionRate: number | null;
    readonly status: StudentHomeSummaryStatus;
  };
  readonly momentum: {
    readonly studyStreak: number | null;
    readonly activityTrend: StudentContextTrendLike<number>;
    readonly status: StudentHomeSummaryStatus;
  };
  readonly recommendationEvidenceCount: number;
}

const SUBJECTS = [
  { id: 'ds', name: '数据结构' },
  { id: 'os', name: '操作系统' },
  { id: 'co', name: '计算机组成原理' },
  { id: 'net', name: '计算机网络' },
] as const;

function subjectId(subject: string | undefined): string {
  if (subject?.includes('数据')) return 'ds';
  if (subject?.includes('操作')) return 'os';
  if (subject?.includes('组成')) return 'co';
  if (subject?.includes('网络')) return 'net';
  return '';
}

function asPercent(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function masteryStatus(value: number | null): StudentHomeSubjectSummary['status'] {
  if (value == null) return 'unknown';
  if (value >= 80) return 'mastered';
  if (value >= 60) return 'review';
  return 'weak';
}

function roundPercent(values: readonly number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function allNodes(context: StudentContextForHome): StudentContextNodeLike[] {
  const nodes = new Map<string, StudentContextNodeLike>();
  for (const node of [
    ...context.mastery.weakNodes,
    ...context.mastery.improvingPoints,
    ...context.mastery.masteredPoints,
  ]) {
    if (!nodes.has(node.knowledgeNodeId)) nodes.set(node.knowledgeNodeId, node);
  }
  return [...nodes.values()];
}

function hasSufficientContextData(context: StudentContextForHome): boolean {
  return context.freshness.status === 'sufficient'
    && (allNodes(context).length > 0
      || context.practice.recentAccuracy.status === 'sufficient'
      || context.practice.recentVolume.status === 'sufficient'
      || context.review.source !== 'empty'
      || context.plan.source !== 'empty'
      || context.momentum.activityTrend.status === 'sufficient');
}

export function toStudentHomeSummary(context: StudentContextForHome): StudentHomeSummary {
  const nodes = allNodes(context);
  const bySubject = new Map<string, number[]>();
  for (const node of nodes) {
    const id = subjectId(node.subject);
    if (!id || !Number.isFinite(node.mastery)) continue;
    const values = bySubject.get(id) ?? [];
    values.push(asPercent(node.mastery) ?? 0);
    bySubject.set(id, values);
  }

  const subjects = SUBJECTS.map((subject) => {
    const value = roundPercent(bySubject.get(subject.id) ?? []);
    return { ...subject, value, status: masteryStatus(value) };
  });
  const averageMastery = roundPercent(nodes.map((node) => asPercent(node.mastery)).filter((value): value is number => value != null));
  const weakNode = context.mastery.weakNodes[0]
    ? {
        knowledgeNodeId: context.mastery.weakNodes[0].knowledgeNodeId,
        title: context.mastery.weakNodes[0].title ?? context.mastery.weakNodes[0].knowledgeNodeId,
      }
    : null;
  const practiceStatus = context.practice.source === 'empty'
    ? 'insufficient_data'
    : context.practice.recentAccuracy.status === 'sufficient' || context.practice.recentVolume.status === 'sufficient'
      ? 'sufficient'
      : 'insufficient_data';
  const reviewStatus = context.review.source === 'empty' ? 'insufficient_data' : 'sufficient';
  const planStatus = context.plan.source === 'empty' ? 'insufficient_data' : context.plan.completion.rate.status;
  const momentumStatus = context.momentum.activityTrend.status;

  return {
    asOf: context.asOf,
    status: hasSufficientContextData(context) ? 'sufficient' : 'insufficient_data',
    mastery: {
      averageMastery,
      subjects,
      weakNode,
    },
    practice: {
      recentAccuracy: context.practice.recentAccuracy.status === 'sufficient' ? asPercent(context.practice.recentAccuracy.value) : null,
      recentVolume: context.practice.recentVolume.status === 'sufficient' ? context.practice.recentVolume.value : null,
      window: context.practice.recentAccuracy.window,
      sampleSize: context.practice.recentAccuracy.sampleSize,
      status: practiceStatus,
    },
    review: {
      dueCount: reviewStatus === 'sufficient' ? context.review.dueCount : null,
      overdueCount: reviewStatus === 'sufficient' ? context.review.overdueCount : null,
      status: reviewStatus,
    },
    plan: {
      completedTaskCount: planStatus === 'insufficient_data' ? null : context.plan.completion.completedCount,
      totalTaskCount: planStatus === 'insufficient_data' ? null : context.plan.completion.totalCount,
      completionRate: planStatus === 'sufficient' ? asPercent(context.plan.completion.rate.value) : null,
      status: planStatus,
    },
    momentum: {
      studyStreak: momentumStatus === 'sufficient' ? context.momentum.studyStreak : null,
      activityTrend: context.momentum.activityTrend,
      status: momentumStatus,
    },
    recommendationEvidenceCount: context.recommendationEvidence?.length ?? 0,
  };
}

