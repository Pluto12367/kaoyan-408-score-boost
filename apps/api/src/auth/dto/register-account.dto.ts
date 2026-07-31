import { IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class RegisterAccountDto {
  @IsString()
  @Length(6, 128)
  inviteCode!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @Length(8, 128)
  password!: string;

  @IsString()
  @Length(1, 40)
  name!: string;

  @IsOptional()
  readonly _unused?: never;
}
