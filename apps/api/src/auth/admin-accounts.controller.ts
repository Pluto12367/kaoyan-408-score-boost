import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { UserProfile } from '@kaoyan408/shared';
import { CurrentUser } from './current-user.decorator';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { InvitationService } from './invitation.service';
import { RoleGuard } from './role.guard';
import { Roles } from './roles.decorator';

@Controller('admin')
@UseGuards(RoleGuard)
@Roles('admin')
export class AdminAccountsController {
  constructor(private readonly invitations: InvitationService) {}

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
}
