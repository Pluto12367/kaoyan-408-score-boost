/**
 * V13-P0-1 — QuestionSubtype dictionary (408 business question-type layer).
 *
 * Owner Decision v1.1 (frozen):
 *   • QuestionType stays the historical/form layer (form label + grading
 *     channel) — it must never be refactored into the 408 types.
 *   • QuestionSubtype is the 408 business layer: exactly the Owner-approved
 *     dictionary below. No other business subtypes may be added without Owner
 *     approval.
 *   • Historical questions have subtype = NULL = UNKNOWN. Never guess, never
 *     derive, never backfill implicitly.
 *
 * Canonical identity = the SCREAMING_SNAKE code (matches QuestionType style);
 * Chinese labels are for display and content-authoring convenience.
 */

export const QUESTION_SUBTYPE_CODES = [
  'SINGLE_CHOICE',
  'JUDGEMENT',
  'COMPREHENSIVE_CHOICE',
  'ALGORITHM',
  'CO_COMPUTATION',
  'OS_PV',
  'CN_ROUTING',
] as const;

export type QuestionSubtypeCode = (typeof QUESTION_SUBTYPE_CODES)[number];

export const QUESTION_SUBTYPE_LABELS: Record<QuestionSubtypeCode, string> = {
  SINGLE_CHOICE: '单选题',
  JUDGEMENT: '判断题',
  COMPREHENSIVE_CHOICE: '综合选择题',
  ALGORITHM: '算法大题',
  CO_COMPUTATION: '组成原理计算题',
  OS_PV: 'OS PV 题',
  CN_ROUTING: 'CN 路由计算题',
};

const LABEL_TO_CODE = new Map<string, QuestionSubtypeCode>(
  (Object.entries(QUESTION_SUBTYPE_LABELS) as Array<[QuestionSubtypeCode, string]>).map(([code, label]) => [label, code]),
);

/**
 * Lenient read-side normalization: accepts the code or its Chinese label,
 * returns null for anything else (unknown stays unknown — no sibling mapping,
 * no content guessing).
 */
export function normalizeQuestionSubtype(value: string | null | undefined): QuestionSubtypeCode | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if ((QUESTION_SUBTYPE_CODES as readonly string[]).includes(trimmed)) return trimmed as QuestionSubtypeCode;
  return LABEL_TO_CODE.get(trimmed) ?? null;
}

/** Strict write-side alias (same set today; kept as the single validation entry). */
export function resolveQuestionSubtypeInput(value: string | null | undefined): QuestionSubtypeCode | null {
  return normalizeQuestionSubtype(value);
}

export function questionSubtypeLabel(code: QuestionSubtypeCode): string {
  return QUESTION_SUBTYPE_LABELS[code];
}

/**
 * MaxScore parse helper for content/import sources (task §7: no fabricated
 * defaults). Absent/blank → { value: null } (unpriced). A finite number ≥ 0 is
 * kept verbatim — 0 is a REAL zero-point question (NULL ≠ 0). Anything else is
 * flagged invalid so callers can reject instead of guessing.
 */
export function normalizeMaxScoreInput(
  value: unknown,
): { value: number | null } | { value: null; invalid: true } {
  if (value == null) return { value: null };
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return { value: null };
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed) || parsed < 0) return { value: null, invalid: true };
    return { value: parsed };
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return { value: null, invalid: true };
    return { value };
  }
  return { value: null, invalid: true };
}
