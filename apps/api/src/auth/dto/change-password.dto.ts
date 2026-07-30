import { IsString, Length } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @Length(8, 128)
  currentPassword!: string;

  @IsString()
  @Length(8, 128)
  newPassword!: string;
}
