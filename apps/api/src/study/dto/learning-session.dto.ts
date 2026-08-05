import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class StartLearningSessionDto {
  @IsIn(['practice_set', 'stage_assessment', 'paper'])
  type!: 'practice_set' | 'stage_assessment' | 'paper';

  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  questionIds!: string[];

  @IsOptional()
  @IsString()
  @MaxLength(200)
  resourceId?: string;
}

export class SaveLearningSessionDto {
  @IsInt()
  @Min(1)
  revision!: number;

  @IsOptional()
  @IsObject()
  answers?: Record<string, {
    selectedAnswer: string;
    timeSpentSec: number;
    selfScore?: number;
    maxScore?: number;
    confidence?: '确定' | '不确定' | '完全不会';
    usedHint?: boolean;
    answerModified?: boolean;
  }>;

  @IsOptional()
  @IsInt()
  @Min(0)
  currentIndex?: number;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ArrayUnique()
  @IsString({ each: true })
  markedQuestions?: string[];

  @IsOptional()
  @IsInt()
  @Min(0)
  totalActiveMs?: number;
}

export class SubmitLearningSessionAnswerDto {
  @IsString()
  questionId!: string;

  @IsString()
  @MaxLength(10_000)
  selectedAnswer!: string;

  @IsInt()
  @Min(0)
  @Max(10_800)
  timeSpentSec!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(150)
  selfScore?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(150)
  maxScore?: number;

  @IsOptional()
  @IsIn(['确定', '不确定', '完全不会'])
  confidence?: '确定' | '不确定' | '完全不会';

  @IsOptional()
  @IsBoolean()
  usedHint?: boolean;

  @IsOptional()
  @IsBoolean()
  answerModified?: boolean;
}

export class SubmitLearningSessionDto {
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => SubmitLearningSessionAnswerDto)
  answers!: SubmitLearningSessionAnswerDto[];

  @IsOptional()
  @IsInt()
  @Min(0)
  totalActiveMs?: number;
}
