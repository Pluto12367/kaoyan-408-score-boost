import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '@kaoyan408/shared';
import { AuthService } from './auth.service';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  canActivate(context: ExecutionContext) {
    const allowedRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!allowedRoles?.length) return true;

    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; user?: unknown }>();
    request.user = this.authService.requireRole(request.headers.authorization, allowedRoles);
    return true;
  }
}
