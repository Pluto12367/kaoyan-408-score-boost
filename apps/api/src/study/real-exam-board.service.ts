/**
 * V14-R4-A — real-exam presentation projections (read-only; task book
 * docs/v14-r4-presentation-design.md §3.1/§3.3).
 *
 * All endpoints built on this service are read-only projections over
 * OBSERVED facts (Question.examNo × PracticeRecord × ExamQuestion tag layer).
 * No mastery writes, no ranking changes, no score semantics (RULE-08 parity
 * with the rest of the coach family). Absent data stays null/empty — never
 * fabricated (RULE-06).
 */

import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type BoardSlotStatus = 'correct' | 'wrong' | 'unanswered';

export interface BoardSlot {
  examNo: number;
  questionId: string | null;
  subject: string | null;
  questionSubtype: string | null;
  maxScore: number | null;
  status: BoardSlotStatus | null;
}

export interface RealExamBoard {
  year: number;
  storeAvailable: boolean;
  slots: BoardSlot[];
  summary: {
    total: number;
    answeredCount: number;
    correctCount: number;
    wrongCount: number;
    totalScore: number;
  };
  novelKps: Array<{ knowledgeNodeId: string; name: string }>;
  returningKps: Array<{ knowledgeNodeId: string; name: string; lastYear: number }>;
}

export interface RealExamDashboard {
  storeAvailable: boolean;
  years: Array<{ year: number; count: number }>;
  totalQuestions: number;
  knowledgePointsTested: number;
  knowledgePointsTotal: number;
  coveragePct: number | null;
  topKps: Array<{ knowledgeNodeId: string; name: string; score5y: number; allTime: number; yearsTested: number }>;
}

export interface RealExamFrequency {
  storeAvailable: boolean;
  subject: string | null;
  levels: { high: number; mid: number; low: number; cold: number };
  rows: Array<{ knowledgeNodeId: string; name: string; subject: string; yearsTested: number; totalScore: number; lastYear: number | null }>;
}

export interface RealExamUncovered {
  storeAvailable: boolean;
  total: number;
  nodes: Array<{ knowledgeNodeId: string; name: string; subject: string; chapter: string | null }>;
}

/** Board slot status: the LATEST practice record for (user, question) wins. */
export function deriveBoardSlots(
  questions: Array<{ id: string; examNo: number; maxScore: number | null; subject?: string | null; questionSubtype?: string | null }>,
  records: Array<{ questionId: string; correct: boolean; submittedAt: string }>,
): BoardSlot[] {
  const latest = new Map<string, boolean>();
  for (const record of [...records].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))) {
    latest.set(record.questionId, record.correct);
  }
  return questions
    .slice()
    .sort((a, b) => a.examNo - b.examNo)
    .map((question) => {
      const status: BoardSlotStatus = latest.has(question.id) ? (latest.get(question.id) as boolean ? 'correct' : 'wrong') : 'unanswered';
      return {
        examNo: question.examNo,
        questionId: question.id,
        subject: question.subject ?? null,
        questionSubtype: question.questionSubtype ?? null,
        maxScore: question.maxScore ?? null,
        status,
      };
    });
}

/**
 * Novel = earliest recorded appearance == board year.
 * Returning = seen in board year, previous appearance ≥3 years earlier
 * (沉寂 ≥2 年后回归 — the gap of 2 does NOT count, pinned by contract test).
 */
export function deriveNovelReturning(
  year: number,
  tagYears: Map<string, number[]>,
): { novel: string[]; returning: Array<{ knowledgeNodeId: string; lastYear: number }> } {
  const novel: string[] = [];
  const returning: Array<{ knowledgeNodeId: string; lastYear: number }> = [];
  for (const [nodeId, years] of tagYears) {
    const sorted = [...years].sort((a, b) => a - b);
    if (!sorted.includes(year)) continue;
    if (sorted[0] === year) {
      novel.push(nodeId);
      continue;
    }
    const previous = Math.max(...sorted.filter((entry) => entry < year));
    if (year - previous >= 3) {
      returning.push({ knowledgeNodeId: nodeId, lastYear: previous });
    }
  }
  return { novel: novel.sort(), returning: returning.sort((a, b) => a.knowledgeNodeId.localeCompare(b.knowledgeNodeId)) };
}

/** Frequency levels by years-tested: ≥10 high / 5-9 mid / 2-4 low / ≤1 cold. */
export function deriveFrequencyLevels(yearsTestedValues: number[]): { high: number; mid: number; low: number; cold: number } {
  const levels = { high: 0, mid: 0, low: 0, cold: 0 };
  for (const value of yearsTestedValues) {
    if (value >= 10) levels.high += 1;
    else if (value >= 5) levels.mid += 1;
    else if (value >= 2) levels.low += 1;
    else levels.cold += 1;
  }
  return levels;
}

@Injectable()
export class RealExamBoardService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  private get enabled(): boolean {
    return Boolean(this.prisma);
  }

  async getBoard(userId: string, year: number): Promise<RealExamBoard> {
    if (!this.enabled) {
      return { year, storeAvailable: false, slots: [], summary: { total: 0, answeredCount: 0, correctCount: 0, wrongCount: 0, totalScore: 0 }, novelKps: [], returningKps: [] };
    }
    const questions = await this.prisma!.question.findMany({
      where: { year, examNo: { not: null }, isCurrent: true },
      select: { id: true, examNo: true, questionSubtype: true, maxScore: true },
      orderBy: { examNo: 'asc' },
    });
    const questionIds = questions.map((question) => question.id);
    const records = questionIds.length
      ? await this.prisma!.practiceRecord.findMany({
          where: { userId, questionId: { in: questionIds } },
          select: { questionId: true, correct: true, submittedAt: true },
          orderBy: { submittedAt: 'asc' },
        })
      : [];

    // Subject comes from the real-exam benchmark layer (ExamQuestion per
    // paper/year) when seeded; the practice bank itself has no subject column.
    const paperRows = await this.prisma!.examPaper.findMany({
      where: { year },
      select: { id: true },
      take: 1,
    });
    const subjectByNo = new Map<number, string>();
    if (paperRows.length > 0) {
      const examQuestions = await this.prisma!.examQuestion.findMany({
        where: { paperId: paperRows[0].id },
        select: { questionNo: true, subject: true },
      });
      for (const row of examQuestions) subjectByNo.set(row.questionNo, row.subject);
    }

    const slots = deriveBoardSlots(
      questions.map((question) => ({
        id: question.id,
        examNo: question.examNo as number,
        maxScore: question.maxScore,
        questionSubtype: question.questionSubtype ?? null,
        subject: subjectByNo.get(question.examNo as number) ?? null,
      })),
      records.map((record) => ({
        questionId: record.questionId,
        correct: record.correct,
        submittedAt: record.submittedAt.toISOString(),
      })),
    );

    const tagRows = await this.prisma!.examQuestionKnowledgeTag.findMany({
      where: { question: { paper: { year: { lte: year } } } },
      select: { knowledgeNodeId: true, question: { select: { paper: { select: { year: true } } } } },
      take: 5000,
    });
    const tagYears = new Map<string, number[]>();
    for (const row of tagRows) {
      const nodeId = row.knowledgeNodeId;
      const paperYear = row.question.paper.year;
      if (!tagYears.has(nodeId)) tagYears.set(nodeId, []);
      if (!tagYears.get(nodeId)!.includes(paperYear)) tagYears.get(nodeId)!.push(paperYear);
    }
    const { novel, returning } = deriveNovelReturning(year, tagYears);
    const nodeIds = [...new Set([...novel, ...returning.map((row) => row.knowledgeNodeId)])];
    const nodeNames = new Map<string, string>();
    if (nodeIds.length) {
      const nodes = await this.prisma!.knowledgeNode.findMany({
        where: { id: { in: nodeIds } },
        select: { id: true, name: true },
      });
      for (const node of nodes) nodeNames.set(node.id, node.name);
    }

    const answered = slots.filter((slot) => slot.status !== 'unanswered' && slot.questionId != null);
    return {
      year,
      storeAvailable: true,
      slots,
      summary: {
        total: slots.filter((slot) => slot.questionId != null).length,
        answeredCount: answered.length,
        correctCount: answered.filter((slot) => slot.status === 'correct').length,
        wrongCount: answered.filter((slot) => slot.status === 'wrong').length,
        totalScore: slots.reduce((total, slot) => total + (slot.maxScore ?? 0), 0),
      },
      novelKps: novel.map((nodeId) => ({ knowledgeNodeId: nodeId, name: nodeNames.get(nodeId) ?? '' })),
      returningKps: returning.map((row) => ({ knowledgeNodeId: row.knowledgeNodeId, name: nodeNames.get(row.knowledgeNodeId) ?? '', lastYear: row.lastYear })),
    };
  }

  async getDashboard(): Promise<RealExamDashboard> {
    if (!this.enabled) {
      return { storeAvailable: false, years: [], totalQuestions: 0, knowledgePointsTested: 0, knowledgePointsTotal: 0, coveragePct: null, topKps: [] };
    }
    const grouped = await this.prisma!.question.groupBy({
      by: ['year'],
      where: { examNo: { not: null }, isCurrent: true },
      _count: { _all: true },
      orderBy: { year: 'asc' },
    });
    const years = grouped
      .filter((row) => row.year != null)
      .map((row) => ({ year: row.year as number, count: row._count._all }));
    const totalQuestions = years.reduce((total, row) => total + row.count, 0);

    const [tested, totalNodes] = await Promise.all([
      this.prisma!.examQuestionKnowledgeTag.findMany({
        select: { knowledgeNodeId: true },
        distinct: ['knowledgeNodeId'],
      }),
      this.prisma!.knowledgeNode.count({ where: { isActive: true } }),
    ]);
    const knowledgePointsTested = tested.length;
    const coveragePct = totalNodes > 0 ? Math.round((knowledgePointsTested / totalNodes) * 1000) / 10 : null;

    // Latest snapshot per node via distinct-on-sorted-order, then TOP 15 by
    // 5-year primary score; yearsTested from the exam tag layer.
    const snapshots = await this.prisma!.knowledgeFrequencySnapshot.findMany({
      orderBy: [{ snapshotDate: 'desc' }],
      distinct: ['knowledgeNodeId'],
      take: 2000,
      select: { knowledgeNodeId: true, primaryScore5y: true, allTimeEvidence: true },
    });
    const yearRows = await this.prisma!.examQuestionKnowledgeTag.findMany({
      where: { role: 'PRIMARY' },
      select: { knowledgeNodeId: true, question: { select: { paper: { select: { year: true } } } } },
      take: 5000,
    });
    const yearsByNode = new Map<string, Set<number>>();
    for (const row of yearRows) {
      if (!yearsByNode.has(row.knowledgeNodeId)) yearsByNode.set(row.knowledgeNodeId, new Set());
      yearsByNode.get(row.knowledgeNodeId)!.add(row.question.paper.year);
    }
    const topKps = snapshots
      .sort((a, b) => b.primaryScore5y - a.primaryScore5y)
      .slice(0, 15)
      .map((snapshot) => ({
        knowledgeNodeId: snapshot.knowledgeNodeId,
        name: '',
        score5y: snapshot.primaryScore5y,
        allTime: snapshot.allTimeEvidence,
        yearsTested: yearsByNode.get(snapshot.knowledgeNodeId)?.size ?? 0,
      }));
    const topIds = topKps.map((row) => row.knowledgeNodeId);
    if (topIds.length) {
      const nodes = await this.prisma!.knowledgeNode.findMany({ where: { id: { in: topIds } }, select: { id: true, name: true } });
      const names = new Map(nodes.map((node) => [node.id, node.name]));
      for (const row of topKps) row.name = names.get(row.knowledgeNodeId) ?? '';
    }

    return { storeAvailable: true, years, totalQuestions, knowledgePointsTested, knowledgePointsTotal: totalNodes, coveragePct, topKps };
  }

  async getFrequency(subject?: string): Promise<RealExamFrequency> {
    if (!this.enabled) {
      return { storeAvailable: false, subject: subject ?? null, levels: { high: 0, mid: 0, low: 0, cold: 0 }, rows: [] };
    }
    const nodes = await this.prisma!.knowledgeNode.findMany({
      where: { isActive: true, ...(subject ? { subject } : {}) },
      select: { id: true, name: true, subject: true },
    });
    const nodeMeta = new Map(nodes.map((node) => [node.id, node]));
    const tags = await this.prisma!.examQuestionKnowledgeTag.findMany({
      where: { role: 'PRIMARY', knowledgeNodeId: { in: nodes.map((node) => node.id) } },
      select: { knowledgeNodeId: true, question: { select: { score: true, paper: { select: { year: true } } } } },
      take: 8000,
    });
    const agg = new Map<string, { years: Set<number>; totalScore: number; lastYear: number | null }>();
    for (const tag of tags) {
      if (!nodeMeta.has(tag.knowledgeNodeId)) continue;
      if (!agg.has(tag.knowledgeNodeId)) agg.set(tag.knowledgeNodeId, { years: new Set(), totalScore: 0, lastYear: null });
      const entry = agg.get(tag.knowledgeNodeId)!;
      const paperYear = tag.question.paper.year;
      if (!entry.years.has(paperYear)) {
        entry.years.add(paperYear);
        entry.lastYear = entry.lastYear == null ? paperYear : Math.max(entry.lastYear, paperYear);
      }
      entry.totalScore += tag.question.score ?? 0;
    }
    const rows = [...agg.entries()]
      .map(([knowledgeNodeId, entry]) => ({
        knowledgeNodeId,
        name: nodeMeta.get(knowledgeNodeId)!.name,
        subject: nodeMeta.get(knowledgeNodeId)!.subject,
        yearsTested: entry.years.size,
        totalScore: entry.totalScore,
        lastYear: entry.lastYear,
      }))
      .sort((a, b) => b.yearsTested - a.yearsTested || b.totalScore - a.totalScore || a.knowledgeNodeId.localeCompare(b.knowledgeNodeId));
    return {
      storeAvailable: true,
      subject: subject ?? null,
      levels: deriveFrequencyLevels(rows.map((row) => row.yearsTested)),
      rows: rows.slice(0, 200),
    };
  }

  async getUncovered(): Promise<RealExamUncovered> {
    if (!this.enabled) {
      return { storeAvailable: false, total: 0, nodes: [] };
    }
    const nodes = await this.prisma!.knowledgeNode.findMany({
      where: { isActive: true },
      select: { id: true, name: true, subject: true, parentId: true },
      orderBy: [{ subject: 'asc' }, { id: 'asc' }],
    });
    const tagged = await this.prisma!.examQuestionKnowledgeTag.findMany({
      select: { knowledgeNodeId: true },
      distinct: ['knowledgeNodeId'],
    });
    const taggedIds = new Set(tagged.map((row) => row.knowledgeNodeId));
    const uncovered = nodes
      .filter((node) => !taggedIds.has(node.id))
      .map((node) => ({ knowledgeNodeId: node.id, name: node.name, subject: node.subject, chapter: node.parentId }));
    return {
      storeAvailable: true,
      total: uncovered.length,
      nodes: uncovered.slice(0, 200),
    };
  }

  /** V14-R4-C — 章节命题图谱：PRIMARY 标签的真题分值按章节段×年份聚合。 */
  async getChapterMap(): Promise<RealExamChapterMap> {
    if (!this.enabled) {
      return { storeAvailable: false, yearAxis: [], chapters: [] };
    }
    const grouped = await this.prisma!.question.groupBy({
      by: ['year'],
      where: { examNo: { not: null }, isCurrent: true },
      _count: { _all: true },
      orderBy: { year: 'asc' },
    });
    const yearAxis = grouped.map((row) => row.year as number).filter((year) => year != null);
    const tagRows = await this.prisma!.examQuestionKnowledgeTag.findMany({
      where: { role: 'PRIMARY' },
      select: {
        knowledgeNodeId: true,
        question: { select: { score: true, paper: { select: { year: true } } } },
      },
      take: 8000,
    });
    const nodeMeta = await this.prisma!.knowledgeNode.findMany({
      select: { id: true, subject: true },
    });
    const subjectByNode = new Map(nodeMeta.map((node) => [node.id, node.subject]));
    const rows = tagRows
      .filter((row) => subjectByNode.has(row.knowledgeNodeId))
      .map((row) => ({
        knowledgeNodeId: row.knowledgeNodeId,
        year: row.question.paper.year,
        score: row.question.score ?? 0,
      }));
    const chapters = deriveChapterYearScores(rows, yearAxis);
    return { storeAvailable: true, yearAxis, chapters };
  }

  /** V14-R4-C — 命题轨迹：曾高频（考过≥3年）且近 3 年沉默的考点。 */
  async getTrajectory(): Promise<RealExamTrajectory> {
    if (!this.enabled) {
      return { storeAvailable: false, currentYear: new Date().getFullYear(), rows: [] };
    }
    const currentYear = new Date().getFullYear();
    const frequency = await this.getFrequency(undefined);
    const rows = deriveSilentHighFrequency(
      frequency.rows.map((row) => ({
        knowledgeNodeId: row.knowledgeNodeId,
        yearsTested: row.yearsTested,
        totalScore: row.totalScore,
        lastYear: row.lastYear,
      })),
      currentYear,
    ).map((silent) => {
      const source = frequency.rows.find((row) => row.knowledgeNodeId === silent.knowledgeNodeId)!;
      return {
        knowledgeNodeId: silent.knowledgeNodeId,
        name: source.name,
        subject: source.subject,
        yearsTested: source.yearsTested,
        totalScore: source.totalScore,
        lastYear: silent.lastYear,
      };
    });
    return { storeAvailable: true, currentYear, rows };
  }

  /** V14-R4-C — 难题榜：真题全站实测错误率 TOP（样本 ≥2 次作答）。 */
  async getHardQuestions(): Promise<RealExamHardQuestions> {
    if (!this.enabled) {
      return { storeAvailable: false, minAttempts: HARD_QUESTION_MIN_ATTEMPTS, total: 0, rows: [] };
    }
    const grouped = await this.prisma!.practiceRecord.groupBy({
      by: ['questionId', 'correct'],
      where: { question: { examNo: { not: null }, isCurrent: true } },
      _count: { _all: true },
    });
    const stats = new Map<string, { attempts: number; wrong: number }>();
    for (const row of grouped) {
      if (!stats.has(row.questionId)) stats.set(row.questionId, { attempts: 0, wrong: 0 });
      const entry = stats.get(row.questionId)!;
      entry.attempts += row._count._all;
      if (!row.correct) entry.wrong += row._count._all;
    }
    const ranking = deriveHardQuestionRanking(
      [...stats.entries()].map(([questionId, entry]) => ({ questionId, attempts: entry.attempts, wrong: entry.wrong })),
    );
    const questionIds = ranking.map((row) => row.questionId);
    const questionRows = questionIds.length
      ? await this.prisma!.question.findMany({
          where: { id: { in: questionIds } },
          select: { id: true, year: true, examNo: true, stem: true },
        })
      : [];
    const metaByQuestion = new Map(questionRows.map((row) => [row.id, row]));
    const examLayer = await this.prisma!.examQuestion.findMany({
      select: { questionNo: true, paper: { select: { year: true } }, subject: true },
      take: 3000,
    });
    const subjectByYearNo = new Map(examLayer.map((row) => [`${row.paper.year}:${row.questionNo}`, row.subject]));
    return {
      storeAvailable: true,
      minAttempts: HARD_QUESTION_MIN_ATTEMPTS,
      total: ranking.length,
      rows: ranking.map((row) => {
        const meta = metaByQuestion.get(row.questionId);
        return {
          questionId: row.questionId,
          year: meta?.year ?? null,
          examNo: meta?.examNo ?? null,
          subject: meta ? (subjectByYearNo.get(`${meta.year}:${meta.examNo}`) ?? null) : null,
          stemPreview: meta ? meta.stem.replace(/\s+/g, ' ').slice(0, 60) : '',
          attempts: row.attempts,
          wrong: row.wrong,
          wrongRatePct: row.wrongRatePct,
        };
      }),
    };
  }
}

export const HARD_QUESTION_MIN_ATTEMPTS = 2;

export interface ChapterYearScoreRow {
  knowledgeNodeId: string;
  year: number;
  score: number;
}

/** 章节命题图谱聚合：按节点 id 的章节段（如 DS-C02）× 年份累加 PRIMARY 分值。 */
export function deriveChapterYearScores(
  rows: ChapterYearScoreRow[],
  yearAxis?: number[],
): Array<{ chapter: string; subject: string; years: Record<number, number> }> {
  const chapters = new Map<string, { chapter: string; subject: string; years: Record<number, number> }>();
  for (const row of rows) {
    const chapter = /^([A-Z]+-C\d+)/.exec(row.knowledgeNodeId)?.[1];
    if (!chapter) continue;
    if (!chapters.has(chapter)) {
      chapters.set(chapter, {
        chapter,
        subject: row.knowledgeNodeId.slice(0, 2),
        years: {},
      });
    }
    const entry = chapters.get(chapter)!;
    entry.years[row.year] = (entry.years[row.year] ?? 0) + row.score;
  }
  const axis = yearAxis && yearAxis.length > 0
    ? [...new Set([...yearAxis])].sort((a, b) => a - b)
    : [...new Set(rows.map((row) => row.year))].sort((a, b) => a - b);
  return [...chapters.values()]
    .map((chapter) => {
      const years: Record<number, number> = {};
      for (const year of axis) years[year] = chapter.years[year] ?? 0;
      return { chapter: chapter.chapter, subject: chapter.subject, years };
    })
    .sort((a, b) => a.chapter.localeCompare(b.chapter));
}

/** 命题轨迹：考过 ≥3 年且最近一次考察 ≤ currentYear−3（近 3 年沉默）。 */
export function deriveSilentHighFrequency(
  rows: Array<{ knowledgeNodeId: string; yearsTested: number; totalScore: number; lastYear: number | null }>,
  currentYear: number,
): Array<{ knowledgeNodeId: string; yearsTested: number; totalScore: number; lastYear: number }> {
  return rows
    .filter((row) => row.yearsTested >= 3 && row.lastYear != null && row.lastYear <= currentYear - 3)
    .sort((a, b) => b.totalScore - a.totalScore)
    .map((row) => ({ ...row, lastYear: row.lastYear as number }));
}

export interface HardQuestionRankRow {
  questionId: string;
  attempts: number;
  wrong: number;
  wrongRatePct: number;
}

/** 难题榜：样本 ≥2 次作答，按错误率降序（同率按样本量降序），cap 20。 */
export function deriveHardQuestionRanking(
  rows: Array<{ questionId: string; attempts: number; wrong: number }>,
): HardQuestionRankRow[] {
  return rows
    .filter((row) => row.attempts >= HARD_QUESTION_MIN_ATTEMPTS)
    .map((row) => ({
      questionId: row.questionId,
      attempts: row.attempts,
      wrong: row.wrong,
      wrongRatePct: Math.round((row.wrong / row.attempts) * 100),
    }))
    .sort((a, b) => b.wrongRatePct - a.wrongRatePct || b.attempts - a.attempts || a.questionId.localeCompare(b.questionId))
    .slice(0, 20);
}

export interface RealExamChapterMap {
  storeAvailable: boolean;
  yearAxis: number[];
  chapters: Array<{ chapter: string; subject: string; years: Record<number, number> }>;
}

export interface RealExamTrajectory {
  storeAvailable: boolean;
  currentYear: number;
  rows: Array<{ knowledgeNodeId: string; name: string; subject: string; yearsTested: number; totalScore: number; lastYear: number }>;
}

export interface RealExamHardQuestions {
  storeAvailable: boolean;
  minAttempts: number;
  total: number;
  rows: Array<{
    questionId: string;
    year: number | null;
    examNo: number | null;
    subject: string | null;
    stemPreview: string;
    attempts: number;
    wrong: number;
    wrongRatePct: number;
  }>;
}
