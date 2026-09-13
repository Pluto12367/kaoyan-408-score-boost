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

/**
 * S1-I0 (INV-6) — the P0-6 factor partition.
 *
 * The audit (§7.4) found ~0.80 of the weight sitting on facts the recommendation
 * engine already scores, so the same evidence was counted twice. Each factor now
 * carries exactly ONE semantic, and no underlying fact appears in two factors:
 *
 *   scoreAtStake    how many points this node is worth x how often it appears
 *                   (replaces the old `examImportance`; still absolute normalised)
 *   learnerWeakness how far from mastery (replaces the old `weakness`)
 *   urgency         TIME PRESSURE ONLY — `retention` was removed because the
 *                   engine already models forgetting; averaging it in here was
 *                   the second contribution of the same fact
 *   recovery        recoverability proxy (was `recoverability`)
 *   trainingCost    independent estimate, never a score input for the engine
 *
 * `evidenceConfidence` is deliberately NOT a factor any more. It answers "how
 * much do we trust the data", which is not a value, so weighting it at 0.08
 * mixed confidence into worth. It is now a GATE (see `evidenceGatePasses`).
 * `importance` was removed for collinearity with frequency.
 */
export type OpportunityFactorKey =
  | 'learnerWeakness'
  | 'scoreAtStake'
  | 'recovery'
  | 'urgency'
  | 'trainingCost';

/** Minimum snapshot confidence at which a weighted factor may be computed. */
export const OPPORTUNITY_MIN_EVIDENCE_CONFIDENCE = 'MEDIUM' as const;

/** The one canonical factor that is gated on evidence confidence. */
export const EVIDENCE_GATED_FACTOR: OpportunityFactorKey = 'scoreAtStake';

export function evidenceGatePasses(
  confidence: 'HIGH' | 'MEDIUM' | 'LOW' | null | undefined,
): boolean {
  return confidence === 'HIGH' || confidence === OPPORTUNITY_MIN_EVIDENCE_CONFIDENCE;
}

/**
 * S1-I0 (INV-5) — the ONE canonical normalisation for the five-year primary score.
 *
 * 45 is the 408 full-paper score basis, so the value is ABSOLUTE: a node's weight
 * never depends on which other nodes happen to be in the candidate set. The
 * previous relative form (`primaryScore5y / max(primaryScore5y across the pool)`)
 * gave the same node a different `examImportance` in two different pools and made
 * the two opportunity entry points incomparable.
 *
 * `null` means "no snapshot / unknown" and is never coerced to 0. A stored 0 is a
 * real observation ("this node carried no points in five years") and stays 0.
 */
export const EXAM_SCORE_WEIGHT_SCALE = 45;

export function normalizeExamScoreWeight(primaryScore5y: number | null | undefined): number | null {
  if (primaryScore5y == null || !Number.isFinite(primaryScore5y)) return null;
  if (primaryScore5y <= 0) return 0;
  return Math.min(1, primaryScore5y / EXAM_SCORE_WEIGHT_SCALE);
}

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
    key: 'learnerWeakness',
    source: 'UserKnowledgeMastery.mastery',
    maxConfidence: 'high',
    basis: '缺口严重度 = 1 − 存储掌握度，来自唯一掌握度写方产出的 EMA 值。',
  },
  {
    key: 'scoreAtStake',
    source: 'KnowledgeFrequencySnapshot.primaryScore5y + recent3Frequency（绝对归一）',
    maxConfidence: 'high',
    basis: '分值风险 = clamp01(primaryScore5y / 45)（45 为 408 全卷分值口径，绝对归一）× 频次；无快照的节点不得按 0 处理。',
  },
  {
    key: 'recovery',
    source: '代理：UserKnowledgeMastery.correctCount>0 + KnowledgeRelation 前置就绪度',
    maxConfidence: 'low',
    basis: '系统没有"可恢复性"的直接测量，本项为代理指标：曾经做对过、且前置节点已就绪，视为更可恢复。知识关系数据稀疏（33 前置/21 关联）进一步限制其可靠性。',
  },
  {
    key: 'urgency',
    source: 'resolveDaysToExam() 的 days（唯一考试时间线 resolver）',
    maxConfidence: 'high',
    basis: '紧迫度只由"离考试还有多久"一项决定；保持率(retention)由推荐引擎的 forgetting 分量负责，不在本因子二次计权。',
  },
  {
    key: 'trainingCost',
    source: '估算：score-center/plan.ts estimateMinutes(action, difficulty)',
    maxConfidence: 'medium',
    basis: '训练成本为生产估算器的输出，不是实测用时；因此置信最多为 medium。',
  },
] as const;

/**
 * Weights over the five partitioned factors, normalised to 1. Deliberately
 * inspectable: a reviewer must be able to recompute any score by hand.
 *
 * P0-6 restated the weights onto the new partition. The old `evidenceConfidence`
 * share (0.08) is redistributed to the two factors it actually informs
 * (`scoreAtStake`, `learnerWeakness`) now that confidence is a gate.
 */
export const SCORE_OPPORTUNITY_WEIGHTS: Readonly<Record<OpportunityFactorKey, number>> = {
  learnerWeakness: 0.3,
  scoreAtStake: 0.28,
  recovery: 0.12,
  urgency: 0.12,
  trainingCost: 0.18,
};

/** Without these there is no defensible opportunity number at all. */
export const REQUIRED_OPPORTUNITY_FACTORS: readonly OpportunityFactorKey[] = [
  'learnerWeakness',
  'scoreAtStake',
  'trainingCost',
];

const REQUIRED = new Set<OpportunityFactorKey>(REQUIRED_OPPORTUNITY_FACTORS);

export interface ScoreOpportunityInput {
  readonly nodeId: string;
  readonly title: string;
  /** 0..1 gap severity (1 − mastery). null = no mastery row. */
  readonly learnerWeakness: number | null;
  /** 0..1 normalised exam-points value for this node alone. null = no snapshot (NOT zero). */
  readonly scoreAtStake: number | null;
  /** 0..1 frequency component of the same fact set (0..1). null = no snapshot. */
  readonly recent3Frequency?: number | null;
  /** Snapshot confidence. Gates `scoreAtStake`; never a weighted factor. */
  readonly evidenceConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  readonly daysToExam: number | null;
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
  /**
   * S1-I0 (INV-7 / INV-15). `expectedBenefit` is an UNCALIBRATED heuristic band,
   * not a measurement. `kind` is therefore PROXY (not DERIVED: nothing is
   * deterministically derived from observations) and `calibrated` is false until
   * a real score comparison exists. It must never be read as a verified gain.
   */
  readonly expectedBenefitKind: 'PROXY';
  readonly expectedBenefitCalibrated: false;
  /** Snapshot confidence passed the gate, or the reason it did not. */
  readonly evidenceConfidence: 'HIGH' | 'MEDIUM' | 'LOW' | null;
  readonly evidenceGatePassed: boolean;
  readonly risk: string;
  readonly authoritative: false;
  readonly basis: string;
}

export function buildScoreOpportunity(input: ScoreOpportunityInput): ScoreOpportunity {
  // P0-6: `scoreAtStake` is gated on snapshot confidence instead of being
  // weighted by it. LOW/absent confidence makes the factor unmeasurable, which
  // blocks the score (it is a REQUIRED factor) rather than silently discounting
  // it — an unconfident fact must not produce a confident-looking number.
  const gatePassed = evidenceGatePasses(input.evidenceConfidence);

  const raw: Record<OpportunityFactorKey, number | null> = {
    learnerWeakness: clamp01(input.learnerWeakness),
    scoreAtStake: gatePassed ? scoreAtStakeValue(input.scoreAtStake, input.recent3Frequency) : null,
    recovery: recoverabilityProxy(input),
    urgency: urgencyValue(input.daysToExam),
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
      expectedBenefitKind: 'PROXY',
      expectedBenefitCalibrated: false,
      evidenceConfidence: input.evidenceConfidence,
      evidenceGatePassed: gatePassed,
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
    expectedBenefitKind: 'PROXY',
    expectedBenefitCalibrated: false,
    evidenceConfidence: input.evidenceConfidence,
    evidenceGatePassed: gatePassed,
    risk: buildRisk(input),
    authoritative: false,
    basis: exclusions.length > 0
      ? `按已发布权重在 ${usable.length} 个可用因子上归一化计算；${exclusions.length} 个因子因缺数据被排除并已列出。影子结果，不写任何表。`
      : `按已发布权重在 ${SCORE_OPPORTUNITY_FACTORS.length} 个已分区因子上加权计算；影子结果，不写任何表。`,
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

/**
 * P0-6 `scoreAtStake` — "how many points is this node worth, and how often does
 * it appear". Both components are the SAME published fact set that the engine's
 * `examValue` reads, which is why the R-rule in the design forbids summing the
 * two models' scores; within opportunity it is counted exactly once.
 *
 * Absolute normalisation (INV-5): the point component never depends on which
 * other nodes are in the pool. Unknown stays null — never 0.
 */
function scoreAtStakeValue(
  normalizedPoints: number | null,
  recent3Frequency: number | null | undefined,
): number | null {
  const points = clamp01(normalizedPoints);
  if (points == null) return null;
  // Frequency is a second, genuinely independent signal about the same node, and
  // is optional: without it the point component alone still stands (and says so
  // through the exclusion list only if it is entirely absent).
  const frequency = recent3Frequency == null || !Number.isFinite(recent3Frequency)
    ? null
    : Math.min(1, Math.max(0, recent3Frequency) / 5);
  if (frequency == null) return points;
  return Math.round((points * frequency) * 1000) / 1000;
}

function confidenceToValue(confidence: ScoreOpportunityInput['evidenceConfidence']): number | null {
  if (confidence === 'HIGH') return 1;
  if (confidence === 'MEDIUM') return 0.6;
  if (confidence === 'LOW') return 0.3;
  return null;
}

/** Kept for callers that want the raw confidence as a 0..1 magnitude. */
export function evidenceConfidenceMagnitude(
  confidence: ScoreOpportunityInput['evidenceConfidence'],
): number | null {
  return confidenceToValue(confidence);
}

/**
 * P0-6 `urgency` — TIME PRESSURE ONLY. `retention` was removed from this factor
 * because the recommendation engine already models forgetting; averaging it in
 * here contributed the same underlying fact a second time (audit DC-2). With no
 * exam timeline the factor is unknown rather than assumed.
 */
function urgencyValue(daysToExam: number | null): number | null {
  if (daysToExam == null || !Number.isFinite(daysToExam)) return null;
  const bounded = Math.max(0, daysToExam);
  return Math.round((1 / (1 + bounded / 60)) * 1000) / 1000;
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
  if ((raw.learnerWeakness ?? 0) >= 0.5) drivers.push('掌握度缺口较大');
  if ((raw.scoreAtStake ?? 0) >= 0.5) drivers.push('真题分值风险较高');
  if ((raw.urgency ?? 0) >= 0.5) drivers.push('考试临近');
  if ((raw.recovery ?? 0) >= 0.6) drivers.push('前置就绪且曾做对（代理指标）');
  if ((raw.trainingCost ?? 1) >= 0.6) drivers.push('单位训练成本较低');
  if (drivers.length === 0) drivers.push('各因子均处于中低水平，优先级不高');
  const tail = exclusions.length > 0
    ? `；已排除 ${exclusions.map((item) => item.key).join('、')}（缺数据）`
    : '';
  return `${input.title}：${drivers.join('、')}${tail}。`;
}

function expectedBenefit(input: ScoreOpportunityInput): string {
  const weakness = input.learnerWeakness ?? 0;
  const stake = input.scoreAtStake ?? 0;
  // S1-I0 (P0-5 / INV-15): an UNCALIBRATED heuristic band. The wording must not
  // promise a score gain — "提分" without a qualifier is exactly the claim the
  // design forbids, because nothing here has ever been compared to a real score.
  const low = Math.round(weakness * stake * 6 * 10) / 10;
  const high = Math.round(weakness * stake * 14 * 10) / 10;
  return `未标定的估算区间 ${low}–${high}（内部决策变量，非分数增益；kind=PROXY, calibrated=false）。`
    + '该区间由缺口×分值风险启发式给出，从未与真实成绩对照，不得表述为"提分"或任何已验证的分数变化。';
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
    case 'learnerWeakness':
      return '掌握度缺口';
    case 'scoreAtStake':
      return '分值风险（scoreAtStake）';
    case 'recovery':
      return '可恢复性（代理）';
    case 'urgency':
      return '紧迫度';
    case 'trainingCost':
      return '训练成本（trainingCost）';
    default:
      return key;
  }
}
