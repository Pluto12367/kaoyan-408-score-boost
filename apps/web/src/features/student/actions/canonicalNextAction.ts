import type { StudentAction } from './studentAction';
import type { StudentActionCandidates } from './actionCandidates';

export function selectCanonicalNextAction(input: StudentActionCandidates): StudentAction | null {
  return firstMatching(input.session, (action) => action.type === 'continue_session')
    ?? firstMatching(input.today, (action) => action.type === 'today_task')
    ?? firstMatching(input.review, (action) => action.type === 'review_due')
    ?? firstMatching(input.wrongQuestion, (action) => (
      action.type === 'redo_wrong_question' && action.source === 'wrong-summary'
    ))
    ?? firstMatching(input.assessment, isAssessmentOrReportAction)
    ?? firstMatching(input.report, isAssessmentOrReportAction);
}

function firstMatching(
  actions: readonly StudentAction[],
  predicate: (action: StudentAction) => boolean,
): StudentAction | null {
  return actions.find((action) => isCanonicalAction(action) && predicate(action)) ?? null;
}

function isAssessmentOrReportAction(action: StudentAction): boolean {
  return action.source === 'assessment' || action.source === 'report';
}

function isCanonicalAction(action: StudentAction): boolean {
  return action.type !== 'coach_explain' && (action.destination as string) !== 'ai';
}
