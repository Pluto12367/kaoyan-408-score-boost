import { Body, Controller, Post } from '@nestjs/common';
import type { UserRole } from '@kaoyan408/shared';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  login(@Body('role') role?: UserRole) {
    return this.authService.login(role);
  }
}
