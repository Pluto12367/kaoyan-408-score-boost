import { Injectable, ForbiddenException } from '@nestjs/common';
import type { UserProfile, UserRole } from '@kaoyan408/shared';

@Injectable()
export class AuthService {
  private readonly demoUsers: Record<UserRole, UserProfile> = {
    student: {
      id: 'u-001',
      name: '林同学',
      role: 'student',
      targetSchool: '北京邮电大学',
      targetScore: 115,
      currentScore: 72,
      dailyHours: 3.5,
      stage: '强化',
      remainingDays: 96,
      weakestSubject: '计算机组成原理',
    },
    teacher: {
      id: 'teacher-001',
      name: '教研老师',
      role: 'teacher',
    },
    admin: {
      id: 'admin-001',
      name: '管理员',
      role: 'admin',
    },
  };

  login(role: UserRole = 'student') {
    const user = this.demoUsers[role] ?? this.demoUsers.student;
    return {
      token: `demo-token-${user.role}`,
      user,
    };
  }

  requireRole(authorization: string | undefined, allowedRoles: UserRole[]) {
    const role = authorization?.replace('Bearer demo-token-', '') as UserRole | undefined;
    if (!role || !allowedRoles.includes(role)) {
      throw new ForbiddenException('Current role cannot access this resource');
    }

    return this.demoUsers[role];
  }
}
