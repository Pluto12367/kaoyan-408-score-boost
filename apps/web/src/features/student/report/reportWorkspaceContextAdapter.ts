import type { StudentContext, StudentContextTrend } from '../../../api';

/**
 * Presentation-only adapter that maps the canonical StudentContext read model
 * to the ReportWorkspace summary view model.
 *
 * This module deliberately does not fetch, call an API, read the clock,
 * recalculate domain facts (mastery, recommendation, trends), create an
 * Action/Task/Event, or touch a database. It only reshapes canonical facts
 * for the report summary bundle. Legacy report analysis (WeaknessReport,
 * StageReport, AssessmentHistory, MasteryTrend, LearningProfile,
 * ReviewResources, trial/reminders/sprint) stays outside this adapter.
 *
 * Identity is preserved:
 *   mastery.weakNodes           -> knowledgeNodeId (Node)
 *   review.dueCount/overdueCount-> existing fields only
 *   plan.todayTasks             -> counts only, studyTaskId/actionId never merged
 *   momentum                    -> streak + activityTrend
 */

export type ReportSummaryStatus = 'sufficient' | 'insufficient_data';

export interface ReportWorkspaceSummary {
  readonly asOf: string;
  readonly status: ReportSummaryStatus;
  readonly mastery: {
    readonly averageMastery: number | null;
    readonly source: 'user_knowledge_mastery' | 'empty';
    readonly weakNodes: readonly {
      readonly knowledgeNodeId: string;
      readonly title: string;
      readonly subject: string;
      readonly masteryRate: number | null;
      readonly status: string;
    }[];
    readonly counts: {
      readonly weak: number;
      readonly review: number;
      readonly mastered: number;
      readonly total: number;
    };
  };
  readonly practice: {
    readonly recentAccuracy: number | null;
    readonly recentVolume: number | null;
    readonly window: string;
    readonly sampleSize: number;
    readonly status: ReportSummaryStatus;
  };
  readonly review: {
    readonly dueCount: number | null;
    readonly overdueCount: number | null;
    readonly status: ReportSummaryStatus;
  };
  readonly plan: {
    readonly completedTaskCount: number | null;
    readonly totalTaskCount: number | null;
    readonly completionRate: number | null;
    readonly todayTaskCount: number;
    readonly status: ReportSummaryStatus;
  };
  readonly momentum: {
    readonly studyStreak: number | null;
    readonly activityTrend: StudentContextTrend<number>;
    readonly status: ReportSummaryStatus;
  };
}

export interface StudentContextLike {
  readonly asOf: string;
  readonly freshness: { readonly status: ReportSummaryStatus };
  readonly mastery: {
    readonly source: 'user_knowledge_mastery' | 'empty';
    readonly weakNodes: readonly {
      readonly knowledgeNodeId: string;
      readonly subject: string;
      readonly title: string;
      readonly mastery: number;
      readonly status: string;
    }[];
    readonly improvingPoints: readonly {
      readonly knowledgeNodeId: string;
      readonly subject: string;
      readonly title: string;
      readonly mastery: number;
      readonly status: string;
    }[];
    readonly masteredPoints: readonly {
      readonly knowledgeNodeId: string;
      readonly subject: string;
      readonly title: string;
      readonly mastery: number;
      readonly status: string;
    }[];
  };
  readonly practice: {
    readonly source: string;
    readonly recentAccuracy: { readonly window: string; readonly sampleSize: number; readonly status: ReportSummaryStatus; readonly value: number | null };
    readonly recentVolume: { readonly status: ReportSummaryStatus; readonly value: number | null };
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
      readonly completedCount: number;
      readonly totalCount: number;
      readonly rate: { readonly status: ReportSummaryStatus; readonly value: number | null };
    };
  };
  readonly momentum: {
    readonly studyStreak: number;
    readonly activityTrend: StudentContextTrend<number>;
  };
}

function asPercent(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(Math.max(0, Math.min(1, value)) * 100);
}

function roundPercent(values: readonly number[]): number | null {
  if (!values.length) return null;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function allNodes(context: StudentContextLike) {
  const nodes = new Map<string, (typeof context.mastery.weakNodes)[number]>();
  for (const node of [
    ...context.mastery.weakNodes,
    ...context.mastery.improvingPoints,
    ...context.mastery.masteredPoints,
  ]) {
    if (!nodes.has(node.knowledgeNodeId)) nodes.set(node.knowledgeNodeId, node);
  }
  return [...nodes.values()];
}

function practiceStatus(context: StudentContextLike): ReportSummaryStatus {
  if (context.practice.source === 'empty') return 'insufficient_data';
  return context.practice.recentAccuracy.status === 'sufficient' || context.practice.recentVolume.status === 'sufficient'
    ? 'sufficient'
    : 'insufficient_data';
}

function reviewStatus(context: StudentContextLike): ReportSummaryStatus {
  return context.review.source === 'empty' ? 'insufficient_data' : 'sufficient';
}

function planStatus(context: StudentContextLike): ReportSummaryStatus {
  if (context.plan.source === 'empty') return 'insufficient_data';
  return context.plan.completion.rate.status;
}

function momentumStatus(context: StudentContextLike): ReportSummaryStatus {
  return context.momentum.activityTrend.status;
}

function hasSufficientData(context: StudentContextLike): boolean {
  return context.freshness.status === 'sufficient'
    && (allNodes(context).length > 0
      || context.practice.recentAccuracy.status === 'sufficient'
      || context.practice.recentVolume.status === 'sufficient'
      || context.review.source !== 'empty'
      || context.plan.source !== 'empty'
      || context.momentum.activityTrend.status === 'sufficient');
}

export function toReportWorkspaceSummary(context: StudentContextLike): ReportWorkspaceSummary {
  const nodes = allNodes(context);
  const mastered = context.mastery.masteredPoints.filter((node) => node.status !== 'weak').length;
  const review = context.mastery.improvingPoints.filter((node) => node.status === 'review').length;
  const weak = context.mastery.weakNodes.length;

  const practiceStat = practiceStatus(context);
  const reviewStat = reviewStatus(context);
  const planStat = planStatus(context);
  const momentumStat = momentumStatus(context);

  return {
    asOf: context.asOf,
    status: hasSufficientData(context) ? 'sufficient' : 'insufficient_data',
    mastery: {
      averageMastery: roundPercent(nodes.map((node) => asPercent(node.mastery)).filter((value): value is number => value != null)),
      source: context.mastery.source,
      weakNodes: context.mastery.weakNodes.map((node) => ({
        knowledgeNodeId: node.knowledgeNodeId,
        title: node.title ?? node.knowledgeNodeId,
        subject: node.subject,
        masteryRate: asPercent(node.mastery),
        status: node.status,
      })),
      counts: {
        weak,
        review,
        mastered,
        total: nodes.length,
      },
    },
    practice: {
      recentAccuracy: context.practice.recentAccuracy.status === 'sufficient' ? asPercent(context.practice.recentAccuracy.value) : null,
      recentVolume: context.practice.recentVolume.status === 'sufficient' ? context.practice.recentVolume.value : null,
      window: context.practice.recentAccuracy.window,
      sampleSize: context.practice.recentAccuracy.sampleSize,
      status: practiceStat,
    },
    review: {
      dueCount: reviewStat === 'sufficient' ? context.review.dueCount : null,
      overdueCount: reviewStat === 'sufficient' ? context.review.overdueCount : null,
      status: reviewStat,
    },
    plan: {
      completedTaskCount: planStat === 'insufficient_data' ? null : context.plan.completion.completedCount,
      totalTaskCount: planStat === 'insufficient_data' ? null : context.plan.completion.totalCount,
      completionRate: planStat === 'sufficient' ? asPercent(context.plan.completion.rate.value) : null,
      todayTaskCount: context.plan.todayTasks.length,
      status: planStat,
    },
    momentum: {
      studyStreak: momentumStat === 'sufficient' ? context.momentum.studyStreak : null,
      activityTrend: context.momentum.activityTrend,
      status: momentumStat,
    },
  };
}

export type ReportWorkspaceContextInput = StudentContext;
