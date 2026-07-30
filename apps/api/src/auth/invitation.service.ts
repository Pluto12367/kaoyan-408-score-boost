import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, UserRole as PrismaUserRole } from '@prisma/client';
import { createHmac, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, validatePassword } from './password';
import { invitationAvailability } from './invitation-policy';
import type { RegisterAccountDto } from './dto/register-account.dto';

export interface CreatedInvitation {
  id: string;
  code: string;
  codePrefix: string;
  label: string;
  maxUses: number;
  usedCount: number;
  startsAt: Date;
  expiresAt: Date;
  disabledAt: Date | null;
  createdAt: Date;
}

@Injectable()
export class InvitationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: { label?: string; maxUses?: number; expiresAt?: string | Date; startsAt?: string | Date }, actorId: string) {
    const code = randomBytes(18).toString('base64url');
    const now = new Date();
    const startsAt = input.startsAt ? new Date(input.startsAt) : now;
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const maxUses = Number(input.maxUses ?? 1);
    const label = input.label?.trim() || '邀请码';
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > 500) {
      throw new BadRequestException('Invitation max uses must be between 1 and 500');
    }
    if (Number.isNaN(startsAt.getTime()) || Number.isNaN(expiresAt.getTime()) || expiresAt <= startsAt) {
      throw new BadRequestException('Invitation expiration must be after the start time');
    }
    if (label.length > 80) throw new BadRequestException('Invitation label must not exceed 80 characters');

    const invitation = await this.prisma.invitationCode.create({
      data: {
        codeHash: this.hashCode(code),
        codePrefix: code.slice(0, 6),
        label,
        maxUses,
        startsAt,
        expiresAt,
        createdById: actorId,
      },
    });
    return { ...this.toCreatedInvitation(invitation), code };
  }

  async registerStudent(input: RegisterAccountDto) {
    const normalized = {
      email: normalizeEmail(input.email),
      name: validateName(input.name),
      password: validatePassword(input.password),
      codeHash: this.hashCode(input.inviteCode),
    };
    const passwordHash = await hashPassword(normalized.password);
    const now = new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const invitation = await tx.invitationCode.findUnique({ where: { codeHash: normalized.codeHash } });
        if (!invitation || invitationAvailability(invitation, now) !== 'available') {
          throw new BadRequestException('邀请码无效、已过期或已用完');
        }
        const claimed = await tx.invitationCode.updateMany({
          where: {
            id: invitation.id,
            disabledAt: null,
            startsAt: { lte: now },
            expiresAt: { gt: now },
            usedCount: { lt: invitation.maxUses },
          },
          data: { usedCount: { increment: 1 } },
        });
        if (claimed.count !== 1) throw new BadRequestException('邀请码已用完，请联系管理员');

        return tx.user.create({
          data: {
            email: normalized.email,
            passwordHash,
            name: normalized.name,
            role: PrismaUserRole.STUDENT,
            accountStatus: 'ACTIVE',
            mustChangePassword: false,
            invitationRedemptions: { create: { invitationCodeId: invitation.id } },
          },
        });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Email is already registered');
      }
      throw error;
    }
  }

  private hashCode(code: string) {
    const normalized = code?.trim();
    if (!normalized || normalized.length < 6 || normalized.length > 128) {
      throw new BadRequestException('邀请码无效、已过期或已用完');
    }
    return createHmac('sha256', invitationSecret()).update(normalized).digest('hex');
  }

  private toCreatedInvitation(invitation: Omit<CreatedInvitation, 'code'>): Omit<CreatedInvitation, 'code'> {
    return {
      id: invitation.id,
      codePrefix: invitation.codePrefix,
      label: invitation.label,
      maxUses: invitation.maxUses,
      usedCount: invitation.usedCount,
      startsAt: invitation.startsAt,
      expiresAt: invitation.expiresAt,
      disabledAt: invitation.disabledAt,
      createdAt: invitation.createdAt,
    };
  }
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

function invitationSecret() {
  const secret = process.env.INVITATION_CODE_SECRET || process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('INVITATION_CODE_SECRET or JWT_SECRET is required in production');
  return 'development-only-invitation-code-secret';
}
