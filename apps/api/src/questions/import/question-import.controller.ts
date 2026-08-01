import {
  BadRequestException, Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { CurrentUser } from '../../auth/current-user.decorator';
import { RoleGuard } from '../../auth/role.guard';
import { Roles } from '../../auth/roles.decorator';
import { loadImportConfig } from './import-config';
import { ImportBatchService } from './import-batch.service';
import { ImportStorageService, type UploadedImportFile } from './import-storage.service';
import { QuestionTemplateService } from './question-template.service';
import { CreateImportBatchDto } from './dto/create-import-batch.dto';

const uploadConfig = loadImportConfig();

@Controller('admin/question-imports')
@UseGuards(RoleGuard)
@Roles('admin')
export class QuestionImportController {
  constructor(
    private readonly imports: ImportBatchService,
    private readonly storage: ImportStorageService,
    private readonly templates: QuestionTemplateService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: uploadConfig.incomingDirectory,
      filename: (_request, file, callback) => callback(null, `${randomUUID()}${extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: uploadConfig.maxPdfBytes, files: 1 },
  }))
  async create(
    @CurrentUser() user: { id: string },
    @UploadedFile() file: UploadedImportFile | undefined,
    @Body() input: CreateImportBatchDto,
  ) {
    if (!file) {
      await this.imports.recordRejection(user.id, file);
      throw new BadRequestException('A document file is required');
    }
    try {
      const stored = await this.storage.putIncoming(file);
      return await this.imports.create(user.id, input, stored);
    } catch (error) {
      await this.imports.recordRejection(user.id, file);
      throw error;
    }
  }

  @Get()
  list(@Query('page') page?: number, @Query('pageSize') pageSize?: number) {
    return this.imports.list(page, pageSize);
  }

  @Get('templates/:format')
  @Header('Content-Disposition', 'attachment')
  template(@Param('format') format: string) {
    if (format === 'csv') return this.templates.buildCsv();
    if (format === 'xlsx') return this.templates.buildXlsx();
    throw new BadRequestException('Only csv and xlsx templates are supported');
  }

  @Get(':batchId')
  detail(@Param('batchId') batchId: string) {
    return this.imports.detail(batchId);
  }

  @Post(':batchId/cancel')
  cancel(@CurrentUser() user: { id: string }, @Param('batchId') batchId: string) {
    return this.imports.cancel(user.id, batchId);
  }

  @Post(':batchId/retry')
  retry(@CurrentUser() user: { id: string }, @Param('batchId') batchId: string, @Body('jobIds') jobIds: unknown) {
    return this.imports.retry(user.id, batchId, jobIds);
  }
}
