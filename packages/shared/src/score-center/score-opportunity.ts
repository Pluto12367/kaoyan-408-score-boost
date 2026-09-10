/**
 * V12-M4 — Score Opportunity shadow model (pure module).
 *
 * ## The question
 *
 * "If this student only has a limited amount of time right now, which weak
 * point is most worth training?" The recommendation engine already ranks by
 * exam frequency x gap; what it does NOT model (V12-0 audit) is recoverability,
 * training cost and therefore benefit PER UNIT TIME.
 *
 * ## The rule this module obeys
 *
 * The mission states plainly that a formula is not a fact: every variable must
 * be checked against real data. So:
 *
 *   • every factor declares the table/field it comes from, and its confidence
 *   • a REQUIRED factor with no data blocks the score entirely (null) and names
 *     the blocker — no plausible-looking substitute, no silent zero
 *   • an OPTIONAL factor with no data is excluded, stated, and lowers the
 *     stated confidence; weights are renormalised over what remains
 *   • the weights are published constants, so the number can be recomputed by
 *     hand — this is the opposite of a black-box score
 *
 * Two factors are honest PROXIES, not measurements, and say so:
 *   recoverability   no direct measurement exists in this system
 *   trainingCost     a production ESTIMATE (estimateMinutes), not observed time
 *
 * Pure: zero imports, deterministic.
 */

export type OpportunityFactorKey =
  | 'weakness'
  | 'examImportance'
  | 'recoverability'
  | 'evidenceConfidence'
  | 'urgency'
  | 'trainingCost';

export type FactorConfidence = 'high' | 'medium' | 'low' | 'none';

export interface OpportunityFactorSpec {
  readonly key: OpportunityFactorKey;
  /** Where the number comes from — a real table/field, or the proxy it stands on. */
  readonly source: string;
  /** The best confidence this factor can ever claim. */
  readonly maxConfidence: Exclude<FactorConfidence, 'none'>;
  readonly basis: string;
}

/**
 * Published factor catalogue. Docs, endpoints and tests read this instead of
 * restating the model.
 */
export const SCORE_OPPORTUNITY_FACTORS: readonly OpportunityFactorSpec[] = [
  {
    key: 'weakness',
    source: 'UserKnowledgeMastery.mastery',
    maxConfidence: 'high',
    basis: '缺口严重度 = 1 − 存储掌握度，来自唯一掌握度写方产出的 EMA 值。',
  },
  {
    key: 'examImportance',
    source: 'KnowledgeFrequencySnapshot.recent3Frequency / recent5Frequency / allTimeEvidence / primaryScore5y',
    maxConfidence: 'high',
    basis: '考频证据由真题快照直接给出；无快照的节点不得按 0 处理。',
  },
  {
    key: 'recoverability',
    source: '代理：UserKnowledgeMastery.correctCount>0 + KnowledgeRelation 前置就绪度',
    maxConfidence: 'low',
    basis: '系统没有"可恢复性"的直接测量，本项为代理指标：曾经做对过、且前置节点已就绪，视为更可恢复。知识关系数据稀疏（33 前置/21 关联）进一步限制其可靠性。',
  },
  {
    key: 'evidenceConfidence',
    source: 'KnowledgeFrequencySnapshot.evidenceConfidence',
    maxConfidence: 'high',
    basis: '考频证据自身的置信标注（HIGH/MEDIUM/LOW），不额外加工。',
  },
  {
    key: 'urgency',
    source: 'User.targetScore 考试日期 + UserKnowledgeMastery.retention / stabilityDays',
    maxConfidence: 'high',
    basis: '紧迫度 = 考试临近程度与当前保持率下滑的合成；两者均为已存字段。',
  },
  {
    key: 'trainingCost',
    source: '估算：score-center/plan.ts estimateMinutes(action, difficulty)',
    maxConfidence: 'medium',
    basis: '训练成本为生产估算器的输出，不是实测用时；因此置信最多为 medium。',
  },
] as const;

/**
 * Weights over the six factors, normalised to 1. Deliberately inspectable:
 * a reviewer must be able to recompute any score by hand.
 */
export const SCORE_OPPORTUNITY_WEIGHTS: Readonly<Record<OpportunityFactorKey, number>> = {
  weakness: 0.28,
  examImportance: 0.22,
  recoverability: 0.12,
  evidenceConfidence: 0.08,
  urgency: 0.12,
  trainingCost: 0.18,
};

/** Without these there is no defensible opportunity number at all. */
export const REQUIRED_OPPORTUNITY_FACTORS: readonly OpportunityFactorKey[] = [
  'weakness',
  'examImportance',
  'trainingCost',
];

const REQUIRED = new Set<OpportunityFactorKey>(REQUIRED_OPPORTUNITY_FACTORS);

export interface ScoreOpportunityInput {
  readonly nodeId: string;
  readonly title: string;
  /** 0..1 gap severity. null = no mastery row. */
  readonly weakness: number | null;
  /** 0..1 normalised exam-frequency evidence. null = no snapshot (NOT zero). */
  readonly examImportance: number | null;
  readonly evidenceConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  readonly daysToExam: number | null;
  /** Current retention, 0..1. null = unknown. */
  readonly retentionNow: number | null;
  /** Whether the student has ever answered this node correctly. null = unknown. */
  readonly everSucceeded: boolean | null;
  /** 0..1 prerequisite readiness. null = unknown / no relations recorded. */
  readonly prerequisiteReadiness: number | null;
  readonly trainingCostMinutes: number | null;
}

export interface OpportunityFactorValue {
  readonly key: OpportunityFactorKey;
  readonly value: number | null;
  readonly weight: number;
  readonly confidence: FactorConfidence;
  readonly source: string;
  readonly basis: string;
}

export interface OpportunityExclusion {
  readonly key: OpportunityFactorKey;
  readonly reason: string;
}

export interface ScoreOpportunity {
  readonly nodeId: string;
  readonly title: string;
  /** null when a required factor is unmeasurable — never a guess. */
  readonly score: number | null;
  readonly confidence: 'high' | 'medium' | 'low' | 'none';
  readonly factors: readonly OpportunityFactorValue[];
  readonly exclusions: readonly OpportunityExclusion[];
  readonly blockedBy: readonly OpportunityFactorKey[];
  readonly reason: string;
  readonly expectedBenefit: string;
  readonly expectedBenefitIsEstimate: true;
  readonly risk: string;
  readonly authoritative: false;
  readonly basis: string;
}

export function buildScoreOpportunity(input: ScoreOpportunityInput): ScoreOpportunity {
  const raw: Record<OpportunityFactorKey, number | null> = {
    weakness: clamp01(input.weakness),
    examImportance: clamp01(input.examImportance),
    recoverability: recoverabilityProxy(input),
    evidenceConfidence: confidenceToValue(input.evidenceConfidence),
    urgency: urgencyValue(input.daysToExam, input.retentionNow),
    trainingCost: costValue(input.trainingCostMinutes),
  };

  const factors: OpportunityFactorValue[] = SCORE_OPPORTUNITY_FACTORS.map((spec) => ({
    key: spec.key,
    value: raw[spec.key],
    weight: SCORE_OPPORTUNITY_WEIGHTS[spec.key],
    confidence: raw[spec.key] == null ? 'none' : spec.maxConfidence,
    source: spec.source,
    basis: spec.basis,
  }));

  const blockedBy = REQUIRED_OPPORTUNITY_FACTORS.filter((key) => raw[key] == null);
  const exclusions: OpportunityExclusion[] = SCORE_OPPORTUNITY_FACTORS
    .filter((spec) => !REQUIRED.has(spec.key) && raw[spec.key] == null)
    .map((spec) => ({
      key: spec.key,
      reason: `缺少可支撑该因子的真实数据（${spec.source}），已从机会分中排除而非按 0 计入。`,
    }));

  if (blockedBy.length > 0) {
    return {
      nodeId: input.nodeId,
      title: input.title,
      score: null,
      confidence: 'none',
      factors,
      exclusions,
      blockedBy,
      reason: `不出分：必需因子 ${blockedBy.map(describeFactorKey).join('、')} 缺少真实数据支撑，拒绝用替代值估算。`,
      expectedBenefit: '无法给出收益估计：缺少必需因子。',
      expectedBenefitIsEstimate: true,
      risk: '无分数即无建议——避免在证据不足时误导训练优先级。',
      authoritative: false,
      basis: `机会分在必需因子缺失时置空（缺少：${blockedBy.map(describeFactorKey).join('、')}），这是刻意的诚实缺席，不是计算失败。`,
    };
  }

  // Renormalise over the factors that actually have data.
  const usable = factors.filter((factor) => factor.value != null);
  const weightSum = usable.reduce((sum, factor) => sum + factor.weight, 0);
  const score = Math.round(
    usable.reduce((sum, factor) => sum + factor.weight * (factor.value ?? 0), 0) / weightSum * 1000,
  ) / 1000;

  const confidence = resolveConfidence(usable, exclusions.length);

  return {
    nodeId: input.nodeId,
    title: input.title,
    score,
    confidence,
    factors,
    exclusions,
    blockedBy: [],
    reason: buildReason(input, raw, exclusions),
    expectedBenefit: expectedBenefit(input),
    expectedBenefitIsEstimate: true,
    risk: buildRisk(input),
    authoritative: false,
    basis: exclusions.length > 0
      ? `按已发布权重在 ${usable.length} 个可用因子上归一化计算；${exclusions.length} 个因子因缺数据被排除并已列出。影子结果，不写任何表。`
      : '按已发布权重在 6 个因子上加权计算；影子结果，不写任何表。',
  };
}

// ---------------------------------------------------------------------------
// Factor derivations — each one states what it can and cannot claim
// ---------------------------------------------------------------------------

/**
 * PROXY. The system has no direct measurement of "how recoverable is this".
 * Two real signals stand in for it, both weak:
 *   • has the student ever succeeded here (correctCount > 0)?
 *   • are the prerequisites already in place?
 * Returns null only when both signals are unknown, so the factor is excluded
 * rather than guessed.
 */
function recoverabilityProxy(input: ScoreOpportunityInput): number | null {
  const parts: number[] = [];
  if (input.everSucceeded != null) parts.push(input.everSucceeded ? 0.7 : 0.3);
  if (input.prerequisiteReadiness != null) parts.push(clamp01(input.prerequisiteReadiness) ?? 0.5);
  if (parts.length === 0) return null;
  const average = parts.reduce((sum, value) => sum + value, 0) / parts.length;
  // A node the student has never once answered correctly must not be credited
  // with strong recoverability merely because its prerequisites are in place:
  // that would recommend training something with no demonstrated entry point.
  const capped = input.everSucceeded === false ? Math.min(average, 0.45) : average;
  return Math.round(capped * 1000) / 1000;
}

function confidenceToValue(confidence: ScoreOpportunityInput['evidenceConfidence']): number | null {
  if (confidence === 'HIGH') return 1;
  if (confidence === 'MEDIUM') return 0.6;
  if (confidence === 'LOW') return 0.3;
  return null;
}

/**
 * Urgency combines how close the exam is with how much retention has already
 * decayed. Both are stored fields; with neither, urgency is unknown.
 */
function urgencyValue(daysToExam: number | null, retentionNow: number | null): number | null {
  const parts: number[] = [];
  if (daysToExam != null && Number.isFinite(daysToExam)) {
    const bounded = Math.max(0, daysToExam);
    parts.push(1 / (1 + bounded / 60));
  }
  if (retentionNow != null) parts.push(1 - (clamp01(retentionNow) ?? 0));
  if (parts.length === 0) return null;
  return Math.round((parts.reduce((sum, value) => sum + value, 0) / parts.length) * 1000) / 1000;
}

/** Higher cost lowers opportunity; normalised against a 2-hour session. */
function costValue(minutes: number | null): number | null {
  if (minutes == null || !Number.isFinite(minutes) || minutes <= 0) return null;
  return Math.round(Math.max(0.05, 1 - Math.min(minutes, 120) / 120) * 1000) / 1000;
}

function resolveConfidence(
  usable: readonly OpportunityFactorValue[],
  exclusionCount: number,
): 'high' | 'medium' | 'low' | 'none' {
  if (exclusionCount >= 2) return 'low';
  const floor = usable.some((factor) => factor.confidence === 'low');
  if (floor || exclusionCount === 1) return 'medium';
  return 'high';
}

function buildReason(
  input: ScoreOpportunityInput,
  raw: Record<OpportunityFactorKey, number | null>,
  exclusions: readonly OpportunityExclusion[],
): string {
  const drivers: string[] = [];
  if ((raw.weakness ?? 0) >= 0.5) drivers.push('掌握度缺口较大');
  if ((raw.examImportance ?? 0) >= 0.5) drivers.push('真题考频较高');
  if ((raw.urgency ?? 0) >= 0.5) drivers.push('考试临近或保持率下滑');
  if ((raw.recoverability ?? 0) >= 0.6) drivers.push('前置就绪且曾做对（代理指标）');
  if ((raw.trainingCost ?? 1) >= 0.6) drivers.push('单位训练成本较低');
  if (drivers.length === 0) drivers.push('各因子均处于中低水平，优先级不高');
  const tail = exclusions.length > 0
    ? `；已排除 ${exclusions.map((item) => item.key).join('、')}（缺数据）`
    : '';
  return `${input.title}：${drivers.join('、')}${tail}。`;
}

function expectedBenefit(input: ScoreOpportunityInput): string {
  const weakness = input.weakness ?? 0;
  const importance = input.examImportance ?? 0;
  // A band, deliberately wide: this is an estimate, not a measurement.
  const low = Math.round(weakness * importance * 6 * 10) / 10;
  const high = Math.round(weakness * importance * 14 * 10) / 10;
  return `估算提分区间 ${low}–${high} 分（基于缺口×考频，非实测；需真实模考对照才可确认）。`;
}

function buildRisk(input: ScoreOpportunityInput): string {
  const notes: string[] = ['机会分是影子模型，未与真实成绩对照，不可作为唯一决策依据。'];
  if (input.prerequisiteReadiness == null) {
    notes.push('前置就绪度未知：知识关系数据稀疏（33 前置/21 关联），节点可能实际不具备先修基础。');
  }
  if (input.trainingCostMinutes != null && input.trainingCostMinutes > 60) {
    notes.push('训练成本偏高，单次会话可能无法完成，需拆分为多次。');
  }
  return notes.join('');
}

function clamp01(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
}

/** Human-facing Chinese name for a factor, so blockers read as words. */
function describeFactorKey(key: OpportunityFactorKey): string {
  switch (key) {
    case 'weakness':
      return '掌握度缺口';
    case 'examImportance':
      return '考频重要性（examImportance）';
    case 'recoverability':
      return '可恢复性（代理）';
    case 'evidenceConfidence':
      return '考频证据置信';
    case 'urgency':
      return '紧迫度';
    case 'trainingCost':
      return '训练成本（trainingCost）';
    default:
      return key;
  }
}
