import { Injectable } from '@nestjs/common';
import { buildDashboardSnapshot, type DashboardSnapshot } from './dashboard.snapshot';
import { StudentStateProjectionService } from './student-state-projection.service';
import { WrongQuestionProjectionService } from './wrong-question-projection.service';
import { TodayPlanProjectionService } from './today-plan-projection.service';
import { PracticeProjectionService } from './practice-projection.service';
import { AssessmentProjectionService } from './assessment-projection.service';

@Injectable()
export class DashboardProjectionService {
  constructor(
    private readonly studentStateProjection: StudentStateProjectionService,
    private readonly wrongQuestionProjection: WrongQuestionProjectionService,
    private readonly todayPlanProjection: TodayPlanProjectionService,
    private readonly practiceProjection: PracticeProjectionService,
    private readonly assessmentProjection: AssessmentProjectionService,
  ) {}

  async getSnapshot(userId: string, asOf: Date = new Date()): Promise<DashboardSnapshot> {
    if (!process.env.DATABASE_URL) return buildDashboardSnapshot({ userId, asOf });

    const [state, wrongQuestions, todayPlan, practiceFacts, assessmentFacts] = await Promise.all([
      this.studentStateProjection.getSnapshot(userId, asOf),
      this.wrongQuestionProjection.getSnapshot(userId, asOf),
      this.todayPlanProjection.getSnapshot(userId, asOf),
      this.practiceProjection.getFacts(userId, asOf),
      this.assessmentProjection.getFacts(userId, asOf),
    ]);

    const tp = todayPlan as unknown as {
      asOf: string;
      planFacts: { planId: string | null; phase: string | null; status: string | null };
      taskFacts: { todayTasks: Array<{ completed: boolean; status: string }> };
      reviewFacts: { dueCount: number };
      summary?: { todayTaskCount?: number; completedTaskCount?: number; completionRate?: number; reviewDueCount?: number };
    };
    const wq = wrongQuestions as unknown as {
      currentWrongItems?: Array<{ review?: { reviewedAt?: string | null }; latestSubmittedAt?: string }>;
      resolvedItems?: unknown[];
      dueItems?: unknown[];
      latestWrongAt?: string | null;
    };

    let reviewedCount = 0;
    if (wq.currentWrongItems) {
      for (const item of wq.currentWrongItems) {
        if (item.review?.reviewedAt) reviewedCount += 1;
      }
    }
    let latestWrongAt: string | null = wq.latestWrongAt ?? null;
    if (!latestWrongAt && wq.currentWrongItems && wq.currentWrongItems.length > 0) {
      latestWrongAt = wq.currentWrongItems[0].latestSubmittedAt ?? null;
      for (const item of wq.currentWrongItems) {
        const candidate = item.latestSubmittedAt ?? null;
        if (candidate && (!latestWrongAt || candidate > latestWrongAt)) latestWrongAt = candidate;
      }
    }

    return buildDashboardSnapshot({
      userId,
      asOf,
      stateFacts: {
        source: 'student_state',
        goal: state.goal,
        mastery: state.mastery,
        weakPoints: state.weakPoints,
        activity: state.reviewDue,
      },
      wrongQuestionFacts: {
        source: 'wrong_question_projection',
        total: wq.currentWrongItems ? wq.currentWrongItems.length : 0,
        unresolved: wq.currentWrongItems ? wq.currentWrongItems.length : 0,
        reviewed: reviewedCount,
        resolved: wq.resolvedItems ? wq.resolvedItems.length : 0,
        latestWrongAt,
        dueCount: wq.dueItems ? wq.dueItems.length : 0,
      },
      todayPlanFacts: {
        source: 'today_plan_projection',
        planId: tp.planFacts.planId,
        phase: tp.planFacts.phase,
        status: tp.planFacts.status,
        todayTaskCount: tp.summary?.todayTaskCount ?? tp.taskFacts.todayTasks.length,
        completedTaskCount: tp.summary?.completedTaskCount ?? 0,
        completionRate: tp.summary?.completionRate ?? 0,
        reviewDueCount: tp.summary?.reviewDueCount ?? tp.reviewFacts.dueCount,
        asOf: tp.asOf,
      },
      practiceFacts,
      assessmentFacts,
    });
  }
}
