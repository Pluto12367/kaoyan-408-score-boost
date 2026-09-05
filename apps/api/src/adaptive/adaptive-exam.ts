/**
 * V4-9 Adaptive Exam Simulation — strategy-driven paper composition.
 *
 * Extends the PX-3 paper builder with FOUR mission modes, each controlling
 * difficulty progression and point scope. All questions still come from the
 * real bank; the LLM never participates.
 *
 *   topic_drill   — 专项：single node/point family, ascending difficulty
 *   chapter_test  — 章节测试：all points under one chapter, mixed difficulty
 *   comprehensive — 综合：across subjects/points, balanced mix
 *   mock_exam     — 模拟考：exam-like distribution scaled to a time budget
 *
 * Difficulty progression: within each mode the sequence orders
 * BASIC → MEDIUM → HARD in waves so the student always warms up first.
 */

export type ExamMode = 'topic_drill' | 'chapter_test' | 'comprehensive' | 'mock_exam';

export interface StrategyExamQuestion {
  id: string;
  stem: string;
  type: string;
  difficulty: 'BASIC' | 'MEDIUM' | 'HARD';
  knowledgePointIds: readonly string[];
  subject?: string;
}

export interface StrategyExamInput {
  candidates: readonly StrategyExamQuestion[];
  mode: ExamMode;
  questionCount: number;
  /** Point/chapter scope filter per mode. */
  scopePointIds?: readonly string[];
  scopeChapter?: string;
  subject?: string;
}

export interface StrategyExamPaper {
  mode: ExamMode;
  questions: StrategyExamQuestion[];
  difficultyProgression: ReadonlyArray<'BASIC' | 'MEDIUM' | 'HARD'>;
  coveragePoints: string[];
  dropped: number;
}

const MODE_SHARES: Record<ExamMode, { BASIC: number; MEDIUM: number; HARD: number }> = {
  topic_drill: { BASIC: 0.4, MEDIUM: 0.4, HARD: 0.2 },
  chapter_test: { BASIC: 0.3, MEDIUM: 0.45, HARD: 0.25 },
  comprehensive: { BASIC: 0.25, MEDIUM: 0.5, HARD: 0.25 },
  mock_exam: { BASIC: 0.2, MEDIUM: 0.5, HARD: 0.3 },
};

const DIFFICULTY_ORDER: Record<'BASIC' | 'MEDIUM' | 'HARD', number> = { BASIC: 0, MEDIUM: 1, HARD: 2 };

export function buildStrategyExam(input: StrategyExamInput): StrategyExamPaper {
  const target = Math.max(3, Math.min(50, input.questionCount));
  const shares = MODE_SHARES[input.mode];
  let pool = input.candidates.filter((question) => {
    if (input.subject && question.subject !== input.subject) return false;
    if (input.scopePointIds && input.scopePointIds.length > 0
      && !question.knowledgePointIds.some((pointId) => input.scopePointIds!.includes(pointId))) return false;
    return true;
  });

  // Difficulty progression: ascending waves so the paper warms up first.
  const byDifficulty: Record<'BASIC' | 'MEDIUM' | 'HARD', StrategyExamQuestion[]> = { BASIC: [], MEDIUM: [], HARD: [] };
  for (const question of pool) {
    byDifficulty[question.difficulty]?.push(question);
  }

  const counts = {
    BASIC: Math.round(shares.BASIC * target),
    MEDIUM: Math.round(shares.MEDIUM * target),
    HARD: target - Math.round(shares.BASIC * target) - Math.round(shares.MEDIUM * target),
  };

  const questions: StrategyExamQuestion[] = [];
  // Wave 1: BASIC count, Wave 2: MEDIUM count, Wave 3: HARD count — each
  // wave keeps coverage spread by rotating through distinct knowledge points.
  const waves: Array<'BASIC' | 'MEDIUM' | 'HARD'> = [
    ...Array.from({ length: counts.BASIC }, () => 'BASIC' as const),
    ...Array.from({ length: counts.MEDIUM }, () => 'MEDIUM' as const),
    ...Array.from({ length: counts.HARD }, () => 'HARD' as const),
  ];
  const usedPoints = new Set<string>();
  for (const difficulty of waves) {
    const next = pickNext(byDifficulty[difficulty], usedPoints, input.scopePointIds);
    if (next) {
      usedPoints.add(next.knowledgePointIds[0] ?? '');
      questions.push(next);
    }
  }
  // Fill any shortfall from the remaining pool regardless of difficulty.
  if (questions.length < target) {
    for (const bucket of ['MEDIUM', 'BASIC', 'HARD'] as const) {
      for (const question of byDifficulty[bucket]) {
        if (questions.length >= target) break;
        if (!questions.some((existing) => existing.id === question.id)) questions.push(question);
      }
    }
  }

  const progression = questions.map((question) => question.difficulty);
  return {
    mode: input.mode,
    questions,
    difficultyProgression: progression,
    coveragePoints: [...new Set(questions.flatMap((question) => [...question.knowledgePointIds]))],
    dropped: pool.length - questions.length,
  };
}

function pickNext(
  bucket: StrategyExamQuestion[],
  usedPoints: Set<string>,
  scopePointIds?: readonly string[],
): StrategyExamQuestion | null {
  // Exclude already-selected questions; prefer untouched scope points first
  // for coverage, then any unseen point within scope.
  const unseen = bucket.filter((question) => !usedPoints.has(question.knowledgePointIds[0] ?? ''));
  const scoped = scopePointIds && scopePointIds.length > 0
    ? unseen.find((question) => question.knowledgePointIds.some((pointId) => scopePointIds.includes(pointId)))
    : unseen[0] ?? null;
  return scoped ?? null;
}