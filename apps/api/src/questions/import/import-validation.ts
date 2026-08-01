import { Injectable } from '@nestjs/common';
import { Difficulty, QuestionImportCandidateStatus, QuestionType, Subject, type Prisma } from '@prisma/client';
import { normalizeCandidateDraft, type CandidateQuestionDraft, type ImportWarning } from '@kaoyan408/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { computeImportFingerprint, computeInvalidImportFingerprint } from './import-fingerprint';

const SUBJECT_ALIASES: Record<string, Subject> = {
  数据结构: Subject.DATA_STRUCTURE,
  计算机组成原理: Subject.COMPUTER_ORGANIZATION,
  计算机组成: Subject.COMPUTER_ORGANIZATION,
  操作系统: Subject.OPERATING_SYSTEM,
  计算机网络: Subject.COMPUTER_NETWORK,
  DATA_STRUCTURE: Subject.DATA_STRUCTURE,
  COMPUTER_ORGANIZATION: Subject.COMPUTER_ORGANIZATION,
  OPERATING_SYSTEM: Subject.OPERATING_SYSTEM,
  COMPUTER_NETWORK: Subject.COMPUTER_NETWORK,
};

const OPTION_LETTERS = 'ABCDEFGH';

export interface TableImportBatchContext {
  id: string;
  source: string;
  year?: number | null;
  defaultSubject?: string | null;
  defaultChapter?: string | null;
}

export interface ParsedTableRow {
  rowNumber: number;
  values: Record<string, unknown>;
}

export interface RowImportIssue extends ImportWarning {
  rowNumber?: number;
}

export type PreparedImportCandidate = Prisma.QuestionImportCandidateCreateManyInput;

@Injectable()
export class ImportValidationService {
  constructor(private readonly prisma: PrismaService) {}

  async prepareRows(
    batch: TableImportBatchContext,
    jobId: string,
    rows: ParsedTableRow[],
    parserIssues: RowImportIssue[] = [],
  ): Promise<PreparedImportCandidate[]> {
    const knowledgePoints = await this.prisma.knowledgePoint.findMany({
      select: { id: true, subject: true, chapter: true, title: true },
    });
    const prepared: PreparedImportCandidate[] = [];
    const fingerprints: string[] = [];

    for (const row of rows) {
      const mapped = this.mapKnowledgePoints(row.values, batch, knowledgePoints);
      const values = this.applyBatchDefaults(row.values, batch, mapped.ids);
      const normalized = normalizeCandidateDraft(values, { rowNumber: row.rowNumber });
      const warnings = deduplicateWarnings([...mapped.warnings, ...normalized.issues]);
      if (!normalized.value || warnings.some((warning) => warning.severity === 'error')) {
        prepared.push(this.invalidCandidate(batch, jobId, row.rowNumber, values, mapped.ids, warnings));
        continue;
      }
      const fingerprint = computeImportFingerprint(normalized.value);
      fingerprints.push(fingerprint);
      prepared.push(this.validCandidate(batch, jobId, row.rowNumber, normalized.value, fingerprint));
    }

    const duplicateFamilies = new Map<string, string>();
    if (fingerprints.length > 0) {
      const duplicates = await this.prisma.question.findMany({
        where: { contentFingerprint: { in: [...new Set(fingerprints)] }, isCurrent: true },
        select: { contentFingerprint: true, familyId: true },
      });
      duplicates.forEach((question) => duplicateFamilies.set(question.contentFingerprint, question.familyId));
    }
    for (const candidate of prepared) {
      if (candidate.status !== QuestionImportCandidateStatus.pending_review) continue;
      const familyId = duplicateFamilies.get(candidate.contentFingerprint);
      if (familyId) {
        candidate.status = QuestionImportCandidateStatus.duplicate_suspected;
        candidate.targetFamilyId = familyId;
      }
    }

    parserIssues.forEach((parserIssue, index) => {
      const rowNumber = parserIssue.rowNumber ?? -(index + 1);
      if (prepared.some((candidate) => candidate.sourceRowNumber === rowNumber)) return;
      prepared.push(this.invalidCandidate(batch, jobId, rowNumber, {}, [], [parserIssue], QuestionImportCandidateStatus.parse_failed));
    });
    return prepared;
  }

  private mapKnowledgePoints(
    values: Record<string, unknown>,
    batch: TableImportBatchContext,
    points: Array<{ id: string; subject: Subject; chapter: string; title: string }>,
  ): { ids: string[]; warnings: ImportWarning[] } {
    const explicitIds = list(values['知识点 ID'] ?? values.knowledgePointIds);
    if (explicitIds.length > 0) {
      const existing = new Set(points.map((point) => point.id));
      const missing = explicitIds.filter((id) => !existing.has(id));
      return {
        ids: explicitIds.filter((id) => existing.has(id)),
        warnings: missing.length === 0 ? [] : [fieldWarning(
          'UNKNOWN_KNOWLEDGE_POINT_ID', 'knowledgePointIds', `知识点 ID 不存在：${missing.join('、')}`, '请选择系统中已有的知识点。',
        )],
      };
    }

    const subjectText = text(values.科目 ?? values.subject ?? batch.defaultSubject);
    const chapter = text(values.章节 ?? values.chapter ?? batch.defaultChapter);
    const titles = list(values.知识点 ?? values.knowledgePointNames);
    if (titles.length === 0) {
      return { ids: [], warnings: [fieldWarning('MISSING_KNOWLEDGE_POINT', 'knowledgePointIds', '知识点不能为空。', '请选择科目、章节和知识点。')] };
    }
    const subject = SUBJECT_ALIASES[subjectText];
    if (!subject) {
      return { ids: [], warnings: [fieldWarning('UNKNOWN_SUBJECT', 'knowledgePointIds', '科目不在允许范围内。', '请选择 408 的四个科目之一。')] };
    }
    if (!chapter) {
      return { ids: [], warnings: [fieldWarning('MISSING_CHAPTER', 'knowledgePointIds', '章节不能为空。', '请填写知识点所在章节。')] };
    }
    const ids: string[] = [];
    const missing: string[] = [];
    for (const title of titles) {
      const point = points.find((candidate) => candidate.subject === subject
        && comparable(candidate.chapter) === comparable(chapter)
        && comparable(candidate.title) === comparable(title));
      if (point) ids.push(point.id);
      else missing.push(title);
    }
    return {
      ids,
      warnings: missing.length === 0 ? [] : [fieldWarning(
        'UNMAPPED_KNOWLEDGE_POINT', 'knowledgePointIds', `未找到知识点：${missing.join('、')}`, '检查科目、章节和知识点名称是否与系统一致。',
      )],
    };
  }

  private applyBatchDefaults(values: Record<string, unknown>, batch: TableImportBatchContext, knowledgePointIds: string[]) {
    return {
      ...values,
      来源: text(values.来源 ?? values.source) || batch.source,
      年份: text(values.年份 ?? values.year) || batch.year,
      '知识点 ID': knowledgePointIds,
    };
  }

  private validCandidate(
    batch: TableImportBatchContext,
    jobId: string,
    rowNumber: number,
    value: CandidateQuestionDraft,
    contentFingerprint: string,
  ): PreparedImportCandidate {
    return {
      batchId: batch.id,
      jobId,
      sourceRowNumber: rowNumber,
      stem: value.stem,
      options: value.options,
      answer: value.answer,
      analysis: value.analysis,
      difficulty: toDifficulty(value.difficulty),
      type: toQuestionType(value.type),
      source: value.source,
      year: value.year ?? null,
      expectedTimeSec: value.expectedTimeSec,
      knowledgePointIds: value.knowledgePointIds,
      formulas: value.formulas as unknown as Prisma.InputJsonValue,
      warnings: value.warnings as unknown as Prisma.InputJsonValue,
      pageNumber: value.pageNumber ?? null,
      sourceRegion: value.sourceRegion as unknown as Prisma.InputJsonValue | undefined,
      contentFingerprint,
      status: QuestionImportCandidateStatus.pending_review,
    };
  }

  private invalidCandidate(
    batch: TableImportBatchContext,
    jobId: string,
    rowNumber: number,
    values: Record<string, unknown>,
    knowledgePointIds: string[],
    warnings: ImportWarning[],
    status: QuestionImportCandidateStatus = QuestionImportCandidateStatus.needs_edit,
  ): PreparedImportCandidate {
    const options = OPTION_LETTERS.split('').map((letter) => text(values[`选项 ${letter}`] ?? values[`option${letter}`])).filter(Boolean);
    const year = Number(text(values.年份 ?? values.year));
    const expectedTime = Number(text(values['建议答题时间（秒）'] ?? values.expectedTimeSec));
    return {
      batchId: batch.id,
      jobId,
      sourceRowNumber: rowNumber,
      stem: text(values.题干 ?? values.stem),
      options,
      answer: text(values.正确答案 ?? values.answer).toUpperCase(),
      analysis: text(values.答案解析 ?? values.analysis),
      difficulty: toDifficulty(text(values.难度 ?? values.difficulty)),
      type: toQuestionType(text(values.题型 ?? values.type)),
      source: text(values.来源 ?? values.source) || batch.source,
      year: Number.isInteger(year) && year >= 1900 && year <= 3000 ? year : null,
      expectedTimeSec: Number.isInteger(expectedTime) && expectedTime > 0 ? expectedTime : 90,
      knowledgePointIds,
      formulas: [],
      warnings: warnings as unknown as Prisma.InputJsonValue,
      contentFingerprint: computeInvalidImportFingerprint(jobId, rowNumber),
      status,
    };
  }
}

function text(value: unknown): string {
  return value === undefined || value === null ? '' : String(value).normalize('NFKC').replace(/\s+/gu, ' ').trim();
}

function comparable(value: string): string {
  return text(value).toLocaleLowerCase('zh-CN');
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const normalized = text(value);
  return normalized ? normalized.split(/[、,，;；\n]/u).map(text).filter(Boolean) : [];
}

function fieldWarning(code: string, field: keyof CandidateQuestionDraft, message: string, suggestion: string): ImportWarning {
  return { code, severity: 'error', field, message, suggestion };
}

function deduplicateWarnings(warnings: ImportWarning[]): ImportWarning[] {
  const seen = new Set<string>();
  return warnings.filter((warning) => {
    const key = `${warning.code}:${warning.field ?? ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function toDifficulty(value: string): Difficulty {
  if (value === '基础' || value === Difficulty.BASIC) return Difficulty.BASIC;
  if (value === '困难' || value === Difficulty.HARD) return Difficulty.HARD;
  return Difficulty.MEDIUM;
}

export function toQuestionType(value: string): QuestionType {
  if (value === '综合题' || value === QuestionType.COMPREHENSIVE) return QuestionType.COMPREHENSIVE;
  if (value === '判断题' || value === QuestionType.JUDGEMENT) return QuestionType.JUDGEMENT;
  return QuestionType.SINGLE_CHOICE;
}
