import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreatePracticeRecordDto {
  @IsOptional()
  @IsString()
  userId?: string;

  @IsString()
  questionId!: string;

  @IsString()
  knowledgePointId!: string;

  @IsOptional()
  @IsString()
  selectedAnswer?: string;

  @IsOptional()
  @IsBoolean()
  correct?: boolean;

  @IsInt()
  @Min(1)
  timeSpentSec!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  expectedTimeSec?: number;

  @IsOptional()
  @IsString()
  sessionId?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  selfScore?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxScore?: number;
}
