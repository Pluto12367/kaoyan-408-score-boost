import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class RuntimeStateRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async loadAll(): Promise<Map<string, unknown>> {
    const result = new Map<string, unknown>();
    if (!this.enabled) return result;
    const rows = await this.prisma.runtimeState.findMany();
    for (const row of rows) result.set(row.key, row.value);
    return result;
  }

  async save(key: string, value: unknown) {
    if (!this.enabled) return;
    const json = value as Prisma.InputJsonValue;
    await this.prisma.runtimeState.upsert({
      where: { key },
      create: { key, value: json },
      update: { value: json },
    });
  }
}
