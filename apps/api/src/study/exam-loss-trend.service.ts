import { Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { buildMockLossTrend, type MockLossTrendResult } from '@kaoyan408/shared';
import type { LegacyExamScoreHistoryDto } from './exam-score-history.adapter';

const MAX_SESSIONS = 50;
const MAX_LOSS_ROWS = 2000;

/**
 * PHASE 11 — mock-exam loss trend (read-only).
 *
 * Adds the LOSING dimension to the accuracy history: per exam session, how much
 * observed/proxy loss was recorded and how it changed versus the previous exam.
 *
 * Join path (both shapes verified against the writers AND live rows):
 *   (a) session path:        ScoreAssessment.originId = 'paper:<sessionId>'
 *   (b) direct-submit path:  ScoreAssessment.originId = 'paper:<paperId>'
 *   ScoreLossItem.scoreEntryId == that assessment's id.
 * Every history session contributes BOTH candidate shapes, so the join needs no
 * assumption about which path produced the evidence.
 *
 * Read-only; no scheduling, no mastery, no writes.
 */
@Injectable()
export class ExamLossTrendService {
  constructor(@Optional() private readonly prisma?: PrismaService) {}

  get enabled(): boolean {
    return Boolean(process.env.DATABASE_URL && this.prisma);
  }

  async getLossTrend(userId: string, history: LegacyExamScoreHistoryDto['history']): Promise<MockLossTrendResult | null> {
    if (!this.enabled) return null;
    const exams = history.slice(-MAX_SESSIONS);
    if (exams.length === 0) return buildMockLossTrend({ exams: [], losses: [] });

    const sessionIds = exams.map((exam) => exam.sessionId);
    const [sessions, historyRows] = await Promise.all([
      this.prisma!.learningSession.findMany({
        where: { userId, id: { in: sessionIds } },
        select: { id: true, resourceId: true },
      }),
      this.prisma!.assessmentHistoryItem.findMany({
        where: { userId, sessionId: { in: sessionIds }, paperId: { not: null } },
        select: { sessionId: true, paperId: true },
      }),
    ]);
    const sessionByOriginId = new Map<string, string>();
    for (const exam of exams) sessionByOriginId.set(`paper:${exam.sessionId}`, exam.sessionId);
    for (const row of sessions) {
      if (row.resourceId && !sessionByOriginId.has(`paper:${row.resourceId}`)) {
        sessionByOriginId.set(`paper:${row.resourceId}`, row.id);
      }
    }
    for (const row of historyRows) {
      if (row.sessionId && row.paperId && !sessionByOriginId.has(`paper:${row.paperId}`)) {
        sessionByOriginId.set(`paper:${row.paperId}`, row.sessionId);
      }
    }
    const originIds = [...sessionByOriginId.keys()];
    if (originIds.length === 0) return buildMockLossTrend({ exams, losses: [] });

    const assessments = await this.prisma!.scoreAssessment.findMany({
      where: { userId, originId: { in: originIds } },
      select: { id: true, originId: true },
    });
    if (assessments.length === 0) return buildMockLossTrend({ exams, losses: [] });
    const entryToSession = new Map<string, string>();
    for (const assessment of assessments) {
      const sessionId = sessionByOriginId.get(assessment.originId);
      if (sessionId) entryToSession.set(assessment.id, sessionId);
    }
    const lossRows = await this.prisma!.scoreLossItem.findMany({
      where: { userId, scoreEntryKind: 'assessment', scoreEntryId: { in: [...entryToSession.keys()] } },
      orderBy: { recordedAt: 'desc' },
      take: MAX_LOSS_ROWS,
      select: { scoreEntryId: true, questionId: true, nodeId: true, lostScore: true, lossKind: true },
    });
    return buildMockLossTrend({
      exams,
      losses: lossRows.flatMap((row) => {
        const sessionId = entryToSession.get(row.scoreEntryId);
        if (!sessionId) return [];
        return [{
          sessionId,
          questionId: row.questionId,
          nodeId: row.nodeId,
          lostScore: row.lostScore,
          lossKind: row.lossKind === 'PROXY' ? 'PROXY' as const : 'OBSERVED' as const,
        }];
      }),
    });
  }
}
