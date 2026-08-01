import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsString, MaxLength } from 'class-validator';

export class ConfirmImportDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  candidateIds!: string[];

  @IsString()
  @MaxLength(255)
  idempotencyKey!: string;
}
