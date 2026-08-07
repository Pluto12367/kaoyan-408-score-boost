export interface AiVariantDraft {
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  difficulty: '基础' | '中等' | '困难';
}

const DIFFICULTIES = ['基础', '中等', '困难'] as const;
const ANSWERS = ['A', 'B', 'C', 'D'] as const;

export function buildAiVariantSystemPrompt(): string {
  return [
    '你是一名计算机考研 408 命题老师。',
    '根据给定的原题，生成同知识点的变式题：换场景、换数值、换设问角度，但答案必须自洽、题干必须自包含。',
    '只输出 JSON：{"items":[{"stem":"题干","options":["A项","B项","C项","D项"],"answer":"A","analysis":"解析","difficulty":"基础|中等|困难"}]}。',
    '要求：每题恰好 4 个选项；answer 必须是 A/B/C/D 之一且与选项内容对应；不要输出 JSON 以外的任何文字。',
  ].join('\n');
}

export function buildAiVariantUserPrompt(
  question: { stem: string; options: string[]; answer: string; analysis: string },
  count: number,
): string {
  const optionLines = question.options
    .map((option, index) => `${String.fromCharCode(65 + index)}. ${option}`)
    .join('；');
  return [
    '原题：',
    `题干：${question.stem}`,
    `选项：${optionLines}`,
    `正确答案：${question.answer}`,
    `解析：${question.analysis}`,
    '',
    `请生成 ${count} 道同知识点变式题。`,
  ].join('\n');
}

export function parseAiVariantJson(content: string): AiVariantDraft[] {
  let parsed: { items?: unknown };
  try {
    parsed = JSON.parse(content) as { items?: unknown };
  } catch {
    return [];
  }
  if (!Array.isArray(parsed?.items)) return [];
  return parsed.items
    .map(normalizeAiVariantDraft)
    .filter((item): item is AiVariantDraft => item !== null);
}

function normalizeAiVariantDraft(value: unknown): AiVariantDraft | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const stem = typeof record.stem === 'string' ? record.stem.trim() : '';
  const options = Array.isArray(record.options)
    ? record.options
        .filter((option): option is string => typeof option === 'string' && option.trim().length > 0)
        .map((option) => option.trim())
    : [];
  const answer = typeof record.answer === 'string' ? record.answer.trim().toUpperCase() : '';
  const analysis = typeof record.analysis === 'string' ? record.analysis.trim() : '';
  const difficulty = (DIFFICULTIES as readonly string[]).includes(record.difficulty as string)
    ? (record.difficulty as AiVariantDraft['difficulty'])
    : '中等';
  if (!stem || options.length !== 4 || !(ANSWERS as readonly string[]).includes(answer) || !analysis) {
    return null;
  }
  return { stem, options, answer, analysis, difficulty };
}
