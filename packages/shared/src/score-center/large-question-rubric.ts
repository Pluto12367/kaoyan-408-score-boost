/**
 * F4 V1 — large-question rubric + offline shadow evaluator (pure module).
 *
 * V1 scope is deliberately small (an owner decision): one versioned criteria
 * list, no rubric DSL. Shape:
 *
 *   rubric
 *   ├── version            the rubric revision this content was authored at
 *   ├── totalPoints
 *   └── criteria[]
 *       ├── id             stable identity, so per-criterion feedback is trackable
 *       ├── description    what the student must show (student-facing)
 *       ├── points
 *       ├── required       a missing required criterion is a critical miss
 *       ├── evidenceHint   what evidence in an answer earns this point (human)
 *       └── matchAny       the machine-readable form of the same hint (offline)
 *       └── knowledgeNodeIds  which nodes the point exercises (ability linkage)
 *
 * ## Why historical scores cannot be polluted by a rubric edit
 *
 * Every score result carries the `version` and a `contentHash` of the exact
 * rubric used. A later edit produces a different hash, so a stored score can
 * always be re-explained against the rubric revision it was actually scored
 * under — and can be told apart from a score produced by the new revision.
 * Nothing here mutates a rubric; the caller stores revisions.
 *
 * ## AI boundary
 *
 * This module contains no model call. It is the explainable, versioned offline
 * baseline that an assistant evaluator would be compared against, and every
 * result states that keyword matching is not a semantic judgement and that a
 * human confirms the final mark.
 *
 * Pure: zero imports, deterministic.
 */

export const RUBRIC_SCHEMA_VERSION = 'rubric-v1';

export const RUBRIC_EVALUATION_BASIS = 'offline_keyword_match';

export interface RubricCriterion {
  readonly id: string;
  readonly description: string;
  readonly points: number;
  readonly required?: boolean;
  /** Human-facing: what evidence earns this point. */
  readonly evidenceHint: string;
  /** Machine-readable form of evidenceHint, used by the offline evaluator. */
  readonly matchAny: readonly string[];
  readonly knowledgeNodeIds?: readonly string[];
}

export interface QuestionRubric {
  readonly version: number;
  readonly totalPoints: number;
  readonly criteria: readonly RubricCriterion[];
  /** Optional provenance: who authored this revision and when. */
  readonly authoredBy?: string;
  readonly authoredAt?: string;
}

export interface RubricValidation {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface RubricCriterionOutcome {
  readonly id: string;
  readonly description: string;
  readonly points: number;
  readonly awarded: number;
  readonly matched: boolean;
  readonly required: boolean;
  readonly matchedTerm: string | null;
  readonly evidenceHint: string;
  readonly basis: string;
}

export interface LargeQuestionScore {
  /** null when there is nothing legitimate to score against. */
  readonly score: number | null;
  readonly maxScore: number | null;
  readonly verdict: 'perfect' | 'partial' | 'zero' | 'no_rubric' | 'invalid_rubric';
  readonly criticalMiss: boolean;
  readonly criteria: readonly RubricCriterionOutcome[];
  readonly missingDescriptions: readonly string[];
  readonly hitNodeIds: readonly string[];
  readonly missedNodeIds: readonly string[];
  /** The rubric revision this score was produced under. */
  readonly rubricVersion: number | null;
  /** Content hash of that revision, so a later edit is detectable. */
  readonly rubricHash: string | null;
  readonly evaluationBasis: string;
  readonly limitations: string;
  readonly authoritative: false;
  readonly basis: string;
}

const LIMITATIONS =
  '本评分基于关键词匹配，不是语义判定：表述正确但用词不同的答案可能被判未命中，反之亦然。结果仅供参考，最终分数须由人工复核确认。';

export function validateRubric(rubric: QuestionRubric | null | undefined): RubricValidation {
  const errors: string[] = [];
  if (!rubric) return { valid: false, errors: ['缺少评分标准（rubric）。'] };

  if (typeof rubric.version !== 'number' || !Number.isInteger(rubric.version) || rubric.version < 1) {
    errors.push('评分标准必须带一个 ≥1 的整数 version，否则历史评分无法与修订对应。');
  }
  if (!Array.isArray(rubric.criteria) || rubric.criteria.length === 0) {
    errors.push('评分标准没有任何采分点（criteria）。');
  }

  const seen = new Set<string>();
  let sum = 0;
  for (const criterion of rubric.criteria ?? []) {
    if (!criterion || typeof criterion.id !== 'string' || criterion.id.trim().length === 0) {
      errors.push('存在没有 id 的采分点，无法逐点审计。');
      continue;
    }
    if (seen.has(criterion.id)) errors.push(`采分点 id 重复：${criterion.id}。`);
    seen.add(criterion.id);
    if (typeof criterion.description !== 'string' || criterion.description.trim().length === 0) {
      errors.push(`采分点 ${criterion.id} 缺少 description（学生看不到评分依据）。`);
    }
    if (typeof criterion.points !== 'number' || !Number.isFinite(criterion.points) || criterion.points <= 0) {
      errors.push(`采分点 ${criterion.id} 的分值非法。`);
      continue;
    }
    if (typeof criterion.evidenceHint !== 'string' || criterion.evidenceHint.trim().length === 0) {
      errors.push(`采分点 ${criterion.id} 缺少 evidenceHint（人工评分无从判断）。`);
    }
    if (!Array.isArray(criterion.matchAny) || criterion.matchAny.length === 0) {
      errors.push(`采分点 ${criterion.id} 没有任何机器可判定依据（matchAny）。`);
    }
    sum += criterion.points;
  }

  if (typeof rubric.totalPoints !== 'number' || rubric.totalPoints !== sum) {
    errors.push(`采分点分值合计 ${sum} 与总分 totalPoints ${rubric.totalPoints} 不一致。`);
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
  const criteria: RubricCriterionOutcome[] = [];
  const hitNodes = new Set<string>();
  const missedNodes = new Set<string>();

  for (const criterion of input.rubric.criteria) {
    const matchedTerm = criterion.matchAny.find((term) => haystack.includes(normalise(term))) ?? null;
    const matched = matchedTerm != null;
    for (const nodeId of criterion.knowledgeNodeIds ?? []) {
      (matched ? hitNodes : missedNodes).add(nodeId);
    }
    criteria.push({
      id: criterion.id,
      description: criterion.description,
      points: criterion.points,
      awarded: matched ? criterion.points : 0,
      matched,
      required: criterion.required === true,
      matchedTerm,
      evidenceHint: criterion.evidenceHint,
      basis: matched
        ? `命中「${matchedTerm}」，得 ${criterion.points} 分。`
        : `未出现任一依据（${criterion.matchAny.join(' / ')}），得 0 分。`,
    });
  }

  const score = criteria.reduce((sum, row) => sum + row.awarded, 0);
  const maxScore = input.rubric.totalPoints;
  const criticalMiss = criteria.some((row) => row.required && !row.matched);
  const missingDescriptions = criteria.filter((row) => !row.matched).map((row) => row.description);
  const verdict: LargeQuestionScore['verdict'] =
    score === 0 ? 'zero' : score === maxScore ? 'perfect' : 'partial';

  return {
    score,
    maxScore,
    verdict,
    criticalMiss,
    criteria,
    missingDescriptions,
    hitNodeIds: [...hitNodes].sort(),
    missedNodeIds: [...missedNodes].sort(),
    rubricVersion: input.rubric.version,
    rubricHash: hashRubric(input.rubric),
    evaluationBasis: RUBRIC_EVALUATION_BASIS,
    limitations: LIMITATIONS,
    authoritative: false,
    basis: `按评分标准 v${input.rubric.version}（${hashRubric(input.rubric)}）离线判定：${score}/${maxScore} 分${criticalMiss ? '；存在必答采分点未命中（关键失分）' : ''}。`,
  };
}

/**
 * Deterministic content hash of a rubric revision.
 *
 * Key-sorted so semantically identical content hashes identically regardless of
 * property order, and stable so a stored score can always be tied to the exact
 * revision it was produced under.
 */
export function hashRubric(rubric: QuestionRubric): string {
  const payload = stableStringify({
    version: rubric.version,
    totalPoints: rubric.totalPoints,
    criteria: rubric.criteria.map((criterion) => ({
      id: criterion.id,
      description: criterion.description,
      points: criterion.points,
      required: criterion.required === true,
      evidenceHint: criterion.evidenceHint,
      matchAny: [...criterion.matchAny],
      knowledgeNodeIds: [...(criterion.knowledgeNodeIds ?? [])],
    })),
  });
  // FNV-1a (32-bit) — small, dependency-free, deterministic across runs.
  let hash = 0x811c9dc5;
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `rv${rubric.version}-${hash.toString(16).padStart(8, '0')}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

function fallback(verdict: 'no_rubric' | 'invalid_rubric', basis: string): LargeQuestionScore {
  return {
    score: null,
    maxScore: null,
    verdict,
    criticalMiss: false,
    criteria: [],
    missingDescriptions: [],
    hitNodeIds: [],
    missedNodeIds: [],
    rubricVersion: null,
    rubricHash: null,
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
