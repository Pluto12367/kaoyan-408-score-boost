import type { RoleSection } from '../../../layouts/RoleNavigation';
import { toRoleSection } from './studentActionDestination';
import type { StudentAction } from './studentAction';

export type StudentActionCommandDescriptor =
  | { kind: 'today'; taskId: string }
  | { kind: 'review'; questionId: string }
  | { kind: 'redo'; questionId: string }
  | {
      kind: 'practice';
      section: RoleSection;
      questionId?: string;
      knowledgeNodeId?: string;
      taskId?: string;
    }
  | { kind: 'catalog-node'; knowledgeNodeId: string }
  | { kind: 'quest'; knowledgeNodeId: string; questionIds?: string[] }
  | { kind: 'assessment'; section: RoleSection; assessmentId: string; questionId?: string }
  | { kind: 'report'; section: RoleSection; reportId?: string; assessmentId?: string }
  | { kind: 'session-resume'; section: RoleSection; sessionId: string };

export function toCommandDescriptor(action: StudentAction): StudentActionCommandDescriptor | null {
  switch (action.type) {
    case 'today_task':
      return { kind: 'today', taskId: action.context.taskId };
    case 'review_due':
      return { kind: 'review', questionId: action.context.questionId };
    case 'redo_wrong_question':
      return { kind: 'redo', questionId: action.context.questionId };
    case 'practice_recommended':
      return {
        kind: 'practice',
        section: toRoleSection(action.destination),
        ...(action.context.questionId !== undefined ? { questionId: action.context.questionId } : {}),
        ...(action.context.knowledgeNodeId !== undefined ? { knowledgeNodeId: action.context.knowledgeNodeId } : {}),
        ...(action.context.taskId !== undefined ? { taskId: action.context.taskId } : {}),
      };
    case 'knowledge_explore':
      return { kind: 'catalog-node', knowledgeNodeId: action.context.knowledgeNodeId };
    case 'knowledge_quest':
      return {
        kind: 'quest',
        knowledgeNodeId: action.context.knowledgeNodeId,
        ...(action.context.questionIds !== undefined ? { questionIds: [...action.context.questionIds] } : {}),
      };
    case 'assessment_review':
    case 'assessment_wrong_questions':
    case 'assessment_practice':
      return {
        kind: 'assessment',
        section: toRoleSection(action.destination),
        assessmentId: action.context.assessmentId,
        ...(action.context.questionId !== undefined ? { questionId: action.context.questionId } : {}),
      };
    case 'open_report':
      return {
        kind: 'report',
        section: toRoleSection(action.destination),
        ...(action.context.reportId !== undefined ? { reportId: action.context.reportId } : {}),
        ...(action.context.assessmentId !== undefined ? { assessmentId: action.context.assessmentId } : {}),
      };
    case 'continue_session':
      return {
        kind: 'session-resume',
        section: toRoleSection(action.destination),
        sessionId: action.context.sessionId,
      };
    case 'coach_explain':
      return null;
  }
}
