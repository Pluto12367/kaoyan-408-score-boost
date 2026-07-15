import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export const FEEDBACK_SCENES = [
  'diagnostic',
  'today_plan',
  'practice',
  'mistakes',
  'exam',
  'overall',
] as const;

export type FeedbackScene = (typeof FEEDBACK_SCENES)[number];
export type FeedbackStatus = 'new' | 'reviewed';

export interface FeedbackRecord {
  id: string;
  userId: string;
  rating: number;
  scene: FeedbackScene;
  message: string;
  status: FeedbackStatus;
  createdAt: string;
}

@Injectable()
export class FeedbackRepository {
  private readonly memoryItems: FeedbackRecord[] = [];

  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async list(): Promise<FeedbackRecord[]> {
    if (!this.enabled) return [...this.memoryItems];
    const rows = await this.prisma.feedbackSubmission.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map(toRecord);
  }

  async create(input: {
    userId: string;
    rating: number;
    scene: FeedbackScene;
    message: string;
  }): Promise<FeedbackRecord> {
    if (!this.enabled) {
      const item: FeedbackRecord = {
        id: `feedback-${randomUUID()}`,
        ...input,
        status: 'new',
        createdAt: new Date().toISOString(),
      };
      this.memoryItems.push(item);
      return item;
    }

    return toRecord(await this.prisma.feedbackSubmission.create({
      data: { ...input, status: 'new' },
    }));
  }
}

function toRecord(row: {
  id: string;
  userId: string;
  rating: number;
  scene: string;
  message: string;
  status: string;
  createdAt: Date;
}): FeedbackRecord {
  return {
    id: row.id,
    userId: row.userId,
    rating: row.rating,
    scene: row.scene as FeedbackScene,
    message: row.message,
    status: row.status === 'reviewed' ? 'reviewed' : 'new',
    createdAt: row.createdAt.toISOString(),
  };
}
