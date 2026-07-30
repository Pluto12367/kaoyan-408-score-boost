import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserProfile, UserRole } from '@kaoyan408/shared';
import { AuthService } from './auth.service';
import { ROLES_KEY } from './roles.decorator';
import { AuthenticatedUserRegistry } from './authenticated-user.registry';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly authenticatedUsers: AuthenticatedUserRegistry,
  ) {}

  async canActivate(context: ExecutionContext) {
    const allowedRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowedRoles?.length) return true;

    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; user?: unknown; url?: string }>();
    request.user = await this.authService.requireRole(request.headers.authorization, allowedRoles, request.url ?? '');
    this.authenticatedUsers.remember(request.user as UserProfile);
    return true;
  }
}
