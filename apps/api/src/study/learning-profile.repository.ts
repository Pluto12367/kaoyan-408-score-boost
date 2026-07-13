import { Injectable } from '@nestjs/common';
import type { DiagnosticProfile, Subject } from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LearningProfileRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async load(): Promise<Map<string, DiagnosticProfile>> {
    const profiles = new Map<string, DiagnosticProfile>();
    if (!this.enabled) return profiles;

    const users = await this.prisma.user.findMany({
      where: {
        targetScore: { not: null },
        currentScore: { not: null },
        dailyHours: { not: null },
        remainingDays: { not: null },
        studyStage: { not: null },
        weakestSubject: { not: null },
      },
    });
    for (const user of users) {
      profiles.set(user.id, {
        targetScore: user.targetScore!,
        currentScore: user.currentScore!,
        remainingDays: user.remainingDays!,
        dailyHours: user.dailyHours!,
        stage: user.studyStage as DiagnosticProfile['stage'],
        weakestSubject: user.weakestSubject as Subject,
        diagnosis: user.diagnosis ?? '已恢复学习诊断档案。',
      });
    }
    return profiles;
  }

  async save(userId: string, profile: DiagnosticProfile) {
    if (!this.enabled) return;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        targetScore: profile.targetScore,
        currentScore: profile.currentScore,
        remainingDays: profile.remainingDays,
        dailyHours: profile.dailyHours,
        studyStage: profile.stage,
        weakestSubject: profile.weakestSubject,
        diagnosis: profile.diagnosis,
      },
    });
  }
}
