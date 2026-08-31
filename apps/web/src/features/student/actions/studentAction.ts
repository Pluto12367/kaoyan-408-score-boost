export type StudentActionType =
  | 'today_task'
  | 'review_due'
  | 'redo_wrong_question'
  | 'practice_recommended'
  | 'knowledge_explore'
  | 'knowledge_quest'
  | 'assessment_review'
  | 'assessment_wrong_questions'
  | 'assessment_practice'
  | 'continue_session'
  | 'open_report'
  | 'coach_explain';

export type StudentActionSource =
  | 'today-plan'
  | 'review-due'
  | 'wrong-summary'
  | 'mastery-map'
  | 'knowledge'
  | 'assessment'
  | 'session'
  | 'training'
  | 'report'
  | 'coach';

export type StudentActionDestination = 'home' | 'practice' | 'knowledge' | 'review' | 'test' | 'ai';

type ActionBase<T extends StudentActionType, D extends StudentActionDestination, S extends StudentActionSource, C> = {
  id: string;
  type: T;
  title: string;
  destination: D;
  source: S;
  reason?: string;
  priority?: number;
  context: C;
};

export type StudentAction =
  | ActionBase<'today_task', 'practice' | 'review' | 'test', 'today-plan', { taskId: string; knowledgeNodeId?: string; questionId?: string }>
  | ActionBase<'review_due', 'review', 'review-due', { questionId: string }>
  | ActionBase<'redo_wrong_question', 'practice' | 'review', 'wrong-summary', { questionId: string }>
  | ActionBase<'practice_recommended', 'practice', 'mastery-map' | 'training', { questionId: string; knowledgeNodeId?: string; taskId?: string } | { questionId?: string; knowledgeNodeId: string; taskId?: string } | { questionId?: string; knowledgeNodeId?: string; taskId: string }>
  | ActionBase<'knowledge_explore', 'knowledge', 'knowledge' | 'mastery-map', { knowledgeNodeId: string }>
  | ActionBase<'knowledge_quest', 'knowledge' | 'practice', 'knowledge', { knowledgeNodeId: string; questionIds?: string[] }>
  | ActionBase<'assessment_review', 'review' | 'test', 'assessment', { assessmentId: string; questionId?: string }>
  | ActionBase<'assessment_wrong_questions', 'review' | 'practice', 'assessment', { assessmentId: string; questionId?: string }>
  | ActionBase<'assessment_practice', 'practice' | 'test', 'assessment', { assessmentId: string; questionId?: string }>
  | ActionBase<'continue_session', 'practice' | 'test', 'session', { sessionId: string }>
  | ActionBase<'open_report', 'home' | 'review', 'report' | 'assessment', { reportId: string; assessmentId?: string } | { reportId?: string; assessmentId: string }>
  | ActionBase<'coach_explain', 'ai', 'coach', { questionId: string; knowledgeNodeId?: string; wrongQuestionId?: string; assessmentId?: string } | { questionId?: string; knowledgeNodeId: string; wrongQuestionId?: string; assessmentId?: string } | { questionId?: string; knowledgeNodeId?: string; wrongQuestionId: string; assessmentId?: string } | { questionId?: string; knowledgeNodeId?: string; wrongQuestionId?: string; assessmentId: string }>;

const ACTION_TYPES = new Set<StudentActionType>([
  'today_task', 'review_due', 'redo_wrong_question', 'practice_recommended',
  'knowledge_explore', 'knowledge_quest', 'assessment_review',
  'assessment_wrong_questions', 'assessment_practice', 'continue_session',
  'open_report', 'coach_explain',
]);

const DESTINATIONS = new Set<StudentActionDestination>(['home', 'practice', 'knowledge', 'review', 'test', 'ai']);
const SOURCES = new Set<StudentActionSource>([
  'today-plan', 'review-due', 'wrong-summary', 'mastery-map', 'knowledge',
  'assessment', 'session', 'training', 'report', 'coach',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function hasId(context: Record<string, unknown>, key: string): boolean {
  return isNonEmptyString(context[key]);
}

function isPureData(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value !== 'object' || seen.has(value)) return false;
  if (value instanceof Promise || Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isPureData(item, seen));
  return Object.entries(value).every(([key, item]) => {
    if (/api|client|repo|repository|persistence|prisma|database|service/i.test(key)) return false;
    return isPureData(item, seen);
  });
}

export function isStudentAction(value: unknown): value is StudentAction {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || !ACTION_TYPES.has(value.type as StudentActionType)
    || !isNonEmptyString(value.title)
    || !DESTINATIONS.has(value.destination as StudentActionDestination)
    || !SOURCES.has(value.source as StudentActionSource)
    || (value.reason !== undefined && typeof value.reason !== 'string')
    || (value.priority !== undefined && typeof value.priority !== 'number')
    || !isRecord(value.context)
    || !isPureData(value.context)) return false;

  const context = value.context;
  switch (value.type) {
    case 'today_task': return hasId(context, 'taskId');
    case 'review_due':
    case 'redo_wrong_question': return hasId(context, 'questionId');
    case 'practice_recommended': return hasId(context, 'questionId') || hasId(context, 'knowledgeNodeId') || hasId(context, 'taskId');
    case 'knowledge_explore':
    case 'knowledge_quest': return hasId(context, 'knowledgeNodeId');
    case 'assessment_review':
    case 'assessment_wrong_questions':
    case 'assessment_practice': return hasId(context, 'assessmentId');
    case 'continue_session': return hasId(context, 'sessionId');
    case 'open_report': return hasId(context, 'reportId') || hasId(context, 'assessmentId');
    case 'coach_explain': return hasId(context, 'questionId') || hasId(context, 'knowledgeNodeId') || hasId(context, 'wrongQuestionId') || hasId(context, 'assessmentId');
  }
}
