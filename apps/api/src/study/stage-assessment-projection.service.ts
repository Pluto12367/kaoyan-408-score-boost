import { Injectable } from '@nestjs/common';
import { buildStageAssessmentSnapshot, type StageAssessmentSnapshot } from './stage-assessment.snapshot';
import { AssessmentProjectionService } from './assessment-projection.service';
import { StudentStateProjectionService } from './student-state-projection.service';
import { WrongQuestionProjectionService } from './wrong-question-projection.service';

@Injectable()
export class StageAssessmentProjectionService {
  constructor(
    private readonly assessmentProjection: AssessmentProjectionService,
    private readonly studentStateProjection: StudentStateProjectionService,
    private readonly wrongQuestionProjection: WrongQuestionProjectionService,
  ) {}

  async getSnapshot(userId: string, asOf: Date = new Date()): Promise<StageAssessmentSnapshot> {
    if (!process.env.DATABASE_URL) return buildStageAssessmentSnapshot({ userId, asOf });

    const [assessment, state, wrongQuestions] = await Promise.all([
      this.assessmentProjection.getFacts(userId, asOf),
      this.studentStateProjection.getSnapshot(userId, asOf),
      this.wrongQuestionProjection.getSnapshot(userId, asOf),
    ]);

    return buildStageAssessmentSnapshot({
      userId,
      asOf,
      studentFacts: {
        stage: state.goal.stage,
        targetScore: state.goal.targetScore,
      },
      assessmentFacts: {
        attemptCount: assessment.attemptCount,
        bestScore: assessment.bestScore,
        latestScore: assessment.latestScore,
        latestAccuracyRate: assessment.latestAccuracyRate,
        lastAssessmentAt: assessment.lastAssessmentAt,
      },
      masteryFacts: {
        source: state.mastery.source,
        averageMastery: state.mastery.averageMastery,
        weakCount: state.mastery.weakCount,
        reviewCount: state.mastery.reviewCount,
        masteredCount: state.mastery.masteredCount,
        weakPoints: state.weakPoints.map((point) => ({
          knowledgeNodeId: point.knowledgeNodeId,
          subject: point.subject,
          chapter: point.chapter,
          title: point.title,
          masteryRate: point.masteryRate,
          accuracyRate: point.accuracyRate,
        })),
      },
      practiceFacts: {
        totalCount: state.studyTasks.today.length,
        todayCount: state.studyTasks.today.length,
        accuracy: state.assessmentSummary.latestAccuracyRate,
        lastPracticeAt: state.wrongQuestionSummary.latestWrongAt,
      },
      wrongQuestionFacts: {
        total: wrongQuestions.currentWrongItems?.length ?? 0,
        unresolved: wrongQuestions.currentWrongItems?.length ?? 0,
        resolved: wrongQuestions.resolvedItems?.length ?? 0,
        dueCount: wrongQuestions.dueItems?.length ?? 0,
        latestWrongAt: state.wrongQuestionSummary.latestWrongAt,
      },
    });
  }
}