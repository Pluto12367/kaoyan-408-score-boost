import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Multipart crop metadata is kept separate from normal candidate revision edits. */
export class CandidateAssetUploadDto {
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  sourceRegion?: string;
}
