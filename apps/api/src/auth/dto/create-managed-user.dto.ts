import { IsEmail, IsIn, IsString, Length } from 'class-validator';

export class CreateManagedUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @Length(1, 40)
  name!: string;

  @IsIn(['teacher', 'admin'])
  role!: 'teacher' | 'admin';
}
