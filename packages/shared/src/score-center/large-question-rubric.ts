/**
 * F4 — large-question rubric + offline shadow evaluator (pure module).
 *
 * ## Why this exists without a schema change
 *
 * The 70/150 marks that depend on written answers had no structured training at
 * all (V12-0 audit: F4 content-blocked). `Question.rubric` is an approval gate,
 * so this module does NOT touch Prisma. What it provides instead:
 *
 *   • the proposed rubric JSON shape, versioned, with validation
 *   • a deterministic OFFLINE evaluator that awards points per 采分点 and
 *     explains every award, so the pipeline can be built and tested before any
 *     content or schema decision
 *   • explicit fallbacks: no rubric → no score (not zero); invalid rubric →
 *     refused (not approximated)
 *
 * ## The AI boundary (mission §12.2)
 *
 * AI may assist evaluation; it must never be the absolute source of truth. This
 * module therefore contains no model call at all: it is the auditable,
 * explainable, versioned baseline that an assistant evaluator would be compared
 * against, and every result states that keyword matching is not a semantic
 * judgement and that a human confirms the final mark.
 *
 * Pure: zero imports, deterministic.
 */

export const RUBRIC_SCHEMA_VERSION = 'rubric-v1';

export const RUBRIC_EVALUATION_BASIS = 'offline_keyword_match';

export interface RubricPoint {
  readonly id: string;
  readonly label: string;
  readonly points: number;
  /** Any of these appearing in the answer earns the point (offline criterion). */
  readonly matchAny: readonly string[];
  /** Missing a required point is a critical miss. */
  readonly required?: boolean;
  readonly knowledgeNodeIds?: readonly string[];
}

export interface QuestionRubric {
  readonly schemaVersion: string;
  readonly totalPoints: number;
  readonly points: readonly RubricPoint[];
}

export interface RubricValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface RubricPointOutcome {
  readonly id: string;
  readonly label: string;
  readonly points: number;
  readonly awarded: number;
  readonly matched: boolean;
  readonly required: boolean;
  readonly matchedTerm: string | null;
  readonly basis: string;
}

export interface LargeQuestionScore {
  /** null when there is nothing legitimate to score against. */
  readonly score: number | null;
  readonly maxScore: number | null;
  readonly verdict: 'perfect' | 'partial' | 'zero' | 'no_rubric' | 'invalid_rubric';
  readonly criticalMiss: boolean;
  readonly points: readonly RubricPointOutcome[];
  readonly missingLabels: readonly string[];
  readonly hitNodeIds: readonly string[];
  readonly missedNodeIds: readonly string[];
  readonly evaluationBasis: string;
  readonly limitations: string;
  readonly authoritative: false;
  readonly basis: string;
}

export function validateRubric(rubric: QuestionRubric | null | undefined): RubricValidation {
  const errors: string[] = [];
  if (!rubric) {
    return { valid: false, errors: ['缺少评分标准（rubric）。'] };
  }
  if (!Array.isArray(rubric.points) || rubric.points.length === 0) {
    errors.push('评分标准没有任何采分点。');
  }
  const seen = new Set<string>();
  let sum = 0;
  for (const point of rubric.points ?? []) {
    if (!point || typeof point.id !== 'string' || point.id.trim().length === 0) {
      errors.push('存在没有 id 的采分点，无法审计。');
      continue;
    }
    if (seen.has(point.id)) errors.push(`采分点 id 重复：${point.id}。`);
    seen.add(point.id);
    if (typeof point.points !== 'number' || !Number.isFinite(point.points) || point.points <= 0) {
      errors.push(`采分点 ${point.id} 的分值非法。`);
      continue;
    }
    if (!Array.isArray(point.matchAny) || point.matchAny.length === 0) {
      errors.push(`采分点 ${point.id} 没有任何匹配依据。`);
    }
    sum += point.points;
  }
  if (typeof rubric.totalPoints !== 'number' || rubric.totalPoints !== sum) {
    errors.push(`采分点分值合计 ${sum} 与总分 totalPoints ${rubric.totalPoints} 不一致。`);
  }
  if (rubric.schemaVersion !== RUBRIC_SCHEMA_VERSION) {
    errors.push(`评分标准版本 ${rubric.schemaVersion} 与当前支持的 ${RUBRIC_SCHEMA_VERSION} 不一致。`);
  }
  return { valid: errors.length === 0, errors };
}

export function scoreLargeQuestion(input: {
  readonly rubric: QuestionRubric | null | undefined;
  readonly answerText: string;
}): LargeQuestionScore {
  if (!input.rubric) {
    return fallback('no_rubric', '缺少评分标准（rubric），因此不给出任何分数——缺失不是 0 分。');
  }
  const validation = validateRubric(input.rubric);
  if (!validation.valid) {
    return fallback(
      'invalid_rubric',
      `评分标准未通过校验（${validation.errors.join(' ')}），拒绝近似打分。`,
    );
  }

  const haystack = normalise(input.answerText ?? '');
  const points: RubricPointOutcome[] = [];
  const hitNodes = new Set<string>();
  const missedNodes = new Set<string>();

  for (const point of input.rubric.points) {
    const matchedTerm = point.matchAny.find((term) => haystack.includes(normalise(term))) ?? null;
    const matched = matchedTerm != null;
    for (const nodeId of point.knowledgeNodeIds ?? []) {
      (matched ? hitNodes : missedNodes).add(nodeId);
    }
    points.push({
      id: point.id,
      label: point.label,
      points: point.points,
      awarded: matched ? point.points : 0,
      matched,
      required: point.required === true,
      matchedTerm,
      basis: matched
        ? `命中「${matchedTerm}」，得 ${point.points} 分。`
        : `未出现任一依据（${point.matchAny.join(' / ')}），得 0 分。`,
    });
  }

  const score = points.reduce((sum, point) => sum + point.awarded, 0);
  const maxScore = input.rubric.totalPoints;
  const criticalMiss = points.some((point) => point.required && !point.matched);
  const missingLabels = points.filter((point) => !point.matched).map((point) => point.label);
  const verdict: LargeQuestionScore['verdict'] =
    score === 0 ? 'zero' : score === maxScore ? 'perfect' : 'partial';

  return {
    score,
    maxScore,
    verdict,
    criticalMiss,
    points,
    missingLabels,
    hitNodeIds: [...hitNodes].sort(),
    missedNodeIds: [...missedNodes].sort(),
    evaluationBasis: RUBRIC_EVALUATION_BASIS,
    limitations: LIMITATIONS,
    authoritative: false,
    basis: `离线按采分点判定：${score}/${maxScore} 分${criticalMiss ? '；存在必答采分点未命中（关键失分）' : ''}。`,
  };
}

const LIMITATIONS =
  '本评分基于关键词匹配，不是语义判定：表述正确但用词不同的答案可能被判未命中，反之亦然。结果仅供参考，最终分数须由人工复核确认。';

function fallback(verdict: 'no_rubric' | 'invalid_rubric', basis: string): LargeQuestionScore {
  return {
    score: null,
    maxScore: null,
    verdict,
    criticalMiss: false,
    points: [],
    missingLabels: [],
    hitNodeIds: [],
    missedNodeIds: [],
    evaluationBasis: RUBRIC_EVALUATION_BASIS,
    limitations: LIMITATIONS,
    authoritative: false,
    basis,
  };
}

/** Case- and whitespace-insensitive so formatting never changes a score. */
function normalise(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '');
}
