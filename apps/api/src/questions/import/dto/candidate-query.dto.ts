import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { QuestionImportCandidateStatus } from '@prisma/client';

export class CandidateQueryDto {
  @IsOptional()
  @IsEnum(QuestionImportCandidateStatus)
  status?: QuestionImportCandidateStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number;
}
