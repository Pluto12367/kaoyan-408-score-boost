import type { PropsWithChildren } from 'react';
import type { UserRole } from '@kaoyan408/shared';
import { RoleGate } from '../components/RoleGate';

interface RoleLayoutProps extends PropsWithChildren {
  role?: UserRole;
}

export function StudentLayout({ role, children }: RoleLayoutProps) {
  return <RoleGate role={role ?? 'student'} allow={['student']}><div className="student-workspace">{children}</div></RoleGate>;
}

export function TeacherLayout({ role, children }: RoleLayoutProps) {
  return <RoleGate role={role} allow={['teacher', 'admin']}><div className="teacher-workspace">{children}</div></RoleGate>;
}

export function AdminLayout({ role, children }: RoleLayoutProps) {
  return <RoleGate role={role} allow={['admin']}><div className="admin-workspace">{children}</div></RoleGate>;
}
