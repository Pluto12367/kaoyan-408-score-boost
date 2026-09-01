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
  | 'wrong-summary-fallback'
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
  priority?: number | string;
  context: C;
};

export type StudentAction =
  | ActionBase<'today_task', 'home' | 'practice' | 'review' | 'test', 'today-plan', { taskId: string; knowledgeNodeId?: string; questionId?: string }>
  | ActionBase<'review_due', 'review', 'review-due', { questionId: string }>
  | ActionBase<'redo_wrong_question', 'practice' | 'review', 'wrong-summary' | 'wrong-summary-fallback', { questionId: string }>
  | ActionBase<'practice_recommended', 'practice', 'mastery-map' | 'training', { questionId: string; knowledgeNodeId?: string; taskId?: string } | { questionId?: string; knowledgeNodeId: string; taskId?: string } | { questionId?: string; knowledgeNodeId?: string; taskId: string }>
  | ActionBase<'knowledge_explore', 'knowledge', 'knowledge' | 'mastery-map', { knowledgeNodeId: string }>
  | ActionBase<'knowledge_quest', 'knowledge' | 'practice', 'knowledge', { knowledgeNodeId: string; questionIds?: string[] }>
  | ActionBase<'assessment_review', 'test', 'assessment', { assessmentId: string; questionId?: string }>
  | ActionBase<'assessment_wrong_questions', 'review' | 'practice', 'assessment', { assessmentId: string; questionId?: string }>
  | ActionBase<'assessment_practice', 'practice' | 'test', 'assessment', { assessmentId: string; questionId?: string }>
  | ActionBase<'continue_session', 'practice' | 'test', 'session', { sessionId: string }>
  | ActionBase<'open_report', 'test', 'report' | 'assessment', { reportId: string; assessmentId?: string } | { reportId?: string; assessmentId: string }>
  | ActionBase<'coach_explain', 'ai', 'coach', { questionId: string; knowledgeNodeId?: string; wrongQuestionId?: string; assessmentId?: string } | { questionId?: string; knowledgeNodeId: string; wrongQuestionId?: string; assessmentId?: string } | { questionId?: string; knowledgeNodeId?: string; wrongQuestionId: string; assessmentId?: string } | { questionId?: string; knowledgeNodeId?: string; wrongQuestionId?: string; assessmentId: string }>;

const ACTION_TYPES = new Set<StudentActionType>([
  'today_task', 'review_due', 'redo_wrong_question', 'practice_recommended',
  'knowledge_explore', 'knowledge_quest', 'assessment_review',
  'assessment_wrong_questions', 'assessment_practice', 'continue_session',
  'open_report', 'coach_explain',
]);

const DESTINATIONS = new Set<StudentActionDestination>(['home', 'practice', 'knowledge', 'review', 'test', 'ai']);
const SOURCES = new Set<StudentActionSource>([
  'today-plan', 'review-due', 'wrong-summary', 'wrong-summary-fallback', 'mastery-map', 'knowledge',
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

function hasOptionalId(context: Record<string, unknown>, key: string): boolean {
  return !Object.prototype.hasOwnProperty.call(context, key) || isNonEmptyString(context[key]);
}

function hasOptionalStringArray(context: Record<string, unknown>, key: string): boolean {
  return !Object.prototype.hasOwnProperty.call(context, key)
    || Array.isArray(context[key]) && context[key].every((item) => isNonEmptyString(item));
}

function hasAnyId(context: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.some((key) => hasId(context, key));
}

function isValidContext(
  context: Record<string, unknown>,
  requiredIds: readonly string[],
  anyRequiredIds: readonly string[] = [],
  optionalIds: readonly string[] = [],
  optionalStringArrays: readonly string[] = [],
): boolean {
  return requiredIds.every((key) => hasId(context, key))
    && (anyRequiredIds.length === 0 || hasAnyId(context, anyRequiredIds))
    && optionalIds.every((key) => hasOptionalId(context, key))
    && optionalStringArrays.every((key) => hasOptionalStringArray(context, key));
}

function isPureData(value: unknown, seen = new Set<unknown>()): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true;
  if (typeof value !== 'object' || seen.has(value)) return false;
  if (value instanceof Promise || Object.getPrototypeOf(value) !== Object.prototype && !Array.isArray(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.every((item) => isPureData(item, seen));
  return Object.entries(value).every(([key, item]) => {
    if (/^(api|client|repo|repository|persistence|prisma|database|service)$/i.test(key)) return false;
    return isPureData(item, seen);
  });
}

function matchesActionBoundary(type: StudentActionType, destination: StudentActionDestination, source: StudentActionSource): boolean {
  if (type === 'coach_explain') return destination === 'ai' && source === 'coach';
  if (destination === 'ai' || source === 'coach') return false;
  switch (type) {
    case 'today_task': return destination === 'home' || destination === 'practice' || destination === 'review' || destination === 'test' ? source === 'today-plan' : false;
    case 'review_due': return destination === 'review' && source === 'review-due';
    case 'redo_wrong_question': return (destination === 'practice' || destination === 'review') && (source === 'wrong-summary' || source === 'wrong-summary-fallback');
    case 'practice_recommended': return destination === 'practice' && (source === 'mastery-map' || source === 'training');
    case 'knowledge_explore': return destination === 'knowledge' && (source === 'knowledge' || source === 'mastery-map');
    case 'knowledge_quest': return (destination === 'knowledge' || destination === 'practice') && source === 'knowledge';
    case 'assessment_review': return destination === 'test' && source === 'assessment';
    case 'assessment_wrong_questions': return (destination === 'review' || destination === 'practice') && source === 'assessment';
    case 'assessment_practice': return (destination === 'practice' || destination === 'test') && source === 'assessment';
    case 'continue_session': return (destination === 'practice' || destination === 'test') && source === 'session';
    case 'open_report': return destination === 'test' && (source === 'report' || source === 'assessment');
  }
  return false;
}

export function isStudentAction(value: unknown): value is StudentAction {
  if (!isRecord(value)
    || !isNonEmptyString(value.id)
    || !ACTION_TYPES.has(value.type as StudentActionType)
    || !isNonEmptyString(value.title)
    || !DESTINATIONS.has(value.destination as StudentActionDestination)
    || !SOURCES.has(value.source as StudentActionSource)
    || !matchesActionBoundary(value.type as StudentActionType, value.destination as StudentActionDestination, value.source as StudentActionSource)
    || (value.reason !== undefined && typeof value.reason !== 'string')
    || (value.priority !== undefined && typeof value.priority !== 'number' && typeof value.priority !== 'string')
    || !isRecord(value.context)
    || !isPureData(value.context)) return false;

  const context = value.context;
  switch (value.type) {
    case 'today_task': return isValidContext(context, ['taskId'], [], ['knowledgeNodeId', 'questionId']);
    case 'review_due':
    case 'redo_wrong_question': return isValidContext(context, ['questionId']);
    case 'practice_recommended': return isValidContext(context, [], ['questionId', 'knowledgeNodeId', 'taskId'], ['questionId', 'knowledgeNodeId', 'taskId']);
    case 'knowledge_explore': return isValidContext(context, ['knowledgeNodeId']);
    case 'knowledge_quest': return isValidContext(context, ['knowledgeNodeId'], [], [], ['questionIds']);
    case 'assessment_review':
    case 'assessment_wrong_questions':
    case 'assessment_practice': return isValidContext(context, ['assessmentId'], [], ['questionId']);
    case 'continue_session': return isValidContext(context, ['sessionId']);
    case 'open_report': return isValidContext(context, [], ['reportId', 'assessmentId'], ['reportId', 'assessmentId']);
    case 'coach_explain': return isValidContext(context, [], ['questionId', 'knowledgeNodeId', 'wrongQuestionId', 'assessmentId'], ['questionId', 'knowledgeNodeId', 'wrongQuestionId', 'assessmentId']);
  }
  return false;
}
