import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

export class GenerateAiVariantDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  count?: number;
}

export class ConfirmAiVariantDto {
  @IsString()
  @IsNotEmpty()
  stem!: string;

  @IsArray()
  @ArrayMinSize(4)
  @ArrayMaxSize(4)
  @IsString({ each: true })
  options!: string[];

  @IsIn(['A', 'B', 'C', 'D'])
  answer!: string;

  @IsString()
  @IsNotEmpty()
  analysis!: string;

  @IsIn(['基础', '中等', '困难'])
  difficulty!: '基础' | '中等' | '困难';
}
