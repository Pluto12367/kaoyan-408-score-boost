import type { SessionView } from '../../../../api/endpoints/sessions';
import type { StudentAction } from '../studentAction';

export function buildContinueSessionAction(session: SessionView | null): StudentAction | null {
  if (!session || session.completed || !isRealId(session.id)
    || session.totalQuestions <= 0 || session.questionIds.length === 0) {
    return null;
  }

  return {
    id: `continue-session:${session.id}`,
    type: 'continue_session',
    title: '继续练习',
    destination: 'practice',
    source: 'session',
    context: { sessionId: session.id },
  };
}

function isRealId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
