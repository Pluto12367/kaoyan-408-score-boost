import { Injectable } from '@nestjs/common';
import { requireQuestionKnowledgePoint, type Question } from '@kaoyan408/shared';
import { CreateQuestionDto } from './dto/create-question.dto';

@Injectable()
export class QuestionsService {
  private readonly knowledgePointIndex = new Map([
    ['ds-tree', { subject: '数据结构', chapter: '树与二叉树' }],
    ['co-cache', { subject: '计算机组成原理', chapter: '存储系统' }],
    ['os-sync', { subject: '操作系统', chapter: '进程管理' }],
    ['net-tcp', { subject: '计算机网络', chapter: '传输层' }],
  ]);

  private static readonly questions: Question[] = [
    {
      id: 'q-001',
      stem: '直接映射 Cache 中，主存块号 29 应映射到 Cache 的哪一行？',
      options: ['1', '3', '5', '7'],
      answer: 'B',
      analysis: '直接映射行号等于主存块号对 Cache 行数取模。',
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

  createQuestion(input: CreateQuestionDto) {
    const question = requireQuestionKnowledgePoint<Question>({
      id: `q-${String(this.questions.length + 1).padStart(3, '0')}`,
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

    this.questions.push(question);
    this.reviewItems.push({
      id: `review-question-${question.id}`,
      contentType: 'question',
      relatedId: question.id,
      title: question.stem,
      summary: `教师新增题目，绑定 ${question.knowledgePointIds.length} 个知识点，来源：${question.source}`,
      status: 'pending',
      riskLevel: 'medium',
      createdAt: new Date().toISOString(),
    });
    return question;
  }

  listReviewItems() {
    return QuestionsService.reviewItems;
  }

  approveReviewItem(reviewItemId: string, reviewerId: string) {
    const item = this.reviewItems.find((candidate) => candidate.id === reviewItemId);
    if (!item) return null;

    item.status = 'approved';
    item.reviewerId = reviewerId;
    item.reviewedAt = new Date().toISOString();
    return item;
  }

  private get questions() {
    return QuestionsService.questions;
  }

  private get reviewItems() {
    return QuestionsService.reviewItems;
  }
}

export interface ReviewItem {
  id: string;
  contentType: 'question' | 'ai_reply';
  relatedId: string;
  title: string;
  summary: string;
  status: 'pending' | 'approved';
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: string;
  reviewerId?: string;
  reviewedAt?: string;
}
