import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { Difficulty, QuestionType, type Prisma } from '@prisma/client';
import { requireQuestionKnowledgePoint, type Question } from '@kaoyan408/shared';
import { computeContentFingerprint } from '@kaoyan408/shared/questionImport.server';
import { CreateQuestionDto } from './dto/create-question.dto';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class QuestionsService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  private readonly knowledgePointIndex = new Map([
    ['ds-tree', { subject: '数据结构', chapter: '树与二叉树' }],
    ['co-cache', { subject: '计算机组成原理', chapter: '存储系统' }],
    ['os-sync', { subject: '操作系统', chapter: '进程管理' }],
    ['net-tcp', { subject: '计算机网络', chapter: '传输层' }],
  ]);

  private static readonly questions: Question[] = [
    {
      id: 'q-001',
      stem: '直接映射 Cache（共 8 行）中，主存块号 29 应映射到 Cache 的哪一行？',
      options: ['1', '3', '5', '7'],
      answer: 'C',
      analysis: '直接映射行号 = 主存块号 mod Cache 行数 = 29 mod 8 = 5，映射到第 5 行。',
      knowledgePointIds: ['co-cache'],
      difficulty: '中等',
      type: '选择题',
      source: '章节题',
      year: 2024,
      expectedTimeSec: 100,
    },
    {
      id: 'q-002',
      stem: 'TCP 拥塞避免阶段拥塞窗口的增长规律是？',
      options: ['指数增长', '线性增长', '保持不变', '立即减半'],
      answer: 'B',
      analysis: '拥塞避免阶段通常按加性增大，表现为近似线性增长。',
      knowledgePointIds: ['net-tcp'],
      difficulty: '中等',
      type: '选择题',
      source: '真题改编',
      year: 2021,
      expectedTimeSec: 100,
    },
  ];

  private static readonly reviewItems: ReviewItem[] = [];

  async onModuleInit() {
    if (!this.persistenceEnabled) return;
    const reviewState = await this.prisma.runtimeState.findUnique({ where: { key: 'questionReviewItems' } });
    if (Array.isArray(reviewState?.value)) {
      this.reviewItems.splice(0, this.reviewItems.length, ...(reviewState.value as unknown as ReviewItem[]));
    }
    await this.refreshFromDatabase();
  }

  async refreshFromDatabase(): Promise<void> {
    if (!this.persistenceEnabled) return;
    const rows = await this.prisma.question.findMany({
      where: { isCurrent: true },
      include: { knowledgePoints: true },
      orderBy: { createdAt: 'asc' },
    });
    // On a fresh database, StudyService persists these built-in questions and
    // their seed records during its own startup hook. Replacing the in-memory
    // bootstrap list with an empty query result first leaves those records
    // pointing at questions that were never created.
    if (rows.length === 0) return;
    this.questions.splice(0, this.questions.length, ...rows.map(toSharedQuestion));
  }

  registerKnowledgePoint(point: { id: string; subject: string; chapter: string }) {
    this.knowledgePointIndex.set(point.id, {
      subject: point.subject,
      chapter: point.chapter,
    });
  }

  listQuestions(filters: {
    knowledgePointId?: string;
    subject?: string;
    chapter?: string;
  } = {}) {
    return this.questions.filter((question) => {
      if (filters.knowledgePointId && !question.knowledgePointIds.includes(filters.knowledgePointId)) {
        return false;
      }

      if (filters.subject || filters.chapter) {
        const pointMeta = question.knowledgePointIds
          .map((id) => this.knowledgePointIndex.get(id))
          .filter(Boolean);

        if (filters.subject && !pointMeta.some((point) => point?.subject === filters.subject)) {
          return false;
        }

        if (filters.chapter && !pointMeta.some((point) => point?.chapter === filters.chapter)) {
          return false;
        }
      }

      return true;
    });
  }

  async findQuestionById(questionId: string): Promise<Question | null> {
    const inMemory = this.questions.find((question) => question.id === questionId);
    if (inMemory) return inMemory;
    if (!this.persistenceEnabled) return null;
    const row = await this.prisma.question.findUnique({
      where: { id: questionId },
      include: { knowledgePoints: true },
    });
    return row ? toSharedQuestion(row) : null;
  }

  async createQuestion(input: CreateQuestionDto) {
    const questionId = this.persistenceEnabled
      ? await this.nextPersistedQuestionId()
      : nextQuestionId(this.questions);
    const question = requireQuestionKnowledgePoint<Question>({
      id: questionId,
      stem: input.stem.trim(),
      options: input.options.map((option) => option.trim()).filter(Boolean),
      answer: input.answer,
      analysis: input.analysis.trim(),
      knowledgePointIds: input.knowledgePointIds,
      difficulty: input.difficulty,
      type: input.type,
      source: input.source,
      year: input.year,
      expectedTimeSec: input.expectedTimeSec ?? 100,
    });

    if (this.persistenceEnabled) {
      await this.prisma.question.create({
        data: {
          id: question.id,
          family: { create: {} },
          versionNumber: 1,
          isCurrent: true,
          contentFingerprint: computeContentFingerprint(question),
          stem: question.stem,
          options: question.options,
          answer: question.answer,
          analysis: question.analysis,
          difficulty: toPrismaDifficulty(question.difficulty),
          type: toPrismaQuestionType(question.type),
          source: question.source,
          year: question.year,
          expectedTimeSec: question.expectedTimeSec,
          knowledgePoints: {
            create: question.knowledgePointIds.map((knowledgePointId) => ({ knowledgePointId })),
          },
        },
      });
    }
    this.questions.push(question);
    this.reviewItems.push({
      id: `review-question-${question.id}`,
      contentType: 'question',
      relatedId: question.id,
      title: question.stem,
      summary: `教师新增题目，绑定 ${question.knowledgePointIds.length} 个知识点，来源：${question.source}`,
      status: 'pending',
      riskLevel: 'medium',
      reviewReason: '教师新增题目需要确认题干、答案、解析和知识点绑定是否准确。',
      suggestedAction: '检查标准答案、解析步骤、难度和知识点绑定；确认无误后通过审核。',
      createdAt: new Date().toISOString(),
    });
    await this.saveReviewItems();
    return question;
  }

  async updateQuestion(questionId: string, input: Partial<CreateQuestionDto>) {
    const index = this.questions.findIndex((question) => question.id === questionId);
    if (index === -1) {
      throw new BadRequestException(`Question ${questionId} was not found`);
    }

    const current = this.questions[index];
    const updatedQuestionId = this.persistenceEnabled
      ? await this.nextPersistedQuestionId()
      : current.id;
    const question = requireQuestionKnowledgePoint<Question>({
      ...current,
      id: updatedQuestionId,
      stem: input.stem?.trim() ?? current.stem,
      options: input.options ? input.options.map((option) => option.trim()).filter(Boolean) : current.options,
      answer: input.answer ?? current.answer,
      analysis: input.analysis?.trim() ?? current.analysis,
      knowledgePointIds: input.knowledgePointIds ?? current.knowledgePointIds,
      difficulty: input.difficulty ?? current.difficulty,
      type: input.type ?? current.type,
      source: input.source ?? current.source,
      year: input.year ?? current.year,
      expectedTimeSec: input.expectedTimeSec ?? current.expectedTimeSec,
    });

    if (this.persistenceEnabled) {
      await this.prisma.$transaction(async (tx) => {
        const persisted = await tx.question.findUniqueOrThrow({
          where: { id: questionId },
          select: { familyId: true, versionNumber: true },
        });
        await tx.question.update({
          where: { id: questionId },
          data: { isCurrent: false },
        });
        await tx.question.create({
          data: {
            id: question.id,
            familyId: persisted.familyId,
            versionNumber: persisted.versionNumber + 1,
            isCurrent: true,
            contentFingerprint: computeContentFingerprint(question),
            stem: question.stem,
            options: question.options,
            answer: question.answer,
            analysis: question.analysis,
            difficulty: toPrismaDifficulty(question.difficulty),
            type: toPrismaQuestionType(question.type),
            source: question.source,
            year: question.year,
            expectedTimeSec: question.expectedTimeSec,
            knowledgePoints: {
              create: question.knowledgePointIds.map((knowledgePointId) => ({ knowledgePointId })),
            },
          },
        });
      });
    }
    this.questions[index] = question;
    return question;
  }

  async deleteQuestion(questionId: string) {
    const index = this.questions.findIndex((question) => question.id === questionId);
    if (index === -1) {
      throw new BadRequestException(`Question ${questionId} was not found`);
    }

    if (this.persistenceEnabled) {
      const archived = await this.prisma.question.updateMany({
        where: { id: questionId, isCurrent: true },
        data: { isCurrent: false },
      });
      if (archived.count !== 1) throw new BadRequestException(`Question ${questionId} is historical and cannot be deleted`);
    }
    this.questions.splice(index, 1);
    const reviewIndex = this.reviewItems.findIndex((item) => item.relatedId === questionId);
    if (reviewIndex !== -1) {
      this.reviewItems.splice(reviewIndex, 1);
    }
    await this.saveReviewItems();

    return {
      id: questionId,
      deleted: true,
      archived: this.persistenceEnabled,
    };
  }

  listReviewItems() {
    return QuestionsService.reviewItems;
  }

  async approveReviewItem(reviewItemId: string, reviewerId: string) {
    const item = this.reviewItems.find((candidate) => candidate.id === reviewItemId);
    if (!item) return null;

    item.status = 'approved';
    item.reviewerId = reviewerId;
    item.reviewedAt = new Date().toISOString();
    await this.saveReviewItems();
    return item;
  }

  async markReviewItemNeedsRecheck(reviewItemId: string, reviewerId: string) {
    const item = this.reviewItems.find((candidate) => candidate.id === reviewItemId);
    if (!item) return null;

    item.status = 'needs_recheck';
    item.reviewerId = reviewerId;
    item.reviewedAt = new Date().toISOString();
    await this.saveReviewItems();
    return item;
  }

  private async nextPersistedQuestionId() {
    const persistedIds = await this.prisma.question.findMany({
      where: { id: { startsWith: 'q-' } },
      select: { id: true },
    });
    return nextQuestionId([...this.questions, ...persistedIds]);
  }

  private get questions() {
    return QuestionsService.questions;
  }

  private get reviewItems() {
    return QuestionsService.reviewItems;
  }

  private get persistenceEnabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  private async saveReviewItems() {
    if (!this.persistenceEnabled) return;
    const value = this.reviewItems as unknown as Prisma.InputJsonValue;
    await this.prisma.runtimeState.upsert({
      where: { key: 'questionReviewItems' },
      create: { key: 'questionReviewItems', value },
      update: { value },
    });
  }
}

function nextQuestionId(questions: Array<{ id: string }>) {
  const next = questions.reduce((max, question) => {
    const match = /^q-(\d+)$/.exec(question.id);
    return Math.max(max, match ? Number(match[1]) : 0);
  }, 0) + 1;
  return `q-${String(next).padStart(3, '0')}`;
}

function toSharedQuestion(row: {
  id: string;
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  knowledgePoints: { knowledgePointId: string }[];
  difficulty: Difficulty;
  type: QuestionType;
  source: string;
  year: number | null;
  expectedTimeSec: number;
}): Question {
  return {
    id: row.id,
    stem: row.stem,
    options: row.options,
    answer: row.answer,
    analysis: row.analysis,
    knowledgePointIds: row.knowledgePoints.map((item) => item.knowledgePointId),
    difficulty: fromPrismaDifficulty(row.difficulty),
    type: fromPrismaQuestionType(row.type),
    source: row.source,
    year: row.year ?? undefined,
    expectedTimeSec: row.expectedTimeSec,
  };
}

function toPrismaDifficulty(value: Question['difficulty']): Difficulty {
  if (value === '基础') return Difficulty.BASIC;
  if (value === '困难') return Difficulty.HARD;
  return Difficulty.MEDIUM;
}

function fromPrismaDifficulty(value: Difficulty): Question['difficulty'] {
  if (value === Difficulty.BASIC) return '基础';
  if (value === Difficulty.HARD) return '困难';
  return '中等';
}

function toPrismaQuestionType(value: Question['type']): QuestionType {
  if (value === '综合题') return QuestionType.COMPREHENSIVE;
  if (value === '判断题') return QuestionType.JUDGEMENT;
  return QuestionType.SINGLE_CHOICE;
}

function fromPrismaQuestionType(value: QuestionType): Question['type'] {
  if (value === QuestionType.COMPREHENSIVE) return '综合题';
  if (value === QuestionType.JUDGEMENT) return '判断题';
  return '选择题';
}

export interface ReviewItem {
  id: string;
  contentType: 'question' | 'ai_reply';
  relatedId: string;
  title: string;
  summary: string;
  status: 'pending' | 'approved' | 'needs_recheck';
  riskLevel: 'low' | 'medium' | 'high';
  reviewReason: string;
  suggestedAction: string;
  createdAt: string;
  reviewerId?: string;
  reviewedAt?: string;
}
