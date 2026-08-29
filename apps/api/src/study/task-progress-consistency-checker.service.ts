import type { PrismaService } from '../prisma/prisma.service';
import { studyDateKey } from './study-date';

// Task Progress Audit Tool: read-only diagnostics for missed task-progress apply.
// This is not a full consistency checker and must not repair, write, or become a
// second source of truth for PracticeRecord, StudyTaskProgress, or StudyTaskCompletion.
export type TaskProgressAuditFindingType =
  | 'MISSING_PROGRESS'
  | 'AGGREGATE_MISMATCH'
  | 'STALLED_TASK'
  | 'UNRESOLVED_ATTRIBUTION'
  | 'BROKEN_RECEIPT'
  | 'EMPTY_RECEIPT';

export type TaskProgressAuditConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';

export interface TaskProgressAuditDelta {
  completedQuestionCount: number;
  correctCount: number;
  minutesSpent: number;
}

export interface TaskProgressAuditFinding {
  findingType: TaskProgressAuditFindingType;
  userId: string;
  receiptId?: string;
  practiceRecordId?: string;
  candidateTaskId?: string;
  confidence: TaskProgressAuditConfidence;
  reason: string;
  expectedDelta: TaskProgressAuditDelta;
  currentProgress: TaskProgressAuditDelta;
  studyDate: string;
  knowledgePointId: string;
}

export interface TaskProgressAuditResult {
  mode: 'available' | 'disabled';
  unavailableReason?: string;
  generatedAt: string;
  findings: TaskProgressAuditFinding[];
  summary: {
    checkedReceipts: number;
    checkedPracticeRecords: number;
    findingsCount: number;
  };
}

export interface TaskProgressAuditReceiptRow {
  id: string;
  userId: string;
  status: string;
  practiceRecordIds: string[];
}

export interface TaskProgressAuditPracticeRecordRow {
  id: string;
  userId: string;
  questionId?: string;
  knowledgePointId: string;
  correct: boolean;
  timeSpentSec: number;
  submittedAt: string | Date;
  sessionId?: string | null;
}

export interface TaskProgressAuditTaskRow {
  id: string;
  userId: string;
  knowledgePointId: string;
  questionCount: number;
  scheduledDate: string;
  status: string;
  completed: boolean;
  mode: string;
  nextAvailableAt?: string | Date | null;
}

export interface TaskProgressAuditProgressRow extends TaskProgressAuditDelta {
  userId: string;
  taskId: string;
}

export interface TaskProgressAuditCompletionRow {
  userId: string;
  taskId: string;
  completedDate: string;
  completedQuestionCount?: number | null;
  correctCount?: number | null;
  minutesSpent?: number | null;
}

export interface TaskProgressAuditSessionRow {
  id: string;
  userId: string;
  type: string;
  resourceId?: string | null;
}

export interface TaskProgressAuditReader {
  isAvailable?(): boolean;
  unavailableReason?(): string;
  listAnswerReceipts(input?: { userId?: string }): Promise<TaskProgressAuditReceiptRow[]>;
  listPracticeRecords(input?: { userId?: string }): Promise<TaskProgressAuditPracticeRecordRow[]>;
  listStudyTasks(input?: { userId?: string }): Promise<TaskProgressAuditTaskRow[]>;
  listStudyTaskProgress(input?: { userId?: string }): Promise<TaskProgressAuditProgressRow[]>;
  listStudyTaskCompletions(input?: { userId?: string }): Promise<TaskProgressAuditCompletionRow[]>;
  listLearningSessions?(input?: { userId?: string }): Promise<TaskProgressAuditSessionRow[]>;
}

export class PrismaTaskProgressAuditReader implements TaskProgressAuditReader {
  constructor(private readonly prisma: PrismaService) {}

  isAvailable() {
    return Boolean(process.env.DATABASE_URL);
  }

  unavailableReason() {
    return 'DATABASE_URL is not configured; Task Progress Audit Tool is disabled.';
  }

  async listAnswerReceipts(input: { userId?: string } = {}) {
    return this.prisma.answerReceipt.findMany({
      where: {
        status: 'SUCCEEDED',
        ...(input.userId ? { userId: input.userId } : {}),
      },
      select: {
        id: true,
        userId: true,
        status: true,
        practiceRecordIds: true,
      },
    });
  }

  async listPracticeRecords(input: { userId?: string } = {}) {
    return this.prisma.practiceRecord.findMany({
      where: input.userId ? { userId: input.userId } : {},
      select: {
        id: true,
        userId: true,
        questionId: true,
        knowledgePointId: true,
        correct: true,
        timeSpentSec: true,
        submittedAt: true,
        sessionId: true,
      },
    });
  }

  async listStudyTasks(input: { userId?: string } = {}) {
    const rows = await this.prisma.studyTask.findMany({
      where: input.userId ? { plan: { userId: input.userId } } : {},
      select: {
        id: true,
        knowledgePointId: true,
        questionCount: true,
        scheduledDate: true,
        status: true,
        completed: true,
        mode: true,
        nextAvailableAt: true,
        plan: { select: { userId: true } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      userId: row.plan.userId,
      knowledgePointId: row.knowledgePointId,
      questionCount: row.questionCount,
      scheduledDate: row.scheduledDate,
      status: row.status,
      completed: row.completed,
      mode: row.mode,
      nextAvailableAt: row.nextAvailableAt,
    }));
  }

  async listStudyTaskProgress(input: { userId?: string } = {}) {
    return this.prisma.studyTaskProgress.findMany({
      where: input.userId ? { userId: input.userId } : {},
      select: {
        userId: true,
        taskId: true,
        completedQuestionCount: true,
        correctCount: true,
        minutesSpent: true,
      },
    });
  }

  async listStudyTaskCompletions(input: { userId?: string } = {}) {
    return this.prisma.studyTaskCompletion.findMany({
      where: input.userId ? { userId: input.userId } : {},
      select: {
        userId: true,
        taskId: true,
        completedDate: true,
        completedQuestionCount: true,
        correctCount: true,
        minutesSpent: true,
      },
    });
  }

  async listLearningSessions(input: { userId?: string } = {}) {
    return this.prisma.learningSession.findMany({
      where: input.userId ? { userId: input.userId } : {},
      select: {
        id: true,
        userId: true,
        type: true,
        resourceId: true,
      },
    });
  }
}

export class TaskProgressAuditToolService {
  constructor(private readonly reader: TaskProgressAuditReader) {}

  async audit(input: { userId?: string; asOf?: Date | string } = {}): Promise<TaskProgressAuditResult> {
    const asOf = input.asOf ?? new Date();
    const asOfDate = studyDateKey(asOf);
    if (this.reader.isAvailable?.() === false) {
      return {
        mode: 'disabled',
        unavailableReason: this.reader.unavailableReason?.() ?? 'DATABASE_URL is unavailable; Task Progress Audit Tool is disabled.',
        generatedAt: new Date(asOf).toISOString(),
        findings: [],
        summary: {
          checkedReceipts: 0,
          checkedPracticeRecords: 0,
          findingsCount: 0,
        },
      };
    }
    const [
      receiptRows,
      records,
      tasks,
      progressRows,
      completionRows,
      sessionRows,
    ] = await Promise.all([
      this.reader.listAnswerReceipts({ userId: input.userId }),
      this.reader.listPracticeRecords({ userId: input.userId }),
      this.reader.listStudyTasks({ userId: input.userId }),
      this.reader.listStudyTaskProgress({ userId: input.userId }),
      this.reader.listStudyTaskCompletions({ userId: input.userId }),
      this.reader.listLearningSessions?.({ userId: input.userId }) ?? Promise.resolve([]),
    ]);

    const receipts = receiptRows.filter((receipt) => receipt.status === 'SUCCEEDED');
    const unsettledReceiptRecordIds = new Set(
      receiptRows
        .filter((receipt) => receipt.status !== 'SUCCEEDED')
        .flatMap((receipt) => receipt.practiceRecordIds),
    );
    const aggregateRecords = records.filter((record) => !unsettledReceiptRecordIds.has(record.id));
    const recordsById = new Map(records.map((record) => [record.id, record]));
    const tasksById = new Map(tasks.map((task) => [task.id, task]));
    const progressByTask = new Map(progressRows.map((progress) => [taskKey(progress.userId, progress.taskId), progress]));
    const completionsByTask = new Map(completionRows.map((completion) => [taskKey(completion.userId, completion.taskId), completion]));
    const sessionsById = new Map(sessionRows.map((session) => [session.id, session]));
    const findings: TaskProgressAuditFinding[] = [];

    for (const receipt of receipts) {
      if (receipt.practiceRecordIds.length === 0) {
        findings.push(emptyReceiptFinding(receipt, asOfDate));
        continue;
      }

      for (const practiceRecordId of receipt.practiceRecordIds) {
        const record = recordsById.get(practiceRecordId);
        if (!record) {
          findings.push(brokenReceiptFinding(receipt, practiceRecordId, asOfDate));
          continue;
        }
        const candidate = resolveCandidateTask(record, tasks, asOfDate);
        if (candidate.tasks.length === 0) {
          findings.push(unresolvedAttributionFinding(receipt, record, candidate.reason));
          continue;
        }
        const task = candidate.tasks[0];
        if (task.completed || task.status === 'completed') continue;
        const expectedDelta = contribution(record);
        const currentProgress = progressFor(progressByTask, record.userId, task.id);
        if (isProgressDeficit(expectedDelta, currentProgress)) {
          findings.push({
            findingType: 'MISSING_PROGRESS',
            userId: record.userId,
            receiptId: receipt.id,
            practiceRecordId: record.id,
            candidateTaskId: task.id,
            confidence: classifyRecordConfidence(record, candidate, sessionsById, asOfDate),
            reason: candidate.reason,
            expectedDelta,
            currentProgress,
            studyDate: studyDateKey(record.submittedAt),
            knowledgePointId: record.knowledgePointId,
          });
        }
      }
    }

    findings.push(...buildAggregateFindings(aggregateRecords, tasks, progressByTask, completionsByTask, sessionsById, asOfDate));
    findings.push(...buildStalledTaskFindings(aggregateRecords, tasks, progressByTask, completionsByTask, sessionsById, asOfDate));

    return {
      mode: 'available',
      generatedAt: new Date(asOf).toISOString(),
      findings: dedupeFindings(findings),
      summary: {
        checkedReceipts: receipts.length,
        checkedPracticeRecords: records.length,
        findingsCount: dedupeFindings(findings).length,
      },
    };
  }
}

interface CandidateResult {
  tasks: TaskProgressAuditTaskRow[];
  reason: string;
  usedFallback: boolean;
  multiple: boolean;
}

function resolveCandidateTask(
  record: TaskProgressAuditPracticeRecordRow,
  tasks: TaskProgressAuditTaskRow[],
  asOfDate: string,
): CandidateResult {
  const studyDate = studyDateKey(record.submittedAt);
  const base = tasks.filter((task) =>
    task.userId === record.userId
    && task.knowledgePointId === record.knowledgePointId
    && task.status !== 'completed'
    && task.completed !== true
    && task.mode !== '考后复盘'
    && !task.id.startsWith('exam-review-'));
  const scheduled = base.filter((task) => task.scheduledDate === studyDate);
  if (scheduled.length > 0) {
    return {
      tasks: scheduled,
      reason: scheduled.length > 1
        ? 'multiple candidate tasks match the current today + knowledgePointId + task state heuristic'
        : 'single active task matches the current today + knowledgePointId + task state heuristic',
      usedFallback: false,
      multiple: scheduled.length > 1,
    };
  }
  const fallback = studyDate === asOfDate
    ? base.filter((task) => task.scheduledDate === asOfDate)
    : [];
  if (fallback.length > 0) {
    return {
      tasks: fallback,
      reason: 'attribution depends on fallback or cross-day task state; current heuristic may be stale',
      usedFallback: true,
      multiple: fallback.length > 1,
    };
  }
  const completed = tasks.filter((task) =>
    task.userId === record.userId
    && task.knowledgePointId === record.knowledgePointId
    && (task.completed || task.status === 'completed'));
  if (completed.length > 0) {
    return {
      tasks: [],
      reason: 'only completed task candidates were found; audit will not create a repair candidate',
      usedFallback: false,
      multiple: completed.length > 1,
    };
  }
  return {
    tasks: [],
    reason: 'no task candidate could be inferred for the record',
    usedFallback: false,
    multiple: false,
  };
}

function classifyRecordConfidence(
  record: TaskProgressAuditPracticeRecordRow,
  candidate: CandidateResult,
  sessionsById: ReadonlyMap<string, TaskProgressAuditSessionRow>,
  asOfDate: string,
): TaskProgressAuditConfidence {
  const session = record.sessionId ? sessionsById.get(record.sessionId) : null;
  if (session && ['paper', 'stage_assessment', 'practice_set'].includes(session.type)) return 'UNKNOWN';
  if (candidate.multiple) return 'MEDIUM';
  const task = candidate.tasks[0];
  if (!task) return 'UNKNOWN';
  if (
    candidate.usedFallback
    || task.status === 'postponed'
    || task.nextAvailableAt
    || task.scheduledDate !== studyDateKey(record.submittedAt)
    || studyDateKey(record.submittedAt) !== asOfDate
  ) {
    return 'LOW';
  }
  return 'HIGH';
}

function buildAggregateFindings(
  records: TaskProgressAuditPracticeRecordRow[],
  tasks: TaskProgressAuditTaskRow[],
  progressByTask: ReadonlyMap<string, TaskProgressAuditProgressRow>,
  completionsByTask: ReadonlyMap<string, TaskProgressAuditCompletionRow>,
  sessionsById: ReadonlyMap<string, TaskProgressAuditSessionRow>,
  asOfDate: string,
): TaskProgressAuditFinding[] {
  const expectedByGroup = new Map<string, {
    userId: string;
    knowledgePointId: string;
    studyDate: string;
    expected: TaskProgressAuditDelta;
    hasSessionContext: boolean;
    lowConfidence: boolean;
  }>();

  for (const record of records) {
    const studyDate = studyDateKey(record.submittedAt);
    const candidate = resolveCandidateTask(record, tasks, asOfDate);
    if (candidate.tasks.length === 0) continue;
    const key = groupKey(record.userId, record.knowledgePointId, studyDate);
    const current = expectedByGroup.get(key) ?? {
      userId: record.userId,
      knowledgePointId: record.knowledgePointId,
      studyDate,
      expected: zeroProgress(),
      hasSessionContext: false,
      lowConfidence: false,
    };
    addInto(current.expected, contribution(record));
    current.hasSessionContext = current.hasSessionContext || isSessionLike(record, sessionsById);
    current.lowConfidence = current.lowConfidence
      || candidate.usedFallback
      || candidate.multiple
      || studyDate !== asOfDate
      || candidate.tasks.some((task) => task.status === 'postponed' || Boolean(task.nextAvailableAt));
    expectedByGroup.set(key, current);
  }

  const findings: TaskProgressAuditFinding[] = [];
  for (const group of expectedByGroup.values()) {
    const relatedTasks = tasks.filter((task) =>
      task.userId === group.userId
      && task.knowledgePointId === group.knowledgePointId
      && task.scheduledDate === group.studyDate);
    const actual = relatedTasks.reduce((sum, task) => {
      const progress = progressByTask.get(taskKey(group.userId, task.id));
      const completion = completionsByTask.get(taskKey(group.userId, task.id));
      addInto(sum, progress ?? completionProgress(task, completion));
      return sum;
    }, zeroProgress());
    if (group.expected.completedQuestionCount === actual.completedQuestionCount) continue;
    findings.push({
      findingType: 'AGGREGATE_MISMATCH',
      userId: group.userId,
      candidateTaskId: relatedTasks.length === 1 ? relatedTasks[0].id : undefined,
      confidence: group.hasSessionContext ? 'UNKNOWN' : group.lowConfidence ? 'LOW' : 'MEDIUM',
      reason: group.expected.completedQuestionCount > actual.completedQuestionCount
        ? group.hasSessionContext
          ? 'possible missed apply in aggregate path; session/paper/stage attribution cannot be proven per record'
          : 'possible missed apply: expected aggregate contribution exceeds StudyTaskProgress'
        : 'possible over-application or attribution anomaly: StudyTaskProgress exceeds expected aggregate contribution',
      expectedDelta: group.expected,
      currentProgress: actual,
      studyDate: group.studyDate,
      knowledgePointId: group.knowledgePointId,
    });
  }
  return findings;
}

function buildStalledTaskFindings(
  records: TaskProgressAuditPracticeRecordRow[],
  tasks: TaskProgressAuditTaskRow[],
  progressByTask: ReadonlyMap<string, TaskProgressAuditProgressRow>,
  completionsByTask: ReadonlyMap<string, TaskProgressAuditCompletionRow>,
  sessionsById: ReadonlyMap<string, TaskProgressAuditSessionRow>,
  asOfDate: string,
): TaskProgressAuditFinding[] {
  const findings: TaskProgressAuditFinding[] = [];
  for (const task of tasks) {
    const progress = progressByTask.get(taskKey(task.userId, task.id));
    if (!progress || progress.completedQuestionCount <= 0) continue;
    if (progress.completedQuestionCount >= task.questionCount) continue;
    if (completionsByTask.has(taskKey(task.userId, task.id))) continue;

    const relatedRecords = records.filter((record) =>
      record.userId === task.userId
      && record.knowledgePointId === task.knowledgePointId
      && studyDateKey(record.submittedAt) === task.scheduledDate);
    const siblingTasks = tasks.filter((candidate) =>
      candidate.id !== task.id
      && candidate.userId === task.userId
      && candidate.knowledgePointId === task.knowledgePointId
      && candidate.scheduledDate === task.scheduledDate);
    const completedSiblingCount = siblingTasks.reduce((sum, sibling) => {
      const completion = completionsByTask.get(taskKey(sibling.userId, sibling.id));
      return sum + (completion?.completedQuestionCount ?? (sibling.completed || sibling.status === 'completed' ? sibling.questionCount : 0));
    }, 0);
    const attributableRecords = relatedRecords.slice(completedSiblingCount);
    if (attributableRecords.length <= progress.completedQuestionCount) continue;
    const expected = attributableRecords.reduce((sum, record) => {
      addInto(sum, contribution(record));
      return sum;
    }, zeroProgress());
    findings.push({
      findingType: 'STALLED_TASK',
      userId: task.userId,
      candidateTaskId: task.id,
      confidence: siblingTasks.length > 0 || relatedRecords.some((record) => isSessionLike(record, sessionsById)) ? 'MEDIUM' : 'HIGH',
      reason: siblingTasks.length > 0
        ? 'StudyTaskProgress is partial, but same-day sibling tasks share the knowledge point; completed sibling metrics were deducted before flagging'
        : 'StudyTaskProgress is partial, no StudyTaskCompletion exists, and related PracticeRecord count exceeds current progress',
      expectedDelta: expected,
      currentProgress: {
        completedQuestionCount: progress.completedQuestionCount,
        correctCount: progress.correctCount,
        minutesSpent: progress.minutesSpent,
      },
      studyDate: task.scheduledDate,
      knowledgePointId: task.knowledgePointId,
    });
  }
  return findings;
}

function emptyReceiptFinding(receipt: TaskProgressAuditReceiptRow, asOfDate: string): TaskProgressAuditFinding {
  return {
    findingType: 'EMPTY_RECEIPT',
    userId: receipt.userId,
    receiptId: receipt.id,
    confidence: 'UNKNOWN',
    reason: 'succeeded receipt has no practiceRecordIds',
    expectedDelta: zeroProgress(),
    currentProgress: zeroProgress(),
    studyDate: asOfDate,
    knowledgePointId: '',
  };
}

function brokenReceiptFinding(
  receipt: TaskProgressAuditReceiptRow,
  practiceRecordId: string,
  asOfDate: string,
): TaskProgressAuditFinding {
  return {
    findingType: 'BROKEN_RECEIPT',
    userId: receipt.userId,
    receiptId: receipt.id,
    practiceRecordId,
    confidence: 'UNKNOWN',
    reason: 'succeeded receipt references a PracticeRecord that does not exist',
    expectedDelta: zeroProgress(),
    currentProgress: zeroProgress(),
    studyDate: asOfDate,
    knowledgePointId: '',
  };
}

function unresolvedAttributionFinding(
  receipt: TaskProgressAuditReceiptRow,
  record: TaskProgressAuditPracticeRecordRow,
  reason: string,
): TaskProgressAuditFinding {
  return {
    findingType: 'UNRESOLVED_ATTRIBUTION',
    userId: record.userId,
    receiptId: receipt.id,
    practiceRecordId: record.id,
    confidence: 'UNKNOWN',
    reason,
    expectedDelta: contribution(record),
    currentProgress: zeroProgress(),
    studyDate: studyDateKey(record.submittedAt),
    knowledgePointId: record.knowledgePointId,
  };
}

function isProgressDeficit(expected: TaskProgressAuditDelta, current: TaskProgressAuditDelta) {
  return current.completedQuestionCount < expected.completedQuestionCount
    || current.correctCount < expected.correctCount
    || current.minutesSpent < expected.minutesSpent;
}

function contribution(record: TaskProgressAuditPracticeRecordRow): TaskProgressAuditDelta {
  return {
    completedQuestionCount: 1,
    correctCount: record.correct ? 1 : 0,
    minutesSpent: Math.max(1, Math.round(record.timeSpentSec / 60)),
  };
}

function completionProgress(
  task: TaskProgressAuditTaskRow,
  completion?: TaskProgressAuditCompletionRow,
): TaskProgressAuditDelta {
  if (!completion) return zeroProgress();
  return {
    completedQuestionCount: completion.completedQuestionCount ?? task.questionCount,
    correctCount: completion.correctCount ?? 0,
    minutesSpent: completion.minutesSpent ?? 0,
  };
}

function progressFor(
  progressByTask: ReadonlyMap<string, TaskProgressAuditProgressRow>,
  userId: string,
  taskId: string,
): TaskProgressAuditDelta {
  const progress = progressByTask.get(taskKey(userId, taskId));
  return progress
    ? {
        completedQuestionCount: progress.completedQuestionCount,
        correctCount: progress.correctCount,
        minutesSpent: progress.minutesSpent,
      }
    : zeroProgress();
}

function isSessionLike(
  record: TaskProgressAuditPracticeRecordRow,
  sessionsById: ReadonlyMap<string, TaskProgressAuditSessionRow>,
) {
  if (!record.sessionId) return false;
  const session = sessionsById.get(record.sessionId);
  return !session || ['paper', 'stage_assessment', 'practice_set'].includes(session.type);
}

function zeroProgress(): TaskProgressAuditDelta {
  return { completedQuestionCount: 0, correctCount: 0, minutesSpent: 0 };
}

function addInto(target: TaskProgressAuditDelta, source: TaskProgressAuditDelta) {
  target.completedQuestionCount += source.completedQuestionCount;
  target.correctCount += source.correctCount;
  target.minutesSpent += source.minutesSpent;
}

function taskKey(userId: string, taskId: string) {
  return `${userId}:${taskId}`;
}

function groupKey(userId: string, knowledgePointId: string, studyDate: string) {
  return `${userId}:${knowledgePointId}:${studyDate}`;
}

function dedupeFindings(findings: TaskProgressAuditFinding[]) {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = [
      finding.findingType,
      finding.userId,
      finding.receiptId ?? '',
      finding.practiceRecordId ?? '',
      finding.candidateTaskId ?? '',
      finding.studyDate,
      finding.knowledgePointId,
    ].join('|');
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
