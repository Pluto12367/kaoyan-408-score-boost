import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { UserRole as PrismaUserRole } from '@prisma/client';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { UserProfile, UserRole } from '@kaoyan408/shared';
import { PrismaService } from '../prisma/prisma.service';
import { hashPassword, validatePassword, verifyPassword } from './password';
import { InvitationService } from './invitation.service';
const accessTokenLifetimeSec = 15 * 60;
const refreshTokenLifetimeMs = 30 * 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invitations: InvitationService,
  ) {}

  async register(input: { inviteCode?: string; email?: string; password?: string; name?: string }) {
    this.requireDatabase();
    const user = await this.invitations.registerStudent({
      inviteCode: input.inviteCode ?? '',
      email: input.email ?? '',
      password: input.password ?? '',
      name: input.name ?? '',
    });
    return this.createSession(user);
  }

  async login(input: { email?: string; password?: string }) {
    this.requireDatabase();
    const email = normalizeEmail(input.email);
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !await verifyPassword(input.password ?? '', user.passwordHash)) {
      throw new UnauthorizedException('Email or password is incorrect');
    }
    this.assertActiveAccount(user);
    return this.createSession(user);
  }

  async refresh(rawToken?: string) {
    this.requireDatabase();
    if (!rawToken) throw new UnauthorizedException('Refresh token is required');
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(rawToken) },
      include: { user: true },
    });
    if (!stored || stored.revokedAt || stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token is invalid or expired');
    }
    this.assertActiveAccount(stored.user);
    const revoked = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (revoked.count !== 1) throw new UnauthorizedException('Refresh token has already been used');
    return this.createSession(stored.user);
  }

  async logout(rawToken?: string) {
    if (!process.env.DATABASE_URL || !rawToken) return { revoked: true };
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { revoked: true };
  }

  demoLogin(role: UserRole = 'student') {
    if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_AUTH !== 'true') {
      throw new ForbiddenException('Demo authentication is disabled');
    }
    const user = demoUsers[role] ?? demoUsers.student;
    const accessToken = this.signAccessToken(user);
    return { token: accessToken, accessToken, expiresIn: accessTokenLifetimeSec, user };
  }

  async requireRole(authorization: string | undefined, allowedRoles: UserRole[], path = '') {
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new UnauthorizedException('Bearer access token is required');
    const payload = this.verifyAccessToken(token);
    if (!allowedRoles.includes(payload.role)) {
      throw new ForbiddenException('Current role cannot access this resource');
    }
    // Demo/in-memory mode: without a DATABASE_URL, Prisma has no datasource and
    // a user lookup would throw P1012. The access token is already verified and
    // role-checked above, so the verified demo payload is a trusted identity.
    if (!process.env.DATABASE_URL && process.env.ALLOW_DEMO_AUTH === 'true') {
      return { id: payload.sub, name: payload.name, role: payload.role } satisfies UserProfile;
    }
    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { accountStatus: true, mustChangePassword: true },
    });
    if (account) {
      if (account.accountStatus !== 'ACTIVE') throw new ForbiddenException('账号已停用');
      if (account.mustChangePassword && !isPasswordChangeAllowedPath(path)) {
        throw new ForbiddenException({ code: 'PASSWORD_CHANGE_REQUIRED', message: '必须先修改临时密码' });
      }
      return {
        id: payload.sub,
        name: payload.name,
        role: payload.role,
        accountStatus: account.accountStatus.toLowerCase() as 'active' | 'disabled',
        mustChangePassword: account.mustChangePassword,
      } satisfies UserProfile;
    }
    if (process.env.ALLOW_DEMO_AUTH === 'true') {
      return { id: payload.sub, name: payload.name, role: payload.role } satisfies UserProfile;
    }
    throw new ForbiddenException('账号不存在或已停用');
  }

  async changePassword(userId: string, currentPassword?: string, newPassword?: string) {
    this.requireDatabase();
    const newPasswordValue = validatePassword(newPassword);
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash || !await verifyPassword(currentPassword ?? '', user.passwordHash)) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    this.assertActiveAccount(user);
    const updated = await this.prisma.$transaction(async (tx) => {
      const changed = await tx.user.update({
        where: { id: userId },
        data: {
          passwordHash: await hashPassword(newPasswordValue),
          mustChangePassword: false,
        },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.auditEvent.create({
        data: { actorId: userId, action: 'account.temporary_password', targetType: 'user', targetId: userId, result: 'success' },
      });
      return changed;
    });
    return this.createSession(updated);
  }

  private async createSession(user: {
    id: string;
    name: string;
    role: PrismaUserRole;
    targetSchool: string | null;
    targetScore: number | null;
    currentScore: number | null;
    dailyHours: number | null;
    remainingDays: number | null;
  }) {
    const profile = toUserProfile(user);
    const accessToken = this.signAccessToken(profile);
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        tokenHash: hashToken(refreshToken),
        userId: user.id,
        expiresAt: new Date(Date.now() + refreshTokenLifetimeMs),
      },
    });
    return { token: accessToken, accessToken, refreshToken, expiresIn: accessTokenLifetimeSec, user: profile };
  }

  private signAccessToken(user: UserProfile) {
    const now = Math.floor(Date.now() / 1000);
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
    const payload = encodeJson({ sub: user.id, name: user.name, role: user.role, iat: now, exp: now + accessTokenLifetimeSec });
    const signature = sign(`${header}.${payload}`);
    return `${header}.${payload}.${signature}`;
  }

  private verifyAccessToken(token: string): AccessTokenPayload {
    const parts = token.split('.');
    if (parts.length !== 3) throw new UnauthorizedException('Access token is invalid');
    const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`));
    const received = Buffer.from(parts[2]);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw new UnauthorizedException('Access token signature is invalid');
    }
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as AccessTokenPayload;
      if (!payload.sub || typeof payload.name !== 'string' || !isUserRole(payload.role) || payload.exp <= Math.floor(Date.now() / 1000)) {
        throw new Error('invalid payload');
      }
      return payload;
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired');
    }
  }

  private requireDatabase() {
    if (!process.env.DATABASE_URL) throw new ServiceUnavailableException('Account authentication requires PostgreSQL');
  }

  private assertActiveAccount(user: { accountStatus?: string }) {
    if (user.accountStatus === 'DISABLED') throw new ForbiddenException('账号已停用');
  }
}

interface AccessTokenPayload {
  sub: string;
  name: string;
  role: UserRole;
  iat: number;
  exp: number;
}

const demoUsers: Record<UserRole, UserProfile> = {
  student: { id: 'u-001', name: '林同学', role: 'student' },
  teacher: { id: 'teacher-001', name: '教研老师', role: 'teacher' },
  admin: { id: 'admin-001', name: '管理员', role: 'admin' },
};

function normalizeEmail(value?: string) {
  const email = value?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new BadRequestException('A valid email is required');
  }
  return email;
}

function encodeJson(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(value: string) {
  return createHmac('sha256', jwtSecret()).update(value).digest('base64url');
}

function hashToken(value: string) {
  return createHmac('sha256', jwtSecret()).update(value).digest('hex');
}

function jwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (process.env.NODE_ENV === 'production') throw new Error('JWT_SECRET is required in production');
  return 'development-only-change-this-secret';
}

function isUserRole(value: string): value is UserRole {
  return value === 'student' || value === 'teacher' || value === 'admin';
}

function isPasswordChangeAllowedPath(path: string) {
  const normalized = path.split('?')[0];
  return normalized.endsWith('/auth/change-password') || normalized.endsWith('/auth/logout');
}

function toUserProfile(user: {
  id: string;
  name: string;
  role: PrismaUserRole;
  accountStatus?: string;
  mustChangePassword?: boolean;
  targetSchool: string | null;
  targetScore: number | null;
  currentScore: number | null;
  dailyHours: number | null;
  remainingDays: number | null;
}): UserProfile {
  return {
    id: user.id,
    name: user.name,
    role: user.role.toLowerCase() as UserRole,
    targetSchool: user.targetSchool ?? undefined,
    targetScore: user.targetScore ?? undefined,
    currentScore: user.currentScore ?? undefined,
    dailyHours: user.dailyHours ?? undefined,
    remainingDays: user.remainingDays ?? undefined,
    accountStatus: user.accountStatus?.toLowerCase() as 'active' | 'disabled' | undefined,
    mustChangePassword: user.mustChangePassword,
  };
}
