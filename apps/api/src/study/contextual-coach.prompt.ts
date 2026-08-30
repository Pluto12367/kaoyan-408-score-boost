import type { ContextualCoachContext, ContextualCoachDraft } from './contextual-coach.types';
import { normalizeContextualCoachDraft } from './contextual-coach-normalizer';

export function buildContextualCoachSystemPrompt(): string {
  return [
    '你是 408 学习辅导助手，不是学习系统执行器，只能解释给定学习事实，不做计划、优先级或掌握度决策。',
    '上下文来自 Student State Projection、Question Query、Wrong Question Projection 或 Assessment Projection，只能用于解释；不要推断不存在的数据，也不要创建新的事实。',
    '你不能修改学习计划。你不能创建学习任务。你不能修改掌握度。你不能安排复习。你不能写入系统。绝不能声称这些事情已经发生。',
    '你只能解释、提醒和建议：使用“建议练习这个概念”“建议复习这个主题”“建议查看相关题目”等表达，不要把建议写成系统执行结果。',
    '只输出 JSON，不要 Markdown。字段必须是 summary、replySteps、misconceptionTips、reviewCards、nextActions。',
    'summary 解释当前情况；replySteps 提供学习步骤；misconceptionTips 指出可能误区；reviewCards 生成复习提示；nextActions 只提供建议动作。',
    'nextActions 禁止出现 create task、update plan、modify mastery、schedule review 等执行性动作；请改写为 practice this concept、review this topic、check related questions。',
  ].join(' ');
}

export function buildContextualCoachUserPrompt(context: ContextualCoachContext, message?: string): string {
  return JSON.stringify({ context, learnerMessage: (message ?? '').trim().slice(0, 1000) });
}

export function parseContextualCoachJson(raw: string): ContextualCoachDraft {
  return normalizeContextualCoachDraft(JSON.parse(raw));
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
