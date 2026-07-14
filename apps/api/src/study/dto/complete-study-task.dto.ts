import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CompleteStudyTaskDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  completedQuestionCount?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  correctCount?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(600)
  minutesSpent?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  selfRating?: number;
}
