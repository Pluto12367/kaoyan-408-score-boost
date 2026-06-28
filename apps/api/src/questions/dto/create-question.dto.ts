import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateQuestionDto {
  @IsString()
  stem!: string;

  @IsArray()
  @ArrayMinSize(2)
  @IsString({ each: true })
  options!: string[];

  @IsString()
  answer!: string;

  @IsString()
  analysis!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  knowledgePointIds!: string[];

  @IsIn(['基础', '中等', '困难'])
  difficulty!: '基础' | '中等' | '困难';

  @IsIn(['选择题', '综合题', '判断题'])
  type!: '选择题' | '综合题' | '判断题';

  @IsString()
  source!: string;

  @IsOptional()
  @IsInt()
  year?: number;

  @IsOptional()
  @IsInt()
  @Min(30)
  expectedTimeSec?: number;
}
