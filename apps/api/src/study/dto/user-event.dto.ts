import { IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class RecordUserEventDto {
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  type!: string;

  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}
