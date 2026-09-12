/**
 * S1 Score Anchor — write/query API contracts.
 *
 * Global ValidationPipe (whitelist + transform) strips unknown fields, so
 * every field a client may send is declared here. Provenance is NOT taken
 * from the client where the role already decides it — the service forces it.
 */
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

const SCORE_SOURCES = ['MOCK', 'DIAGNOSTIC', 'TEACHER_GRADED', 'RUBRIC_GRADED', 'REAL_EXAM', 'IMPORTED', 'UNKNOWN'];
const SCORE_SEMANTICS = ['exam_total', 'accuracy_rate'];
const EXAM_TYPES = ['real_exam', 'institution_verified', 'teacher_verified_mock'];

export class RecordScorePredictionDto {
  @IsString()
  @Length(8, 120)
  predictionKey!: string;

  @IsString()
  @Length(1, 80)
  modelVersion!: string;

  @IsNumber()
  @Min(0)
  @Max(150)
  predictedScore!: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(150)
  predictedMinScore?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(150)
  predictedMaxScore?: number;

  @IsOptional()
  @IsIn(['report', 'diagnosis', 'calibration'])
  generatedFor?: string;

  @IsOptional()
  @IsObject()
  inputsSnapshot?: Record<string, unknown>;
}

export class RecordScoreAssessmentDto {
  @IsNumber()
  @Min(0)
  rawScore!: number;

  @IsNumber()
  rawTotalScale!: number;

  @IsOptional()
  @IsIn(SCORE_SEMANTICS)
  semantic?: string;

  @IsOptional()
  @IsIn(SCORE_SOURCES)
  source?: string;

  @IsOptional()
  @IsIn(['exact_match', 'self_report', 'teacher_graded', 'rubric'])
  gradingMethod?: string;

  @IsOptional()
  @IsISO8601()
  examDate?: string;

  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  @IsOptional()
  @IsObject()
  evidenceRefs?: Record<string, unknown>;

  /** Caller-supplied idempotency identity; a retry with the same key reads back. */
  @IsOptional()
  @IsString()
  @Length(8, 120)
  clientKey?: string;
}

/**
 * G1.8 — exam-date entry (owner decision A6).
 *
 * `null` clears the date. The service validates the format, rejects past dates
 * and derives `remainingDays` through the shared helper, so the API and the UI
 * cannot disagree about how many days are left.
 */
export class SetExamDateDto {
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'examDate must be YYYY-MM-DD' })
  examDate?: string | null;
}

export class RecordScoreOutcomeDto {
  @IsIn(EXAM_TYPES)
  examType!: string;

  @IsOptional()
  @IsNumber()
  examYear?: number;

  @IsNumber()
  @Min(0)
  rawScore!: number;

  @IsNumber()
  rawTotalScale!: number;

  @IsISO8601()
  occurredAt!: string;

  @IsOptional()
  @IsObject()
  evidenceRefs?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @Length(8, 120)
  clientKey?: string;

  /** Teacher/admin only — a student request with this flag is rejected. */
  @IsOptional()
  @IsBoolean()
  verified?: boolean;
}

export class RecordScoreCorrectionDto {
  @IsIn(['assessment', 'outcome'])
  targetKind!: 'assessment' | 'outcome';

  @IsString()
  @Length(1, 64)
  targetId!: string;

  @IsObject()
  correctedFields!: Record<string, unknown>;

  @IsString()
  @Length(1, 300)
  reason!: string;
}
