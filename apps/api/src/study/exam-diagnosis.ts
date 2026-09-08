/**
 * LE-V10 F2 — Exam Diagnosis projection (pure).
 *
 * Turns a mock-exam report from "成绩单" into "诊断书": 150-point estimate,
 * per-subject objective scope, node-level loss attribution enriched with
 * exam frequency, target-gap decomposition, and recovery-plan closure.
 *
 * Honesty rules (constitution §0/§7):
 *   - the 150 score is an ESTIMATE: objective accuracy × the fixed 408
 *     objective structure (80 分) + the REAL subjective self-score, with the
 *     basis string always attached; self-score above max is capped
 *   - per-subject rows are objective-scope estimates (主观题自评分只在汇总行)
 *   - no target score → no gap decomposition (never a fake baseline)
 *   - no generated recovery plan → closure null + explicit reason
 *   - questions that cannot be attributed to nodes are counted honestly
 * Pure module: zero imports, deterministic; the service layer owns all IO.
 */

export const STANDARD_OBJECTIVE_MAX = 80; // 408 客观题固定结构：40 单选 × 2 分
export const STANDARD_OBJECTIVE_PER_QUESTION = 2;
export const NODE_LOSS_MAX = 5;

export interface ExamDiagnosisReportInput {
  readonly sessionId: string;
  readonly summary: {
    readonly totalQuestions: number;
    readonly answeredCount: number;
    readonly unansweredCount: number;
    readonly correctCount: number;
    readonly accuracyRate: number;
    readonly objectiveQuestionCount: number;
    readonly objectiveCorrectCount: number;
    readonly objectiveAccuracyRate: number;
    readonly subjectiveQuestionCount: number;
    readonly subjectiveEarnedScore: number;
    readonly subjectiveMaxScore: number;
    readonly subjectiveScoreRate: number;
    readonly totalTimeSec: number;
    readonly timeLimitSec: number;
    readonly overtime: boolean;
  };
  readonly subjectBreakdown: readonly {
    readonly subject: string;
    readonly totalQuestions: number;
    readonly correctCount: number;
    readonly accuracyRate: number;
    readonly totalTimeSec: number;
    readonly avgTimeSec: number;
  }[];
  readonly knowledgePointLosses: readonly {
    readonly knowledgePointId: string;
    readonly title: string;
    readonly subject: string;
    readonly wrongCount: number;
  }[];
  readonly unansweredQuestions: readonly { readonly questionId: string; readonly stem: string }[];
}

export interface DiagnosisNodeIndex {
  readonly nodesByQuestion: Readonly<Record<string, readonly {
    readonly knowledgeNodeId: string;
    readonly name: string;
    readonly subject: string;
  }[]>>;
}

export interface ExamDiagnosisInput {
  readonly report: ExamDiagnosisReportInput;
  readonly lostQuestionIds: readonly string[];
  readonly nodeIndex: DiagnosisNodeIndex;
  /** node id → recent-5-year exam frequency (from KnowledgeFrequencySnapshot). */
  readonly nodeFrequency: Readonly<Record<string, number>>;
  readonly recovery: { readonly exposedTasks: number; readonly completedTasks: number } | null;
  readonly targetScore: number | null;
  readonly asOf: string;
}

export interface ExamDiagnosis {
  readonly version: 'exam-diagnosis-v1';
  readonly sessionId: string;
  readonly asOf: string;
  readonly score150Estimate: {
    readonly value: number;
    readonly objectiveMax: number;
    readonly objectiveEarnedEstimate: number;
    readonly subjectiveEarned: number;
    readonly subjectiveMax: number;
    readonly subjectiveNote: string;
    readonly basis: string;
    readonly confidence: 'medium';
  } | null;
  readonly perSubject: readonly {
    readonly subject: string;
    readonly questions: number;
    readonly accuracyRate: number;
    readonly objectiveMax: number;
    readonly objectiveEarnedEstimate: number;
    readonly scopeNote: string;
  }[];
  readonly nodeLoss: readonly {
    readonly knowledgeNodeId: string;
    readonly name: string;
    readonly subject: string;
    readonly lostCount: number;
    readonly recent5Frequency: number | null;
    readonly stars: 0 | 1 | 2 | 3 | 4 | 5;
  }[];
  readonly nodeLossUnmappedCount: number;
  readonly gapDecomposition: {
    readonly targetScore: number;
    readonly predictedScore150: number;
    readonly gap: number;
    readonly note: string;
  } | null;
  readonly recoveryClosure: {
    readonly exposedTasks: number;
    readonly completedTasks: number;
    readonly closureRate: number;
  } | null;
  readonly recoveryClosureReason: 'recovery_plan_not_generated' | null;
  readonly source: 'derived';
}

function starsFromRecent5(recent5Frequency: number | null): 0 | 1 | 2 | 3 | 4 | 5 {
  if (recent5Frequency == null) return 0;
  if (recent5Frequency >= 5) return 5;
  if (recent5Frequency >= 3) return 4;
  if (recent5Frequency >= 1) return 3;
  return 0;
}

export function buildExamDiagnosis(input: ExamDiagnosisInput): ExamDiagnosis {
  const { report } = input;
  const summary = report.summary;

  // 150-point estimate: objective accuracy × the fixed 408 objective structure
  // (80 分) + the REAL subjective self-score, capped at its max.
  const objectiveEarnedEstimate = Math.round((summary.objectiveAccuracyRate / 100) * STANDARD_OBJECTIVE_MAX);
  const subjectiveEarned = Math.min(summary.subjectiveEarnedScore, summary.subjectiveMaxScore);
  const hasScoreBasis = summary.objectiveQuestionCount > 0 || summary.subjectiveQuestionCount > 0;
  const score150Estimate = hasScoreBasis
    ? {
        value: objectiveEarnedEstimate + subjectiveEarned,
        objectiveMax: STANDARD_OBJECTIVE_MAX,
        objectiveEarnedEstimate,
        subjectiveEarned,
        subjectiveMax: summary.subjectiveMaxScore,
        subjectiveNote: summary.subjectiveQuestionCount > 0 ? '含自评题' : '本卷无主观题',
        basis: `客观题按正确率 × ${STANDARD_OBJECTIVE_MAX} 折算（估算）；主观题为真实自评分`,
        confidence: 'medium' as const,
      }
    : null;

  // Per-subject rows: objective-scope estimates (题数 × 标准单选分值), honestly
  // scoped — the subjective self-score is aggregated only in the summary row.
  const perSubject = report.subjectBreakdown.map((row) => {
    const objectiveMax = row.totalQuestions * STANDARD_OBJECTIVE_PER_QUESTION;
    const objectiveEarnedEstimate = Math.round((row.accuracyRate / 100) * objectiveMax);
    return {
      subject: row.subject,
      questions: row.totalQuestions,
      accuracyRate: row.accuracyRate,
      objectiveMax,
      objectiveEarnedEstimate,
      scopeNote: '客观题口径估算（本科目题数×2 分；主观题自评分计入汇总行）',
    };
  });

  // Node-level loss attribution: primary node per lost question, enriched
  // with the exam frequency; unattributable questions are counted honestly.
  const nodeLossUnmappedCount = input.lostQuestionIds.filter(
    (questionId) => (input.nodeIndex.nodesByQuestion[questionId] ?? []).length === 0,
  ).length;

  const lossByNode = new Map<string, { knowledgeNodeId: string; name: string; subject: string; lostCount: number }>();
  for (const questionId of input.lostQuestionIds) {
    const nodes = input.nodeIndex.nodesByQuestion[questionId] ?? [];
    const primary = nodes[0];
    if (!primary) continue;
    const existing = lossByNode.get(primary.knowledgeNodeId);
    if (existing) existing.lostCount += 1;
    else lossByNode.set(primary.knowledgeNodeId, { ...primary, lostCount: 1 });
  }

  const nodeLoss = [...lossByNode.values()]
    .map((row) => {
      const recent5Frequency = input.nodeFrequency[row.knowledgeNodeId] ?? null;
      return {
        knowledgeNodeId: row.knowledgeNodeId,
        name: row.name,
        subject: row.subject,
        lostCount: row.lostCount,
        recent5Frequency,
        stars: starsFromRecent5(recent5Frequency),
      };
    })
    .sort((left, right) =>
      (right.lostCount * (right.recent5Frequency ?? 0)) - (left.lostCount * (left.recent5Frequency ?? 0))
        || right.lostCount - left.lostCount
        || left.knowledgeNodeId.localeCompare(right.knowledgeNodeId))
    .slice(0, NODE_LOSS_MAX);

  // Target gap — only with a real target score; predicted uses the estimate.
  const scoreValue = score150Estimate?.value ?? null;
  const gapDecomposition =
    input.targetScore != null && scoreValue != null
      ? {
          targetScore: input.targetScore,
          predictedScore150: scoreValue,
          gap: input.targetScore - scoreValue,
          note: 'gap 基于估算分与目标分（估算），逐科空间见 perSubject',
        }
      : null;

  // Recovery closure — the plan's task ids are deterministic
  // (exam-review-{sessionId}-day-N); completion facts come from the SoT read.
  const recoveryClosure = input.recovery
    ? {
        exposedTasks: input.recovery.exposedTasks,
        completedTasks: input.recovery.completedTasks,
        closureRate: input.recovery.exposedTasks > 0
          ? Math.round((input.recovery.completedTasks / input.recovery.exposedTasks) * 100)
          : 0,
      }
    : null;

  return {
    version: 'exam-diagnosis-v1',
    sessionId: report.sessionId,
    asOf: input.asOf,
    score150Estimate,
    perSubject,
    nodeLoss,
    nodeLossUnmappedCount,
    gapDecomposition,
    recoveryClosure,
    recoveryClosureReason: recoveryClosure == null ? 'recovery_plan_not_generated' : null,
    source: 'derived',
  };
}
