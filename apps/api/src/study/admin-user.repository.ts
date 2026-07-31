import { BadRequestException, Injectable } from '@nestjs/common';
import { TrialStatus as PrismaTrialStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export type TrialStatus = 'invited' | 'active' | 'completed' | 'follow_up';

export interface ManagedUserRecord {
  id: string;
  email?: string;
  name: string;
  role: 'student' | 'teacher' | 'admin';
  accountStatus: 'active' | 'disabled';
  mustChangePassword: boolean;
  trialStatus: TrialStatus;
  stage?: string;
  targetScore?: number;
  targetSchool?: string;
  lastActiveAt: string;
  onboardingCompleted: boolean;
}

@Injectable()
export class AdminUserRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async list(): Promise<ManagedUserRecord[]> {
    if (!this.enabled) return [];
    const users = await this.prisma.user.findMany({
      include: {
        operationLogs: { select: { createdAt: true }, orderBy: { createdAt: 'desc' }, take: 1 },
        practiceRecords: { select: { submittedAt: true }, orderBy: { submittedAt: 'desc' }, take: 1 },
      },
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
    });
    return users.map((user) => {
      const lastActiveAt = [
        user.operationLogs[0]?.createdAt,
        user.practiceRecords[0]?.submittedAt,
        user.updatedAt,
        user.createdAt,
      ].filter((value): value is Date => Boolean(value)).sort((a, b) => b.getTime() - a.getTime())[0];
      return {
        id: user.id,
        email: user.email ?? undefined,
        name: user.name,
        role: toRole(user.role),
        accountStatus: user.accountStatus.toLowerCase() as 'active' | 'disabled',
        mustChangePassword: user.mustChangePassword,
        trialStatus: fromPrismaStatus(user.trialStatus),
        stage: user.studyStage ?? undefined,
        targetScore: user.targetScore ?? undefined,
        targetSchool: user.targetSchool ?? undefined,
        lastActiveAt: lastActiveAt.toISOString(),
        onboardingCompleted: Boolean(user.onboardingCompletedAt),
      };
    });
  }

  async updateTrialStatus(userId: string, status: TrialStatus) {
    if (!this.enabled) return null;
    const existing = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!existing) throw new BadRequestException(`User ${userId} was not found`);
    await this.prisma.user.update({
      where: { id: userId },
      data: { trialStatus: toPrismaStatus(status) },
    });
    return (await this.list()).find((user) => user.id === userId) ?? null;
  }

}

function toRole(role: UserRole): ManagedUserRecord['role'] {
  return role.toLowerCase() as ManagedUserRecord['role'];
}

function fromPrismaStatus(status: PrismaTrialStatus): TrialStatus {
  return status.toLowerCase() as TrialStatus;
}

function toPrismaStatus(status: TrialStatus): PrismaTrialStatus {
  return PrismaTrialStatus[status.toUpperCase() as keyof typeof PrismaTrialStatus];
}
