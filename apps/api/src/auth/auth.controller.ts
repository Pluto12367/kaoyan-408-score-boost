import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { UserRole } from '@kaoyan408/shared';
import { AuthService } from './auth.service';
import { RegisterAccountDto } from './dto/register-account.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  register(@Body() input: RegisterAccountDto) {
    return this.authService.register(input);
  }

  @Post('login')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
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
