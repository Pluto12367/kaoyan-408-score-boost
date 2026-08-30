import type { ContextualCoachContext, ContextualCoachDraft } from './contextual-coach.types';

export function buildContextualCoachSystemPrompt(): string {
  return [
    '你是 408 学习辅导教练，只能解释给定学习事实，不做计划、优先级或掌握度决策。',
    '只输出 JSON，不要 Markdown。字段必须是 summary、replySteps、misconceptionTips、reviewCards、nextActions。',
    '不要声称写入学习状态，不要编造上下文中没有的事实。',
  ].join(' ');
}

export function buildContextualCoachUserPrompt(context: ContextualCoachContext, message?: string): string {
  return JSON.stringify({ context, learnerMessage: (message ?? '').trim().slice(0, 1000) });
}

export function parseContextualCoachJson(raw: string): ContextualCoachDraft {
  const parsed = JSON.parse(raw) as Partial<ContextualCoachDraft>;
  return normalizeDraft(parsed);
}

export function buildTemplateContextualCoach(context: ContextualCoachContext, message?: string): ContextualCoachDraft {
  const label = context.context.type === 'knowledge_node'
    ? '这个知识节点'
    : context.context.type === 'assessment'
      ? '这次测评'
      : '当前学习材料';
  const learnerMessage = message?.trim();
  return {
    summary: `${label}的辅导基于当前已记录的学习事实；暂未连接模型，先按证据进行复盘。`,
    replySteps: [
      learnerMessage ? `先回应你的问题：“${learnerMessage.slice(0, 120)}”` : '先确认题目、错题或测评中的具体事实。',
      '对照已提供的解析、掌握度和复习记录定位原因。',
      '用一个小步骤复述规则，再通过后续练习验证理解。',
    ],
    misconceptionTips: ['不要把一次结果当成长期掌握度结论。', '遇到不确定处请回到题干、定义和已记录证据。'],
    reviewCards: [
      { id: 'context-concept', type: 'concept', title: '概念核对', content: '写出本次复盘涉及的核心定义。', nextAction: '用自己的话复述定义' },
      { id: 'context-rule', type: 'rule', title: '规则核对', content: '标出解题中真正使用的规则或条件。', nextAction: '补做一道同类题' },
      { id: 'context-confusion', type: 'confusion', title: '混淆检查', content: '记录最容易与正确规则混淆的点。', nextAction: '建立一条对比笔记' },
    ],
    nextActions: ['查看标准解析与当前掌握度事实', '完成一次短复述', '用一道同类题验证'],
  };
}

function normalizeDraft(input: Partial<ContextualCoachDraft>): ContextualCoachDraft {
  const cards: ContextualCoachDraft['reviewCards'] = Array.isArray(input.reviewCards) ? input.reviewCards.slice(0, 3).map((card, index) => ({
    id: typeof card?.id === 'string' ? card.id : `context-card-${index + 1}`,
    type: (card?.type === 'rule' || card?.type === 'confusion' ? card.type : 'concept') as 'concept' | 'rule' | 'confusion',
    title: typeof card?.title === 'string' ? card.title : '复盘卡片',
    content: typeof card?.content === 'string' ? card.content : '回到上下文事实进行核对。',
    nextAction: typeof card?.nextAction === 'string' ? card.nextAction : '完成一次复述',
  })) : [];
  return {
    summary: typeof input.summary === 'string' ? input.summary : '请根据已提供的学习事实完成复盘。',
    replySteps: strings(input.replySteps),
    misconceptionTips: strings(input.misconceptionTips),
    reviewCards: cards,
    nextActions: strings(input.nextActions),
  };
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string').slice(0, 5) : [];
}
