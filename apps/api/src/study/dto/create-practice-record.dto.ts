import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreatePracticeRecordDto {
  @IsString()
  userId!: string;

  @IsString()
  questionId!: string;

  @IsString()
  knowledgePointId!: string;

  @IsOptional()
  @IsString()
  selectedAnswer?: string;

  @IsBoolean()
  correct!: boolean;

  @IsInt()
  @Min(1)
  timeSpentSec!: number;

  @IsInt()
  @Min(1)
  expectedTimeSec!: number;
}
