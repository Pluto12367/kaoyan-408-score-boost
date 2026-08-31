import type {
  TrainingRoomResult,
  TrainingRoomViewModel,
} from '../../../practice/training-room/trainingRoomViewModel';
import type { StudentAction, StudentActionType } from '../studentAction';

type StructuredTrainingAction = Extract<
  StudentActionType,
  'practice_recommended' | 'redo_wrong_question' | 'open_report' | 'review_due'
>;

const STRUCTURED_TRAINING_ACTIONS: readonly StructuredTrainingAction[] = [
  'practice_recommended', 'redo_wrong_question', 'open_report', 'review_due',
];

export interface TrainingActionInput {
  sourceId: string;
  source: TrainingRoomViewModel['source'];
  nextActions?: readonly TrainingRoomResult['nextActions'][number][];
  actionType?: StructuredTrainingAction;
  questionId?: string;
  reviewDueQuestionId?: string;
  wrongQuestionId?: string;
  knowledgeNodeId?: string;
  taskId?: string;
  reportId?: string;
  assessmentId?: string;
}

export function buildTrainingActions(input: TrainingActionInput): StudentAction[] {
  if (!isRealId(input.sourceId)) return [];

  if (input.actionType !== undefined && !isStructuredTrainingAction(input.actionType)) return [];
  const actionType = input.actionType ?? 'practice_recommended';
  if (actionType === 'open_report') return buildReportAction(input);

  const questionId = realId(input.questionId);
  if (actionType === 'review_due') {
    const reviewDueQuestionId = realId(input.reviewDueQuestionId);
    if (!reviewDueQuestionId) return [];
    return [{
      id: `training-review-due:${input.sourceId}`,
      type: 'review_due',
      title: '开始复习',
      destination: 'review',
      source: 'review-due',
      context: { questionId: reviewDueQuestionId },
    }];
  }

  if (actionType === 'redo_wrong_question') {
    const wrongQuestionId = realId(input.wrongQuestionId);
    if (!wrongQuestionId) return [];
    return [{
      id: `training-redo-wrong-question:${input.sourceId}`,
      type: 'redo_wrong_question',
      title: '重做错题',
      destination: 'practice',
      source: 'wrong-summary',
      context: { questionId: wrongQuestionId },
    }];
  }

  const knowledgeNodeId = realId(input.knowledgeNodeId);
  const taskId = realId(input.taskId);
  if (!questionId && !knowledgeNodeId && !taskId) return [];

  return [{
    id: `training-practice:${input.sourceId}`,
    type: 'practice_recommended',
    title: '开始训练',
    destination: 'practice',
    source: 'training',
    context: buildPracticeContext(questionId, knowledgeNodeId, taskId),
  }];
}

function buildReportAction(input: TrainingActionInput): StudentAction[] {
  const reportId = realId(input.reportId);
  const assessmentId = realId(input.assessmentId);
  if (!reportId) return [];

  return [{
    id: `training-report:${input.sourceId}`,
    type: 'open_report',
    title: '查看训练报告',
    destination: 'test',
    source: assessmentId ? 'assessment' : 'report',
    context: assessmentId
      ? { reportId, assessmentId }
      : { reportId },
  }];
}

function isStructuredTrainingAction(value: unknown): value is StructuredTrainingAction {
  return STRUCTURED_TRAINING_ACTIONS.includes(value as StructuredTrainingAction);
}

function buildPracticeContext(
  questionId: string | null,
  knowledgeNodeId: string | null,
  taskId: string | null,
): Extract<StudentAction, { type: 'practice_recommended' }>['context'] {
  if (questionId) return {
    questionId,
    ...(knowledgeNodeId ? { knowledgeNodeId } : {}),
    ...(taskId ? { taskId } : {}),
  };
  if (knowledgeNodeId) return {
    knowledgeNodeId,
    ...(taskId ? { taskId } : {}),
  };
  return { taskId: taskId as string };
}

function realId(value: unknown): string | null {
  return isRealId(value) ? value : null;
}

function isRealId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
