import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LearningLoopRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadTasksForDate(userId: string, scheduledDate: string) {
    return this.prisma.studyTask.findMany({
      where: { plan: { userId }, scheduledDate },
      select: { status: true, completed: true },
    });
  }

  async loadUserRecommendationConfig(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: { examYear: true, remainingDays: true, dailyHours: true },
    });
  }
}
