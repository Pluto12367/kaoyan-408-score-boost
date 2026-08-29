import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentStateProjectionService } from './student-state-projection.service';
import {
  buildTrialProgressDto,
  type TrialProgressDto,
} from './student-state-trial-progress.adapter';
import { StudyService } from './study.service';

// 过渡期兼容层：遗留 /trial-progress 契约未被投影链完整覆盖前，委托遗留实现。
@Injectable()
export class StudentStateTrialProgressQueryService {
  constructor(
    private readonly studentStateProjection: StudentStateProjectionService,
    private readonly prisma: PrismaService,
    @Optional() private readonly legacy?: StudyService,
  ) {}

  async getTrialProgressCompat(
    userId: string,
    generatedAt: Date | string = new Date(),
  ): Promise<TrialProgressDto> {
    if (this.legacy) {
      return (await this.legacy.getTrialProgress(userId)) as TrialProgressDto;
    }
    const asOf = toDate(generatedAt);
    const snapshot = await this.studentStateProjection.getSnapshot(userId, asOf);
    const counts = await this.getSupplementalCounts(userId);

    return buildTrialProgressDto({
      snapshot,
      ...counts,
    });
  }

  private async getSupplementalCounts(userId: string) {
    if (!process.env.DATABASE_URL) {
      return {
        completedTaskCount: 0,
        completedPracticeSetCount: 0,
        wrongReviewCount: 0,
        feedbackCount: 0,
      };
    }

    const [
      completedTaskCount,
      completedPracticeSetCount,
      wrongReviewCount,
      feedbackCount,
    ] = await Promise.all([
      this.prisma.studyTaskCompletion.count({ where: { userId } }),
      this.prisma.learningSession.count({
        where: {
          userId,
          type: 'practice_set',
          completed: true,
        },
      }),
      this.prisma.wrongQuestionReview.count({ where: { userId } }),
      this.prisma.feedbackSubmission.count({ where: { userId } }),
    ]);

    return {
      completedTaskCount,
      completedPracticeSetCount,
      wrongReviewCount,
      feedbackCount,
    };
  }
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
