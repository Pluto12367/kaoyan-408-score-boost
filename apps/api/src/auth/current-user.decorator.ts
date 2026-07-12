import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { UserProfile } from '@kaoyan408/shared';

export const CurrentUser = createParamDecorator<never, ExecutionContext, UserProfile>(
  (_data, ctx) => {
    const request = ctx.switchToHttp().getRequest<{ user?: UserProfile }>();
    if (!request.user) {
      throw new Error('CurrentUser decorator requires an authenticated user. Use @UseGuards(RoleGuard) + @Roles() on the route.');
    }
    return request.user;
  },
);
