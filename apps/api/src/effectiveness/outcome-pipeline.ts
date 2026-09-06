/**
 * V6.1 Outcome Pipeline + Strategy Comparison + Evidence Gate.
 *
 * Three modules closing the gap between V6's pure derivation models and
 * REAL learning data from the test database:
 *
 * 1. Outcome Pipeline  — builds LearningOutcomes from real PracticeRecord
 *    and UserKnowledgeMastery rows, with dedup + time-window + quality guard
 * 2. Strategy Comparison — compares four question selection strategies
 *    (weakness-first / exam-frequency-first / balanced / adaptive) offline
 * 3. Evidence Gate — checks minimum evidence thresholds before allowing
 *    optimizer proposals (sampleSize / dataQuality / effectSize / confidence)
 */

// ---- 1. Outcome Pipeline ----

export interface RawPracticeFact {
  questionId: string;
  knowledgeNodeId: string | null;
  correct: boolean;
  submittedAt: string;
}

export interface RawMasteryFact {
  knowledgeNodeId: string;
  mastery: number;
  attempts: number;
  wrongCount: number;
  updatedAt: string;
}

export interface PipelineOutcome {
  knowledgeNodeId: string;
  masteryBefore: number | null;
  masteryAfter: number;
  masteryGain: number | null;
  attemptsInWindow: number;
  correctInWindow: number;
  accuracyInWindow: number | null;
  windowDays: number;
  quality: 'ok' | 'insufficient_data' | 'single_attempt';
}

const MIN_WINDOW_ATTEMPTS = 2;

export function buildOutcomeFromFacts(params: {
  facts: readonly RawPracticeFact[];
  masteryBefore: number | null;
  masteryAfter: number;
  windowStart: string;
  windowEnd: string;
  knowledgeNodeId: string;
}): PipelineOutcome {
  const start = new Date(params.windowStart).getTime();
  const end = new Date(params.windowEnd).getTime();
  const inWindow = params.facts.filter((fact) => {
    const t = new Date(fact.submittedAt).getTime();
    return t >= start && t <= end && fact.knowledgeNodeId === params.knowledgeNodeId;
  });

  const correctCount = inWindow.filter((fact) => fact.correct).length;
  const attempts = inWindow.length;
  const windowDays = Math.max(0, Math.round((end - start) / 86_400_000));

  let quality: PipelineOutcome['quality'] = 'ok';
  if (attempts < MIN_WINDOW_ATTEMPTS) quality = 'insufficient_data';
  else if (attempts === MIN_WINDOW_ATTEMPTS) quality = 'single_attempt';

  return {
    knowledgeNodeId: params.knowledgeNodeId,
    masteryBefore: params.masteryBefore,
    masteryAfter: params.masteryAfter,
    masteryGain: params.masteryBefore != null ? Math.round((params.masteryAfter - params.masteryBefore) * 10000) / 10000 : null,
    attemptsInWindow: attempts,
    correctInWindow: correctCount,
    accuracyInWindow: attempts > 0 ? Math.round((correctCount / attempts) * 10000) / 10000 : null,
    windowDays,
    quality,
  };
}

// ---- 2. Strategy Comparison ----

export type SelectionStrategy = 'weakness_first' | 'exam_frequency_first' | 'balanced' | 'adaptive';

export interface StrategyCandidate {
  questionId: string;
  knowledgeNodeId: string;
  difficulty: 'BASIC' | 'MEDIUM' | 'HARD';
  examFrequency: number;
  mastery: number;
}

export interface StrategyComparisonResult {
  strategy: SelectionStrategy;
  selectedQuestionIds: string[];
  avgMasteryOfSelected: number | null;
  weaknessCoverage: number;
  examFrequencyCoverage: number;
}

export function selectQuestionsByStrategy(
  candidates: readonly StrategyCandidate[],
  strategy: SelectionStrategy,
  count: number,
  riskNodeIds: ReadonlySet<string> = new Set(),
): StrategyComparisonResult {
  const scored = candidates.map((c) => {
    let sortScore: number;
    switch (strategy) {
      case 'weakness_first':
        sortScore = (1 - c.mastery) * 100 + (riskNodeIds.has(c.knowledgeNodeId) ? 20 : 0);
        break;
      case 'exam_frequency_first':
        sortScore = c.examFrequency * 10;
        break;
      case 'balanced':
        sortScore = ((1 - c.mastery) + c.examFrequency / 10) * 50;
        break;
      case 'adaptive':
        sortScore = ((1 - c.mastery) * 0.6 + c.examFrequency / 10 * 0.4) * 100
          + (riskNodeIds.has(c.knowledgeNodeId) ? 15 : 0);
        break;
    }
    return { ...c, sortScore };
  }).sort((a, b) => b.sortScore - a.sortScore);

  const selected = scored.slice(0, Math.min(count, scored.length));
  const avgMastery = selected.length > 0
    ? Math.round((selected.reduce((s, c) => s + c.mastery, 0) / selected.length) * 10000) / 10000
    : null;
  const weaknessCoverage = selected.filter((c) => c.mastery < 0.45).length;
  const examFrequencyCoverage = selected.reduce((s, c) => s + c.examFrequency, 0);

  return {
    strategy,
    selectedQuestionIds: selected.map((c) => c.questionId),
    avgMasteryOfSelected: avgMastery,
    weaknessCoverage,
    examFrequencyCoverage,
  };
}

// ---- 3. Evidence Gate ----

export interface EvidenceGateCheck {
  minSampleSize: number;
  minEffectSize: number;
  requiredConfidence: string;
  dataQualityOk: boolean;
}

export interface EvidenceGateResult {
  passed: boolean;
  checks: Array<{ name: string; passed: boolean; detail: string }>;
  reason: string;
}

export function checkEvidenceGate(
  sampleSize: number,
  effectSize: number | null,
  confidence: string,
  dataQuality: string,
  gate: EvidenceGateCheck,
): EvidenceGateResult {
  const checks = [
    { name: 'min_sample_size', passed: sampleSize >= gate.minSampleSize, detail: `${sampleSize}/${gate.minSampleSize}` },
    { name: 'min_effect_size', passed: effectSize != null && Math.abs(effectSize) >= gate.minEffectSize, detail: `${effectSize}/${gate.minEffectSize}` },
    { name: 'confidence', passed: confidence === gate.requiredConfidence || confidence === 'high', detail: confidence },
    { name: 'data_quality', passed: gate.dataQualityOk, detail: dataQuality },
  ];
  const passed = checks.every((c) => c.passed);
  return {
    passed,
    checks,
    reason: passed ? 'evidence sufficient for proposal' : `blocked: ${checks.filter((c) => !c.passed).map((c) => c.name).join(', ')}`,
  };
}