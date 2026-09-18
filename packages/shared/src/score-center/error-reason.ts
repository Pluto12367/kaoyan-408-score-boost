/**
 * V13-A1 — Controlled Error Reason Taxonomy v1.
 *
 * Canonical identity = the Owner-frozen English codes below. Storage keeps the
 * historical Chinese labels (all existing rows and the student-facing
 * wrong-question detail render the label directly), while API projections emit
 * codes. Three read-side layers normalize:
 *
 *   English code  ->  itself
 *   canonical Chinese label (what classifyMistake / the self-report UI store)
 *   legacy historical labels (概念不清 / 审题问题 / ...)
 *
 * Anything else is NOT a controlled reason: `normalizeErrorReason` returns null
 * and projections surface it as `unclassified`. UNKNOWN and CONCEPT_CONFUSION
 * are different semantics — the classifyMistake fallback that used to blur them
 * was removed in V13-A1.
 *
 * Guessing (蒙题) is a state of CORRECT answers (classifyMistake), so it never
 * appears on wrong evidence; it is kept in the vocabulary for legacy reads and
 * is not self-reportable. `unclassified` is a server-side explicit unknown and
 * is never submittable.
 */

export const OWNER_ERROR_REASON_CODES = [
  'knowledge_gap',
  'concept_confusion',
  'formula_gap',
  'calculation_error',
  'method_error',
  'reasoning_error',
  'reading_error',
  'careless_error',
  'time_insufficient',
  'missing_step',
  'boundary_condition',
  'answer_structure',
  'forgetting',
  'large_question_scoring_loss',
] as const;

export type OwnerErrorReasonCode = (typeof OWNER_ERROR_REASON_CODES)[number];

export const GUESSING_ERROR_REASON_CODE = 'guessing';
export const UNCLASSIFIED_ERROR_REASON_CODE = 'unclassified';

export const ERROR_REASON_CODES = [
  ...OWNER_ERROR_REASON_CODES,
  GUESSING_ERROR_REASON_CODE,
  UNCLASSIFIED_ERROR_REASON_CODE,
] as const;

export type ErrorReasonCode = (typeof ERROR_REASON_CODES)[number];

/** Student-readable canonical labels. Unique by contract (pinned in tests). */
export const ERROR_REASON_LABELS: Record<ErrorReasonCode, string> = {
  knowledge_gap: '知识点没学过',
  concept_confusion: '概念混淆',
  formula_gap: '公式记错',
  calculation_error: '计算错误',
  method_error: '方法错误',
  reasoning_error: '推理过程错误',
  reading_error: '审题错误',
  careless_error: '粗心错误',
  time_insufficient: '时间不足',
  missing_step: '步骤缺失',
  boundary_condition: '边界条件遗漏',
  answer_structure: '不会组织答案',
  forgetting: '遗忘',
  large_question_scoring_loss: '大题采分点失分',
  guessing: '蒙题',
  unclassified: '待归因',
};

const LABEL_TO_CODE = new Map<string, ErrorReasonCode>(
  (Object.entries(ERROR_REASON_LABELS) as Array<[ErrorReasonCode, string]>).map(([code, label]) => [label, code]),
);

/** Historical free labels written before V13-A1; read-side compat only. */
const LEGACY_LABEL_TO_CODE: Record<string, ErrorReasonCode> = {
  概念不清: 'concept_confusion',
  知识点混淆: 'concept_confusion',
  审题问题: 'reading_error',
  计算失误: 'calculation_error',
  速度偏慢: 'time_insufficient',
};

/**
 * Lenient read-side normalization. Accepts English codes, canonical Chinese
 * labels and legacy labels; returns null for anything uncontrolled (free text,
 * null, empty). Callers decide how to represent null (projections use
 * `unclassified`).
 */
export function normalizeErrorReason(value: string | null | undefined): ErrorReasonCode | null {
  if (!value) return null;
  if ((ERROR_REASON_CODES as readonly string[]).includes(value)) return value as ErrorReasonCode;
  return LABEL_TO_CODE.get(value) ?? LEGACY_LABEL_TO_CODE[value] ?? null;
}

/**
 * The reasons a student may self-report = exactly the Owner 14. Guessing is a
 * correct-answer state and unclassified is server-internal; neither is
 * submittable.
 */
export const SELF_REPORTABLE_ERROR_REASON_CODES: readonly OwnerErrorReasonCode[] = OWNER_ERROR_REASON_CODES;

/**
 * Strict write-side validation for `controlledReason`. Accepts the English
 * code or its canonical Chinese label; legacy labels are NOT valid input
 * (they exist only so old rows keep reading back). Returns null when the value
 * is not a submittable controlled reason.
 */
export function resolveControlledReasonInput(value: string | null | undefined): OwnerErrorReasonCode | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  if ((SELF_REPORTABLE_ERROR_REASON_CODES as readonly string[]).includes(trimmed)) {
    return trimmed as OwnerErrorReasonCode;
  }
  const byLabel = LABEL_TO_CODE.get(trimmed);
  if (byLabel && (SELF_REPORTABLE_ERROR_REASON_CODES as readonly string[]).includes(byLabel)) {
    return byLabel as OwnerErrorReasonCode;
  }
  return null;
}

export function errorReasonLabel(code: ErrorReasonCode): string {
  return ERROR_REASON_LABELS[code];
}
