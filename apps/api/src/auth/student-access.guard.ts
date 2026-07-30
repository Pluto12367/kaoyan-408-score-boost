import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { UserProfile } from '@kaoyan408/shared';
import { AuthService } from './auth.service';

export interface AuthenticatedRequest {
  headers: { authorization?: string };
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  url?: string;
  user?: UserProfile;
}

@Injectable()
export class StudentAccessGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = await this.authService.requireRole(request.headers.authorization, ['student', 'admin'], request.url ?? '');
    const requestedUserId = readRequestedUserId(request);

    if (user.role === 'student' && requestedUserId && requestedUserId !== user.id) {
      throw new ForbiddenException('Students can only access their own learning data');
    }

    request.user = user;
    return true;
  }
}

export function resolveStudentUserId(request: AuthenticatedRequest, requestedUserId?: string) {
  const user = request.user;
  if (!user) throw new ForbiddenException('Authenticated user is required');
  return user.role === 'admin' && requestedUserId ? requestedUserId : user.id;
}

function readRequestedUserId(request: AuthenticatedRequest) {
  const candidates = [request.params?.userId, request.query?.userId, request.body?.userId];
  return candidates.find((value): value is string => typeof value === 'string' && value.length > 0);
}
