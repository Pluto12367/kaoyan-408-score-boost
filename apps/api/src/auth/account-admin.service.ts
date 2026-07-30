import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, User, UserRole as PrismaUserRole } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditEventService } from '../operations/audit-event.service';
import { hashPassword } from './password';
import type { CreateManagedUserDto } from './dto/create-managed-user.dto';

@Injectable()
export class AccountAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditEventService,
  ) {}

  async disable(userId: string, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: userId },
        data: { accountStatus: 'DISABLED' },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: { actorId, action: 'account.disable', targetType: 'user', targetId: userId, result: 'success' },
      });
      return toManagedAccount(user);
    });
  }

  async restore(userId: string, actorId: string) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { accountStatus: 'ACTIVE' },
    });
    await this.audit.record({
      actorId,
      action: 'account.restore',
      targetType: 'user',
      targetId: userId,
      result: 'success',
    });
    return toManagedAccount(user);
  }

  async createTemporaryPassword(userId: string, actorId: string) {
    const temporaryPassword = generateTemporaryPassword();
    const user = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: await hashPassword(temporaryPassword),
          mustChangePassword: true,
          accountStatus: 'ACTIVE',
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: { actorId, action: 'account.temporary_password', targetType: 'user', targetId: userId, result: 'success' },
      });
      return updated;
    });
    return { user: toManagedAccount(user), temporaryPassword };
  }

  async createManagedUser(input: CreateManagedUserDto, actorId: string) {
    if (input.role !== 'teacher' && input.role !== 'admin') {
      throw new BadRequestException('学生账号必须通过邀请码注册');
    }
    const temporaryPassword = generateTemporaryPassword();
    try {
      const user = await this.prisma.user.create({
        data: {
          email: normalizeEmail(input.email),
          name: validateName(input.name),
          role: input.role === 'teacher' ? PrismaUserRole.TEACHER : PrismaUserRole.ADMIN,
          passwordHash: await hashPassword(temporaryPassword),
          trialStatus: 'ACTIVE',
          accountStatus: 'ACTIVE',
          mustChangePassword: true,
        },
      });
      await this.audit.record({
        actorId,
        action: 'account.create_managed',
        targetType: 'user',
        targetId: user.id,
        result: 'success',
        metadata: { role: input.role },
      });
      return { user: toManagedAccount(user), temporaryPassword };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Email is already registered');
      }
      throw error;
    }
  }
}

function generateTemporaryPassword() {
  return randomBytes(18).toString('base64url');
}

function toManagedAccount(user: User) {
  return {
    id: user.id,
    name: user.name,
    role: user.role.toLowerCase(),
    trialStatus: user.trialStatus.toLowerCase(),
    accountStatus: user.accountStatus.toLowerCase(),
    mustChangePassword: user.mustChangePassword,
  };
}

function normalizeEmail(value?: string) {
  const email = value?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new BadRequestException('A valid email is required');
  }
  return email;
}

function validateName(value?: string) {
  const name = value?.trim();
  if (!name || name.length > 40) throw new BadRequestException('Name is required and must not exceed 40 characters');
  return name;
}
