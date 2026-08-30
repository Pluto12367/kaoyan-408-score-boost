import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentStateProjectionService } from './student-state-projection.service';
import {
  buildTrialProgressDto,
  type TrialProgressDto,
} from './student-state-trial-progress.adapter';

// Sprint 2 迁移原则：旧接口 → Adapter → Student State。
// GET /trial-progress 的遗留契约由 buildTrialProgressDto 从 StudentStateSnapshot
// + SoT 计数（StudyTaskCompletion / LearningSession / WrongQuestionReview /
// FeedbackSubmission）导出，Phase R 的 legacy 委托已移除（语义等价性由
// student-state-trial-progress-* 契约测试与集成脚本的 feedback 里程碑断言验证）。
@Injectable()
export class StudentStateTrialProgressQueryService {
  constructor(
    private readonly studentStateProjection: StudentStateProjectionService,
    private readonly prisma: PrismaService,
  ) {}

  async getTrialProgressCompat(
    userId: string,
    generatedAt: Date | string = new Date(),
  ): Promise<TrialProgressDto> {
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
