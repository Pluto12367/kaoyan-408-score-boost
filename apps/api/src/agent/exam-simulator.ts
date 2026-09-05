/**
 * AI Exam Simulator (Phase PX-3) — pure paper construction.
 *
 * Hard constraint: the LLM never invents exam content. Every question comes
 * from the real question bank and every coverage node comes from the real
 * knowledge graph (RAG V2 retrieval + engine priority). This module only
 * SELECTS and BALANCES — deterministically.
 *
 * Selection rules:
 * - subject filter applied first (paper scope);
 * - coverage-first round-robin across knowledge points so the paper spans
 *   as many distinct points as possible;
 * - difficulty mix adapts to mastery evidence: weak students get a
 *   BASIC-heavy mix, strong students get a HARD-heavy mix;
 * - within a bucket, higher-frequency/higher-priority points win ties via
 *   the optional frequency hint map.
 */

export interface ExamCandidateQuestion {
  id: string;
  stem: string;
  type: string;
  difficulty: 'BASIC' | 'MEDIUM' | 'HARD';
  knowledgePointIds: readonly string[];
  subject?: string;
}

export interface ExamBuildOptions {
  targetCount: number;
  subject?: string;
  /** Node/point mastery in [0,1] used to adapt the difficulty mix. */
  masteryByPoint?: ReadonlyMap<string, number>;
  /** Optional priority hint per knowledge point (engine score / frequency). */
  priorityByPoint?: ReadonlyMap<string, number>;
}

export interface GeneratedExamPaper {
  questions: ExamCandidateQuestion[];
  coveragePoints: string[];
  difficultyMix: { BASIC: number; MEDIUM: number; HARD: number };
  dropped: number;
}

const WEAK_MASTERY = 0.5;

export function buildExamPaper(
  candidates: readonly ExamCandidateQuestion[],
  options: ExamBuildOptions,
): GeneratedExamPaper {
  const scoped = candidates.filter((question) =>
    options.subject ? question.subject === options.subject || !question.subject : true,
  );

  const masteryByPoint = options.masteryByPoint ?? new Map();
  const priorityByPoint = options.priorityByPoint ?? new Map();

  // Target mix from average mastery of the covered points (evidence-based).
  const masteryValues = scoped.flatMap((question) =>
    question.knowledgePointIds.map((pointId) => masteryByPoint.get(pointId)).filter((value): value is number => value != null),
  );
  const averageMastery = masteryValues.length > 0
    ? masteryValues.reduce((sum, value) => sum + value, 0) / masteryValues.length
    : null;
  const basicShare = averageMastery == null ? 0.34 : averageMastery < WEAK_MASTERY ? 0.5 : averageMastery > 0.75 ? 0.2 : 0.34;
  const hardShare = averageMastery == null ? 0.33 : averageMastery < WEAK_MASTERY ? 0.17 : averageMastery > 0.75 ? 0.5 : 0.33;

  // Group by primary knowledge point for coverage round-robin; within each
  // group, order by the mastery-preferred difficulty (weak → BASIC first,
  // strong → HARD first) then let the priority hint order the groups.
  const groupByPoint = new Map<string, ExamCandidateQuestion[]>();
  for (const question of scoped) {
    const primary = question.knowledgePointIds[0] ?? '__none__';
    const list = groupByPoint.get(primary) ?? [];
    list.push(question);
    groupByPoint.set(primary, list);
  }
  const preferredOrder = averageMastery == null
    ? ['MEDIUM', 'BASIC', 'HARD']
    : averageMastery < WEAK_MASTERY
      ? ['BASIC', 'MEDIUM', 'HARD']
      : averageMastery > 0.75
        ? ['HARD', 'MEDIUM', 'BASIC']
        : ['MEDIUM', 'BASIC', 'HARD'];
  for (const [, list] of groupByPoint) {
    list.sort((left, right) =>
      preferredOrder.indexOf(left.difficulty) - preferredOrder.indexOf(right.difficulty));
  }
  const groups = [...groupByPoint.entries()].sort((left, right) =>
    (priorityByPoint.get(right[0]) ?? 0) - (priorityByPoint.get(left[0]) ?? 0),
  );

  const selected: ExamCandidateQuestion[] = [];
  const difficultyMix = { BASIC: 0, MEDIUM: 0, HARD: 0 };
  const bucketTarget = (bucket: 'BASIC' | 'MEDIUM' | 'HARD'): number => {
    const share = bucket === 'BASIC' ? basicShare : bucket === 'HARD' ? hardShare : 1 - basicShare - hardShare;
    return Math.ceil(share * options.targetCount);
  };

  // Pass 1 (coverage): one preferred question per group per pass — no bucket
  // quota, coverage spans as many distinct points as the slots allow.
  // Later passes: refill respecting the difficulty mix targets.
  let pass = 0;
  const consumed = new Set<string>();
  while (selected.length < options.targetCount && pass < Math.max(groups.length, 1)) {
    let progressInPass = false;
    for (const [, list] of groups) {
      if (selected.length >= options.targetCount) break;
      const pickFrom = pass === 0
        ? [list.find((question) => !consumed.has(question.id))]
        : list;
      const next = (pass === 0
        ? pickFrom[0]
        : pickFrom.find((question) => {
            if (!question || consumed.has(question.id)) return false;
            const bucket = question.difficulty;
            return difficultyMix[bucket] < bucketTarget(bucket) || selected.length >= options.targetCount - 1;
          }));
      if (!next) continue;
      consumed.add(next.id);
      selected.push(next);
      difficultyMix[next.difficulty] += 1;
      progressInPass = true;
    }
    if (!progressInPass) break;
    pass += 1;
  }

  return {
    questions: selected,
    coveragePoints: [...new Set(selected.flatMap((question) => question.knowledgePointIds))],
    difficultyMix,
    dropped: scoped.length - selected.length,
  };
}

/**
 * Post-exam analysis (pure): per-point accuracy, weak points and a
 * next-step suggestion skeleton. Facts only — the narrative layer may
 * decorate this, but the numbers are computed here.
 */
export interface ExamAnswerFact {
  questionId: string;
  knowledgePointIds: readonly string[];
  correct: boolean;
}

export interface ExamAnalysis {
  answeredCount: number;
  correctCount: number;
  accuracyPercent: number;
  perPoint: Array<{ knowledgePointId: string; correct: number; total: number; accuracyPercent: number }>;
  weakPoints: string[];
  strongPoints: string[];
  nextStepSuggestion: string;
}

export function analyzeExam(facts: readonly ExamAnswerFact[]): ExamAnalysis {
  const correctCount = facts.filter((fact) => fact.correct).length;
  const perPointMap = new Map<string, { correct: number; total: number }>();
  for (const fact of facts) {
    for (const pointId of fact.knowledgePointIds) {
      const entry = perPointMap.get(pointId) ?? { correct: 0, total: 0 };
      entry.total += 1;
      if (fact.correct) entry.correct += 1;
      perPointMap.set(pointId, entry);
    }
  }
  const perPoint = [...perPointMap.entries()]
    .map(([knowledgePointId, entry]) => ({
      knowledgePointId,
      correct: entry.correct,
      total: entry.total,
      accuracyPercent: Math.round((entry.correct / entry.total) * 100),
    }))
    .sort((left, right) => left.accuracyPercent - right.accuracyPercent);
  const weakPoints = perPoint.filter((entry) => entry.accuracyPercent < 60).map((entry) => entry.knowledgePointId);
  const strongPoints = perPoint.filter((entry) => entry.accuracyPercent >= 80).map((entry) => entry.knowledgePointId);
  const accuracyPercent = facts.length === 0 ? 0 : Math.round((correctCount / facts.length) * 100);
  return {
    answeredCount: facts.length,
    correctCount,
    accuracyPercent,
    perPoint,
    weakPoints,
    strongPoints,
    nextStepSuggestion: weakPoints.length > 0
      ? `优先复盘薄弱知识点（${weakPoints.slice(0, 3).join('、')}），再以变式题验证`
      : '本卷表现稳定，建议按推荐引擎继续提升进阶考点',
  };
}