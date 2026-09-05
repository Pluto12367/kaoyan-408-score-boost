/**
 * Learning Memory (Phase AI-7) — pure derivation layer.
 *
 * Sources: EXCLUSIVELY the canonical StudentContext read model. Practice,
 * wrong-question, review and plan facts are already aggregated there; the
 * memory layer re-frames them for the agent rather than becoming a second
 * state model (never a source of truth, never persisted, fully rebuildable
 * from StudentContext at any time).
 *
 * Layers:
 * - shortTerm: current learning tasks (today's open tasks + live session)
 * - midTerm: recent weak knowledge (weak/improving nodes, high-risk reviews)
 * - longTerm: historical learning patterns (streak, trends, subject mix, goal)
 *
 * Known gap (recorded, intentional): assessment history is not carried by
 * StudentContext v1 (assessment facts are deliberately not part of the
 * contract), so longTerm patterns exclude assessment scores until the
 * contract evolves. Reading assessment tables directly here would bypass
 * the canonical entry — rejected by design.
 */

export interface MemoryTask {
  studyTaskId: string;
  title: string;
  status: string;
  knowledgeNodeId: string | null;
  minutes: number;
}

export interface MemoryWeakNode {
  knowledgeNodeId: string;
  subject: string;
  title: string;
  mastery: number;
  attempts: number;
}

export interface MemoryHighRiskQuestion {
  questionId: string;
  wrongCount: number;
  overdue: boolean;
}

export interface LearningMemory {
  userId: string;
  derivedAt: string;
  shortTerm: {
    openTasks: readonly MemoryTask[];
    completedToday: number;
    liveSession: { learningSessionId: string; type: string; lastActiveAt: string } | null;
  };
  midTerm: {
    weakNodes: readonly MemoryWeakNode[];
    improvingNodes: readonly MemoryWeakNode[];
    highRiskQuestions: readonly MemoryHighRiskQuestion[];
    dueCount: number;
    overdueCount: number;
  };
  longTerm: {
    studyStreak: number;
    recentAccuracy: { status: string; value: number | null };
    topSubjects: readonly { subject: string; count: number }[];
    examGoal: {
      targetScore: number | null;
      currentScore: number | null;
      remainingDays: number | null;
      stage: string | null;
      weakestSubject: string | null;
    };
  };
}

const MAX_OPEN_TASKS = 5;
const MAX_WEAK_NODES = 3;
const MAX_HIGH_RISK = 3;
const MAX_SUBJECTS = 3;

/**
 * Derive the three-layer learning memory from a canonical StudentContext.
 * Pure function: same context → same memory (rebuildable, testable).
 */
export function buildLearningMemoryFromContext(context: {
  userId: string;
  asOf: string;
  exam?: { targetScore?: number | null; currentScore?: number | null; remainingDays?: number | null; studyStage?: string | null };
  profile?: { weakestSubject?: string | null };
  mastery?: {
    weakNodes?: readonly { knowledgeNodeId: string; subject: string; title: string; mastery: number; attempts: number }[];
    improvingPoints?: readonly { knowledgeNodeId: string; subject: string; title: string; mastery: number; attempts: number }[];
  };
  practice?: {
    recentAccuracy?: { status?: string; value?: number | null };
    subjectDistribution?: { items?: readonly { subject: string; count: number }[] };
  };
  review?: {
    dueCount?: number;
    overdueCount?: number;
    highRiskQuestions?: readonly { questionId: string; wrongCount: number; overdue: boolean }[];
  };
  plan?: {
    todayTasks?: readonly {
      studyTaskId: string; title: string; status: string; completed: boolean; knowledgeNodeId?: string | null; minutes: number;
    }[];
  };
  momentum?: {
    studyStreak?: number;
    recentSessions?: readonly { learningSessionId: string; type: string; lastActiveAt: string; completed: boolean }[];
  };
}): LearningMemory {
  const todayTasks = context.plan?.todayTasks ?? [];
  const openTasks = todayTasks
    .filter((task) => !task.completed && (task.status === 'pending' || task.status === 'in_progress'))
    .slice(0, MAX_OPEN_TASKS)
    .map((task) => ({
      studyTaskId: task.studyTaskId,
      title: task.title,
      status: task.status,
      knowledgeNodeId: task.knowledgeNodeId ?? null,
      minutes: task.minutes,
    }));
  const completedToday = todayTasks.filter((task) => task.completed).length;
  const liveSessionRaw = (context.momentum?.recentSessions ?? []).find((session) => !session.completed);
  const liveSession = liveSessionRaw
    ? { learningSessionId: liveSessionRaw.learningSessionId, type: liveSessionRaw.type, lastActiveAt: liveSessionRaw.lastActiveAt }
    : null;

  const toWeakNodes = (nodes: readonly { knowledgeNodeId: string; subject: string; title: string; mastery: number; attempts: number }[]) =>
    nodes.slice(0, MAX_WEAK_NODES).map((node) => ({
      knowledgeNodeId: node.knowledgeNodeId,
      subject: node.subject,
      title: node.title,
      mastery: round4(node.mastery),
      attempts: node.attempts,
    }));

  const highRiskQuestions = [...(context.review?.highRiskQuestions ?? [])]
    .sort((left, right) => right.wrongCount - left.wrongCount)
    .slice(0, MAX_HIGH_RISK)
    .map((item) => ({ questionId: item.questionId, wrongCount: item.wrongCount, overdue: item.overdue }));

  const topSubjects = [...(context.practice?.subjectDistribution?.items ?? [])]
    .sort((left, right) => right.count - left.count)
    .slice(0, MAX_SUBJECTS)
    .map((item) => ({ subject: item.subject, count: item.count }));

  return {
    userId: context.userId,
    derivedAt: context.asOf,
    shortTerm: {
      openTasks,
      completedToday,
      liveSession,
    },
    midTerm: {
      weakNodes: toWeakNodes(context.mastery?.weakNodes ?? []),
      improvingNodes: toWeakNodes(context.mastery?.improvingPoints ?? []),
      highRiskQuestions,
      dueCount: context.review?.dueCount ?? 0,
      overdueCount: context.review?.overdueCount ?? 0,
    },
    longTerm: {
      studyStreak: context.momentum?.studyStreak ?? 0,
      recentAccuracy: {
        status: context.practice?.recentAccuracy?.status ?? 'insufficient_data',
        value: context.practice?.recentAccuracy?.value ?? null,
      },
      topSubjects,
      examGoal: {
        targetScore: context.exam?.targetScore ?? null,
        currentScore: context.exam?.currentScore ?? null,
        remainingDays: context.exam?.remainingDays ?? null,
        stage: context.exam?.studyStage ?? null,
        weakestSubject: context.profile?.weakestSubject ?? null,
      },
    },
  };
}

/**
 * Compact bounded text rendering for LLM prompt injection.
 * Deterministic; safe to embed in the agent system prompt.
 */
export function buildMemoryBrief(memory: LearningMemory): string {
  const parts: string[] = [];
  const tasks = memory.shortTerm.openTasks.map((task) => task.title).join('、');
  parts.push(tasks ? `今日待完成任务：${tasks}` : '今日暂无待完成任务');
  if (memory.shortTerm.completedToday > 0) parts.push(`今日已完成 ${memory.shortTerm.completedToday} 项`);
  const weak = memory.midTerm.weakNodes.map((node) => node.title).join('、');
  if (weak) parts.push(`近期薄弱知识点：${weak}`);
  if (memory.midTerm.improvingNodes.length > 0) {
    parts.push(`进步中知识点：${memory.midTerm.improvingNodes.map((node) => node.title).join('、')}`);
  }
  if (memory.midTerm.dueCount > 0) parts.push(`到期复习 ${memory.midTerm.dueCount} 项（逾期 ${memory.midTerm.overdueCount}）`);
  if (memory.longTerm.studyStreak > 0) parts.push(`连续学习 ${memory.longTerm.studyStreak} 天`);
  if (memory.longTerm.recentAccuracy.status === 'sufficient' && memory.longTerm.recentAccuracy.value != null) {
    parts.push(`近7天正确率 ${Math.round(memory.longTerm.recentAccuracy.value * 100)}%`);
  }
  if (memory.longTerm.topSubjects.length > 0) {
    parts.push(`近期练习重心：${memory.longTerm.topSubjects.map((item) => item.subject).join('/')}`);
  }
  const goal = memory.longTerm.examGoal;
  if (goal.targetScore != null || goal.remainingDays != null) {
    const goalParts: string[] = [];
    if (goal.targetScore != null) goalParts.push(`目标 ${goal.targetScore} 分`);
    if (goal.currentScore != null) goalParts.push(`当前 ${goal.currentScore} 分`);
    if (goal.remainingDays != null) goalParts.push(`剩 ${goal.remainingDays} 天`);
    if (goal.stage) goalParts.push(`阶段 ${goal.stage}`);
    parts.push(`备考：${goalParts.join('，')}`);
  }
  return parts.join('；').slice(0, 900);
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}