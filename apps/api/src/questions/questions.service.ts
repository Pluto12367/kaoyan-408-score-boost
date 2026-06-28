import { Injectable } from '@nestjs/common';
import { requireQuestionKnowledgePoint, type Question } from '@kaoyan408/shared';
import { CreateQuestionDto } from './dto/create-question.dto';

@Injectable()
export class QuestionsService {
  private readonly questions: Question[] = [
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
  ];

  listQuestions() {
    return this.questions;
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
    return question;
  }
}
