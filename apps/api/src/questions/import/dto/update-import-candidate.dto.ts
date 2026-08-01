import { Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsDefined, IsEnum, IsIn, IsInt, IsOptional, IsString, Max,
  MaxLength, Min, ValidateNested,
} from 'class-validator';
import { QuestionImportDuplicateAction } from '@prisma/client';

export class ImportCandidatePatchDto {
  @IsOptional() @IsString() @MaxLength(10_000) stem?: string;
  @IsOptional() @IsArray() @ArrayMinSize(2) @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(2_000, { each: true }) options?: string[];
  @IsOptional() @IsString() @MaxLength(100) answer?: string;
  @IsOptional() @IsString() @MaxLength(50_000) analysis?: string;
  @IsOptional() @IsIn(['基础', '中等', '困难']) difficulty?: '基础' | '中等' | '困难';
  @IsOptional() @IsIn(['选择题', '综合题', '判断题']) type?: '选择题' | '综合题' | '判断题';
  @IsOptional() @IsString() @MaxLength(1_000) source?: string;
  @IsOptional() @IsInt() @Min(1900) @Max(3000) year?: number;
  @IsOptional() @IsInt() @Min(1) @Max(86_400) expectedTimeSec?: number;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(20) @ArrayUnique() @IsString({ each: true }) knowledgePointIds?: string[];
  @IsOptional() @IsEnum(QuestionImportDuplicateAction) duplicateAction?: QuestionImportDuplicateAction;
  @IsOptional() @IsIn(['ignored']) status?: 'ignored';
}

export class UpdateImportCandidateDto {
  @IsInt()
  @Min(0)
  revision!: number;

  @ValidateNested()
  @IsDefined()
  @Type(() => ImportCandidatePatchDto)
  patch!: ImportCandidatePatchDto;
}

export class BulkApproveCandidatesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BulkCandidateRevisionDto)
  candidates!: BulkCandidateRevisionDto[];
}

export class BulkCandidateRevisionDto {
  @IsString()
  @MaxLength(200)
  id!: string;

  @IsInt()
  @Min(0)
  revision!: number;
}
