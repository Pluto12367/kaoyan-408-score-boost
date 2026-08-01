import {
  BadRequestException, Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import type { Response } from 'express';
import { CurrentUser } from '../../auth/current-user.decorator';
import { RoleGuard } from '../../auth/role.guard';
import { Roles } from '../../auth/roles.decorator';
import { loadImportConfig } from './import-config';
import { ImportBatchService } from './import-batch.service';
import { ImportStorageService, type UploadedImportFile } from './import-storage.service';
import { QuestionTemplateService } from './question-template.service';
import { CreateImportBatchDto } from './dto/create-import-batch.dto';
import { ImportCleanupInterceptor } from './import-cleanup.interceptor';
import { ImportCandidateService } from './import-candidate.service';
import { BulkApproveCandidatesDto, UpdateImportCandidateDto } from './dto/update-import-candidate.dto';
import { CandidateQueryDto } from './dto/candidate-query.dto';
import { ConfirmImportDto } from './dto/confirm-import.dto';
import { ImportConfirmationService } from './import-confirmation.service';

const uploadConfig = loadImportConfig();

@Controller('admin/question-imports')
@UseGuards(RoleGuard)
@Roles('admin')
export class QuestionImportController {
  constructor(
    private readonly imports: ImportBatchService,
    private readonly storage: ImportStorageService,
    private readonly templates: QuestionTemplateService,
    private readonly candidates: ImportCandidateService,
    private readonly confirmations: ImportConfirmationService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(FileInterceptor('file', {
    storage: diskStorage({
      destination: uploadConfig.incomingDirectory,
      filename: (_request, _file, callback) => callback(null, randomUUID()),
    }),
    limits: { fileSize: uploadConfig.maxPdfBytes, files: 1 },
  }), ImportCleanupInterceptor)
  async create(
    @CurrentUser() user: { id: string },
    @UploadedFile() file: UploadedImportFile | undefined,
    @Body() input: CreateImportBatchDto,
    @Req() request: { questionImportStored?: unknown },
  ) {
    if (!file) throw new BadRequestException('A document file is required');
    const stored = await this.storage.putIncoming(file);
    request.questionImportStored = stored;
    return this.imports.create(user.id, input, stored);
  }

  @Get()
  list(@Query('page') page?: number, @Query('pageSize') pageSize?: number) {
    return this.imports.list(page, pageSize);
  }

  @Get('templates/:format')
  async template(@Param('format') format: string, @Res({ passthrough: true }) response: Response) {
    if (format === 'csv') {
      response.setHeader('Content-Type', 'text/csv; charset=utf-8');
      response.setHeader('Content-Disposition', 'attachment; filename="question-import-template.csv"');
      return this.templates.buildCsv();
    }
    if (format === 'xlsx') {
      response.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      response.setHeader('Content-Disposition', 'attachment; filename="question-import-template.xlsx"');
      return this.templates.buildXlsx();
    }
    throw new BadRequestException('Only csv and xlsx templates are supported');
  }

  @Get(':batchId')
  detail(@Param('batchId') batchId: string) {
    return this.imports.detail(batchId);
  }

  @Get(':batchId/pages/:pageNumber')
  async pagePreview(@CurrentUser() user: { id: string }, @Param('batchId') batchId: string, @Param('pageNumber') pageNumber: string, @Res() response: Response) {
    const asset = await this.imports.pagePreview(user.id, batchId, Number(pageNumber));
    const path = await this.storage.resolvePagePreviewJpegPath(asset.storageKey);
    response.setHeader('Content-Type', 'image/jpeg');
    response.setHeader('Cache-Control', 'private, max-age=300');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    createReadStream(path).pipe(response);
  }

  @Get(':batchId/candidates')
  candidateList(@Param('batchId') batchId: string, @Query() query: CandidateQueryDto) {
    return this.candidates.list(batchId, { status: query.status }, { page: query.page, pageSize: query.pageSize });
  }

  @Patch('candidates/:candidateId')
  updateCandidate(
    @CurrentUser() user: { id: string },
    @Param('candidateId') candidateId: string,
    @Body() input: UpdateImportCandidateDto,
  ) {
    const patch = Object.fromEntries(Object.entries(input.patch).filter(([, value]) => value !== undefined));
    return this.candidates.update(candidateId, input.revision, patch, user.id);
  }

  @Post(':batchId/candidates/bulk-approve')
  bulkApproveCandidates(
    @CurrentUser() user: { id: string },
    @Param('batchId') batchId: string,
    @Body() input: BulkApproveCandidatesDto,
  ) {
    return this.candidates.bulkApprove(batchId, input.candidates, user.id);
  }

  @Post(':batchId/confirm')
  confirm(
    @CurrentUser() user: { id: string },
    @Param('batchId') batchId: string,
    @Body() input: ConfirmImportDto,
  ) {
    return this.confirmations.confirm(batchId, input, user.id);
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
