import { buildExamScoreHistorySnapshot, type ExamScoreHistorySnapshot } from './exam-score-history.snapshot';

interface LearningSessionFacts {
  id: string;
  userId: string;
  type: 'practice_set' | 'stage_assessment' | 'paper';
  completed: boolean;
  questionIds: string[];
  lastActiveAt: string;
  totalActiveMs: number;
}

interface PracticeRecordFacts {
  // Domain PracticeRecord carries sessionId?: string; null keeps snapshot-only sources assignable.
  sessionId?: string | null;
  correct: boolean;
}

export class ExamScoreHistoryProjectionService {
  constructor(
    private readonly dependencies: {
      sessions: { loadAll: () => Promise<LearningSessionFacts[]> };
      practiceRecords: { listByUser: (userId: string) => Promise<PracticeRecordFacts[]> };
    },
  ) {}

  async getSnapshot(userId: string, asOf: Date = new Date()): Promise<ExamScoreHistorySnapshot> {
    if (!process.env.DATABASE_URL) return buildExamScoreHistorySnapshot({ userId, asOf });

    const [allSessions, userRecords] = await Promise.all([
      this.dependencies.sessions.loadAll(),
      this.dependencies.practiceRecords.listByUser(userId),
    ]);

    const exams = allSessions
      .filter((session) => session.userId === userId)
      .filter((session) => session.type === 'paper')
      .filter((session) => session.completed)
      .filter((session) => session.lastActiveAt <= toIso(asOf))
      .map((session) => {
        const records = userRecords.filter((record) => record.sessionId === session.id);
        return {
          sessionId: session.id,
          lastActiveAt: session.lastActiveAt,
          totalQuestions: session.questionIds.length,
          correctCount: records.filter((record) => record.correct).length,
          totalActiveMs: session.totalActiveMs,
        };
      })
      .sort((left, right) => left.lastActiveAt.localeCompare(right.lastActiveAt) || left.sessionId.localeCompare(right.sessionId));

    return buildExamScoreHistorySnapshot({ userId, asOf, exams });
  }
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
