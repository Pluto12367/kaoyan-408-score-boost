import { Injectable } from '@nestjs/common';
import {
  Difficulty,
  QuestionType,
  Subject as PrismaSubject,
  UserRole,
} from '@prisma/client';
import type {
  KnowledgePoint,
  MistakeReason,
  PracticeRecord,
  Question,
  UserProfile,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class PracticeRecordRepository {
  constructor(private readonly prisma: PrismaService) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async initialize(input: {
    user: UserProfile;
    knowledgePoints: KnowledgePoint[];
    questions: Question[];
    seedRecords: PracticeRecord[];
  }): Promise<PracticeRecord[]> {
    if (!this.enabled) return input.seedRecords;

    await this.prisma.user.upsert({
      where: { id: input.user.id },
      create: {
        id: input.user.id,
        name: input.user.name,
        role: UserRole.STUDENT,
        targetSchool: input.user.targetSchool,
        targetScore: input.user.targetScore,
        currentScore: input.user.currentScore,
        dailyHours: input.user.dailyHours,
        remainingDays: input.user.remainingDays,
      },
      update: {
        name: input.user.name,
        targetSchool: input.user.targetSchool,
        targetScore: input.user.targetScore,
        currentScore: input.user.currentScore,
        dailyHours: input.user.dailyHours,
        remainingDays: input.user.remainingDays,
      },
    });

    for (const point of input.knowledgePoints) {
      await this.prisma.knowledgePoint.upsert({
        where: { id: point.id },
        create: {
          id: point.id,
          subject: mapSubject(point.id),
          chapter: point.chapter,
          title: point.title,
          importance: point.importance,
          frequency: point.frequency,
          prerequisites: point.prerequisites,
        },
        update: {
          subject: mapSubject(point.id),
          chapter: point.chapter,
          title: point.title,
          importance: point.importance,
          frequency: point.frequency,
          prerequisites: point.prerequisites,
        },
      });
    }

    for (const question of input.questions) {
      await this.prisma.question.upsert({
        where: { id: question.id },
        create: {
          id: question.id,
          stem: question.stem,
          options: question.options,
          answer: question.answer,
          analysis: question.analysis,
          difficulty: mapDifficulty(question.difficulty),
          type: mapQuestionType(question.type),
          source: question.source,
          year: question.year,
          expectedTimeSec: question.expectedTimeSec,
        },
        update: {
          stem: question.stem,
          options: question.options,
          answer: question.answer,
          analysis: question.analysis,
          difficulty: mapDifficulty(question.difficulty),
          type: mapQuestionType(question.type),
          source: question.source,
          year: question.year,
          expectedTimeSec: question.expectedTimeSec,
        },
      });
      await this.prisma.questionKnowledgePoint.deleteMany({ where: { questionId: question.id } });
      await this.prisma.questionKnowledgePoint.createMany({
        data: question.knowledgePointIds.map((knowledgePointId) => ({ questionId: question.id, knowledgePointId })),
        skipDuplicates: true,
      });
    }

    for (const record of input.seedRecords) {
      await this.prisma.practiceRecord.upsert({
        where: { id: record.id },
        create: toPrismaRecord(record),
        update: {},
      });
    }

    return this.listAll();
  }

  async save(record: PracticeRecord): Promise<PracticeRecord> {
    if (!this.enabled) return record;

    const saved = await this.prisma.practiceRecord.create({ data: toPrismaRecord(record) });
    return {
      ...record,
      id: saved.id,
      submittedAt: saved.submittedAt.toISOString(),
    };
  }

  async listByUser(userId: string): Promise<PracticeRecord[]> {
    if (!this.enabled) return [];

    const records = await this.prisma.practiceRecord.findMany({
      where: { userId },
      orderBy: { submittedAt: 'asc' },
    });
    return records.map(toDomainRecord);
  }

  async listAll(): Promise<PracticeRecord[]> {
    if (!this.enabled) return [];

    const records = await this.prisma.practiceRecord.findMany({
      orderBy: { submittedAt: 'asc' },
    });
    return records.map(toDomainRecord);
  }
}

function toDomainRecord(record: {
  id: string;
  userId: string;
  questionId: string;
  knowledgePointId: string;
  selectedAnswer: string | null;
  correct: boolean;
  timeSpentSec: number;
  expectedTimeSec: number;
  mistakeReason: string | null;
  submittedAt: Date;
  sessionId: string | null;
  gradingMode: string;
  selfScore: number | null;
  maxScore: number | null;
}): PracticeRecord {
  return {
      id: record.id,
      userId: record.userId,
      questionId: record.questionId,
      knowledgePointId: record.knowledgePointId,
      selectedAnswer: record.selectedAnswer ?? undefined,
      correct: record.correct,
      timeSpentSec: record.timeSpentSec,
      expectedTimeSec: record.expectedTimeSec,
      mistakeReason: mapMistakeReason(record.mistakeReason),
      submittedAt: record.submittedAt.toISOString(),
      sessionId: record.sessionId ?? undefined,
      gradingMode: record.gradingMode === 'self_assessed' ? 'self_assessed' : 'objective',
      selfScore: record.selfScore ?? undefined,
      maxScore: record.maxScore ?? undefined,
    };
}

export function toPrismaRecord(record: PracticeRecord) {
  return {
    id: record.id,
    userId: record.userId,
    questionId: record.questionId,
    knowledgePointId: record.knowledgePointId,
    selectedAnswer: record.selectedAnswer,
    correct: record.correct,
    timeSpentSec: record.timeSpentSec,
    expectedTimeSec: record.expectedTimeSec,
    mistakeReason: record.mistakeReason,
    submittedAt: new Date(record.submittedAt),
    sessionId: record.sessionId,
    gradingMode: record.gradingMode ?? 'objective',
    selfScore: record.selfScore,
    maxScore: record.maxScore,
  };
}

function mapSubject(knowledgePointId: string): PrismaSubject {
  if (knowledgePointId.startsWith('ds-')) return PrismaSubject.DATA_STRUCTURE;
  if (knowledgePointId.startsWith('co-')) return PrismaSubject.COMPUTER_ORGANIZATION;
  if (knowledgePointId.startsWith('os-')) return PrismaSubject.OPERATING_SYSTEM;
  return PrismaSubject.COMPUTER_NETWORK;
}

function mapDifficulty(difficulty: Question['difficulty']): Difficulty {
  if (difficulty === '基础') return Difficulty.BASIC;
  if (difficulty === '困难') return Difficulty.HARD;
  return Difficulty.MEDIUM;
}

function mapQuestionType(type: Question['type']): QuestionType {
  if (type === '综合题') return QuestionType.COMPREHENSIVE;
  if (type === '判断题') return QuestionType.JUDGEMENT;
  return QuestionType.SINGLE_CHOICE;
}

function mapMistakeReason(value: string | null): MistakeReason | null {
  if (
    value === '概念不清'
    || value === '知识点混淆'
    || value === '审题问题'
    || value === '计算失误'
    || value === '速度偏慢'
  ) {
    return value;
  }
  return null;
}
