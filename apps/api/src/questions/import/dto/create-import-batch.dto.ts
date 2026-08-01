import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateImportBatchDto {
  @IsString()
  @IsNotEmpty()
  source!: string;

  @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean()
  rightsConfirmed!: boolean;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1900)
  @Max(3000)
  year?: number;

  @IsOptional()
  @IsString()
  defaultSubject?: string;

  @IsOptional()
  @IsString()
  defaultChapter?: string;

  @IsOptional()
  @IsString()
  pageRange?: string;
}
