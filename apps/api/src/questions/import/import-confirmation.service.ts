import { BadRequestException, ConflictException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Prisma, QuestionImportCandidateStatus, type QuestionImportCandidate } from '@prisma/client';
import { AuditEventService } from '../../operations/audit-event.service';
import { PrismaService } from '../../prisma/prisma.service';
import { QuestionsService } from '../questions.service';
import { computeImportFingerprint } from './import-fingerprint';
import type { ConfirmImportDto } from './dto/confirm-import.dto';
import { ImportAssetService } from './import-asset.service';

const CONFIRMATION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_SERIALIZATION_ATTEMPTS = 3;

export interface ImportConfirmationResult {
  batchId: string;
  confirmationId: string;
  importedCandidateIds: string[];
  skippedCandidateIds: string[];
  questionIds: string[];
}

@Injectable()
export class ImportConfirmationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditEvents: AuditEventService,
    private readonly questions: QuestionsService,
    @Optional() private readonly assets?: ImportAssetService,
  ) {}

  async confirm(batchId: string, input: ConfirmImportDto, actorId: string): Promise<ImportConfirmationResult> {
    const candidateIds = normalizeCandidateIds(input?.candidateIds);
    const idempotencyKey = input?.idempotencyKey?.trim();
    if (candidateIds.length === 0 || !idempotencyKey || idempotencyKey.length > 255) {
      throw new BadRequestException('candidateIds and idempotencyKey are required');
    }
    const existing = await this.prisma.questionImportConfirmation.findUnique({ where: { idempotencyKey } });
    if (existing) return this.replayOrReject(existing, batchId, candidateIds);

    // Copy first so a database rollback cannot destroy the only reviewable asset. A later sweep can remove an unreferenced copy.
    const promotions = this.assets ? await this.assets.preparePromotions(candidateIds) : [];
    let result: ImportConfirmationResult | undefined;
    for (let attempt = 0; attempt < MAX_SERIALIZATION_ATTEMPTS; attempt += 1) {
      try {
        result = await this.confirmInTransaction(batchId, candidateIds, idempotencyKey, actorId, promotions);
        break;
      } catch (error) {
        if (isPrismaCode(error, 'P2002')) {
          const replay = await this.prisma.questionImportConfirmation.findUnique({ where: { idempotencyKey } });
          if (replay) return this.replayOrReject(replay, batchId, candidateIds);
        }
        if (!isPrismaCode(error, 'P2034') || attempt === MAX_SERIALIZATION_ATTEMPTS - 1) throw error;
        await jitter(attempt);
      }
    }
    if (!result) throw new ConflictException('Question import confirmation could not be completed');
    await this.questions.refreshFromDatabase();
    return result;
  }

  private async confirmInTransaction(
    batchId: string, candidateIds: string[], idempotencyKey: string, actorId: string,
    promotions: Awaited<ReturnType<ImportAssetService['preparePromotions']>>,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await lockBatch(tx, batchId);
      const prior = await tx.questionImportConfirmation.findUnique({ where: { idempotencyKey } });
      if (prior) return this.replayOrReject(prior, batchId, candidateIds);
      await lockCandidates(tx, candidateIds);
      const candidates = await tx.questionImportCandidate.findMany({ where: { batchId, id: { in: candidateIds } } });
      if (candidates.length !== candidateIds.length) throw new BadRequestException('Every candidate must belong to the requested batch');
      const refreshedCandidates = await this.recomputeFingerprints(tx, candidates);
      for (const candidate of refreshedCandidates) this.validateCandidate(candidate);

      const result: Omit<ImportConfirmationResult, 'confirmationId'> = {
        batchId, importedCandidateIds: [], skippedCandidateIds: [], questionIds: [],
      };
      for (const candidate of refreshedCandidates.sort((a, b) => a.id.localeCompare(b.id))) {
        if (candidate.duplicateAction === 'skip') {
          await tx.questionImportCandidate.update({ where: { id: candidate.id }, data: { status: 'imported', reviewedAt: new Date() } });
          result.skippedCandidateIds.push(candidate.id);
          continue;
        }
        const questionId = candidate.duplicateAction === 'new_version'
          ? await this.createVersion(tx, candidate, batchId)
          : await this.createIndependentQuestion(tx, candidate, batchId);
        await tx.questionImportCandidate.update({
          where: { id: candidate.id }, data: { status: 'imported', importedQuestionId: questionId, reviewedAt: new Date() },
        });
        const candidateAssets = promotions.filter((asset) => asset.candidateId === candidate.id && asset.batchId === batchId);
        if (candidateAssets.length > 0) await tx.questionImportAsset.createMany({ data: candidateAssets.map((asset) => ({
          batchId, scope: 'permanent', storageKey: asset.permanentStorageKey, sha256: asset.sha256, mediaType: asset.mediaType,
          byteSize: asset.byteSize, pageNumber: asset.pageNumber, sourceRegion: asset.sourceRegion ?? undefined, questionId,
          promotedAt: new Date(),
        })) });
        result.importedCandidateIds.push(candidate.id);
        result.questionIds.push(questionId);
      }
      const confirmation = await tx.questionImportConfirmation.create({
        data: { batchId, idempotencyKey, actorId, result: { ...result, candidateIds } },
      });
      const storedResult = { ...result, confirmationId: confirmation.id, candidateIds };
      await tx.questionImportConfirmation.update({ where: { id: confirmation.id }, data: { result: storedResult } });
      const statusCounts = await countStatuses(tx, batchId);
      const outstanding = Object.entries(statusCounts).some(([status, count]) => !isTerminalCandidateStatus(status) && Number(count) > 0);
      await tx.questionImportBatch.update({
        where: { id: batchId }, data: { statusCounts, status: outstanding ? 'partially_imported' : 'completed', revision: { increment: 1 } },
      });
      await this.auditEvents.record({
        actorId, action: 'question_import.confirm', targetType: 'question_import', targetId: batchId, result: 'success',
        metadata: { candidateIds, importedCount: result.importedCandidateIds.length, skippedCount: result.skippedCandidateIds.length },
      }, tx);
      return storedResult;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5_000, timeout: 10_000 });
  }

  private async recomputeFingerprints(
    tx: Prisma.TransactionClient,
    candidates: QuestionImportCandidate[],
  ): Promise<QuestionImportCandidate[]> {
    const fingerprints = [...new Set(candidates.map(fingerprintFor))].sort();
    for (const fingerprint of fingerprints) {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${fingerprint}))::text AS "locked"`;
    }
    const refreshed: QuestionImportCandidate[] = [];
    for (const candidate of candidates) {
      const contentFingerprint = fingerprintFor(candidate);
      const duplicate = await tx.question.findFirst({
        where: { contentFingerprint, isCurrent: true }, select: { familyId: true },
      });
      refreshed.push(await tx.questionImportCandidate.update({
        where: { id: candidate.id },
        data: { contentFingerprint, targetFamilyId: duplicate?.familyId ?? candidate.targetFamilyId },
      }));
    }
    return refreshed;
  }

  private validateCandidate(candidate: QuestionImportCandidate): void {
    if (candidate.status === 'imported') throw new ConflictException('A candidate was already imported by a different confirmation');
    if (candidate.status !== 'approved') throw new BadRequestException('Only approved candidates can be confirmed');
    if (!candidate.duplicateAction) throw new BadRequestException('A duplicate strategy is required');
    if (candidate.duplicateAction === 'new_version' && !candidate.targetFamilyId) {
      throw new BadRequestException('new_version requires a target question family');
    }
  }

  private async createIndependentQuestion(tx: Prisma.TransactionClient, candidate: QuestionImportCandidate, batchId: string): Promise<string> {
    const question = await tx.question.create({ data: { ...questionData(candidate, batchId), family: { create: {} }, versionNumber: 1, isCurrent: true } });
    return question.id;
  }

  private async createVersion(tx: Prisma.TransactionClient, candidate: QuestionImportCandidate, batchId: string): Promise<string> {
    const familyId = candidate.targetFamilyId!;
    const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "QuestionFamily" WHERE "id" = ${familyId} FOR UPDATE`;
    if (rows.length !== 1) throw new BadRequestException('The target question family no longer exists');
    const current = await tx.question.findFirst({ where: { familyId, isCurrent: true }, orderBy: { versionNumber: 'desc' } });
    if (!current) throw new BadRequestException('The target question has no current version');
    await tx.question.update({ where: { id: current.id }, data: { isCurrent: false } });
    const question = await tx.question.create({ data: { ...questionData(candidate, batchId), family: { connect: { id: familyId } }, versionNumber: current.versionNumber + 1, isCurrent: true } });
    return question.id;
  }

  private replayOrReject(existing: { batchId: string; result: Prisma.JsonValue; createdAt: Date }, batchId: string, candidateIds: string[]): ImportConfirmationResult {
    if (existing.createdAt.getTime() < Date.now() - CONFIRMATION_TTL_MS) {
      throw new ConflictException('Idempotency key has expired');
    }
    const result = existing.result as Record<string, unknown>;
    const storedIds = Array.isArray(result.candidateIds) ? result.candidateIds : [];
    if (existing.batchId !== batchId || !sameIds(storedIds, candidateIds)) {
      throw new ConflictException('Idempotency key was already used with different confirmation input');
    }
    return result as unknown as ImportConfirmationResult;
  }
}

function questionData(candidate: QuestionImportCandidate, batchId: string): Omit<Prisma.QuestionCreateInput, 'family'> {
  return {
    importBatch: { connect: { id: batchId } }, contentFingerprint: candidate.contentFingerprint, stem: candidate.stem, options: candidate.options,
    answer: candidate.answer, analysis: candidate.analysis, difficulty: candidate.difficulty, type: candidate.type,
    source: candidate.source, year: candidate.year, expectedTimeSec: candidate.expectedTimeSec,
    formulas: candidate.formulas as Prisma.InputJsonValue, sourceRegion: candidate.sourceRegion as Prisma.InputJsonValue | undefined,
    knowledgePoints: { create: candidate.knowledgePointIds.map((knowledgePointId) => ({ knowledgePointId })) },
  };
}

function fingerprintFor(candidate: QuestionImportCandidate): string {
  return computeImportFingerprint({
    stem: candidate.stem, options: candidate.options, answer: candidate.answer, analysis: candidate.analysis,
    difficulty: candidate.difficulty === 'BASIC' ? '基础' : candidate.difficulty === 'HARD' ? '困难' : '中等',
    type: candidate.type === 'COMPREHENSIVE' ? '综合题' : candidate.type === 'JUDGEMENT' ? '判断题' : '选择题',
    source: candidate.source, year: candidate.year ?? undefined, expectedTimeSec: candidate.expectedTimeSec,
    knowledgePointIds: candidate.knowledgePointIds,
  });
}

async function lockBatch(tx: Prisma.TransactionClient, batchId: string): Promise<void> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "QuestionImportBatch" WHERE "id" = ${batchId} FOR UPDATE`;
  if (rows.length !== 1) throw new NotFoundException('Question import batch was not found');
}

async function lockCandidates(tx: Prisma.TransactionClient, candidateIds: string[]): Promise<void> {
  await tx.$queryRaw`SELECT "id" FROM "QuestionImportCandidate" WHERE "id" IN (${Prisma.join(candidateIds)}) ORDER BY "id" FOR UPDATE`;
}

async function countStatuses(tx: Prisma.TransactionClient, batchId: string): Promise<Prisma.InputJsonObject> {
  const groups = await tx.questionImportCandidate.groupBy({ by: ['status'], where: { batchId }, _count: { _all: true } });
  return Object.fromEntries(groups.map((group) => [group.status, group._count._all])) as Prisma.InputJsonObject;
}

function normalizeCandidateIds(value: unknown): string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 100 && value.every((id) => typeof id === 'string' && id.length > 0 && id.length <= 200)
    && new Set(value).size === value.length ? [...value].sort() : [];
}

function sameIds(stored: unknown[], candidateIds: string[]): boolean {
  return stored.length === candidateIds.length && [...stored].map(String).sort().every((id, index) => id === candidateIds[index]);
}

function isTerminalCandidateStatus(status: string): boolean {
  return status === QuestionImportCandidateStatus.imported || status === QuestionImportCandidateStatus.ignored;
}

function isPrismaCode(error: unknown, code: string): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

async function jitter(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 10 + (attempt * 20) + Math.floor(Math.random() * 20)));
}
