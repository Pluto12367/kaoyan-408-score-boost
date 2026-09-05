/**
 * Coach Session (Phase PX-1) — pure session-model functions.
 *
 * Design Gate decision: the conversation session persists in the existing
 * RuntimeState key/value table (key = coach-session:{userId}) — no schema
 * change, no new fact source. A session stores ONLY dialogue-derived state
 * (summary, goals, unresolved issues, bounded recent messages); it never
 * copies learning facts (mastery/review/plan stay in StudentContext) and is
 * rebuildable from the dialogue at any time.
 *
 * Layering (mission contract):
 * - short-term  : bounded recent messages in this session
 * - mid-term    : Learning Memory (injected by the caller, not stored here)
 * - long-term   : StudentContext (never duplicated here)
 */

export interface CoachSessionMessage {
  role: 'student' | 'coach';
  content: string;
  at: string;
}

export interface CoachConversationSession {
  sessionId: string;
  userId: string;
  createdAt: string;
  lastActiveAt: string;
  summary: string;
  goals: string[];
  unresolvedIssues: string[];
  recentMessages: CoachSessionMessage[];
  /** Monotonic compression counter — how many times history was folded. */
  compressions: number;
}

export interface ConversationSummary {
  summary: string;
  goals: string[];
  unresolvedIssues: string[];
  keptMessages: CoachSessionMessage[];
  foldedMessages: number;
  /** Rough token estimate of the retained dialogue (chars/4 heuristic). */
  estimatedTokens: number;
}

/** Hard bounds: keeps the prompt-side session payload ~< 1k tokens. */
export const MAX_SESSION_MESSAGES = 12;
export const MAX_MESSAGE_CHARS = 500;
const MAX_GOALS = 5;
const MAX_UNRESOLVED = 5;

function estimateTokens(messages: readonly CoachSessionMessage[]): number {
  const chars = messages.reduce((sum, message) => sum + message.content.length, 0);
  return Math.ceil(chars / 4);
}

function clampMessage(content: string): string {
  return content.trim().slice(0, MAX_MESSAGE_CHARS);
}

/**
 * Append a student/coach turn and compress when the bounded window
 * overflows. Deterministic: folded messages are distilled into the
 * summary/goals/unresolved lists by rule extraction (no LLM required).
 *
 * Goal/unresolved extraction rules:
 * - student messages containing 学/考/复习/计划/提高/安排 seed goals;
 * - student questions (ending with ？or ?) and messages containing
 *   不懂/不会/不明白/还是/仍然 stay unresolved until a coach turn marks
 *   them resolved (not modeled here — compression keeps them visible).
 */
export function appendAndCompress(
  session: CoachConversationSession | null,
  userId: string,
  studentMessage: string,
  coachReplyDigest: string,
  now: string,
): { session: CoachConversationSession; summary: ConversationSummary } {
  const base: CoachConversationSession = session ?? {
    sessionId: createSessionId(now),
    userId,
    createdAt: now,
    lastActiveAt: now,
    summary: '',
    goals: [],
    unresolvedIssues: [],
    recentMessages: [],
    compressions: 0,
  };

  const appended: CoachSessionMessage[] = [
    { role: 'student', content: clampMessage(studentMessage), at: now },
    { role: 'coach', content: clampMessage(coachReplyDigest), at: now },
  ];
  let recentMessages = [...base.recentMessages, ...appended];

  // Compress while over budget.
  let summary = base.summary;
  let goals = [...base.goals];
  let unresolvedIssues = [...base.unresolvedIssues];
  let compressions = base.compressions;
  let foldedMessages = 0;

  while (recentMessages.length > MAX_SESSION_MESSAGES) {
    const foldCount = recentMessages.length - MAX_SESSION_MESSAGES;
    const folded = recentMessages.slice(0, foldCount);
    recentMessages = recentMessages.slice(foldCount);
    foldedMessages += folded.length;
    compressions += 1;

    for (const message of folded) {
      if (message.role !== 'student') continue;
      const text = message.content;
      if (GOAL_PATTERN.test(text)) {
        goals = pushUnique(goals, text, MAX_GOALS);
      }
      if (QUESTION_PATTERN.test(text) || CONFUSION_PATTERN.test(text)) {
        unresolvedIssues = pushUnique(unresolvedIssues, text, MAX_UNRESOLVED);
      }
    }
    summary = foldSummary(summary, folded);
  }

  const updated: CoachConversationSession = {
    ...base,
    lastActiveAt: now,
    summary,
    goals,
    unresolvedIssues,
    recentMessages,
    compressions,
  };

  return {
    session: updated,
    summary: {
      summary,
      goals,
      unresolvedIssues,
      keptMessages: recentMessages,
      foldedMessages,
      estimatedTokens: estimateTokens(recentMessages),
    },
  };
}

/** Compact brief rendered into the coach prompt (bounded). */
export function buildSessionBrief(session: CoachConversationSession): string {
  const parts: string[] = [];
  if (session.summary) parts.push(`此前对话要点：${session.summary}`);
  if (session.goals.length > 0) parts.push(`学生目标：${session.goals.join('；')}`);
  if (session.unresolvedIssues.length > 0) parts.push(`未解决问题：${session.unresolvedIssues.join('；')}`);
  const lastStudent = [...session.recentMessages].reverse().find((message) => message.role === 'student');
  if (lastStudent) parts.push(`学生最近说：“${lastStudent.content}”`);
  return parts.join('。').slice(0, 900);
}

export function createSessionId(now: string): string {
  // Deterministic-friendly: timestamp + counter-free; uniqueness comes from
  // millisecond precision + the per-user storage key.
  return `coach-${now.replace(/[-:.TZ]/g, '').slice(0, 14)}`;
}

const GOAL_PATTERN = /(学会|掌握|提高|安排|计划|复习|备考|目标|准备考)/;
const QUESTION_PATTERN = /[？?]\s*$/;
const CONFUSION_PATTERN = /(不懂|不会|不明白|搞不懂|还是不明白|仍然|又错)/;

function pushUnique(list: string[], value: string, max: number): string[] {
  const clean = value.trim();
  if (!clean || list.includes(clean)) return list;
  return [...list, clean].slice(-max);
}

function foldSummary(previous: string, folded: readonly CoachSessionMessage[]): string {
  const digest = folded
    .filter((message) => message.role === 'student')
    .map((message) => message.content.slice(0, 40))
    .join('；');
  const merged = previous ? `${previous}；${digest}` : digest;
  return merged.slice(-400);
}

/**
 * Personalized system-prompt addendum (Prompt V2). Pure function so the
 * four contract sections stay testable; the base guardrail prompt is owned
 * by contextual-coach.prompt.ts and always prepended by the caller.
 */
export interface PersonalizedPromptInput {
  studentProfile: { stage?: string | null; weakestSubject?: string | null; targetScore?: number | null };
  learningMemory: { weakTitles?: readonly string[]; streakDays?: number | null };
  recentBehavior: { recentAccuracyPercent?: number | null; dueReviews?: number | null; openTaskTitles?: readonly string[] };
  currentGoal?: string | null;
}

export function buildPersonalizedPromptSections(input: PersonalizedPromptInput): string {
  const lines: string[] = [];
  const profile = input.studentProfile;
  const profileBits: string[] = [];
  if (profile.stage) profileBits.push(`阶段 ${profile.stage}`);
  if (profile.weakestSubject) profileBits.push(`最弱科目 ${profile.weakestSubject}`);
  if (profile.targetScore != null) profileBits.push(`目标 ${profile.targetScore} 分`);
  if (profileBits.length > 0) lines.push(`student_profile：${profileBits.join('，')}`);

  const memory = input.learningMemory;
  const memoryBits: string[] = [];
  if (memory.weakTitles?.length) memoryBits.push(`近期薄弱：${memory.weakTitles.join('、')}`);
  if (memory.streakDays) memoryBits.push(`连续学习 ${memory.streakDays} 天`);
  if (memoryBits.length > 0) lines.push(`learning_memory：${memoryBits.join('；')}`);

  const behavior = input.recentBehavior;
  const behaviorBits: string[] = [];
  if (behavior.recentAccuracyPercent != null) behaviorBits.push(`近7天正确率 ${behavior.recentAccuracyPercent}%`);
  if (behavior.dueReviews != null) behaviorBits.push(`到期复习 ${behavior.dueReviews} 项`);
  if (behavior.openTaskTitles?.length) behaviorBits.push(`今日任务：${behavior.openTaskTitles.join('、')}`);
  if (behaviorBits.length > 0) lines.push(`recent_behavior：${behaviorBits.join('；')}`);

  if (input.currentGoal) lines.push(`current_goal：${input.currentGoal}`);
  lines.push('结合以上个性化背景解释，但引用时只使用已提供的事实，不得虚构。');
  return lines.join('\n');
}