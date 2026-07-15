import { BadRequestException, Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { AuthenticatedUserRegistry } from '../auth/authenticated-user.registry';
import { PrismaService } from '../prisma/prisma.service';

export interface TeacherStudentAuthorizationView {
  id: string;
  teacherId: string;
  teacherName: string;
  studentId: string;
  studentName: string;
  createdAt: string;
}

@Injectable()
export class TeacherStudentAuthorizationRepository {
  private readonly authorizations = new Map<string, TeacherStudentAuthorizationView>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly authenticatedUsers: AuthenticatedUserRegistry,
  ) {}

  get enabled() {
    return Boolean(process.env.DATABASE_URL);
  }

  async initialize() {
    if (!this.enabled) {
      const demo = {
        id: 'demo-teacher-student-authorization',
        teacherId: 'teacher-001',
        teacherName: '王老师',
        studentId: 'u-001',
        studentName: '林同学',
        createdAt: new Date().toISOString(),
      };
      this.authorizations.set(key(demo.teacherId, demo.studentId), demo);
      return;
    }

    await this.prisma.user.upsert({
      where: { id: 'teacher-001' },
      create: { id: 'teacher-001', name: '王老师', role: UserRole.TEACHER },
      update: { name: '王老师', role: UserRole.TEACHER },
    });
    await this.prisma.user.upsert({
      where: { id: 'admin-001' },
      create: { id: 'admin-001', name: '管理员', role: UserRole.ADMIN },
      update: { name: '管理员', role: UserRole.ADMIN },
    });

    const rows = await this.prisma.teacherStudentAuthorization.findMany({
      include: { teacher: true, student: true },
      orderBy: { createdAt: 'asc' },
    });
    this.authorizations.clear();
    for (const row of rows) this.remember(toView(row));
  }

  has(teacherId: string, studentId: string) {
    return this.authorizations.has(key(teacherId, studentId));
  }

  studentIds(teacherId: string) {
    return this.list(teacherId).map((item) => item.studentId);
  }

  list(teacherId?: string) {
    return [...this.authorizations.values()].filter((item) => !teacherId || item.teacherId === teacherId);
  }

  async grant(teacherId: string, studentId: string) {
    if (!teacherId || !studentId || teacherId === studentId) {
      throw new BadRequestException('A teacher id and a different student id are required');
    }
    if (!this.enabled) {
      const view = {
        id: `memory-${key(teacherId, studentId)}`,
        teacherId,
        teacherName: teacherId,
        studentId,
        studentName: studentId,
        createdAt: new Date().toISOString(),
      };
      this.remember(view);
      return view;
    }

    const [teacher, student] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: teacherId } }),
      this.prisma.user.findUnique({ where: { id: studentId } }),
    ]);
    if (!teacher || teacher.role !== UserRole.TEACHER) throw new BadRequestException('Teacher account was not found');
    if (!student || student.role !== UserRole.STUDENT) throw new BadRequestException('Student account was not found');

    const row = await this.prisma.teacherStudentAuthorization.upsert({
      where: { teacherId_studentId: { teacherId, studentId } },
      create: { teacherId, studentId },
      update: {},
      include: { teacher: true, student: true },
    });
    const view = toView(row);
    this.remember(view);
    return view;
  }

  async revoke(teacherId: string, studentId: string) {
    if (this.enabled) {
      await this.prisma.teacherStudentAuthorization.deleteMany({ where: { teacherId, studentId } });
    }
    const revoked = this.authorizations.delete(key(teacherId, studentId));
    return { revoked, teacherId, studentId };
  }

  private remember(view: TeacherStudentAuthorizationView) {
    this.authorizations.set(key(view.teacherId, view.studentId), view);
    this.authenticatedUsers.remember({ id: view.teacherId, name: view.teacherName, role: 'teacher' });
    this.authenticatedUsers.remember({ id: view.studentId, name: view.studentName, role: 'student' });
  }
}

function key(teacherId: string, studentId: string) {
  return `${teacherId}:${studentId}`;
}

function toView(row: {
  id: string;
  teacherId: string;
  studentId: string;
  createdAt: Date;
  teacher: { name: string };
  student: { name: string };
}): TeacherStudentAuthorizationView {
  return {
    id: row.id,
    teacherId: row.teacherId,
    teacherName: row.teacher.name,
    studentId: row.studentId,
    studentName: row.student.name,
    createdAt: row.createdAt.toISOString(),
  };
}
