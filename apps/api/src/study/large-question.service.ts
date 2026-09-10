/**
 * F4 V1 — large-question rubric service (read-only rubric + offline scoring).
 *
 * Two responsibilities:
 *   1. serve the rubric exactly as authored, validated, with its content hash;
 *   2. score a subjective answer OFFLINE against that rubric and record the
 *      result as strong learning evidence.
 *
 * ## Why the evidence payload carries the rubric version and hash
 *
 * A stored score must stay explainable after the rubric is edited. The scoring
 * result therefore rides into the evidence ledger together with
 * `rubricVersion` + `rubricHash`, so a later revision (different hash) cannot
 * silently re-explain an old score: the ledger says which revision produced it.
 *
 * ## What this does NOT do
 *
 * No model call, no automatic mastery write, and no claim of authority. The
 * offline score is evidence of an observed attempt; whether it may influence
 * mastery follows the same V12-M1 rule as any other strong observation, and
 * the final mark is stated as needing human confirmation.
 */

import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import {
  scoreLargeQuestion,
  validateRubric,
  hashRubric,
  type LargeQuestionScore,
  type QuestionRubric,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LearningEvidenceService } from './learning-evidence.service';

const MAX_ANSWER_LENGTH = 5000;

export interface RubricView {
  readonly questionId: string;
  readonly hasRubric: boolean;
  readonly rubric: QuestionRubric | null;
  readonly rubricHash: string | null;
  readonly validation: { valid: boolean; errors: readonly string[] };
  readonly reason?: string;
}

export interface SubjectiveAttemptResult {
  readonly questionId: string;
  readonly score: LargeQuestionScore;
  readonly evidenceRecorded: boolean;
  readonly evidenceKey: string | null;
  readonly nextStep: string;
}

@Injectable()
export class LargeQuestionService {
  constructor(
    @Optional() private readonly prisma?: PrismaService,
    @Optional() private readonly learningEvidence?: LearningEvidenceService,
  ) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  /** The rubric as authored. Never scored, never defaulted. */
  async getRubric(questionId: string): Promise<RubricView> {
    if (!this.enabled) {
      return {
        questionId,
        hasRubric: false,
        rubric: null,
        rubricHash: null,
        validation: { valid: false, errors: [] },
        reason: 'store_unavailable',
      };
    }
    const question = await this.prisma!.question.findUnique({
      where: { id: questionId },
      select: { id: true, rubric: true },
    });
    if (!question) throw new NotFoundException(`Question ${questionId} was not found`);

    const rubric = decodeRubric(question.rubric);
    if (!rubric) {
      return {
        questionId,
        hasRubric: false,
        rubric: null,
        rubricHash: null,
        validation: { valid: false, errors: [] },
        reason: 'no_rubric',
      };
    }
    const validation = validateRubric(rubric);
    return {
      questionId,
      hasRubric: true,
      rubric,
      rubricHash: hashRubric(rubric),
      validation: { valid: validation.valid, errors: validation.errors },
    };
  }

  async submitAttempt(
    userId: string,
    questionId: string,
    answerText: string,
  ): Promise<SubjectiveAttemptResult> {
    if (typeof answerText !== 'string' || answerText.trim().length === 0) {
      throw new BadRequestException('Answer text must not be empty');
    }
    if (answerText.length > MAX_ANSWER_LENGTH) {
      throw new BadRequestException(`Answer text must be at most ${MAX_ANSWER_LENGTH} characters`);
    }

    const view = await this.getRubric(questionId);
    const score = scoreLargeQuestion({ rubric: view.rubric, answerText });

    // A score that could not be produced is returned as such: no evidence is
    // recorded for a non-score, because "no rubric" is not an observation.
    if (score.score == null) {
      return {
        questionId,
        score,
        evidenceRecorded: false,
        evidenceKey: null,
        nextStep: score.verdict === 'no_rubric'
          ? '该题暂无评分标准，本题不计入能力证据。'
          : '评分标准未通过校验，请联系教研修正后再作答。',
      };
    }

    let evidenceKey: string | null = null;
    if (this.learningEvidence) {
      const record = await this.learningEvidence.recordObservedPerformance(userId, {
        action: 'practice.answered',
        sourceId: questionId,
        observedAttempts: 1,
        observedCorrectCount: score.criticalMiss ? 0 : 1,
        recordedAt: new Date().toISOString(),
        scope: `${score.rubricHash}`,
        detail: {
          kind: 'rubric_scored_attempt',
          rubricVersion: score.rubricVersion,
          rubricHash: score.rubricHash,
          awarded: score.score,
          maxScore: score.maxScore,
          criticalMiss: score.criticalMiss,
          criteria: score.criteria.map((row) => ({
            id: row.id,
            awarded: row.awarded,
            points: row.points,
            matched: row.matched,
          })),
          hitNodeIds: score.hitNodeIds,
          missedNodeIds: score.missedNodeIds,
        },
      });
      evidenceKey = record.id;
    }

    return {
      questionId,
      score,
      evidenceRecorded: Boolean(evidenceKey),
      evidenceKey,
      nextStep: score.criticalMiss
        ? '存在必答采分点未命中：先按上面未命中的采分点逐条重写，再提交一次。'
        : score.verdict === 'perfect'
          ? '采分点已全部命中——换一道同类大题验证稳定性。'
          : '按未命中的采分点补写后再提交一次。',
    };
  }
}

/**
 * Defensive decode: a rubric written by an older/unknown shape is treated as
 * absent rather than partially interpreted. Interpreting half a rubric would
 * produce a score nobody can audit.
 */
export function decodeRubric(value: unknown): QuestionRubric | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.version !== 'number' || !Array.isArray(row.criteria)) return null;
  return row as unknown as QuestionRubric;
}
