import { Body, Controller, Post } from '@nestjs/common';
import type { UserRole } from '@kaoyan408/shared';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  register(@Body() input: { email?: string; password?: string; name?: string }) {
    return this.authService.register(input);
  }

  @Post('login')
  login(@Body() input: { email?: string; password?: string }) {
    return this.authService.login(input);
  }

  @Post('refresh')
  refresh(@Body('refreshToken') refreshToken?: string) {
    return this.authService.refresh(refreshToken);
  }

  @Post('logout')
  logout(@Body('refreshToken') refreshToken?: string) {
    return this.authService.logout(refreshToken);
  }

  @Post('demo-login')
  demoLogin(@Body('role') role?: UserRole) {
    return this.authService.demoLogin(role);
  }
}
