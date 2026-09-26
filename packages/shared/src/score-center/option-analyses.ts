/**
 * V14-P0 — per-wrong-option trap analyses for real-exam multiple choice.
 *
 * Design: docs/v14-p0-real-exam-bank-design.md §5. Owner-approved 2026-09-25
 * (D-2 additive nullable JSONB column `Question.optionAnalyses`, D-4 JSON
 * column over a relation table — same pattern as the PHASE 8 rubric).
 *
 * Invariants pinned here (the SINGLE shape source — importer and any future
 * read path must go through `parseOptionAnalyses`):
 *   • NULL = not authored. 未撰写 ≠ 非法, ≠ "zero traps" (same NULL≠0 family
 *     as Question.maxScore — RULE-06).
 *   • Traps exist ONLY for SINGLE_CHOICE questions.
 *   • Keys are uppercase option letters inside the option range; the key equal
 *     to the correct answer is a validation error — a "trap" on the correct
 *     option is a content bug, never stored.
 *   • Stored shape is exactly { version: 1, traps: { <LETTER>: <text> } } with
 *     alphabetically sorted keys (deterministic output).
 *   • Student pre-submission views must never carry this field (design §10.1).
 */

export const OPTION_ANALYSES_SCHEMA_VERSION = 1;

export interface OptionAnalyses {
  version: 1;
  traps: Record<string, string>;
}

export interface OptionAnalysesContext {
  /** Number of options on the question (≥ 2 for a choice question). */
  optionsCount: number;
  /** The correct answer letter, e.g. 'A'. Required — the exclusion check depends on it. */
  answer: string;
  /** Form-layer question type. Only '选择题' / 'SINGLE_CHOICE' may carry traps. */
  questionType: string;
}

export interface OptionAnalysesParseResult {
  value: OptionAnalyses | null;
  invalid?: boolean;
  errors?: string[];
}

const SINGLE_CHOICE_FORM_TYPES = new Set(['选择题', 'SINGLE_CHOICE']);

function optionLetterForIndex(index: number): string {
  return String.fromCharCode(65 + index);
}

function maxOptionLetter(optionsCount: number): string {
  return optionLetterForIndex(optionsCount - 1);
}

function validateContext(context: OptionAnalysesContext): string[] | null {
  if (!Number.isInteger(context.optionsCount) || context.optionsCount < 2) {
    return [`optionsCount 必须是 ≥2 的整数，收到 ${String(context.optionsCount)}`];
  }
  const answer = context.answer?.trim() ?? '';
  if (!/^[A-Z]$/.test(answer) || answer > maxOptionLetter(context.optionsCount)) {
    return [
      `answer 必须是选项范围内的正确答案字母（A..${maxOptionLetter(context.optionsCount)}），收到 "${context.answer}"`,
    ];
  }
  if (!SINGLE_CHOICE_FORM_TYPES.has(context.questionType)) {
    return [`只有选择题（选择题/SINGLE_CHOICE）可以有逐选项陷阱，收到题型 "${context.questionType}"`];
  }
  return null;
}

export function parseOptionAnalyses(
  value: unknown,
  context: OptionAnalysesContext,
): OptionAnalysesParseResult {
  // Absent stays null — an unauthored trap map is not an invalid one.
  if (value == null) return { value: null };
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return { value: null };
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch (error) {
      return {
        value: null,
        invalid: true,
        errors: [`逐选项陷阱不是合法 JSON：${error instanceof Error ? error.message : String(error)}`],
      };
    }
    return validateParsedOptionAnalyses(parsed, context);
  }
  return validateParsedOptionAnalyses(value, context);
}

function validateParsedOptionAnalyses(
  parsed: unknown,
  context: OptionAnalysesContext,
): OptionAnalysesParseResult {
  const contextErrors = validateContext(context);
  if (contextErrors) {
    return { value: null, invalid: true, errors: contextErrors };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { value: null, invalid: true, errors: ['逐选项陷阱必须是对象（version / traps）。'] };
  }
  const candidate = parsed as { version?: unknown; traps?: unknown };
  if (candidate.version !== OPTION_ANALYSES_SCHEMA_VERSION) {
    return {
      value: null,
      invalid: true,
      errors: [`逐选项陷阱 version 必须是 ${OPTION_ANALYSES_SCHEMA_VERSION}，收到 ${String(candidate.version)}`],
    };
  }
  if (typeof candidate.traps !== 'object' || candidate.traps === null || Array.isArray(candidate.traps)) {
    return { value: null, invalid: true, errors: ['traps 必须是对象（键 = 错误选项字母，值 = 陷阱解析）。'] };
  }
  const rawEntries = Object.entries(candidate.traps as Record<string, unknown>);
  if (rawEntries.length === 0) {
    return { value: null, invalid: true, errors: ['traps 不能为空：撰写了 optionAnalyses 却没有内容属于录入事故，请删除该字段或补全内容。'] };
  }

  const answerLetter = context.answer.trim();
  const maxLetter = maxOptionLetter(context.optionsCount);
  const errors: string[] = [];
  const traps: Record<string, string> = {};

  for (const [key, rawText] of rawEntries) {
    if (!/^[A-Z]$/.test(key) || key > maxLetter) {
      errors.push(`陷阱键 "${key}" 必须是选项范围内的大写字母（A..${maxLetter}）`);
      continue;
    }
    if (key === answerLetter) {
      errors.push(`选项 ${key} 是正确答案，正确选项不能有陷阱解析`);
      continue;
    }
    if (typeof rawText !== 'string' || rawText.trim().length === 0) {
      errors.push(`选项 ${key} 的陷阱解析必须是非空字符串`);
      continue;
    }
    const text = rawText.trim();
    if (text.length > 500) {
      errors.push(`选项 ${key} 的陷阱解析超过 500 字（当前 ${text.length} 字）`);
      continue;
    }
    traps[key] = text;
  }

  if (errors.length > 0) {
    return { value: null, invalid: true, errors };
  }

  // Deterministic output: keys sorted alphabetically.
  const sortedTraps: Record<string, string> = {};
  for (const key of Object.keys(traps).sort()) {
    sortedTraps[key] = traps[key];
  }
  return { value: { version: 1, traps: sortedTraps } };
}
