export type InvitationAvailability = 'available' | 'not_started' | 'expired' | 'disabled' | 'exhausted';

export function invitationAvailability(
  code: { disabledAt: Date | null; startsAt: Date; expiresAt: Date; usedCount: number; maxUses: number },
  now = new Date(),
): InvitationAvailability {
  if (code.disabledAt) return 'disabled';
  if (code.startsAt > now) return 'not_started';
  if (code.expiresAt <= now) return 'expired';
  if (code.usedCount >= code.maxUses) return 'exhausted';
  return 'available';
}
