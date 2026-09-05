export type SessionActionSource = { actionId?: string | null } | null | undefined;

/** The session is the sole trusted source; request action ids are intentionally ignored. */
export function resolvePracticeActionId(session: SessionActionSource, _requestActionId?: string | null): string | null {
  return session?.actionId ?? null;
}
