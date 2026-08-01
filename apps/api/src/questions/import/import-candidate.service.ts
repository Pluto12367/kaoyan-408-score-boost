import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  Difficulty, QuestionImportCandidateStatus, QuestionImportDuplicateAction, QuestionType, type Prisma,
} from '@prisma/client';
import { normalizeCandidateDraft } from '@kaoyan408/shared';
import { AuditEventService } from '../../operations/audit-event.service';
import { PrismaService } from '../../prisma/prisma.service';
import { computeImportFingerprint } from './import-fingerprint';
import { toDifficulty, toQuestionType } from './import-validation';

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;
const MAX_BULK_CANDIDATES = 100;
const EDITABLE_FIELDS = new Set([
  'stem', 'options', 'answer', 'analysis', 'difficulty', 'type', 'source', 'year', 'expectedTimeSec',
  'knowledgePointIds', 'duplicateAction', 'status',
]);

export interface CandidateListFilters {
  status?: QuestionImportCandidateStatus;
}

export interface CandidatePageInput {
  page?: number;
  pageSize?: number;
}

export interface CandidatePatch {
  stem?: string;
  options?: string[];
  answer?: string;
  analysis?: string;
  difficulty?: '基础' | '中等' | '困难' | Difficulty;
  type?: '选择题' | '综合题' | '判断题' | QuestionType;
  source?: string;
  year?: number | null;
  expectedTimeSec?: number;
  knowledgePointIds?: string[];
  duplicateAction?: QuestionImportDuplicateAction;
  status?: 'ignored';
}

@Injectable()
export class ImportCandidateService {
  constructor(private readonly prisma: PrismaService, private readonly auditEvents: AuditEventService) {}

  async list(batchId: string, filters: CandidateListFilters = {}, pageInput: CandidatePageInput = {}) {
    const page = positiveInteger(pageInput.page, 1);
    const pageSize = Math.min(positiveInteger(pageInput.pageSize, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
    if (filters.status && !Object.values(QuestionImportCandidateStatus).includes(filters.status)) {
      throw new BadRequestException('Candidate status filter is invalid');
    }
    const batch = await this.prisma.questionImportBatch.findUnique({ where: { id: batchId }, select: { id: true } });
    if (!batch) throw new NotFoundException('Question import batch was not found');
    const where: Prisma.QuestionImportCandidateWhereInput = {
      batchId,
      ...(filters.status ? { status: filters.status } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.questionImportCandidate.findMany({
        where,
        orderBy: [{ sourceRowNumber: 'asc' }, { createdAt: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.questionImportCandidate.count({ where }),
    ]);
    return { items, page, pageSize, total };
  }

  async update(id: string, revision: number, patch: CandidatePatch, actorId: string) {
    if (!Number.isInteger(revision) || revision < 0) throw new BadRequestException('revision must be a non-negative integer');
    const sanitizedPatch = compactPatch(patch);
    this.assertPatch(sanitizedPatch);
    return this.prisma.$transaction(async (tx) => {
      const latest = await tx.questionImportCandidate.findFirst({ where: { id } });
      if (!latest) throw new NotFoundException('Question import candidate was not found');
      if (latest.revision !== revision) throw staleCandidate(latest);

      const { data, warningCount, action } = await this.buildUpdate(tx, latest, sanitizedPatch, actorId);
      const updated = await tx.questionImportCandidate.updateMany({
        where: { id, revision },
        data: { ...data, revision: { increment: 1 } },
      });
      if (updated.count !== 1) {
        const current = await tx.questionImportCandidate.findFirst({ where: { id } });
        throw staleCandidate(current ?? latest);
      }
      const candidate = await tx.questionImportCandidate.findFirst({ where: { id } });
      const counts = await this.countStates(tx, latest.batchId);
      await tx.questionImportBatch.update({
        where: { id: latest.batchId }, data: { statusCounts: counts, revision: { increment: 1 } },
      });
      await this.auditEvents.record({
        actorId,
        action,
        targetType: 'question_import',
        targetId: id,
        result: 'success',
        metadata: { candidateIds: [id], warningCount },
      }, tx);
      return candidate;
    });
  }

  async bulkApprove(batchId: string, candidateIds: string[], actorId: string) {
    const ids = uniqueIds(candidateIds);
    if (ids.length === 0 || ids.length > MAX_BULK_CANDIDATES || ids.length !== candidateIds.length) {
      throw new BadRequestException(`candidateIds must contain 1 to ${MAX_BULK_CANDIDATES} unique IDs`);
    }
    return this.prisma.$transaction(async (tx) => {
      const candidates = await tx.questionImportCandidate.findMany({
        where: { id: { in: ids }, batchId },
        select: { id: true, revision: true, status: true, warnings: true },
      });
      if (candidates.length !== ids.length) throw new BadRequestException('Every candidate must belong to the requested batch');
      if (candidates.some((candidate) => !['pending_review', 'duplicate_suspected'].includes(candidate.status))) {
        throw new BadRequestException('Only reviewable candidates can be approved');
      }
      const warningCount = candidates.reduce((total, candidate) => total + jsonArrayLength(candidate.warnings), 0);
      if (warningCount !== 0) throw new BadRequestException('Only warning-free candidates can be bulk approved');
      const now = new Date();
      let approvedCandidates = 0;
      for (const candidate of candidates) {
        const approved = await tx.questionImportCandidate.updateMany({
          where: { id: candidate.id, batchId, status: candidate.status, revision: candidate.revision },
          data: { status: 'approved', reviewedById: actorId, reviewedAt: now, revision: { increment: 1 } },
        });
        if (approved.count !== 1) throw new ConflictException('Candidates changed while being approved');
        approvedCandidates += 1;
      }
      const counts = await this.countStates(tx, batchId);
      await tx.questionImportBatch.update({
        where: { id: batchId }, data: { statusCounts: counts, revision: { increment: 1 } },
      });
      await this.auditEvents.record({
        actorId,
        action: 'question_import.candidate_bulk_approve',
        targetType: 'question_import',
        targetId: batchId,
        result: 'success',
        metadata: { candidateIds: ids, warningCount },
      }, tx);
      return { batchId, approvedCandidates };
    });
  }

  private assertPatch(patch: CandidatePatch): void {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new BadRequestException('candidate patch is required');
    const keys = Object.keys(patch);
    if (keys.length === 0 || keys.some((key) => !EDITABLE_FIELDS.has(key))) throw new BadRequestException('candidate patch contains no supported fields');
    if (patch.status !== undefined && patch.status !== 'ignored') throw new BadRequestException('candidate status can only be changed to ignored through this endpoint');
    if (patch.status === 'ignored' && keys.length !== 1) throw new BadRequestException('ignored status cannot be combined with candidate edits');
    if (patch.duplicateAction !== undefined && !Object.values(QuestionImportDuplicateAction).includes(patch.duplicateAction)) {
      throw new BadRequestException('duplicateAction is invalid');
    }
    for (const [field, maximum] of Object.entries({ stem: 10_000, answer: 100, analysis: 50_000, source: 1_000 })) {
      const value = patch[field as keyof CandidatePatch];
      if (value !== undefined && (typeof value !== 'string' || value.trim().length === 0 || value.length > maximum)) {
        throw new BadRequestException(`${field} is invalid`);
      }
    }
    if (patch.options !== undefined && (!Array.isArray(patch.options) || patch.options.length < 2 || patch.options.length > 8
      || patch.options.some((option) => typeof option !== 'string' || !option.trim() || option.length > 2_000))) {
      throw new BadRequestException('options must contain 2 to 8 bounded strings');
    }
    if (patch.knowledgePointIds !== undefined && (!Array.isArray(patch.knowledgePointIds) || patch.knowledgePointIds.length < 1
      || patch.knowledgePointIds.length > 20 || new Set(patch.knowledgePointIds).size !== patch.knowledgePointIds.length
      || patch.knowledgePointIds.some((value) => typeof value !== 'string' || !value || value.length > 200))) {
      throw new BadRequestException('knowledgePointIds is invalid');
    }
    if (patch.difficulty !== undefined && !['基础', '中等', '困难', ...Object.values(Difficulty)].includes(patch.difficulty)) {
      throw new BadRequestException('difficulty is invalid');
    }
    if (patch.type !== undefined && !['选择题', '综合题', '判断题', ...Object.values(QuestionType)].includes(patch.type)) {
      throw new BadRequestException('type is invalid');
    }
    if (patch.year !== undefined && patch.year !== null && (!Number.isInteger(patch.year) || patch.year < 1900 || patch.year > 3000)) {
      throw new BadRequestException('year is invalid');
    }
    if (patch.expectedTimeSec !== undefined && (!Number.isInteger(patch.expectedTimeSec) || patch.expectedTimeSec < 1 || patch.expectedTimeSec > 86_400)) {
      throw new BadRequestException('expectedTimeSec is invalid');
    }
  }

  private async buildUpdate(
    tx: Prisma.TransactionClient,
    latest: Prisma.QuestionImportCandidateGetPayload<Record<string, never>>,
    patch: CandidatePatch,
    actorId: string,
  ): Promise<{ data: Prisma.QuestionImportCandidateUncheckedUpdateManyInput; warningCount: number; action: 'question_import.candidate_edit' | 'question_import.candidate_ignore' }> {
    if (patch.status === 'ignored') {
      return {
        data: { status: 'ignored', reviewedById: actorId, reviewedAt: new Date() },
        warningCount: jsonArrayLength(latest.warnings),
        action: 'question_import.candidate_ignore',
      };
    }

    const merged = { ...latest, ...patch };
    const knowledgePointIds = patch.knowledgePointIds ?? latest.knowledgePointIds;
    if (knowledgePointIds.length === 0) throw new BadRequestException('At least one knowledge point is required');
    const count = await tx.knowledgePoint.count({ where: { id: { in: knowledgePointIds } } });
    if (count !== new Set(knowledgePointIds).size) throw new BadRequestException('One or more knowledge points do not exist');
    const raw: Record<string, unknown> = {
      stem: merged.stem,
      type: displayQuestionType(merged.type),
      difficulty: displayDifficulty(merged.difficulty),
      source: merged.source,
      answer: merged.answer,
      analysis: merged.analysis,
      year: merged.year ?? undefined,
      expectedTimeSec: merged.expectedTimeSec,
      knowledgePointIds,
    };
    merged.options.forEach((option, index) => { raw[`option${'ABCDEFGH'[index]}`] = option; });
    const normalized = normalizeCandidateDraft(raw);
    if (!normalized.value) {
      return {
        data: {
          ...editableData(merged, knowledgePointIds),
          warnings: normalized.issues as unknown as Prisma.InputJsonValue,
          status: 'needs_edit',
          targetFamilyId: null,
          reviewedById: actorId,
          reviewedAt: new Date(),
        },
        warningCount: normalized.issues.length,
        action: 'question_import.candidate_edit',
      };
    }
    const contentFingerprint = computeImportFingerprint(normalized.value);
    const duplicate = await tx.question.findFirst({
      where: { contentFingerprint, isCurrent: true }, select: { familyId: true },
    });
    return {
      data: {
        ...editableData(normalized.value, normalized.value.knowledgePointIds),
        warnings: [] as unknown as Prisma.InputJsonValue,
        contentFingerprint,
        targetFamilyId: duplicate?.familyId ?? null,
        status: duplicate ? 'duplicate_suspected' : 'pending_review',
        duplicateAction: patch.duplicateAction ?? latest.duplicateAction,
        reviewedById: actorId,
        reviewedAt: new Date(),
      },
      warningCount: 0,
      action: 'question_import.candidate_edit',
    };
  }

  private async countStates(tx: Prisma.TransactionClient, batchId: string): Promise<Prisma.InputJsonObject> {
    const groups = await tx.questionImportCandidate.groupBy({ by: ['status'], where: { batchId }, _count: { _all: true } });
    return Object.fromEntries(groups.map((group) => [group.status, group._count._all])) as Prisma.InputJsonObject;
  }
}

function editableData(
  candidate: {
    stem: string; options: string[]; answer: string; analysis: string; difficulty: string; type: string;
    source: string; year?: number | null; expectedTimeSec: number;
  },
  knowledgePointIds: string[],
): Prisma.QuestionImportCandidateUncheckedUpdateManyInput {
  return {
    stem: candidate.stem.trim(),
    options: candidate.options.map((option) => option.trim()),
    answer: candidate.answer.trim(),
    analysis: candidate.analysis.trim(),
    difficulty: toDifficulty(candidate.difficulty),
    type: toQuestionType(candidate.type),
    source: candidate.source.trim(),
    year: candidate.year ?? null,
    expectedTimeSec: candidate.expectedTimeSec,
    knowledgePointIds,
  };
}

function fromDifficulty(value: Difficulty): '基础' | '中等' | '困难' {
  if (value === Difficulty.BASIC) return '基础';
  if (value === Difficulty.HARD) return '困难';
  return '中等';
}

function displayDifficulty(value: CandidatePatch['difficulty']): '基础' | '中等' | '困难' {
  return value === '基础' || value === '中等' || value === '困难' ? value : fromDifficulty(value ?? Difficulty.MEDIUM);
}

function fromQuestionType(value: QuestionType): '选择题' | '综合题' | '判断题' {
  if (value === QuestionType.COMPREHENSIVE) return '综合题';
  if (value === QuestionType.JUDGEMENT) return '判断题';
  return '选择题';
}

function displayQuestionType(value: CandidatePatch['type']): '选择题' | '综合题' | '判断题' {
  return value === '选择题' || value === '综合题' || value === '判断题' ? value : fromQuestionType(value ?? QuestionType.SINGLE_CHOICE);
}

function staleCandidate(latest: unknown): ConflictException {
  return new ConflictException({ message: 'Question import candidate revision is stale', latest });
}

function uniqueIds(candidateIds: unknown): string[] {
  if (!Array.isArray(candidateIds) || candidateIds.some((id) => typeof id !== 'string' || !id)) return [];
  return [...new Set(candidateIds)];
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && value! > 0 ? value! : fallback;
}

function jsonArrayLength(value: Prisma.JsonValue): number {
  return Array.isArray(value) ? value.length : 0;
}

function compactPatch(patch: CandidatePatch): CandidatePatch {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch;
  return Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as CandidatePatch;
}
