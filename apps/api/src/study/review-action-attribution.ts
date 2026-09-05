import { ActionDomainError } from './recommendation-action.service';

export type ReviewAction = { id: string; userId: string; status: string } | null | undefined;

/** Review attribution is derived from the validated server-side Action, never from a client id. */
export function resolveReviewActionId(action: ReviewAction, userId: string, _requestedActionId?: string | null): string | null {
  if (!action) {
    if (_requestedActionId) throw new ActionDomainError('ACTION_NOT_FOUND');
    return null;
  }
  if (action.userId !== userId) throw new ActionDomainError('ACTION_FORBIDDEN');
  if (action.status !== 'CREATED' && action.status !== 'STARTED') throw new ActionDomainError('ACTION_INVALID_TRANSITION');
  return action.id;
}
