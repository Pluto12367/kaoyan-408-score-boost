import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UserEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async record(userId: string, type: string, payload?: Record<string, unknown>) {
    if (!this.enabled) return;
    await this.prisma.userEvent.create({
      data: {
        userId,
        type,
        payload: (payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async hasTriggerKey(userId: string, triggerKey: string) {
    if (!this.enabled) return false;
    const events = await this.prisma.userEvent.findMany({
      where: { userId, type: 'plan.generated' },
      select: { payload: true },
    });
    return events.some((event) => (
      event.payload !== null
      && typeof event.payload === 'object'
      && !Array.isArray(event.payload)
      && (event.payload as { triggerKey?: unknown }).triggerKey === triggerKey
    ));
  }
}
