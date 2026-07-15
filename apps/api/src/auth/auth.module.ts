import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { RoleGuard } from './role.guard';
import { StudentAccessGuard } from './student-access.guard';
import { AuthService } from './auth.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthenticatedUserRegistry } from './authenticated-user.registry';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, RoleGuard, StudentAccessGuard, AuthenticatedUserRegistry],
  exports: [AuthService, RoleGuard, StudentAccessGuard, AuthenticatedUserRegistry],
})
export class AuthModule {}
