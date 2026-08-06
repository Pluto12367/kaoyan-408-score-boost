import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AiTutorLogRecord {
  id: string;
  userId: string;
  questionId: string | null;
  prompt: string;
  response: string;
  reviewed: boolean;
  createdAt: string;
}

// AiTutorLog 落库：真实模型调用（成功或失败）都会记录，便于审计与后续统计。
@Injectable()
export class AiTutorLogRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async create(input: {
    userId: string;
    questionId: string | null;
    prompt: string;
    response: string;
  }): Promise<AiTutorLogRecord | null> {
    if (!this.enabled) return null;
    return toRecord(await this.prisma.aiTutorLog.create({
      data: { ...input, reviewed: false },
    }));
  }
}

function toRecord(row: {
  id: string;
  userId: string;
  questionId: string | null;
  prompt: string;
  response: string;
  reviewed: boolean;
  createdAt: Date;
}): AiTutorLogRecord {
  return {
    id: row.id,
    userId: row.userId,
    questionId: row.questionId,
    prompt: row.prompt,
    response: row.response,
    reviewed: row.reviewed,
    createdAt: row.createdAt.toISOString(),
  };
}