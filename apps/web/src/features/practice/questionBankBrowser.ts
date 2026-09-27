// V14 — 题库浏览/自由刷题 pure helpers（任务书
// docs/v14-question-bank-browser-design.md，Owner 批准 D-B-1..4 按建议冻结）。
//
// 架构事实（2026-09-26 审计）：学生目录 `GET /questions`（overview.questions）已把
// 全部 current 题的学生安全投影下发到客户端（answer 置空、optionAnalyses 剥离，
// questions/question-view.ts），练习记录也在 overview.practiceRecords——浏览页因此
// 纯客户端过滤，不新增服务端端点、不扩大任何数据暴露面。
//
// 语义边界（RULE-05/06/07）：attemptStatus 是 PracticeRecord 的 OBSERVED 投影，
// wrong 优先；浏览与筛选本身零写入——不产生记录，更不触碰 mastery。

import type { Question } from '@kaoyan408/shared';

export type BrowseAttemptStatus = 'unanswered' | 'wrong' | 'correct';
export type BrowseStatusFilter = 'all' | BrowseAttemptStatus;

export interface BrowseRecordLike {
  questionId: string;
  correct: boolean;
}

/** Owner D-B-3：一键组卷上限（对齐整卷 questionCount 50 的既有上限）。 */
export const FREE_PRACTICE_MAX_QUESTIONS = 50;

export function deriveAttemptStatuses(records: BrowseRecordLike[]): Map<string, BrowseAttemptStatus> {
  const statuses = new Map<string, BrowseAttemptStatus>();
  for (const record of records) {
    if (statuses.get(record.questionId) === 'wrong') continue;
    statuses.set(record.questionId, record.correct ? 'correct' : 'wrong');
  }
  return statuses;
}

export function previewStem(stem: string, max = 60): string {
  const flat = stem.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

export interface BrowseRow {
  id: string;
  stemPreview: string;
  type: Question['type'];
  difficulty: Question['difficulty'];
  year: number | null;
  examNo: number | null;
  source: string;
  maxScore: number | null;
  status: BrowseAttemptStatus;
}

export interface BrowseFilters {
  /** 知识点科目（中文科目名）；null = 全部。 */
  subject: string | null;
  type: 'all' | Question['type'];
  year: number | null;
  status: BrowseStatusFilter;
  /** Phase 2（Owner 2026-09-26 追加）：难度；'all' = 不过滤。 */
  difficulty: 'all' | Question['difficulty'];
  /** Phase 2：题干关键词（大小写不敏感子串；空白 = 不过滤）。 */
  query: string;
}

export interface FilterBrowseQuestionsInput {
  questions: Question[];
  /** 知识点 id → 科目名（由组件从 overview.knowledgePoints 构建）。 */
  subjectByPointId: Map<string, string>;
  records: BrowseRecordLike[];
  filters: BrowseFilters;
}

export function filterBrowseQuestions(input: FilterBrowseQuestionsInput): BrowseRow[] {
  const statuses = deriveAttemptStatuses(input.records);
  // 题干关键词：大小写不敏感子串；纯空白 = 不过滤。
  const needle = input.filters.query.trim().toLowerCase();
  const rows: BrowseRow[] = [];
  for (const question of input.questions) {
    if (input.filters.subject) {
      const subjects = question.knowledgePointIds
        .map((pointId) => input.subjectByPointId.get(pointId))
        .filter((subject): subject is string => Boolean(subject));
      if (!subjects.includes(input.filters.subject)) continue;
    }
    if (input.filters.type !== 'all' && question.type !== input.filters.type) continue;
    if (input.filters.year != null && question.year !== input.filters.year) continue;
    if (input.filters.difficulty !== 'all' && question.difficulty !== input.filters.difficulty) continue;
    if (needle && !question.stem.toLowerCase().includes(needle)) continue;
    const status = statuses.get(question.id) ?? 'unanswered';
    if (input.filters.status !== 'all' && status !== input.filters.status) continue;
    rows.push({
      id: question.id,
      stemPreview: previewStem(question.stem),
      type: question.type,
      difficulty: question.difficulty,
      year: question.year ?? null,
      examNo: question.examNo ?? null,
      source: question.source,
      maxScore: question.maxScore ?? null,
      status,
    });
  }
  // 真题序：年份降序（无年份最后）→ 题号升序（无题号最后）→ id 稳定序。
  rows.sort((left, right) =>
    (right.year ?? -1) - (left.year ?? -1)
    || (left.examNo ?? Number.MAX_SAFE_INTEGER) - (right.examNo ?? Number.MAX_SAFE_INTEGER)
    || left.id.localeCompare(right.id));
  return rows;
}

/**
 * Phase 2 定位（Owner D-B-2 追加）：年份+题号 → 排序后下标（0 起）；
 * 未找到 = -1。组件据此跳页并高亮。
 */
export function findRowIndex(rows: BrowseRow[], year: number, examNo: number): number {
  return rows.findIndex((row) => row.year === year && row.examNo === examNo);
}

export interface BrowsePage {
  rows: BrowseRow[];
  total: number;
  pageCount: number;
  page: number;
}

/** 客户端已有全量投影——分页就是纯切片，无服务端往返。 */
export function paginateBrowseRows(rows: BrowseRow[], page: number, pageSize = 20): BrowsePage {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  return {
    rows: rows.slice((safePage - 1) * pageSize, safePage * pageSize),
    total,
    pageCount,
    page: safePage,
  };
}

export interface FreePracticeSet {
  questionIds: string[];
  capped: boolean;
  total: number;
}

export function buildFreePracticeSet(rows: BrowseRow[], cap = FREE_PRACTICE_MAX_QUESTIONS): FreePracticeSet {
  const ids = rows.map((row) => row.id);
  return { questionIds: ids.slice(0, cap), capped: ids.length > cap, total: ids.length };
}
