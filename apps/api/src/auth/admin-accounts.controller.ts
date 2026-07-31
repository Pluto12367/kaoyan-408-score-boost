import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { UserProfile } from '@kaoyan408/shared';
import { AccountAdminService } from './account-admin.service';
import { CurrentUser } from './current-user.decorator';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { CreateManagedUserDto } from './dto/create-managed-user.dto';
import { InvitationService } from './invitation.service';
import { RoleGuard } from './role.guard';
import { Roles } from './roles.decorator';

@Controller('admin')
@UseGuards(RoleGuard)
@Roles('admin')
export class AdminAccountsController {
  constructor(
    private readonly invitations: InvitationService,
    private readonly accounts: AccountAdminService,
  ) {}

  @Get('invitations')
  listInvitations() {
    return this.invitations.list();
  }

  @Post('invitations')
  createInvitation(@CurrentUser() user: UserProfile, @Body() input: CreateInvitationDto) {
    return this.invitations.create(input, user.id);
  }

  @Post('invitations/:invitationId/disable')
  disableInvitation(@CurrentUser() user: UserProfile, @Param('invitationId') id: string) {
    return this.invitations.disable(id, user.id);
  }

  @Post('users')
  createManagedUser(@CurrentUser() user: UserProfile, @Body() input: CreateManagedUserDto) {
    return this.accounts.createManagedUser(input, user.id);
  }

  @Post('users/:userId/disable')
  disableUser(@CurrentUser() user: UserProfile, @Param('userId') userId: string) {
    return this.accounts.disable(userId, user.id);
  }

  @Post('users/:userId/restore')
  restoreUser(@CurrentUser() user: UserProfile, @Param('userId') userId: string) {
    return this.accounts.restore(userId, user.id);
  }

  @Post('users/:userId/temporary-password')
  createTemporaryPassword(@CurrentUser() user: UserProfile, @Param('userId') userId: string) {
    return this.accounts.createTemporaryPassword(userId, user.id);
  }
}
