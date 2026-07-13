import type { PropsWithChildren } from 'react';
import type { UserRole } from '@kaoyan408/shared';

interface RoleGateProps extends PropsWithChildren {
  role?: UserRole;
  allow: UserRole[];
}

export function RoleGate({ role, allow, children }: RoleGateProps) {
  return role && allow.includes(role) ? <>{children}</> : null;
}
