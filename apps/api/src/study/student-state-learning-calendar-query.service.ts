import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentStateProjectionService } from './student-state-projection.service';
import { buildLearningCalendarDto, type LearningCalendarDto } from './student-state-learning-calendar.adapter';
import { ActivityProjectionService } from './activity-projection.service';
import { lastNDates } from './study-date';

@Injectable()
export class StudentStateLearningCalendarQueryService {
  constructor(
    private readonly studentStateProjection: StudentStateProjectionService,
    private readonly prisma: PrismaService,
    private readonly activityProjection: ActivityProjectionService = new ActivityProjectionService(),
  ) {}

  async getLearningCalendarCompat(userId: string): Promise<LearningCalendarDto> {
    const asOf = new Date();
    await this.studentStateProjection.getSnapshot(userId, asOf);

    const dates = lastNDates(7);
    if (!process.env.DATABASE_URL) {
      return buildLearningCalendarDto(this.activityProjection.buildSnapshot({
        dates,
        practiceRecords: [],
        taskCompletions: [],
      }));
    }

    const [practiceRecords, taskCompletions] = await Promise.all([
      this.prisma.practiceRecord.findMany({
        where: {
          userId,
          submittedAt: {
            gte: new Date(`${dates[0]}T00:00:00.000Z`),
            lte: asOf,
          },
        },
        select: { submittedAt: true },
        orderBy: { submittedAt: 'asc' },
      }),
      this.prisma.studyTaskCompletion.findMany({
        where: {
          userId,
          completedDate: { in: dates },
        },
        select: { completedDate: true },
        orderBy: { completedDate: 'asc' },
      }),
    ]);

    return buildLearningCalendarDto(this.activityProjection.buildSnapshot({
      dates,
      practiceRecords,
      taskCompletions,
    }));
  }
}
