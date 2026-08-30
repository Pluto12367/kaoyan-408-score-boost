// Sprint 3.3：review-resources 推荐适配器（纯函数，无 IO）。
// 职责：legacy 三类资源模板（concept_card / mistake_checklist / practice_set）逐字迁移；
// 输入的 resourcePoints 已由 StudyService 完成 nodeId→KP 桥接与目录回查。
// 禁止：查询数据库、计算 priority、修改 legacy 文案。

export interface ReviewResourcePoint {
  knowledgePointId: string;
  title: string;
  subject: string;
  chapter: string;
  accuracyRate: number;
}

export interface ReviewResourceWrongQuestion {
  knowledgePointId: string;
  wrongCount: number;
  latestMistakeReason?: string | null;
}

export interface ReviewResourcesDto {
  source: 'memory-api' | 'postgresql';
  userId: string;
  generatedAt: string;
  weakPointCount: number;
  items: Array<{
    id: string;
    knowledgePointId: string;
    knowledgePointTitle: string;
    subject: string;
    resourceType: 'concept_card' | 'mistake_checklist' | 'practice_set';
    title: string;
    summary: string;
    estimatedMinutes: number;
    difficulty: '基础' | '中等' | '提高';
    actionText: string;
    actionAnchor: string;
  }>;
}

export function buildReviewResourcesDto(input: {
  userId: string;
  source: 'memory-api' | 'postgresql';
  generatedAt: string;
  weakPointCount: number;
  resourcePoints: ReviewResourcePoint[];
  wrongQuestions: ReviewResourceWrongQuestion[];
  fallbackPoint?: ReviewResourcePoint | null;
}): ReviewResourcesDto {
  const resourcePoints = input.resourcePoints.length
    ? input.resourcePoints
    : input.fallbackPoint
      ? [input.fallbackPoint]
      : [];
  const items = resourcePoints.flatMap((point, index) => {
    const wrongQuestion = input.wrongQuestions.find((item) => item.knowledgePointId === point.knowledgePointId);
    const title = point.title;
    const subject = point.subject || '408';
    const chapter = point.chapter || '高频章节';
    const baseMinutes = point.accuracyRate < 50 ? 18 : 12;

    return [
      {
        id: `resource-${point.knowledgePointId}-concept`,
        knowledgePointId: point.knowledgePointId,
        knowledgePointTitle: title,
        subject,
        resourceType: 'concept_card' as const,
        title: `${title} 核心概念卡`,
        summary: `先复述 ${chapter} 中 ${title} 的定义、适用条件和常见题干关键词。`,
        estimatedMinutes: baseMinutes,
        difficulty: index === 0 ? '基础' as const : '中等' as const,
        actionText: '看完后做一组同考点题',
        actionAnchor: '#question',
      },
      {
        id: `resource-${point.knowledgePointId}-mistake`,
        knowledgePointId: point.knowledgePointId,
        knowledgePointTitle: title,
        subject,
        resourceType: 'mistake_checklist' as const,
        title: `${title} 错因检查清单`,
        summary: wrongQuestion
          ? `该考点已有 ${wrongQuestion.wrongCount} 次错误，优先检查：${wrongQuestion.latestMistakeReason ?? '概念混淆'}。`
          : '按知识点没学过、概念混淆、公式记错、计算错误、审题错误、推理过程错误、时间不足、蒙题八类检查最近错因。',
        estimatedMinutes: 8,
        difficulty: '基础' as const,
        actionText: '去错题本复盘',
        actionAnchor: '#wrong-book',
      },
      {
        id: `resource-${point.knowledgePointId}-practice`,
        knowledgePointId: point.knowledgePointId,
        knowledgePointTitle: title,
        subject,
        resourceType: 'practice_set' as const,
        title: `${title} 专项验证训练`,
        summary: '完成 3 到 5 道同知识点题目，用正确率和耗时判断是否已经补上。',
        estimatedMinutes: 15,
        difficulty: point.accuracyRate < 60 ? '中等' as const : '提高' as const,
        actionText: '进入专项训练',
        actionAnchor: '#question',
      },
    ];
  }).slice(0, 6);

  return {
    source: input.source,
    userId: input.userId,
    generatedAt: input.generatedAt,
    weakPointCount: input.weakPointCount,
    items,
  };
}
