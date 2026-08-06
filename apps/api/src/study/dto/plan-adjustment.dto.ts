import {
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

export class RescheduleTaskDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  scheduledDate!: string;
}

export class RebalanceTasksDto {
  @IsIn(['reduce', 'priority_only'])
  mode!: 'reduce' | 'priority_only';
}

export class ImportAssessmentHistoryDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title!: string;

  @IsInt()
  @Min(0)
  score!: number;

  @IsInt()
  @Min(1)
  totalScore!: number;

  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}
