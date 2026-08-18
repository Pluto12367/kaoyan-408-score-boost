// AI 答疑共享逻辑：提示词构造、JSON 解析校验、模板回退。
// 纯函数，无网络与 process.env 依赖，便于前端/后端/测试复用。

import type { KnowledgeEvidenceSummary } from './knowledgeEvidence';

export type AiTutorFollowUpMode =
  | 'simplify'
  | 'option-error'
  | 'similar-question'
  | 'hint-only'
  | 'concept-compare';

export const AI_TUTOR_FOLLOW_UP_MODES: Array<{ mode: AiTutorFollowUpMode; label: string }> = [
  { mode: 'simplify', label: '用更简单的方式解释' },
  { mode: 'option-error', label: '为什么这个选项错误' },
  { mode: 'similar-question', label: '给我一道类似题' },
  { mode: 'hint-only', label: '只提示思路，不直接给答案' },
  { mode: 'concept-compare', label: '对比两个易混概念' },
];

export const AI_TUTOR_SOURCE_REAL = 'deepseek';
export const AI_TUTOR_SOURCE_FALLBACK = 'standard-analysis-assisted';

export interface AiTutorContext {
  userId: string;
  questionId: string;
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  knowledgePointTitle: string;
  subject: string;
  chapter: string;
  selectedAnswer?: string | null;
  mistakeReason?: string | null;
  recentWrongQuestions?: Array<{
    stem: string;
    knowledgePointTitle: string;
    mistakeReason?: string | null;
  }>;
  evidenceSummary?: KnowledgeEvidenceSummary | null;
  prompt?: string;
}

export interface AiTutorHintLayer {
  level: 1 | 2 | 3 | 4;
  title: string;
  content: string;
}

export interface AiTutorSimilarQuestion {
  id: string;
  stem: string;
  difficulty: string;
  source: string;
}

export interface AiTutorReplyDraft {
  answerCheck: string;
  explanationSteps: string[];
  hintLayers: AiTutorHintLayer[];
  similarQuestions: AiTutorSimilarQuestion[];
  nextActions: string[];
}

export interface AiFollowUpReviewCard {
  id: string;
  type: 'concept' | 'rule' | 'confusion';
  title: string;
  content: string;
  nextAction: string;
}

export interface AiFollowUpDraft {
  replySteps: string[];
  misconceptionTips: string[];
  reviewCards: AiFollowUpReviewCard[];
  nextActions: string[];
}

const TUTOR_SYSTEM_PROMPT =
  '你是一名计算机考研 408 的辅导老师，擅长数据结构、计算机组成原理、操作系统、计算机网络四科。' +
  '你的任务是基于给定的题目、标准答案和标准解析，为学生提供分层讲解。' +
  '规则：1. 只依据题目材料讲解，不得编造题目与解析之外的信息。' +
  '2. 答案判断一律以标准答案为准；学生答案与标准答案不一致时，明确告知但不贬低学生。' +
  '3. 分层提示从浅到深：第 1 层只指出考点，第 2 层给出关键思路，第 3 层展示部分步骤，第 4 层给出完整解析。' +
  '4. 输出必须是合法的 JSON 对象，不要输出任何 JSON 以外的文字。';

const FOLLOW_UP_SYSTEM_PROMPT =
  '你是一名计算机考研 408 的辅导老师。' +
  '请根据题目、标准答案、标准解析和学生的追问，生成回答与复习卡片。' +
  '规则：1. 只依据题目材料讲解，不得编造题目与解析之外的信息。' +
  '2. 答案判断一律以标准答案为准。' +
  '3. 输出必须是合法的 JSON 对象，不要输出任何 JSON 以外的文字。';

const FOLLOW_UP_MODE_INSTRUCTION: Record<AiTutorFollowUpMode, string> = {
  simplify: '请用更通俗的语言重新解释这道题的考点和解题思路，避免术语堆砌。',
  'option-error': '请重点分析学生关心的那个选项为什么错误，把它与正确选项逐条对比。',
  'similar-question': '请出一道与本题同知识点的变式题（只给题干和选项，不给答案），并提示判题关键。',
  'hint-only': '请只给分层提示（考点、思路、部分步骤），不要直接给出完整解析和答案。',
  'concept-compare': '请把本题考点与一个相邻易混概念进行对比，用条目说明区别。',
};

const DEFAULT_HINT_LAYERS: Array<{ level: 1 | 2 | 3 | 4; title: string; content: string }> = [
  { level: 1, title: '先定位考点', content: '请先对照标准解析定位本题核心考点。' },
  { level: 2, title: '关键思路', content: '请结合标准解析梳理本题的解题思路。' },
  { level: 3, title: '部分步骤', content: '请查看标准解析中的关键步骤。' },
  { level: 4, title: '完整解析', content: '请以标准解析为准，核对本题完整解析。' },
];

export function buildTutorSystemPrompt(): string {
  return TUTOR_SYSTEM_PROMPT;
}

export function buildFollowUpSystemPrompt(): string {
  return FOLLOW_UP_SYSTEM_PROMPT;
}

export function buildTutorUserPrompt(context: AiTutorContext): string {
  const optionsText = context.options.length > 0
    ? context.options.map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`).join('\n')
    : '（无选项列表）';
  const answerStatus = context.selectedAnswer
    ? `学生作答：${context.selectedAnswer}（${context.selectedAnswer.toUpperCase() === context.answer ? '正确' : '错误'}）`
    : '学生未作答（仅请求讲解）';
  const reasonText = context.mistakeReason ? `学生自报/推断错因：${context.mistakeReason}` : '学生未提供错因';
  const recentWrongText = context.recentWrongQuestions && context.recentWrongQuestions.length > 0
    ? context.recentWrongQuestions
      .slice(0, 5)
      .map((item, index) => `${index + 1}. ${item.knowledgePointTitle}：${item.stem}${item.mistakeReason ? `（错因：${item.mistakeReason}）` : ''}`)
      .join('\n')
    : '（无）';
  return [
    '请针对下面这道 408 题目生成分层讲解，并以 JSON 输出。',
    '',
    `科目：${context.subject}`,
    `章节：${context.chapter}`,
    `知识点：${context.knowledgePointTitle}`,
    `题目：${context.stem}`,
    `选项：\n${optionsText}`,
    `标准答案：${context.answer}`,
    `标准解析：${context.analysis}`,
    answerStatus,
    reasonText,
    `学生提问：${context.prompt?.trim() || '请讲解这道题。'}`,
    `最近相关错题：\n${recentWrongText}`,
    context.evidenceSummary ? [
      '知识证据卡：',
      ...context.evidenceSummary.cards.map((card) => `- ${card.title}：${card.value}｜${card.note}`),
    ].join('\n') : '知识证据卡：\n（无）',
    '',
    '期望的 JSON 结构（字段名必须完全一致）：',
    JSON.stringify({
      answerCheck: '判断学生作答是否正确的一句话（未作答则说明正确答案）',
      explanationSteps: ['解题步骤数组，2-4 条'],
      hintLayers: [
        { level: 1, title: '先定位考点', content: '只指出考点，不透露解题细节' },
        { level: 2, title: '关键思路', content: '给出解题思路方向' },
        { level: 3, title: '部分步骤', content: '展示部分关键步骤' },
        { level: 4, title: '完整解析', content: '完整解析与易错点' },
      ],
      similarQuestions: [{ id: '同类题标识', stem: '类似题目简述', difficulty: '难度', source: '来源' }],
      nextActions: ['下一步学习建议，2-3 条'],
    }, null, 2),
  ].join('\n');
}

export function buildFollowUpUserPrompt(
  context: AiTutorContext,
  message: string,
  mode?: AiTutorFollowUpMode,
): string {
  const modeInstruction = mode ? FOLLOW_UP_MODE_INSTRUCTION[mode] : '';
  return [
    `科目：${context.subject}`,
    `章节：${context.chapter}`,
    `知识点：${context.knowledgePointTitle}`,
    `题目：${context.stem}`,
    `标准答案：${context.answer}`,
    `标准解析：${context.analysis}`,
    `学生作答：${context.selectedAnswer ?? '未作答'}`,
    `学生追问：${message.trim() || '请讲解这道题。'}`,
    context.evidenceSummary ? [
      '知识证据卡：',
      ...context.evidenceSummary.cards.map((card) => `- ${card.title}：${card.value}｜${card.note}`),
    ].join('\n') : '知识证据卡：\n（无）',
    modeInstruction ? `追问类型要求：${modeInstruction}` : '',
    '',
    '期望的 JSON 结构（字段名必须完全一致）：',
    JSON.stringify({
      replySteps: ['回答学生的核心内容，2-4 条'],
      misconceptionTips: ['易错点提醒，2-3 条'],
      reviewCards: [
        { id: 'card-1', type: 'concept', title: '卡片标题', content: '卡片内容', nextAction: '下一步动作' },
        { id: 'card-2', type: 'rule', title: '判断规则', content: '内容', nextAction: '下一步动作' },
      ],
      nextActions: ['后续学习建议，2-3 条'],
    }, null, 2),
  ].join('\n');
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
    : [];
}

export function parseTutorReplyJson(content: string): AiTutorReplyDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('AI tutor reply is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI tutor reply is not a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  return {
    answerCheck: asString(record.answerCheck, '请对照标准解析核对本题。'),
    explanationSteps: asStringArray(record.explanationSteps),
    hintLayers: normalizeHintLayers(record.hintLayers),
    similarQuestions: Array.isArray(record.similarQuestions)
      ? record.similarQuestions
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
        .slice(0, 3)
        .map((item) => ({
          id: asString(item.id, `similar-${Math.random().toString(36).slice(2, 8)}`),
          stem: asString(item.stem, '同类题'),
          difficulty: asString(item.difficulty, '中等'),
          source: asString(item.source, 'AI 生成'),
        }))
      : [],
    nextActions: asStringArray(record.nextActions),
  };
}

export function parseFollowUpJson(content: string): AiFollowUpDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('AI follow-up reply is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI follow-up reply is not a JSON object');
  }
  const record = parsed as Record<string, unknown>;
  const reviewCards = Array.isArray(record.reviewCards)
    ? record.reviewCards
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .slice(0, 5)
      .map((item) => ({
        id: asString(item.id, `card-${Math.random().toString(36).slice(2, 8)}`),
        type: (item.type === 'rule' || item.type === 'confusion' ? item.type : 'concept') as AiFollowUpReviewCard['type'],
        title: asString(item.title, '复习卡片'),
        content: asString(item.content, ''),
        nextAction: asString(item.nextAction, ''),
      }))
    : [];
  return {
    replySteps: asStringArray(record.replySteps),
    misconceptionTips: asStringArray(record.misconceptionTips),
    reviewCards,
    nextActions: asStringArray(record.nextActions),
  };
}

function normalizeHintLayers(value: unknown): AiTutorHintLayer[] {
  const layers: AiTutorHintLayer[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      if (!item || typeof item !== 'object') continue;
      const layer = item as Record<string, unknown>;
      const level = Number(layer.level);
      if (!Number.isInteger(level) || level < 1 || level > 4) continue;
      const fallback = DEFAULT_HINT_LAYERS.find((candidate) => candidate.level === level);
      layers.push({
        level: level as AiTutorHintLayer['level'],
        title: asString(layer.title, fallback?.title ?? `提示第 ${level} 层`),
        content: asString(layer.content, fallback?.content ?? ''),
      });
    }
  }
  for (const fallback of DEFAULT_HINT_LAYERS) {
    if (!layers.some((layer) => layer.level === fallback.level)) {
      layers.push({ ...fallback });
    }
  }
  return layers.sort((a, b) => a.level - b.level);
}

export function buildTemplateTutorReply(
  context: AiTutorContext,
  similarQuestions: AiTutorSimilarQuestion[],
): AiTutorReplyDraft {
  const point = context.knowledgePointTitle;
  const answerCheck = context.selectedAnswer
    ? `你选择 ${context.selectedAnswer}，正确答案是 ${context.answer}，${context.selectedAnswer.toUpperCase() === context.answer ? '本题作答正确。' : '本题需要重点复盘。'}`
    : `正确答案是 ${context.answer}。`;
  const hintLayers: AiTutorHintLayer[] = [
    { level: 1, title: '先定位考点', content: `本题核心考点是 ${point}（${context.subject} / ${context.chapter}）。` },
    { level: 2, title: '关键思路', content: `先提取题干限制条件，再对照 ${point} 的核心规则判断每个选项是否满足条件。` },
    { level: 3, title: '部分步骤', content: `标准答案方向是 ${context.answer}。建议先比较各选项差异，排除明显违反题干条件的选项。` },
    {
      level: 4,
      title: '完整解析',
      content: `${context.analysis}${context.mistakeReason ? `（你的错因：${context.mistakeReason}，复看时重点对照这一步。）` : ''}`,
    },
  ];
  return {
    answerCheck,
    explanationSteps: hintLayers.map((layer) => layer.content),
    hintLayers,
    similarQuestions,
    nextActions: [
      `复述 ${point} 的核心规则，并写出本题用到的判断依据。`,
      '完成 2-3 道同考点相似题，重点记录错因而不是只看答案。',
      '如果仍然出错，把题干条件逐句标注，检查是否遗漏限制条件。',
    ],
  };
}

export function buildTemplateFollowUp(context: AiTutorContext, message: string): AiFollowUpDraft {
  const point = context.knowledgePointTitle;
  const comparePrompt = message.includes('选项') || message.includes('为什么') || message.includes('A');
  return {
    replySteps: [
      `本题主要考 ${point}，不要只记答案，要看题干条件如何触发规则。`,
      `标准答案：${context.answer}，解析依据：${context.analysis}`,
      comparePrompt
        ? '把错误选项和正确选项逐句比较，找出条件不匹配的位置。'
        : '如果仍不确定，先把题干中的限制条件圈出来，再判断每个选项是否满足这些条件。',
    ],
    misconceptionTips: [
      `不要把 ${point} 的定义和相邻考点混用。`,
      '408 选择题常用“看起来熟悉但条件不完整”的选项制造干扰。',
    ],
    reviewCards: [
      {
        id: `card-concept-${context.questionId}`,
        type: 'concept',
        title: `${point} 核心概念`,
        content: `复习时先能口述 ${point} 的定义、适用条件和常见题干关键词。`,
        nextAction: '用 2 分钟写出本考点的判断依据，再做 2 道同考点题。',
      },
      {
        id: `card-rule-${context.questionId}`,
        type: 'rule',
        title: '本题判断规则',
        content: `看到类似题目时，先提取题干条件，再和选项逐项匹配；本题标准答案为 ${context.answer}。`,
        nextAction: '重做本题，并说明为什么其他选项不满足条件。',
      },
      {
        id: `card-mix-${context.questionId}`,
        type: 'confusion',
        title: '易混点提醒',
        content: `如果把 ${point} 和前置知识混淆，容易只凭关键词选错。`,
        nextAction: '整理一个“易混选项对比表”，记录正确条件和错误诱因。',
      },
    ],
    nextActions: [
      '先复述本题考点，再回到错题本标记是否真正理解。',
      '完成 3 道同知识点题目，观察是否还会被同类干扰项影响。',
    ],
  };
}