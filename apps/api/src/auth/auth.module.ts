import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { RoleGuard } from './role.guard';
import { AuthService } from './auth.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AuthController],
  providers: [AuthService, RoleGuard],
  exports: [AuthService, RoleGuard],
})
export class AuthModule {}
