import type { Question } from './domain';

export interface SourceRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImportWarning {
  code: string;
  severity: 'warning' | 'error';
  field?: keyof CandidateQuestionDraft;
  rowNumber?: number;
  message: string;
  suggestion: string;
}

export interface CandidateQuestionDraft {
  stem: string;
  options: string[];
  answer: string;
  analysis: string;
  type: '选择题' | '综合题' | '判断题';
  difficulty: '基础' | '中等' | '困难';
  source: string;
  year?: number;
  expectedTimeSec: number;
  knowledgePointIds: string[];
  pageNumber?: number;
  sourceRegion?: SourceRegion;
  formulas: Array<{ latex: string; region?: SourceRegion }>;
  assetIds: string[];
  warnings: ImportWarning[];
}

export interface CandidateLocation {
  rowNumber?: number;
  pageNumber?: number;
}

export type CandidateRawValues = Record<string, unknown>;

const TYPE_VALUES = new Set<CandidateQuestionDraft['type']>(['选择题', '综合题', '判断题']);
const DIFFICULTY_VALUES = new Set<CandidateQuestionDraft['difficulty']>(['基础', '中等', '困难']);
const OPTION_LETTERS = 'ABCDEFGH';

function formulaResult(value: unknown): { value: unknown; unavailable: boolean } {
  if (value && typeof value === 'object' && ('formula' in value || 'sharedFormula' in value)) {
    return 'result' in value && value.result !== undefined && value.result !== null
      ? { value: value.result, unavailable: false }
      : { value: undefined, unavailable: true };
  }
  return { value, unavailable: false };
}

function normalizedText(value: unknown): string {
  const cached = formulaResult(value);
  if (cached.value === undefined || cached.value === null) return '';
  return String(cached.value).normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function field(raw: CandidateRawValues, ...names: string[]): unknown {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(raw, name)) return raw[name];
  }
  return undefined;
}

function valuesAsList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(normalizedText).filter(Boolean);
  const text = normalizedText(value);
  return text ? text.split(/[、,，;；\n]/u).map((item) => item.trim()).filter(Boolean) : [];
}

function optionValue(value: unknown, letter: string): string {
  return normalizedText(value).replace(new RegExp(`^${letter}[.、:：)）]\\s*`, 'iu'), '');
}

function sourceRegion(value: unknown): SourceRegion | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const region = value as Record<string, unknown>;
  if (['x', 'y', 'width', 'height'].every((key) => typeof region[key] === 'number' && Number.isFinite(region[key]))) {
    return region as unknown as SourceRegion;
  }
  return undefined;
}

function formulas(value: unknown): CandidateQuestionDraft['formulas'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((formula) => {
    if (!formula || typeof formula !== 'object' || typeof formula.latex !== 'string') return [];
    const region = sourceRegion(formula.region);
    return [{ latex: formula.latex, ...(region ? { region } : {}) }];
  });
}

function assetIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((assetId): assetId is string => typeof assetId === 'string' && assetId.length > 0) : [];
}

function warning(
  issues: ImportWarning[],
  code: string,
  fieldName: keyof CandidateQuestionDraft | undefined,
  message: string,
  suggestion: string,
) {
  issues.push({ code, severity: 'error', field: fieldName, message, suggestion });
}

/**
 * Converts a table or document candidate into the shared draft shape. This is
 * intentionally pure so browser review code and the API make identical
 * validation decisions.
 */
export function normalizeCandidateDraft(
  raw: CandidateRawValues,
  _location: CandidateLocation = {},
): { value?: CandidateQuestionDraft; issues: ImportWarning[] } {
  const issues: ImportWarning[] = [];
  for (const value of Object.values(raw)) {
    if (formulaResult(value).unavailable) {
      warning(issues, 'FORMULA_VALUE_UNAVAILABLE', undefined, '公式没有可用的缓存结果。', '请粘贴公式计算后的值，而不是公式。');
      break;
    }
  }
  const stem = normalizedText(field(raw, '题干', 'stem'));
  const type = normalizedText(field(raw, '题型', 'type')) as CandidateQuestionDraft['type'];
  const difficulty = normalizedText(field(raw, '难度', 'difficulty')) as CandidateQuestionDraft['difficulty'];
  const source = normalizedText(field(raw, '来源', 'source'));
  const answer = normalizedText(field(raw, '正确答案', 'answer')).toUpperCase();
  const analysis = normalizedText(field(raw, '答案解析', '解析', 'analysis'));
  const options = OPTION_LETTERS
    .split('')
    .map((letter) => optionValue(field(raw, `选项 ${letter}`, `选项${letter}`, `option${letter}`, `option ${letter}`), letter));
  const presentOptions = options.filter(Boolean);
  const lastOptionIndex = options.reduce((last, option, index) => option ? index : last, -1);

  if (!stem) warning(issues, 'MISSING_STEM', 'stem', '题干不能为空。', '请填写题干。');
  if (!TYPE_VALUES.has(type)) warning(issues, 'UNKNOWN_TYPE', 'type', '题型不在允许范围内。', '请选择选择题、综合题或判断题。');
  if (!DIFFICULTY_VALUES.has(difficulty)) warning(issues, 'UNKNOWN_DIFFICULTY', 'difficulty', '难度不在允许范围内。', '请选择基础、中等或困难。');
  if (!source) warning(issues, 'MISSING_SOURCE', 'source', '来源为必填项。', '填写有权使用的来源。');

  if (type === '选择题') {
    if (presentOptions.length < 2 || presentOptions.length > 8) {
      warning(issues, 'INVALID_OPTION_COUNT', 'options', '选择题必须有 2 至 8 个非空选项。', '补充或删除选项后重试。');
    }
    if (lastOptionIndex >= 0 && options.slice(0, lastOptionIndex + 1).some((option) => !option)) {
      warning(issues, 'OPTION_GAP', 'options', '选择题选项必须从 A 开始连续填写。', '请补齐中间空缺的选项，或将后续选项前移。');
    }
    const answerIndex = OPTION_LETTERS.indexOf(answer);
    if (!/^[A-H]$/u.test(answer) || answerIndex < 0 || !options[answerIndex]) {
      warning(issues, 'INVALID_ANSWER', 'answer', '正确答案必须对应一个已填写的选项。', '填写 A 到 H 中的一个选项字母。');
    }
  }

  const knowledgePointIds = valuesAsList(field(raw, '知识点 ID', '知识点ID', 'knowledgePointIds'));
  const knowledgePointNames = valuesAsList(field(raw, '知识点', 'knowledgePointNames'));
  if (knowledgePointNames.length > 0 && knowledgePointIds.length === 0) {
    warning(issues, 'UNMAPPED_KNOWLEDGE_POINT', 'knowledgePointIds', '知识点名称尚未映射为系统 ID。', '请由 API 完成知识点名称映射后再规范化。');
  }

  const yearText = normalizedText(field(raw, '年份', 'year'));
  const parsedYear = Number(yearText);
  if (yearText && (!Number.isInteger(parsedYear) || parsedYear < 1900 || parsedYear > 3000)) {
    warning(issues, 'INVALID_YEAR', 'year', '年份必须是 1900 至 3000 的整数。', '填写四位年份，或留空。');
  }

  const expectedTimeText = normalizedText(field(raw, '建议答题时间（秒）', '建议答题时间(秒)', 'expectedTimeSec'));
  const parsedExpectedTime = expectedTimeText ? Number(expectedTimeText) : 90;
  if (!Number.isInteger(parsedExpectedTime) || parsedExpectedTime <= 0) {
    warning(issues, 'INVALID_EXPECTED_TIME', 'expectedTimeSec', '建议答题时间必须是正整数秒。', '填写正整数秒数。');
  }

  if (issues.some((issue) => issue.severity === 'error')) return { issues };

  const value: CandidateQuestionDraft = {
    stem,
    options: type === '选择题' ? options.slice(0, lastOptionIndex + 1) : [],
    answer,
    analysis,
    type,
    difficulty,
    source,
    ...(yearText ? { year: parsedYear } : {}),
    expectedTimeSec: parsedExpectedTime,
    knowledgePointIds,
    formulas: formulas(field(raw, 'formulas')),
    assetIds: assetIds(field(raw, 'assetIds')),
    warnings: [],
  };
  return { value, issues };
}

export type QuestionFingerprintInput = Pick<
  Question,
  'stem' | 'options' | 'answer' | 'analysis' | 'knowledgePointIds' | 'difficulty' | 'type' | 'source' | 'year' | 'expectedTimeSec'
>;

export function questionFingerprintPayload(question: QuestionFingerprintInput) {
  return {
    stem: question.stem,
    options: question.options,
    answer: question.answer,
    analysis: question.analysis,
    knowledgePointIds: [...question.knowledgePointIds].sort(),
    difficulty: question.difficulty,
    type: question.type,
    source: question.source,
    year: question.year ?? null,
    expectedTimeSec: question.expectedTimeSec,
  };
}
