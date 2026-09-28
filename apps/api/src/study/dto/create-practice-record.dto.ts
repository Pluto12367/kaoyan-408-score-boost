import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

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

  @IsOptional()
  @IsIn(['确定', '不确定', '完全不会'])
  confidence?: '确定' | '不确定' | '完全不会';

  @IsOptional()
  @IsBoolean()
  usedHint?: boolean;

  @IsOptional()
  @IsBoolean()
  answerModified?: boolean;

  @IsOptional()
  @IsIn(['ai_assisted_self'])
  /** V14 ②（D-A 批准）：仅 AI 辅助自评可显式标注；其余 gradingMode 由服务端推导。 */
  gradingMode?: 'ai_assisted_self';

  @IsOptional()
  @IsString()
  variantQuestionId?: string;
}
