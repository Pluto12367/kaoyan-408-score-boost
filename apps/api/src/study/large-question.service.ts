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

import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  scoreLargeQuestion,
  validateRubric,
  hashRubric,
  buildAiEstimateMessages,
  parseAiEstimateResponse,
  type LargeQuestionScore,
  type QuestionRubric,
} from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { LearningEvidenceService } from './learning-evidence.service';
import { DeepSeekClient } from './deepseek-client';

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

/**
 * V14 ②（Owner 批准 D-A-1..3 + D-X-1）— AI 大题估分视图。
 *
 * 语义硬卡：本端点不写任何分数——建议值只返回给学生，确认/改写后经既有
 * submitPaper 落账（gradingMode='ai_assisted_self' → 失分账本 gradingMethod='rubric'
 * → lossKind=PROXY）。rubricVersion/hash 随行，历史可追溯（RULE-10/11）。
 */
export interface AiEstimateView {
  readonly questionId: string;
  readonly rubricVersion: number;
  readonly rubricHash: string;
  readonly suggestedScore: number;
  readonly maxScore: number;
  readonly criteria: ReadonlyArray<{
    readonly id: string;
    readonly description: string;
    readonly points: number;
    readonly matched: boolean;
    readonly reason: string;
  }>;
  readonly confidence: 'medium';
  readonly limitations: string;
  readonly basis: 'ai_rubric_match';
  readonly model: string;
}

@Injectable()
export class LargeQuestionService {
  private readonly aiLogger = new Logger('AiEstimate');
  /** D-X-1：每用户每日估分限额（env 可配，默认 20）。进程内计数——单实例部署口径。 */
  private readonly aiDailyLimit = Math.max(1, Number(process.env.AI_ESTIMATE_DAILY_LIMIT ?? 20));
  private readonly aiQuotaByUser = new Map<string, { day: string; count: number }>();
  private readonly aiClient: DeepSeekClient | null
    = process.env.AI_API_KEY ? new DeepSeekClient({ apiKey: process.env.AI_API_KEY }) : null;

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

  /**
   * V14 ② — AI 估分（建议，不落任何分数；确认后走既有 submitPaper）。
   * 拒绝路径：空/超长答案 400；题不存在 404；无 rubric 404；未配 AI/调用失败/解析失败 503
   * （显式降级为纯自评，不重试造数）；超日限额 429。
   */
  async aiEstimate(userId: string, questionId: string, answerText: string): Promise<AiEstimateView> {
    if (typeof answerText !== 'string' || answerText.trim().length === 0) {
      throw new BadRequestException('Answer text must not be empty');
    }
    if (answerText.length > MAX_ANSWER_LENGTH) {
      throw new BadRequestException(`Answer text must be at most ${MAX_ANSWER_LENGTH} characters`);
    }
    if (!this.enabled) {
      throw new ServiceUnavailableException('存储不可用，无法估分');
    }
    // D-X-1：只预检限额，不预扣——失败调用（404/503）不消耗次数（学生未获得任何价值）。
    this.assertAiQuota(userId);

    const [question] = await this.prisma!.question.findMany({
      where: { id: questionId, isCurrent: true },
      select: { id: true, stem: true, rubric: true },
      take: 1,
    });
    if (!question) throw new NotFoundException(`Question ${questionId} was not found`);
    const rubric = decodeRubric(question.rubric);
    const validation = rubric ? validateRubric(rubric) : null;
    if (!rubric || !validation?.valid) {
      throw new NotFoundException('该题暂无有效评分标准，无法 AI 估分');
    }
    if (!this.aiClient) {
      throw new ServiceUnavailableException('AI 估分暂不可用，请自行评分');
    }

    let content: string;
    let model: string;
    try {
      const completion = await this.aiClient.chatCompletions({
        messages: buildAiEstimateMessages({ stem: question.stem, rubric, answerText }),
        temperature: 0.1,
      });
      content = completion.content;
      model = completion.model;
    } catch (error) {
      this.aiLogger.warn(`ai-estimate call failed for ${questionId}: ${error instanceof Error ? error.message : String(error)}`);
      throw new ServiceUnavailableException('AI 估分暂不可用，请自行评分');
    }

    const parsed = parseAiEstimateResponse(content, rubric);
    if ('invalid' in parsed) {
      // 不重试、不造数：解析失败即显式降级（RULE-02/06 同源纪律）。
      this.aiLogger.warn(`ai-estimate parse rejected for ${questionId}: ${parsed.errors.join(' ')}`);
      throw new ServiceUnavailableException('AI 估分暂不可用，请自行评分');
    }

    // 成功才计数（D-X-1：失败调用不消耗限额）。
    this.chargeAiQuota(userId);

    this.aiLogger.log(`ai-estimate ${questionId} by ${userId}: ${parsed.value.suggestedScore}/${rubric.totalPoints} (${model})`);
    const rubricById = new Map(rubric.criteria.map((criterion) => [criterion.id, criterion]));
    return {
      questionId,
      rubricVersion: rubric.version,
      rubricHash: hashRubric(rubric),
      suggestedScore: parsed.value.suggestedScore,
      maxScore: rubric.totalPoints,
      criteria: parsed.value.criteria.map((row) => ({
        id: row.id,
        description: rubricById.get(row.id)?.description ?? row.id,
        points: row.points,
        matched: row.matched,
        reason: row.reason,
      })),
      confidence: 'medium',
      limitations: 'AI 估分仅供参考（PROXY），最终以你确认的自评分为准。',
      basis: 'ai_rubric_match',
      model,
    };
  }

  /** 限额预检：超限即 429（含获取路径说明），不扣次数。 */
  private assertAiQuota(userId: string) {
    const entry = this.aiQuotaByUser.get(userId);
    if (entry && entry.day === new Date().toISOString().slice(0, 10) && entry.count >= this.aiDailyLimit) {
      throw new HttpException(
        `今日 AI 估分次数已用完（${this.aiDailyLimit} 次/天），请自行评分；明日自动恢复。`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** 成功调用后计数。 */
  private chargeAiQuota(userId: string) {
    const today = new Date().toISOString().slice(0, 10);
    const entry = this.aiQuotaByUser.get(userId);
    if (!entry || entry.day !== today) {
      this.aiQuotaByUser.set(userId, { day: today, count: 1 });
      return;
    }
    entry.count += 1;
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
