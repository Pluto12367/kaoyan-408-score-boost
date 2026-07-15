import { Injectable } from '@nestjs/common';
import type { UserProfile } from '@kaoyan408/shared';

@Injectable()
export class AuthenticatedUserRegistry {
  private readonly users = new Map<string, UserProfile>();

  remember(user: UserProfile) {
    this.users.set(user.id, { id: user.id, name: user.name, role: user.role });
  }

  get(userId: string) {
    return this.users.get(userId);
  }
}
