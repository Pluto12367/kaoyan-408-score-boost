import { IsInt, IsISO8601, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class CreateInvitationDto {
  @IsString()
  @Length(1, 80)
  label!: string;

  @IsInt()
  @Min(1)
  @Max(500)
  maxUses!: number;

  @IsOptional()
  @IsISO8601()
  startsAt?: string;

  @IsISO8601()
  expiresAt!: string;
}
